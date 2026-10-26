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
    expect(found.content).toContain('shape_land {op:"grid" | "along" | "perimeter"');
    expect((await executeTool(ctx, 'find_model', { what: 'painting' })).content).toContain('shape_land {op:"wall"');
    const pew = await executeTool(ctx, 'find_model', { what: 'church pews' });
    expect(pew.content).toContain('furn-pew');
    const case1 = await executeTool(ctx, 'find_model', { what: 'museum display case' });
    expect(case1.content).toContain('furn-vitrine');
  });
});

describe('shape_land wall, along and perimeter', () => {
  const worldPoint = (e: Entity, p: readonly number[]): [number, number] => {
    const a = (e.transform.rotation[1] * Math.PI) / 180;
    return [e.transform.position[0] + (p[0] as number) * Math.cos(a) + (p[2] as number) * Math.sin(a), e.transform.position[2] - (p[0] as number) * Math.sin(a) + (p[2] as number) * Math.cos(a)];
  };
  const all = (w: WorldDoc, tag: string): Entity[] => Object.values(w.entities).filter((x) => x.tags.includes(tag));

  it('hangs N paintings along a wall in one entity per variant, facing into the room, skipping the gaps', () => {
    // A wall along the north side (z = -5) from x = -6 to x = 6: the room is to the south (+Z), so the pieces look south.
    const { world, summary } = apply(createWorld(), { op: 'wall', from: [-6, -5], to: [6, -5], count: 8, y: 1.1, facing: 'south', variants: [{ subject: 'landscape', frame: 'gilt' }, { subject: 'portrait', frame: 'gilt' }] });
    const sets = all(world, 'wall');
    expect(sets.length).toBe(2);
    let n = 0;
    for (const e of sets) {
      if (e.shape.kind !== 'scatter') throw new Error('x');
      n += e.shape.points?.length ?? 0;
      expect(e.transform.rotation[1]).toBeCloseTo(0, 5);
      for (const p of e.shape.points ?? []) {
        const [x, z] = worldPoint(e, p);
        expect(z).toBeCloseTo(-5 + 0.02, 2);
        expect(x).toBeGreaterThan(-6);
        expect(x).toBeLessThan(6);
        expect(p[1]).toBe(1.1);
      }
    }
    expect(n).toBe(8);
    expect(summary).toContain('8 x furn-frame');
    // Default facing is to the left of from -> to: walking east, left is north (-Z): yaw 180.
    const left = apply(createWorld(), { op: 'wall', from: [-6, 5], to: [6, 5], count: 4 });
    expect(all(left.world, 'wall')[0]?.transform.rotation[1]).toBeCloseTo(180, 5);
    const gap = apply(createWorld(), { op: 'wall', from: [0, 0], to: [10, 0], spacing: 1.5, gaps: [[4, 6]], of: 'painting' });
    expect(gap.summary).toContain('skipped over the gaps');
    const g = all(gap.world, 'wall')[0];
    if (!g || g.shape.kind !== 'scatter') throw new Error('x');
    for (const p of g.shape.points ?? []) expect(Math.abs(worldPoint(g, p)[0] - 5)).toBeGreaterThan(0.9);
  });

  it('puts real lights beside the hung pieces, no more than 24', () => {
    const { world, summary } = apply(createWorld(), { op: 'wall', from: [0, 0], to: [40, 0], of: 'furn-sconce', count: 40, y: 2.2, facing: 'south', light: { every: 1, intensity: 0.8 } });
    const lights = Object.values(world.entities).filter((e) => e.light);
    expect(lights.length).toBeGreaterThan(10);
    expect(lights.length).toBeLessThanOrEqual(24);
    expect(lights[0]?.light?.castShadow).toBe(false);
    expect(summary).toContain('real point lights');
  });

  it('puts cases along an axis on the floor', () => {
    const { world } = apply(createWorld(), { op: 'along', from: [0, 0], to: [0, 12], of: 'display case', count: 5, facing: 'east', y: 0 });
    const e = all(world, 'along')[0];
    if (!e || e.shape.kind !== 'scatter') throw new Error('x');
    expect(e.shape.points?.length).toBe(5);
    expect(e.shape.of.kind === 'procedural' && e.shape.of.generator).toBe('furn-vitrine');
    const zs = (e.shape.points ?? []).map((p) => worldPoint(e, p)[1]).sort((a, b) => a - b);
    expect(zs[0]).toBeGreaterThan(0);
    expect(zs[4]).toBeLessThan(12);
  });

  it('seats every table: 14 tables of 4 are 56 seats in a few instanced entities, each looking at its table', () => {
    const at: Array<[number, number]> = Array.from({ length: 14 }, (_, i) => [(i % 5) * 3, Math.floor(i / 5) * 3]);
    const { world, summary } = apply(createWorld(), { op: 'perimeter', at, table: { of: 'furn-table', params: { width: 1.2, depth: 0.8 } }, long: 2 });
    const seats = all(world, 'seats');
    expect(seats.length).toBe(2);
    const n = seats.reduce((a, e) => a + (e.shape.kind === 'scatter' ? (e.shape.points?.length ?? 0) : 0), 0);
    expect(n).toBe(56);
    expect(all(world, 'tables').length).toBe(1);
    expect(summary).toContain('Seated 56');
    // A seat on the +Z side of table 0 looks -Z (yaw 180) and stands 0.4 + 0.18 m from its centre.
    const north = seats.find((e) => Math.abs(e.transform.rotation[1] - 180) < 1);
    if (!north || north.shape.kind !== 'scatter') throw new Error('x');
    const near = (north.shape.points ?? []).map((p) => worldPoint(north, p)).find(([x, z]) => Math.abs(x - 0.3) < 0.01 && z > 0);
    expect(near?.[1]).toBeCloseTo(0.58, 2);
  });

  it('seats round tables around their edge, and refuses unknown pieces', () => {
    const { world } = apply(createWorld(), { op: 'perimeter', at: [[0, 0], [4, 0]], shape: 'round', count: 6, size: [1.2, 1.2], of: 'chair' });
    expect(all(world, 'seats').reduce((a, e) => a + (e.shape.kind === 'scatter' ? (e.shape.points?.length ?? 0) : 0), 0)).toBe(12);
    const r = landPatches(createWorld(), LandInput.parse({ op: 'wall', from: [0, 0], to: [4, 0], of: 'not-a-thing' }));
    expect(r.refused).toBe(true);
  });

  it('puts a cover at every seat and a candle on every table in the same call, on the table top', () => {
    const at: Array<[number, number]> = [[0, 0], [4, 0], [8, 0]];
    const { world, summary } = apply(createWorld(), { op: 'perimeter', at, table: { of: 'furn-table', params: { width: 1.2, depth: 0.8 } }, long: 2, settings: { of: 'place setting' }, centre: { of: 'candle' } });
    const covers = all(world, 'settings');
    const n = covers.reduce((a, e) => a + (e.shape.kind === 'scatter' ? (e.shape.points?.length ?? 0) : 0), 0);
    expect(n).toBe(12);
    for (const e of covers) {
      if (e.shape.kind !== 'scatter') throw new Error('x');
      expect(e.shape.of.kind === 'procedural' && e.shape.of.generator).toBe('furn-place-setting');
      for (const p of e.shape.points ?? []) {
        expect(p[1]).toBeGreaterThan(0.6);
        const [x, z] = worldPoint(e, p);
        // Inside the footprint of one of the tables.
        expect(at.some(([tx, tz]) => Math.abs(x - tx) < 0.62 && Math.abs(z - tz) < 0.42)).toBe(true);
      }
    }
    expect(all(world, 'centres')[0]?.shape.kind === 'scatter' && (all(world, 'centres')[0] as Entity & { shape: { count: number } }).shape.count).toBe(3);
    expect(summary).toContain('12 x furn-place-setting');
  });

  it('puts a label beside every painting and sizes each stanchion rope to the pitch', () => {
    const { world } = apply(createWorld(), { op: 'wall', from: [0, 0], to: [12, 0], count: 4, y: 1.0, facing: 'south', labels: { y: 1.25 } });
    const labels = all(world, 'labels');
    expect(labels.length).toBe(1);
    const lab = labels[0];
    const art = all(world, 'wall').find((e) => !e.tags.includes('labels'));
    if (!lab || lab.shape.kind !== 'scatter' || !art || art.shape.kind !== 'scatter') throw new Error('x');
    expect(lab.shape.points?.length).toBe(4);
    const lx = (lab.shape.points ?? []).map((p) => worldPoint(lab, p)[0]);
    const ax = (art.shape.points ?? []).map((p) => worldPoint(art, p)[0]);
    // Seen from the room (looking north) right is east: each label is east of its picture.
    lx.forEach((x, i) => expect(x).toBeGreaterThan(ax[i] as number));
    const rope = apply(createWorld(), { op: 'along', from: [0, 0], to: [10, 0], of: 'rope stanchion', spacing: 2, y: 0 });
    const post = all(rope.world, 'along')[0];
    if (!post || post.shape.kind !== 'scatter' || post.shape.of.kind !== 'procedural') throw new Error('x');
    expect(post.shape.of.params['span']).toBeCloseTo(2, 1);
  });

  it('places columns on all four walls of a room in one call, facing in', () => {
    const { world, summary } = apply(createWorld(), { op: 'around', rect: [0, 0, 20, 12], of: 'column', spacing: 4, offset: 0.4 });
    const sets = all(world, 'along');
    expect(sets.length).toBe(4);
    for (const e of sets) {
      if (e.shape.kind !== 'scatter') throw new Error('x');
      for (const p of e.shape.points ?? []) {
        const [x, z] = worldPoint(e, p);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(20);
        expect(z).toBeGreaterThanOrEqual(0);
        expect(z).toBeLessThanOrEqual(12);
      }
    }
    expect(summary).toContain('north');
    const north = sets.find((e) => e.id.includes('north'));
    expect(north?.transform.rotation[1]).toBeCloseTo(0, 3);
  });
});
