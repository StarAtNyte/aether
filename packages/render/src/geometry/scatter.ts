/**
 * Deterministic scatter placement for instanced rendering.
 *
 * The random stream, candidate selection and `minSpacing` rule mirror
 * `@aether/physics` `scatterInstances` exactly (same seed → identical x, z,
 * scale, yaw), so rendered instances sit where their colliders are. Unlike
 * the physics version this writes into flat typed arrays (no per-instance
 * objects) so 200k instances lay out in a few milliseconds.
 */
import { rng, scatterExcluded, type PrimitiveKind, type ScatterShape, type Vec3 } from '@aether/core';

/** Hard per-entity cap (matches the schema). */
export const MAX_SCATTER_INSTANCES = 1_000_000;
/** Candidates tried per instance when `minSpacing` is set (same as physics). */
const MAX_SPACING_ATTEMPTS = 12;

/** Placement inputs. */
export type ScatterParams = Pick<ScatterShape, 'count' | 'area' | 'seed' | 'scaleRange' | 'randomYaw' | 'minSpacing'> & Partial<Pick<ScatterShape, 'points' | 'exclude'>>;

/** Flat placement data in the scatter entity's local frame. */
export interface ScatterPlacements {
  count: number;
  x: Float32Array;
  z: Float32Array;
  scale: Float32Array;
  /** Yaw in radians. */
  yaw: Float32Array;
  /** Local heights of hand-placed points (null: random layout, y = 0 unless on a surface). */
  y: Float32Array | null;
}

/** Linked-list spatial hash over typed arrays (O(1) insert, 3x3 neighborhood query). */
class SpacingGrid {
  private readonly heads = new Map<number, number>();
  private readonly next: Int32Array;
  private readonly px: Float64Array;
  private readonly pz: Float64Array;
  private size = 0;

  constructor(
    capacity: number,
    private readonly cell: number,
    private readonly spacing2: number,
  ) {
    this.next = new Int32Array(capacity);
    this.px = new Float64Array(capacity);
    this.pz = new Float64Array(capacity);
  }

  private static key(cx: number, cz: number): number {
    // Exact for |cx|, |cz| < 2^20; larger coordinates may share buckets, which only adds candidates.
    return ((cx & 0x1fffff) * 0x200000) + (cz & 0x1fffff);
  }

  /** Squared distance to the nearest stored point, capped at spacing². */
  nearest2(x: number, z: number): number {
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    let best = this.spacing2;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        let k = this.heads.get(SpacingGrid.key(cx + i, cz + j));
        while (k !== undefined && k >= 0) {
          const dx = (this.px[k] as number) - x;
          const dz = (this.pz[k] as number) - z;
          const d2 = dx * dx + dz * dz;
          if (d2 < best) best = d2;
          k = this.next[k] as number;
        }
      }
    }
    return best;
  }

  insert(x: number, z: number): void {
    const k = SpacingGrid.key(Math.floor(x / this.cell), Math.floor(z / this.cell));
    const i = this.size++;
    this.px[i] = x;
    this.pz[i] = z;
    const head = this.heads.get(k);
    this.next[i] = head === undefined ? -1 : head;
    this.heads.set(k, i);
  }
}

function finiteOr(v: number | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * Compute instance placements (local x/z, uniform scale, yaw). Same input →
 * same output on every platform. `minSpacing` is best effort (best of 12
 * candidates per instance).
 */
export function scatterPlacements(shape: ScatterParams, maxCount = MAX_SCATTER_INSTANCES): ScatterPlacements {
  if (shape.points) return applyExclude(pointPlacements(shape, shape.points, maxCount), shape.exclude);
  const count = Math.max(0, Math.min(Math.floor(finiteOr(shape.count, 0)), Math.floor(maxCount), MAX_SCATTER_INSTANCES));
  const random = rng(shape.seed ?? 1);
  const w = Math.abs(finiteOr(shape.area?.[0], 0));
  const d = Math.abs(finiteOr(shape.area?.[1], 0));
  const lo = finiteOr(shape.scaleRange?.[0], 1);
  const hi = finiteOr(shape.scaleRange?.[1], lo);
  const spacing = shape.minSpacing && shape.minSpacing > 0 && Number.isFinite(shape.minSpacing) ? shape.minSpacing : 0;
  const grid = spacing > 0 ? new SpacingGrid(count, spacing, spacing * spacing) : null;
  const out: ScatterPlacements = {
    count,
    x: new Float32Array(count),
    z: new Float32Array(count),
    scale: new Float32Array(count),
    yaw: new Float32Array(count),
    y: null,
  };
  const attempts = grid ? MAX_SPACING_ATTEMPTS : 1;
  const spacing2 = spacing * spacing;
  for (let i = 0; i < count; i++) {
    let x = 0;
    let z = 0;
    let bestD = -1;
    for (let a = 0; a < attempts; a++) {
      const cx = (random() - 0.5) * w;
      const cz = (random() - 0.5) * d;
      const d2 = grid ? grid.nearest2(cx, cz) : 0;
      if (d2 > bestD) {
        bestD = d2;
        x = cx;
        z = cz;
      }
      if (!grid || d2 >= spacing2) break;
    }
    grid?.insert(x, z);
    out.x[i] = x;
    out.z[i] = z;
    out.scale[i] = Math.max(1e-3, lo + (hi - lo) * random());
    out.yaw[i] = shape.randomYaw === false ? 0 : random() * 360 * (Math.PI / 180);
  }
  return applyExclude(out, shape.exclude);
}

/**
 * Drop instances inside `exclude` rectangles after the full layout is drawn,
 * so survivors keep the exact positions, scales and yaws they have without
 * the exclusion (same rule as physics).
 */
function applyExclude(p: ScatterPlacements, rects: ScatterParams['exclude']): ScatterPlacements {
  if (!rects || rects.length === 0) return p;
  let n = 0;
  for (let i = 0; i < p.count; i++) {
    if (scatterExcluded(rects, p.x[i] as number, p.z[i] as number)) continue;
    if (n !== i) {
      p.x[n] = p.x[i] as number;
      p.z[n] = p.z[i] as number;
      p.scale[n] = p.scale[i] as number;
      p.yaw[n] = p.yaw[i] as number;
      if (p.y) p.y[n] = p.y[i] as number;
    }
    n++;
  }
  if (n === p.count) return p;
  return { count: n, x: p.x.slice(0, n), z: p.z.slice(0, n), scale: p.scale.slice(0, n), yaw: p.yaw.slice(0, n), y: p.y ? p.y.slice(0, n) : null };
}

/**
 * Placements of hand-painted points: positions as stored, scale and yaw
 * drawn from the seeded stream in point order (same rule as physics).
 */
function pointPlacements(shape: ScatterParams, points: readonly Vec3[], maxCount: number): ScatterPlacements {
  const count = Math.max(0, Math.min(points.length, Math.floor(maxCount), MAX_SCATTER_INSTANCES));
  const random = rng(shape.seed ?? 1);
  const lo = finiteOr(shape.scaleRange?.[0], 1);
  const hi = finiteOr(shape.scaleRange?.[1], lo);
  const out: ScatterPlacements = { count, x: new Float32Array(count), z: new Float32Array(count), scale: new Float32Array(count), yaw: new Float32Array(count), y: new Float32Array(count) };
  const ys = out.y as Float32Array;
  for (let i = 0; i < count; i++) {
    const p = points[i] as Vec3;
    out.x[i] = finiteOr(p[0], 0);
    ys[i] = finiteOr(p[1], 0);
    out.z[i] = finiteOr(p[2], 0);
    out.scale[i] = Math.max(1e-3, lo + (hi - lo) * random());
    out.yaw[i] = shape.randomYaw === false ? 0 : random() * 360 * (Math.PI / 180);
  }
  return out;
}

/**
 * Height by which a centered primitive is lifted so it rests on the surface
 * (same rule as physics). Procedural outputs already sit on y = 0.
 */
export function primitiveLift(primitive: PrimitiveKind, size: Vec3): number {
  const sx = finiteOr(size[0], 1);
  const sy = finiteOr(size[1], 1);
  if (primitive === 'sphere' || primitive === 'torus') return sx / 2;
  if (primitive === 'plane') return 0.01;
  if (primitive === 'capsule') return Math.max(sy, sx) / 2;
  return sy / 2;
}

/**
 * Local surface height at local (x, z), or NaN when there is no surface
 * (instances then stay at y = 0, like physics).
 */
export type SurfaceSampler = (localX: number, localZ: number) => number;

/**
 * Write one column-major 4x4 matrix per instance (yaw about Y, uniform scale,
 * translation) into `out` (allocated when omitted or too small).
 */
export function composeScatterMatrices(p: ScatterPlacements, lift: number, surface?: SurfaceSampler, out?: Float32Array): Float32Array {
  const n = p.count;
  const m = out && out.length >= n * 16 ? out : new Float32Array(n * 16);
  for (let i = 0; i < n; i++) {
    const s = p.scale[i] as number;
    const yaw = p.yaw[i] as number;
    const x = p.x[i] as number;
    const z = p.z[i] as number;
    let y = p.y ? (p.y[i] as number) : 0;
    if (surface) {
      const h = surface(x, z);
      if (h === h && Number.isFinite(h)) y = h;
    }
    const c = Math.cos(yaw) * s;
    const sn = Math.sin(yaw) * s;
    const o = i * 16;
    m[o] = c;
    m[o + 1] = 0;
    m[o + 2] = -sn;
    m[o + 3] = 0;
    m[o + 4] = 0;
    m[o + 5] = s;
    m[o + 6] = 0;
    m[o + 7] = 0;
    m[o + 8] = sn;
    m[o + 9] = 0;
    m[o + 10] = c;
    m[o + 11] = 0;
    m[o + 12] = x;
    m[o + 13] = y + lift * s;
    m[o + 14] = z;
    m[o + 15] = 1;
  }
  return m;
}

/**
 * Like {@link composeScatterMatrices} but writes the compact field layout —
 * x, y, z, s·cos(yaw), s·sin(yaw) per instance (20 bytes instead of 64) —
 * consumed by the scatter-field culler (`FIELD_STRIDE` = 5).
 */
export function composeScatterPacked(p: ScatterPlacements, lift: number, surface?: SurfaceSampler): Float32Array {
  const n = p.count;
  const out = new Float32Array(n * 5);
  for (let i = 0; i < n; i++) {
    const s = p.scale[i] as number;
    const yaw = p.yaw[i] as number;
    const x = p.x[i] as number;
    const z = p.z[i] as number;
    let y = p.y ? (p.y[i] as number) : 0;
    if (surface) {
      const h = surface(x, z);
      if (h === h && Number.isFinite(h)) y = h;
    }
    const o = i * 5;
    out[o] = x;
    out[o + 1] = y + lift * s;
    out[o + 2] = z;
    out[o + 3] = Math.cos(yaw) * s;
    out[o + 4] = Math.sin(yaw) * s;
  }
  return out;
}
