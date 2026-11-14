import { createWorld, type EntityInput } from '@aether/core';
import { describe, expect, it } from 'vitest';
import { COPLANAR_LIFT, coplanarLifts } from '../src/sync/coplanar';

const slab = (id: string, position: [number, number, number], size: [number, number, number], extra: Partial<EntityInput> = {}): EntityInput => ({
  id,
  shape: { kind: 'primitive', primitive: 'box', size },
  transform: { position },
  physics: { body: 'static' },
  ...extra,
});
const lifts = (...entities: EntityInput[]) => coplanarLifts(createWorld({ entities: Object.fromEntries(entities.map((e) => [e.id, e])) }));

describe('coplanarLifts', () => {
  // Casa del Patio: the stone forecourt and the end of the gravel drive, both 8 cm boxes on the ground.
  it('draws the smaller of two overlapping paving slabs in one plane a lift above the larger', () => {
    const m = lifts(slab('drive', [-6.5, 0.04, 24.7], [4.2, 0.08, 34]), slab('forecourt', [-6, 0.04, 10.7], [11, 0.08, 6.5]));
    expect(m.get('forecourt')).toBeCloseTo(COPLANAR_LIFT);
    expect(m.has('drive')).toBe(false);
  });

  it('leaves alone slabs that only touch, lie at different heights, or are volumes', () => {
    expect(lifts(slab('a', [0, 0.04, 0], [2, 0.08, 2]), slab('b', [2, 0.04, 0], [2, 0.08, 2])).size).toBe(0);
    expect(lifts(slab('a', [0, 0.04, 0], [4, 0.08, 4]), slab('b', [0, 0.06, 0], [2, 0.08, 2])).size).toBe(0);
    expect(lifts(slab('a', [0, 1, 0], [4, 2, 4]), slab('b', [0, 1, 0], [2, 2, 2])).size).toBe(0);
    expect(lifts(slab('a', [0, 0.04, 0], [4, 0.08, 4]), slab('b', [0, 0.04, 0], [2, 0.08, 2], { physics: { body: 'dynamic' } })).size).toBe(0);
  });

  it('stacks three layers, follows yaw and parents, and pairs a plane with a box top', () => {
    const m = lifts(
      slab('lawn', [0, 0.05, 0], [20, 0.1, 20]),
      slab('path', [0, 0.05, 0], [10, 0.1, 2], { transform: { position: [0, 0.05, 0], rotation: [0, 45, 0] } }),
      { id: 'rug', shape: { kind: 'primitive', primitive: 'plane', size: [1, 0, 1] }, transform: { position: [0, 0.1, 0] } },
    );
    expect(m.get('path')).toBeCloseTo(COPLANAR_LIFT);
    expect(m.get('rug')).toBeCloseTo(2 * COPLANAR_LIFT);
    // A child placed 30 m off by its parent does not meet the lawn.
    const far = lifts(slab('lawn', [0, 0.05, 0], [20, 0.1, 20]), { id: 'g', shape: { kind: 'none' }, transform: { position: [30, 0, 0] } }, slab('patch', [0, 0.05, 0], [2, 0.1, 2], { parent: 'g' }));
    expect(far.size).toBe(0);
  });
});

describe('coplanarLifts at scale', () => {
  it('pairs a tiled yard of 4000 slabs in one plane through the grid, quickly', () => {
    const tiles: EntityInput[] = [];
    for (let i = 0; i < 4000; i++) tiles.push(slab(`t${i}`, [(i % 80) * 1.0, 0.02, Math.floor(i / 80) * 1.0], [0.98, 0.04, 0.98]));
    tiles.push(slab('mat', [10, 0.02, 10], [0.5, 0.04, 0.5]));
    const w = createWorld({ entities: Object.fromEntries(tiles.map((e) => [e.id, e])) });
    const t0 = performance.now();
    const m = coplanarLifts(w);
    expect(performance.now() - t0).toBeLessThan(250);
    expect([...m.keys()]).toEqual(['mat']);
  });
});
