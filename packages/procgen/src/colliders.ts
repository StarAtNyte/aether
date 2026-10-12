/**
 * Collider validation, translation and derivation helpers. Every collider
 * that enters an output passes through {@link parseCollider}, which copies
 * arrays (no aliasing of caller memory) and enforces the size limits.
 */
import type { Vec3 } from '@aether/core';
import type { ColliderDesc } from './types';
import { PROCGEN_LIMITS } from './limits';

type Rec = Record<string, unknown>;

function isRecord(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !ArrayBuffer.isView(v);
}

function field(o: Rec, k: string): unknown {
  return Object.hasOwn(o, k) ? o[k] : undefined;
}

function num(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`${what}: expected a finite number`);
  if (Math.abs(v) > PROCGEN_LIMITS.MAX_COORDINATE) throw new RangeError(`${what}: magnitude exceeds ${PROCGEN_LIMITS.MAX_COORDINATE}`);
  return v;
}

function positive(v: unknown, what: string, min = 1e-3): number {
  const n = num(v, what);
  if (n < 0) throw new RangeError(`${what}: must be positive`);
  return Math.max(min, n);
}

function vec3(v: unknown, what: string, fallback?: Vec3): Vec3 {
  if (v === undefined && fallback) return [fallback[0], fallback[1], fallback[2]];
  if (!(Array.isArray(v) || ArrayBuffer.isView(v)) || (v as ArrayLike<unknown>).length !== 3) {
    throw new TypeError(`${what}: expected [x, y, z]`);
  }
  const a = v as ArrayLike<unknown>;
  return [num(a[0], `${what}[0]`), num(a[1], `${what}[1]`), num(a[2], `${what}[2]`)];
}

function floatArray(v: unknown, what: string, maxLen: number): Float32Array {
  if (!(Array.isArray(v) || v instanceof Float32Array || v instanceof Float64Array)) {
    throw new TypeError(`${what}: expected a Float32Array or number array`);
  }
  const a = v as ArrayLike<unknown>;
  if (a.length > maxLen) throw new RangeError(`${what}: too many values (max ${maxLen})`);
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = num(a[i], what);
  return out;
}

const UNIT_OFFSET: Vec3 = [0, 0, 0];

/**
 * Validate and deep-copy an untrusted collider description. A missing
 * `offset` defaults to [0, 0, 0]. Throws TypeError/RangeError on bad input.
 */
export function parseCollider(input: unknown): ColliderDesc {
  if (!isRecord(input)) throw new TypeError('collider: expected an object with a "kind"');
  const kind = field(input, 'kind');
  switch (kind) {
    case 'box': {
      const he = vec3(field(input, 'halfExtents'), 'collider.halfExtents');
      const out: ColliderDesc = {
        kind: 'box',
        halfExtents: [positive(he[0], 'halfExtents[0]'), positive(he[1], 'halfExtents[1]'), positive(he[2], 'halfExtents[2]')],
        offset: vec3(field(input, 'offset'), 'collider.offset', UNIT_OFFSET),
      };
      const rot = field(input, 'rotation');
      if (rot !== undefined) out.rotation = vec3(rot, 'collider.rotation');
      return out;
    }
    case 'sphere':
      return { kind, radius: positive(field(input, 'radius'), 'collider.radius'), offset: vec3(field(input, 'offset'), 'collider.offset', UNIT_OFFSET) };
    case 'capsule':
    case 'cylinder':
      return {
        kind,
        halfHeight: positive(field(input, 'halfHeight'), 'collider.halfHeight', 0),
        radius: positive(field(input, 'radius'), 'collider.radius'),
        offset: vec3(field(input, 'offset'), 'collider.offset', UNIT_OFFSET),
      };
    case 'hull': {
      const points = floatArray(field(input, 'points'), 'collider.points', PROCGEN_LIMITS.MAX_HULL_POINTS * 3);
      if (points.length % 3 !== 0 || points.length < 12) throw new RangeError('collider.points: need at least 4 xyz points');
      return { kind, points, offset: vec3(field(input, 'offset'), 'collider.offset', UNIT_OFFSET) };
    }
    case 'trimesh': {
      const positions = floatArray(field(input, 'positions'), 'collider.positions', PROCGEN_LIMITS.MAX_TRIMESH_VERTICES * 3);
      if (positions.length % 3 !== 0 || positions.length < 9) throw new RangeError('collider.positions: need at least 3 xyz points');
      const idxIn = field(input, 'indices');
      if (!(Array.isArray(idxIn) || idxIn instanceof Uint32Array || idxIn instanceof Uint16Array)) {
        throw new TypeError('collider.indices: expected a Uint32Array or number array');
      }
      const ia = idxIn as ArrayLike<unknown>;
      if (ia.length % 3 !== 0 || ia.length === 0 || ia.length > PROCGEN_LIMITS.MAX_TRIMESH_VERTICES * 6) {
        throw new RangeError('collider.indices: length must be a positive multiple of 3 within limits');
      }
      const nv = positions.length / 3;
      const indices = new Uint32Array(ia.length);
      for (let i = 0; i < ia.length; i++) {
        const v = ia[i];
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v >= nv) throw new RangeError('collider.indices: index out of range');
        indices[i] = v;
      }
      return { kind, positions, indices };
    }
    case 'heightfield': {
      const rows = field(input, 'rows');
      const cols = field(input, 'cols');
      const max = PROCGEN_LIMITS.MAX_HEIGHTFIELD_CELLS;
      if (typeof rows !== 'number' || !Number.isInteger(rows) || rows < 1 || rows > max) throw new RangeError(`collider.rows: integer 1..${max}`);
      if (typeof cols !== 'number' || !Number.isInteger(cols) || cols < 1 || cols > max) throw new RangeError(`collider.cols: integer 1..${max}`);
      const heights = floatArray(field(input, 'heights'), 'collider.heights', (max + 1) * (max + 1));
      if (heights.length !== (rows + 1) * (cols + 1)) throw new RangeError('collider.heights: length must be (rows + 1) * (cols + 1)');
      for (let i = 0; i < heights.length; i++) {
        const h = heights[i] as number;
        if (h < -1e-4 || h > 1 + 1e-4) throw new RangeError('collider.heights: samples must be normalized to [0, 1]');
        heights[i] = Math.min(1, Math.max(0, h));
      }
      const s = vec3(field(input, 'size'), 'collider.size');
      return { kind, rows, cols, heights, size: [positive(s[0], 'size[0]'), positive(s[1], 'size[1]'), positive(s[2], 'size[2]')] };
    }
    default:
      throw new TypeError('collider.kind: must be one of box, sphere, capsule, cylinder, hull, trimesh, heightfield');
  }
}

/** Copy of `c` moved by (dx, dy, dz). Heightfields are origin-anchored and returned unchanged. */
export function translateCollider(c: ColliderDesc, dx: number, dy: number, dz: number): ColliderDesc {
  switch (c.kind) {
    case 'box':
      return { ...c, offset: [c.offset[0] + dx, c.offset[1] + dy, c.offset[2] + dz] };
    case 'sphere':
    case 'capsule':
    case 'cylinder':
      return { ...c, offset: [c.offset[0] + dx, c.offset[1] + dy, c.offset[2] + dz] };
    case 'hull': {
      return { kind: 'hull', points: c.points.slice(), offset: [c.offset[0] + dx, c.offset[1] + dy, c.offset[2] + dz] };
    }
    case 'trimesh': {
      const positions = c.positions.slice();
      for (let i = 0; i < positions.length; i += 3) {
        positions[i] = (positions[i] as number) + dx;
        positions[i + 1] = (positions[i + 1] as number) + dy;
        positions[i + 2] = (positions[i + 2] as number) + dz;
      }
      return { kind: 'trimesh', positions, indices: c.indices.slice() };
    }
    case 'heightfield':
      return { ...c, heights: c.heights.slice() };
  }
}

/** Fibonacci-sphere directions used to sample hull support points. */
function fibonacciDirections(n: number): Float64Array {
  const out = new Float64Array(n * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const th = golden * i;
    out[i * 3] = Math.cos(th) * r;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = Math.sin(th) * r;
  }
  return out;
}

const HULL_DIRECTIONS = fibonacciDirections(48);

/**
 * Approximate a point cloud's convex hull by its support points along 48
 * fixed directions (deduplicated). O(n · 48), returns ≤ 48 points.
 */
export function hullSupportPoints(positions: Float32Array, start = 0, end = positions.length / 3): Float32Array {
  const dirs = HULL_DIRECTIONS;
  const nd = dirs.length / 3;
  const best = new Int32Array(nd).fill(-1);
  const bestDot = new Float64Array(nd).fill(-Infinity);
  for (let i = start; i < end; i++) {
    const x = positions[i * 3] as number, y = positions[i * 3 + 1] as number, z = positions[i * 3 + 2] as number;
    for (let d = 0; d < nd; d++) {
      const dot = x * (dirs[d * 3] as number) + y * (dirs[d * 3 + 1] as number) + z * (dirs[d * 3 + 2] as number);
      if (dot > (bestDot[d] as number)) {
        bestDot[d] = dot;
        best[d] = i;
      }
    }
  }
  const unique = [...new Set(Array.from(best).filter((i) => i >= 0))].sort((a, b) => a - b);
  const out = new Float32Array(unique.length * 3);
  unique.forEach((vi, k) => {
    out[k * 3] = positions[vi * 3] as number;
    out[k * 3 + 1] = positions[vi * 3 + 1] as number;
    out[k * 3 + 2] = positions[vi * 3 + 2] as number;
  });
  return out;
}

/** Box collider helper (offset = center). */
export function boxCollider(cx: number, cy: number, cz: number, w: number, h: number, d: number, rotation?: Vec3): ColliderDesc {
  const c: ColliderDesc = { kind: 'box', halfExtents: [Math.max(1e-3, w / 2), Math.max(1e-3, h / 2), Math.max(1e-3, d / 2)], offset: [cx, cy, cz] };
  if (rotation) c.rotation = rotation;
  return c;
}

/** Y-aligned cylinder collider helper (offset = center). */
export function cylinderCollider(cx: number, cy: number, cz: number, radius: number, height: number): ColliderDesc {
  return { kind: 'cylinder', radius: Math.max(1e-3, radius), halfHeight: Math.max(0, height / 2), offset: [cx, cy, cz] };
}
