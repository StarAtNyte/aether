import { applyPatches, createWorld, type Entity, type WorldDoc } from '@aether/core';
import { describe, expect, it } from 'vitest';
import { landPatches, LandInput } from '../src/land';
import { executeTool, type ExecutorContext } from '../src/executor';
import { measureTier, solveTier } from '../src/layout';
import { MemoryHost } from './helpers';

function apply(world: WorldDoc, input: unknown): { world: WorldDoc; summary: string } {
  const r = landPatches(world, LandInput.parse(input));
  expect(r.refused).toBeUndefined();
  const out = applyPatches(world, r.patches);
  expect(out.errors).toEqual([]);
  return { world: out.world, summary: r.summary };
}
const scatterOf = (w: WorldDoc, tag: string): Entity => {
  const e = Object.values(w.entities).find((x) => x.tags.includes(tag));
  if (!e || e.shape.kind !== 'scatter') throw new Error(`no ${tag} scatter`);
  return e;
};

describe('shape_land tier', () => {
  it('builds one stepped floor and one instanced block of seats, each row at its tread height', () => {
    const { world, summary } = apply(createWorld(), { op: 'tier', at: [0, 4], rows: 10, seatsPerRow: 12, facing: 'north', aisles: 1, screenDistance: 5, screenBottom: 1.2 });
    expect(Object.keys(world.entities).length).toBe(3); // floor, seats, step lights
    const seats = scatterOf(world, 'seats');
    if (seats.shape.kind !== 'scatter') throw new Error('x');
    expect(seats.shape.count).toBe(120);
    expect(seats.shape.randomYaw).toBe(false);
    const pts = seats.shape.points ?? [];
    const ys = [...new Set(pts.map((p) => p[1]))].sort((a, b) => a - b);
    expect(ys.length).toBe(10);
    for (let i = 1; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBeGreaterThan(0.1);
    expect(ys[0]).toBeCloseTo(0.04, 2);
    // Looking north (-Z): the entity is turned 180 degrees, the front row stands at `at`, the back rows are further +Z in the world.
    expect(seats.transform.rotation[1]).toBe(180);
    const front = pts.filter((p) => p[1] === ys[0]);
    const worldZ = (p: readonly number[]) => seats.transform.position[2] - (p[2] as number);
    expect(worldZ(front[0]!)).toBeCloseTo(4, 1);
    const back = pts.filter((p) => p[1] === ys[ys.length - 1]);
    expect(worldZ(back[0]!)).toBeGreaterThan(4 + 8);
    expect(summary).toContain('Sightline');
    expect(summary).toContain('120 x furn-cinema-seat');
    // Aisle: no seat in the gap, and the left and right blocks hold 6 each.
    const row0 = front.map((p) => p[0]).sort((a, b) => a - b);
    expect(row0.length).toBe(12);
    const gaps = row0.slice(1).map((x, i) => x - row0[i]!);
    expect(Math.max(...gaps)).toBeGreaterThan(1.1);
  });

  it('solves a riser that clears the head in front, and says when it cannot', () => {
    const ok = solveTier({ rows: 12, rowDepth: 1.05, screenDistance: 5, screenBottom: 1.2, eye: 1.1, clearance: 0.12 });
    expect(ok.capped).toBe(false);
    expect(ok.clearance).toBeGreaterThanOrEqual(0.11);
    const flat = measureTier({ rows: 12, rowDepth: 1.05, screenDistance: 5, screenBottom: 1.2, eye: 1.1, riser: 0, growth: 0 });
    expect(flat.clearance).toBeLessThan(0.05);
    const steep = solveTier({ rows: 40, rowDepth: 0.8, screenDistance: 2, screenBottom: 0.2, eye: 1.1, clearance: 0.12 });
    expect(steep.capped).toBe(true);
    expect(steep.riser).toBeLessThanOrEqual(0.45);
  });

  it('takes a fixed riser, refuses unknown pieces and runaway counts', () => {
    const { world } = apply(createWorld(), { op: 'tier', at: [0, 0], rows: 4, seatsPerRow: 6, riser: 0.2, aisles: 0, stepLights: false });
    const floor = Object.values(world.entities).find((e) => e.tags.includes('tier'));
    expect(floor?.shape.kind === 'procedural' && floor.shape.params['riser']).toBe(0.2);
    expect(landPatches(createWorld(), LandInput.parse({ op: 'tier', at: [0, 0], rows: 4, seatsPerRow: 6, of: 'no-such' })).refused).toBe(true);
    expect(landPatches(createWorld(), LandInput.parse({ op: 'tier', at: [0, 0], rows: 40, seatsPerRow: 100 })).refused).toBe(true);
  });
});

describe('shape_land grid', () => {
  it('lays a block with aisles as one scatter and reports the covered area', () => {
    const { world, summary } = apply(createWorld(), { op: 'grid', at: [10, -4], cols: 8, rows: 5, of: 'furn-pew', params: { length: 2.4 }, aisles: 1, facing: 'east' });
    const e = scatterOf(world, 'grid');
    if (e.shape.kind !== 'scatter') throw new Error('x');
    expect(e.shape.count).toBe(40);
    expect(e.transform.rotation[1]).toBe(90);
    expect(summary).toContain('5 rows x 8 = 40');
    expect(summary).toContain('1 aisle');
    const xs = [...new Set((e.shape.points ?? []).map((p) => p[0]))].sort((a, b) => a - b);
    expect(xs.length).toBe(8);
    expect(Math.max(...xs.slice(1).map((x, i) => x - xs[i]!))).toBeGreaterThan(1.2 + 2.4 * 0.9);
  });

  it('runs through the executor and the parts are placed by name', async () => {
    const host = new MemoryHost();
    const ctx = { host, provider: {} as never, coderSystem: '', builtinGenerators: new Set<string>(), usage: { inputTokens: 0, outputTokens: 0 } } as unknown as ExecutorContext;
    const out = await executeTool(ctx, 'shape_land', { op: 'tier', at: [0, 0], rows: 6, seatsPerRow: 10, facing: 'north' });
    expect(out.isError).toBe(false);
    expect(out.edited).toBe(true);
    expect(Object.keys(host.world.entities).length).toBeGreaterThanOrEqual(2);
    const found = await executeTool(ctx, 'find_model', { what: 'theatre seat' });
    expect(found.content).toContain('furn-cinema-seat');
    expect(found.content).toContain('shape_land {op:"row"|"grid"|"tier"');
    const pew = await executeTool(ctx, 'find_model', { what: 'church pews' });
    expect(pew.content).toContain('furn-pew');
    const case1 = await executeTool(ctx, 'find_model', { what: 'museum display case' });
    expect(case1.content).toContain('furn-vitrine');
  });
});
