import { applyPatches, createWorld, streamCourse, type WorldDoc } from '@aether/core';
import { describe, expect, it } from 'vitest';
import { landPatches, LandInput, worldGround } from '../src/land';
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
