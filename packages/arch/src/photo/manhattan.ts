/**
 * Camera from vanishing points (Manhattan world): a room is made of lines along three perpendicular directions (two horizontal
 * wall directions and the vertical). Each image segment and the camera centre span a plane whose normal is perpendicular to the
 * segment's 3D direction, so a camera (field of view, pitch, yaw, roll) is scored by how many segments (weighted by length)
 * are consistent with one of the three axes it implies. A coarse grid search is refined by coordinate descent. The field of
 * view is only loosely fixed when the camera looks straight along the room (the two horizontal families then converge to
 * one finite point or none), so the near-optimal set is returned as a range. Pure arithmetic; advisory.
 */
import type { Segment } from './lines';

export interface ManhattanCamera {
  fovDeg: number;
  /** Plausible range of the horizontal field of view (near-optimal solutions). */
  fovRange: [number, number];
  /** Positive pitch looks DOWN (the room's up axis tilts toward the camera's backward direction). Degrees. */
  pitchDeg: number;
  /** Rotation of the room's horizontal axes about the vertical, in -45..45 (the wall nearest the optical axis is the back wall). */
  yawDeg: number;
  rollDeg: number;
  /** Share of the segment length explained by each axis: [vertical, wall direction near the optical axis, wall direction across]. */
  support: [number, number, number];
  /** Total share of segment length that is consistent with an axis (0..1). */
  explained: number;
  /** Camera axes in camera coordinates (x right, y up, z forward): vertical, along the back wall normal, across. */
  axes: { up: [number, number, number]; depth: [number, number, number]; across: [number, number, number] };
  segmentsUsed: number;
}

type V3 = [number, number, number];
const rad = (d: number): number => (d * Math.PI) / 180;

/** Rotation columns (the room axes in camera coordinates) for yaw (about up), pitch (about right), roll (about forward). */
function axesOf(yaw: number, pitch: number, roll: number): { up: V3; depth: V3; across: V3 } {
  // Start with the room aligned to the camera: across = x, up = y, depth = z. Rotate the room by yaw about y, then the camera pitches about x, then rolls about z.
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  const rot = (v: V3): V3 => {
    // yaw about y
    let x = cy * v[0] + sy * v[2];
    let y = v[1];
    let z = -sy * v[0] + cy * v[2];
    // pitch about x (positive: the camera looks down, so the room's up axis gains a -z component)
    const y2 = cp * y + sp * z;
    const z2 = -sp * y + cp * z;
    y = y2; z = z2;
    // roll about z
    const x3 = cr * x - sr * y;
    const y3 = sr * x + cr * y;
    x = x3; y = y3;
    return [x, y, z];
  };
  return { across: rot([1, 0, 0]), up: rot([0, 1, 0]), depth: rot([0, 0, 1]) };
}

interface Prepared {
  n: V3[];
  w: number[];
}
function prepare(segs: readonly Segment[], width: number, height: number, fovDeg: number): Prepared {
  const f = width / 2 / Math.tan(rad(fovDeg) / 2);
  const n: V3[] = [];
  const w: number[] = [];
  for (const s of segs) {
    const a: V3 = [(s.x1 - width / 2) / f, -(s.y1 - height / 2) / f, 1];
    const b: V3 = [(s.x2 - width / 2) / f, -(s.y2 - height / 2) / f, 1];
    const c: V3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const l = Math.hypot(c[0], c[1], c[2]);
    if (l < 1e-9) continue;
    n.push([c[0] / l, c[1] / l, c[2] / l]);
    w.push(s.length * Math.min(2, 0.5 + s.contrast / 40));
  }
  return { n, w };
}

function score(p: Prepared, ax: { up: V3; depth: V3; across: V3 }, sigma: number): { total: number; per: [number, number, number] } {
  const per: [number, number, number] = [0, 0, 0];
  const A = [ax.up, ax.depth, ax.across];
  for (let i = 0; i < p.n.length; i++) {
    const n = p.n[i] as V3;
    let best = 0;
    let bi = 0;
    for (let k = 0; k < 3; k++) {
      const a = A[k] as V3;
      const r = Math.abs(n[0] * a[0] + n[1] * a[1] + n[2] * a[2]);
      const s = Math.exp(-0.5 * (r / sigma) ** 2);
      if (s > best) { best = s; bi = k; }
    }
    per[bi] = (per[bi] as number) + (p.w[i] as number) * best;
  }
  return { total: per[0] + per[1] + per[2], per };
}

export function solveManhattan(segs: readonly Segment[], width: number, height: number, opt: { fovPriorDeg?: number; fovPriorWeight?: number } = {}): ManhattanCamera | null {
  if (segs.length < 8) return null;
  const sigma = Math.sin(rad(1.6));
  const totalW = segs.reduce((s, x) => s + x.length * Math.min(2, 0.5 + x.contrast / 40), 0);
  const prior = opt.fovPriorDeg ?? 66;
  const prepared = new Map<number, Prepared>();
  const prep = (fov: number): Prepared => {
    const key = Math.round(fov * 10);
    let p = prepared.get(key);
    if (!p) { p = prepare(segs, width, height, fov); prepared.set(key, p); }
    return p;
  };
  const penalty = (fov: number): number => totalW * 0.04 * (opt.fovPriorWeight ?? 1) * ((fov - prior) / 30) ** 2;
  const evalAt = (fov: number, yaw: number, pitch: number, roll: number): { total: number; per: [number, number, number] } => {
    const s = score(prep(fov), axesOf(rad(yaw), rad(pitch), rad(roll)), sigma);
    return { total: s.total - penalty(fov), per: s.per };
  };
  type St = { fov: number; yaw: number; pitch: number; roll: number; total: number; per: [number, number, number] };
  const all: St[] = [];
  let best: St | null = null;
  for (let fov = 50; fov <= 105; fov += 5) for (let pitch = -40; pitch <= 40; pitch += 4) for (let yaw = -45; yaw <= 45; yaw += 5) for (let roll = -6; roll <= 6; roll += 3) {
    const s = evalAt(fov, yaw, pitch, roll);
    const st = { fov, yaw, pitch, roll, ...s };
    all.push(st);
    if (!best || st.total > best.total) best = st;
  }
  if (!best) return null;
  // refine around the best few distinct starts
  const starts = all.sort((a, b) => b.total - a.total).slice(0, 6);
  let cur: St = best;
  const refine = (st: St): St => {
    let c = st;
    for (const [df, dy, dp, dr] of [[4, 4, 3, 2], [2, 2, 1.5, 1], [1, 1, 0.7, 0.5], [0.5, 0.5, 0.3, 0.25]] as const) {
      for (let it = 0; it < 6; it++) {
        let improved = false;
        for (const [a, b, d, e] of [[df, 0, 0, 0], [-df, 0, 0, 0], [0, dy, 0, 0], [0, -dy, 0, 0], [0, 0, dp, 0], [0, 0, -dp, 0], [0, 0, 0, dr], [0, 0, 0, -dr]] as const) {
          const fov = Math.max(48, Math.min(110, c.fov + a));
          const s = evalAt(fov, c.yaw + b, c.pitch + d, c.roll + e);
          if (s.total > c.total + 1e-6) { c = { fov, yaw: c.yaw + b, pitch: c.pitch + d, roll: c.roll + e, ...s }; improved = true; }
        }
        if (!improved) break;
      }
    }
    return c;
  };
  const refined = starts.map(refine).sort((a, b) => b.total - a.total);
  cur = refined[0] as St;
  // Field-of-view range: fovs whose best score (over orientation, from the refined start) is within 4 percent of the best.
  const fovScores: { fov: number; total: number }[] = [];
  for (let fov = 50; fov <= 105; fov += 5) {
    let bt = -Infinity;
    for (const dy of [-6, -3, 0, 3, 6]) for (const dp of [-3, 0, 3]) bt = Math.max(bt, evalAt(fov, cur.yaw + dy, cur.pitch + dp, cur.roll).total);
    fovScores.push({ fov, total: bt });
  }
  const near = fovScores.filter((x) => x.total >= cur.total - totalW * 0.03).map((x) => x.fov);
  let yaw = cur.yaw;
  // fold the yaw into -45..45
  while (yaw > 45) yaw -= 90;
  while (yaw < -45) yaw += 90;
  const ax = axesOf(rad(cur.yaw), rad(cur.pitch), rad(cur.roll));
  const tot = cur.per[0] + cur.per[1] + cur.per[2];
  return {
    fovDeg: Math.round(cur.fov * 10) / 10,
    fovRange: [Math.min(...near, cur.fov), Math.max(...near, cur.fov)],
    pitchDeg: Math.round(cur.pitch * 10) / 10,
    yawDeg: Math.round(yaw * 10) / 10,
    rollDeg: Math.round(cur.roll * 10) / 10,
    support: [cur.per[0] / (totalW || 1), cur.per[1] / (totalW || 1), cur.per[2] / (totalW || 1)].map((v) => Math.round(v * 1000) / 1000) as [number, number, number],
    explained: Math.round((tot / (totalW || 1)) * 1000) / 1000,
    axes: ax,
    segmentsUsed: segs.length,
  };
}
