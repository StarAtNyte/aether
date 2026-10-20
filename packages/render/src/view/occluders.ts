/**
 * View occluders of scatter layers (forests, rock fields).
 *
 * Scatter instances are drawn as instanced meshes that are never raycast one by one (that would be
 * O(instances × triangles)), so the chase camera's occlusion rays went straight through a scattered pine
 * forest and the camera ended inside a crown. This module keeps a coarse stand-in instead: one axis-aligned
 * box per generator part per instance (a trunk box, a crown box), narrowed a little horizontally so a cone
 * crown's empty corners do not pull the camera in early, bucketed in a uniform XZ grid. A segment query
 * touches only the cells under the segment and allocates nothing.
 *
 * Small things (grass, reeds, pebbles, path lights) are left out: anything lower than
 * {@link OCCLUDER_MIN_HEIGHT} cannot hide a third-person view.
 */

/** Instances lower than this (m, after scale) are not view occluders. */
export const OCCLUDER_MIN_HEIGHT = 1.5;
/** Horizontal share of a part's bounds kept as its occluder (a cone or sphere crown fills its box only near the axis). */
export const OCCLUDER_SHRINK = 0.75;
/** Grid cell edge (m). */
const CELL = 4;
/** Largest cell range a query walks before it tests every box instead. */
const MAX_QUERY_CELLS = 1024;
/** Most boxes one layer keeps (a field of 400k grass blades never gets here: it is too low). */
export const MAX_OCCLUDER_BOXES = 60_000;

/** Local bounds of each part of a generator output: 6 floats per part (min xyz, max xyz); empty parts get NaN. */
export function partBounds(parts: ReadonlyArray<{ positions: ArrayLike<number> }>): Float32Array {
  const out = new Float32Array(parts.length * 6);
  for (let p = 0; p < parts.length; p++) {
    const pos = (parts[p] as { positions: ArrayLike<number> }).positions;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i + 2 < pos.length; i += 3) {
      const x = pos[i] as number, y = pos[i + 1] as number, z = pos[i + 2] as number;
      if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (z < z0) z0 = z;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
      if (z > z1) z1 = z;
    }
    const o = p * 6;
    if (x0 > x1) out.fill(Number.NaN, o, o + 6);
    else {
      out[o] = x0;
      out[o + 1] = y0;
      out[o + 2] = z0;
      out[o + 3] = x1;
      out[o + 4] = y1;
      out[o + 5] = z1;
    }
  }
  return out;
}

/** Packed instance poses (`x, y, z, cos(yaw)·s, sin(yaw)·s` per instance) from column-major 4×4 scatter matrices. */
export function posesFromMatrices(matrices: ArrayLike<number>, count: number): Float32Array {
  const out = new Float32Array(count * 5);
  for (let i = 0; i < count; i++) {
    const m = i * 16;
    const o = i * 5;
    out[o] = matrices[m + 12] as number;
    out[o + 1] = matrices[m + 13] as number;
    out[o + 2] = matrices[m + 14] as number;
    out[o + 3] = matrices[m] as number;
    out[o + 4] = matrices[m + 8] as number;
  }
  return out;
}

/** A point (three's `Vector3` fits). */
export interface XYZ {
  x: number;
  y: number;
  z: number;
}

/** Boxes of one scatter layer in a uniform XZ grid; see the module docs. */
export class OccluderGrid {
  private constructor(
    /** 6 floats per box (min xyz, max xyz), in the layer's local space. */
    readonly boxes: Float32Array,
    private readonly cellStart: Int32Array,
    private readonly cellItems: Int32Array,
    private readonly minX: number,
    private readonly minZ: number,
    private readonly nx: number,
    private readonly nz: number,
  ) {}

  /** Last layer-to-world matrix seen by {@link segmentEntryWorld} (column-major) and its inverse (affine part). */
  private readonly seen = new Float64Array(16).fill(Number.NaN);
  private readonly inv = new Float64Array(12);
  /** The segment being queried (a, then b). */
  private readonly seg = new Float64Array(6);
  /** Result of the last query: the entry fraction, or Infinity (a typed array, so returning it boxes nothing). */
  readonly entry = new Float64Array(1);

  /** Number of boxes. */
  get count(): number {
    return this.boxes.length / 6;
  }

  /**
   * Occluders of a scatter layer from its instance poses (see {@link posesFromMatrices}) and the generator's part
   * bounds (see {@link partBounds}); null when no instance is tall enough to hide a view.
   */
  static fromScatter(poses: ArrayLike<number>, count: number, parts: Float32Array): OccluderGrid | null {
    const nParts = Math.floor(parts.length / 6);
    if (nParts === 0 || count <= 0) return null;
    let y0 = Infinity, y1 = -Infinity;
    for (let p = 0; p < nParts; p++) {
      const a = parts[p * 6 + 1] as number, b = parts[p * 6 + 4] as number;
      if (a === a && a < y0) y0 = a;
      if (b === b && b > y1) y1 = b;
    }
    if (!(y1 > y0)) return null;
    const boxes: number[] = [];
    for (let i = 0; i < count && boxes.length < MAX_OCCLUDER_BOXES * 6; i++) {
      const o = i * 5;
      const x = poses[o] as number, y = poses[o + 1] as number, z = poses[o + 2] as number;
      const c = poses[o + 3] as number, sn = poses[o + 4] as number;
      const s = Math.hypot(c, sn);
      if (!(s > 0) || !Number.isFinite(x + y + z) || (y1 - y0) * s < OCCLUDER_MIN_HEIGHT) continue;
      const ac = Math.abs(c), as = Math.abs(sn);
      for (let p = 0; p < nParts; p++) {
        const b = p * 6;
        const bx0 = parts[b] as number;
        if (bx0 !== bx0) continue;
        const by0 = parts[b + 1] as number, bz0 = parts[b + 2] as number;
        const bx1 = parts[b + 3] as number, by1 = parts[b + 4] as number, bz1 = parts[b + 5] as number;
        if ((by1 - by0) * s < 0.05) continue;
        // Instance matrix: [c 0 sn; 0 s 0; -sn 0 c] (column-major m0 = c, m2 = -sn, m8 = sn, m10 = c).
        const cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2;
        const hx = (bx1 - bx0) / 2, hz = (bz1 - bz0) / 2;
        const wx = x + c * cx + sn * cz;
        const wz = z - sn * cx + c * cz;
        const ex = (ac * hx + as * hz) * OCCLUDER_SHRINK;
        const ez = (as * hx + ac * hz) * OCCLUDER_SHRINK;
        boxes.push(wx - ex, y + by0 * s, wz - ez, wx + ex, y + by1 * s, wz + ez);
      }
    }
    if (boxes.length === 0) return null;
    return OccluderGrid.fromBoxes(Float32Array.from(boxes));
  }

  /** Grid over explicit boxes (6 floats each, min xyz then max xyz). */
  static fromBoxes(boxes: Float32Array): OccluderGrid {
    const n = Math.floor(boxes.length / 6);
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const o = i * 6;
      minX = Math.min(minX, boxes[o] as number);
      minZ = Math.min(minZ, boxes[o + 2] as number);
      maxX = Math.max(maxX, boxes[o + 3] as number);
      maxZ = Math.max(maxZ, boxes[o + 5] as number);
    }
    if (n === 0) {
      minX = minZ = 0;
      maxX = maxZ = 0;
    }
    const nx = Math.max(1, Math.min(4096, Math.ceil((maxX - minX) / CELL) || 1));
    const nz = Math.max(1, Math.min(4096, Math.ceil((maxZ - minZ) / CELL) || 1));
    const counts = new Int32Array(nx * nz + 1);
    const range = (i: number, f: (cell: number) => void): void => {
      const o = i * 6;
      const i0 = cellOf(boxes[o] as number, minX, nx), i1 = cellOf(boxes[o + 3] as number, minX, nx);
      const k0 = cellOf(boxes[o + 2] as number, minZ, nz), k1 = cellOf(boxes[o + 5] as number, minZ, nz);
      for (let k = k0; k <= k1; k++) for (let j = i0; j <= i1; j++) f(k * nx + j);
    };
    for (let i = 0; i < n; i++) range(i, (cell) => (counts[cell + 1] = (counts[cell + 1] as number) + 1));
    for (let c = 0; c < nx * nz; c++) counts[c + 1] = (counts[c + 1] as number) + (counts[c] as number);
    const items = new Int32Array(counts[nx * nz] as number);
    const fill = counts.slice(0, nx * nz);
    for (let i = 0; i < n; i++)
      range(i, (cell) => {
        items[fill[cell] as number] = i;
        fill[cell] = (fill[cell] as number) + 1;
      });
    return new OccluderGrid(boxes.slice(0, n * 6), counts, items, minX, minZ, nx, nz);
  }

  /**
   * {@link segmentEntry} for a world segment, with `world` the layer's column-major world matrix (three's
   * `matrixWorld.elements`); the answer goes to {@link entry}. The inverse is cached in typed arrays and recomputed
   * only when the matrix changes, and no double crosses a call boundary, so the per-frame path allocates nothing.
   */
  segmentEntryWorld(world: ArrayLike<number>, from: Readonly<XYZ>, to: Readonly<XYZ>): void {
    const fx = from.x, fy = from.y, fz = from.z, tx = to.x, ty = to.y, tz = to.z;
    const seen = this.seen;
    let same = true;
    for (let i = 0; i < 16; i++) {
      if (seen[i] !== world[i]) {
        same = false;
        seen[i] = world[i] as number;
      }
    }
    const v = this.inv;
    if (!same) {
      const a = seen[0] as number, b = seen[4] as number, c = seen[8] as number;
      const d = seen[1] as number, e = seen[5] as number, f = seen[9] as number;
      const g = seen[2] as number, h = seen[6] as number, k = seen[10] as number;
      const det = a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g);
      const id = det !== 0 && Number.isFinite(det) ? 1 / det : 0;
      // Row-major 3×3 inverse in v[0..8], then the inverse translation in v[9..11].
      v[0] = (e * k - f * h) * id;
      v[1] = (c * h - b * k) * id;
      v[2] = (b * f - c * e) * id;
      v[3] = (f * g - d * k) * id;
      v[4] = (a * k - c * g) * id;
      v[5] = (c * d - a * f) * id;
      v[6] = (d * h - e * g) * id;
      v[7] = (b * g - a * h) * id;
      v[8] = (a * e - b * d) * id;
      const px = seen[12] as number, py = seen[13] as number, pz = seen[14] as number;
      v[9] = -(v[0] * px + v[1] * py + v[2] * pz);
      v[10] = -(v[3] * px + v[4] * py + v[5] * pz);
      v[11] = -(v[6] * px + v[7] * py + v[8] * pz);
    }
    // The segment goes through a typed array: doubles passed as arguments to a call that is not inlined are boxed.
    const g = this.seg;
    g[0] = v[0]! * fx + v[1]! * fy + v[2]! * fz + v[9]!;
    g[1] = v[3]! * fx + v[4]! * fy + v[5]! * fz + v[10]!;
    g[2] = v[6]! * fx + v[7]! * fy + v[8]! * fz + v[11]!;
    g[3] = v[0]! * tx + v[1]! * ty + v[2]! * tz + v[9]!;
    g[4] = v[3]! * tx + v[4]! * ty + v[5]! * tz + v[10]!;
    g[5] = v[6]! * tx + v[7]! * ty + v[8]! * tz + v[11]!;
    this.scan();
  }

  /**
   * Fraction t ∈ [0, 1] of the segment a→b where it first enters a box, or Infinity when it enters none.
   * A box that already contains `a` is ignored (the camera cannot get out of it by pulling in). Allocation-free:
   * the slab test is written out in the loop (a helper returning a fraction would box a double per box hit).
   */
  segmentEntry(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
    const g = this.seg;
    g[0] = ax;
    g[1] = ay;
    g[2] = az;
    g[3] = bx;
    g[4] = by;
    g[5] = bz;
    this.scan();
    return this.entry[0]!;
  }

  /** The query of {@link segmentEntry} on the segment in `seg`; the answer goes to `entry[0]`. */
  private scan(): void {
    const g = this.seg;
    const ax = g[0]!, ay = g[1]!, az = g[2]!, bx = g[3]!, by = g[4]!, bz = g[5]!;
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    // Reciprocals once per segment; a zero component gives ±Infinity, which the slab maths below handles.
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    let i0 = cellOf(Math.min(ax, bx), this.minX, this.nx), i1 = cellOf(Math.max(ax, bx), this.minX, this.nx);
    let k0 = cellOf(Math.min(az, bz), this.minZ, this.nz), k1 = cellOf(Math.max(az, bz), this.minZ, this.nz);
    const cells = this.cellStart;
    const items = this.cellItems;
    const b = this.boxes;
    let best = 2;
    // A very long segment walks every box once instead of thousands of cells.
    const brute = (i1 - i0 + 1) * (k1 - k0 + 1) > MAX_QUERY_CELLS;
    if (brute) {
      i0 = i1 = k0 = k1 = 0;
    }
    for (let k = k0; k <= k1; k++) {
      for (let j = i0; j <= i1; j++) {
        const cell = k * this.nx + j;
        const first = brute ? 0 : (cells[cell] as number);
        const end = brute ? this.count : (cells[cell + 1] as number);
        for (let s = first; s < end; s++) {
          const o = (brute ? s : (items[s] as number)) * 6;
          const x0 = b[o] as number, y0 = b[o + 1] as number, z0 = b[o + 2] as number;
          const x1 = b[o + 3] as number, y1 = b[o + 4] as number, z1 = b[o + 5] as number;
          // The start inside the box: ignored.
          if (ax >= x0 && ax <= x1 && ay >= y0 && ay <= y1 && az >= z0 && az <= z1) continue;
          let ta = (x0 - ax) * ix, tb = (x1 - ax) * ix;
          let tn = ta < tb ? ta : tb;
          let tf = ta < tb ? tb : ta;
          if (dx === 0) {
            if (ax < x0 || ax > x1) continue;
            tn = Number.NEGATIVE_INFINITY;
            tf = Number.POSITIVE_INFINITY;
          }
          if (dy === 0) {
            if (ay < y0 || ay > y1) continue;
          } else {
            ta = (y0 - ay) * iy;
            tb = (y1 - ay) * iy;
            if ((ta < tb ? ta : tb) > tn) tn = ta < tb ? ta : tb;
            if ((ta < tb ? tb : ta) < tf) tf = ta < tb ? tb : ta;
          }
          if (dz === 0) {
            if (az < z0 || az > z1) continue;
          } else {
            ta = (z0 - az) * iz;
            tb = (z1 - az) * iz;
            if ((ta < tb ? ta : tb) > tn) tn = ta < tb ? ta : tb;
            if ((ta < tb ? tb : ta) < tf) tf = ta < tb ? tb : ta;
          }
          if (tn <= tf && tn >= 0 && tn <= 1 && tn < best) best = tn;
        }
      }
    }
    this.entry[0] = best <= 1 ? best : Number.POSITIVE_INFINITY;
  }
}

function cellOf(v: number, min: number, n: number): number {
  const c = Math.floor((v - min) / CELL);
  return c < 0 ? 0 : c >= n ? n - 1 : c;
}
