/**
 * Stairs walked the way a person walks them: up the middle of each flight, through the centre of the landing, then
 * on along the next flight.
 *
 * The navigation grid sees a stair as a slope of standable cells and the shortest route over it hugs the inside of
 * the turn. On an L stair that runs the body along the inner edge of the first flight, where the slab of the floor
 * above borders the stairwell at head height: the capsule wedged its top under the slab edge on the last treads and
 * stood there. Every compiled stair carries its shape (`arch-stair` params), so its walking line is known exactly;
 * the bot follows that line over the stair and picks the grid route up again where the stair ends.
 */
import { worldTransform, type Vec3, type WorldDoc } from '@aether/core';
import { pointInPolygon, SpiralStairParams, spiralDisc, spiralLayout, spiralWalkLine, StairParams, stairFootprint, stairWalkLine } from '@aether/arch';

/** One stair: its plan footprint and walking line in world space. */
export interface StairGuide {
  id: string;
  /** Plan footprint (x, z) of the flights and landings. */
  footprint: Array<[number, number]>;
  /** Height of the floor the stair starts from and of the floor it reaches. */
  y0: number;
  y1: number;
  /** Walking line, bottom to top: feet positions. */
  line: Vec3[];
  /** Half the stair's width: how far from the walking line its treads reach. */
  halfWidth: number;
}

/** Yaw (degrees, about +Y) of a unit quaternion that only turns about Y. */
function yawOf(q: readonly [number, number, number, number]): number {
  return (2 * Math.atan2(q[1], q[3]) * 180) / Math.PI;
}

/** A stair's footprint, walking line, rise and half width in its own frame, by generator (null: not a stair, or bad params). */
function localStair(generator: string, raw: unknown): { footprint: Array<[number, number]>; line: Vec3[]; rise: number; halfWidth: number } | null {
  if (generator === 'arch-stair') {
    const parsed = StairParams.safeParse(raw ?? {});
    if (!parsed.success) return null;
    const p = parsed.data;
    return { footprint: stairFootprint(p) as Array<[number, number]>, line: stairWalkLine(p), rise: p.rise, halfWidth: p.width / 2 };
  }
  if (generator === 'arch-spiral-stair') {
    const parsed = SpiralStairParams.safeParse(raw ?? {});
    if (!parsed.success) return null;
    const p = parsed.data;
    const l = spiralLayout(p);
    // The whole disc counts as the stair (the landing sector included: the bot arrives on it), a tread's reach is its depth.
    return { footprint: spiralDisc(p) as Array<[number, number]>, line: spiralWalkLine(p), rise: p.rise, halfWidth: (l.outer - l.inner) / 2 + 0.05 };
  }
  return null;
}

/** The compiled stairs of a world (entities with the `arch-stair` or `arch-spiral-stair` generator), in world space. */
export function stairGuides(world: WorldDoc): StairGuide[] {
  const out: StairGuide[] = [];
  for (const [id, e] of Object.entries(world.entities)) {
    if (e.shape.kind !== 'procedural') continue;
    const local = localStair(e.shape.generator, e.shape.params);
    if (!local) continue;
    let wt;
    try {
      wt = worldTransform(world, id);
    } catch {
      continue;
    }
    // Stairs are placed upright (a yaw only) at unit scale; anything else is not walked by its line.
    const [qx, , qz] = wt.quaternion;
    if (Math.abs(qx) > 1e-3 || Math.abs(qz) > 1e-3 || wt.scale.some((s) => Math.abs(s - 1) > 1e-3)) continue;
    const t = (yawOf(wt.quaternion) * Math.PI) / 180;
    const c = Math.cos(t);
    const s = Math.sin(t);
    // Rotation about +Y: x' = x cos + z sin, z' = −x sin + z cos.
    const toWorld = (x: number, y: number, z: number): Vec3 => [wt.position[0] + x * c + z * s, wt.position[1] + y, wt.position[2] - x * s + z * c];
    const footprint = local.footprint.map(([x, z]) => {
      const q = toWorld(x, 0, z);
      return [q[0], q[2]] as [number, number];
    });
    out.push({ id, footprint, y0: wt.position[1], y1: wt.position[1] + local.rise, line: local.line.map(([x, y, z]) => toWorld(x, y, z)), halfWidth: local.halfWidth });
  }
  return out;
}

/** How far from the walking line the player may stray before it steers back onto it rather than along it (m). */
const LINE_SLACK = 0.2;

/** How far outside its footprint a point still counts as on the stair (route points on the edge of a flight). */
const EDGE_SLACK = 0.06;

/** How far outside a flight the player's feet may be while its body still stands on the treads (about its radius). */
export const BODY_SLACK = 0.4;

/**
 * Whether a feet position stands on the stair: inside its footprint (or on its edge) and at the height of its treads
 * there. The floor under the upper flight of a U stair is inside the footprint too, but far below the treads.
 */
export function onStair(st: StairGuide, p: Readonly<Vec3>, slack = EDGE_SLACK): boolean {
  if (p[1] < st.y0 - 0.25 || p[1] > st.y1 + 0.25) return false;
  if (!pointInPolygon(p[0], p[2], st.footprint) && !nearOutline(st.footprint, p, slack)) return false;
  // Some part of the walking line within reach across the treads, at about this height (the line runs straight
  // from the floor before the first riser, so it is up to a riser off the treads at the foot of a flight).
  const line = st.line;
  for (let k = 0; k + 1 < line.length; k++) {
    const a = line[k] as Vec3;
    const b = line[k + 1] as Vec3;
    const q = closest(p, a, b);
    if (Math.hypot(q[0] - p[0], q[2] - p[2]) <= st.halfWidth + slack && Math.abs(q[1] - p[1]) <= TREAD_SLACK) return true;
  }
  return false;
}

/** How far above or below its walking line a point on the treads may be (m). */
const TREAD_SLACK = 0.45;

function nearOutline(fp: ReadonlyArray<readonly [number, number]>, p: Readonly<Vec3>, slack: number): boolean {
  for (let k = 0; k < fp.length; k++) {
    const a = fp[k] as [number, number];
    const b = fp[(k + 1) % fp.length] as [number, number];
    const q = closest([p[0], 0, p[2]], [a[0], 0, a[1]], [b[0], 0, b[1]]);
    if (Math.hypot(q[0] - p[0], q[2] - p[2]) < slack) return true;
  }
  return false;
}

/** The point of segment a–b nearest to p in plan, with the segment's height there. */
function closest(p: Readonly<Vec3>, a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 {
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  const len2 = dx * dx + dz * dz;
  const u = len2 < 1e-9 ? 0 : Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[2] - a[2]) * dz) / len2));
  return [a[0] + dx * u, a[1] + (b[1] - a[1]) * u, a[2] + dz * u];
}

/**
 * A stretch of a route that climbs or descends a stair: route points `from..to` (inclusive) stand on it. The bot
 * walks `line` (in walking order) instead of those points.
 */
export interface StairStretch {
  from: number;
  to: number;
  line: Vec3[];
  stair: StairGuide;
}

/**
 * The stretches of a route (feet positions) that go up or down a stair: a run of points on one stair that changes
 * height by at least half the stair's rise. A route that only passes beside or under a stair is left alone.
 */
export function stairStretches(guides: readonly StairGuide[], route: ReadonlyArray<Readonly<Vec3>>): StairStretch[] {
  const out: StairStretch[] = [];
  if (guides.length === 0) return out;
  let i = 0;
  while (i < route.length) {
    const st = guides.find((g) => onStair(g, route[i] as Vec3));
    if (!st) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < route.length && onStair(st, route[j + 1] as Vec3)) j++;
    const a = route[i] as Vec3;
    const b = route[j] as Vec3;
    if (Math.abs(b[1] - a[1]) >= (st.y1 - st.y0) * 0.5) out.push({ from: i, to: j, line: b[1] > a[1] ? st.line.slice() : st.line.slice().reverse(), stair: st });
    i = j + 1;
  }
  return out;
}

/**
 * Following a walking line: the segment the player is on and the point to steer for. The player goes to each
 * vertex of the line (the landing's centre is one) before turning to the next, and steers for a point a little
 * ahead of where it stands on the current segment, never past the segment's end, so it keeps to the line.
 */
export class LineFollower {
  private seg = 0;

  constructor(readonly line: readonly Vec3[], start: Readonly<Vec3>) {
    // Start on the segment nearest the player (by plan distance and height: the flights of a U stair run side by side).
    let best = Infinity;
    for (let k = 0; k + 1 < line.length; k++) {
      const d = segDistance(start, line[k] as Vec3, line[k + 1] as Vec3);
      if (d < best - 1e-6) {
        best = d;
        this.seg = k;
      }
    }
  }

  /** Done once the player has reached the line's last point. */
  get done(): boolean {
    return this.seg >= this.line.length - 1;
  }

  /**
   * The point to steer for from `p` (null when the line is done). `reach` is how close to a vertex counts as there,
   * `ahead` how far ahead along the segment the player aims.
   */
  target(p: Readonly<Vec3>, reach = 0.25, ahead = 0.5): Vec3 | null {
    while (this.seg < this.line.length - 1) {
      const a = this.line[this.seg] as Vec3;
      const b = this.line[this.seg + 1] as Vec3;
      const dx = b[0] - a[0];
      const dz = b[2] - a[2];
      const len = Math.hypot(dx, dz);
      const along = len < 1e-6 ? 1 : ((p[0] - a[0]) * dx + (p[2] - a[2]) * dz) / (len * len);
      // At the segment's end (or past it): on to the next one.
      if (Math.hypot(b[0] - p[0], b[2] - p[2]) < reach || along >= 1) {
        this.seg++;
        continue;
      }
      // Off the line (stepped onto the stair from its side, pushed aside): back onto the line first, nearly square
      // to it, and only then along it. Climbing on along the edge of a flight takes the head under the slab there.
      const u0 = Math.max(0, along);
      const off = Math.hypot(a[0] + dx * u0 - p[0], a[2] + dz * u0 - p[2]);
      const lead = off > LINE_SLACK ? Math.min(ahead, 0.1) : ahead;
      const u = Math.min(1, u0 + (len < 1e-6 ? 1 : lead / len));
      return [a[0] + dx * u, a[1] + (b[1] - a[1]) * u, a[2] + dz * u];
    }
    return null;
  }
}

/** Plan distance to a segment, with a height difference counting double (flights of a U stair run side by side). */
function segDistance(p: Readonly<Vec3>, a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  const q = closest(p, a, b);
  return Math.hypot(q[0] - p[0], q[2] - p[2]) + Math.abs(q[1] - p[1]) * 2;
}
