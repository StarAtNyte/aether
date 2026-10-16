import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createWorld, findStandIns, validateWorld } from '../src/index';
function world(entities, voxel = false) {
    const w = createWorld({ entities: Object.fromEntries(entities.map((e) => [e.id, e])) });
    return voxel ? { ...w, voxel: { seed: 1 } } : w;
}
const capsule = (id, extra = {}) => ({ id, shape: { kind: 'primitive', primitive: 'capsule', size: [0.6, 1.7, 0.6] }, ...extra });
describe('stand-in lint', () => {
    it('flags a bare capsule villager, ghost and enemy', () => {
        const w = world([capsule('villager-1', { tags: ['npc'] }), capsule('ghost-1'), capsule('enemy-1')]);
        expect(findStandIns(w).map((s) => `${s.id}:${s.kind}`).sort()).toEqual(['enemy-1:person', 'ghost-1:person', 'villager-1:person']);
    });
    it('accepts a capsule that carries a character (the capsule is only the collider)', () => {
        expect(findStandIns(world([capsule('villager-1', { character: { wardrobe: 'villager' } })]))).toEqual([]);
    });
    it('flags block mini-figures and cube pets, and bare boxes for vehicles', () => {
        const w = world([
            { id: 'fan-1', shape: { kind: 'asset', id: 'man-b' } },
            { id: 'cat-1', tags: ['animal'], shape: { kind: 'asset', id: 'cat' } },
            { id: 'car-1', behaviors: [{ type: 'vehicle', params: {} }], shape: { kind: 'primitive', primitive: 'box', size: [2, 1, 4] } },
        ]);
        expect(findStandIns(w).map((s) => s.kind).sort()).toEqual(['animal', 'person', 'vehicle']);
    });
    it('leaves modelled animals and vehicles, parts of a being, and block worlds alone', () => {
        const w = world([
            { id: 'wolf-1', npc: { archetype: 'predator' }, shape: { kind: 'asset', id: 'wolf' } },
            { id: 'taxi-1', shape: { kind: 'asset', id: 'taxi' } },
            capsule('guard-1', { character: { wardrobe: 'guard' } }),
            { id: 'guard-1-torch', parent: 'guard-1', shape: { kind: 'primitive', primitive: 'cylinder', size: [0.1, 0.5, 0.1] } },
            { id: 'neon-cat-1', shape: { kind: 'primitive', primitive: 'sphere', size: [0.9, 0.9, 0.9] } },
        ]);
        expect(findStandIns(w)).toEqual([]);
        expect(findStandIns(world([capsule('villager-1')], true))).toEqual([]);
    });
    it('finds no stand-in in any bundled project', () => {
        const dir = new URL('../../../apps/studio/public/templates/worlds/', import.meta.url);
        const bad = [];
        for (const f of readdirSync(dir)) {
            const v = validateWorld(JSON.parse(readFileSync(new URL(f, dir), 'utf8')).world);
            if (!v.ok)
                continue;
            for (const s of findStandIns(v.world))
                bad.push(`${f}:${s.id}`);
        }
        expect(bad).toEqual([]);
    });
});
