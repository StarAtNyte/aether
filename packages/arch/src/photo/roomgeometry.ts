/**
 * Room geometry from a METRIC depth map (metres per pixel): a pinhole camera of a field of view found by sweeping,
 * a RANSAC floor plane (gives "up" and the camera height), a ceiling plane, the walls as lines in the top-down view
 * (rooms are rectangular, so the two wall directions are 90 degrees apart), and the room box (width, depth, height, each
 * with a range and a confidence). Objects are back-projected from their masks to room coordinates. Pure and
 * deterministic (a fixed pseudo-random sequence); no model, no photo pixels. Advisory evidence for a model.
 *
 * Room frame: `x` metres from the left wall (to the right as the camera looks), `z` metres from the back wall toward the
 * camera, `y` metres above the floor. Camera frame: x right, y up, z forward.
 */

export interface DepthGrid {
  width: number;
  height: number;
  /** Metres. */
  data: ArrayLike<number>;
}
export interface Cam {
  fovDeg: number;
  /** Focal length in pixels of the depth grid. */
  f: number;
  cx: number;
  cy: number;
  /** 'z': the map holds the distance along the optical axis; 'ray': the distance along the pixel ray. */
  kind: 'z' | 'ray';
}
type V3 = [number, number, number];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export function makeCam(grid: { width: number; height: number }, fovDeg: number, kind: 'z' | 'ray' = 'z'): Cam {
  return { fovDeg, f: grid.width / 2 / Math.tan((fovDeg * Math.PI) / 360), cx: grid.width / 2, cy: grid.height / 2, kind };
}

/** Camera-space point of pixel (u, v) at depth d. */
export function unproject(cam: Cam, u: number, v: number, d: number): V3 {
  const a = (u - cam.cx) / cam.f;
  const b = -(v - cam.cy) / cam.f;
  const z = cam.kind === 'z' ? d : d / Math.sqrt(1 + a * a + b * b);
  return [a * z, b * z, z];
}

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export interface Plane {
  /** Unit normal and offset: points p with n·p = d. */
  n: V3;
  d: number;
  inliers: number;
  /** Share of the candidate points that lie on it. */
  support: number;
}

/** Least-squares plane through points (smallest eigenvector of the covariance by Jacobi sweeps). */
export function fitPlane(pts: V3[]): { n: V3; d: number } | null {
  if (pts.length < 3) return null;
  const c: V3 = [0, 0, 0];
  for (const p of pts) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
  c[0] /= pts.length; c[1] /= pts.length; c[2] /= pts.length;
  const a = [[0, 0, 0], [0, 0, 0], [0, 0, 0]] as number[][];
  for (const p of pts) {
    const q = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) (a[i] as number[])[j] = ((a[i] as number[])[j] as number) + (q[i] as number) * (q[j] as number);
  }
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as number[][];
  for (let sweep = 0; sweep < 12; sweep++) {
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]] as [number, number][]) {
      const apq = (a[p] as number[])[q] as number;
      if (Math.abs(apq) < 1e-12) continue;
      const th = (((a[q] as number[])[q] as number) - ((a[p] as number[])[p] as number)) / (2 * apq);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const cs = 1 / Math.sqrt(t * t + 1);
      const sn = t * cs;
      for (let k = 0; k < 3; k++) {
        const akp = (a[k] as number[])[p] as number;
        const akq = (a[k] as number[])[q] as number;
        (a[k] as number[])[p] = cs * akp - sn * akq;
        (a[k] as number[])[q] = sn * akp + cs * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = (a[p] as number[])[k] as number;
        const aqk = (a[q] as number[])[k] as number;
        (a[p] as number[])[k] = cs * apk - sn * aqk;
        (a[q] as number[])[k] = sn * apk + cs * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = (v[k] as number[])[p] as number;
        const vkq = (v[k] as number[])[q] as number;
        (v[k] as number[])[p] = cs * vkp - sn * vkq;
        (v[k] as number[])[q] = sn * vkp + cs * vkq;
      }
    }
  }
  let mi = 0;
  for (let i = 1; i < 3; i++) if (((a[i] as number[])[i] as number) < ((a[mi] as number[])[mi] as number)) mi = i;
  const n = unit([(v[0] as number[])[mi] as number, (v[1] as number[])[mi] as number, (v[2] as number[])[mi] as number]);
  return { n, d: dot(n, c) };
}

/**
 * RANSAC plane. `accept` restricts the normal (for example: near the up axis for a floor). The threshold grows with
 * distance because depth noise does.
 */
export function ransacPlane(pts: V3[], opt: { iters?: number; thr?: number; thrPerM?: number; accept?: (n: V3) => boolean; seed?: number; tighten?: [number, number][] }): Plane | null {
  const iters = opt.iters ?? 300;
  const thr0 = opt.thr ?? 0.04;
  const thrM = opt.thrPerM ?? 0.02;
  if (pts.length < 20) return null;
  const rand = rng(opt.seed ?? 7);
  const within = (n: V3, d: number, p: V3): boolean => Math.abs(dot(n, p) - d) < thr0 + thrM * p[2];
  let best: { n: V3; d: number; count: number } | null = null;
  for (let it = 0; it < iters; it++) {
    const a = pts[Math.floor(rand() * pts.length)] as V3;
    const b = pts[Math.floor(rand() * pts.length)] as V3;
    const c = pts[Math.floor(rand() * pts.length)] as V3;
    const nn = cross(sub(b, a), sub(c, a));
    if (len(nn) < 1e-6) continue;
    const n = unit(nn);
    if (opt.accept && !opt.accept(n)) continue;
    const d = dot(n, a);
    let count = 0;
    for (const p of pts) if (within(n, d, p)) count++;
    if (!best || count > best.count) best = { n, d, count };
  }
  if (!best) return null;
  let { n, d } = best;
  // Refit on the inliers, tightening the threshold step by step: a loose threshold finds the plane despite depth noise, a tight one removes the
  // bias that nearby surfaces (a wall foot, a bed edge) put into the fit.
  const steps: [number, number][] = opt.tighten ?? [[thr0, thrM], [thr0, thrM]];
  for (const [t0, tm] of steps) {
    const inl = pts.filter((p) => Math.abs(dot(n, p) - d) < t0 + tm * p[2]);
    const f = fitPlane(inl);
    if (!f) break;
    if (opt.accept && !opt.accept(f.n)) break;
    n = f.n; d = f.d;
  }
  const inliers = pts.filter((p) => within(n, d, p)).length;
  return { n, d, inliers, support: inliers / pts.length };
}

export interface Cloud {
  /** Camera-space points with their pixel position in the depth grid. */
  p: V3[];
  u: number[];
  v: number[];
}

/** Thin the depth map to a point cloud (about `target` points). */
export function cloudOf(grid: DepthGrid, cam: Cam, target = 6000, skip?: ArrayLike<number>): Cloud {
  const step = Math.max(1, Math.round(Math.sqrt((grid.width * grid.height) / target)));
  const c: Cloud = { p: [], u: [], v: [] };
  for (let v = Math.floor(step / 2); v < grid.height; v += step) {
    for (let u = Math.floor(step / 2); u < grid.width; u += step) {
      const d = grid.data[v * grid.width + u] as number;
      if (!(d > 0.2 && d < 19.5)) continue;
      if (skip && skip[v * grid.width + u]) continue;
      c.p.push(unproject(cam, u, v, d));
      c.u.push(u);
      c.v.push(v);
    }
  }
  return c;
}

export interface RoomFrame {
  /** Unit up axis in camera space (points from the floor toward the ceiling). */
  up: V3;
  /** Horizontal unit axes in camera space: right (e_r) and forward (e_f). */
  right: V3;
  forward: V3;
  /** Camera height above the floor, metres. */
  cameraHeight: number;
  floor: Plane;
}

export function frameFromFloor(floor: Plane): RoomFrame {
  let n = floor.n;
  let d = floor.d;
  if (n[1] < 0) { n = [-n[0], -n[1], -n[2]]; d = -d; }
  // n·p = d with n pointing up: floor points are below the camera, so d is negative; height = -d.
  const fwd0: V3 = [0, 0, 1];
  const f = unit(sub(fwd0, [n[0] * dot(fwd0, n), n[1] * dot(fwd0, n), n[2] * dot(fwd0, n)]));
  const r = unit(cross(n, f));
  return { up: n, right: r, forward: f, cameraHeight: Math.abs(d), floor: { ...floor, n, d } };
}

/** Floor plane from the lower part of the picture; the normal must be within `maxTiltDeg` of the camera's up axis. */
export function findFloor(cloud: Cloud, grid: DepthGrid, maxTiltDeg = 40, notFloor?: boolean[]): Plane | null {
  const lower = cloud.p.map((_, i) => i).filter((i) => (cloud.v[i] as number) > grid.height * 0.5);
  // Furniture tops (a bed filling the lower picture) are not the floor: leave them out when enough bare floor remains.
  const bare = notFloor ? lower.filter((i) => !notFloor[i]) : lower;
  const idx = bare.length >= 150 ? bare : lower;
  const pts = idx.map((i) => cloud.p[i] as V3);
  const cos = Math.cos((maxTiltDeg * Math.PI) / 180);
  return ransacPlane(pts, { accept: (n) => Math.abs(n[1]) > cos, thr: 0.03, thrPerM: 0.015, seed: 11 });
}

export interface RoomBox {
  /** Metres, with the plausible range and how far to trust it. */
  width: Dim;
  depth: Dim;
  height: Dim;
  cameraHeight: number;
  /** Camera position in the room frame (x from the left wall, z from the back wall); null when the side walls were not both found. */
  camera: { x: number | null; z: number };
  walls: { back: boolean; left: boolean; right: boolean; ceiling: boolean; floor: boolean };
  /** Wall positions in the camera's top-down axes (a to the right, b forward), as lines a*cosφ + b*sinφ = s. */
  lines: { back?: Line; left?: Line; right?: Line };
  /** Angle of the back wall's normal against the camera's forward axis, degrees (0 = looking straight at the wall). */
  yawDeg: number;
  notes: string[];
}
export interface Dim {
  value: number;
  low: number;
  high: number;
  confidence: 'high' | 'medium' | 'low';
  basis: string;
}
export interface Line {
  /** Unit normal (horizontal, in the camera's a-b plane) and offset. */
  na: number;
  nb: number;
  s: number;
  support: number;
}

interface TopDown {
  a: number[];
  b: number[];
  y: number[];
}
function topDown(cloud: Cloud, fr: RoomFrame): TopDown {
  const t: TopDown = { a: [], b: [], y: [] };
  for (const p of cloud.p) {
    t.a.push(dot(p, fr.right));
    t.b.push(dot(p, fr.forward));
    t.y.push(dot(p, fr.up) + fr.cameraHeight);
  }
  return t;
}

/** Histogram of offsets along a direction (5 cm bins) smoothed over three bins. */
function peaks(values: number[], bin = 0.05): { s: number; n: number }[] {
  if (values.length === 0) return [];
  const lo = Math.min(...values);
  const nb = Math.max(1, Math.ceil((Math.max(...values) - lo) / bin) + 1);
  const h = new Array(nb).fill(0) as number[];
  for (const x of values) { const k = Math.floor((x - lo) / bin); h[k] = (h[k] as number) + 1; }
  const sm = h.map((_, i) => (h[i - 1] ?? 0) + (h[i] as number) + (h[i + 1] ?? 0));
  const out: { s: number; n: number }[] = [];
  for (let i = 0; i < nb; i++) if ((sm[i] as number) >= (sm[i - 1] ?? 0) && (sm[i] as number) > (sm[i + 1] ?? 0)) out.push({ s: lo + (i + 0.5) * bin, n: sm[i] as number });
  return out.sort((x, y) => y.n - x.n);
}

/**
 * The wall lines and the room box from a cloud and its floor frame. `skip` marks cloud points that are not wall
 * (furniture) so they do not make false walls; wall candidates are the points between 0.3 m and `wallTop` above the floor.
 */
export function roomBoxOf(cloud: Cloud, fr: RoomFrame, opt: { notWall?: boolean[]; standoff?: number } = {}): RoomBox {
  const standoff = opt.standoff ?? 0.4;
  const notes: string[] = [];
  const t = topDown(cloud, fr);
  // Ceiling: points high above the floor on a plane parallel to it.
  const hi = cloud.p.map((_, i) => i).filter((i) => (t.y[i] as number) > 1.9);
  const ceil = ransacPlane(hi.map((i) => cloud.p[i] as V3), { accept: (n) => Math.abs(dot(n, fr.up)) > 0.96, thr: 0.05, thrPerM: 0.02, seed: 5 });
  const ceilOk = !!ceil && ceil.inliers >= 40 && ceil.support > 0.25;
  let ceilingH = 0;
  if (ceilOk && ceil) {
    // The plane n·p = d (camera at the origin); with n pointing up the ceiling is |d| above the camera.
    const d = dot(ceil.n, fr.up) > 0 ? ceil.d : -ceil.d;
    ceilingH = Math.abs(d) + fr.cameraHeight;
  }
  const wallTop = ceilOk ? ceilingH - 0.25 : 2.3;
  const cand = t.a.map((_, i) => i).filter((i) => (t.y[i] as number) > 0.3 && (t.y[i] as number) < wallTop && !(opt.notWall?.[i]));
  // Dominant wall direction: the angle whose two perpendicular offset histograms hold the most points in peaks.
  let bestPhi = 0;
  let bestScore = -1;
  const A = cand.map((i) => t.a[i] as number);
  const B = cand.map((i) => t.b[i] as number);
  for (let deg = -60; deg <= 60; deg += 2) {
    const phi = (deg * Math.PI) / 180;
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    // normal 1 near the forward axis (sinφ-heavy): n1 = (sin φ, cos φ) in (a, b); n2 = (cos φ, -sin φ)
    const p1 = peaks(A.map((a, i) => a * s + (B[i] as number) * c));
    const p2 = peaks(A.map((a, i) => a * c - (B[i] as number) * s));
    const sc = (p1[0]?.n ?? 0) + (p1[1]?.n ?? 0) * 0.3 + (p2[0]?.n ?? 0) + (p2[1]?.n ?? 0) * 0.6;
    if (sc > bestScore) { bestScore = sc; bestPhi = phi; }
  }
  const c = Math.cos(bestPhi);
  const s = Math.sin(bestPhi);
  const n1: [number, number] = [s, c]; // toward the back wall
  const n2: [number, number] = [c, -s]; // toward the right wall
  const off1 = A.map((a, i) => a * n1[0] + (B[i] as number) * n1[1]);
  const off2 = A.map((a, i) => a * n2[0] + (B[i] as number) * n2[1]);
  const minN = Math.max(15, cand.length * 0.04);
  const mk = (n: [number, number], sv: number, cnt: number): Line => ({ na: n[0], nb: n[1], s: sv, support: cnt / Math.max(1, cand.length) });
  const p1 = peaks(off1).filter((p) => p.n >= minN);
  const p2 = peaks(off2).filter((p) => p.n >= minN);
  const far1 = p1.filter((p) => p.s > 0.8).sort((x, y) => y.s - x.s);
  // Back wall: the farthest strong peak (a weak far peak is a doorway or window, so take it only with a big share).
  const back = far1.find((p) => p.n >= (p1[0]?.n ?? 0) * 0.4) ?? far1[0];
  const right = p2.filter((p) => p.s > 0.4).sort((x, y) => y.n - x.n)[0];
  const left = p2.filter((p) => p.s < -0.4).sort((x, y) => y.n - x.n)[0];
  const lines: RoomBox['lines'] = {};
  if (back) lines.back = mk(n1, back.s, back.n);
  if (right) lines.right = mk(n2, right.s, right.n);
  if (left) lines.left = mk(n2, left.s, left.n);
  const yaw = (bestPhi * 180) / Math.PI;
  if (Math.abs(yaw) > 10) notes.push(`the camera looks ${Math.abs(Math.round(yaw))} degrees off the back wall (corner view)`);

  const spanA = A.length ? [pctile(A, 0.02), pctile(A, 0.98)] : [0, 0];
  const dimW = ((): Dim => {
    if (left && right) {
      const v = right.s - left.s;
      return { value: v, low: v * 0.93, high: v * 1.07, confidence: 'high', basis: 'left and right wall planes both found' };
    }
    const sideAxis = off2.length ? [pctile(off2, 0.02), pctile(off2, 0.98)] : spanA;
    if (left || right) {
      const v = right ? right.s - Math.min(left?.s ?? Infinity, (sideAxis[0] as number)) : (left ? (sideAxis[1] as number) - left.s : 0);
      return { value: v, low: v, high: v * 1.5, confidence: 'low', basis: `${right ? 'right' : 'left'} wall found; the other side is out of frame (lower bound)` };
    }
    const v = (sideAxis[1] as number) - (sideAxis[0] as number);
    return { value: v, low: v, high: v * 1.6, confidence: 'low', basis: 'no side wall found; span of the visible points (lower bound)' };
  })();
  const dimD = ((): Dim => {
    if (back) {
      const v = back.s + standoff;
      return { value: v, low: back.s, high: back.s + 1.2, confidence: back.n > cand.length * 0.15 ? 'medium' : 'low', basis: `back wall ${back.s.toFixed(2)} m from the camera plus a ${standoff} m standoff behind it` };
    }
    const m = off1.length ? pctile(off1, 0.97) : 0;
    return { value: m + standoff, low: m, high: m + 1.6, confidence: 'low', basis: 'no back wall found; farthest visible points' };
  })();
  const dimH = ((): Dim => {
    if (ceilOk) return { value: ceilingH, low: ceilingH * 0.95, high: ceilingH * 1.05, confidence: 'medium', basis: 'ceiling plane found' };
    const top = pctile(cand.map((i) => t.y[i] as number), 0.99);
    return { value: Math.max(top, 2.4), low: Math.max(top, 2.2), high: 3.0, confidence: 'low', basis: 'ceiling not in view; highest wall points, at least 2.4 m' };
  })();
  const camX = left && right ? -left.s : null;
  return {
    width: round(dimW),
    depth: round(dimD),
    height: round(dimH),
    cameraHeight: Math.round(fr.cameraHeight * 100) / 100,
    camera: { x: camX === null ? null : Math.round(camX * 100) / 100, z: back ? Math.round((back.s) * 100) / 100 : 0 },
    walls: { back: !!back, left: !!left, right: !!right, ceiling: ceilOk, floor: true },
    lines,
    yawDeg: Math.round(yaw),
    notes,
  };
}
const round = (d: Dim): Dim => ({ ...d, value: r2(d.value), low: r2(d.low), high: r2(d.high) });
const r2 = (v: number): number => Math.round(v * 100) / 100;
function pctile(v: number[], p: number): number {
  const s = v.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))] as number;
}

/**
 * Pick the field of view: sweep, and keep the one whose floor is flattest and whose walls are the most rectangular
 * (share of wall points in the four wall peaks). The sweep is reported as the range because a single photo fixes the
 * field of view only loosely.
 */
export function solveCamera(grid: DepthGrid, opt: { fovs?: number[]; notWall?: ArrayLike<number>; kinds?: ('z' | 'ray')[]; trainedFovDeg?: number } = {}): { cam: Cam; fr: RoomFrame; box: RoomBox; cloud: Cloud; sweep: { fov: number; kind: string; score: number }[]; grid: DepthGrid } | null {
  const fovs = opt.fovs ?? [52, 56, 60, 64, 68, 72, 76, 80, 86];
  type Cand = { cam: Cam; fr: RoomFrame; box: RoomBox; cloud: Cloud; score: number; grid: DepthGrid };
  const cands: Cand[] = [];
  const sweep: { fov: number; kind: string; score: number }[] = [];
  for (const kind of opt.kinds ?? ['z']) {
    for (const fov of fovs) {
      const cam = makeCam(grid, fov, kind);
      // A network trained on one camera (Hypersim: 60 degrees) reads a wider photo as farther away: objects look smaller, so it puts them
      // deeper at the same size, while their sideways positions stay right. Dividing the depth by tan(fov/2) / tan(trained/2) undoes that.
      const g = opt.trainedFovDeg ? scaleDepth(grid, Math.tan((opt.trainedFovDeg * Math.PI) / 360) / Math.tan((fov * Math.PI) / 360)) : grid;
      const cloud = cloudOf(g, cam);
      const notWall = opt.notWall ? cloud.p.map((_, i) => !!opt.notWall![(cloud.v[i] as number) * grid.width + (cloud.u[i] as number)]) : undefined;
      const floor = findFloor(cloud, grid, 40, notWall);
      if (!floor || floor.support < 0.2) continue;
      const fr = frameFromFloor(floor);
      const box = roomBoxOf(cloud, fr, notWall ? { notWall } : {});
      const wallShare = (box.lines.back?.support ?? 0) + (box.lines.left?.support ?? 0) + (box.lines.right?.support ?? 0);
      // a realistic camera height (0.8 - 2.1 m), a flat floor and rectilinear walls; and a mild pull toward the field of view of a phone or
      // compact camera (about 66 degrees), because the sweep alone cannot tell neighbouring angles apart.
      const hPenalty = fr.cameraHeight < 0.8 || fr.cameraHeight > 2.1 ? 0.25 : 0;
      const prior = (Math.abs(fov - 66) / 100) * 0.4;
      // For a camera aligned with the walls the planes are equally flat at every field of view (it only scales width and height), so the
      // ceiling height is what pins it: a ceiling in view should read about 2.6 m (2.3 to 3.2 is ordinary), and without one the camera
      // height should be about 1.4 m.
      const heightPrior = opt.trainedFovDeg ? 0 : box.walls.ceiling ? Math.min(1, Math.abs(Math.log(box.height.value / 2.6))) * 0.8 : Math.min(1, Math.abs(Math.log(fr.cameraHeight / 1.4))) * 0.2;
      const score = floor.support + wallShare - hPenalty - prior - heightPrior;
      sweep.push({ fov, kind, score: r2(score) });
      cands.push({ cam, fr, box, cloud, score, grid: g });
    }
  }
  if (cands.length === 0) return null;
  cands.sort((a, b) => b.score - a.score);
  const best = cands[0] as Cand;
  // The field of view is only loosely fixed by one photo, so the reported size is the median over the plausible fields of view
  // and its range is their spread (a wide range lowers the confidence).
  const band = cands.filter((c) => c.score >= best.score - 0.1);
  const med = (v: number[]): number => pctile(v, 0.5);
  const merge = (pick: (b: RoomBox) => Dim): Dim => {
    const ds = band.map((c) => pick(c.box));
    const value = med(ds.map((d) => d.value));
    const low = Math.min(...ds.map((d) => d.low));
    const high = Math.max(...ds.map((d) => d.high));
    const own = pick(best.box);
    const spread = (Math.max(...ds.map((d) => d.value)) - Math.min(...ds.map((d) => d.value))) / Math.max(0.1, value);
    const confidence: Dim['confidence'] = spread > 0.3 ? 'low' : own.confidence;
    const fv = band.map((c) => c.cam.fovDeg);
    return round({ value, low, high, confidence, basis: `${own.basis}; median over fields of view ${Math.min(...fv)}-${Math.max(...fv)} degrees (spread ${Math.round(spread * 100)}%)` });
  };
  const box: RoomBox = { ...best.box, width: merge((b) => b.width), depth: merge((b) => b.depth), height: merge((b) => b.height) };
  return { cam: best.cam, fr: best.fr, box, cloud: best.cloud, sweep, grid: best.grid };
}

function scaleDepth(g: DepthGrid, k: number): DepthGrid {
  const out = new Float32Array(g.width * g.height);
  for (let i = 0; i < out.length; i++) out[i] = (g.data[i] as number) * k;
  return { width: g.width, height: g.height, data: out };
}

// ---- objects ----

export interface Placement {
  /** Where on the room the object stands or hangs. */
  kind: 'floor' | 'wall' | 'surface' | 'ceiling';
  /** Room-frame centre of the visible surface (x from the left wall when known, z from the back wall); camera frame otherwise. */
  centre: { x: number; z: number; frame: 'room' | 'camera' };
  /** Visible extents in metres: width (along the wall axis), depth (toward the camera, visible part only), height. */
  size: { w: number; d: number; h: number };
  /** Height above the floor of the lowest and highest visible points. */
  y: { low: number; high: number };
  /** Distance to the camera along the floor, metres. */
  range: number;
  /** Walls the object is within 0.3 m of (gap in metres). */
  against: { wall: 'back' | 'left' | 'right'; gap: number }[];
  /** How many mask pixels had depth. */
  samples: number;
}

/** Back-project an object's mask (at the depth grid's size) to room coordinates. */
export function placeObject(mask: ArrayLike<number>, grid: DepthGrid, cam: Cam, fr: RoomFrame, box: RoomBox, label = ''): Placement | null {
  const pts: V3[] = [];
  for (let v = 0; v < grid.height; v++) {
    for (let u = 0; u < grid.width; u++) {
      if (!mask[v * grid.width + u]) continue;
      const d = grid.data[v * grid.width + u] as number;
      if (!(d > 0.2 && d < 19.5)) continue;
      pts.push(unproject(cam, u, v, d));
    }
  }
  if (pts.length < 8) return null;
  // trim the depth tails (mask edges blend with what is behind)
  const rng0 = pts.map((p) => p[2]).sort((a, b) => a - b);
  const lo = rng0[Math.floor(rng0.length * 0.05)] as number;
  const hi = rng0[Math.floor(rng0.length * 0.9)] as number;
  const keep = pts.filter((p) => p[2] >= lo && p[2] <= hi);
  const q = keep.length >= 8 ? keep : pts;
  const A = q.map((p) => dot(p, fr.right));
  const Bf = q.map((p) => dot(p, fr.forward));
  const Y = q.map((p) => dot(p, fr.up) + fr.cameraHeight);
  const back = box.lines.back;
  const left = box.lines.left;
  const right = box.lines.right;
  // Express offsets along the wall axes (n1 toward the back wall, n2 toward the right wall) when a wall is known.
  const phi = (box.yawDeg * Math.PI) / 180;
  const n1: [number, number] = [Math.sin(phi), Math.cos(phi)];
  const n2: [number, number] = [Math.cos(phi), -Math.sin(phi)];
  const o1 = A.map((a, i) => a * n1[0] + (Bf[i] as number) * n1[1]);
  const o2 = A.map((a, i) => a * n2[0] + (Bf[i] as number) * n2[1]);
  const med = (v: number[]): number => pctile(v, 0.5);
  const y0 = pctile(Y, 0.04);
  const y1 = pctile(Y, 0.96);
  const w = pctile(o2, 0.96) - pctile(o2, 0.04);
  const dd = pctile(o1, 0.96) - pctile(o1, 0.04);
  const wallish = /(painting|picture|frame|mirror|curtain|window|clock|tv|television|screen|shelf|poster|sconce|light|lamp|vent|sprinkler|detector|rail|radiator|switch|blind)/.test(label);
  const base: Placement['kind'] = y0 > 1.7 ? 'ceiling' : wallish && y0 > 0.25 ? 'wall' : y0 > 0.6 ? 'surface' : 'floor';
  const centreO1 = med(o1);
  const centreO2 = med(o2);
  const centre: Placement['centre'] = back && left ? { x: r2(centreO2 - left.s), z: r2(back.s - centreO1), frame: 'room' } : { x: r2(centreO2), z: r2(back ? back.s - centreO1 : centreO1), frame: 'camera' };
  const against: Placement['against'] = [];
  if (back) { const gap = back.s - pctile(o1, 0.97); if (gap < 0.3) against.push({ wall: 'back', gap: r2(Math.max(0, gap)) }); }
  if (left) { const gap = pctile(o2, 0.03) - left.s; if (gap < 0.3) against.push({ wall: 'left', gap: r2(Math.max(0, gap)) }); }
  if (right) { const gap = right.s - pctile(o2, 0.97); if (gap < 0.3) against.push({ wall: 'right', gap: r2(Math.max(0, gap)) }); }
  return { kind: base, centre, size: { w: r2(w), d: r2(dd), h: r2(y1 - y0) }, y: { low: r2(y0), high: r2(y1) }, range: r2(Math.hypot(med(A), med(Bf))), against, samples: pts.length };
}
