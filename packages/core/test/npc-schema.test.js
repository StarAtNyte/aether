import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld, deepEqual, NpcCond, NpcSpec, summarizeWorld, WorldTest } from '../src/index';
const guardEntity = {
    id: 'guard',
    name: 'Gate Guard',
    shape: { kind: 'primitive', primitive: 'capsule', size: [0.8, 1.8, 0.8] },
    transform: { position: [0, 0.9, 0] },
    physics: { body: 'kinematic' },
    npc: { role: 'guard', archetype: 'guard', faction: 'watch', waypoints: [[4, 0, 0], [4, 0, 6]], attack: { damage: 10 } },
};
describe('NpcSpec', () => {
    it('fills defaults so a three-word NPC is complete', () => {
        const n = NpcSpec.parse({ archetype: 'guard' });
        expect(n.faction).toBe('neutral');
        expect(n.speed).toBeGreaterThan(0);
        expect(n.runSpeed).toBeGreaterThan(n.speed);
        expect(n.perception.sight).toBeGreaterThan(5);
        expect(n.perception.fov).toBe(110);
        expect(n.patrol.mode).toBe('loop');
        expect(n.waypoints).toEqual([]);
        expect(n.transitions).toEqual([]);
    });
    it('rejects out-of-range and unknown values', () => {
        expect(NpcSpec.safeParse({ speed: -1 }).success).toBe(false);
        expect(NpcSpec.safeParse({ archetype: 'dragon' }).success).toBe(false);
        expect(NpcSpec.safeParse({ perception: { fov: 5 } }).success).toBe(false);
        expect(NpcSpec.safeParse({ faction: 'Bad Name' }).success).toBe(false);
        expect(NpcSpec.safeParse({ waypoints: Array.from({ length: 33 }, () => [0, 0, 0]) }).success).toBe(false);
        expect(NpcSpec.safeParse({ activeHours: [25, 3] }).success).toBe(false);
    });
    it('caps the size of every list so a hostile document stays cheap', () => {
        expect(NpcSpec.safeParse({ enemies: Array.from({ length: 9 }, (_, i) => `f${i}`) }).success).toBe(false);
        expect(NpcSpec.safeParse({ fears: Array.from({ length: 9 }, (_, i) => `t${i}`) }).success).toBe(false);
        expect(NpcSpec.safeParse({ transitions: Array.from({ length: 25 }, () => ({ to: 'idle', when: { k: 'always' } })) }).success).toBe(false);
    });
});
describe('NpcCond', () => {
    it('parses nested conditions and rejects malformed ones', () => {
        const ok = NpcCond.safeParse({ k: 'all', cs: [{ k: 'seesFoe' }, { k: 'not', c: { k: 'foeBeyond', r: 8 } }, { k: 'time', from: 20, to: 5 }] });
        expect(ok.success).toBe(true);
        expect(NpcCond.safeParse({ k: 'any', cs: [] }).success).toBe(false);
        expect(NpcCond.safeParse({ k: 'foeWithin' }).success).toBe(false);
        expect(NpcCond.safeParse({ k: 'teleport' }).success).toBe(false);
        expect(NpcCond.safeParse({ k: 'flag', key: 'torch', op: '>=', value: 1 }).success).toBe(true);
    });
    it('transitions default to "from anywhere, priority 50"', () => {
        const n = NpcSpec.parse({ transitions: [{ to: 'flee', when: { k: 'fearNear' } }] });
        expect(n.transitions[0]).toMatchObject({ from: '*', priority: 50, to: 'flee' });
    });
});
describe('npc on entities and patches', () => {
    it('is optional: worlds without NPCs are unchanged', () => {
        const w = createWorld({ entities: { box: { id: 'box' } } });
        expect(w.entities['box']?.npc).toBeUndefined();
    });
    it('adds a guard with one patch and edits it with a minimal merge', () => {
        const base = createWorld({});
        const add = applyPatches(base, [{ op: 'add', entity: guardEntity }]);
        expect(add.errors).toEqual([]);
        expect(add.world.entities['guard']?.npc?.faction).toBe('watch');
        const faster = applyPatches(add.world, [{ op: 'update', id: 'guard', set: { npc: { speed: 2.6 } } }]);
        expect(faster.errors).toEqual([]);
        const npc = faster.world.entities['guard']?.npc;
        expect(npc?.speed).toBe(2.6);
        expect(npc?.waypoints).toHaveLength(2); // untouched
        expect(npc?.attack?.damage).toBe(10);
    });
    it('merges nested perception and replaces arrays; null resets to the default', () => {
        const w0 = applyPatches(createWorld({}), [{ op: 'add', entity: guardEntity }]).world;
        const w1 = applyPatches(w0, [{ op: 'update', id: 'guard', set: { npc: { perception: { sight: 25 }, fears: ['fire'], waypoints: [[1, 0, 1]] } } }]).world;
        expect(w1.entities['guard']?.npc?.perception).toMatchObject({ sight: 25, fov: 110 });
        expect(w1.entities['guard']?.npc?.fears).toEqual(['fire']);
        expect(w1.entities['guard']?.npc?.waypoints).toEqual([[1, 0, 1]]);
        const w2 = applyPatches(w1, [{ op: 'update', id: 'guard', set: { npc: { perception: { sight: null } } } }]).world;
        expect(w2.entities['guard']?.npc?.perception.sight).toBe(14);
        const w3 = applyPatches(w2, [{ op: 'update', id: 'guard', set: { npc: null } }]).world;
        expect(w3.entities['guard']?.npc).toBeUndefined();
    });
    it('edits a single dialogue node and rejects a dangling link atomically', () => {
        const talker = { ...guardEntity, id: 'mira', npc: { archetype: 'merchant', dialogue: { start: 'start', nodes: { start: { text: 'Hello' } } } } };
        const w0 = applyPatches(createWorld({}), [{ op: 'add', entity: talker }]).world;
        const ok = applyPatches(w0, [{ op: 'update', id: 'mira', set: { npc: { dialogue: { nodes: { start: { text: 'Welcome!', choices: [{ text: 'Bye' }] } } } } } }]);
        expect(ok.errors).toEqual([]);
        expect(ok.world.entities['mira']?.npc?.dialogue?.nodes['start']?.text).toBe('Welcome!');
        const bad = applyPatches(w0, [{ op: 'update', id: 'mira', set: { npc: { dialogue: { nodes: { start: { next: 'nowhere' } } } } } }]);
        expect(bad.errors).toHaveLength(1);
        expect(bad.world.entities['mira']?.npc?.dialogue?.nodes['start']?.next).toBeNull();
    });
    it('rejects prototype-pollution keys inside npc data', () => {
        const w0 = createWorld({});
        const poisoned = JSON.parse('{"op":"add","entity":{"id":"x","npc":{"role":"a","clips":{"__proto__":"x"}}}}');
        const r = applyPatches(w0, [poisoned]);
        expect(r.errors.length).toBeGreaterThan(0);
        expect({}['x']).toBeUndefined();
    });
    it('round-trips through JSON unchanged', () => {
        const w = applyPatches(createWorld({}), [{ op: 'add', entity: guardEntity }]).world;
        expect(deepEqual(createWorld(JSON.parse(JSON.stringify(w))), w)).toBe(true);
    });
});
describe('npc summary and tests', () => {
    it('summarizes an NPC on its entity line so the agent can address and edit it', () => {
        const w = applyPatches(createWorld({}), [{ op: 'add', entity: guardEntity }]).world;
        const line = summarizeWorld(w).split('\n').find((l) => l.startsWith('guard |')) ?? '';
        expect(line).toContain('npc "guard" arch=guard fac=watch');
        expect(line).toContain('spd=1.5');
        expect(line).toContain('wp=2');
        expect(line).toContain('dmg=10');
        // Hostility to the player is implied by the archetype; the summary spells it out.
        expect(line).toContain('foes=player');
    });
    it('adds the npcs world test kind with sensible defaults', () => {
        const t = WorldTest.parse({ id: 'npcs-work', kind: 'npcs' });
        expect(t).toMatchObject({ target: '*', seconds: 20, stuckAfter: 6 });
        expect(WorldTest.safeParse({ id: 'x', kind: 'npcs', seconds: 0 }).success).toBe(false);
    });
});
