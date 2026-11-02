/**
 * Signed-distance sculpting: a plain-JSON SDF tree (shapes, smooth booleans, transforms and posed draped figures)
 * is validated and compiled ONCE into native closures, then meshed with block-sparse naive surface nets.
 *
 * Mesher: the bounds are split into 8³-cell blocks; a block whose centre distance proves it holds no surface is
 * skipped, a near block is refined 8 → 4 → 2 cells the same way, and only the shell round the surface is sampled
 * exactly (cells proven empty get a constant of the right sign). One vertex per sign-changing cell, a quad per
 * sign-changing grid edge, then optional Laplacian smoothing, Newton projection back onto the zero set (undoes
 * smoothing shrinkage, keeps folds crisp) and gradient normals. Adapted from athen src/sculpt/mesher.js
 * (MIT License, Copyright (c) 2026 Leon Lin).
 *
 * The narrow band assumes a near-true distance (Lipschitz ≤ ~1.5); stretched fields lose thin parts.
 */
import type { Vec3 } from '@aether/core';
import { finite, Mesh, MeshBuilder, type VertexBudget } from './mesh';
import { mat3FromEulerDeg } from './math3';
import { KERNEL_LIMITS } from './primitives';
import {
  makeFigure, sdBox, sdCapsule, sdCylinder, sdEllipsoid, sdRoundBox, sdRoundCone, sdTorus, smax, smin,
  type ArmSpec, type DrapeSpec, type FigureSpec, type V3,
} from './sdf-figure';

export type SdfFn = (x: number, y: number, z: number) => number;

/** Hard caps on SDF trees and meshing (protect CPU and memory against hostile arguments). */
export const SDF_LIMITS = Object.freeze({
  MAX_NODES: 400,
  MAX_DEPTH: 16,
  /** Figures are the costly nodes (hundreds of terms per sample). */
  MAX_FIGURES: 8,
  MAX_TRIANGLES: 120_000,
  /** Cells along the longest side of the bounds. */
  DEFAULT_RESOLUTION: 128,
  MAX_RESOLUTION: 512,
  MAX_SMOOTH: 4,
  MAX_PROJECT: 3,
});

/** Options of {@link meshSdf}. */
export interface SdfMeshOptions {
  /** Cell (voxel) size in metres; default: longest side of the bounds / resolution. */
  cell?: number;
  /** Cells along the longest side when `cell` is not given (default 128). */
  resolution?: number;
  /** Laplacian smoothing passes, 0..4 (default 1). */
  smooth?: number;
  /** Newton projection passes onto the surface, 0..3 (default 1). */
  project?: number;
  /** Meshing bounds (default: conservative bounds of the tree). */
  min?: Vec3;
  max?: Vec3;
  /** Added to the distance at every sample (carving, fold noise): called per sample, so it is costly. */
  detail?: (x: number, y: number, z: number) => number;
  /** Triangle cap (≤ {@link SDF_LIMITS.MAX_TRIANGLES}); the cell grows until the mesh fits. */
  maxTriangles?: number;
}

/** A compiled node: its distance function and a conservative AABB of its surface. */
export interface CompiledSdf { f: SdfFn; min: V3; max: V3 }

// ------------------------------------------------------------------ tree compiler
interface Ctx { nodes: number; figures: number }

const SHAPES = 'sphere | ellipsoid | box | capsule | cone | cylinder | torus | figure';

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function coord(v: unknown, what: string): number {
  const n = finite(v, what);
  if (Math.abs(n) > KERNEL_LIMITS.MAX_DIMENSION) throw new RangeError(`${what}: must be within ±${KERNEL_LIMITS.MAX_DIMENSION}`);
  return n;
}
function size(v: unknown, what: string): number {
  const n = Math.abs(finite(v, what));
  return Math.min(KERNEL_LIMITS.MAX_DIMENSION, Math.max(KERNEL_LIMITS.MIN_DIMENSION, n));
}
function vec3(v: unknown, what: string, read: (x: unknown, w: string) => number = coord): V3 {
  if (!Array.isArray(v) || v.length !== 3) throw new TypeError(`${what}: expected [x, y, z]`);
  return [read(v[0], `${what}[0]`), read(v[1], `${what}[1]`), read(v[2], `${what}[2]`)];
}
function blend(v: unknown, what: string): number {
  if (v === undefined) return 0;
  return Math.min(KERNEL_LIMITS.MAX_DIMENSION, Math.max(0, finite(v, what)));
}

/** Validate and compile an SDF tree (see the `api.sdf` documentation for the format). */
export function compileSdf(tree: unknown): CompiledSdf {
  return compileNode(tree, 0, { nodes: 0, figures: 0 }, 'sdf');
}

function compileNode(node: unknown, depth: number, ctx: Ctx, path: string): CompiledSdf {
  if (depth >= SDF_LIMITS.MAX_DEPTH) throw new RangeError(`${path}: tree is nested deeper than ${SDF_LIMITS.MAX_DEPTH}`);
  if (!isObj(node)) throw new TypeError(`${path}: expected a node object like { shape: 'sphere', r: 1 }`);
  if (++ctx.nodes > SDF_LIMITS.MAX_NODES) throw new RangeError(`sdf: at most ${SDF_LIMITS.MAX_NODES} nodes`);
  const op = node.op, shape = node.shape;
  let c: CompiledSdf;
  if (typeof op === 'string') c = compileOp(node, op, depth, ctx, path);
  else if (typeof shape === 'string') c = compileShape(node, shape, ctx, path);
  else throw new TypeError(`${path}: a node needs shape (${SHAPES}) or op (union | subtract | intersect)`);
  return transform(node, c, path);
}

function compileShape(n: Record<string, unknown>, shape: string, ctx: Ctx, path: string): CompiledSdf {
  const at = `${path}(${shape})`;
  switch (shape) {
    case 'sphere': {
      const r = size(n.r, `${at}.r`);
      return { f: (x, y, z) => Math.hypot(x, y, z) - r, min: [-r, -r, -r], max: [r, r, r] };
    }
    case 'ellipsoid': {
      const [rx, ry, rz] = vec3(n.r, `${at}.r`, size);
      return { f: (x, y, z) => sdEllipsoid(x, y, z, rx, ry, rz), min: [-rx, -ry, -rz], max: [rx, ry, rz] };
    }
    case 'box': {
      const [sx, sy, sz] = vec3(n.size, `${at}.size`, size);
      const hx = sx / 2, hy = sy / 2, hz = sz / 2;
      const r = Math.min(blend(n.round, `${at}.round`), hx, hy, hz);
      const f: SdfFn = r > 0 ? (x, y, z) => sdRoundBox(x, y, z, hx, hy, hz, r) : (x, y, z) => sdBox(x, y, z, hx, hy, hz);
      return { f, min: [-hx, -hy, -hz], max: [hx, hy, hz] };
    }
    case 'capsule': {
      const a = vec3(n.a, `${at}.a`), b = vec3(n.b, `${at}.b`);
      const r = size(n.r, `${at}.r`);
      return { f: (x, y, z) => sdCapsule(x, y, z, a[0], a[1], a[2], b[0], b[1], b[2], r), ...segBounds(a, b, r, r) };
    }
    case 'cone': {
      const a = vec3(n.a, `${at}.a`), b = vec3(n.b, `${at}.b`);
      const ra = size(n.ra, `${at}.ra`), rb = size(n.rb, `${at}.rb`);
      const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      // one end sphere swallows the other: the round cone degenerates to that sphere
      if (Math.abs(ra - rb) >= L * 0.999) {
        const [c, r] = ra >= rb ? [a, ra] : [b, rb];
        return { f: (x, y, z) => Math.hypot(x - c[0], y - c[1], z - c[2]) - r, min: [c[0] - r, c[1] - r, c[2] - r], max: [c[0] + r, c[1] + r, c[2] + r] };
      }
      return { f: (x, y, z) => sdRoundCone(x, y, z, a[0], a[1], a[2], b[0], b[1], b[2], ra, rb), ...segBounds(a, b, ra, rb) };
    }
    case 'cylinder': {
      const r = size(n.r, `${at}.r`), h = size(n.h, `${at}.h`) / 2;
      return { f: (x, y, z) => sdCylinder(x, y, z, r, h), min: [-r, -h, -r], max: [r, h, r] };
    }
    case 'torus': {
      const R = size(n.R, `${at}.R`), r = size(n.r, `${at}.r`);
      return { f: (x, y, z) => sdTorus(x, y, z, R, r), min: [-R - r, -r, -R - r], max: [R + r, r, R + r] };
    }
    case 'figure': {
      if (++ctx.figures > SDF_LIMITS.MAX_FIGURES) throw new RangeError(`sdf: at most ${SDF_LIMITS.MAX_FIGURES} figures`);
      const fig = makeFigure(figureSpec(n, at));
      return { f: fig.sdf, min: fig.min, max: fig.max };
    }
    default:
      throw new TypeError(`${at}: unknown shape; use ${SHAPES}`);
  }
}

function segBounds(a: V3, b: V3, ra: number, rb: number): { min: V3; max: V3 } {
  return {
    min: [Math.min(a[0] - ra, b[0] - rb), Math.min(a[1] - ra, b[1] - rb), Math.min(a[2] - ra, b[2] - rb)],
    max: [Math.max(a[0] + ra, b[0] + rb), Math.max(a[1] + ra, b[1] + rb), Math.max(a[2] + ra, b[2] + rb)],
  };
}

function items(v: unknown, what: string, depth: number, ctx: Ctx): CompiledSdf[] {
  if (!Array.isArray(v) || v.length === 0) throw new TypeError(`${what}: expected a non-empty array of nodes`);
  if (v.length > SDF_LIMITS.MAX_NODES) throw new RangeError(`sdf: at most ${SDF_LIMITS.MAX_NODES} nodes`);
  const out: CompiledSdf[] = [];
  for (let i = 0; i < v.length; i++) out.push(compileNode(v[i], depth + 1, ctx, `${what}[${i}]`));
  return out;
}

/** Squared distance from (x, y, z) to the AABB at offset o of a packed [minx miny minz maxx maxy maxz]* table. */
function boxDist2(B: Float64Array, o: number, x: number, y: number, z: number): number {
  const dx = Math.max((B[o] as number) - x, 0, x - (B[o + 3] as number));
  const dy = Math.max((B[o + 1] as number) - y, 0, y - (B[o + 4] as number));
  const dz = Math.max((B[o + 2] as number) - z, 0, z - (B[o + 5] as number));
  return dx * dx + dy * dy + dz * dz;
}

function compileOp(n: Record<string, unknown>, op: string, depth: number, ctx: Ctx, path: string): CompiledSdf {
  const at = `${path}(${op})`;
  const k = blend(n.k, `${at}.k`);
  if (op === 'union') {
    const cs = items(n.items, `${at}.items`, depth, ctx);
    if (cs.length === 1) return cs[0] as CompiledSdf;
    const fs = cs.map((c) => c.f);
    const B = Float64Array.from(cs.flatMap((c) => [...c.min, ...c.max]));
    const count = fs.length;
    // A child whose box is farther than the running distance (+ blend) cannot change the result: skip it.
    const f: SdfFn = (x, y, z) => {
      let d = 1e9;
      for (let i = 0; i < count; i++) {
        const lim = d + k;
        if (lim > 0 && boxDist2(B, i * 6, x, y, z) >= lim * lim) continue;
        const v = (fs[i] as SdfFn)(x, y, z);
        d = k > 0 ? smin(d, v, k) : v < d ? v : d;
      }
      return d;
    };
    const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
    for (const c of cs) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i] as number, c.min[i] as number); max[i] = Math.max(max[i] as number, c.max[i] as number); }
    // a smooth union fills in up to k/4 beyond its parts
    for (let i = 0; i < 3; i++) { min[i] = (min[i] as number) - k * 0.25; max[i] = (max[i] as number) + k * 0.25; }
    return { f, min, max };
  }
  if (op === 'subtract') {
    const a = compileNode(n.a, depth + 1, ctx, `${at}.a`);
    const b = compileNode(n.b, depth + 1, ctx, `${at}.b`);
    const fa = a.f, fb = b.f;
    const B = Float64Array.from([...b.min, ...b.max]);
    const f: SdfFn = (x, y, z) => {
      const da = fa(x, y, z);
      // outside b's box by more than the blend reaches: b cannot carve here
      const lim = k - da, b2 = boxDist2(B, 0, x, y, z);
      if (b2 > 0 && (lim <= 0 || b2 > lim * lim)) return da;
      return smax(da, -fb(x, y, z), k);
    };
    return { f, min: a.min, max: a.max };
  }
  if (op === 'intersect') {
    const cs = items(n.items, `${at}.items`, depth, ctx);
    if (cs.length === 1) return cs[0] as CompiledSdf;
    const fs = cs.map((c) => c.f);
    const count = fs.length;
    const f: SdfFn = (x, y, z) => {
      let d = (fs[0] as SdfFn)(x, y, z);
      for (let i = 1; i < count; i++) d = smax(d, (fs[i] as SdfFn)(x, y, z), k);
      return d;
    };
    const min: V3 = [...cs[0]!.min], max: V3 = [...cs[0]!.max];
    for (const c of cs) for (let i = 0; i < 3; i++) { min[i] = Math.max(min[i] as number, c.min[i] as number); max[i] = Math.min(max[i] as number, c.max[i] as number); }
    for (let i = 0; i < 3; i++) if ((max[i] as number) < (min[i] as number)) max[i] = min[i] as number; // disjoint: empty
    return { f, min, max };
  }
  throw new TypeError(`${at}: unknown op; use union | subtract | intersect`);
}

/** Node transform: scale, then rotate (Euler XYZ degrees, like MeshHandle.rotate), then move to `at`. */
function transform(n: Record<string, unknown>, c: CompiledSdf, path: string): CompiledSdf {
  const at = n.at === undefined ? null : vec3(n.at, `${path}.at`);
  const rot = n.rot === undefined ? null : vec3(n.rot, `${path}.rot`);
  const s = n.scale === undefined ? 1 : size(n.scale, `${path}.scale`);
  if (!at && !rot && s === 1) return c;
  const m = mat3FromEulerDeg(rot?.[0] ?? 0, rot?.[1] ?? 0, rot?.[2] ?? 0);
  const m00 = m[0] as number, m01 = m[1] as number, m02 = m[2] as number;
  const m10 = m[3] as number, m11 = m[4] as number, m12 = m[5] as number;
  const m20 = m[6] as number, m21 = m[7] as number, m22 = m[8] as number;
  const tx = at?.[0] ?? 0, ty = at?.[1] ?? 0, tz = at?.[2] ?? 0, is = 1 / s;
  const g = c.f;
  // world → local is Mᵀ(p - t) / s; distances scale back by s
  const f: SdfFn = rot
    ? (x, y, z) => {
      const px = x - tx, py = y - ty, pz = z - tz;
      return g((m00 * px + m10 * py + m20 * pz) * is, (m01 * px + m11 * py + m21 * pz) * is, (m02 * px + m12 * py + m22 * pz) * is) * s;
    }
    : (x, y, z) => g((x - tx) * is, (y - ty) * is, (z - tz) * is) * s;
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  for (let q = 0; q < 8; q++) {
    const lx = (q & 1 ? c.max[0] : c.min[0]) * s, ly = (q & 2 ? c.max[1] : c.min[1]) * s, lz = (q & 4 ? c.max[2] : c.min[2]) * s;
    const w: V3 = [m00 * lx + m01 * ly + m02 * lz + tx, m10 * lx + m11 * ly + m12 * lz + ty, m20 * lx + m21 * ly + m22 * lz + tz];
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i] as number, w[i] as number); max[i] = Math.max(max[i] as number, w[i] as number); }
  }
  return { f, min, max };
}

// ------------------------------------------------------------------ figure spec (untrusted JSON → sanitized spec)
const DEG = Math.PI / 180;
const DRAPE_NUM = ['hemY', 'beltY', 'folds', 'foldAmp', 'skirtBottom', 'hipWide', 'slim', 'wide', 'legPush', 'fine', 'hemCurve', 'hemSide', 'overFolds', 'overAmp', 'chestFolds', 'hemScallop', 'mantleScale', 'mantleFront', 'mantleBack', 'himTop', 'himSlope', 'himBottom', 'fallBottom', 'lapTop'] as const;
const DRAPE_BOOL = ['zigzag', 'belt', 'mantle', 'mantleSideL', 'himation', 'overfold', 'curtain', 'bodice', 'bareChest'] as const;

function optNum(v: unknown, what: string, lo: number, hi: number, k = 1): number | undefined {
  if (v === undefined) return undefined;
  return Math.min(hi, Math.max(lo, finite(v, what))) * k;
}
function optVec(v: unknown, what: string, lim = 4): V3 | undefined {
  if (v === undefined) return undefined;
  const p = vec3(v, what);
  return [Math.max(-lim, Math.min(lim, p[0])), Math.max(-lim, Math.min(lim, p[1])), Math.max(-lim, Math.min(lim, p[2]))];
}
function optEnum<T extends string>(v: unknown, what: string, options: readonly T[]): T | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || !(options as readonly string[]).includes(v)) throw new TypeError(`${what}: use ${options.join(' | ')}`);
  return v as T;
}
function optBool(v: unknown): boolean | undefined {
  return v === undefined ? undefined : v === true;
}
function angles<K extends string>(v: unknown, what: string, keys: readonly K[]): Partial<Record<K, number>> | undefined {
  if (v === undefined) return undefined;
  if (!isObj(v)) throw new TypeError(`${what}: expected { ${keys.join(', ')} } in degrees`);
  const out: Partial<Record<K, number>> = {};
  for (const k of keys) {
    const a = optNum(v[k], `${what}.${k}`, -180, 180, DEG);
    if (a !== undefined) out[k] = a;
  }
  return out;
}
function arm(v: unknown, what: string): ArmSpec | undefined {
  if (v === undefined) return undefined;
  if (!isObj(v)) throw new TypeError(`${what}: expected { wrist, pole, fingers, dorsal, curl, spread }`);
  const out: ArmSpec = {};
  const set = <K extends keyof ArmSpec>(k: K, val: ArmSpec[K] | undefined): void => { if (val !== undefined) out[k] = val; };
  set('wrist', optVec(v.wrist, `${what}.wrist`));
  set('pole', optVec(v.pole, `${what}.pole`));
  set('fingers', optVec(v.fingers, `${what}.fingers`));
  set('dorsal', optVec(v.dorsal, `${what}.dorsal`));
  const curl = optVec(v.curl, `${what}.curl`, 180);
  if (curl) out.curl = [curl[0] * DEG, curl[1] * DEG, curl[2] * DEG];
  set('spread', optNum(v.spread, `${what}.spread`, -30, 30, DEG));
  set('thumbCurl', optNum(v.thumbCurl, `${what}.thumbCurl`, 0, 1.5));
  set('handScale', optNum(v.handScale, `${what}.handScale`, 0.5, 2));
  return out;
}

/** Read a `figure` node into a {@link FigureSpec}: known keys only, numbers clamped, angles degrees → radians. */
function figureSpec(n: Record<string, unknown>, what: string): FigureSpec {
  const spec: FigureSpec = {};
  const set = <K extends keyof FigureSpec>(k: K, val: FigureSpec[K] | undefined): void => { if (val !== undefined) spec[k] = val; };
  set('sex', optEnum(n.sex, `${what}.sex`, ['f', 'm'] as const));
  set('seed', optNum(n.seed, `${what}.seed`, -1e6, 1e6));
  set('garment', optEnum(n.garment, `${what}.garment`, ['peplos', 'chiton', 'himation', 'chlamys', 'nude', 'lap'] as const));
  set('weight', optEnum(n.weight, `${what}.weight`, ['R', 'L'] as const));
  set('hair', optEnum(n.hair, `${what}.hair`, ['wavy', 'curly', 'none'] as const));
  set('beard', optBool(n.beard));
  set('strong', optBool(n.strong));
  set('locks', optBool(n.locks));
  set('kneel', optNum(n.kneel, `${what}.kneel`, 0, 1));
  set('seat', optNum(n.seat, `${what}.seat`, 0, 0.9));
  set('hipWide', optNum(n.hipWide, `${what}.hipWide`, -0.05, 0.1));
  set('headScale', optNum(n.headScale, `${what}.headScale`, 0.7, 1.5));
  set('freeAnkle', optVec(n.freeAnkle, `${what}.freeAnkle`));
  set('weightAnkle', optVec(n.weightAnkle, `${what}.weightAnkle`));
  set('armR', arm(n.armR, `${what}.armR`));
  set('armL', arm(n.armL, `${what}.armL`));
  set('chest', angles(n.chest, `${what}.chest`, ['roll', 'yaw', 'pitch'] as const));
  set('head', angles(n.head, `${what}.head`, ['yaw', 'pitch', 'roll'] as const));
  if (n.hip !== undefined) {
    const h = n.hip;
    if (!isObj(h)) throw new TypeError(`${what}.hip: expected { roll, yaw, pitch, y, shift }`);
    const hip: NonNullable<FigureSpec['hip']> = { ...angles(h, `${what}.hip`, ['roll', 'yaw', 'pitch'] as const) };
    const y = optNum(h.y, `${what}.hip.y`, 0.1, 1.3);
    if (y !== undefined) hip.y = y;
    if (h.shift !== undefined) {
      if (!Array.isArray(h.shift) || h.shift.length !== 2) throw new TypeError(`${what}.hip.shift: expected [x, z]`);
      hip.shift = [Math.max(-0.5, Math.min(0.5, coord(h.shift[0], `${what}.hip.shift[0]`))), Math.max(-0.5, Math.min(0.5, coord(h.shift[1], `${what}.hip.shift[1]`)))];
    }
    spec.hip = hip;
  }
  if (n.drape !== undefined) {
    const d = n.drape;
    if (!isObj(d)) throw new TypeError(`${what}.drape: expected an object`);
    const drape: DrapeSpec = {};
    for (const k of DRAPE_NUM) {
      const v = optNum(d[k], `${what}.drape.${k}`, -3, 80);
      if (v !== undefined) drape[k] = v;
    }
    for (const k of DRAPE_BOOL) {
      const v = optBool(d[k]);
      if (v !== undefined) drape[k] = v;
    }
    spec.drape = drape;
  }
  return spec;
}

// ------------------------------------------------------------------ mesher
const B = 8; // block edge in cells
const S = B + 1; // samples per block edge
const S3 = S * S * S;
const BAND_SCALE = 1.5; // tolerated Lipschitz constant of the field

interface Grid { blocks: Map<number, Float32Array>; bx: number; by: number; bz: number }

/**
 * Mesh `field` inside [min, max] (padded by two cells). Returns an indexed mesh with gradient normals and
 * box-projected metre UVs; empty when the field has no surface in the bounds.
 */
export function meshSdf(budget: VertexBudget, field: SdfFn, minIn: Vec3, maxIn: Vec3, opts: SdfMeshOptions = {}): Mesh {
  const smooth = Math.round(optNum(opts.smooth, 'sdf(smooth)', 0, SDF_LIMITS.MAX_SMOOTH) ?? 1);
  const project = Math.round(optNum(opts.project, 'sdf(project)', 0, SDF_LIMITS.MAX_PROJECT) ?? 1);
  const resolution = Math.round(optNum(opts.resolution, 'sdf(resolution)', 8, SDF_LIMITS.MAX_RESOLUTION) ?? SDF_LIMITS.DEFAULT_RESOLUTION);
  const maxTris = Math.round(optNum(opts.maxTriangles, 'sdf(maxTriangles)', 12, SDF_LIMITS.MAX_TRIANGLES) ?? SDF_LIMITS.MAX_TRIANGLES);
  const detail = opts.detail;
  if (detail !== undefined && typeof detail !== 'function') throw new TypeError('sdf(detail): expected a function (x, y, z) => number');
  const f: SdfFn = detail
    ? (x, y, z) => {
      const v = detail(x, y, z);
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError('sdf(detail): must return a finite number');
      return field(x, y, z) + v;
    }
    : field;
  const lo = vec3(minIn, 'sdf(min)'), hi = vec3(maxIn, 'sdf(max)');
  const ext = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  if (!(ext > 0) || hi[0] < lo[0] || hi[1] < lo[1] || hi[2] < lo[2]) return new MeshBuilder(0, 0).build(budget);
  let h = opts.cell !== undefined ? size(opts.cell, 'sdf(cell)') : ext / resolution;
  h = Math.max(h, ext / SDF_LIMITS.MAX_RESOLUTION, KERNEL_LIMITS.MIN_DIMENSION);
  for (let attempt = 0; ; attempt++) {
    const r = surfaceNets(f, lo, hi, h, Math.ceil(maxTris / 2) + 64);
    if (r && r.index.length / 3 <= maxTris) return finish(budget, f, r.verts, r.vcount, r.index, h, smooth, project);
    if (attempt >= 6) throw new RangeError('sdf: surface too detailed for the triangle cap; raise cell or shrink the bounds');
    // over the cap: coarsen (triangles scale with 1/cell²)
    const tris = r ? r.index.length / 3 : maxTris * 2;
    h *= Math.max(1.2, Math.sqrt(tris / maxTris) * 1.06);
  }
}

/** Sample the narrow band and place vertices; null when the vertex count passes `maxVerts` (caller coarsens). */
function surfaceNets(f: SdfFn, lo: V3, hi: V3, h: number, maxVerts: number): { verts: Float64Array; vcount: number; index: Uint32Array } | null {
  const ox = lo[0] - 2 * h, oy = lo[1] - 2 * h, oz = lo[2] - 2 * h;
  const nx = Math.ceil((hi[0] - lo[0]) / h) + 4, ny = Math.ceil((hi[1] - lo[1]) / h) + 4, nz = Math.ceil((hi[2] - lo[2]) / h) + 4;
  const bx = Math.ceil(nx / B), by = Math.ceil(ny / B), bz = Math.ceil(nz / B);
  const grid: Grid = { blocks: new Map(), bx, by, bz };
  // |d| above band(n) at the centre of an n-cell cube proves no surface within a cell of it
  const band = (n: number): number => (Math.sqrt(3) * 0.5 * n + 1) * h * BAND_SCALE;
  const state = new Uint8Array(S3); // 0 unset, 1 constant (proven sign), 2 exact
  let arr = new Float32Array(S3);
  let i0 = 0, j0 = 0, k0 = 0; // global sample origin of the current block

  const fill = (a: number, b: number, c: number, n: number, dc: number): void => {
    if (Math.abs(dc) > band(n)) {
      for (let p = a; p <= a + n; p++) for (let q = b; q <= b + n; q++) for (let r = c; r <= c + n; r++) {
        const o = (p * S + q) * S + r;
        if (state[o] !== 2) { arr[o] = dc; state[o] = 1; }
      }
      return;
    }
    if (n === 2) {
      for (let p = a; p <= a + 2; p++) for (let q = b; q <= b + 2; q++) for (let r = c; r <= c + 2; r++) {
        const o = (p * S + q) * S + r;
        if (state[o] === 2) continue;
        arr[o] = f(ox + (i0 + p) * h, oy + (j0 + q) * h, oz + (k0 + r) * h);
        state[o] = 2;
      }
      return;
    }
    const m = n / 2;
    for (let s = 0; s < 8; s++) {
      const pa = a + (s & 1 ? m : 0), pb = b + (s & 2 ? m : 0), pc = c + (s & 4 ? m : 0);
      fill(pa, pb, pc, m, f(ox + (i0 + pa + m / 2) * h, oy + (j0 + pb + m / 2) * h, oz + (k0 + pc + m / 2) * h));
    }
  };

  let verts = new Float64Array(3 * 4096);
  let vcount = 0;
  const vmap = new Map<number, number>();
  const NY = by * B + 1, NZ = bz * B + 1; // cell-key strides (blocks may run past the grid)
  const cellKey = (i: number, j: number, k: number): number => (i * NY + j) * NZ + k;
  const vals = new Float64Array(8);
  for (let bi = 0; bi < bx; bi++) for (let bj = 0; bj < by; bj++) for (let bk = 0; bk < bz; bk++) {
    i0 = bi * B; j0 = bj * B; k0 = bk * B;
    const d = f(ox + (i0 + B / 2) * h, oy + (j0 + B / 2) * h, oz + (k0 + B / 2) * h);
    if (Math.abs(d) > band(B)) continue;
    arr = new Float32Array(S3);
    state.fill(0);
    fill(0, 0, 0, B, d);
    grid.blocks.set((bi * by + bj) * bz + bk, arr);
    // one vertex per sign-changing cell, at the mean of its edge crossings
    for (let a = 0; a < B; a++) for (let b = 0; b < B; b++) for (let c = 0; c < B; c++) {
      let mask = 0;
      for (let q = 0; q < 8; q++) {
        const v = arr[((a + (q & 1)) * S + (b + ((q >> 1) & 1))) * S + (c + (q >> 2))] as number;
        vals[q] = v;
        if (v < 0) mask |= 1 << q;
      }
      if (mask === 0 || mask === 255) continue;
      let sx = 0, sy = 0, sz = 0, cnt = 0;
      for (let e = 0; e < 12; e++) {
        const e0 = EDGES[e * 2] as number, e1 = EDGES[e * 2 + 1] as number;
        const v0 = vals[e0] as number, v1 = vals[e1] as number;
        if (v0 < 0 === v1 < 0) continue;
        const t = v0 / (v0 - v1);
        sx += (e0 & 1) + ((e1 & 1) - (e0 & 1)) * t;
        sy += ((e0 >> 1) & 1) + (((e1 >> 1) & 1) - ((e0 >> 1) & 1)) * t;
        sz += (e0 >> 2) + ((e1 >> 2) - (e0 >> 2)) * t;
        cnt++;
      }
      const gi = i0 + a, gj = j0 + b, gk = k0 + c;
      if (vcount * 3 + 3 > verts.length) { const nv = new Float64Array(verts.length * 2); nv.set(verts); verts = nv; }
      verts[vcount * 3] = ox + (gi + sx / cnt) * h;
      verts[vcount * 3 + 1] = oy + (gj + sy / cnt) * h;
      verts[vcount * 3 + 2] = oz + (gk + sz / cnt) * h;
      vmap.set(cellKey(gi, gj, gk), vcount++);
      if (vcount > maxVerts) return null;
    }
  }

  // a quad per sign-changing grid edge, joining the four cells round it (wound so the front faces +gradient)
  const index: number[] = [];
  const quad = (c0: number, c1: number, c2: number, c3: number, flip: boolean): void => {
    const a = vmap.get(c0), b = vmap.get(c1), c = vmap.get(c2), d = vmap.get(c3);
    if (a === undefined || b === undefined || c === undefined || d === undefined) return;
    // cycle a-b-d-c: split along the diagonal whose two triangles agree best (a fixed split folds on bent quads)
    const bd = dotTri(verts, a, b, d, a, d, c) > dotTri(verts, a, b, c, b, d, c);
    if (flip) {
      if (bd) index.push(a, d, b, a, c, d);
      else index.push(a, c, b, b, c, d);
    } else if (bd) index.push(a, b, d, a, d, c);
    else index.push(a, b, c, b, d, c);
  };
  for (const key of vmap.keys()) {
    const k = key % NZ, j = Math.floor(key / NZ) % NY, i = Math.floor(key / (NZ * NY));
    // the three grid edges ending at the cell's max corner
    const v = sampleAt(grid, i + 1, j + 1, k + 1);
    if (Number.isNaN(v)) continue;
    const ax = sampleAt(grid, i, j + 1, k + 1), ay = sampleAt(grid, i + 1, j, k + 1), az = sampleAt(grid, i + 1, j + 1, k);
    if (!Number.isNaN(ax) && v < 0 !== ax < 0) quad(cellKey(i, j, k), cellKey(i, j + 1, k), cellKey(i, j, k + 1), cellKey(i, j + 1, k + 1), v < 0);
    if (!Number.isNaN(ay) && v < 0 !== ay < 0) quad(cellKey(i, j, k), cellKey(i, j, k + 1), cellKey(i + 1, j, k), cellKey(i + 1, j, k + 1), v < 0);
    if (!Number.isNaN(az) && v < 0 !== az < 0) quad(cellKey(i, j, k), cellKey(i + 1, j, k), cellKey(i, j + 1, k), cellKey(i + 1, j + 1, k), v < 0);
  }
  return { verts, vcount, index: Uint32Array.from(index) };
}

/** Unnormalised face normal of triangle (a, b, c) into out[o..o+2]. */
function faceNormal(p: ArrayLike<number>, a: number, b: number, c: number, out: Float64Array, o: number): void {
  const ax = p[a * 3] as number, ay = p[a * 3 + 1] as number, az = p[a * 3 + 2] as number;
  const e1x = (p[b * 3] as number) - ax, e1y = (p[b * 3 + 1] as number) - ay, e1z = (p[b * 3 + 2] as number) - az;
  const e2x = (p[c * 3] as number) - ax, e2y = (p[c * 3 + 1] as number) - ay, e2z = (p[c * 3 + 2] as number) - az;
  out[o] = e1y * e2z - e1z * e2y;
  out[o + 1] = e1z * e2x - e1x * e2z;
  out[o + 2] = e1x * e2y - e1y * e2x;
}
const triScratch = new Float64Array(6);
/** Cosine between the normals of triangles (a, b, c) and (d, e, f). */
function dotTri(p: ArrayLike<number>, a: number, b: number, c: number, d: number, e: number, f: number): number {
  const t = triScratch;
  faceNormal(p, a, b, c, t, 0);
  faceNormal(p, d, e, f, t, 3);
  const l = Math.hypot(t[0] as number, t[1] as number, t[2] as number) * Math.hypot(t[3] as number, t[4] as number, t[5] as number);
  return l > 0 ? ((t[0] as number) * (t[3] as number) + (t[1] as number) * (t[4] as number) + (t[2] as number) * (t[5] as number)) / l : -1;
}

/** Cube corner pairs of the 12 cell edges (corner q = x | y << 1 | z << 2). */
const EDGES = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 0, 2, 1, 3, 4, 6, 5, 7, 0, 4, 1, 5, 2, 6, 3, 7]);

/** Sample at a global grid point from whichever stored block holds it (NaN when none was sampled). */
function sampleAt(g: Grid, gi: number, gj: number, gk: number): number {
  if (gi < 0 || gj < 0 || gk < 0) return NaN;
  const i1 = Math.min(g.bx - 1, Math.floor(gi / B)), j1 = Math.min(g.by - 1, Math.floor(gj / B)), k1 = Math.min(g.bz - 1, Math.floor(gk / B));
  // a point on a block face is also stored by the block below it
  const i0 = gi % B === 0 && i1 > 0 && i1 * B === gi ? i1 - 1 : i1;
  const j0 = gj % B === 0 && j1 > 0 && j1 * B === gj ? j1 - 1 : j1;
  const k0 = gk % B === 0 && k1 > 0 && k1 * B === gk ? k1 - 1 : k1;
  for (let i = i1; i >= i0; i--) for (let j = j1; j >= j0; j--) for (let k = k1; k >= k0; k--) {
    const blk = g.blocks.get((i * g.by + j) * g.bz + k);
    const a = gi - i * B, b = gj - j * B, c = gk - k * B;
    if (blk && a <= B && b <= B && c <= B) return blk[(a * S + b) * S + c] as number;
  }
  return NaN;
}

/**
 * Smooth, project onto the surface, take gradient normals and build the mesh. Where the field is not a clean
 * distance (sub-cell parts, two sheets in one cell) a vertex normal may oppose the surface round it: it falls back
 * to the area-weighted face normal, and the few triangles still folded against their normals are dropped (they
 * face inward, so a single-sided renderer culls them anyway).
 */
function finish(budget: VertexBudget, f: SdfFn, verts: Float64Array, n: number, index: Uint32Array, h: number, smooth: number, project: number): Mesh {
  let pos = verts.subarray(0, n * 3);
  if (smooth > 0 && index.length > 0) pos = smoothPositions(pos, n, index, smooth, 0.5);
  else pos = Float64Array.from(pos);
  // tetrahedral gradient: 4 samples give both the gradient and the distance (exact for a linear field)
  const e = h * 0.5;
  const g = new Float64Array(4);
  const grad = (x: number, y: number, z: number): void => {
    const f0 = f(x + e, y - e, z - e), f1 = f(x - e, y - e, z + e), f2 = f(x - e, y + e, z - e), f3 = f(x + e, y + e, z + e);
    g[0] = f0 - f1 - f2 + f3;
    g[1] = -f0 - f1 + f2 + f3;
    g[2] = -f0 + f1 - f2 + f3;
    g[3] = (f0 + f1 + f2 + f3) * 0.25;
  };
  const nor = new Float64Array(n * 3);
  for (let v = 0; v < n; v++) {
    let x = pos[v * 3] as number, y = pos[v * 3 + 1] as number, z = pos[v * 3 + 2] as number;
    // the last projection gradient doubles as the normal (taken under half a cell from the final point)
    let fresh = false;
    for (let it = 0; it < project; it++) {
      grad(x, y, z);
      fresh = true;
      const g2 = (g[0] as number) ** 2 + (g[1] as number) ** 2 + (g[2] as number) ** 2;
      if (g2 < 1e-24) break;
      // Newton step d·∇f/|∇f|², with ∇f = g / 4e; at most half a cell (protects thin features)
      let k = ((g[3] as number) * 4 * e) / g2;
      const step = Math.abs(k) * Math.sqrt(g2);
      if (step > h * 0.5) k *= (h * 0.5) / step;
      x -= (g[0] as number) * k; y -= (g[1] as number) * k; z -= (g[2] as number) * k;
    }
    pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
    if (!fresh) grad(x, y, z);
    const l = Math.hypot(g[0] as number, g[1] as number, g[2] as number);
    if (l > 1e-20) { nor[v * 3] = (g[0] as number) / l; nor[v * 3 + 1] = (g[1] as number) / l; nor[v * 3 + 2] = (g[2] as number) / l; }
  }
  // area-weighted face normals per vertex: the fallback where the gradient disagrees with the surface
  const acc = new Float64Array(n * 3);
  const fn = new Float64Array(3);
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] as number, b = index[t + 1] as number, c = index[t + 2] as number;
    faceNormal(pos, a, b, c, fn, 0);
    for (const v of [a, b, c]) for (let q = 0; q < 3; q++) acc[v * 3 + q] = (acc[v * 3 + q] as number) + (fn[q] as number);
  }
  for (let v = 0; v < n; v++) {
    const o = v * 3;
    const ax = acc[o] as number, ay = acc[o + 1] as number, az = acc[o + 2] as number;
    const al = Math.hypot(ax, ay, az);
    if (al < 1e-30) { if (nor[o] === 0 && nor[o + 1] === 0 && nor[o + 2] === 0) nor[o + 1] = 1; continue; }
    if ((nor[o] as number) * ax + (nor[o + 1] as number) * ay + (nor[o + 2] as number) * az <= 0) { nor[o] = ax / al; nor[o + 1] = ay / al; nor[o + 2] = az / al; }
  }
  const b = new MeshBuilder(n, index.length);
  for (let v = 0; v < n; v++) {
    const o = v * 3;
    const x = pos[o] as number, y = pos[o + 1] as number, z = pos[o + 2] as number;
    const nx = nor[o] as number, ny = nor[o + 1] as number, nz = nor[o + 2] as number;
    // box-projected metre UVs (finishes tile at real scale)
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    const top = ay >= ax && ay >= az;
    b.vertex(x, y, z, nx, ny, nz, top || az >= ax ? x : z, top ? z : y);
  }
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] as number, c1 = index[t + 1] as number, c2 = index[t + 2] as number;
    faceNormal(pos, a, c1, c2, fn, 0);
    let dot = 0;
    for (let q = 0; q < 3; q++) dot += (fn[q] as number) * ((nor[a * 3 + q] as number) + (nor[c1 * 3 + q] as number) + (nor[c2 * 3 + q] as number));
    if (dot < 0) continue; // folded over
    b.tri(a, c1, c2);
  }
  return b.build(budget);
}

/** Laplacian smoothing over the mesh edges (CSR adjacency; every interior edge is listed twice, uniformly). */
function smoothPositions(pos: Float64Array, n: number, index: Uint32Array, passes: number, k: number): Float64Array {
  const deg = new Uint32Array(n + 1);
  for (let t = 0; t < index.length; t++) deg[(index[t] as number) + 1] = (deg[(index[t] as number) + 1] as number) + 2;
  for (let v = 0; v < n; v++) deg[v + 1] = (deg[v + 1] as number) + (deg[v] as number);
  const adj = new Uint32Array(deg[n] as number);
  const fillAt = deg.slice(0, n);
  const link = (a: number, b: number): void => { adj[fillAt[a] as number] = b; fillAt[a] = (fillAt[a] as number) + 1; };
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] as number, b = index[t + 1] as number, c = index[t + 2] as number;
    link(a, b); link(a, c); link(b, a); link(b, c); link(c, a); link(c, b);
  }
  let cur = Float64Array.from(pos);
  let next = new Float64Array(cur.length);
  for (let p = 0; p < passes; p++) {
    for (let v = 0; v < n; v++) {
      const s = deg[v] as number, end = deg[v + 1] as number, o = v * 3;
      if (end === s) { next[o] = cur[o] as number; next[o + 1] = cur[o + 1] as number; next[o + 2] = cur[o + 2] as number; continue; }
      let sx = 0, sy = 0, sz = 0;
      for (let q = s; q < end; q++) { const w = (adj[q] as number) * 3; sx += cur[w] as number; sy += cur[w + 1] as number; sz += cur[w + 2] as number; }
      const inv = 1 / (end - s);
      next[o] = (cur[o] as number) + (sx * inv - (cur[o] as number)) * k;
      next[o + 1] = (cur[o + 1] as number) + (sy * inv - (cur[o + 1] as number)) * k;
      next[o + 2] = (cur[o + 2] as number) + (sz * inv - (cur[o + 2] as number)) * k;
    }
    const t = cur; cur = next; next = t;
  }
  return cur;
}

/** `api.sdf`: compile `tree`, mesh it inside its own bounds (or `opts.min/max`). */
export function sdfMesh(budget: VertexBudget, tree: unknown, opts: SdfMeshOptions = {}): Mesh {
  if (opts !== undefined && opts !== null && typeof opts !== 'object') throw new TypeError('sdf(tree, opts): opts must be an object');
  const o = (opts ?? {}) as SdfMeshOptions;
  const c = compileSdf(tree);
  const min = o.min !== undefined ? vec3(o.min, 'sdf(min)') : c.min;
  const max = o.max !== undefined ? vec3(o.max, 'sdf(max)') : c.max;
  return meshSdf(budget, c.f, min, max, o);
}
