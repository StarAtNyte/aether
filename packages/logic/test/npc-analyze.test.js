import { describe, expect, it } from 'vitest';
import { analyzeNpcs } from '../src';
import { npcEntity, rig, wallEntity } from './npc-helpers';
import { worldOf } from './helpers';
const GUARD = { archetype: 'guard', faction: 'watch', attack: { damage: 5 } };
describe('analyzeNpcs', () => {
    it('passes a clean world', () => {
        const w = worldOf([npcEntity('g', 0, 0, { ...GUARD, waypoints: [[6, 0, 0], [6, 0, 6]] })]);
        expect(analyzeNpcs(w)).toEqual({ errors: [], warnings: [], npcs: 1 });
    });
    it('reports an NPC standing inside a wall', () => {
        const w = worldOf([wallEntity('block', 0, 0, 8, 8, 4), npcEntity('g', 0, 0, { ...GUARD })]);
        const a = analyzeNpcs(w);
        expect(a.errors).toHaveLength(1);
        expect(a.errors[0]).toMatch(/g: stands on ground it cannot walk on/);
    });
    it('reports an NPC over a void (no ground plane)', () => {
        const w = worldOf([npcEntity('g', 0, 0, { ...GUARD })], [], { environment: { ground: null } });
        expect(analyzeNpcs(w).errors[0]).toMatch(/cannot walk on/);
    });
    it('reports waypoints inside walls and waypoints walled off from the NPC', () => {
        const w = worldOf([
            wallEntity('w-n', 10, 7, 6, 1), wallEntity('w-s', 10, 13, 6, 1), wallEntity('w-e', 13, 10, 1, 6), wallEntity('w-w', 7, 10, 1, 6),
            wallEntity('blob', -20, -20, 10, 10),
            npcEntity('g', 0, 0, { ...GUARD, waypoints: [[10, 0, 10], [-20, 0, -20], [4, 0, 0]] }),
        ]);
        const a = analyzeNpcs(w);
        expect(a.errors.some((e) => /waypoint #1 .* is not on walkable floor/.test(e))).toBe(true); // deep inside a solid
        expect(a.errors.some((e) => /waypoint #0 .* cannot be reached/.test(e))).toBe(true);
    });
    it('a tall NPC cannot pass under a canopy that a low animal walks beneath (grids are per body size)', () => {
        const canopy = { id: 'canopy', shape: { kind: 'primitive', primitive: 'box', size: [1, 0.4, 120] }, transform: { position: [5, 1.5, 0] }, physics: { body: 'static' } };
        const entities = [
            canopy,
            npcEntity('tall', 0, 0, { ...GUARD, height: 1.8, waypoints: [[10, 0, 0], [0, 0, 0]] }),
            npcEntity('low', 0, 4, { archetype: 'predator', faction: 'wolves', height: 0.9, radius: 0.4, attack: { damage: 1 }, waypoints: [[10, 0, 4], [0, 0, 4]] }, { shape: { kind: 'primitive', primitive: 'box', size: [0.5, 0.7, 1.2] }, transform: { position: [0, 0.45, 4] } }),
        ];
        const w = worldOf(entities);
        const a = analyzeNpcs(w);
        expect(a.errors.some((e) => e.startsWith('tall:'))).toBe(true);
        expect(a.errors.some((e) => e.startsWith('low:'))).toBe(false);
        // And at runtime: the wolf crosses, the guard never gets through.
        const r = rig(entities);
        r.run(40);
        expect(r.at('low')[0]).toBeGreaterThan(-1);
        expect(r.at('tall')[0]).toBeLessThan(4); // never crosses the canopy line
    });
    it('warns about guards without routes, lone waypoints, missing attacks and absent fear tags', () => {
        const w = worldOf([
            npcEntity('post', 0, 0, { archetype: 'guard', faction: 'watch', attack: { damage: 1 } }),
            npcEntity('one', 5, 5, { archetype: 'villager', waypoints: [[6, 0, 6]] }),
            npcEntity('toothless', -5, 5, { archetype: 'predator', faction: 'wolves', fears: ['fire'] }),
        ]);
        const a = analyzeNpcs(w);
        expect(a.errors).toEqual([]);
        expect(a.warnings.some((x) => /post: a guard without waypoints/.test(x))).toBe(true);
        expect(a.warnings.some((x) => /one: a single waypoint/.test(x))).toBe(true);
        expect(a.warnings.some((x) => /toothless: predator has no attack/.test(x))).toBe(true);
        expect(a.warnings.some((x) => /toothless: fears 'fire'/.test(x))).toBe(true);
    });
    it('checks dialogues: unreachable nodes and state the world never sets', () => {
        const tree = {
            start: 'start',
            nodes: {
                start: { text: 'Hi', choices: [{ text: 'Pay', if: [{ key: 'gold', op: '>=', value: 5 }] }] },
                orphan: { text: 'Nobody gets here' },
            },
        };
        const a = analyzeNpcs(worldOf([npcEntity('m', 0, 0, { archetype: 'merchant', dialogue: tree })]));
        expect(a.warnings.some((x) => /node\(s\) orphan can never be reached/.test(x))).toBe(true);
        expect(a.warnings.some((x) => /reads state the world never sets: 'gold'/.test(x))).toBe(true);
        // Once the world sets it (state, a rule, or another dialogue's effect) the warning goes away.
        const ok = analyzeNpcs(worldOf([npcEntity('m', 0, 0, { archetype: 'merchant', dialogue: tree })], [], { state: { gold: 0 } }));
        expect(ok.warnings.some((x) => /never sets/.test(x))).toBe(false);
    });
    it('respects the target selector and ignores templates', () => {
        const w = worldOf([npcEntity('a', 0, 0, { ...GUARD, waypoints: [[4, 0, 0], [0, 0, 4]] }, { tags: ['npc'] }), npcEntity('b', 9, 9, { ...GUARD }, { template: true })]);
        expect(analyzeNpcs(w, { target: '#npc' }).npcs).toBe(1);
        expect(analyzeNpcs(w).npcs).toBe(1);
        expect(analyzeNpcs(w, { target: 'nobody' }).npcs).toBe(0);
    });
});
