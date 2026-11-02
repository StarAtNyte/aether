/**
 * A posed, draped classical human as a signed distance field (the `figure` node of `api.sdf`).
 *
 * Units are metres of a NOMINAL 2.0 m figure: sole at y = 0, crown at y ≈ 2.0, facing +Z, the figure's RIGHT side
 * toward -X. Arms and legs are solved by two-bone IK from wrist/ankle targets; garments (peplos, chiton, himation,
 * chlamys, lap drape) are fields wrapped round the body with irregular tubular folds. Fully deterministic: all
 * variation comes from hashes of `seed`.
 *
 * Ported from athen (MIT License, Copyright (c) 2026 Leon Lin): src/sculpt/figure.js, face.js and sdf.js. Changes:
 * typed, angles taken in degrees, hot paths rewritten without per-sample allocation, the separate fine-hand
 * region, helmets and prop callbacks dropped (props are ordinary nodes of the SDF tree), `seat` added.
 */

export type V3 = [number, number, number];
/** Row-major 3x3 rotation. */
type M3 = [number, number, number, number, number, number, number, number, number];
type Fn = (x: number, y: number, z: number) => number;
interface Part { f: Fn; c: V3; r: number; k?: number; sub?: boolean }

// ------------------------------------------------------------------ scalar helpers
const TAU = Math.PI * 2;
const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const sstep = (a: number, b: number, x: number): number => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const smin = (a: number, b: number, k: number): number => { if (k <= 0) return Math.min(a, b); const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
export const smax = (a: number, b: number, k: number): number => { if (k <= 0) return Math.max(a, b); const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; };
const hash1 = (n: number): number => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return s - Math.floor(s); };

// ------------------------------------------------------------------ primitives (shared with the tree compiler)
export function sdBox(x: number, y: number, z: number, bx: number, by: number, bz: number): number {
  const qx = Math.abs(x) - bx, qy = Math.abs(y) - by, qz = Math.abs(z) - bz;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0);
}
export const sdRoundBox = (x: number, y: number, z: number, bx: number, by: number, bz: number, r: number): number => sdBox(x, y, z, bx - r, by - r, bz - r) - r;
/** Capsule between a and b with radius r. */
export function sdCapsule(x: number, y: number, z: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number): number {
  const pax = x - ax, pay = y - ay, paz = z - az, bax = bx - ax, bay = by - ay, baz = bz - az;
  const l2 = bax * bax + bay * bay + baz * baz;
  const h = l2 > 0 ? clamp((pax * bax + pay * bay + paz * baz) / l2, 0, 1) : 0;
  return Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h) - r;
}
/** Tapered capsule (round cone) from a (radius ra) to b (radius rb). Callers keep |ra - rb| below the length. */
export function sdRoundCone(x: number, y: number, z: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, ra: number, rb: number): number {
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const l2 = bax * bax + bay * bay + baz * baz, rr = ra - rb, a2 = l2 - rr * rr, il2 = 1 / l2;
  const pax = x - ax, pay = y - ay, paz = z - az;
  const yv = pax * bax + pay * bay + paz * baz, zv = yv - l2;
  const cx = pax * l2 - bax * yv, cy = pay * l2 - bay * yv, cz = paz * l2 - baz * yv;
  const x2 = cx * cx + cy * cy + cz * cz, y2 = yv * yv * l2, z2 = zv * zv * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(zv) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - rb;
  if (Math.sign(yv) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - ra;
  return (Math.sqrt(x2 * a2 * il2) + yv * rr) * il2 - ra;
}
export function sdEllipsoid(x: number, y: number, z: number, rx: number, ry: number, rz: number): number {
  const k0 = Math.hypot(x / rx, y / ry, z / rz), k1 = Math.hypot(x / (rx * rx), y / (ry * ry), z / (rz * rz));
  return k1 === 0 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}
/** Vertical cylinder centred at the origin, half-height h. */
export function sdCylinder(x: number, y: number, z: number, r: number, h: number): number {
  const dx = Math.hypot(x, z) - r, dy = Math.abs(y) - h;
  return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
}
/** Torus lying flat in XZ. */
export const sdTorus = (x: number, y: number, z: number, R: number, r: number): number => Math.hypot(Math.hypot(x, z) - R, y) - r;

const cone = (x: number, y: number, z: number, a: V3, b: V3, ra: number, rb: number): number => sdRoundCone(x, y, z, a[0], a[1], a[2], b[0], b[1], b[2], ra, rb);
function ellipse2(x: number, z: number, rx: number, rz: number): number {
  const k0 = Math.hypot(x / rx, z / rz), k1 = Math.hypot(x / (rx * rx), z / (rz * rz));
  return k1 === 0 ? -Math.min(rx, rz) : (k0 * (k0 - 1)) / k1;
}
/** Ellipsoid in a rotated frame: m = world→local rotation, c = centre. */
function ellipsoidR(x: number, y: number, z: number, c: V3, m: M3, rx: number, ry: number, rz: number): number {
  const dx = x - c[0], dy = y - c[1], dz = z - c[2];
  return sdEllipsoid(m[0] * dx + m[1] * dy + m[2] * dz, m[3] * dx + m[4] * dy + m[5] * dz, m[6] * dx + m[7] * dy + m[8] * dz, rx, ry, rz);
}

// ------------------------------------------------------------------ vectors and rotations (setup only)
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const mix3 = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
function rotX(a: number): M3 { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; }
function rotY(a: number): M3 { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; }
function rotZ(a: number): M3 { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; }
function mmul(a: M3, b: M3): M3 {
  const r = [0, 0, 0, 0, 0, 0, 0, 0, 0] as M3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = (a[i * 3] as number) * (b[j] as number) + (a[i * 3 + 1] as number) * (b[3 + j] as number) + (a[i * 3 + 2] as number) * (b[6 + j] as number);
  return r;
}
const mT = (a: M3): M3 => [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];
/** Yaw about Y, pitch about X, roll about Z: R = Ry · Rx · Rz. */
const euler = (yaw: number, pitch: number, roll: number): M3 => mmul(rotY(yaw), mmul(rotX(pitch), rotZ(roll)));
const mv = (m: M3, x: number, y: number, z: number): V3 => [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
/** Frame whose local +Y points along `dir` and local +Z is as close as possible to `fwd` (local→world). */
function frameY(dir: V3, fwd: V3 = [0, 0, 1]): M3 {
  const y = norm(dir);
  let z = sub(fwd, scale(y, dot(fwd, y)));
  if (len(z) < 1e-4) z = sub([1, 0, 0], scale(y, y[0]));
  z = norm(z);
  const x = cross(y, z);
  return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
}

// ------------------------------------------------------------------ deterministic value noise
function h3(i: number, j: number, k: number): number {
  let n = Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(k, 83492791);
  n = Math.imul(n ^ (n >>> 13), 0x5bd1e995);
  n ^= n >>> 15;
  return (n >>> 0) / 4294967296;
}
function vnoise3(x: number, y: number, z: number): number {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  const fx = x - i, fy = y - j, fz = z - k;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const a = lerp(h3(i, j, k), h3(i + 1, j, k), ux), b = lerp(h3(i, j + 1, k), h3(i + 1, j + 1, k), ux);
  const c = lerp(h3(i, j, k + 1), h3(i + 1, j, k + 1), ux), d = lerp(h3(i, j + 1, k + 1), h3(i + 1, j + 1, k + 1), ux);
  return lerp(lerp(a, b, uy), lerp(c, d, uy), uz) * 2 - 1;
}

// ------------------------------------------------------------------ bounded smooth union of parts
/** Smooth union of parts with bounding-sphere culling (a part far from the running distance is skipped). */
class Group {
  parts: Part[] = [];
  c: V3 = [0, 0, 0];
  r = 0;
  constructor(readonly k: number) {}
  add(p: Part): this {
    this.parts.push(p);
    const mn: V3 = [Infinity, Infinity, Infinity], mx: V3 = [-Infinity, -Infinity, -Infinity];
    for (const q of this.parts) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i] as number, (q.c[i] as number) - q.r); mx[i] = Math.max(mx[i] as number, (q.c[i] as number) + q.r); }
    this.c = mix3(mn, mx, 0.5);
    this.r = len(sub(mx, mn)) * 0.5;
    return this;
  }
  eval(x: number, y: number, z: number): number {
    let d = 1e9;
    const parts = this.parts;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i] as Part;
      const k = p.k ?? this.k;
      const dx = x - p.c[0], dy = y - p.c[1], dz = z - p.c[2];
      const dd = dx * dx + dy * dy + dz * dz;
      if (p.sub) {
        const t = p.r + k;
        if (dd > t * t) continue;
        d = smax(d, -p.f(x, y, z), k);
        continue;
      }
      const t = d + k + p.r;
      if (dd > t * t) continue;
      d = smin(d, p.f(x, y, z), k);
    }
    return d;
  }
  /** Distance to the bounding sphere (a cheap lower bound). */
  bound(x: number, y: number, z: number): number { return Math.hypot(x - this.c[0], y - this.c[1], z - this.c[2]) - this.r; }
}
/** Evaluate a group only when its bounding sphere is closer than lim (else the bound). */
function evalB(g: Group, x: number, y: number, z: number, lim: number): number { const b = g.bound(x, y, z); return b > lim ? b : g.eval(x, y, z); }

const ell = (c: V3, rx: number, ry: number, rz: number, k: number, m: M3 | null = null): Part => ({
  f: m ? (x, y, z) => ellipsoidR(x, y, z, c, m, rx, ry, rz) : (x, y, z) => sdEllipsoid(x - c[0], y - c[1], z - c[2], rx, ry, rz),
  c, r: Math.max(rx, ry, rz), k,
});
const cap = (a: V3, b: V3, ra: number, rb: number, k: number): Part => ({ f: (x, y, z) => cone(x, y, z, a, b, ra, rb), c: mix3(a, b, 0.5), r: len(sub(b, a)) * 0.5 + Math.max(ra, rb), k });

/** Two-bone IK: root a, target c, bone lengths l1, l2, pole direction → middle joint (target clamped to reach). */
function ik2(a: V3, c: V3, l1: number, l2: number, pole: V3): { mid: V3; end: V3 } {
  const d = sub(c, a);
  let L = len(d);
  const dir = norm(d);
  L = Math.min(L, (l1 + l2) * 0.999);
  L = Math.max(L, Math.abs(l1 - l2) + 1e-3);
  const cosA = (l1 * l1 + L * L - l2 * l2) / (2 * l1 * L);
  const h = l1 * Math.sqrt(Math.max(0, 1 - cosA * cosA));
  let p = sub(pole, scale(dir, dot(pole, dir)));
  if (len(p) < 1e-6) p = Math.abs(dir[2]) < 0.9 ? [0, 0, -1] : [1, 0, 0];
  p = norm(sub(p, scale(dir, dot(p, dir))));
  return { mid: add(add(a, scale(dir, l1 * cosA)), scale(p, h)), end: add(a, scale(dir, L)) };
}

/** Local→world rotation from the fingers (Y) and back-of-hand (Z) directions. */
function handFrame(fingers: V3, dorsal: V3): M3 {
  const Y = norm(fingers);
  let Z = sub(dorsal, scale(Y, dot(dorsal, Y)));
  if (len(Z) < 1e-6) Z = Math.abs(Y[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
  Z = norm(sub(Z, scale(Y, dot(Z, Y))));
  const X = cross(Y, Z);
  return [X[0], Y[0], Z[0], X[1], Y[1], Z[1], X[2], Y[2], Z[2]];
}

// ------------------------------------------------------------------ spec
/** Arm pose: IK targets in figure space (metres), finger curl per joint in radians internally (degrees in the API). */
export interface ArmSpec { wrist?: V3; pole?: V3; fingers?: V3; dorsal?: V3; curl?: V3; spread?: number; thumbCurl?: number; handScale?: number }
/** Garment shape overrides (all optional; see the garment functions). */
export interface DrapeSpec {
  hemY?: number; beltY?: number; folds?: number; foldAmp?: number; skirtBottom?: number; hipWide?: number; slim?: number; wide?: number;
  legPush?: number; fine?: number; hemCurve?: number; hemSide?: number; overFolds?: number; overAmp?: number; chestFolds?: number;
  hemScallop?: number; mantleScale?: number; mantleFront?: number; mantleBack?: number; himTop?: number; himSlope?: number;
  himBottom?: number; fallBottom?: number; lapTop?: number;
  zigzag?: boolean; belt?: boolean; mantle?: boolean; mantleSideL?: boolean; himation?: boolean; overfold?: boolean; curtain?: boolean;
  bodice?: boolean; bareChest?: boolean;
}
export interface FigureSpec {
  sex?: 'f' | 'm'; seed?: number; garment?: 'peplos' | 'chiton' | 'himation' | 'chlamys' | 'nude' | 'lap';
  weight?: 'R' | 'L'; hip?: { roll?: number; yaw?: number; pitch?: number; y?: number; shift?: [number, number] };
  chest?: { roll?: number; yaw?: number; pitch?: number }; head?: { yaw?: number; pitch?: number; roll?: number };
  hair?: 'wavy' | 'curly' | 'none'; beard?: boolean; armR?: ArmSpec; armL?: ArmSpec; freeAnkle?: V3; weightAnkle?: V3;
  kneel?: number; seat?: number; strong?: boolean; hipWide?: number; headScale?: number; locks?: boolean; drape?: DrapeSpec;
}

export interface Figure { sdf: Fn; min: V3; max: V3 }

const HEAD_H = 0.255; // chin → crown of the 2.0 m figure

/** Hand SDF in hand-local space (origin at the wrist, +Y fingers, +Z back of the hand), thumb toward ±X. */
function makeHand(o: ArmSpec, thumbSide: number, fem: boolean): Fn {
  const s = (fem ? 0.93 : 1.0) * (o.handScale ?? 1);
  const curl = o.curl ?? [0.25, 0.3, 0.2];
  const spread = o.spread ?? 0.06;
  const segs: Array<{ pts: V3[]; r: number }> = [];
  const fingerX = [-0.031, -0.0105, 0.0105, 0.03].map((v) => -v * thumbSide); // index finger nearest the thumb
  const lens = [[0.046, 0.029, 0.022], [0.05, 0.032, 0.024], [0.047, 0.03, 0.022], [0.037, 0.023, 0.019]];
  const rads = [0.0098, 0.0102, 0.0096, 0.0085];
  for (let f = 0; f < 4; f++) {
    let p: V3 = [(fingerX[f] as number) * s, (0.093 - (f === 3 ? 0.008 : 0) - (f === 0 ? 0.003 : 0)) * s, 0];
    const splay = (f - 1.5) * spread * thumbSide;
    let ang = 0; // accumulated curl about local X, toward the palm (-Z)
    const chain: V3[] = [p];
    for (let j = 0; j < 3; j++) {
      ang += curl[j] as number;
      const L = ((lens[f] as number[])[j] as number) * s;
      p = add(p, scale([Math.sin(splay) * Math.cos(ang), Math.cos(splay) * Math.cos(ang), -Math.sin(ang)], L));
      chain.push(p);
    }
    segs.push({ pts: chain, r: (rads[f] as number) * s });
  }
  // thumb: from the base of the palm toward the index finger, curling across the palm
  const tc = o.thumbCurl ?? 0.5;
  const t0: V3 = [thumbSide * 0.026 * s, 0.022 * s, -0.008];
  const t1 = add(t0, scale(norm([thumbSide * 0.55, 0.75, -0.35 - tc * 0.3]), 0.042 * s));
  const t2 = add(t1, scale(norm([thumbSide * (0.3 - tc * 0.5), 0.8, -0.3 - tc * 0.6]), 0.033 * s));
  const t3 = add(t2, scale(norm([thumbSide * (0.1 - tc * 0.6), 0.7, -0.2 - tc * 0.7]), 0.027 * s));
  segs.push({ pts: [t0, t1, t2, t3], r: 0.0115 * s });
  // flatten the chains into one coefficient table: ax ay az bx by bz ra rb k
  const segTab: number[] = [];
  for (const sg of segs) {
    const P = sg.pts;
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i] as V3, b = P[i + 1] as V3;
      segTab.push(a[0], a[1], a[2], b[0], b[1], b[2], sg.r * (1 - i * 0.09), sg.r * (1 - (i + 1) * 0.09), i === 0 ? 0.012 : 0.004);
    }
  }
  const T = Float64Array.from(segTab);
  return (x, y, z) => {
    // palm (rounded box) and thenar pad
    let d = sdRoundBox(x, y - 0.052 * s, z, 0.04 * s, 0.05 * s, 0.0135 * s, 0.012 * s);
    d = smin(d, sdEllipsoid(x - thumbSide * 0.022 * s, y - 0.035 * s, z + 0.006, 0.024 * s, 0.035 * s, 0.016 * s), 0.01);
    for (let i = 0; i < T.length; i += 9) {
      d = smin(d, sdRoundCone(x, y, z, T[i] as number, T[i + 1] as number, T[i + 2] as number, T[i + 3] as number, T[i + 4] as number, T[i + 5] as number, T[i + 6] as number, T[i + 7] as number), T[i + 8] as number);
    }
    return d;
  };
}

// ------------------------------------------------------------------ fold field
interface FoldCells { n: number; b: Float64Array; a: Float64Array; sk: Float64Array; split: Float64Array; wr: Float64Array; seed: number }
/** Irregular fold layout for (n, seed): widths, amplitudes, skew and forking per fold. */
function foldCells(n: number, seed: number): FoldCells {
  const w: number[] = [];
  let tot = 0;
  for (let i = 0; i < n; i++) {
    const r = hash1(i * 3.7 + seed * 11.1);
    const wi = 0.5 + 1.15 * r * r + 0.3 * hash1(i * 9.1 + seed * 0.37);
    w.push(wi);
    tot += wi;
  }
  const avg = tot / n;
  const a = new Float64Array(n), sk = new Float64Array(n), split = new Float64Array(n), wr = new Float64Array(n), b = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const wi = w[i] as number;
    a[i] = (0.3 + 0.7 * hash1(i * 5.3 + seed * 2.1)) * (0.65 + 0.35 * Math.min(1.6, wi / avg));
    sk[i] = (hash1(i * 1.3 + seed) - 0.5) * 0.6;
    split[i] = hash1(i * 5.1 + seed * 2.9);
    wr[i] = wi / avg;
    b[i + 1] = (b[i] as number) + (wi / tot) * TAU;
  }
  return { n, b, a, sk, split, wr, seed };
}
/** Irregular tubular folds around an axis: 0..1 (ridge 1, crevice 0). */
function foldTubes(F: FoldCells, theta: number, y: number, sway: number): number {
  const seed = F.seed;
  const tw = theta + sway * (0.1 * Math.sin(2 * theta + y * 1.9 + seed) + 0.065 * Math.sin(3 * theta - y * 2.6 + seed * 1.7)
    + 0.04 * Math.sin(5 * theta + y * 3.7 + seed * 2.3) + 0.025 * Math.sin(7 * theta - y * 4.3 + seed * 0.7));
  const t = (((tw + Math.PI) % TAU) + TAU) % TAU;
  let lo = 0, hi = F.n;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if ((F.b[m] as number) <= t) lo = m; else hi = m; }
  const u = ((t - (F.b[lo] as number)) / ((F.b[lo + 1] as number) - (F.b[lo] as number))) * 2 - 1;
  const sk = F.sk[lo] as number;
  const uu = u - sk * (1 - u * u);
  let v = Math.pow(Math.max(0, 1 - uu * uu), 0.7);
  // wide folds fork into two tubes lower down (a groove opens along the centre)
  const sp = F.split[lo] as number;
  if (sp > 0.5 && (F.wr[lo] as number) > 0.9) {
    const ys = 0.25 + 0.7 * sp;
    v *= 1 - 0.6 * sstep(ys, ys - 0.3, y) * Math.exp(-uu * uu * 16);
  }
  return (F.a[lo] as number) * v;
}

// ------------------------------------------------------------------ classical head (head units: chin y -0.5, crown +0.5, face +Z)
function classicalHead(sex: 'f' | 'm', hairStyle: 'wavy' | 'curly' | 'none' | undefined, seed: number, beardOn: boolean): Fn {
  const fem = sex === 'f';
  const jw = fem ? 1.0 : 1.08, bk = fem ? 1.0 : 1.3, cz = fem ? 0.0 : 0.012;
  const E = (cx: number, cy: number, cz2: number, rx: number, ry: number, rz: number, k: number, sb = false): Part => ({
    f: (x, y, z) => sdEllipsoid(x - cx, y - cy, z - cz2, rx, ry, rz), c: [cx, cy, cz2], r: Math.max(rx, ry, rz), k, sub: sb,
  });
  const ER = (c: V3, m: M3, rx: number, ry: number, rz: number, k: number): Part => ({ f: (x, y, z) => ellipsoidR(x, y, z, c, m, rx, ry, rz), c, r: Math.max(rx, ry, rz), k });
  const g = new Group(0.06);
  g.add(E(0, 0.11, -0.07, 0.335, 0.4, 0.425, 0.08)); // cranium
  g.add(E(0, 0.17, 0.133, 0.265, 0.21, 0.26, 0.07)); // forehead
  g.add(E(0, 0.0, 0.1, 0.285, 0.17, 0.265, 0.07)); // temples
  g.add(E(0, -0.12, 0.09, 0.272 * jw, 0.17, 0.27, 0.07)); // cheekbones
  g.add(E(0, -0.28, 0.145, 0.19 * jw, 0.16, 0.24, 0.07)); // muzzle
  g.add(E(0, -0.42, 0.3 + cz, 0.1 * jw, 0.082, 0.098, 0.05)); // chin
  g.add(E(0, 0.056, 0.352, 0.065, 0.05, 0.05, 0.04)); // glabella, continuous with the nose (Greek profile)
  for (const s of [-1, 1]) {
    g.add(cap([0.205 * s * jw, -0.29, -0.02], [0.066 * s * jw, -0.432, 0.235], 0.08 * jw, 0.06, 0.07)); // jaw line
    g.add(E(0.15 * s, -0.16, 0.222, 0.11, 0.13, 0.11, 0.09)); // cheeks
    g.add(E(0.205 * s, -0.035, 0.205, 0.08, 0.062, 0.09, 0.05)); // zygomatic arch
    g.add(ER([0.112 * s, 0.07, 0.318], rotZ(-0.12 * s), 0.108, 0.034 * bk, 0.072, 0.03)); // brow ridge
  }
  // eyes: deep-set under the brow, heavy upper lids
  const eyeX = 0.117, eyeY = 0.0, eyeZ = 0.268, eR = 0.07;
  for (const s of [-1, 1]) g.add(E(eyeX * s, eyeY + 0.02, 0.372, 0.088, 0.06, 0.088, 0.025, true));
  const eyes: Fn = (x, y, z) => {
    let d = 1e9;
    for (let s = -1; s <= 1; s += 2) {
      const ex = x - eyeX * s, ey = y - eyeY, ez = z - eyeZ;
      const r2 = ex * ex + ey * ey + ez * ez;
      if (r2 > 0.03) { d = Math.min(d, Math.sqrt(r2) - 0.1); continue; }
      const r = Math.sqrt(r2);
      const ball = sdEllipsoid(ex, ey, ez, eR, eR * 0.92, eR * 0.8); // flatter front: classical eyes do not bulge
      const lx = ex * s; // + toward the outer corner
      const upEdge = 0.024 - 5.8 * lx * lx + (0.004 * lx) / 0.06;
      const lowEdge = -0.026 + 4.0 * lx * lx + (0.002 * lx) / 0.06;
      let up = r - eR - 0.026;
      up = smax(up, upEdge - ey, 0.004);
      up = smax(up, -ez, 0.01);
      let lo = r - eR - 0.011;
      lo = smax(lo, ey - lowEdge, 0.008);
      lo = smax(lo, -ez + 0.01, 0.01);
      lo = smax(lo, -0.075 - ey, 0.01);
      let e = smin(ball, smin(up, lo, 0.006), 0.004);
      // shallow drilled pupil: a small dark accent that gives the gaze at mid range
      e = smax(e, 0.016 - Math.hypot(ex - 0.006 * s, ey - 0.004, ez - eR * 0.8 - 0.012), 0.004);
      d = Math.min(d, e);
    }
    return d;
  };
  const nose = new Group(0.034);
  nose.add(cap([0, 0.03, 0.372], [0, -0.148, 0.446], 0.029, 0.033, 0.025)); // bridge
  nose.add(E(0, -0.125, 0.385, 0.05, 0.085, 0.05, 0.03)); // lower nose body
  nose.add(E(0, -0.17, 0.446, 0.03, 0.03, 0.03, 0.022)); // tip
  for (const s of [-1, 1]) nose.add(E(0.04 * s, -0.19, 0.402, 0.026, 0.022, 0.028, 0.02)); // alae
  const lips = new Group(0.012);
  lips.add(E(0, -0.262, 0.377, 0.088, 0.032, 0.03, 0.04)); // upper-lip mass
  for (const s of [-1, 1]) lips.add(E(0.034 * s, -0.283, 0.385, 0.047, 0.017, 0.022, 0.01)); // upper vermilion
  lips.add(E(0, -0.288, 0.393, 0.018, 0.013, 0.016, 0.008)); // tubercle
  lips.add(E(0, -0.319, 0.381, 0.07, 0.025, 0.026, 0.014)); // lower lip
  const neckA: V3 = [0, -0.2, -0.07], neckB: V3 = [0, -1.05, -0.1];
  const ears = new Group(0.02);
  for (const s of [-1, 1]) ears.add(ER([0.3 * s, -0.05, -0.03], rotY(0.35 * s), 0.03, 0.1, 0.062, 0.02));
  const hair = makeHair(hairStyle ?? (fem ? 'wavy' : 'curly'), seed);

  const face: Fn = (x, y, z) => {
    let d = g.eval(x, y, z);
    d = smin(d, nose.eval(x, y, z), 0.03);
    d = smin(d, lips.eval(x, y, z + 1.5 * x * x), 0.016); // lips follow the dental arch
    if (z > 0.2 && y < -0.15 && y > -0.42) {
      // mouth line, corners, mentolabial furrow, nostrils, philtrum
      const ax = Math.abs(x);
      d = smax(d, -sdEllipsoid(x, y + 0.298 + 0.06 * ax * ax, z - 0.405 + 1.6 * ax * ax, 0.086, 0.0045, 0.04), 0.006);
      for (let s = -1; s <= 1; s += 2) d = smax(d, -sdEllipsoid(x - 0.087 * s, y + 0.3, z - 0.355, 0.012, 0.011, 0.022), 0.012);
      d = smax(d, -sdEllipsoid(x, y + 0.36, z - 0.4, 0.05, 0.013, 0.026), 0.016);
      for (let s = -1; s <= 1; s += 2) d = smax(d, -sdEllipsoid(x - 0.024 * s, y + 0.209, z - 0.426, 0.011, 0.006, 0.012), 0.008);
      d = smax(d, -sdEllipsoid(x, y + 0.24, z - 0.418, 0.011, 0.024, 0.008), 0.008);
    }
    d = smin(d, eyes(x, y, z), 0.008);
    d = smin(d, ears.eval(x, y, z), 0.03);
    d = smin(d, cone(x, y, z, neckA, neckB, 0.2, 0.235), 0.065);
    return d;
  };
  const beard: Fn | null = beardOn ? (x, y, z) => {
    if (y > 0.0 || z < -0.15) return 1e9;
    let d = 1e9;
    for (let s = -1; s <= 1; s += 2) d = Math.min(d, sdRoundCone(x, y, z, 0.24 * s, -0.12, -0.02, 0.06 * s, -0.47, 0.25, 0.07, 0.085));
    d = smin(d, sdEllipsoid(x, y + 0.5, z - 0.25, 0.13, 0.12, 0.12), 0.05);
    d = smin(d, sdEllipsoid(x, y + 0.262, z - 0.41, 0.1, 0.022, 0.03), 0.02); // moustache
    d = smax(d, -sdEllipsoid(x, y + 0.31, z - 0.425, 0.06, 0.035, 0.06), 0.015); // keep the lips free
    return d - (vnoise3(x * 26 + seed, y * 26, z * 26) * 0.02 + Math.abs(Math.sin(x * 60 + y * 25)) * 0.008);
  } : null;
  return (x, y, z) => {
    let d = face(x, y, z);
    if (beard) d = smin(d, beard(x, y, z), 0.02);
    return hair ? smin(d, hair(x, y, z), 0.012) : d;
  };
}

function makeHair(style: 'wavy' | 'curly' | 'none', seed: number): Fn | null {
  if (style === 'none') return null;
  if (style === 'curly') {
    // short curls: a cap following the skull with bumpy curls, hairline on the forehead
    return (x, y, z) => {
      let d = sdEllipsoid(x, y - 0.13, z + 0.07, 0.36, 0.41, 0.44);
      const line = 0.22 - 0.32 * sstep(0.25, -0.2, z) - 0.06 * sstep(0.1, 0.3, Math.abs(x));
      d = smax(d, line - y, 0.04);
      if (d > 0.08) return d;
      return d - 0.014 - (vnoise3(x * 20 + seed, y * 20, z * 20) * 0.018 + vnoise3(x * 40, y * 40 + seed, z * 40) * 0.007);
    };
  }
  // wavy: centre parting, thick waved locks swept back over the temples into a knot at the nape
  const ph = hash1(seed) * TAU;
  return (x, y, z) => {
    const ax = Math.abs(x);
    let d = sdEllipsoid(x, y - 0.125, z + 0.065, 0.364, 0.414, 0.45);
    if (d > 0.15) return d;
    const line = 0.27 - 0.25 * sstep(0.1, 0.3, ax) * sstep(0.34, 0.05, z) - 0.44 * sstep(0.12, -0.25, z);
    d = smax(d, line - y, 0.04);
    if (d < 0.1) {
      // wave bands parallel to the hairline
      const u = y - line;
      const along = Math.atan2(ax, z);
      const wav = 1.4 * Math.sin(along * 6 + ph + u * 6) + 0.4 * Math.sin(along * 15 + ph * 2);
      const bp = (u / 0.1) * Math.PI + wav;
      const band = Math.abs(Math.sin(bp));
      const bi = Math.floor(bp / Math.PI);
      const depth = 0.012 + 0.012 * hash1(bi * 7.1 + seed) + 0.008 * vnoise3(x * 9 + seed, y * 9, z * 9);
      d -= depth * Math.sqrt(band) - 0.008 + 0.005 * vnoise3(x * 14 + seed, y * 14, z * 14);
      d -= 0.0035 * Math.abs(Math.sin(u * 140 + along * 6 + wav * 2)); // strand striations
      d += 0.012 * Math.exp(-((x / 0.012) ** 2)) * sstep(0.1, 0.35, z) * sstep(0.2, 0.35, y); // centre parting
      d *= 0.75;
    }
    const dc = sdEllipsoid(x, y + 0.13, z + 0.43, 0.2, 0.16, 0.135); // knot at the nape
    if (dc < 0.1) d = smin(d, dc - 0.014 * Math.abs(Math.sin(x * 40 + y * 25)) - vnoise3(x * 25, y * 25 + seed, z * 25) * 0.01, 0.05);
    return d;
  };
}

// ------------------------------------------------------------------ the figure
interface Leg { hp: V3; kn: V3; an: V3; free: boolean }
interface LegG { g: Group }

/** Build a figure. `spec` must already be sanitized (see sdf.ts); angles here are radians. */
export function makeFigure(spec: FigureSpec): Figure {
  const fem = (spec.sex ?? 'f') === 'f';
  const seed = spec.seed ?? 1;
  const seat = spec.seat ?? 0;
  const garment = spec.garment ?? (seat > 0 ? 'lap' : fem ? 'peplos' : 'himation');
  const sx = (fem ? 1 : 1.1) * (spec.strong ? 1.06 : 1); // shoulder width
  const hipW = fem ? 1 : 0.88;
  const kneel = spec.kneel ?? 0; // 0 standing … 1 kneeling (pelvis lowered)

  // ---------- skeleton
  const hip = spec.hip ?? {};
  const hipRoll = hip.roll ?? (seat > 0 ? 0 : spec.weight === 'L' ? -0.05 : 0.05);
  const hipYaw = hip.yaw ?? 0;
  const pelvisY = (hip.y ?? (seat > 0 ? seat + 0.13 : 1.02)) - kneel * 0.45;
  const P: V3 = [hip.shift?.[0] ?? (seat > 0 ? 0 : spec.weight === 'L' ? 0.025 : -0.025), pelvisY, hip.shift?.[1] ?? 0];
  const Rp = mmul(rotY(hipYaw), mmul(rotX(hip.pitch ?? 0), rotZ(hipRoll)));
  const ch = spec.chest ?? {};
  const Rc = mmul(rotY(hipYaw + (ch.yaw ?? 0)), mmul(rotX(ch.pitch ?? 0), rotZ(ch.roll ?? -hipRoll * 0.8)));
  const C = add(P, mv(Rp, 0, 0.41, -0.005));
  const pP = (x: number, y: number, z: number): V3 => add(P, mv(Rp, x, y, z));
  const pC = (x: number, y: number, z: number): V3 => add(C, mv(Rc, x, y, z));

  const neckBase = pC(0, 0.205, -0.03);
  const hd = spec.head ?? {};
  const Rh = mmul(Rc, euler(hd.yaw ?? 0, hd.pitch ?? 0, hd.roll ?? 0));
  const hsc = spec.headScale ?? (fem ? 1.07 : 1.04);
  const HS = HEAD_H * hsc; // head units → metres
  const headC = add(neckBase, mv(Rc, 0, 0.165 * hsc, 0.025 * hsc)); // skull centre
  const RhT = mT(Rh);

  const shR = pC(-0.178 * sx, 0.195, -0.012), shL = pC(0.178 * sx, 0.195, -0.012);
  const hipR = pP(-0.088 * hipW, -0.035, 0.0), hipL = pP(0.088 * hipW, -0.035, 0.0);
  const UA = 0.34, FA = 0.28, TH = 0.475, SH = 0.455;
  const strong = spec.strong ? 1.08 : 1;

  const armJ = (sh: V3, a: ArmSpec, side: number): { sh: V3; el: V3; wr: V3 } => {
    const { mid, end } = ik2(sh, a.wrist ?? [side * 0.25, 0.98, 0.04], UA, FA, a.pole ?? [side * 0.3, -0.2, -1]);
    return { sh, el: mid, wr: end };
  };
  const armRspec = spec.armR ?? (seat > 0 ? { wrist: [-0.14, 0.72, 0.36], pole: [-1, 0, -0.2], fingers: [0.1, -0.3, 1], dorsal: [0, 1, 0] } : {});
  const armLspec = spec.armL ?? (seat > 0 ? { wrist: [0.16, 0.71, 0.34], pole: [1, 0, -0.2], fingers: [-0.1, -0.3, 1], dorsal: [0, 1, 0] } : {});
  const aR = armJ(shR, armRspec, -1), aL = armJ(shL, armLspec, 1);

  const weightIsR = spec.weight !== 'L';
  const legJ = (hp: V3, ankleT: V3, side: number, free: boolean): Leg => {
    const { mid, end } = ik2(hp, ankleT, TH, SH, [side * 0.12, 0.0, 1]);
    return { hp, kn: mid, an: end, free };
  };
  const wAnk: V3 = spec.weightAnkle ?? (seat > 0 ? [(weightIsR ? -1 : 1) * 0.11, 0.08, 0.4] : [(weightIsR ? -1 : 1) * 0.1, 0.045, -0.01]);
  const fAnk: V3 = spec.freeAnkle ?? (seat > 0 ? [(weightIsR ? 1 : -1) * 0.13, 0.08, 0.33] : [(weightIsR ? 1 : -1) * 0.14, 0.11, -0.1]);
  const lR = legJ(hipR, weightIsR ? wAnk : fAnk, -1, !weightIsR);
  const lL = legJ(hipL, weightIsR ? fAnk : wAnk, 1, weightIsR);

  // ---------- trunk (torso + pelvis)
  const trunk = new Group(0.07);
  trunk.add(ell(pP(0, 0.0, -0.01), (0.172 + (spec.hipWide ?? 0)) * hipW, 0.13, 0.118, 0.08, mT(Rp))); // pelvis
  for (const s of [-1, 1]) trunk.add(ell(pP(0.072 * s * hipW, -0.045, -0.055), 0.092 * hipW, 0.1, 0.085, 0.06)); // glutes
  trunk.add(ell(pP(0, 0.15, 0.022), 0.13 * (fem ? 1 : 1.05), 0.14, 0.098, 0.08)); // belly
  trunk.add(ell(pC(0, -0.13, -0.008), 0.122 * sx, 0.1, 0.088, 0.09)); // waist
  trunk.add(ell(pC(0, 0.0, -0.012), 0.148 * sx, 0.168, 0.108, 0.07, mT(Rc))); // ribcage
  // shoulder girdle as two tilted halves: the shoulders slope down from the neck (no flat shelf)
  for (const s of [-1, 1]) trunk.add(ell(pC(0.085 * s * sx, 0.128, -0.018), 0.112 * sx, 0.07, 0.09, 0.07, mT(mmul(Rc, rotZ(-0.26 * s)))));
  for (const s of [-1, 1]) {
    trunk.add(cap(pC(0.03 * s, 0.17, 0.045), pC(0.16 * s * sx, 0.192, 0.0), 0.022, 0.03, 0.04)); // clavicle
    trunk.add(cap(pC(0.06 * s, 0.215, -0.045), add(neckBase, [0.0, 0.05, 0.0]), 0.05, 0.045, 0.06)); // trapezius
    if (fem) trunk.add(ell(pC(0.079 * s, 0.0, 0.089), 0.07, 0.066, 0.06, 0.036, mT(mmul(Rc, rotY(0.25 * s))))); // breast
    else trunk.add(ell(pC(0.072 * s, 0.06, 0.07), 0.085, 0.062, 0.042, 0.05, mT(Rc))); // pectoral
  }
  if (!fem) {
    trunk.add(ell(pC(0, -0.16, 0.068), 0.085, 0.13, 0.04, 0.06)); // rectus abdominis
    for (const s of [-1, 1]) trunk.add(ell(pP(0.11 * s, 0.1, 0.03), 0.05, 0.08, 0.06, 0.06)); // obliques
  }
  const neckStub = cap(neckBase, add(neckBase, mv(Rh, 0, 0.07, 0.01)), 0.044, 0.04, 0.05);

  // ---------- arms
  const armGroup = (a: { sh: V3; el: V3; wr: V3 }, side: number, ao: ArmSpec): Group => {
    const handFn = makeHand(ao, side, fem);
    const g = new Group(0.035);
    const fwdA = norm(sub(a.wr, a.el));
    const k = strong;
    const rW = (fem ? 0.0245 : 0.027) * k, rU = (fem ? 0.053 : 0.059) * k, rE = (fem ? 0.04 : 0.045) * k;
    const upDir = norm(sub(a.el, a.sh));
    const dk = k * (fem && !spec.strong ? 0.86 : 1);
    g.add(ell(add(a.sh, [side * 0.024 * dk, -0.04, 0.004]), 0.068 * dk, 0.085 * dk, 0.07 * dk, 0.05, mT(frameY(add(upDir, [0, -1.5, 0]))))); // deltoid
    g.add(cap(a.sh, a.el, rU, rE, 0.04)); // upper arm
    const fr = frameY(upDir, [0, 0, 1]);
    g.add(ell(add(mix3(a.sh, a.el, 0.55), mv(fr, 0, 0, 0.012 * k)), 0.044 * k, 0.1, 0.045 * k, 0.035, mT(fr))); // biceps
    g.add(ell(add(mix3(a.sh, a.el, 0.42), mv(fr, 0, 0, -0.016 * k)), 0.042 * k, 0.1, 0.04 * k, 0.035, mT(fr))); // triceps
    const M = handFrame(ao.fingers ?? fwdA, ao.dorsal ?? [side, 0, 0]);
    const w = a.wr;
    const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = M;
    // world → hand-local is Mᵀ (columns of M are the local axes)
    g.add({ f: (x, y, z) => { const dx = x - w[0], dy = y - w[1], dz = z - w[2]; return handFn(m0 * dx + m3 * dy + m6 * dz, m1 * dx + m4 * dy + m7 * dz, m2 * dx + m5 * dy + m8 * dz); }, c: add(w, mv(M, 0, 0.09, 0)), r: 0.13, k: 0.02 });
    g.add(cap(a.el, a.wr, rE * 0.95, rW, 0.03)); // forearm
    g.add(ell(mix3(a.el, a.wr, 0.27), (fem ? 0.041 : 0.047) * k, 0.09, (fem ? 0.036 : 0.041) * k, 0.03, mT(frameY(fwdA)))); // forearm belly
    g.add(ell(sub(a.el, scale(fwdA, 0.01)), 0.028 * k, 0.03, 0.028 * k, 0.025)); // elbow
    return g;
  };
  const armRg = armGroup(aR, -1, armRspec);
  const armLg = armGroup(aL, 1, armLspec);

  // ---------- legs
  const legGroup = (l: Leg, side: number): LegG => {
    const g = new Group(0.05);
    g.add(cap(l.hp, l.kn, fem ? 0.098 : 0.09, 0.056, 0.06)); // thigh
    g.add(ell(mix3(l.hp, l.kn, 0.4), 0.075, 0.17, 0.08, 0.06, mT(frameY(sub(l.kn, l.hp)))));
    g.add(cap(l.kn, l.an, 0.052, 0.03, 0.04)); // shin
    g.add(ell(add(mix3(l.kn, l.an, 0.3), [0, 0, -0.025]), 0.045, 0.1, 0.045, 0.04, mT(frameY(sub(l.an, l.kn))))); // calf
    // foot (sandal): forward (+Z), turned slightly outward
    const out = side * 0.18 + (l.free ? side * 0.12 : 0);
    const fdir: V3 = [Math.sin(out), 0, Math.cos(out)];
    const heel: V3 = [l.an[0] - fdir[0] * 0.035, Math.max(0.035, l.an[1] - 0.05), l.an[2] - fdir[2] * 0.035];
    const toeY = 0.022;
    const ball: V3 = [l.an[0] + fdir[0] * 0.15, toeY + 0.004, l.an[2] + fdir[2] * 0.15];
    g.add(cap(heel, ball, 0.036, 0.03, 0.03));
    g.add(cap(l.an, mix3(heel, ball, 0.55), 0.034, 0.03, 0.03));
    for (let t = 0; t < 5; t++) { // toes
      const lat = (t - 1.6) * 0.017 * -side;
      const tl = 0.045 - Math.abs(t - 0.6) * 0.006;
      const base: V3 = [ball[0] + fdir[2] * lat, toeY, ball[2] - fdir[0] * lat];
      g.add(cap(base, add(base, scale(fdir, tl)), 0.011 - t * 0.0008, 0.0085 - t * 0.0006, 0.008));
    }
    // sandal sole
    const sc = mix3(heel, ball, 0.5);
    const cy = Math.cos(Math.atan2(fdir[0], fdir[2])), sy = Math.sin(Math.atan2(fdir[0], fdir[2]));
    g.add({ f: (x, y, z) => { const dx = x - sc[0], dz = z - sc[2]; return sdRoundBox(cy * dx - sy * dz, y - 0.008, sy * dx + cy * dz - 0.035, 0.05, 0.008, 0.15, 0.006); }, c: [sc[0], 0.01, sc[2]], r: 0.2, k: 0.004 });
    return { g };
  };
  const legR = legGroup(lR, -1), legL = legGroup(lL, 1);
  const freeLeg = weightIsR ? lL : lR;
  const freeLegG = weightIsR ? legL : legR;

  // ---------- head
  const head = classicalHead(fem ? 'f' : 'm', spec.hair, seed, spec.beard === true);
  const [r0, r1, r2, r3, r4, r5, r6, r7, r8] = RhT;
  const hR = 0.3 * hsc;
  const nA = add(neckBase, [0, -0.06, 0.01]), nB = add(neckBase, mv(Rh, 0, 0.1, 0.015));
  const cutY = neckBase[1] - 0.07;
  const headSdf: Fn = (x, y, z) => {
    const cut = cutY - y;
    const dn = cone(x, y, z, nA, nB, 0.054, 0.05);
    const dx = x - headC[0], dy = y - headC[1], dz = z - headC[2];
    const rr = Math.hypot(dx, dy, dz);
    if (rr > hR + 0.05) return Math.max(Math.min(dn, rr - hR), cut);
    let d = head((r0 * dx + r1 * dy + r2 * dz) / HS, (r3 * dx + r4 * dy + r5 * dz) / HS, (r6 * dx + r7 * dy + r8 * dz) / HS) * HS;
    d = smin(d, dn, 0.03); // the neck continues down into the collar
    return Math.max(d, cut); // below the collar the body takes over
  };

  // long locks of hair over the shoulders (female)
  const lockTab: number[] = [];
  if (fem && spec.hair !== 'none' && spec.locks !== false) {
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
      const a = add(headC, mv(Rh, (0.2 + i * 0.03) * s * HS, -0.22 * HS, (-0.18 - i * 0.08) * HS));
      const c = add(s < 0 ? shR : shL, [-s * (0.07 + i * 0.025), -0.01 - i * 0.035, 0.0 - i * 0.05]);
      lockTab.push(a[0], a[1], a[2], c[0], c[1], c[2], 0.022 - i * 0.002, hash1(seed * 13 + i * 3 + s) * 6);
    }
  }
  let lockC: V3 = [0, 0, 0], lockR = 0;
  if (lockTab.length) {
    const mn: V3 = [1e9, 1e9, 1e9], mx: V3 = [-1e9, -1e9, -1e9];
    for (let o = 0; o < lockTab.length; o += 8) for (let q = 0; q < 6; q++) {
      const i = q % 3, v = lockTab[o + q] as number;
      mn[i] = Math.min(mn[i] as number, v);
      mx[i] = Math.max(mx[i] as number, v);
    }
    lockC = mix3(mn, mx, 0.5);
    lockR = len(sub(mx, mn)) * 0.5 + 0.05;
  }
  const LT = Float64Array.from(lockTab);
  const lockSdf: Fn = (x, y, z) => {
    const bd = Math.hypot(x - lockC[0], y - lockC[1], z - lockC[2]) - lockR;
    if (bd > 0.02) return bd;
    let d = 1e9;
    for (let o = 0; o < LT.length; o += 8) {
      const ax = LT[o] as number, ay = LT[o + 1] as number, az = LT[o + 2] as number;
      const cx = LT[o + 3] as number, cy = LT[o + 4] as number, cz = LT[o + 5] as number, r = LT[o + 6] as number, ph = LT[o + 7] as number;
      const t = clamp((y - ay) / (cy - ay), 0, 1);
      const px = lerp(ax, cx, t), pz = lerp(az, cz, t);
      const wob = 0.007 * Math.sin(t * 11 + ph);
      const dd = Math.hypot(x - px - wob, z - pz - wob * 0.5) - r * (1 - 0.35 * t) - 0.002 * Math.sin(Math.atan2(z - pz, x - px) * 3 + t * 30 + ph);
      d = Math.min(d, Math.max(dd, Math.max(cy - y - 0.01, y - ay - 0.02)));
    }
    return d * 0.8;
  };

  // ---------- garments (the long skirt keeps the legs inside the cloth; only the feet show)
  const drape: DrapeSpec = { mantleScale: 0.6, mantleBack: 0.05, mantleSideL: true, hemScallop: 1.7, fine: 0.28, ...(seat > 0 ? { curtain: true, bodice: true, lapTop: 0.2 } : {}), ...(spec.drape ?? {}) };
  const longSkirt = ['peplos', 'chiton', 'himation'].includes(garment) && (drape.skirtBottom ?? 0) < 0.1;
  const G = makeGarment(garment, { fem, seed, P, C, freeLeg, freeLegG, lR, lL, legR, legL, shL, neckBase, S: drape });

  // ---------- seat (a plain block under a seated figure)
  const seatSdf: Fn | null = seat > 0 ? (x, y, z) => sdRoundBox(x, y - seat * 0.5, z + 0.02, 0.24, seat * 0.5, 0.22, 0.02) : null;

  const bodySdf: Fn = (x, y, z) => {
    const dt = trunk.eval(x, y, z);
    let d = smin(dt, neckStub.f(x, y, z), 0.04);
    d = smin(d, Math.min(evalB(armRg, x, y, z, d + 0.04), evalB(armLg, x, y, z, d + 0.04)), 0.035); // shoulders blend into the torso
    let dl = Math.min(evalB(legR.g, x, y, z, d + 0.06), evalB(legL.g, x, y, z, d + 0.06));
    if (longSkirt) dl += 0.025 * sstep(0.1, 0.2, y);
    d = smin(d, dl, 0.05);
    d = Math.min(d, G(x, y, z, dt));
    if (LT.length) d = smin(d, lockSdf(x, y, z), 0.01);
    if (seatSdf) d = Math.min(d, seatSdf(x, y, z));
    return d;
  };

  // bounds: joints padded by the largest reach of flesh and cloth round them
  const pts: V3[] = [aR.wr, aL.wr, aR.el, aL.el, lR.an, lL.an, lR.kn, lL.kn, headC, [0, 0, 0]];
  const mn: V3 = [Infinity, Infinity, Infinity], mx: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i] as number, p[i] as number); mx[i] = Math.max(mx[i] as number, p[i] as number); }
  const min: V3 = [mn[0] - 0.36, -0.02, mn[2] - 0.36], max: V3 = [mx[0] + 0.36, mx[1] + 0.25, mx[2] + 0.36];
  // a cheap whole-figure bound keeps far samples (pedestals, scenes round the figure) from evaluating every part
  const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2, cz = (min[2] + max[2]) / 2;
  const hx = (max[0] - min[0]) / 2, hy = (max[1] - min[1]) / 2, hz = (max[2] - min[2]) / 2;
  const sdf: Fn = (x, y, z) => {
    const b = sdBox(x - cx, y - cy, z - cz, hx, hy, hz);
    if (b > 0.05) return b;
    return Math.min(bodySdf(x, y, z), headSdf(x, y, z));
  };
  return { sdf, min, max };
}

// ------------------------------------------------------------------ garments
interface GarmentCtx {
  fem: boolean; seed: number; P: V3; C: V3; freeLeg: Leg; freeLegG: LegG; lR: Leg; lL: Leg; legR: LegG; legL: LegG;
  shL: V3; neckBase: V3; S: DrapeSpec;
}
type GarmentFn = (x: number, y: number, z: number, dTrunk: number) => number;

function makeGarment(type: string, ctx: GarmentCtx): GarmentFn {
  const { seed, P, C, freeLeg, freeLegG, shL, neckBase, S } = ctx;
  if (type === 'nude') return () => 1e9;
  const hemY = S.hemY ?? (type === 'peplos' ? 1.0 : 1.12);
  const beltY = S.beltY ?? C[1] - 0.13;
  const skirtN = Math.round(clamp(S.folds ?? (type === 'chiton' ? 34 : 26), 4, 80));
  const skirtA = S.foldAmp ?? (type === 'chiton' ? 0.017 : 0.024);
  const kneeK = freeLeg.kn;
  const F = {
    skirt: foldCells(skirtN, seed), skirtFine: foldCells(Math.round(skirtN * 2.3), seed + 3),
    over: foldCells(Math.round(clamp(S.overFolds ?? 18, 4, 80)), seed + 7), chest: foldCells(S.chestFolds ? 30 : 44, seed + 13),
    mantle: foldCells(13, seed + 21), mantleFine: foldCells(29, seed + 22), him: foldCells(23, seed + 31), fall: foldCells(9, seed + 5),
    chlamys: foldCells(14, seed + 9), lap: foldCells(15, seed + 17), bodice: foldCells(22, seed + 4), simple: foldCells(20, seed + 4),
  };

  // ---- lower skirt (hips to the ground)
  const skirtTop = type === 'chlamys' ? C[1] - 0.25 : P[1] + 0.12;
  const skirtBottom = S.skirtBottom ?? (type === 'chlamys' ? 0.9 : 0.0);
  const skirt: GarmentFn = (x, y, z, dTrunk) => {
    if (y > skirtTop + 0.1 || y < skirtBottom - 0.05) return 1e9;
    const span = Math.max(0.2, P[1]);
    const t = clamp(y / span, 0, 1.2);
    const flare = 0.016 * sstep(0.13, 0.0, y);
    const wx = S.hipWide ?? 0;
    const sl = (S.slim ?? 0) * (1 - Math.min(1, t)); // narrows toward the hem (no cone silhouette)
    const rx = lerp(0.235, 0.182 + wx, t) + flare + (S.wide ?? 0) - sl, rz = lerp(0.185, 0.138 + wx * 0.3, t) + flare + (S.wide ?? 0) * 0.7 - sl * 0.6;
    const cx = P[0] * (1 - t) * 0.4, cz = lerp(-0.012, P[2], t);
    const d0 = ellipse2(x - cx, z - cz, rx, rz);
    let d = d0;
    const lb = freeLegG.g.bound(x, y, z);
    if (d > 0.14 && lb > 0.14 && (y < P[1] - 0.25 || dTrunk > 0.14)) return Math.min(d, lb) - 0.07;
    // the free leg pushes the cloth out (knee, shin), where it is stretched taut with shallow folds
    const dl = evalB(freeLegG.g, x, y, z, d + 0.2) + (S.legPush ?? 0.006);
    d = smin(d, dl, 0.08);
    const legDom = sstep(-0.01, 0.035, d0 - dl);
    // above the hips the skirt hugs the body (no barrel-like shelf where it is cut off)
    if (y > P[1] - 0.3) d = lerp(smin(d, dTrunk - 0.022, 0.09), dTrunk - 0.022, sstep(P[1] - 0.3, P[1] + 0.06, y));
    // deep tubular folds hanging from the belt, gathered at the top, broad at the hem; softer at the back
    const th = Math.atan2(x - cx, z - cz);
    let amp = skirtA * (0.3 + 0.7 * sstep(P[1] + 0.05, P[1] - 0.45, y));
    amp *= 1 - 0.72 * legDom;
    amp *= z - cz < 0 ? 0.8 : 1;
    const f = foldTubes(F.skirt, th, y, 1.0);
    d -= amp * f;
    d -= amp * (S.fine ?? 0.2) * foldTubes(F.skirtFine, th + 0.11, y * 1.3, 1.4); // finer folds between the big ones
    if (legDom > 0.01) {
      // soft diagonal undulations across the taut cloth over the shin
      const v = (y - (x - kneeK[0]) * 0.55 * Math.sign(kneeK[0] || 1)) / 0.09;
      d -= 0.004 * (0.5 + 0.5 * Math.sin(v * TAU)) * legDom * sstep(kneeK[1] + 0.05, kneeK[1] - 0.15, y);
    }
    d -= 0.0018 * vnoise3(x * 45 + seed, y * 9, z * 45); // fine wrinkles
    d /= 1.7;
    // hem: on the ground, slightly irregular, lifting over the front of the feet (toes peek out)
    const hem = skirtBottom + 0.004 + 0.008 * f + (skirtBottom < 0.05 ? 0.035 * sstep(0.12, 0.2, z - cz) * (1 - legDom * 0.3) : 0);
    d = Math.max(d, hem - y);
    return Math.max(d, y - skirtTop);
  };

  // ---- upper garment over the torso (peplos overfold / chiton bodice)
  const hemCurve = S.hemCurve ?? 0.04, hemSide = S.hemSide ?? 0.02, oa = S.overAmp ?? 1, chestFolds = S.chestFolds ?? 0.0035, hemScallop = S.hemScallop ?? 1;
  const over: GarmentFn = (x, y, z, dTrunk) => {
    if (y < hemY - 0.12) return 1e9;
    const th = Math.atan2(x - P[0], z - P[2]);
    const below = sstep(beltY + 0.02, beltY - 0.25, y); // 0 at the belt, 1 at the hem
    const above = sstep(beltY, beltY + 0.05, y) * sstep(beltY + 0.16, beltY + 0.06, y); // blousing above the belt
    const fr = 0.55 + 0.45 * Math.abs(Math.cos(th)); // flares front and back, hugs the hips at the sides
    let off = 0.011 + 0.022 * below * oa * fr + 0.012 * above;
    off -= 0.006 * Math.exp(-(((y - beltY) / 0.03) ** 2));
    let d = dTrunk - off;
    const f = foldTubes(F.over, th, y * 0.8, 0.6); // folds radiate down from the belt
    d -= (0.004 + 0.016 * below * oa + 0.006 * above) * f;
    const chest = sstep(beltY + 0.08, beltY + 0.16, y); // thin cloth clinging over the chest: fine crinkles
    if (chest > 0) d -= chestFolds * chest * foldTubes(F.chest, th, y * 2.0, 0.8);
    d -= 0.0015 * vnoise3(x * 50, y * 50 + seed, z * 50);
    d /= 1.5;
    // open hem of the overfold: a visible lip with a shadow under it
    let hy = hemY + hemCurve * Math.cos(2 * th) + 0.015 * Math.cos(3 * th + seed) - hemSide * Math.abs(Math.sin(th)) - (0.016 + 0.02 * Math.abs(Math.sin(th))) * f * below * hemScallop;
    if (S.zigzag) {
      // the open side of the peplos (+X) falls lower in a zigzag cascade
      const side = Math.exp(-(((th - 1.45) / 0.42) ** 2));
      const zz = Math.abs(((((th * 9 + seed) % 2) + 2) % 2) - 1);
      hy -= side * (0.13 + 0.05 * zz);
    }
    d = smax(d, hy - y, 0.012);
    // the cloth runs over the shoulders (pinned there): the neckline only opens round the neck, in a V at the front
    const nl = neckBase[1] - 0.04 - 0.07 * sstep(0.0, 0.08, z - C[2]) * (1 - sstep(0.02, 0.14, Math.abs(x - C[0]))) + 0.9 * Math.max(0, Math.abs(x - C[0]) - 0.075);
    return smax(d, y - nl, 0.01);
  };

  const belt: GarmentFn = (_x, y, _z, dTrunk) => {
    if (Math.abs(y - beltY) > 0.08) return 1e9;
    return smax(dTrunk - 0.024, Math.abs(y - beltY) - 0.017, 0.01);
  };

  // ---- back mantle (hangs from the shoulders behind)
  const mant = S.mantle ?? type === 'peplos';
  const ms = S.mantleScale ?? 1; // < 1: hugs the back instead of a wide bell behind the figure
  const mantleFront = S.mantleFront ?? 0.03, mantleBack = S.mantleBack ?? 0;
  const mantle: GarmentFn = (x, y, z, dTrunk) => {
    if (!mant) return 1e9;
    if (y > neckBase[1] + 0.03 || z > C[2] + 0.12) return 1e9;
    const t = clamp(y / 1.62, 0, 1);
    const rx = lerp(lerp(0.215, 0.31, ms), 0.215, Math.pow(t, 1.5)), rz = lerp(lerp(0.135, 0.26, ms), 0.135, Math.pow(t, 1.2));
    const cz = C[2] - 0.035;
    const lx = x - C[0] * t, lz = z - cz;
    let d = ellipse2(lx, lz, rx, rz);
    if (d > 0.12 && dTrunk > 0.12) return Math.min(d, dTrunk) - 0.06;
    const top = sstep(1.2, 1.5, y);
    if (top > 0) d = smin(d, dTrunk - 0.028, 0.06 + 0.06 * top); // blends into the shoulders at the top
    const th = Math.atan2(lx, lz);
    d -= (0.02 + 0.05 * (1 - t)) * foldTubes(F.mantle, th, y * 0.55, 0.9);
    d -= 0.006 * foldTubes(F.mantleFine, th + 0.2, y * 0.8, 1.2);
    d -= 0.0015 * vnoise3(x * 50, y * 12 + seed, z * 50);
    d /= 1.6;
    const shell = Math.abs(d + 0.019) - 0.019; // hollow cloth
    // only the back half; the hanging side edge undulates softly (folded-back layers)
    const zEdge = -0.012 + 0.03 * Math.sin(y * 4.2 + seed) * (0.5 + 0.5 * (1 - t)) + 0.01 * Math.sin(y * 11 + seed * 2) - 0.08 * sstep(0.0, -0.14, x - C[0]) + mantleFront * sstep(0.05, 0.22, x - C[0])
      - mantleBack * (1 - (S.mantleSideL ? sstep(0.06, 0.2, x - C[0]) : 0));
    let dd = smax(shell, lz - zEdge, 0.02);
    dd = smax(dd, -(dTrunk + 0.06), 0.01); // never deep inside the body
    const mdx = x - C[0];
    dd = smax(dd, y - (neckBase[1] + 0.005 - 0.13 * Math.max(0, 1 - (mdx / 0.17) ** 2) - 0.03 * Math.abs(mdx)), 0.015); // U-shaped top edge
    return Math.max(dd, 0.02 - y);
  };

  // ---- himation wrapped diagonally from the left shoulder round the hips
  const himTop = S.himTop ?? 1.15, himSlope = S.himSlope ?? 0.9, himBottom = S.himBottom ?? 0.48;
  const himation: GarmentFn = (x, y, z, dTrunk) => {
    if (type !== 'himation' && type !== 'chiton') return 1e9;
    const top = himTop + (x - P[0]) * himSlope;
    const bot = himBottom;
    if (y > top + 0.05 || y < bot - 0.1) return 1e9;
    const t = clamp(y / 1.4, 0, 1);
    let d = ellipse2(x - P[0] * 0.5, z - P[2], lerp(0.225, 0.2, t), lerp(0.175, 0.145, t));
    if (y > P[1] - 0.3) d = smin(d, dTrunk - 0.035, 0.08);
    d = smin(d, freeLegG.g.eval(x, y, z) - 0.045, 0.1);
    // stacked tubular swags with deep crevices, sagging at the front, a rolled top edge
    const th = Math.atan2(x - P[0], z - P[2]);
    const sag = 0.07 * Math.cos(th);
    const v = (y - (x - P[0]) * himSlope * 0.7 + sag) / 0.12 + 0.5 * Math.sin(th * 2 + seed) + 0.35 * Math.sin(y * 7 + seed) + 0.6 * vnoise3(x * 5 + seed, y * 4, z * 5);
    const ci = Math.floor(v), uu = (v - ci) * 2 - 1;
    const hv = hash1(ci * 7.3 + seed);
    const lowF = sstep(bot + 0.05, bot + 0.3, y); // swags fade into vertical folds toward the hanging hem
    const f = (hv < 0.3 ? 0.2 : 0.35 + 0.65 * hv) * Math.pow(Math.max(0, 1 - uu * uu), 0.85) * (0.4 + 0.6 * Math.max(0, Math.cos(th))) * lowF;
    d -= 0.018 * f;
    d -= (0.005 + 0.007 * (1 - lowF)) * foldTubes(F.him, th, y, 0.6);
    d -= 0.02 * Math.exp(-(((y - top + 0.035) / 0.028) ** 2));
    d /= 1.6;
    d = smax(d, y - top, 0.012);
    return smax(d, bot + 0.06 * Math.sin((x - P[0]) * 12 + seed) + 0.04 * (x - P[0]) - y, 0.012);
  };
  // left-shoulder fall of the himation
  const fallA = add(shL, [0.0, 0.05, -0.03]), fallB: V3 = [shL[0] + 0.03, S.fallBottom ?? 0.55, shL[2] - 0.07];
  const shoulderFall = (x: number, y: number, z: number): number => {
    if (type !== 'himation') return 1e9;
    let d = cone(x, y, z, fallA, fallB, 0.07, 0.11);
    d -= 0.015 * foldTubes(F.fall, Math.atan2(x - fallB[0], z - fallB[2]), y, 0.5);
    return d / 1.4;
  };

  // ---- chlamys: short cloak pinned at the right shoulder
  const chlamys: GarmentFn = (x, y, z, dTrunk) => {
    if (y < C[1] - 0.75 || y > neckBase[1] + 0.05) return 1e9;
    let d = dTrunk - 0.03;
    d -= 0.015 * foldTubes(F.chlamys, Math.atan2(x - C[0], z - C[2]), y, 0.5) * sstep(C[1], C[1] - 0.4, y);
    d /= 1.4;
    d = smax(d, -((x - C[0]) * 0.8 - (z - C[2]) * 1.2 + 0.05), 0.012); // open at the front-right
    return smax(d, C[1] - 0.62 + 0.15 * sstep(-0.2, 0.2, x - C[0]) - y, 0.012);
  };

  // ---- lap drape (seated, kneeling): cloth over the legs and hips, a curtain to the ground, a bodice
  const lapTop = S.lapTop ?? 0.14;
  const kR = ctx.lR.kn, kL = ctx.lL.kn;
  const lx0 = Math.min(kR[0], kL[0]) - 0.07, lx1 = Math.max(kR[0], kL[0]) + 0.07;
  const lzk = (kR[2] + kL[2]) * 0.5 + 0.02, lyk = Math.min(kR[1], kL[1]);
  const lap: GarmentFn = (x, y, z, dTrunk) => {
    const dl = Math.min(evalB(ctx.legR.g, x, y, z, 0.25), evalB(ctx.legL.g, x, y, z, 0.25));
    if (dl > 0.2 && dTrunk > 0.2) return Math.min(dl, dTrunk) - 0.08;
    let d = dl - 0.034;
    if (y < P[1] + lapTop) d = smin(d, dTrunk - 0.028, 0.08);
    if (S.curtain) {
      const xc = (lx0 + lx1) / 2, hw = (lx1 - lx0) / 2 + 0.06 * (1 - y / Math.max(0.2, lyk));
      const fz = 0.022 * Math.abs(Math.sin(x * 38 + seed)) + 0.01 * Math.sin(x * 15 + seed);
      const dc = Math.max(Math.max(Math.abs(x - xc) - hw, Math.abs(z - lzk + 0.03 - fz) - 0.035), y - lyk);
      d = smin(d, Math.max(dc, -y), 0.05);
    }
    // folds along and round the legs
    d -= 0.008 * Math.abs(vnoise3(x * 22 + seed, y * 9, z * 9)) + 0.002 * vnoise3(x * 60, y * 60, z * 60);
    d -= 0.012 * foldTubes(F.lap, Math.atan2(x - P[0], y - 0.3), z * 2, 0.8);
    d /= 1.3;
    d = Math.max(d, -y);
    if (S.bodice) {
      let b = dTrunk - 0.012;
      b -= 0.007 * foldTubes(F.bodice, Math.atan2(x - P[0], z - P[2]), y, 0.5);
      b /= 1.3;
      b = smax(b, P[1] - 0.1 - y, 0.01);
      b = smax(b, y - (neckBase[1] - 0.035) - 0.9 * Math.max(0, Math.abs(x - C[0]) - 0.075), 0.01);
      d = smin(d, b, 0.02);
    }
    return d;
  };
  // simple tunic over the torso under a himation (bare chest optional)
  const overSimple: GarmentFn = (x, y, z, dTrunk) => {
    if (S.bareChest) return 1e9;
    let d = dTrunk - 0.012;
    d -= 0.008 * foldTubes(F.simple, Math.atan2(x - P[0], z - P[2]), y, 0.5);
    d /= 1.3;
    d = smax(d, P[1] - 0.25 - y, 0.012);
    return smax(d, y - (neckBase[1] - 0.04 + 0.9 * Math.max(0, Math.abs(x - C[0]) - 0.075)), 0.01);
  };

  if (type === 'chlamys') return chlamys;
  if (type === 'lap') return lap;
  const withOver = type !== 'himation' || S.overfold === true;
  const withBelt = S.belt !== false && type !== 'himation';
  const withHim = type === 'himation' || S.himation === true;
  return (x, y, z, dTrunk) => {
    let d = skirt(x, y, z, dTrunk);
    d = Math.min(d, withOver ? over(x, y, z, dTrunk) : overSimple(x, y, z, dTrunk));
    if (withBelt) d = smin(d, belt(x, y, z, dTrunk), 0.006);
    d = Math.min(d, mantle(x, y, z, dTrunk));
    if (withHim) {
      d = Math.min(d, himation(x, y, z, dTrunk));
      d = smin(d, shoulderFall(x, y, z), 0.04);
    }
    return d;
  };
}
