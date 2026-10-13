/**
 * Chunked culling and LOD selection for huge instance fields (a million
 * trees), CPU side, identical on WebGPU and WebGL2.
 *
 * Instances are stored compactly — x, y, z, s·cos(yaw), s·sin(yaw): 20
 * bytes instead of a 64-byte matrix — and sorted into spatial chunks of a
 * few hundred instances. Each update:
 *
 * 1. tests every chunk's box against the (padded) view frustum,
 * 2. picks a preferred LOD from the chunk's projected instance size (with
 *    hysteresis, so chunks do not flicker at thresholds),
 * 3. walks the visible chunks front to back and spends a triangle budget:
 *    a chunk that does not fit its preferred level is demoted to a coarser
 *    one, or dropped when even the coarsest does not fit, so far chunks
 *    degrade first and the frame cost is bounded whatever the scene holds,
 * 4. rewrites only the levels whose chunk membership changed, in stable
 *    chunk order, so an unchanged level is never re-uploaded.
 *
 * Allocation-free after construction.
 */
import { floatKey, radixSortByKey } from './sort';

/** Floats per packed instance. */
export const FIELD_STRIDE = 5;
/** Instances per chunk (target). */
export const CHUNK_INSTANCES = 128;

/** Compact instance storage sorted into chunks. */
export interface FieldChunks {
  count: number;
  /** x, y, z, s·cos, s·sin per instance, chunk-contiguous. */
  data: Float32Array;
  chunkCount: number;
  /** First instance of chunk `c` (length chunkCount + 1). */
  start: Uint32Array;
  /** Chunk box incl. instance radius: minX minY minZ maxX maxY maxZ. */
  boxes: Float32Array;
  /** Largest instance scale per chunk. */
  maxScale: Float32Array;
}

/**
 * Pack column-major yaw/scale/translation matrices (as written by
 * `composeScatterMatrices`) into {@link FIELD_STRIDE} floats each.
 */
export function packMatrices(matrices: Float32Array, count: number): Float32Array {
  const out = new Float32Array(count * FIELD_STRIDE);
  for (let i = 0; i < count; i++) {
    const m = i * 16;
    const o = i * FIELD_STRIDE;
    out[o] = matrices[m + 12] as number;
    out[o + 1] = matrices[m + 13] as number;
    out[o + 2] = matrices[m + 14] as number;
    out[o + 3] = matrices[m] as number; // s·cos
    out[o + 4] = matrices[m + 8] as number; // s·sin
  }
  return out;
}

/**
 * Sort packed instances into a uniform XZ grid of chunks holding about
 * `perChunk` instances each. `radius` is the instance bounding radius at
 * scale 1 (around the instance origin), `heightAbove` how far the geometry
 * reaches above the origin at scale 1 (boxes are padded by both).
 */
export function buildChunks(data: Float32Array, count: number, radius: number, perChunk = CHUNK_INSTANCES): FieldChunks {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = data[i * FIELD_STRIDE] as number;
    const z = data[i * FIELD_STRIDE + 2] as number;
    if (x < minX) minX = x;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (z > maxZ) maxZ = z;
  }
  if (count === 0) {
    return { count: 0, data: new Float32Array(0), chunkCount: 0, start: new Uint32Array(1), boxes: new Float32Array(0), maxScale: new Float32Array(0) };
  }
  const w = Math.max(maxX - minX, 1e-3);
  const d = Math.max(maxZ - minZ, 1e-3);
  const cells = Math.max(1, Math.round(count / Math.max(1, perChunk)));
  // Square cells: nx · nz ≈ cells with nx / nz ≈ w / d.
  const nx = Math.max(1, Math.min(4096, Math.round(Math.sqrt((cells * w) / d))));
  const nz = Math.max(1, Math.min(4096, Math.round(cells / nx)));
  const cellOf = new Uint32Array(count);
  const counts = new Uint32Array(nx * nz + 1);
  for (let i = 0; i < count; i++) {
    const cx = Math.min(nx - 1, Math.floor((((data[i * FIELD_STRIDE] as number) - minX) / w) * nx));
    const cz = Math.min(nz - 1, Math.floor((((data[i * FIELD_STRIDE + 2] as number) - minZ) / d) * nz));
    const c = cz * nx + cx;
    cellOf[i] = c;
    counts[c + 1] = (counts[c + 1] as number) + 1;
  }
  // Compact away empty cells.
  const remap = new Int32Array(nx * nz).fill(-1);
  let chunkCount = 0;
  for (let c = 0; c < nx * nz; c++) if ((counts[c + 1] as number) > 0) remap[c] = chunkCount++;
  const start = new Uint32Array(chunkCount + 1);
  for (let c = 0; c < nx * nz; c++) {
    const k = remap[c] as number;
    if (k >= 0) start[k + 1] = counts[c + 1] as number;
  }
  for (let k = 0; k < chunkCount; k++) start[k + 1] = (start[k + 1] as number) + (start[k] as number);
  const fill = new Uint32Array(chunkCount);
  const sorted = new Float32Array(count * FIELD_STRIDE);
  const boxes = new Float32Array(chunkCount * 6);
  const maxScale = new Float32Array(chunkCount);
  for (let k = 0; k < chunkCount; k++) {
    boxes[k * 6] = boxes[k * 6 + 1] = boxes[k * 6 + 2] = Infinity;
    boxes[k * 6 + 3] = boxes[k * 6 + 4] = boxes[k * 6 + 5] = -Infinity;
  }
  for (let i = 0; i < count; i++) {
    const k = remap[cellOf[i] as number] as number;
    const dst = ((start[k] as number) + (fill[k] as number)) * FIELD_STRIDE;
    fill[k] = (fill[k] as number) + 1;
    for (let j = 0; j < FIELD_STRIDE; j++) sorted[dst + j] = data[i * FIELD_STRIDE + j] as number;
    const s = Math.hypot(data[i * FIELD_STRIDE + 3] as number, data[i * FIELD_STRIDE + 4] as number);
    const r = radius * s;
    const x = data[i * FIELD_STRIDE] as number, y = data[i * FIELD_STRIDE + 1] as number, z = data[i * FIELD_STRIDE + 2] as number;
    const b = k * 6;
    if (x - r < (boxes[b] as number)) boxes[b] = x - r;
    if (y - r < (boxes[b + 1] as number)) boxes[b + 1] = y - r;
    if (z - r < (boxes[b + 2] as number)) boxes[b + 2] = z - r;
    if (x + r > (boxes[b + 3] as number)) boxes[b + 3] = x + r;
    if (y + r > (boxes[b + 4] as number)) boxes[b + 4] = y + r;
    if (z + r > (boxes[b + 5] as number)) boxes[b + 5] = z + r;
    if (s > (maxScale[k] as number)) maxScale[k] = s;
  }
  return { count, data: sorted, chunkCount, start, boxes, maxScale };
}

/** Camera for {@link FieldCuller.update}, in the field's local space. */
export interface FieldView {
  cx: number;
  cy: number;
  cz: number;
  /** Pixels per unit at distance 1 (projection scale × field scale). */
  pixelScale: number;
  /** Frustum planes (nx, ny, nz, d; inside where n·p + d ≥ 0), normalised; null = no culling. */
  planes: Float64Array | null;
}

/** Options of {@link FieldCuller}. */
export interface FieldCullerOptions {
  /** Triangles per instance at each LOD level (level 0 first, strictly decreasing). */
  lodTriangles: readonly number[];
  /** Instance bounding radius at scale 1. */
  radius: number;
  /** Triangle budget per frame over all levels. */
  budgetTriangles: number;
  /** Projected instance radius (px) at which level `l + 1` takes over from `l` (length levels − 1). */
  thresholds?: readonly number[];
  /** Instances smaller than this (px radius) are not drawn. */
  minPixels?: number;
  /** Frustum padding as a fraction of the chunk size (so small turns need no rewrite). */
  pad?: number;
}

/** Default switch points (projected instance radius in px) between consecutive levels. */
export const DEFAULT_LOD_PIXELS: readonly number[] = [90, 30, 10, 4];
/** Hysteresis band (fraction of a threshold) before a chunk changes level. */
const HYSTERESIS = 0.15;

/** Per-frame chunk culling, LOD selection and instance-buffer assembly. */
export class FieldCuller {
  readonly levels: number;
  /** Instance matrices per level (column-major 4×4), written front to back. */
  readonly buffers: Float32Array[];
  /** Instances assigned per level by the last update (= instances to draw). */
  readonly counts: Uint32Array;
  /** Instances written per level buffer (equals `counts` after every update). */
  private readonly written: Uint32Array;
  /** Instance capacity per level (bounded by the triangle budget). */
  readonly capacity: Uint32Array;
  /** Triangles the last assignment draws (per frame, instances × level triangles). */
  drawnTriangles = 0;
  /** Instances drawn by the last assignment. */
  drawnInstances = 0;
  /** Chunks visible (inside the padded frustum and large enough) in the last update. */
  visibleChunks = 0;
  /** Number of times buffers were rewritten (diagnostics, tests). */
  rewrites = 0;

  private readonly level: Int8Array;
  private readonly prevLevel: Int8Array;
  private readonly keys: Uint32Array;
  private readonly order: Uint32Array;
  private readonly scratch: Uint32Array;
  private readonly thresholds: number[];
  private readonly minPixels: number;
  private readonly pad: Float32Array;
  private budget: number;

  constructor(private readonly chunks: FieldChunks, private readonly opts: FieldCullerOptions) {
    this.levels = Math.max(1, opts.lodTriangles.length);
    const n = chunks.chunkCount;
    this.level = new Int8Array(n).fill(-1);
    this.prevLevel = new Int8Array(n).fill(-1);
    this.keys = new Uint32Array(n);
    this.order = new Uint32Array(n);
    this.scratch = new Uint32Array(n);
    this.budget = Math.max(0, opts.budgetTriangles);
    const t = opts.thresholds ?? DEFAULT_LOD_PIXELS;
    this.thresholds = [];
    for (let l = 0; l < this.levels - 1; l++) this.thresholds.push(t[l] ?? (t[t.length - 1] as number));
    this.minPixels = opts.minPixels ?? 0.6;
    this.pad = new Float32Array(n);
    for (let c = 0; c < n; c++) {
      const b = c * 6;
      const size = Math.max((chunks.boxes[b + 3] as number) - (chunks.boxes[b] as number), (chunks.boxes[b + 5] as number) - (chunks.boxes[b + 2] as number));
      this.pad[c] = size * (opts.pad ?? 0.5);
    }
    this.capacity = new Uint32Array(this.levels);
    this.counts = new Uint32Array(this.levels);
    this.written = new Uint32Array(this.levels);
    this.buffers = [];
    for (let l = 0; l < this.levels; l++) {
      const tris = Math.max(1, opts.lodTriangles[l] as number);
      const cap = Math.min(chunks.count, Math.ceil(this.budget / tris));
      this.capacity[l] = cap;
      this.buffers.push(new Float32Array(cap * 16));
    }
  }

  /** Change the triangle budget (buffers keep their capacity; the next update re-plans). */
  setBudget(triangles: number): void {
    this.budget = Math.max(0, Math.min(triangles, this.opts.budgetTriangles));
    this.prevLevel.fill(-2);
  }

  /**
   * Classify chunks for `view` and rebuild the level buffers whose
   * membership changed. Returns a bit mask of the rewritten levels (0: the
   * uploaded buffers are still valid).
   */
  update(view: FieldView): number {
    const { chunks, level, keys, order } = this;
    const n = chunks.chunkCount;
    const boxes = chunks.boxes;
    const planes = view.planes;
    let visible = 0;
    for (let c = 0; c < n; c++) {
      const b = c * 6;
      const x0 = boxes[b] as number, y0 = boxes[b + 1] as number, z0 = boxes[b + 2] as number;
      const x1 = boxes[b + 3] as number, y1 = boxes[b + 4] as number, z1 = boxes[b + 5] as number;
      let inside = true;
      if (planes) {
        const pad = this.pad[c] as number;
        for (let p = 0; p < planes.length; p += 4) {
          const nx = planes[p] as number, ny = planes[p + 1] as number, nz = planes[p + 2] as number;
          // Box corner furthest along the plane normal (p-vertex test).
          const px = nx >= 0 ? x1 : x0;
          const py = ny >= 0 ? y1 : y0;
          const pz = nz >= 0 ? z1 : z0;
          if (nx * px + ny * py + nz * pz + (planes[p + 3] as number) < -pad) {
            inside = false;
            break;
          }
        }
      }
      if (!inside) {
        level[c] = -1;
        continue;
      }
      // Distance from the camera to the box (0 inside).
      const dx = view.cx < x0 ? x0 - view.cx : view.cx > x1 ? view.cx - x1 : 0;
      const dy = view.cy < y0 ? y0 - view.cy : view.cy > y1 ? view.cy - y1 : 0;
      const dz = view.cz < z0 ? z0 - view.cz : view.cz > z1 ? view.cz - z1 : 0;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const px = (this.opts.radius * (chunks.maxScale[c] as number) * view.pixelScale) / (d > 1e-3 ? d : 1e-3);
      if (px < this.minPixels) {
        level[c] = -1;
        continue;
      }
      // Preferred level with hysteresis around the previous level's thresholds.
      const prev = this.prevLevel[c] as number;
      let l = 0;
      while (l < this.levels - 1) {
        let t = this.thresholds[l] as number;
        if (prev >= 0) t *= prev > l ? 1 + HYSTERESIS : 1 - HYSTERESIS;
        if (px >= t) break;
        l++;
      }
      level[c] = l;
      keys[c] = floatKey(d);
      order[visible] = c;
      visible++;
    }
    this.visibleChunks = visible;
    // Front to back.
    const sorted = radixSortByKey(order, keys, visible, this.scratch);

    // Spend the budget front to back, demoting (or dropping) chunks that do not fit.
    let remaining = this.budget;
    this.counts.fill(0);
    let drawn = 0;
    let tris = 0;
    for (let i = 0; i < visible; i++) {
      const c = sorted[i] as number;
      const k = (chunks.start[c + 1] as number) - (chunks.start[c] as number);
      let l = level[c] as number;
      while (l < this.levels) {
        const cost = k * (this.opts.lodTriangles[l] as number);
        if (cost <= remaining && (this.counts[l] as number) + k <= (this.capacity[l] as number)) break;
        l++;
      }
      if (l >= this.levels) {
        level[c] = -1;
        continue;
      }
      level[c] = l;
      this.counts[l] = (this.counts[l] as number) + k;
      const cost = k * (this.opts.lodTriangles[l] as number);
      remaining -= cost;
      tris += cost;
      drawn += k;
    }
    this.drawnTriangles = tris;
    this.drawnInstances = drawn;

    // Levels whose chunk membership changed; unchanged levels keep their uploaded buffers.
    let dirty = 0;
    for (let c = 0; c < n; c++) {
      const now = level[c] as number;
      const before = this.prevLevel[c] as number;
      if (now === before) continue;
      if (now >= 0) dirty |= 1 << now;
      if (before >= 0) dirty |= 1 << before;
      if (before === -2) dirty = (1 << this.levels) - 1;
    }
    this.prevLevel.set(level);
    if (dirty === 0) return 0;
    this.assemble(dirty);
    this.rewrites++;
    return dirty;
  }

  /**
   * Write the matrices of every chunk assigned to a dirty level into that
   * level's buffer, in stable chunk order (so a level's contents change only
   * when its membership does).
   */
  private assemble(dirty: number): void {
    const { chunks, level } = this;
    const data = chunks.data;
    for (let l = 0; l < this.levels; l++) if (dirty & (1 << l)) this.written[l] = 0;
    for (let c = 0; c < chunks.chunkCount; c++) {
      const l = level[c] as number;
      if (l < 0 || !(dirty & (1 << l))) continue;
      const buf = this.buffers[l] as Float32Array;
      let w = (this.written[l] as number) * 16;
      const end = chunks.start[c + 1] as number;
      for (let j = chunks.start[c] as number; j < end; j++) {
        const o = j * FIELD_STRIDE;
        const cs = data[o + 3] as number;
        const sn = data[o + 4] as number;
        const s = Math.sqrt(cs * cs + sn * sn);
        buf[w] = cs;
        buf[w + 1] = 0;
        buf[w + 2] = -sn;
        buf[w + 3] = 0;
        buf[w + 4] = 0;
        buf[w + 5] = s;
        buf[w + 6] = 0;
        buf[w + 7] = 0;
        buf[w + 8] = sn;
        buf[w + 9] = 0;
        buf[w + 10] = cs;
        buf[w + 11] = 0;
        buf[w + 12] = data[o] as number;
        buf[w + 13] = data[o + 1] as number;
        buf[w + 14] = data[o + 2] as number;
        buf[w + 15] = 1;
        w += 16;
      }
      this.written[l] = w / 16;
    }
  }
}
