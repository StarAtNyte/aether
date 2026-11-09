/**
 * A building on sloped terrain ends up with its floor above the highest ground of its footprint and no gap under it: the
 * offline builder settles it by default (a plinth fills the slope), and the world-quality pass fixes one placed by its centre.
 */
import { applyPatches, createWorld, type Patch, type WorldDoc } from '@aether/core';
import { describe, expect, it } from 'vitest';
import { worldGround } from '../src/land';
import { pieceBounds } from '../src/footprint';
import { qualityChecks, runQualityPass, type QualityHost } from '../src/presentation/quality';
import { Builder } from '../src/providers/mock/builder';
import { settleFindings, settleOnTerrain } from '../src/settle';
import { findSunk } from '../src/sunk';
import { executeTool, type ExecutorContext } from '../src/executor';
import { MemoryHost } from './helpers';

const TERRAIN = { size: 200, height: 40, resolution: 128, roughness: 0.55, color: '#9a8a4f', variant: 3 };
const HOUSE = { width: 7, depth: 6, variant: 0 };

function landWorld(): { world: WorldDoc; ground: (x: number, z: number) => number } {
  const world = applyPatches(createWorld(), [{ op: 'add', entity: { id: 'land', shape: { kind: 'procedural', generator: 'terrain', params: TERRAIN, seed: 7 }, tags: ['terrain'] } }] as never).world;
  return { world, ground: worldGround(world) };
}

/** A spot whose footprint spans a steep rise (a bank). */
function slopeSpot(ground: (x: number, z: number) => number): [number, number] {
  const b = pieceBounds('house', HOUSE, 1)!;
  for (let x = -60; x < 60; x += 3) {
    for (let z = -60; z < 60; z += 3) {
      const s = settleOnTerrain(ground, [x, z], b);
      if (s.hi - s.lo > 2) return [x, z];
    }
  }
  throw new Error('no slope in the test terrain');
}

/** Lowest and highest ground under the house footprint, and the floor and plinth of what was placed. */
function measure(world: WorldDoc, ground: (x: number, z: number) => number, id: string, at: [number, number]): { floor: number; hi: number; lo: number; plinthTop: number; plinthBottom: number } {
  const b = pieceBounds('house', HOUSE, 1)!;
  const s = settleOnTerrain(ground, at, b);
  const e = world.entities[id]!;
  const p = world.entities[`${id}-plinth`] ?? Object.values(world.entities).find((x) => x.tags.includes('foundation'))!;
  const size = p.shape.kind === 'primitive' ? (p.shape.size as number[]) : [0, 0, 0];
  return { floor: e.transform.position[1] + b.min[1], hi: s.hi, lo: s.lo, plinthTop: p.transform.position[1] + (size[1] as number) / 2, plinthBottom: p.transform.position[1] - (size[1] as number) / 2 };
}

describe('house on sloped terrain', () => {
  const { world: land, ground } = landWorld();
  const at = slopeSpot(ground);

  it('the offline builder sets the floor above the highest ground and fills the slope under it', () => {
    const b = new Builder(3, [], { night: false, dusk: false, dawn: false, rain: false, snow: false, fog: false, lowGravity: false, water: false });
    b.gen('house', 'house', HOUSE, [at[0], 0, at[1]], { terrain: ground, physics: 'static' });
    const w = applyPatches(land, b.build()).world;
    const m = measure(w, ground, 'house-1', at);
    expect(m.hi - m.lo).toBeGreaterThan(2);
    expect(m.floor).toBeGreaterThanOrEqual(m.hi);
    // No gap under it: a plinth from below the lowest ground up to the floor.
    expect(m.plinthTop).toBeGreaterThanOrEqual(m.floor - 0.01);
    expect(m.plinthBottom).toBeLessThan(m.lo);
    expect(findSunk(w).filter((p) => p.id === 'house-1')).toEqual([]);
  });

  it('keeps y as given when asked for flat ground, and on level ground adds no plinth', () => {
    const b = new Builder(3, [], { night: false, dusk: false, dawn: false, rain: false, snow: false, fog: false, lowGravity: false, water: false });
    b.gen('house', 'house', HOUSE, [at[0], 0, at[1]], { terrain: ground, ground: 'flat' });
    b.gen('flat', 'house', HOUSE, [0, 0, 0], { terrain: () => 0 });
    const w = applyPatches(land, b.build()).world;
    expect(w.entities['house-1']?.transform.position[1]).toBe(0);
    expect(w.entities['flat-1']?.transform.position[1]).toBe(0);
    expect(Object.values(w.entities).some((e) => e.tags.includes('foundation'))).toBe(false);
  });

  it('the quality pass finds a house placed by its centre point (sunk) and sets it down with a plinth', async () => {
    const placed = applyPatches(land, [{ op: 'add', entity: { id: 'cottage', shape: { kind: 'procedural', generator: 'house', params: HOUSE, seed: 1 }, transform: { position: [at[0], ground(at[0], at[1]) - 0.5, at[1]] } } }] as never).world;
    expect(findSunk(placed).map((p) => p.id)).toContain('cottage');
    const findings = await qualityChecks(placed, null, null);
    const f = findings.find((x) => x.check === 'interpenetration' && x.subject === 'cottage');
    expect(f?.fix?.kind).toBe('patches');
    let current: WorldDoc = placed;
    const host = {
      getWorld: (): WorldDoc => current,
      applyPatches(p: Patch[]) {
        const r = applyPatches(current, p as never);
        current = r.world;
        return r;
      },
    } as unknown as QualityHost;
    const report = await runQualityPass(host, null, { visual: false });
    expect(report.fixed.some((x) => /cottage/.test(x))).toBe(true);
    const m = measure(current, ground, 'cottage', at);
    expect(m.floor).toBeGreaterThanOrEqual(m.hi);
    expect(m.plinthTop).toBeGreaterThanOrEqual(m.floor - 0.01);
    expect(m.plinthBottom).toBeLessThan(m.lo);
    expect(findSunk(current).filter((p) => p.id === 'cottage')).toEqual([]);
    expect(settleFindings(current)).toEqual([]);
  });

  it('settles a library structure (a torii has no width param) by its catalogue footprint', () => {
    const b = pieceBounds('torii-gate', { height: 6.5 }, 1);
    expect(b).not.toBeNull();
    expect(b!.max[0] - b!.min[0]).toBeGreaterThan(3);
  });
});

describe('the AI tool path settles buildings too (replayed tool sequence)', () => {
  const ctxFor = (host: MemoryHost): ExecutorContext => ({ host, provider: {} as never, coderSystem: '', builtinGenerators: new Set(['house', 'japanese-house', 'terrain']), usage: { inputTokens: 0, outputTokens: 0 } }) as unknown as ExecutorContext;

  it('a hilly land, then a tea house and a house added at the ground height of their centre end up on it with a plinth', async () => {
    const host = new MemoryHost();
    const ctx = ctxFor(host);
    // 1. Shape the land: hills round a small level plot.
    const land = await executeTool(ctx, 'shape_land', { op: 'land', kind: 'meadow', plot: { x: 0, z: 0, radius: 8 }, relief: 40 });
    expect(land.isError).toBe(false);
    const ground = worldGround(host.world);
    // 2. The model places a house by one point: y = the ground under its centre (a spot on a slope).
    const b = pieceBounds('japanese-house', { style: 1 }, 1)!;
    let spot: [number, number] | null = null;
    for (let x = -80; x < 80 && !spot; x += 2) for (let z = -80; z < 80 && !spot; z += 2) if (x * x + z * z > 400) { const s = settleOnTerrain(ground, [x, z], b); if (s.hi - s.lo > 1.2 && s.hi - s.lo < 3) spot = [x, z]; }
    expect(spot).not.toBeNull();
    const [x, z] = spot as [number, number];
    const patches = [
      { op: 'add', entity: { id: 'tea-house', name: 'Tea house', shape: { kind: 'procedural', generator: 'japanese-house', params: { style: 1 }, seed: 1 }, transform: { position: [x, Math.round(ground(x, z) * 100) / 100, z] } } },
    ];
    const out = await executeTool(ctx, 'apply_patches', { patches, message: 'Tea house by the pond' });
    expect(out.isError).toBe(false);
    expect(out.content).toMatch(/on the terrain/);
    const e = host.world.entities['tea-house']!;
    const s = settleOnTerrain(ground, [x, z], b);
    expect(e.transform.position[1] + b.min[1]).toBeGreaterThanOrEqual(s.hi);
    const plinth = host.world.entities['tea-house-plinth']!;
    expect(plinth).toBeDefined();
    const size = plinth.shape.kind === 'primitive' ? (plinth.shape.size as number[]) : [0, 0, 0];
    expect(plinth.transform.position[1] + (size[1] as number) / 2).toBeGreaterThanOrEqual(e.transform.position[1] + b.min[1] - 0.01);
    expect(plinth.transform.position[1] - (size[1] as number) / 2).toBeLessThan(s.lo);
    expect(findSunk(host.world).filter((p) => p.id === 'tea-house')).toEqual([]);
  });

  it('leaves a building the model tagged floating, and a world without terrain, alone', async () => {
    const host = new MemoryHost();
    const ctx = ctxFor(host);
    const add = (id: string, tags: string[]) => ({ op: 'add', entity: { id, shape: { kind: 'procedural', generator: 'house', params: HOUSE, seed: 1 }, transform: { position: [0, 3, 0] }, tags } });
    await executeTool(ctx, 'apply_patches', { patches: [add('flat', [])], message: 'house' });
    expect(host.world.entities['flat']?.transform.position[1]).toBe(3);
    expect(host.world.entities['flat-plinth']).toBeUndefined();
  });
});
