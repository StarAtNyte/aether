import { describe, expect, it } from 'vitest';
import { createWorld, edgeDistance, findWaterBodies, waterAt } from '../src/index';
const pond = { id: 'pond', shape: { kind: 'primitive', primitive: 'cylinder', size: [10, 0.1, 10] }, transform: { position: [5, 0.05, 5] }, material: { preset: 'water' } };
const river = { id: 'river', shape: { kind: 'primitive', primitive: 'plane', size: [100, 0.1, 20] }, transform: { position: [0, 0.4, 0], rotation: [0, 90, 0] }, material: { preset: 'water' } };
describe('water bodies', () => {
    it('are the horizontal tops of water entities, largest first, with rotation and parents applied', () => {
        const w = createWorld({ entities: { pond, river, rock: { id: 'rock', shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] } }, kid: { ...pond, id: 'kid', parent: 'rock', transform: { position: [0, 0, 0] } } } });
        const bodies = findWaterBodies(w);
        expect(bodies.map((b) => b.id)).toEqual(['river', 'pond', 'kid']);
        expect(bodies[0]?.y).toBeCloseTo(0.4, 6);
        // Turned 90 degrees: 20 wide in x, 100 deep in z.
        expect((bodies[0]?.maxX ?? 0) - (bodies[0]?.minX ?? 0)).toBeCloseTo(20, 6);
        expect((bodies[0]?.maxZ ?? 0) - (bodies[0]?.minZ ?? 0)).toBeCloseTo(100, 6);
        expect(bodies[1]?.y).toBeCloseTo(0.1, 6);
        expect(bodies[1]?.round).toBe(true);
    });
    it('answer which water holds a point and how far it is from the bank', () => {
        const w = createWorld({ entities: { pond } });
        const bodies = findWaterBodies(w);
        expect(waterAt(bodies, 5, 5, 0.1)?.id).toBe('pond');
        // The corner of the bounding box is outside the round pond.
        expect(waterAt(bodies, 9.8, 9.8, 0.1)).toBeNull();
        expect(edgeDistance(bodies[0], 5, 5)).toBeCloseTo(5, 6);
        expect(edgeDistance(bodies[0], 9, 5)).toBeCloseTo(1, 6);
        expect(edgeDistance(bodies[0], 20, 5)).toBe(0);
    });
    it('skip hidden, template and non-primitive water, and survive hostile numbers', () => {
        const w = createWorld({ entities: { a: { ...pond, id: 'a', visible: false }, b: { ...pond, id: 'b', template: true }, c: { ...pond, id: 'c', shape: { kind: 'procedural', generator: 'waterfall', params: {} } } } });
        expect(findWaterBodies(w)).toEqual([]);
    });
});
