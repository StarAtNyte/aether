import { describe, expect, it } from 'vitest';
import { History, createWorld, encodeMesh, summarizeWorld } from '@aether/core';
import { createMockProvider, WorldAgent } from '@aether/agent';
import { lockedReason, overwrittenEdits, screenLocked } from '../src/engine/editGuard';
import { AgentBridge, agentCatalogs } from '../src/engine/AgentBridge';
function setup() {
    const history = new History(createWorld());
    history.commit([
        { op: 'add', entity: { id: 'tower', name: 'Tower', shape: { kind: 'procedural', generator: 'tower', params: {} }, transform: { position: [0, 0, 0] } } },
        { op: 'add', entity: { id: 'tower-2', name: 'Tower', shape: { kind: 'procedural', generator: 'tower', params: {} }, transform: { position: [30, 0, 0] } } },
        { op: 'add', entity: { id: 'statue', locked: true, shape: { kind: 'procedural', generator: 'statue', params: {} } } },
        { op: 'add', entity: { id: 'base', shape: { kind: 'primitive', primitive: 'box', size: [4, 1, 4] } } },
        { op: 'add', entity: { id: 'gem', parent: 'base', locked: true } },
    ], 'agent build', 'agent');
    return { history, bridge: new AgentBridge(history, null) };
}
describe('lock screening', () => {
    it('refuses edits, removals and clears that touch locked entities', () => {
        const { history } = setup();
        const w = history.current;
        expect(lockedReason(w, { op: 'update', id: 'statue', set: { visible: false } })).toMatch(/locked by the user/);
        expect(lockedReason(w, { op: 'rename', id: 'statue', newId: 'x' })).toMatch(/locked/);
        expect(lockedReason(w, { op: 'remove', id: 'base' })).toMatch(/would delete 'gem'/);
        expect(lockedReason(w, { op: 'remove', id: 'base', recursive: false })).toBeNull();
        expect(lockedReason(w, { op: 'clear' })).toMatch(/locked/);
        expect(lockedReason(w, { op: 'update', id: 'tower', set: { visible: false } })).toBeNull();
        expect(lockedReason(w, 'garbage')).toBeNull();
        const s = screenLocked(w, [{ op: 'update', id: 'tower', set: {} }, { op: 'update', id: 'statue', set: {} }]);
        expect(s.indices).toEqual([0]);
        expect(s.refused[0]?.index).toBe(1);
    });
    it('refuses mesh edits of locked entities', () => {
        const h = new History(createWorld());
        const mesh = encodeMesh('m', { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]), colors: null, uvs: null, faceMaterials: null });
        h.commit([{ op: 'setMesh', mesh }, { op: 'add', entity: { id: 'rock', locked: true, shape: { kind: 'mesh', mesh: 'm' } } }], 'add', 'user');
        expect(lockedReason(h.current, { op: 'setMesh', mesh: { ...mesh } })).toMatch(/'rock' is locked/);
    });
});
describe('AgentBridge with hand edits', () => {
    it('applies the allowed patches, refuses locked ones with original indices', () => {
        const { bridge, history } = setup();
        const r = bridge.applyPatches([{ op: 'update', id: 'statue', set: { visible: false } }, { op: 'update', id: 'tower', set: { name: 'Big tower' } }, { op: 'update', id: 'missing', set: {} }], 'edit');
        expect(r.applied).toHaveLength(1);
        expect(r.errors.map((e) => e.index)).toEqual([0, 2]);
        expect(history.current.entities['statue']?.visible).toBe(true);
    });
    it('reports overwritten hand edits to the model and the chat', () => {
        const { bridge, history } = setup();
        history.commit([{ op: 'update', id: 'tower', set: { transform: { position: [5, 0, 5] } } }], 'Move tower', 'user');
        expect([...bridge.userEdits().keys()]).toEqual(['tower']);
        const r = bridge.applyPatches([{ op: 'update', id: 'tower', set: { transform: { position: [0, 0, 0] } } }], 'move back');
        expect(r.notes?.[0]).toMatch(/tower: transform\.position/);
        expect(bridge.takeOverwrites()).toEqual(['tower: transform.position']);
        expect(bridge.takeOverwrites()).toEqual([]);
        const scale = bridge.applyPatches([{ op: 'update', id: 'tower', set: { transform: { scale: [1, 2, 1] } } }], 'taller');
        expect(scale.notes).toBeUndefined();
        expect(overwrittenEdits([{ op: 'remove', id: 'tower', recursive: true }], new Map([['tower', { paths: ['transform.position'], age: 0 }]]))).toEqual(['tower: removed']);
    });
    it('"make the tower I just moved taller" changes the tower the user moved (offline planner)', async () => {
        const { bridge, history } = setup();
        history.commit([{ op: 'update', id: 'tower-2', set: { transform: { position: [31, 0, 2] } } }], 'Move tower', 'user');
        const summary = summarizeWorld(history.current, { userEdits: bridge.userEdits() });
        expect(summary).toMatch(/tower-2 .*user-edited\(transform\.position, just now\)/);
        const agent = new WorldAgent({ provider: createMockProvider(), catalogs: agentCatalogs() });
        const events = [];
        for await (const e of agent.run('make the tower I just moved taller', bridge))
            events.push(e);
        const t2 = history.current.entities['tower-2'];
        expect(t2.transform.scale[1]).toBeGreaterThan(1);
        expect(t2.transform.scale[0]).toBe(1);
        expect(t2.transform.position).toEqual([31, 0, 2]);
        expect(history.current.entities['tower'].transform.scale).toEqual([1, 1, 1]);
    });
    it('the offline planner leaves locked objects alone and says so', async () => {
        const { bridge, history } = setup();
        const agent = new WorldAgent({ provider: createMockProvider(), catalogs: agentCatalogs() });
        const texts = [];
        for await (const e of agent.run('make the statue red', bridge))
            if (e.type === 'message')
                texts.push(e.text);
        expect(history.current.entities['statue']?.material).toBeUndefined();
        expect(texts.join(' ')).toMatch(/locked/);
    });
});
