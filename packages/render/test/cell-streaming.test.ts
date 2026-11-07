import { describe, expect, it } from 'vitest';
import { createWorld, type EntityInput } from '@aether/core';
import { boxDistance, CellStreamer, estimateExtent, planStreaming, streamingConfig, worldPartition } from '../src/streaming/cell-streaming';

const house = (id: string, x: number, z: number, extra: Partial<EntityInput> = {}): EntityInput => ({
  id, transform: { position: [x, 0, z], rotation: [0, 0, 0], scale: [1, 1, 1] },
  shape: { kind: 'procedural', generator: 'row-house', params: { width: 6, depth: 8 } }, ...extra,
});

/** A town 800 m across: a row of houses every 40 m along X, a terrain, a lamp and a hero building. */
function town() {
  const entities: Record<string, EntityInput> = {};
  for (let i = 0; i <= 20; i++) entities[`h${i}`] = house(`h${i}`, -400 + i * 40, 0);
  entities['ground'] = { id: 'ground', shape: { kind: 'procedural', generator: 'town-terrain', params: {} } };
  entities['lamp'] = house('lamp', 0, 10, { light: { type: 'point', color: '#ffffff', intensity: 1, range: 10 } } as Partial<EntityInput>);
  entities['statue'] = house('statue', 40, 10, { tags: ['landmark'] });
  entities['blob'] = { id: 'blob', transform: { position: [80, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, shape: { kind: 'procedural', generator: 'mystery', params: {} } };
  entities['door'] = { id: 'door', parent: 'h3', shape: { kind: 'primitive', primitive: 'box', size: [1, 2, 0.1] }, behaviors: [{ type: 'door' }] } as EntityInput;
  return createWorld({ entities });
}

describe('cell streaming plan', () => {
  it('estimates sizes from shape parameters and leaves unknown ones out', () => {
    const w = town();
    expect(estimateExtent(w.entities['h0']!)).toBe(8);
    expect(estimateExtent(w.entities['ground']!)).toBeNull();
    expect(estimateExtent(w.entities['blob']!)).toBeNull();
  });

  it('streams static scenery and pins lights, landmarks, behaviour, terrain and unknown sizes', () => {
    const w = town();
    const p = worldPartition(w)!;
    expect(p.cellSize).toBe(64);
    const plan = planStreaming(w, p);
    expect(plan.entities.has('h0')).toBe(true);
    expect(plan.entities.has('h20')).toBe(true);
    for (const id of ['ground', 'lamp', 'statue', 'blob', 'h3']) expect(plan.entities.has(id)).toBe(false);
    expect(plan.pinned['behaviour']).toBe(1);
    // Estimated boxes hold the shape with room for rotation and eaves.
    const b = plan.entities.get('h10')!.box;
    expect(b[0]).toBeLessThan(-4);
    expect(b[2]).toBeGreaterThan(4);
  });
});

describe('cell streamer', () => {
  const setup = () => {
    const w = town();
    const p = worldPartition(w)!;
    return new CellStreamer(planStreaming(w, p), { ...streamingConfig(p.cellSize, 'low'), maxLoading: 100 });
  };

  it('primes the cells near the opening only', () => {
    const s = setup();
    const keys = s.primeAround([{ x: 0, z: 0 }]);
    expect(keys.length).toBeGreaterThan(0);
    expect(s.resident('h10')).toBe(true);
    expect(s.resident('h0')).toBe(false);
    // Entities outside the plan are always resident.
    expect(s.resident('ground')).toBe(true);
  });

  it('loads near cells and unloads far ones only after the hysteresis band and delay', () => {
    const s = setup();
    for (const k of s.primeAround([{ x: 0, z: 0 }])) s.loaded(k);
    // Walk to the west end: the west cells load at once.
    let c = s.update([{ x: -380, z: 0 }], 0);
    expect(c.load.length).toBeGreaterThan(0);
    expect(s.resident('h0')).toBe(true);
    for (const k of c.load) s.loaded(k);
    // The east cells are far, but stay until the delay has passed.
    expect(c.unload).toEqual([]);
    c = s.update([{ x: -380, z: 0 }], 4000);
    expect(c.unload).toEqual([]);
    c = s.update([{ x: -380, z: 0 }], 5200);
    expect(c.unload.length).toBeGreaterThan(0);
    expect(s.resident('h10')).toBe(false);
    // A camera back inside the band keeps a resident cell (no unload while it hovers on the ring edge).
    const t = setup();
    for (const k of t.primeAround([{ x: 0, z: 0 }])) t.loaded(k);
    const radius = streamingConfig(64, 'low').loadRadius;
    t.update([{ x: radius + 30, z: 0 }], 0);
    expect(t.update([{ x: radius + 30, z: 0 }], 10_000).unload.every((k) => !t.members(k).includes('h10'))).toBe(true);
  });

  it('loads at most maxLoading cells at once, nearest first', () => {
    const w = town();
    const p = worldPartition(w)!;
    const s = new CellStreamer(planStreaming(w, p), { ...streamingConfig(p.cellSize, 'ultra'), maxLoading: 1 });
    const c = s.update([{ x: 0, z: 0 }], 0);
    expect(c.load.length).toBe(1);
    expect(s.members(c.load[0]!).some((id) => id === 'h10' || id === 'h9' || id === 'h11')).toBe(true);
    expect(s.update([{ x: 0, z: 0 }], 10).load).toEqual([]);
    s.loaded(c.load[0]!);
    expect(s.update([{ x: 0, z: 0 }], 20).load.length).toBe(1);
  });

  it('widens a cell with learnt bounds', () => {
    const s = setup();
    const key = [...s.primeAround([{ x: 0, z: 0 }])][0]!;
    const id = s.members(key)[0]!;
    s.learn(id, [-1000, -1, 1000, 1]);
    expect(boxDistance(s.box(key)! as [number, number, number, number], -900, 0)).toBe(0);
  });
});
