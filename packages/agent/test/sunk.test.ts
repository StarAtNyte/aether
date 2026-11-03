import { applyPatches, createWorld, type WorldDoc } from '@aether/core';
import { describe, expect, it } from 'vitest';
import { worldGround } from '../src/land';
import { afloatFindings, findAfloat, findSunk, sunkFindings } from '../src/sunk';

const TERRAIN = { size: 200, height: 40, resolution: 128, roughness: 0.55, color: '#9a8a4f', variant: 3 };

function world(pieces: Array<{ id: string; generator: string; params: Record<string, unknown>; y: (g: number) => number; tags?: string[] }>): WorldDoc {
  const base = createWorld();
  const terrain = applyPatches(base, [{ op: 'add', entity: { id: 'land', shape: { kind: 'procedural', generator: 'terrain', params: TERRAIN, seed: 7 }, tags: ['terrain'] } }] as never).world;
  const g = worldGround(terrain);
  const out = applyPatches(
    terrain,
    pieces.map((p) => ({ op: 'add', entity: { id: p.id, shape: { kind: 'procedural', generator: p.generator, params: p.params, seed: 1 }, transform: { position: [30, p.y(g(30, 30)), 30] }, tags: p.tags ?? [] } })) as never,
  );
  expect(out.errors).toEqual([]);
  return out.world;
}

describe('sunk pieces', () => {
  it('finds a house sunk into the ground and leaves one standing on it alone', () => {
    const w = world([
      { id: 'sunk-house', generator: 'furn-dwelling', params: { type: 'stone-cottage' }, y: (g) => g - 3 },
      { id: 'tagged', generator: 'furn-dwelling', params: { type: 'stone-cottage' }, y: (g) => g - 3, tags: ['sunk'] },
    ]);
    const ids = findSunk(w).filter((p) => p.kind === 'sunk').map((p) => p.id);
    expect(ids).toContain('sunk-house');
    expect(ids).not.toContain('tagged');
    const f = sunkFindings(w).find((x) => x.entities.includes('sunk-house') && x.code === 'sunk_in_ground');
    expect(f?.code).toBe('sunk_in_ground');
    expect(f?.fix).toMatch(/footing/);
  });

  it('counts a stone footing as meant to be in the ground', () => {
    const w = world([{ id: 'on-footing', generator: 'furn-dwelling', params: { type: 'stone-cottage', footing: 4 }, y: (g) => g - 3 }]);
    expect(findSunk(w).filter((p) => p.kind === 'sunk').map((p) => p.id)).not.toContain('on-footing');
  });

  it('finds a house hanging over a drop on one side', () => {
    const w = world([{ id: 'perched', generator: 'furn-dwelling', params: { type: 'stone-cottage' }, y: (g) => g + 3 }]);
    const f = sunkFindings(w).find((x) => x.entities.includes('perched'));
    expect(f?.code).toBe('over_edge');
  });

  it('has nothing to check without terrain', () => {
    expect(findSunk(createWorld())).toEqual([]);
  });

  // The canyon's floor (x within a few metres of 0) is flat: a rock on it is on level ground.
  const lay = (pieces: Array<Record<string, unknown>>): WorldDoc => {
    const base = world([]);
    const out = applyPatches(base, pieces.map((entity) => ({ op: 'add', entity })) as never);
    expect(out.errors).toEqual([]);
    return out.world;
  };
  const floor = worldGround(world([]));
  const rock = (id: string, z: number, lift: number, extra: Record<string, unknown> = {}, gen = 'boulder', size = 2): Record<string, unknown> => ({
    id,
    shape: { kind: 'procedural', generator: gen, params: { size } },
    transform: { position: [0, floor(0, z) + lift, z] },
    ...extra,
  });

  it('finds a boulder and a bush in the air, and leaves grounded or tagged ones alone', () => {
    const w = lay([rock('high-rock', -40, 3), rock('air-bush', -20, 6, {}, 'shrub', 1.2), rock('set-rock', 0, -0.2), rock('sky-rock', 20, 6, { tags: ['floating'] })]);
    const ids = findAfloat(w).map((p) => p.id);
    expect(ids).toContain('high-rock');
    expect(ids).toContain('air-bush');
    expect(ids).not.toContain('set-rock');
    expect(ids).not.toContain('sky-rock');
    expect(afloatFindings(w).find((f) => f.entities.includes('high-rock'))?.code).toBe('afloat');
  });

  it('measures every instance of a scatter layer, and a layer laid out at one height over the ground', () => {
    const w = lay([
      // Hand-placed points: two on the floor, two four metres up.
      { id: 'rocks', shape: { kind: 'scatter', of: { kind: 'procedural', generator: 'boulder', params: { size: 1.5 } }, count: 4, area: [1, 1], points: [[0, floor(0, -30), -30], [0, floor(0, -20), -20], [0, floor(0, -10) + 4, -10], [0, floor(0, 0) + 4, 0]] } },
      // Laid out when the world loads: every bush at the layer's height, twelve metres over the floor of its area.
      { id: 'row', shape: { kind: 'scatter', of: { kind: 'procedural', generator: 'shrub', params: { size: 1.4 } }, count: 30, area: [2, 30] }, transform: { position: [0, floor(0, 30) + 12, 30] } },
    ]);
    const found = findAfloat(w);
    const rocks = found.find((p) => p.id === 'rocks');
    expect(rocks?.sunk).toBe(2);
    expect(rocks?.of).toBe(4);
    expect(found.map((p) => p.id)).toContain('row');
  });

  it('counts a boulder on a block, or set into a higher block, as carried', () => {
    const y = floor(0, 0) + 8;
    const w = lay([
      { id: 'deck', shape: { kind: 'primitive', primitive: 'box', size: [6, 1, 6] }, transform: { position: [0, y - 0.5, 0] } },
      rock('on-deck', 0, 8),
      { id: 'block', shape: { kind: 'primitive', primitive: 'box', size: [6, 20, 6] }, transform: { position: [0, floor(0, -30) + 10, -30] } },
      rock('in-block', -30, 6, {}, 'shrub', 1.2),
    ]);
    const ids = findAfloat(w).map((p) => p.id);
    expect(ids).not.toContain('on-deck');
    expect(ids).not.toContain('in-block');
  });
});
