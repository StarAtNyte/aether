import { applyPatches, createWorld, streamCourse, type WorldDoc } from '@aether/core';
import { describe, expect, it } from 'vitest';
import { forestCounts, landPatches, LandInput, landSize, worldGround } from '../src/land';
import { executeTool, type ExecutorContext } from '../src/executor';
import { realisticWorld } from '../src/providers/mock/realistic';
import { MemoryHost } from './helpers';

function apply(world: WorldDoc, input: unknown): WorldDoc {
  const { patches } = landPatches(world, LandInput.parse(input));
  const out = applyPatches(world, patches);
  expect(out.errors).toEqual([]);
  return out.world;
}

const roots = (w: WorldDoc) => Object.values(w.entities).filter((e) => !e.parent);

describe('shape_land sizing', () => {
  const parse = (i: unknown) => LandInput.parse(i) as Extract<LandInput, { op: 'land' }>;
  it('sizes the land to the plot unless a size is stated', () => {
    expect(landSize(parse({ op: 'land', kind: 'forest', plot: { radius: 18 } }))).toBe(140);
    expect(landSize(parse({ op: 'land', kind: 'meadow', plot: { radius: 60 } }))).toBe(420);
    expect(landSize(parse({ op: 'land', kind: 'meadow', plot: { radius: 200 } }))).toBe(520);
    expect(landSize(parse({ op: 'land', kind: 'forest', size: 90 }))).toBe(90);
  });
  it('a camp clearing is a small land with a thick forest and trails that keep out of the stream', () => {
    const w = apply(createWorld(), { op: 'land', kind: 'forest', plot: { x: 0, z: 0, radius: 16 }, stream: { z: -30, half: 2 } });
    const terrain = roots(w).find((e) => e.shape.kind === 'procedural' && e.shape.generator === 'terrain');
    const size = (terrain?.shape as unknown as { params: { size: number } }).params.size;
    expect(size).toBeLessThanOrEqual(150);
    const trails = roots(w).filter((e) => e.tags.includes('trail'));
    expect(trails.length).toBeGreaterThanOrEqual(1);
    const trees = roots(w).filter((e) => e.shape.kind === 'scatter' && e.shape.of.kind === 'procedural' && e.shape.of.generator === 'tree-spruce');
    const n = trees.reduce((s, e) => s + (e.shape.kind === 'scatter' ? e.shape.count : 0), 0);
    expect(n / ((size * size) / 10_000)).toBeGreaterThan(20);
  });
  it('forest counts follow the area', () => {
    expect(forestCounts(140).conifers).toBeLessThan(forestCounts(420).conifers);
    expect(forestCounts(800).conifers).toBeLessThanOrEqual(400);
  });
});

describe('shape_land', () => {
  it('builds a terrain with a level plot, a stream with water, woods and ground cover, and turns the flat plane off', () => {
    const w = apply(createWorld(), { op: 'land', kind: 'forest', plot: { x: 0, z: 0, radius: 18 }, stream: { z: -20, half: 2.5 } });
    expect(w.environment.ground).toBeNull();
    const terrain = roots(w).find((e) => e.shape.kind === 'procedural' && e.shape.generator === 'terrain');
    expect(terrain?.tags).toContain('land');
    expect(roots(w).some((e) => e.tags.includes('river') && e.material?.preset === 'water')).toBe(true);
    const gens = roots(w).flatMap((e) => (e.shape.kind === 'scatter' && e.shape.of.kind === 'procedural' ? [e.shape.of.generator] : []));
    for (const g of ['tree-spruce', 'shrub', 'meadow-grass']) expect(gens).toContain(g);
    // The plot is level at y = 0 and the stream bed lies below it.
    const h = worldGround(w);
    expect(Math.abs(h(0, 0))).toBeLessThan(0.05);
    expect(Math.abs(h(6, 5))).toBeLessThan(0.05);
    expect(h(0, streamCourse(0, -20, 5))).toBeLessThan(-0.6);
  });

  it('replaces the land it built before instead of stacking a second one', () => {
    const w1 = apply(createWorld(), { op: 'land', kind: 'meadow' });
    const w2 = apply(w1, { op: 'land', kind: 'snow', relief: 30 });
    expect(roots(w2).filter((e) => e.shape.kind === 'procedural' && e.shape.generator === 'terrain')).toHaveLength(1);
  });

  it('builds a canyon with its floor at y = 0', () => {
    const w = apply(createWorld(), { op: 'land', kind: 'canyon', size: 400, relief: 40 });
    const h = worldGround(w);
    expect(Math.abs(h(0, 0))).toBeLessThan(0.05);
    expect(h(150, 0)).toBeGreaterThan(10);
  });

  it('drapes a path over the terrain as one mesh following the ground', () => {
    const w1 = apply(createWorld(), { op: 'land', kind: 'meadow', plot: { x: 0, z: 0, radius: 10 }, relief: 60 });
    const { patches, summary } = landPatches(w1, LandInput.parse({ op: 'path', points: [[0, 0], [0, 80], [40, 120]], width: 2, surface: 'gravel' }));
    expect(summary).toContain('gravel path');
    const mesh = patches.find((p) => p.op === 'setMesh');
    expect(mesh).toBeDefined();
    const out = applyPatches(w1, patches);
    expect(out.errors).toEqual([]);
  });

  it('rejects malformed input', () => {
    expect(LandInput.safeParse({ op: 'path', points: [[0, 0]] }).success).toBe(false);
    expect(LandInput.safeParse({ op: 'land', size: 5000 }).success).toBe(false);
    expect(LandInput.safeParse({ op: 'land', stream: { z: 0, half: 99 } }).success).toBe(false);
  });

  it('runs as a tool through the executor', async () => {
    const host = new MemoryHost();
    const ctx = { host, provider: {} as never, coderSystem: '', builtinGenerators: new Set<string>(), usage: { inputTokens: 0, outputTokens: 0 } } as unknown as ExecutorContext;
    const out = await executeTool(ctx, 'shape_land', { op: 'land', kind: 'meadow' });
    expect(out.isError).toBe(false);
    expect(out.edited).toBe(true);
    expect(out.content).toContain('Built the land');
  });
});

describe('realistic exchange on apply_patches', () => {
  it('builds the realistic stand-ins for low-poly nature unless a stylised look is asked for', async () => {
    const host = new MemoryHost();
    const base = { host, provider: {} as never, coderSystem: '', builtinGenerators: new Set<string>(), usage: { inputTokens: 0, outputTokens: 0 } };
    const patches = [{ op: 'add', entity: { id: 'pines', shape: { kind: 'scatter', of: { kind: 'procedural', generator: 'tree-pine', params: { height: 8 } }, count: 10, area: [20, 20] } } }];
    const out = await executeTool({ ...base, realistic: true } as unknown as ExecutorContext, 'apply_patches', { patches });
    expect(out.content).toContain('realistic generators');
    const e = host.world.entities['pines'];
    expect(e?.shape.kind === 'scatter' && e.shape.of.kind === 'procedural' && e.shape.of.generator).toBe('tree-spruce');
    expect(realisticWorld('a low-poly forest', createWorld())).toBe(false);
    expect(realisticWorld('a forest', createWorld())).toBe(true);
  });
});

describe('shape_land row', () => {
  it('strings one instanced scatter along a polyline, each instance on the ground', () => {
    const w1 = apply(createWorld(), { op: 'land', kind: 'meadow', plot: { x: 0, z: 0, radius: 10 }, relief: 40 });
    const w2 = apply(w1, { op: 'row', points: [[0, 0], [0, 40], [30, 60]], of: 'tree-oak', spacing: 5 });
    const row = Object.values(w2.entities).find((e) => e.tags.includes('row'));
    expect(row?.shape.kind).toBe('scatter');
    if (row?.shape.kind !== 'scatter') throw new Error('not scatter');
    const pts = row.shape.points ?? [];
    expect(pts.length).toBeGreaterThanOrEqual(10);
    const h = worldGround(w2);
    for (const [x, y, z] of pts) expect(Math.abs(y - h(x, z))).toBeLessThan(0.02);
    // The instances stay near the line (jitter is a fraction of the spacing).
    for (const [x, , z] of pts) expect(z >= -3 && z <= 63 && x >= -3 && x <= 33).toBe(true);
  });

  it('puts both sides of the line when offset is set, and refuses unknown generators and runaway counts', () => {
    const one = landPatches(createWorld(), LandInput.parse({ op: 'row', points: [[0, 0], [0, 20]], of: 'bush', spacing: 5 }));
    const two = landPatches(createWorld(), LandInput.parse({ op: 'row', points: [[0, 0], [0, 20]], of: 'bush', spacing: 5, sides: 'both', offset: 3 }));
    const count = (r: ReturnType<typeof landPatches>): number => {
      const add = r.patches.find((p) => p.op === 'add');
      const shape = add && add.op === 'add' ? add.entity.shape : undefined;
      return shape && shape.kind === 'scatter' ? (shape.points ?? []).length : 0;
    };
    expect(count(two)).toBe(count(one) * 2);
    const bad = landPatches(createWorld(), LandInput.parse({ op: 'row', points: [[0, 0], [0, 20]], of: 'no-such-thing' }));
    expect(bad.refused).toBe(true);
    const huge = landPatches(createWorld(), LandInput.parse({ op: 'row', points: [[0, 0], [0, 2000]], of: 'bush', spacing: 0.25 }));
    expect(huge.refused).toBe(true);
  });
});

describe('inspect groups', () => {
  it('reads a row layer and flags overlapping pairs and floating instances', async () => {
    const host = new MemoryHost();
    const ctx = { host, provider: {} as never, coderSystem: '', builtinGenerators: new Set<string>(), usage: { inputTokens: 0, outputTokens: 0 } } as unknown as ExecutorContext;
    await executeTool(ctx, 'shape_land', { op: 'row', points: [[0, 0], [0, 30]], of: 'tree-oak', spacing: 5 });
    const ok = await executeTool(ctx, 'inspect', { groups: true });
    expect(ok.isError).toBe(false);
    expect(ok.content).toContain('tree-oak');
    expect(ok.content).toContain('0 pairs closer');
    // A tight, floating run of three separate trees.
    const adds = [0, 1, 2].map((i) => ({ op: 'add', entity: { id: `t${i}`, shape: { kind: 'procedural', generator: 'tree-pine' }, transform: { position: [20 + i * 0.3, 2, 5] } } }));
    host.applyPatches(adds, 'trees');
    const bad = await executeTool(ctx, 'inspect', { groups: true });
    expect(bad.content).toMatch(/tree-pine x3 as separate entities/);
    expect(bad.content).toMatch(/[1-9]\d* pairs? closer than 0\.6/);
    expect(bad.content).toContain('off the ground');
  });
});
