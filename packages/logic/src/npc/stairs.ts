/**
 * Stairs as links between navigation layers. Every compiled stair (`arch-stair`) carries its shape, so the way a
 * person walks it is known exactly: its walking line (up the middle of each flight, through the centre of the
 * landing, on along the next flight; `stairWalkLine` in `@aether/arch`). An NPC that changes floors follows that
 * line from the floor before the first riser to the floor beyond the top step (or back down), with its feet at the
 * height of the treads under it, instead of the navigation grid's shortest route, which cuts the turn along the inner
 * edge of the flight.
 *
 * Pure functions of the document; the results are plain typed arrays built once per navigation build.
 */
import { worldTransform, type EntityId, type Vec3, type WorldDoc } from '@aether/core';
import { StairParams, stairFootprint, stairLayout, stairWalkLine } from '@aether/arch';

/** Most stairs one navigation build links (the rest are left to the grid). */
export const MAX_STAIR_LINKS = 16;
/** Spacing of the points along a link's line (m): heights are exact at each point, linear between. */
const LINE_STEP = 0.2;
/** Most points of one link's line. */
const MAX_LINE_POINTS = 96;

/** One stair in world space, bottom to top. */
export interface StairLink {
  id: EntityId;
  /** Points of the walking line (x, y, z per point): feet positions, bottom (before the first riser) to top. */
  line: Float32Array;
  /** Number of points. */
  n: number;
  /** Plan distance from the first point to each point. */
  cum: Float32Array;
  /** Plan length of the whole line (m). */
  length: number;
  /** Height of the floor the stair starts from and of the floor it reaches. */
  y0: number;
  y1: number;
  /** Plan footprint of the flights and landings (the stairwell upstairs). */
  footprint: Array<[number, number]>;
  /** Half the stair's width. */
  halfWidth: number;
}

/** Yaw (degrees about +Y) of a unit quaternion that only turns about Y. */
function yawOf(q: readonly [number, number, number, number]): number {
  return (2 * Math.atan2(q[1], q[3]) * 180) / Math.PI;
}

/**
 * Height of the treads under a point of the walking line, in the stair's frame: on a flight the mean of the stepped
 * treads (half a riser above the line through the riser bottoms), blending onto the floor half a tread before the
 * first riser and onto the landing or floor above half a tread past the last.
 */
function heightAlong(p: StairParams, x: number, z: number, onSecond: boolean): number {
  const { flights, riser } = stairLayout(p);
  const g = p.going;
  const f = (onSecond ? flights[1] : flights[0]) ?? flights[0];
  if (!f) return 0;
  const s = (x - f.x) * f.dx + (z - f.z) * f.dz;
  return f.y0 + riser * Math.min(f.treads + 1, Math.max(0, (s + g / 2) / g));
}

/**
 * The stairs of a world as links, in document order (at most {@link MAX_STAIR_LINKS}). Stairs that are not upright
 * (a pitch or roll) or are scaled are left out: their line would not match their treads.
 */
export function stairLinks(world: WorldDoc): StairLink[] {
  const out: StairLink[] = [];
  for (const id of Object.keys(world.entities)) {
    if (out.length >= MAX_STAIR_LINKS) break;
    const e = world.entities[id];
    if (!e || e.template || e.shape.kind !== 'procedural' || e.shape.generator !== 'arch-stair') continue;
    const parsed = StairParams.safeParse(e.shape.params ?? {});
    if (!parsed.success) continue;
    const p = parsed.data;
    let wt;
    try {
      wt = worldTransform(world, id);
    } catch {
      continue;
    }
    const [qx, , qz] = wt.quaternion;
    if (Math.abs(qx) > 1e-3 || Math.abs(qz) > 1e-3 || wt.scale.some((s) => Math.abs(s - 1) > 1e-3)) continue;
    const t = (yawOf(wt.quaternion) * Math.PI) / 180;
    const c = Math.cos(t);
    const sn = Math.sin(t);
    const toWorld = (x: number, y: number, z: number): Vec3 => [wt.position[0] + x * c + z * sn, wt.position[1] + y, wt.position[2] - x * sn + z * c];
    // The walking line, densified; a point belongs to the second flight once the line has passed the landing's centre.
    const raw = stairWalkLine(p);
    const turnAt = raw.length > 3 ? 2 : raw.length;
    const pts: number[] = [];
    for (let k = 0; k + 1 < raw.length && pts.length / 3 < MAX_LINE_POINTS - 1; k++) {
      const a = raw[k] as [number, number, number];
      const b = raw[k + 1] as [number, number, number];
      const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
      const steps = Math.max(1, Math.ceil(len / LINE_STEP));
      for (let i = 0; i < steps; i++) {
        const u = i / steps;
        const x = a[0] + (b[0] - a[0]) * u;
        const z = a[2] + (b[2] - a[2]) * u;
        const w = toWorld(x, heightAlong(p, x, z, k >= turnAt), z);
        pts.push(w[0], w[1], w[2]);
      }
    }
    const last = raw[raw.length - 1] as [number, number, number];
    const end = toWorld(last[0], p.rise, last[2]);
    pts.push(end[0], end[1], end[2]);
    const n = pts.length / 3;
    const line = Float32Array.from(pts);
    const cum = new Float32Array(n);
    for (let i = 1; i < n; i++) cum[i] = (cum[i - 1] as number) + Math.hypot((line[i * 3] as number) - (line[i * 3 - 3] as number), (line[i * 3 + 2] as number) - (line[i * 3 - 1] as number));
    const footprint = stairFootprint(p).map(([x, z]) => {
      const q = toWorld(x, 0, z);
      return [q[0], q[2]] as [number, number];
    });
    out.push({ id, line, n, cum, length: cum[n - 1] as number, y0: wt.position[1], y1: wt.position[1] + p.rise, footprint, halfWidth: p.width / 2 });
  }
  return out;
}

/** Whether (x, z) lies inside a plan polygon (even-odd). */
export function insidePolygon(x: number, z: number, poly: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as readonly [number, number];
    const b = poly[j] as readonly [number, number];
    if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1] || 1e-12) + a[0]) inside = !inside;
  }
  return inside;
}

/**
 * The point at plan distance `u` along a link's line (clamped), written into `out` as x, y, z; going down (`dir` −1)
 * measures from the top. Also writes the unit plan direction of travel there into `out[3]`, `out[4]`.
 */
export function pointAlong(link: StairLink, u: number, dir: 1 | -1, out: Float32Array): void {
  const len = link.length;
  const d = Math.max(0, Math.min(len, dir > 0 ? u : len - u));
  const cum = link.cum;
  const line = link.line;
  let i = 0;
  // Segment containing d (lines are short: a linear scan).
  while (i + 2 < link.n && (cum[i + 1] as number) < d) i++;
  const c0 = cum[i] as number;
  const c1 = cum[i + 1] as number;
  const t = c1 > c0 ? (d - c0) / (c1 - c0) : 0;
  const ax = line[i * 3] as number;
  const ay = line[i * 3 + 1] as number;
  const az = line[i * 3 + 2] as number;
  const bx = line[i * 3 + 3] as number;
  const by = line[i * 3 + 4] as number;
  const bz = line[i * 3 + 5] as number;
  out[0] = ax + (bx - ax) * t;
  out[1] = ay + (by - ay) * t;
  out[2] = az + (bz - az) * t;
  const sl = Math.max(1e-6, c1 - c0);
  out[3] = ((bx - ax) / sl) * dir;
  out[4] = ((bz - az) / sl) * dir;
}
