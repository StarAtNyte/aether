/**
 * A building on sloped terrain ends up with its floor above the highest ground of its footprint and no gap under it, on a
 * modest foundation sized from the building (not a terrace): a stepped stone base on a gentle fall, stone piers on a steep
 * one. The offline builder settles it by default, the quality pass fixes one placed by its centre, and the AI tool path
 * (a replayed tool sequence) settles what a tool adds.
 */
import { applyPatches, createWorld, type Entity, type Patch, type WorldDoc } from '@aether/core';
import { describe, expect, it } from 'vitest';
import { worldGround } from '../src/land';
import { pieceBounds } from '../src/footprint';
import { qualityChecks, runQualityPass, type QualityHost } from '../src/presentation/quality';
import { Builder } from '../src/providers/mock/builder';
import { settleFindings, settleOnTerrain } from '../src/settle';
import { settleBounds, STILT_FALL } from '../src/settle-core';
import { findSunk } from '../src/sunk';
import { executeTool, type ExecutorContext } from '../src/executor';
import { MemoryHost } from './helpers';

const TERRAIN = { size: 200, height: 40, resolution: 128, roughness: 0.55, color: '#9a8a4f', variant: 3 };
const HOUSE = { width: 7, depth: 6, variant: 0 };
/** The most a foundation may reach past the building's footprint on a side (m): the lower tier's margin plus a hand. */
const MAX_OVERHANG = 0.7;

function landWorld(): { world: WorldDoc; ground: (x: number, z: number) => number } {
  const world = applyPatches(createWorld(), [{ op: 'add', entity: { id: 'land', shape: { kind: 'procedural', generator: 'terrain', params: TERRAIN, seed: 7 }, tags: ['terrain'] } }] as never).world;
  return { world, ground: worldGround(world) };
}

/** A spot whose footprint falls between `min` and `max` metres. */
function fallSpot(ground: (x: number, z: number) => number, generator: string, params: Record<string, never>, min: number, max: number): [number, number] {
  const b = settleBounds(generator, params, 1)!;
  for (let x = -70; x < 70; x += 2) {
    for (let z = -70; z < 70; z += 2) {
      const s = settleOnTerrain(ground, [x, z], b);
      if (s.hi - s.lo > min && s.hi - s.lo < max) return [x, z];
    }
  }
  throw new Error(`no ${min}..${max} m fall in the test terrain`);
}

const foundationOf = (w: WorldDoc, id: string): Entity[] => Object.values(w.entities).filter((e) => e.tags.includes('foundation') && (e.id.startsWith(`${id}-plinth`) || e.id.startsWith('foundation-')));
const sizeOf = (e: Entity): number[] => (e.shape.kind === 'primitive' ? (e.shape.size as number[]) : [0, 0, 0]);

/** The checks every settled building passes: floor above the highest ground, no gap under it, a foundation no wider than the building plus a margin. */
function expectSettled(w: WorldDoc, ground: (x: number, z: number) => number, id: string, generator: string, params: Record<string, never>, at: [number, number]): { piers: number; boxes: number } {
  const b = settleBounds(generator, params, 1)!;
  const s = settleOnTerrain(ground, at, b);
  const e = w.entities[id]!;
  const floor = e.transform.position[1] + b.min[1];
  expect(floor).toBeGreaterThanOrEqual(s.hi - 1e-6);
  const parts = foundationOf(w, id);
  expect(parts.length).toBeGreaterThan(0);
  const fw = b.max[0] - b.min[0];
  const fd = b.max[2] - b.min[2];
  let piers = 0;
  let boxes = 0;
  for (const p of parts) {
    const size = sizeOf(p);
    const top = p.transform.position[1] + (size[1] as number) / 2;
    const bottom = p.transform.position[1] - (size[1] as number) / 2;
    if (p.shape.kind === 'primitive' && p.shape.primitive === 'cylinder') {
      piers++;
      expect(bottom).toBeLessThan(ground(p.transform.position[0], p.transform.position[2]));
      expect(top).toBeGreaterThanOrEqual(floor - 0.01);
    } else {
      boxes++;
      // Never a terrace: the base is a little larger than the building's own footprint, whatever the yaw (the yaw is 0 here).
      expect(size[0] as number).toBeLessThanOrEqual(fw + 2 * MAX_OVERHANG + 1e-6);
      expect(size[2] as number).toBeLessThanOrEqual(fd + 2 * MAX_OVERHANG + 1e-6);
    }
  }
  if (boxes > 0) expect(Math.min(...parts.filter((p) => !(p.shape.kind === 'primitive' && p.shape.primitive === 'cylinder')).map((p) => p.transform.position[1] - sizeOf(p)[1]! / 2))).toBeLessThan(s.lo);
  if (boxes > 0) expect(Math.max(...parts.filter((p) => !(p.shape.kind === 'primitive' && p.shape.primitive === 'cylinder')).map((p) => p.transform.position[1] + sizeOf(p)[1]! / 2))).toBeGreaterThanOrEqual(floor - 0.01);
  return { piers, boxes };
}

describe('house on sloped terrain', () => {
  const { world: land, ground } = landWorld();
  const gentle = fallSpot(ground, 'house', HOUSE as never, 0.6, STILT_FALL - 0.1);
  const steep = fallSpot(ground, 'house', HOUSE as never, STILT_FALL + 0.3, 4);
  const mood = { night: false, dusk: false, dawn: false, rain: false, snow: false, fog: false, lowGravity: false, water: false };

  it('a gentle fall gets a stepped stone base a little larger than the house, with no gap under the floor', () => {
    const b = new Builder(3, [], mood);
    b.gen('house', 'house', HOUSE, [gentle[0], 0, gentle[1]], { terrain: ground, physics: 'static' });
    const w = applyPatches(land, b.build()).world;
    const r = expectSettled(w, ground, 'house-1', 'house', HOUSE as never, gentle);
    expect(r.boxes).toBe(2);
    expect(r.piers).toBe(0);
    expect(findSunk(w).filter((p) => p.id === 'house-1')).toEqual([]);
  });

  it('a steep fall gets stone piers (pilotis), not a retaining wall', () => {
    const b = new Builder(3, [], mood);
    b.gen('house', 'house', HOUSE, [steep[0], 0, steep[1]], { terrain: ground, physics: 'static' });
    const w = applyPatches(land, b.build()).world;
    const r = expectSettled(w, ground, 'house-1', 'house', HOUSE as never, steep);
    expect(r.piers).toBeGreaterThanOrEqual(4);
    expect(r.boxes).toBe(0);
  });

  it('keeps y as given when asked for flat ground, and on level ground adds no foundation', () => {
    const b = new Builder(3, [], mood);
    b.gen('house', 'house', HOUSE, [gentle[0], 0, gentle[1]], { terrain: ground, ground: 'flat' });
    b.gen('flat', 'house', HOUSE, [0, 0, 0], { terrain: () => 0 });
    const w = applyPatches(land, b.build()).world;
    expect(w.entities['house-1']?.transform.position[1]).toBe(0);
    expect(w.entities['flat-1']?.transform.position[1]).toBe(0);
    expect(Object.values(w.entities).some((e) => e.tags.includes('foundation'))).toBe(false);
  });

  it('the quality pass finds a house placed by its centre point (sunk) and sets it down on a modest foundation', async () => {
    const placed = applyPatches(land, [{ op: 'add', entity: { id: 'cottage', shape: { kind: 'procedural', generator: 'house', params: HOUSE, seed: 1 }, transform: { position: [gentle[0], ground(gentle[0], gentle[1]) - 0.5, gentle[1]] } } }] as never).world;
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
    expectSettled(current, ground, 'cottage', 'house', HOUSE as never, gentle);
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
  const ctxFor = (host: MemoryHost): ExecutorContext => ({ host, provider: {} as never, coderSystem: '', builtinGenerators: new Set(['house', 'terrain']), usage: { inputTokens: 0, outputTokens: 0 } }) as unknown as ExecutorContext;

  it('a hilly land, then a house added at the ground height of its centre ends up on it, on a foundation sized from the building', async () => {
    const host = new MemoryHost();
    const ctx = ctxFor(host);
    const land = await executeTool(ctx, 'shape_land', { op: 'land', kind: 'meadow', plot: { x: 0, z: 0, radius: 8 }, relief: 40 });
    expect(land.isError).toBe(false);
    const ground = worldGround(host.world);
    const params = HOUSE;
    const [x, z] = fallSpot(ground, 'house', params as never, 0.6, 3);
    const patches = [{ op: 'add', entity: { id: 'cottage-2', name: 'Cottage', shape: { kind: 'procedural', generator: 'house', params, seed: 1 }, transform: { position: [x, Math.round(ground(x, z) * 100) / 100, z] } } }];
    const out = await executeTool(ctx, 'apply_patches', { patches, message: 'House by the pond' });
    expect(out.isError).toBe(false);
    expect(out.content).toMatch(/on the terrain/);
    expectSettled(host.world, ground, 'cottage-2', 'house', params as never, [x, z]);
    expect(findSunk(host.world).filter((p) => p.id === 'cottage-2')).toEqual([]);
  });

  it('leaves a building on level ground, and a world without terrain, alone', async () => {
    const host = new MemoryHost();
    const ctx = ctxFor(host);
    const add = (id: string) => ({ op: 'add', entity: { id, shape: { kind: 'procedural', generator: 'house', params: HOUSE, seed: 1 }, transform: { position: [0, 3, 0] } } });
    await executeTool(ctx, 'apply_patches', { patches: [add('flat')], message: 'house' });
    expect(host.world.entities['flat']?.transform.position[1]).toBe(3);
    expect(foundationOf(host.world, 'flat')).toEqual([]);
  });
});
