/**
 * Room size from a monocular depth map (advisory). The depth network (Depth Anything V2 Small) gives RELATIVE inverse depth:
 * larger = nearer, correct only up to an unknown scale and shift. So the estimate is built in three steps, each of them
 * the simplest thing that is still robust:
 *
 * 1. Disparity to depth: `z = 1 / (d + b)` with `d` the disparity scaled to 0..1 (2nd to 98th percentile) and `b` a shift
 *    (a far wall is not at infinity). `b` is unknown, so it is swept over a few values and the spread goes into the range.
 * 2. Back-project with a pinhole camera of a guessed horizontal field of view (also swept) and find the floor: a plane fitted
 *    to the lower part of the picture gives "up". Heights are measured along it.
 * 3. Metric scale from one thing of known size: an anchor the caller names (a door about 2.05 m high, with its box in the
 *    photo), or else the ceiling (floor to ceiling taken as 2.4 to 2.7 m). Width is the span of the wall points across the
 *    view, depth the farthest wall plus a camera standoff.
 *
 * Pure: no model, no pixels of the photo. The model call lives in `@aether/agent` (`photo/depth-model.ts`).
 */

/** A depth map from the network: `data[y * width + x]`, larger = nearer (relative inverse depth). */
export interface DisparityMap {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

/** Something of known size in the photo. `axis` height: vertical extent of the box; width: horizontal extent. */
export interface DepthAnchor {
  name: string;
  /** Real size of that extent in metres. */
  sizeM: number;
  axis: 'height' | 'width';
  /** [x0, y0, x1, y1] in 0..1 of the photo, origin top-left. */
  box: readonly [number, number, number, number];
  /** Relative error of the size (a door: 0.04). */
  tolerance?: number;
}

export interface RoomDepthEstimate {
  /** Median over the sweep and the low/high ends of it, metres. */
  width: { value: number; low: number; high: number };
  depth: { value: number; low: number; high: number };
  height: { value: number; low: number; high: number };
  /** What fixed the metric scale. */
  scale: { basis: 'anchor' | 'ceiling'; text: string };
  /** low: the ceiling is not clearly in the picture, or the floor plane did not fit (the numbers are guesses). */
  confidence: 'low' | 'medium';
  notes: string[];
}

export interface EstimateOptions {
  anchor?: DepthAnchor;
  /** Horizontal field of view guesses in degrees (default 65, 75, 90). */
  fovs?: readonly number[];
  /** Disparity shifts (default 0.2, 0.3, 0.45). */
  shifts?: readonly number[];
  /** Floor-to-ceiling guesses in metres when no anchor (default 2.4, 2.5, 2.7). */
  ceilings?: readonly number[];
  /** Metres between the camera and the wall behind it (default 0.4). */
  standoff?: number;
}

const DEFAULT_FOVS = [65, 75, 90];
const DEFAULT_SHIFTS = [0.2, 0.3, 0.45];
const DEFAULT_CEILINGS = [2.4, 2.5, 2.7];
/** Samples per side of the working grid (the map is thinned to about this). */
const GRID = 64;

type V3 = [number, number, number];

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i] as number;
}
const sortedCopy = (a: number[]): number[] => a.slice().sort((x, y) => x - y);
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Plane through three points as unit normal and offset (n . p = off). */
function plane3(a: V3, b: V3, c: V3): { n: V3; off: number } | null {
  const n = cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]);
  if (Math.hypot(n[0], n[1], n[2]) < 1e-9) return null;
  const u = norm(n);
  return { n: u, off: dot(u, a) };
}

/** Deterministic pseudo-random generator so an estimate is repeatable. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** RANSAC plane over points whose normal stays within `maxTiltDeg` of `ref`; returns the plane with up pointing positive y. */
function fitFloor(pts: V3[], ref: V3, maxTiltDeg: number, tol: number): { n: V3; off: number; inliers: number } | null {
  if (pts.length < 12) return null;
  const rnd = lcg(7);
  const cosMax = Math.cos((maxTiltDeg * Math.PI) / 180);
  let best: { n: V3; off: number; inliers: number } | null = null;
  for (let it = 0; it < 120; it++) {
    const p = plane3(pts[Math.floor(rnd() * pts.length)] as V3, pts[Math.floor(rnd() * pts.length)] as V3, pts[Math.floor(rnd() * pts.length)] as V3);
    if (!p) continue;
    let n = p.n;
    let off = p.off;
    if (n[1] < 0) { n = [-n[0], -n[1], -n[2]]; off = -off; }
    if (dot(n, ref) < cosMax) continue;
    let k = 0;
    for (const q of pts) if (Math.abs(dot(n, q) - off) < tol) k++;
    if (!best || k > best.inliers) best = { n, off, inliers: k };
  }
  return best;
}

interface Pass {
  width: number;
  depth: number;
  height: number;
  ceilingSeen: boolean;
  floorOk: boolean;
}

/** One estimate for one (fov, shift, ceiling guess) triple; the heights are returned in metres via the scale rule. */
function onePass(map: DisparityMap, grid: { gx: number; gy: number; step: number }, fovDeg: number, shift: number, scaleOf: (rel: { up: V3; floorOff: number; right: V3; fwd: V3; pts: V3[]; uv: Array<[number, number]>; relHeight: number }) => number | null, standoff: number): Pass | null {
  const { gx, gy } = grid;
  const raw: number[] = [];
  for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) raw.push(Number(map.data[Math.min(map.height - 1, Math.floor(((j + 0.5) * map.height) / gy)) * map.width + Math.min(map.width - 1, Math.floor(((i + 0.5) * map.width) / gx))]));
  const s = sortedCopy(raw);
  const lo = pct(s, 0.02);
  const hi = pct(s, 0.98);
  if (!(hi - lo > 1e-9)) return null;
  const tan = Math.tan((fovDeg * Math.PI) / 360);
  const aspect = map.width / map.height;
  const pts: V3[] = [];
  const uv: Array<[number, number]> = [];
  for (let j = 0; j < gy; j++) {
    for (let i = 0; i < gx; i++) {
      const d = Math.min(1, Math.max(0, ((raw[j * gx + i] as number) - lo) / (hi - lo)));
      const z = 1 / (d + shift);
      const u = (i + 0.5) / gx;
      const v = (j + 0.5) / gy;
      pts.push([(u - 0.5) * 2 * tan * z, ((0.5 - v) * 2 * tan * z) / aspect, z]);
      uv.push([u, v]);
    }
  }
  // Floor: lower third, normal within 40 degrees of straight up.
  const low = pts.filter((_, k) => (uv[k] as [number, number])[1] > 0.66);
  const spread = sortedCopy(pts.map((p) => p[2]));
  const tol = 0.04 * (pct(spread, 0.9) - pct(spread, 0.1));
  const floor = fitFloor(low, [0, 1, 0], 40, tol);
  const floorOk = !!floor && floor.inliers >= 0.2 * low.length;
  const up: V3 = floorOk ? (floor as { n: V3 }).n : [0, 1, 0];
  const floorOff = floorOk ? (floor as { off: number }).off : pct(sortedCopy(low.map((p) => dot(up, p))), 0.5);
  const heights = pts.map((p) => dot(up, p) - floorOff);
  const hs = sortedCopy(heights);
  const relHeight = pct(hs, 0.97);
  // Ceiling seen: a flat band of points near the top height among the upper rows.
  const upper = heights.filter((_, k) => (uv[k] as [number, number])[1] < 0.4);
  const near = upper.filter((h) => Math.abs(h - relHeight) < 0.06 * relHeight).length;
  const ceilingSeen = relHeight > 0 && near >= 0.04 * pts.length;
  // Horizontal axes: forward is the camera axis flattened onto the floor.
  let fwd: V3 = [0, 0, 1];
  const k = dot(fwd, up);
  fwd = norm([fwd[0] - k * up[0], fwd[1] - k * up[1], fwd[2] - k * up[2]]);
  const right = norm(cross(up, fwd));
  const scale = scaleOf({ up, floorOff, right, fwd, pts, uv, relHeight });
  if (scale === null || !(scale > 0) || !Number.isFinite(scale)) return null;
  const wall: number[] = [];
  const along: number[] = [];
  for (let n = 0; n < pts.length; n++) {
    const h = heights[n] as number;
    if (h < 0.12 * relHeight || h > 0.88 * relHeight) continue;
    const p = pts[n] as V3;
    wall.push(dot(right, p));
    along.push(dot(fwd, p));
  }
  if (wall.length < 20) return null;
  const w = sortedCopy(wall);
  const a = sortedCopy(along);
  return {
    width: (pct(w, 0.98) - pct(w, 0.02)) * scale,
    depth: pct(a, 0.96) * scale + standoff,
    height: relHeight * scale,
    ceilingSeen,
    floorOk,
  };
}

/** Median, low and high of a list, rounded to centimetres. */
function band(v: number[]): { value: number; low: number; high: number } {
  const s = sortedCopy(v);
  const r = (x: number): number => Math.round(x * 100) / 100;
  return { value: r(pct(s, 0.5)), low: r(pct(s, 0.1)), high: r(pct(s, 0.9)) };
}

/** Width, depth and height of the room from a relative depth map; null when the map holds no usable structure. */
export function estimateRoomFromDepth(map: DisparityMap, opts: EstimateOptions = {}): RoomDepthEstimate | null {
  if (map.width < 8 || map.height < 8) return null;
  const aspect = map.width / map.height;
  const gy = Math.max(8, Math.round(GRID / Math.max(1, aspect)));
  const gx = Math.max(8, Math.round(gy * aspect));
  const grid = { gx, gy, step: 1 };
  const fovs = opts.fovs ?? DEFAULT_FOVS;
  const shifts = opts.shifts ?? DEFAULT_SHIFTS;
  const ceilings = opts.ceilings ?? DEFAULT_CEILINGS;
  const standoff = opts.standoff ?? 0.4;
  const anchor = opts.anchor;
  const W: number[] = [];
  const D: number[] = [];
  const H: number[] = [];
  let seen = 0;
  let floorOk = 0;
  let total = 0;
  const notes: string[] = [];
  const anchorScale = (ctx: { up: V3; right: V3; pts: V3[]; uv: Array<[number, number]> }): number | null => {
    if (!anchor) return null;
    const [x0, y0, x1, y1] = anchor.box;
    const at = (u: number, v: number): V3 => {
      // Median of the grid points within half a cell.
      const hits: V3[] = [];
      for (let n = 0; n < ctx.pts.length; n++) {
        const q = ctx.uv[n] as [number, number];
        if (Math.abs(q[0] - u) <= 0.6 / gx && Math.abs(q[1] - v) <= 0.6 / gy) hits.push(ctx.pts[n] as V3);
      }
      if (hits.length === 0) return ctx.pts[Math.min(ctx.pts.length - 1, Math.floor(v * gy) * gx + Math.floor(u * gx))] as V3;
      return [0, 1, 2].map((c) => pct(sortedCopy(hits.map((h) => h[c] as number)), 0.5)) as V3;
    };
    const cu = (x0 + x1) / 2;
    const cv = (y0 + y1) / 2;
    const [a, b] = anchor.axis === 'height' ? [at(cu, y0 + 0.02 * (y1 - y0)), at(cu, y1 - 0.02 * (y1 - y0))] : [at(x0 + 0.02 * (x1 - x0), cv), at(x1 - 0.02 * (x1 - x0), cv)];
    const axis = anchor.axis === 'height' ? ctx.up : ctx.right;
    const rel = Math.abs(dot(axis, a) - dot(axis, b));
    return rel > 1e-6 ? anchor.sizeM / rel : null;
  };
  for (const fov of fovs) {
    for (const shift of shifts) {
      const list = anchor ? [0] : ceilings;
      for (const ceil of list) {
        const r = onePass(map, grid, fov, shift, (c) => (anchor ? anchorScale(c) : ceil / c.relHeight), standoff);
        total++;
        if (!r) continue;
        W.push(r.width);
        D.push(r.depth);
        H.push(r.height);
        if (r.ceilingSeen) seen++;
        if (r.floorOk) floorOk++;
      }
    }
  }
  if (W.length < Math.max(3, total / 3)) return null;
  const ceilingSeen = seen >= W.length / 2;
  const floorFit = floorOk >= W.length / 2;
  if (!floorFit) notes.push('the floor plane did not fit well (little floor in view, or a strong tilt): heights and widths are rougher');
  if (!ceilingSeen) notes.push(anchor ? 'the ceiling is not clearly in the picture, so the room height is a lower bound' : 'the ceiling is not clearly in the picture, so the metric scale (and every number) is a guess from a standard ceiling height');
  notes.push('width is the span seen across the photo: a lower bound when the side walls are out of frame');
  if (!anchor) notes.push(`no anchor given: scale from a ceiling of ${Math.min(...ceilings)} to ${Math.max(...ceilings)} m; name a door, bed or counter with its box to pin it`);
  const basis: 'anchor' | 'ceiling' = anchor ? 'anchor' : 'ceiling';
  return {
    width: band(W),
    depth: band(D),
    height: band(H),
    scale: { basis, text: anchor ? `${anchor.name} ${anchor.axis} = ${anchor.sizeM} m (box ${anchor.box.map((v) => v.toFixed(2)).join(', ')})` : `floor to ceiling assumed ${Math.min(...ceilings)} to ${Math.max(...ceilings)} m` },
    confidence: ceilingSeen && floorFit ? 'medium' : 'low',
    notes,
  };
}

/** One advisory paragraph for the model: the numbers, the range, the anchor and the caveats. */
export function depthAdvisoryText(e: RoomDepthEstimate, guess?: { width: number; depth: number; ceiling?: number }): string {
  const f = (b: { value: number; low: number; high: number }): string => `${b.value} m (${b.low} to ${b.high})`;
  const lines = [
    `Depth estimate from the photo (advisory, you decide; confidence ${e.confidence}): width ${f(e.width)}, depth ${f(e.depth)}, height ${f(e.height)}. Scale from ${e.scale.text}.`,
  ];
  if (guess) lines.push(`Your reading: ${guess.width} m wide, ${guess.depth} m deep${guess.ceiling ? `, ${guess.ceiling} m high` : ''}.`);
  if (e.notes.length > 0) lines.push(`Caveats: ${e.notes.join('; ')}.`);
  lines.push('A single-photo depth network is up to scale and a wide lens bends it; treat a gap of more than 0.5 m to your reading as a reason to look again at the walls, not as an order.');
  return lines.join('\n');
}
