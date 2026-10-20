/**
 * Stair fitting: measure a stair against the plan, and find one that fits.
 *
 * A stair on level `li` climbs the storey height of that level (floor to floor) to level `li + 1`. It works only
 * when its whole footprint stands inside one room clear of the walls, there is floor to step on in front of the
 * first riser, it keeps out of the doorways, the stairwell it cuts upstairs lies inside one room there, and its
 * top step arrives on open floor of the level above (what the building check and the walkthrough bot need).
 * `checkStair` returns those problems with numbers; `fitStair` searches the rooms (along their walls, every
 * heading, straight then L then U) for a stair that has none, so a model or the offline planner can ask for
 * "a stair in the hall" and get exact `at` / `heading` values, or a measured reason why no stair fits.
 */
import { compileBuilding } from './compile';
import { bounds, pointInPolygon, pointSegmentDistance, positive, rotateYaw, yawOf, type P2 } from './math2';
import { StairParams } from './params';
import { compassNormal, roomPolygon } from './rooms';
import { stairFootprint, stairLayout, stairRisers } from './stair';
import type { BuildingPlan, Compass, PlanLevel, PlanStair } from './plan';

/** Depth of clear floor a good stair has in front of the first riser and beyond the top step (m); fitting aims for it. */
export const STAIR_LANDING = 0.9;
/** The least clear floor that still works: in front of the first riser (or beside its first treads) and beyond the top step (m). */
export const STAIR_MIN_LANDING = 0.6;
/** Clearance a stair keeps from a doorway centre beyond half the door width (m). */
export const STAIR_DOOR_CLEARANCE = 0.5;

const HEADINGS: readonly Compass[] = ['north', 'east', 'south', 'west'];
const r2 = (n: number): number => Math.round(n * 100) / 100;
const f2 = (n: number): string => r2(n).toFixed(2);

/** Plan-frame geometry of a stair: footprint (the hole upstairs), the floor around its ends. */
export interface StairShape {
  footprint: P2[];
  /** Floor in front of the first riser: the full landing and the least that works. */
  approach: P2[];
  approachMin: P2[];
  /** Floor beside the first treads (left, right): a stair against a wall can be stepped onto from the side. */
  sides: [P2[], P2[]];
  /** Floor beyond the top step on the level above: the full landing and the least that works. */
  arrival: P2[];
  arrivalMin: P2[];
  /** The point the top step leads to (the building check seeds the upper floor here). */
  top: P2;
  risers: number;
  riser: number;
  going: number;
  /** Plan length along the first flight and the size of the footprint's bounding box. */
  run: number;
  size: [number, number];
}

/** Geometry of `stair` climbing `rise` metres. */
export function stairShape(stair: Pick<PlanStair, 'at' | 'heading' | 'shape' | 'width' | 'turn'>, rise: number): StairShape {
  const sp = StairParams.parse({ shape: stair.shape, width: stair.width, rise, turn: stair.turn });
  const n = compassNormal(stair.heading);
  const yaw = Math.round(yawOf(n[0], n[1]) * 100) / 100;
  const toPlan = (q: readonly [number, number]): P2 => {
    const r = rotateYaw(q[0], q[1], yaw);
    return [stair.at[0] + r[0], stair.at[1] + r[1]];
  };
  const local = stairFootprint(sp);
  const { flights } = stairLayout(sp);
  const { count, riser } = stairRisers(sp);
  const last = flights[flights.length - 1];
  const w = sp.width;
  const m = STAIR_MIN_LANDING;
  const box = (x0: number, z0: number, x1: number, z1: number): P2[] => [toPlan([x0, z0]), toPlan([x1, z0]), toPlan([x1, z1]), toPlan([x0, z1])];
  let top: P2 = toPlan([0, 0]);
  let arrival: P2[] = [];
  let arrivalMin: P2[] = [];
  if (last) {
    const run = last.treads * sp.going;
    const ex = last.x + last.dx * run;
    const ez = last.z + last.dz * run;
    // The strip beyond the top step, as wide as the flight (perpendicular to its direction).
    const px = -last.dz;
    const pz = last.dx;
    const strip = (depth: number): P2[] =>
      [
        [ex + px * (w / 2), ez + pz * (w / 2)],
        [ex + last.dx * depth + px * (w / 2), ez + last.dz * depth + pz * (w / 2)],
        [ex + last.dx * depth - px * (w / 2), ez + last.dz * depth - pz * (w / 2)],
        [ex - px * (w / 2), ez - pz * (w / 2)],
      ].map((q) => toPlan(q as [number, number]));
    arrival = strip(STAIR_LANDING);
    arrivalMin = strip(m);
    top = toPlan([ex + last.dx * 0.4, ez + last.dz * 0.4]);
  }
  const fp = local.map(toPlan);
  const [x0, z0, x1, z1] = bounds(local);
  return {
    footprint: fp,
    approach: box(-STAIR_LANDING, -w / 2, 0, w / 2),
    approachMin: box(-m, -w / 2, 0, w / 2),
    sides: [box(0, -w / 2 - m, m, -w / 2), box(0, w / 2, m, w / 2 + m)],
    arrival,
    arrivalMin,
    top,
    risers: count,
    riser,
    going: sp.going,
    run: r2(x1 - x0),
    size: [r2(x1 - x0), r2(z1 - z0)],
  };
}

/** A room outline with the clearance each of its walls needs (half the wall thickness). */
interface RoomRing {
  id: string;
  type: string;
  poly: P2[];
  /** Per edge i (poly[i] → poly[i+1]): the clearance from its centreline. */
  clear: number[];
}

function rings(plan: BuildingPlan, level: PlanLevel): RoomRing[] {
  const indoor = level.rooms.filter((r) => r.type !== 'terrace');
  const polys = indoor.map((r) => positive(roomPolygon(r)));
  return indoor.map((r, i) => {
    const poly = polys[i] as P2[];
    const clear = poly.map((a, k) => {
      const b = poly[(k + 1) % poly.length] as P2;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      // Outward normal of a positive ring (see rooms.roomEdges): another room just outside makes it an interior wall.
      const nx = (b[1] - a[1]) / len;
      const nz = -(b[0] - a[0]) / len;
      const mx = (a[0] + b[0]) / 2 + nx * 0.2;
      const mz = (a[1] + b[1]) / 2 + nz * 0.2;
      const inner = polys.some((p, j) => j !== i && pointInPolygon(mx, mz, p));
      return (inner ? plan.interiorWall.thickness : plan.exteriorWall.thickness) / 2 + 0.01;
    });
    return { id: r.id, type: r.type, poly, clear };
  });
}

/** Points along a polygon's outline (corners and edge midpoints). */
function samples(poly: readonly P2[]): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as P2;
    const b = poly[(i + 1) % poly.length] as P2;
    out.push(a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  }
  return out;
}

/** How far a point is from standing clear inside a ring (0 when it is clear; metres outside or into the wall otherwise). */
function shortfall(p: P2, ring: RoomRing): number {
  const inside = pointInPolygon(p[0], p[1], ring.poly);
  let worst = 0;
  let nearest = Infinity;
  for (let k = 0; k < ring.poly.length; k++) {
    const a = ring.poly[k] as P2;
    const b = ring.poly[(k + 1) % ring.poly.length] as P2;
    const d = pointSegmentDistance(p[0], p[1], a[0], a[1], b[0], b[1]);
    nearest = Math.min(nearest, d);
    if (inside) worst = Math.max(worst, (ring.clear[k] ?? 0) - d);
  }
  return inside ? Math.max(0, worst) : nearest + 0.1;
}

/** The ring holding the most of a polygon (fewest metres out), with that shortfall. */
function bestRing(poly: readonly P2[], rs: readonly RoomRing[]): { ring: RoomRing | null; out: number } {
  const pts = samples(poly);
  let best: RoomRing | null = null;
  let out = Infinity;
  for (const r of rs) {
    let s = 0;
    for (const p of pts) s = Math.max(s, shortfall(p, r));
    if (s < out) {
      out = s;
      best = r;
    }
  }
  return { ring: best, out };
}

function distanceToPolygon(p: P2, poly: readonly P2[]): number {
  if (pointInPolygon(p[0], p[1], poly)) return 0;
  let d = Infinity;
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k] as P2;
    const b = poly[(k + 1) % poly.length] as P2;
    d = Math.min(d, pointSegmentDistance(p[0], p[1], a[0], a[1], b[0], b[1]));
  }
  return d;
}

/** A doorway on a level: centre (plan frame) and width. */
export interface StairDoor {
  id: string;
  at: P2;
  width: number;
}

/** Doorways per level from the compiled building (door frames and open passages). */
export function levelDoors(plan: BuildingPlan): StairDoor[][] {
  const out: StairDoor[][] = plan.levels.map(() => []);
  let compiled: ReturnType<typeof compileBuilding> | null = null;
  try {
    compiled = compileBuilding({ ...plan, levels: plan.levels.map((l) => ({ ...l, stairs: [] })) });
  } catch {
    return out;
  }
  for (const e of compiled.entities) {
    if (e.arch?.role !== 'opening' || !e.parent) continue;
    const m = /-l(\d+)$/.exec(e.parent);
    const li = m ? Number(m[1]) : -1;
    const width = typeof e.shape?.kind === 'string' && e.shape.kind === 'procedural' ? Number((e.shape.params as Record<string, unknown> | undefined)?.['width'] ?? 0.9) : 0.9;
    const pos = e.transform?.position ?? [0, 0, 0];
    out[li]?.push({ id: e.id, at: [pos[0], pos[2]], width: Number.isFinite(width) ? width : 0.9 });
  }
  return out;
}

/** What is wrong with a stair (empty when it works), each with numbers. */
export interface StairCheck {
  problems: string[];
  /** The room the stair stands in, and the room it arrives in upstairs. */
  room?: string;
  arrives?: string;
  shape: StairShape;
}

/** Measure `stair` on level `li` of `plan` (`doors` from {@link levelDoors}, computed when omitted). */
export function checkStair(plan: BuildingPlan, li: number, stair: PlanStair, doors: StairDoor[][] = levelDoors(plan), others: readonly PlanStair[] = []): StairCheck {
  const level = plan.levels[li];
  const shape = stairShape(stair, level?.height ?? 3);
  const problems: string[] = [];
  if (!level) return { problems: [`there is no level ${li}`], shape };
  const above = plan.levels[li + 1];
  const here = rings(plan, level);
  const fp = bestRing(shape.footprint, here);
  const [bx0, bz0, bx1, bz1] = bounds(shape.footprint);
  const box = `x ${f2(bx0)}..${f2(bx1)}, z ${f2(bz0)}..${f2(bz1)}`;
  if (!fp.ring || fp.out > 0.02) {
    // Which rooms the footprint reaches: two or more means it crosses a wall between them.
    const hit = here.filter((r) => samples(shape.footprint).some((p) => pointInPolygon(p[0], p[1], r.poly))).map((r) => r.id);
    const where = hit.length > 1 ? `crosses the wall between ${hit.join(' and ')}` : fp.ring ? `runs ${f2(fp.out)} m into or past the walls of ${fp.ring.id}` : 'is outside every room';
    problems.push(`its footprint (${box}, ${f2(shape.size[0])} × ${f2(shape.size[1])} m for ${shape.risers} risers of ${f2(shape.riser)} m) ${where}`);
  }
  const room = fp.ring?.id;
  // Somewhere to step on: in front of the first riser, or beside the first treads (a stair along a wall).
  const ap = bestRing(shape.approachMin, here);
  const side = Math.min(bestRing(shape.sides[0], here).out, bestRing(shape.sides[1], here).out);
  if (ap.out > 0.02 && side > 0.02) problems.push(`there is no floor to step on: in front of the first riser ${f2(Math.max(0, STAIR_MIN_LANDING - ap.out))} of the ${STAIR_MIN_LANDING} m it needs${ap.ring ? ` (against the walls of ${ap.ring.id})` : ''}, and none beside its first treads either`);
  for (const d of doors[li] ?? []) {
    const gap = Math.min(distanceToPolygon(d.at, shape.footprint), distanceToPolygon(d.at, shape.approachMin) + STAIR_DOOR_CLEARANCE);
    const need = d.width / 2 + STAIR_DOOR_CLEARANCE;
    if (gap < need - 0.01) problems.push(`it comes within ${f2(gap)} m of the doorway ${d.id} at (${f2(d.at[0])}, ${f2(d.at[1])}) (keep ${f2(need)} m clear)`);
  }
  for (const o of others) {
    const s = stairShape(o, level.height);
    if (s.footprint.some((p) => pointInPolygon(p[0], p[1], shape.footprint)) || shape.footprint.some((p) => pointInPolygon(p[0], p[1], s.footprint))) problems.push(`it overlaps the stair at (${f2(o.at[0])}, ${f2(o.at[1])})`);
  }
  let arrives: string | undefined;
  if (!above) problems.push(`level ${li} is the top level, so the stair leads nowhere (add a level above first)`);
  else {
    const up = rings(plan, above);
    const hole = bestRing(shape.footprint, up);
    if (!hole.ring || hole.out > 0.02) problems.push(`upstairs the stairwell (${box}) ${hole.ring ? `cuts ${f2(hole.out)} m into the walls of ${hole.ring.id} on level ${li + 1}` : `is outside every room of level ${li + 1}`}`);
    const arr = bestRing(shape.arrivalMin, up);
    arrives = arr.ring?.id;
    if (!arr.ring || arr.out > 0.02) problems.push(`the top step arrives at (${f2(shape.top[0])}, ${f2(shape.top[1])}), which ${arr.ring ? `has only ${f2(Math.max(0, STAIR_MIN_LANDING - arr.out))} of the ${STAIR_MIN_LANDING} m of floor it needs in ${arr.ring.id} on level ${li + 1}` : `is not floor of any room on level ${li + 1}`}`);
  }
  return { problems, ...(room ? { room } : {}), ...(arrives ? { arrives } : {}), shape };
}

/** Rooms where a stair is usually put, first. */
const PREFERRED = ['hall', 'entry', 'lobby', 'living', 'dining', 'open-office', 'studio', 'office', 'kitchen', 'bedroom', 'kids', 'storage', 'laundry', 'garage', 'meeting', 'cafe'];

/** Options of {@link fitStair}. */
export interface StairFitOptions {
  room?: string | undefined;
  shape?: PlanStair['shape'] | undefined;
  heading?: Compass | undefined;
  width?: number | undefined;
  /** Stairs already on the level (kept clear). */
  others?: readonly PlanStair[];
}

/** Outcome of {@link fitStair}. */
export type StairFit =
  | { ok: true; stair: PlanStair; room: string; arrives: string; shape: StairShape; line: string }
  | { ok: false; reasons: string[] };

/** Plain sizes of the three stair shapes for a storey (for refusals): footprint length × width. */
export function stairSizes(rise: number, width = 1): string {
  const parts = (['straight', 'l', 'u'] as const).map((shape) => {
    const s = stairShape({ at: [0, 0], heading: 'east', shape, width, turn: 'left' }, rise);
    return `${shape === 'straight' ? 'straight' : shape === 'l' ? 'L' : 'U'} ${f2(s.size[0] + STAIR_LANDING)} × ${f2(s.size[1])} m`;
  });
  const s = stairShape({ at: [0, 0], heading: 'east', shape: 'straight', width, turn: 'left' }, rise);
  return `a ${f2(rise)} m storey takes ${s.risers} risers of ${f2(s.riser)} m (${s.risers - 1} treads of ${f2(s.going)} m); with ${STAIR_LANDING} m to step on, a ${width} m wide stair needs about ${parts.join(', ')}`;
}

/**
 * Find a stair from level `li` to the next that passes {@link checkStair}: in `opts.room` or the usual rooms,
 * against a wall, every heading, straight first. Deterministic; the result's `stair` goes straight into a plan.
 */
export function fitStair(plan: BuildingPlan, li: number, opts: StairFitOptions = {}): StairFit {
  const level = plan.levels[li];
  if (!level) return { ok: false, reasons: [`there is no level ${li}`] };
  if (!plan.levels[li + 1]) return { ok: false, reasons: [`level ${li} is the top level: add a level above before a stair`] };
  const doors = levelDoors(plan);
  const here = rings(plan, level);
  const rooms = opts.room !== undefined ? here.filter((r) => r.id === opts.room) : [...here].filter((r) => r.type !== 'bathroom').sort((a, b) => rank(a.type) - rank(b.type));
  if (rooms.length === 0) return { ok: false, reasons: [opts.room !== undefined ? `level ${li} has no room "${opts.room}" (rooms: ${here.map((r) => r.id).join(', ')})` : `level ${li} has no room for a stair`] };
  const shapes: Array<PlanStair['shape']> = opts.shape ? [opts.shape] : ['straight', 'l', 'u'];
  const widths = opts.width !== undefined ? [opts.width] : [1, 0.9];
  const headings = opts.heading ? [opts.heading] : HEADINGS;
  const reasons: string[] = [];
  for (const ring of rooms) {
    let best = null as { stair: PlanStair; score: number; check: StairCheck } | null;
    for (const width of widths) {
      for (const shape of shapes) {
        for (const turn of shape === 'straight' ? (['left'] as const) : (['left', 'right'] as const)) {
          for (const heading of headings) {
            for (const at of candidates(ring, { shape, width, turn, heading }, level.height)) {
              const stair: PlanStair = { at, heading, shape, width, turn };
              const check = checkStair(plan, li, stair, doors, opts.others ?? []);
              if (check.problems.length > 0) continue;
              // Simple shapes first, then the widest stair, then the most floor around the arrival.
              // Full landings at both ends are preferred over the least that works.
              const roomy = (bestRing(check.shape.approach, here).out > 0.02 ? 3 : 0) + (plan.levels[li + 1] && bestRing(check.shape.arrival, rings(plan, plan.levels[li + 1] as PlanLevel)).out > 0.02 ? 3 : 0);
              const score = (shape === 'straight' ? 0 : shape === 'l' ? 10 : 20) + (1 - width) * 5 + roomy - arrivalRoom(check, plan, li);
              if (!best || score < best.score - 1e-9) best = { stair, score, check };
            }
          }
        }
      }
      if (best) break;
    }
    if (best && best.check.arrives) {
      const s = best.stair;
      return { ok: true, stair: s, room: ring.id, arrives: best.check.arrives, shape: best.check.shape, line: `a ${s.shape === 'straight' ? 'straight' : s.shape === 'l' ? 'L' : 'U'} stair ${s.width} m wide in ${ring.id}, first riser at (${f2(s.at[0])}, ${f2(s.at[1])}) heading ${s.heading}${s.shape === 'straight' ? '' : `, turning ${s.turn}`}: ${best.check.shape.risers} risers of ${f2(best.check.shape.riser)} m, arriving in ${best.check.arrives} on level ${li + 1}` };
    }
    const [x0, z0, x1, z1] = bounds(ring.poly);
    reasons.push(`${ring.id} (${f2(x1 - x0)} × ${f2(z1 - z0)} m between wall centres): no position along its walls clears the walls, the doorways and the floor upstairs`);
  }
  reasons.push(stairSizes(level.height, widths[0]));
  return { ok: false, reasons };
}

function rank(type: string): number {
  const i = PREFERRED.indexOf(type);
  return i < 0 ? PREFERRED.length : i;
}

/** Floor around the arrival point upstairs (metres to the nearest wall, capped), to prefer roomy landings. */
function arrivalRoom(check: StairCheck, plan: BuildingPlan, li: number): number {
  const above = plan.levels[li + 1];
  if (!above || !check.arrives) return 0;
  const ring = rings(plan, above).find((r) => r.id === check.arrives);
  if (!ring) return 0;
  let d = Infinity;
  for (let k = 0; k < ring.poly.length; k++) {
    const a = ring.poly[k] as P2;
    const b = ring.poly[(k + 1) % ring.poly.length] as P2;
    d = Math.min(d, pointSegmentDistance(check.shape.top[0], check.shape.top[1], a[0], a[1], b[0], b[1]));
  }
  return Math.min(1.5, d);
}

/**
 * First-riser positions that put the stair against a wall of the room: the footprint's side on one wall
 * (its flank against the inside face), slid along the room in 10 cm steps.
 */
function candidates(ring: RoomRing, s: Pick<PlanStair, 'shape' | 'width' | 'turn' | 'heading'>, rise: number): P2[] {
  const probe = stairShape({ ...s, at: [0, 0] }, rise);
  const all = [...probe.footprint, ...probe.approachMin];
  const [fx0, fz0, fx1, fz1] = bounds(all);
  const [rx0, rz0, rx1, rz1] = bounds(ring.poly);
  const m = Math.max(...ring.clear) + 0.01;
  const xs = { lo: rx0 + m - fx0, hi: rx1 - m - fx1 };
  const zs = { lo: rz0 + m - fz0, hi: rz1 - m - fz1 };
  if (xs.hi < xs.lo - 1e-9 || zs.hi < zs.lo - 1e-9) return [];
  const out: P2[] = [];
  const steps = (lo: number, hi: number): number[] => {
    const n = Math.max(0, Math.floor((hi - lo) / 0.1 + 1e-9));
    const v: number[] = [];
    for (let k = 0; k <= n; k++) v.push(Math.round((lo + k * 0.1) * 100) / 100);
    if (hi - (lo + n * 0.1) > 0.005) v.push(Math.round(hi * 100) / 100);
    return v;
  };
  const alongX = s.heading === 'east' || s.heading === 'west';
  if (alongX) {
    for (const z of [zs.lo, zs.hi]) for (const x of steps(xs.lo, xs.hi)) out.push([x, Math.round(z * 100) / 100]);
  } else {
    for (const x of [xs.lo, xs.hi]) for (const z of steps(zs.lo, zs.hi)) out.push([Math.round(x * 100) / 100, z]);
  }
  return out;
}
