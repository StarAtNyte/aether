/**
 * Stair fitting: measure a stair against the plan, and find one that fits.
 *
 * A stair on level `li` climbs the storey height of that level (floor to floor) to level `li + 1`. It works only
 * when its whole footprint stands inside one room clear of the walls, there is a clear landing to step on at the
 * foot (in front of the first riser, or beside its first treads), it keeps out of the doorways, the stairwell it
 * cuts upstairs lies inside one room there, and its top step comes out on a clear landing of the level above that
 * leads on (what the building check and the walkthrough bot need).
 *
 * A landing is a strip as wide as the flight and at least {@link stairLandingDepth} deep: the stair's width, and
 * never less than a walker's body with room to spare each side ({@link STAIR_MIN_LANDING}). It is measured to the
 * inside faces of the walls and kept clear of railings, other stairs and stairwells, and furniture placed at a
 * point. A top landing that only leads sideways keeps that depth past the corner of the stairwell balustrade.
 *
 * `checkStair` returns the problems with numbers; `fitStair` searches the rooms (along their walls, every heading,
 * straight then L then U, or nearest to a given stair) for a stair that has none, so a model or the offline planner
 * can ask for "a stair in the hall" and get exact `at` / `heading` values, or a measured reason why no stair fits;
 * `settleStairs` moves the stairs of a plan that do not work to the nearest ones that do.
 */
import { compileBuilding } from './compile';
import { furnitureByKind, furnitureSize } from './furniture/index';
import { obb } from './layout';
import { bounds, pointInPolygon, pointSegmentDistance, positive, rotateYaw, yawOf, type P2 } from './math2';
import { StairParams } from './params';
import { compassNormal, offsetPolygon, roomPolygon } from './rooms';
import { stairFootprint, stairLayout, stairRisers } from './stair';
import type { BuildingPlan, Compass, PlanLevel, PlanStair } from './plan';

/** A walker's body across (m): the walkthrough bot's capsule is 0.35 m in radius, and its controller adds a skin. */
export const STAIR_BODY = 0.7;
/** Room a walker keeps to each side of the body on a landing (m). */
export const STAIR_BODY_CLEARANCE = 0.1;
/** The least clear landing at either end of a stair of any width: a body and its clearance on both sides (m). */
export const STAIR_MIN_LANDING = STAIR_BODY + 2 * STAIR_BODY_CLEARANCE;
/** How much deeper than the least a roomy landing is (fitting prefers roomy ones). */
const ROOMY = 0.3;
/** Depth of a roomy landing for a stair up to 0.9 m wide (m). */
export const STAIR_LANDING = STAIR_MIN_LANDING + ROOMY;
/** Clearance a stair keeps from a doorway centre beyond half the door width (m). */
export const STAIR_DOOR_CLEARANCE = 0.5;
/** Floor beside the first treads that a stair against a wall is stepped onto from, along the flight (m). */
const SIDE_ALONG = 0.6;
/**
 * Height of the wedge under the middle of a walker's body that the walkthrough bot's hop still gets onto from the side
 * (m): the first treads up to about 0.32 m along a 0.27 m going and 0.175 m riser flight; further along the body's far
 * edge is over treads too tall (measured with the character controller).
 */
const SIDE_HOP_HEIGHT = 0.207;
/** The walker's body radius with the controller's skin (m): how close its centre comes to a wall (measured: 0.37 m). */
const SIDE_BODY_R = 0.375;

/**
 * Where, along the first flight from the first riser, the centre of a walker stepping onto the side of the treads can
 * stand at most (m): about 0.32 m for the usual 0.175 m riser and 0.27 m going.
 */
export function stairSideReach(going: number, riser: number): number {
  return (SIDE_HOP_HEIGHT * going) / Math.max(1e-3, riser);
}

/**
 * How much floor a stair needs behind its first riser, beside the flight, for a walker to step onto it from the side
 * (m): the body's centre keeps a radius from the wall behind it and may stand at most {@link stairSideReach} along.
 * A stair tucked against the wall at its foot has none, and its sides are not a way on however long they are.
 */
export function stairSideBehind(going: number, riser: number): number {
  return Math.max(0, SIDE_BODY_R - stairSideReach(going, riser));
}

/**
 * How far the stairwell balustrade reaches past the edge of the opening (m): it stands 5 cm back (compile.ts,
 * WELL_RAIL_SETBACK) and its collider is 4 cm thick each side of that line.
 */
export const WELL_RAIL_REACH = 0.09;
/** Half-thickness of a railing's collider (m). */
const RAIL_HALF = 0.04;

/** Depth of clear floor a stair needs at its foot and beyond its top step: its width, never less than {@link STAIR_MIN_LANDING}. */
export function stairLandingDepth(width: number): number {
  return Math.round(Math.max(STAIR_MIN_LANDING, width) * 100) / 100;
}

const HEADINGS: readonly Compass[] = ['north', 'east', 'south', 'west'];
const r2 = (n: number): number => Math.round(n * 100) / 100;
const f2 = (n: number): string => r2(n).toFixed(2);

/** Plan-frame geometry of a stair: footprint (the hole upstairs), the floor around its ends. */
export interface StairShape {
  footprint: P2[];
  /** Floor in front of the first riser: a roomy landing and the least that works. */
  approach: P2[];
  approachMin: P2[];
  /** Floor beside the first treads (left, right), and behind the first riser as far as {@link stairSideBehind}: a stair against a wall can be stepped onto from the side. */
  sides: [P2[], P2[]];
  /** Floor beyond the top step on the level above: a roomy landing and the least that works. */
  arrival: P2[];
  arrivalMin: P2[];
  /**
   * Ways on from the top landing on the level above: straight ahead past it, or to either side of it past the
   * corner of the stairwell balustrade. At least one must be clear floor.
   */
  exits: { ahead: P2[]; left: P2[]; right: P2[] };
  /** The point the top step leads to (the building check seeds the upper floor here). */
  top: P2;
  /** Centre of the top step's front edge, and the direction the last flight climbs (plan frame, unit). */
  topEdge: P2;
  topDir: P2;
  /** Centre of the first riser, and the direction the first flight climbs (plan frame, unit). */
  foot: P2;
  footDir: P2;
  /** Depth of the landing this stair needs at each end (m). */
  landing: number;
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
  const dirPlan = (dx: number, dz: number): P2 => {
    const r = rotateYaw(dx, dz, yaw);
    return [r2(r[0]), r2(r[1])];
  };
  const local = stairFootprint(sp);
  const { flights } = stairLayout(sp);
  const { count, riser } = stairRisers(sp);
  const last = flights[flights.length - 1];
  const w = sp.width;
  const m = stairLandingDepth(w);
  const behind = stairSideBehind(sp.going, riser);
  const box = (x0: number, z0: number, x1: number, z1: number): P2[] => [toPlan([x0, z0]), toPlan([x1, z0]), toPlan([x1, z1]), toPlan([x0, z1])];
  let top: P2 = toPlan([0, 0]);
  let topEdge: P2 = toPlan([0, 0]);
  let topDir: P2 = dirPlan(1, 0);
  let arrival: P2[] = [];
  let arrivalMin: P2[] = [];
  let exits: StairShape['exits'] = { ahead: [], left: [], right: [] };
  if (last) {
    const run = last.treads * sp.going;
    const ex = last.x + last.dx * run;
    const ez = last.z + last.dz * run;
    // Across the last flight (perpendicular to its direction).
    const px = -last.dz;
    const pz = last.dx;
    // A quad in the last flight's frame: `a0..a1` along it from the top edge, `c0..c1` across it from its centre line.
    const quad = (a0: number, a1: number, c0: number, c1: number): P2[] =>
      (
        [
          [ex + last.dx * a0 + px * c0, ez + last.dz * a0 + pz * c0],
          [ex + last.dx * a1 + px * c0, ez + last.dz * a1 + pz * c0],
          [ex + last.dx * a1 + px * c1, ez + last.dz * a1 + pz * c1],
          [ex + last.dx * a0 + px * c1, ez + last.dz * a0 + pz * c1],
        ] as Array<[number, number]>
      ).map(toPlan);
    // The strip beyond the top step, as wide as the flight.
    arrival = quad(0, m + ROOMY, -w / 2, w / 2);
    arrivalMin = quad(0, m, -w / 2, w / 2);
    const wide = Math.max(w, STAIR_MIN_LANDING) / 2;
    exits = {
      ahead: quad(m, m + 0.5, -wide, wide),
      // Sideways the way on starts past the balustrade's corner and keeps the landing's depth.
      left: quad(WELL_RAIL_REACH + 0.01, m, w / 2, w / 2 + STAIR_MIN_LANDING),
      right: quad(WELL_RAIL_REACH + 0.01, m, -w / 2 - STAIR_MIN_LANDING, -w / 2),
    };
    top = toPlan([ex + last.dx * 0.4, ez + last.dz * 0.4]);
    topEdge = toPlan([ex, ez]);
    topDir = dirPlan(last.dx, last.dz);
  }
  const fp = local.map(toPlan);
  const [x0, z0, x1, z1] = bounds(local);
  return {
    footprint: fp,
    approach: box(-(m + ROOMY), -w / 2, 0, w / 2),
    approachMin: box(-m, -w / 2, 0, w / 2),
    sides: [box(-behind, -w / 2 - m, SIDE_ALONG, -w / 2), box(-behind, w / 2, SIDE_ALONG, w / 2 + m)],
    arrival,
    arrivalMin,
    exits,
    top,
    topEdge,
    topDir,
    foot: toPlan([0, 0]),
    footDir: dirPlan(1, 0),
    landing: m,
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

/** Something standing on a floor that a landing must keep clear of: an area, or a railing (a polyline with a thickness). */
interface Obstacle {
  label: string;
  poly?: P2[];
  line?: P2[];
}

/** Stairwell of `s` (from the level below) with its balustrade round it. */
function wellOf(s: PlanStair, rise: number): P2[] {
  return offsetPolygon(positive(stairShape(s, rise).footprint), WELL_RAIL_REACH);
}

const at2 = (p: P2): string => `(${f2(p[0])}, ${f2(p[1])})`;

/**
 * What stands on the floor of level `li` besides the walls: the stairwells (and their balustrades) of the stairs
 * `below` climbing from the level under it, the stairs `here` that start on this level, declared railings and
 * furniture placed at a point.
 */
function floorObstacles(plan: BuildingPlan, li: number, below: readonly PlanStair[], here: readonly PlanStair[]): Obstacle[] {
  const level = plan.levels[li];
  if (!level) return [];
  const out: Obstacle[] = [];
  const rise = plan.levels[li - 1]?.height ?? 3;
  for (const s of below) out.push({ label: `the stairwell of the stair from level ${li - 1} at ${at2(s.at)}`, poly: wellOf(s, rise) });
  for (const s of here) out.push({ label: `the stair at ${at2(s.at)}`, poly: stairShape(s, level.height).footprint });
  level.railings.forEach((r, i) => out.push({ label: `railing ${i + 1} of level ${li}`, line: r.points.map((p) => [p[0], p[1]] as P2) }));
  for (const room of level.rooms) {
    for (const it of room.items) {
      if (!it.at) continue;
      const def = furnitureByKind(it.kind);
      if (!def || def.mount !== 'floor' || def.kind === 'rug') continue;
      const [w, , d] = furnitureSize(def, it.params);
      out.push({ label: `the ${it.kind} at ${at2([it.at[0], it.at[1]])} in ${room.id}`, poly: obb(it.at[0], it.at[1], it.yaw ?? 0, w, d) });
    }
  }
  return out;
}

/** Whether a point is inside an obstacle (a railing counts within its collider's half-thickness). */
function inObstacle(p: P2, o: Obstacle): boolean {
  if (o.poly) return pointInPolygon(p[0], p[1], o.poly);
  const l = o.line ?? [];
  for (let k = 0; k + 1 < l.length; k++) {
    const a = l[k] as P2;
    const b = l[k + 1] as P2;
    if (pointSegmentDistance(p[0], p[1], a[0], a[1], b[0], b[1]) < RAIL_HALF) return true;
  }
  return false;
}

/** Points over a quad (corners, edges and inside, about 10 cm apart). */
function quadPoints(q: readonly P2[]): P2[] {
  const [a, b, c, d] = q as [P2, P2, P2, P2];
  const nu = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.1));
  const nv = Math.max(1, Math.ceil(Math.hypot(d[0] - a[0], d[1] - a[1]) / 0.1));
  const out: P2[] = [];
  for (let i = 0; i <= nu; i++) {
    const u = i / nu;
    for (let k = 0; k <= nv; k++) {
      const v = k / nv;
      out.push([a[0] * (1 - u) * (1 - v) + b[0] * u * (1 - v) + c[0] * u * v + d[0] * (1 - u) * v, a[1] * (1 - u) * (1 - v) + b[1] * u * (1 - v) + c[1] * u * v + d[1] * (1 - u) * v]);
    }
  }
  return out;
}

/** The first obstacle a quad runs into, if any. */
function blockedBy(q: readonly P2[], obstacles: readonly Obstacle[]): Obstacle | null {
  if (q.length !== 4 || obstacles.length === 0) return null;
  const pts = quadPoints(q);
  for (const o of obstacles) if (pts.some((p) => inObstacle(p, o))) return o;
  return null;
}

/** Whether a quad is clear floor of a ring, off the footprint and every obstacle. */
function clearFloor(q: readonly P2[], ring: RoomRing, footprint: readonly P2[], obstacles: readonly Obstacle[]): boolean {
  if (q.length !== 4) return false;
  if (samples(q).some((p) => shortfall(p, ring) > 0.02)) return false;
  const pts = quadPoints(q);
  if (pts.some((p) => pointInPolygon(p[0], p[1], footprint) && !onOutline(p, footprint))) return false;
  return blockedBy(q, obstacles) === null;
}

function onOutline(p: P2, poly: readonly P2[]): boolean {
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k] as P2;
    const b = poly[(k + 1) % poly.length] as P2;
    if (pointSegmentDistance(p[0], p[1], a[0], a[1], b[0], b[1]) < 0.02) return true;
  }
  return false;
}

/**
 * Clear floor straight out from `from` along `dir` (m, up to `cap`): to the inside face of the walls of `ring`, the
 * edge of its floor, or the first obstacle, with what stops it.
 */
function clearRun(from: P2, dir: P2, ring: RoomRing | null, obstacles: readonly Obstacle[], cap = 3): { depth: number; by: string } {
  for (let t = 0.01; t <= cap; t += 0.01) {
    const p: P2 = [from[0] + dir[0] * t, from[1] + dir[1] * t];
    if (!ring || shortfall(p, ring) > 0) return { depth: r2(t - 0.01), by: ring ? `the wall of ${ring.id}` : 'the edge of the floor' };
    const o = obstacles.find((x) => inObstacle(p, x));
    if (o) return { depth: r2(t - 0.01), by: o.label };
  }
  return { depth: cap, by: '' };
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

/** Whether the floor beside the first treads (and behind the first riser) is clear: the stair can be stepped onto from a side. */
function sideEntryOk(shape: StairShape, here: readonly RoomRing[], obstacles: readonly Obstacle[]): boolean {
  return shape.sides.some((q) => {
    const r = bestRing(q, here);
    return r.ring !== null && r.out <= 0.02 && blockedBy(q, obstacles) === null;
  });
}

/**
 * Whether stair `si` of level `li` of `plan` can be stepped onto from the side of its first treads (what a stair with
 * a wall at its foot depends on), measured on the plan: the building check's grid is too coarse for centimetres.
 */
export function stairSideEntry(plan: BuildingPlan, li: number, si: number): boolean {
  const level = plan.levels[li];
  const stair = level?.stairs[si];
  if (!level || !stair) return false;
  const others = level.stairs.filter((_, k) => k !== si);
  return sideEntryOk(stairShape(stair, level.height), rings(plan, level), floorObstacles(plan, li, plan.levels[li - 1]?.stairs ?? [], others));
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
  const need = shape.landing;
  const needText = `${f2(need)} m (${need > STAIR_MIN_LANDING + 1e-9 ? 'the stair\'s width' : `a ${f2(STAIR_BODY)} m body with ${f2(STAIR_BODY_CLEARANCE)} m each side`})`;
  // A clear landing to step on: in front of the first riser, or beside the first treads (a stair along a wall).
  const lowObstacles = floorObstacles(plan, li, plan.levels[li - 1]?.stairs ?? [], others);
  const ap = bestRing(shape.approachMin, here);
  const apHit = ap.out <= 0.02 ? blockedBy(shape.approachMin, lowObstacles) : null;
  const sideOk = sideEntryOk(shape, here, lowObstacles);
  if ((ap.out > 0.02 || apHit) && !sideOk) {
    const run = clearRun(shape.foot, [-shape.footDir[0], -shape.footDir[1]], fp.ring ?? ap.ring, lowObstacles);
    const sideRuns = ([1, -1] as const).map((s) => clearRun([shape.foot[0] + shape.footDir[0] * 0.3 - shape.footDir[1] * s * (stair.width / 2), shape.foot[1] + shape.footDir[1] * 0.3 + shape.footDir[0] * s * (stair.width / 2)], [-shape.footDir[1] * s, shape.footDir[0] * s], fp.ring ?? ap.ring, lowObstacles));
    const side = Math.max(...sideRuns.map((r) => r.depth));
    problems.push(`there is no clear landing to step on at its foot: ${f2(run.depth)} m of floor in front of the first riser at ${at2(shape.foot)}${run.by ? ` before ${run.by}` : ''} and ${f2(side)} m beside its first treads, where a walker needs ${needText} as wide as the stair`);
  }
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
    // The stairwell and its balustrade keep out of the doorways upstairs as the flight does downstairs.
    for (const d of doors[li + 1] ?? []) {
      const gap = distanceToPolygon(d.at, shape.footprint) - WELL_RAIL_REACH;
      const need = d.width / 2 + STAIR_DOOR_CLEARANCE;
      if (gap < need - 0.01) problems.push(`upstairs the stairwell comes within ${f2(Math.max(0, gap))} m of the doorway ${d.id} at (${f2(d.at[0])}, ${f2(d.at[1])}) on level ${li + 1} (keep ${f2(need)} m clear)`);
    }
    const arr = bestRing(shape.arrivalMin, up);
    arrives = arr.ring?.id;
    const highObstacles = floorObstacles(plan, li + 1, others, above.stairs);
    const where = `on level ${li + 1}`;
    if (!arr.ring || arr.out > 0.02) {
      const ring = arr.ring && pointInPolygon(shape.topEdge[0], shape.topEdge[1], arr.ring.poly) ? arr.ring : (up.find((r) => pointInPolygon(shape.topEdge[0], shape.topEdge[1], r.poly)) ?? null);
      const run = clearRun(shape.topEdge, shape.topDir, ring, highObstacles);
      if (!ring) problems.push(`its top step comes out at ${at2(shape.topEdge)}, which is not floor of any room ${where}`);
      else if (run.depth < need - 0.005) problems.push(`its top step comes out at ${at2(shape.topEdge)} with ${f2(run.depth)} m of clear floor before ${run.by || `the wall of ${ring.id}`} ${where}, where a walker needs a landing ${needText} deep as wide as the stair`);
      else problems.push(`its top step comes out at ${at2(shape.topEdge)} onto a landing that runs ${f2(arr.out)} m into the walls of ${ring.id} beside it ${where} (a walker needs a landing ${needText} deep as wide as the stair)`);
    } else {
      const hit = blockedBy(shape.arrivalMin, highObstacles);
      if (hit) {
        const run = clearRun(shape.topEdge, shape.topDir, arr.ring, highObstacles);
        problems.push(`its top step comes out at ${at2(shape.topEdge)} onto a landing that runs into ${hit.label} ${where} (${f2(run.depth)} m clear straight ahead; a walker needs ${needText} as wide as the stair)`);
      } else {
        // The landing must lead on: straight ahead, or sideways past the corner of the stairwell balustrade.
        const ways = [shape.exits.ahead, shape.exits.left, shape.exits.right];
        if (!ways.some((q) => clearFloor(q, arr.ring as RoomRing, shape.footprint, highObstacles))) problems.push(`the landing beyond its top step at ${at2(shape.topEdge)} leads nowhere ${where}: walls, the stairwell or furniture close it ahead and on both sides (a walker needs a way on ${f2(STAIR_MIN_LANDING)} m wide)`);
      }
    }
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
  /** Which way an L or U stair turns (both are tried when left out). */
  turn?: PlanStair['turn'] | undefined;
  width?: number | undefined;
  /** Stairs already on the level (kept clear). */
  others?: readonly PlanStair[];
  /**
   * A stair to stay close to (one that does not work): its width, shape and heading are kept when they can be,
   * and the nearest position wins over the roomiest.
   */
  near?: PlanStair | undefined;
}

/** Outcome of {@link fitStair}. */
export type StairFit =
  | { ok: true; stair: PlanStair; room: string; arrives: string; shape: StairShape; line: string }
  | { ok: false; reasons: string[] };

/** Plain sizes of the three stair shapes for a storey (for refusals): footprint length × width. */
export function stairSizes(rise: number, width = 1): string {
  const parts = (['straight', 'l', 'u'] as const).map((shape) => {
    const s = stairShape({ at: [0, 0], heading: 'east', shape, width, turn: 'left' }, rise);
    return `${shape === 'straight' ? 'straight' : shape === 'l' ? 'L' : 'U'} ${f2(s.size[0] + s.landing)} × ${f2(s.size[1])} m`;
  });
  const s = stairShape({ at: [0, 0], heading: 'east', shape: 'straight', width, turn: 'left' }, rise);
  return `a ${f2(rise)} m storey takes ${s.risers} risers of ${f2(s.riser)} m (${s.risers - 1} treads of ${f2(s.going)} m); with a clear landing of ${f2(s.landing)} m at the top (and one in front of or beside the first riser), a ${width} m wide stair needs about ${parts.join(', ')}`;
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
  const near = opts.near;
  const shapes: Array<PlanStair['shape']> = opts.shape ? [opts.shape] : ['straight', 'l', 'u'];
  const widths = opts.width !== undefined ? [opts.width] : near ? [near.width, ...[1, 0.9].filter((w) => w < near.width)] : [1, 0.9];
  const headings = opts.heading ? [opts.heading] : HEADINGS;
  const reasons: string[] = [];
  const upRings = plan.levels[li + 1] ? rings(plan, plan.levels[li + 1] as PlanLevel) : [];
  for (const ring of rooms) {
    let best = null as { stair: PlanStair; score: number; check: StairCheck } | null;
    for (const width of widths) {
      for (const shape of shapes) {
        for (const turn of shape === 'straight' ? (['left'] as const) : opts.turn ? [opts.turn] : (['left', 'right'] as const)) {
          for (const heading of headings) {
            for (const at of candidates(ring, { shape, width, turn, heading }, level.height)) {
              const stair: PlanStair = { at, heading, shape, width, turn };
              const check = checkStair(plan, li, stair, doors, opts.others ?? []);
              if (check.problems.length > 0) continue;
              // Roomy landings at both ends are preferred over the least that works.
              const roomy = (bestRing(check.shape.approach, here).out > 0.02 ? 3 : 0) + (bestRing(check.shape.arrival, upRings).out > 0.02 ? 3 : 0);
              // Near a given stair: the same shape, then the same heading and turn, then the least move. Otherwise
              // simple shapes first, then the widest stair, then the most floor around the arrival.
              const score = near
                ? (shape === near.shape ? 0 : 20) + (heading === near.heading ? 0 : 4) + (shape === 'straight' || turn === near.turn ? 0 : 3) + Math.hypot(at[0] - near.at[0], at[1] - near.at[1]) + roomy / 3
                : (shape === 'straight' ? 0 : shape === 'l' ? 10 : 20) + (1 - width) * 5 + roomy - arrivalRoom(check, plan, li);
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
    reasons.push(`${ring.id} (${f2(x1 - x0)} × ${f2(z1 - z0)} m between wall centres): no position along its walls clears the walls and the doorways with a clear landing at the foot and at the top upstairs`);
  }
  reasons.push(stairSizes(level.height, widths[0]));
  return { ok: false, reasons };
}

/** A stair as the JSON an op or a plan takes. */
export function stairJson(s: PlanStair): string {
  return `{"at":[${r2(s.at[0])},${r2(s.at[1])}],"heading":"${s.heading}","shape":"${s.shape}","width":${s.width}${s.shape === 'straight' ? '' : `,"turn":"${s.turn}"`}}`;
}

/** Outcome of {@link settleStairs}. */
export interface StairSettlement {
  /** The plan with every stair that could be fixed moved (the input when nothing changed). */
  plan: BuildingPlan;
  /** One line per moved stair: what was wrong, measured, and where it went. */
  moved: string[];
  /** Stairs that do not work and for which nothing fits, measured. */
  failing: string[];
}

/**
 * Measure every stair of a plan and move each one that does not work (a top step landing against a wall, no
 * landing at the foot, a footprint across a wall …) to the nearest stair that does: the same room, shape, width and
 * heading when they can be kept. Deterministic; stairs that work are left exactly as they are.
 */
export function settleStairs(plan: BuildingPlan): StairSettlement {
  if (!plan.levels.some((l) => l.stairs.length > 0)) return { plan, moved: [], failing: [] };
  const doors = levelDoors(plan);
  const levels = plan.levels.map((l) => ({ ...l, stairs: [...l.stairs] }));
  const out: BuildingPlan = { ...plan, levels };
  const moved: string[] = [];
  const failing: string[] = [];
  levels.forEach((lvl, li) => {
    lvl.stairs.forEach((s, si) => {
      const others = lvl.stairs.filter((_, k) => k !== si);
      const check = checkStair(out, li, s, doors, others);
      if (check.problems.length === 0) return;
      const label = `level ${li} stair ${si + 1} at (${f2(s.at[0])}, ${f2(s.at[1])}) heading ${s.heading}`;
      if (!plan.levels[li + 1]) {
        failing.push(`${label}: ${check.problems.join('; ')}`);
        return;
      }
      let fit = fitStair(out, li, { room: check.room, near: s, others });
      if (!fit.ok && check.room !== undefined) fit = fitStair(out, li, { near: s, others });
      if (!fit.ok) {
        failing.push(`${label}: ${check.problems.join('; ')}; nothing fits instead: ${fit.reasons.join('; ')}`);
        return;
      }
      lvl.stairs[si] = fit.stair;
      moved.push(`${label}: ${check.problems.join('; ')}; moved to ${fit.line} (${stairJson(fit.stair)})`);
    });
  });
  return { plan: moved.length > 0 ? out : plan, moved, failing };
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
  // The footprint alone in the room: the landing at the foot may be in front of the first riser or beside it.
  const probe = stairShape({ ...s, at: [0, 0] }, rise);
  const [fx0, fz0, fx1, fz1] = bounds(probe.footprint);
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
