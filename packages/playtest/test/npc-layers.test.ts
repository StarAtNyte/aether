/**
 * Layered NPC navigation, unit by unit, on compiled houses: a grid per floor, stairs as links that follow the stair's
 * walking line with the feet on the treads, and routes across floors (which stairs, which way), deterministic and
 * allocation-free.
 */
import { applyArchOps, fitStair, parsePlan, StairParams, stairWalkLine, type PlanStair } from '@aether/arch';
import { applyPatches, createWorld, type EntityInput, type WorldDoc } from '@aether/core';
import { analyzeNpcs, NavLayers, NavRoute, pointAlong, stairLinks, type BoundsProvider, type LayerPoint } from '@aether/logic';
import { entityColliderBounds, entityWorldBounds } from '@aether/physics';
import { describe, expect, it } from 'vitest';
import { describeSites, probeAllocations } from '../../../tests/unit/alloc-probe';

/** Three floors: a hall and living room, a landing and bedroom, an attic room; a stair from each floor to the next. */
function plan(stairs0: PlanStair[], stairs1: PlanStair[]): Record<string, unknown> {
  const floor = (id: string, type: string) => [
    { id: `${id}a`, type: 'hall', rect: [0, 0, 8, 8] },
    { id: `${id}b`, type, rect: [8, 0, 14, 8] },
  ];
  return {
    id: 'h',
    style: 'modern',
    levels: [
      { height: 3, rooms: floor('g', 'living'), doors: [{ between: ['gb', 'outside'], side: 'south', main: true }, { between: ['ga', 'gb'], kind: 'opening', width: 1.4, at: 0.5 }], stairs: stairs0 },
      { height: 3, rooms: floor('u', 'bedroom'), doors: [{ between: ['ua', 'ub'], kind: 'opening', width: 1.4, at: 0.5 }], stairs: stairs1 },
      { height: 3, rooms: floor('t', 'office'), doors: [{ between: ['ta', 'tb'], kind: 'opening', width: 1.4, at: 0.5 }] },
    ],
  };
}

function threeFloors(): WorldDoc {
  const p0 = parsePlan(plan([], []));
  const s0 = fitStair(p0, 0, { room: 'ga', shape: 'l' });
  if (!s0.ok) throw new Error('no stair 0');
  const p1 = parsePlan(plan([s0.stair], []));
  const s1 = fitStair(p1, 1, { room: 'ua', shape: 'straight', others: [] });
  if (!s1.ok) throw new Error('no stair 1');
  const built = applyArchOps(createWorld(), [{ op: 'create_building', plan: plan([s0.stair], [s1.stair]), exactStairs: true }]);
  expect(built.errors).toEqual([]);
  return built.target;
}

function bounds(w: WorldDoc): BoundsProvider {
  return { getBounds: (id) => entityWorldBounds(w, id) ?? undefined, getColliderBounds: (id) => entityColliderBounds(w, id) };
}

const POINTS: LayerPoint[] = [
  { x: 11, y: 0.15, z: 4 },
  { x: 11, y: 3.15, z: 4 },
  { x: 11, y: 6.15, z: 4 },
];

describe('layered NPC navigation', () => {
  it('turns every stair into a link along its walking line, feet on the treads, bottom floor to top floor', () => {
    const w = threeFloors();
    const links = stairLinks(w);
    expect(links.length).toBe(2);
    for (const l of links) {
      const e = w.entities[l.id];
      if (!e || e.shape.kind !== 'procedural') throw new Error('no stair');
      const sp = StairParams.parse(e.shape.params);
      // From the floor before the first riser to the floor beyond the top step, never going down.
      expect(l.line[1]).toBeCloseTo(l.y0, 5);
      expect(l.line[(l.n - 1) * 3 + 1]).toBeCloseTo(l.y1, 5);
      for (let i = 1; i < l.n; i++) expect(l.line[i * 3 + 1] as number).toBeGreaterThanOrEqual((l.line[i * 3 - 2] as number) - 1e-6);
      // As long as the walking line in plan, with its turns.
      const raw = stairWalkLine(sp);
      let len = 0;
      for (let k = 1; k < raw.length; k++) len += Math.hypot((raw[k] as number[])[0] as number - ((raw[k - 1] as number[])[0] as number), (raw[k] as number[])[2] as number - ((raw[k - 1] as number[])[2] as number));
      expect(l.length).toBeCloseTo(len, 3);
      // Halfway along, the feet are half a storey up (within a riser).
      const pt = new Float32Array(5);
      pointAlong(l, l.length / 2, 1, pt);
      expect(Math.abs((pt[1] as number) - (l.y0 + l.y1) / 2)).toBeLessThan(0.45);
      // Going down measures from the top.
      pointAlong(l, 0, -1, pt);
      expect(pt[1]).toBeCloseTo(l.y1, 5);
    }
  });

  it('builds a grid per floor and routes across them: up one stair, up two, down, or none on the same floor', () => {
    const w = threeFloors();
    const layers = NavLayers.build(w, { radius: 0.3, height: 1.8, points: POINTS }, bounds(w));
    if (!layers) throw new Error('no layers');
    expect(layers.heights.map((h) => Math.round(h * 100) / 100)).toEqual([0.15, 3.15, 6.15]);
    expect(Array.from(layers.lower)).toEqual([0, 1]);
    expect(Array.from(layers.upper)).toEqual([1, 2]);
    // The stairwell upstairs is not floor.
    const l0 = layers.links[0];
    if (!l0) throw new Error('no link');
    const mid = new Float32Array(5);
    pointAlong(l0, l0.length * 0.5, 1, mid);
    expect(layers.grids[1]?.walkable(mid[0] as number, mid[2] as number)).toBe(false);
    const r = new NavRoute();
    expect(layers.route(0, 11, 4, 0, 12, 5, r)).toBe(true);
    expect(r.n).toBe(0);
    expect(layers.route(0, 11, 4, 1, 11, 4, r)).toBe(true);
    expect(Array.from(r.steps.slice(0, r.n))).toEqual([1]);
    expect(layers.route(0, 11, 4, 2, 11, 4, r)).toBe(true);
    expect(Array.from(r.steps.slice(0, r.n))).toEqual([1, 2]);
    expect(layers.route(2, 11, 4, 0, 11, 4, r)).toBe(true);
    expect(Array.from(r.steps.slice(0, r.n))).toEqual([-2, -1]);
    // Nowhere on the floor above (out past the building's walls) cannot be reached.
    expect(layers.route(0, 11, 4, 1, 40, 4, r)).toBe(false);
    // Levels of points: by the floor under them, a stair's middle by the stair's nearer end.
    expect(layers.levelAt(11, 0.15, 4)).toBe(0);
    expect(layers.levelAt(11, 3.15, 4)).toBe(1);
    expect(layers.levelAt(11, 4.0, 4)).toBe(1);
    const aim = new Float64Array(3);
    pointAlong(l0, l0.length * 0.8, 1, mid);
    layers.aimFor(mid[0] as number, mid[1] as number, mid[2] as number, aim);
    expect(aim[0]).toBe(1);
  });

  it('is deterministic and allocates nothing per route', async () => {
    const w = threeFloors();
    const a = NavLayers.build(w, { radius: 0.3, height: 1.8, points: POINTS }, bounds(w));
    const b = NavLayers.build(w, { radius: 0.3, height: 1.8, points: POINTS }, bounds(w));
    if (!a || !b) throw new Error('no layers');
    for (let i = 0; i < a.grids.length; i++) {
      expect(Array.from(a.grids[i]?.blocked ?? [])).toEqual(Array.from(b.grids[i]?.blocked ?? []));
    }
    const r = new NavRoute();
    let k = 0;
    const res = await probeAllocations(
      () => {
        k++;
        a.route(k % 3, 11, 4, (k + 1) % 3, 12, 5, r);
        a.levelAt(11, (k % 3) * 3 + 0.15, 4);
      },
      { iterations: 3000, warmup: 2000, match: /packages\/logic\/src\/npc\// },
    );
    expect(res.bytesPerIteration, describeSites(res)).toBeLessThan(256);
  }, 120_000);

  it('the NPC check reads routines across floors: a stop upstairs is reachable by the stair, one in a wall is not', () => {
    const w = threeFloors();
    const walker = {
      id: 'walker',
      name: 'Walker',
      tags: ['npc'],
      transform: { position: [11, 1.02, 4] },
      shape: { kind: 'primitive', primitive: 'capsule', size: [0.56, 1.7, 0.56] },
      physics: { body: 'kinematic' },
      npc: { role: 'resident', faction: 'household', radius: 0.3, wander: 0.4, routine: [{ at: [11, 0.15, 4], stay: 20 }, { at: [11, 6.15, 4], stay: 20 }] },
    } as unknown as EntityInput;
    const withWalker = (extra: Array<[number, number, number]>): WorldDoc => {
      const npc = { ...(walker.npc as Record<string, unknown>), routine: [...((walker.npc as { routine: unknown[] }).routine), ...extra.map((at) => ({ at, stay: 20 }))] };
      return applyPatches(w, [{ op: 'add', entity: { ...walker, npc } as EntityInput }]).world;
    };
    const good = withWalker([]);
    const ok = analyzeNpcs(good, { bounds: bounds(good) });
    expect(ok.errors).toEqual([]);
    const off = withWalker([[40, 3.15, 4]]);
    const bad = analyzeNpcs(off, { bounds: bounds(off) });
    expect(bad.errors.join(' ')).toMatch(/routine stop #2/);
  });
});
