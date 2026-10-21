/**
 * Baked light volume of a building: a 3D grid of probes that stores, for every point of the interior,
 * how much of the open sky it sees and how much light reaches it after bouncing off the rooms.
 *
 * Realtime renderers light a room with the sky's ambient everywhere, so a corridor without windows is as
 * bright as a sunlit bay and nothing is darker for being deep inside. The volume is the cheap fix a game
 * engine uses: probes every 0.45 m trace rays against the building's shell (walls, slabs, ceilings, roof,
 * stairs, doors) and box proxies of the furniture, and record per probe (as first-order spherical
 * harmonics, so a surface reads the value for its own normal):
 *
 * - `vis(n)`: the cosine-weighted share of the sky a surface with normal `n` would see (1 under the open
 *   sky, a few percent at the back of a room). The renderer multiplies its sky ambient and image light
 *   by it, which is what makes a room dark away from its windows and keeps sky reflections out of a
 *   corridor.
 * - `B(n)`: the irradiance arriving after one to three bounces: sun patches on the floor, the sunlit
 *   ground outside the window, sky light on the window reveals, lamps on the walls, all reflected by
 *   the surfaces' own colours. Warm floors make warm ceilings; a white room is brighter than a dark one.
 *
 * The bake is CPU work, deterministic (fixed ray sets, fixed order: the same input gives the same bytes,
 * however the work is sliced over frames) and pure (no three.js): {@link TraceScene} is a small BVH over
 * world-space triangles, {@link LightVolumeBaker} advances in time slices, {@link packVolumeAtlas}
 * lays the result out for one RGBA 3D texture and {@link sampleVolume} reads it back on the CPU
 * (eye adaptation without reading pixels).
 */

export type V3 = readonly [number, number, number];

/** A probe grid: probe (ix, iy, iz) sits at `min + spacing * (ix, iy, iz)`. */
export interface VolumeGrid {
  min: [number, number, number];
  spacing: number;
  nx: number;
  ny: number;
  nz: number;
}

/** Target probe spacing (metres). */
export const VOLUME_SPACING = 0.45;
/** Most probes in one volume (the spacing grows to fit). */
export const MAX_VOLUME_PROBES = 22_000;
/**
 * Probes per axis the GPU atlas is allocated for (fixed, so a rebake never reallocates the texture or
 * recompiles a material): a grid uses the corner of it that it needs.
 */
export const VOLUME_ALLOC: Readonly<{ nx: number; ny: number; nz: number }> = Object.freeze({ nx: 48, ny: 28, nz: 48 });
/** Rays traced per probe. */
export const VOLUME_RAYS = 48;
/** Bounce passes (each adds one more bounce of the light already in the volume). */
export const VOLUME_PASSES = 6;
/** Floats per probe: vis (a, bx, by, bz), then R, G, B irradiance (a, bx, by, bz) each. */
export const FLOATS_PER_PROBE = 16;
/** Sub-volumes in the atlas (vis, R, G, B). */
export const ATLAS_SUBVOLUMES = 4;
/** Share of single-sided back-face hits above which a probe counts as buried in a wall. */
export const BURIED_SHARE = 0.3;
/** Largest triangle count a bake scene accepts. */
export const MAX_TRACE_TRIANGLES = 400_000;

const Y0 = 0.282095;
const Y1 = 0.488603;
const LEAF = 4;
const GROUND_HIT = -2;
const MISS = -1;

function finite3(v: V3): boolean {
  return Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);
}

/**
 * The probe grid covering `min`..`max` (world metres) plus one spacing of margin on every side, at
 * {@link VOLUME_SPACING} or coarser so that at most `maxProbes` probes and at most {@link VOLUME_ALLOC}
 * probes per axis are used. Null for empty, inverted or non-finite boxes.
 */
export function planVolumeGrid(min: V3, max: V3, spacing = VOLUME_SPACING, maxProbes = MAX_VOLUME_PROBES): VolumeGrid | null {
  if (!finite3(min) || !finite3(max) || !(spacing > 0.05) || !(maxProbes >= 8)) return null;
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  if (size.some((s) => !(s > 0.01)) || size.some((s) => s > 2000)) return null;
  let s = spacing;
  const counts = (): [number, number, number] => size.map((d) => Math.max(2, Math.ceil((d + 2 * s) / s) + 1)) as [number, number, number];
  const over = (n: [number, number, number]): boolean => n[0] * n[1] * n[2] > maxProbes || n[0] > VOLUME_ALLOC.nx || n[1] > VOLUME_ALLOC.ny || n[2] > VOLUME_ALLOC.nz;
  let n = counts();
  for (let k = 0; k < 200 && over(n); k++) {
    s *= 1.08;
    n = counts();
  }
  if (over(n)) return null;
  const c = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  return { min: [c[0]! - ((n[0] - 1) * s) / 2, c[1]! - ((n[1] - 1) * s) / 2, c[2]! - ((n[2] - 1) * s) / 2], spacing: s, nx: n[0], ny: n[1], nz: n[2] };
}

/** Input of a {@link TraceScene}: world-space triangles with a linear albedo each. */
export interface TraceInput {
  /** Nine floats per triangle (three corners). */
  positions: Float32Array;
  /** Three floats per triangle (linear RGB albedo, clamped to 0..0.95). */
  albedo: Float32Array;
  /** One flag per triangle: 1 when both faces are surfaces (a back-face hit is not "inside a solid"). */
  twoSided?: Uint8Array;
}

/**
 * A bounding-volume hierarchy over world-space triangles (median split on the widest centroid axis, at
 * most four triangles per leaf) with closest-hit and any-hit queries. Queries allocate nothing; the
 * closest hit is reported through {@link hitT} and the returned triangle index.
 */
export class TraceScene {
  readonly triangleCount: number;
  /** Per triangle: v0 (3), edge1 (3), edge2 (3), unit normal (3). */
  private readonly tri: Float32Array;
  readonly albedo: Float32Array;
  readonly twoSided: Uint8Array;
  private boxes: Float32Array;
  /** Per node: [left child or first triangle, right child or -count]. */
  private meta: Int32Array;
  private order: Uint32Array;
  private nodeCount = 0;
  private readonly stack = new Int32Array(128);
  /** Distance of the last closest hit. */
  hitT = 0;

  constructor(input: TraceInput) {
    const n = Math.min(MAX_TRACE_TRIANGLES, Math.floor(input.positions.length / 9), Math.floor(input.albedo.length / 3));
    this.triangleCount = n;
    this.tri = new Float32Array(n * 12);
    this.albedo = new Float32Array(n * 3);
    this.twoSided = new Uint8Array(n);
    const p = input.positions;
    for (let i = 0; i < n; i++) {
      const o = i * 9;
      const ax = p[o]!, ay = p[o + 1]!, az = p[o + 2]!;
      const e1x = p[o + 3]! - ax, e1y = p[o + 4]! - ay, e1z = p[o + 5]! - az;
      const e2x = p[o + 6]! - ax, e2y = p[o + 7]! - ay, e2z = p[o + 8]! - az;
      let nx = e1y * e2z - e1z * e2y;
      let ny = e1z * e2x - e1x * e2z;
      let nz = e1x * e2y - e1y * e2x;
      const l = Math.hypot(nx, ny, nz);
      if (l > 0 && Number.isFinite(l)) {
        nx /= l;
        ny /= l;
        nz /= l;
      } else {
        nx = 0;
        ny = 1;
        nz = 0;
      }
      const t = this.tri;
      const q = i * 12;
      t[q] = ax; t[q + 1] = ay; t[q + 2] = az;
      t[q + 3] = e1x; t[q + 4] = e1y; t[q + 5] = e1z;
      t[q + 6] = e2x; t[q + 7] = e2y; t[q + 8] = e2z;
      t[q + 9] = nx; t[q + 10] = ny; t[q + 11] = nz;
      for (let c = 0; c < 3; c++) {
        const a = input.albedo[i * 3 + c]!;
        this.albedo[i * 3 + c] = Number.isFinite(a) ? Math.max(0, Math.min(0.95, a)) : 0.5;
      }
      this.twoSided[i] = input.twoSided?.[i] ? 1 : 0;
    }
    this.boxes = new Float32Array(Math.max(1, 2 * n) * 6);
    this.meta = new Int32Array(Math.max(1, 2 * n) * 2);
    this.order = new Uint32Array(n);
    for (let i = 0; i < n; i++) this.order[i] = i;
    if (n > 0) this.build();
  }

  private build(): void {
    const n = this.triangleCount;
    const cen = new Float32Array(n * 3);
    const lo = new Float32Array(n * 3);
    const hi = new Float32Array(n * 3);
    const t = this.tri;
    for (let i = 0; i < n; i++) {
      const q = i * 12;
      for (let c = 0; c < 3; c++) {
        const a = t[q + c]!;
        const b = a + t[q + 3 + c]!;
        const d = a + t[q + 6 + c]!;
        lo[i * 3 + c] = Math.min(a, b, d);
        hi[i * 3 + c] = Math.max(a, b, d);
        cen[i * 3 + c] = (a + b + d) / 3;
      }
    }
    // Iterative top-down build: [node, start, end] work items.
    const work: number[] = [0, 0, n];
    this.nodeCount = 1;
    const order = this.order;
    while (work.length > 0) {
      const end = work.pop()!;
      const start = work.pop()!;
      const node = work.pop()!;
      let bx0 = Infinity, by0 = Infinity, bz0 = Infinity, bx1 = -Infinity, by1 = -Infinity, bz1 = -Infinity;
      let cx0 = Infinity, cy0 = Infinity, cz0 = Infinity, cx1 = -Infinity, cy1 = -Infinity, cz1 = -Infinity;
      for (let k = start; k < end; k++) {
        const i = order[k]! * 3;
        bx0 = Math.min(bx0, lo[i]!); by0 = Math.min(by0, lo[i + 1]!); bz0 = Math.min(bz0, lo[i + 2]!);
        bx1 = Math.max(bx1, hi[i]!); by1 = Math.max(by1, hi[i + 1]!); bz1 = Math.max(bz1, hi[i + 2]!);
        cx0 = Math.min(cx0, cen[i]!); cy0 = Math.min(cy0, cen[i + 1]!); cz0 = Math.min(cz0, cen[i + 2]!);
        cx1 = Math.max(cx1, cen[i]!); cy1 = Math.max(cy1, cen[i + 1]!); cz1 = Math.max(cz1, cen[i + 2]!);
      }
      const b = node * 6;
      this.boxes[b] = bx0; this.boxes[b + 1] = by0; this.boxes[b + 2] = bz0;
      this.boxes[b + 3] = bx1; this.boxes[b + 4] = by1; this.boxes[b + 5] = bz1;
      const count = end - start;
      const ex = cx1 - cx0, ey = cy1 - cy0, ez = cz1 - cz0;
      if (count <= LEAF || Math.max(ex, ey, ez) < 1e-6) {
        this.meta[node * 2] = start;
        this.meta[node * 2 + 1] = -count;
        continue;
      }
      const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
      const mid = (start + end) >> 1;
      selectNth(order, cen, axis, start, end - 1, mid);
      const left = this.nodeCount++;
      const right = this.nodeCount++;
      this.meta[node * 2] = left;
      this.meta[node * 2 + 1] = right;
      work.push(left, start, mid, right, mid, end);
    }
  }

  /** Closest hit along `o + t d` for `t` in (tMin, tMax): the triangle index (and {@link hitT}), or -1. */
  intersect(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tMax: number, tMin = 1e-4): number {
    return this.query(ox, oy, oz, dx, dy, dz, tMax, tMin, false);
  }

  /** Whether anything lies along `o + t d` for `t` in (tMin, tMax). */
  occluded(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tMax: number, tMin = 1e-4): boolean {
    return this.query(ox, oy, oz, dx, dy, dz, tMax, tMin, true) >= 0;
  }

  private query(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tMax: number, tMin: number, any: boolean): number {
    if (this.triangleCount === 0) return -1;
    const ix = 1 / (dx === 0 ? 1e-12 : dx);
    const iy = 1 / (dy === 0 ? 1e-12 : dy);
    const iz = 1 / (dz === 0 ? 1e-12 : dz);
    const boxes = this.boxes;
    const meta = this.meta;
    const t = this.tri;
    const stack = this.stack;
    let sp = 0;
    stack[sp++] = 0;
    let best = tMax;
    let bestTri = -1;
    while (sp > 0) {
      const node = stack[--sp]!;
      const b = node * 6;
      let t0 = (boxes[b]! - ox) * ix;
      let t1 = (boxes[b + 3]! - ox) * ix;
      let tn = Math.min(t0, t1);
      let tf = Math.max(t0, t1);
      t0 = (boxes[b + 1]! - oy) * iy;
      t1 = (boxes[b + 4]! - oy) * iy;
      tn = Math.max(tn, Math.min(t0, t1));
      tf = Math.min(tf, Math.max(t0, t1));
      t0 = (boxes[b + 2]! - oz) * iz;
      t1 = (boxes[b + 5]! - oz) * iz;
      tn = Math.max(tn, Math.min(t0, t1));
      tf = Math.min(tf, Math.max(t0, t1));
      if (tf < tn || tf < tMin || tn > best) continue;
      const m1 = meta[node * 2 + 1]!;
      if (m1 > 0) {
        if (sp < stack.length - 2) {
          stack[sp++] = meta[node * 2]!;
          stack[sp++] = m1;
        }
        continue;
      }
      const start = meta[node * 2]!;
      const end = start - m1;
      for (let k = start; k < end; k++) {
        const i = this.order[k]!;
        const q = i * 12;
        const e1x = t[q + 3]!, e1y = t[q + 4]!, e1z = t[q + 5]!;
        const e2x = t[q + 6]!, e2y = t[q + 7]!, e2z = t[q + 8]!;
        const px = dy * e2z - dz * e2y;
        const py = dz * e2x - dx * e2z;
        const pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (det > -1e-12 && det < 1e-12) continue;
        const inv = 1 / det;
        const sx = ox - t[q]!, sy = oy - t[q + 1]!, sz = oz - t[q + 2]!;
        const u = (sx * px + sy * py + sz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y;
        const qy = sz * e1x - sx * e1z;
        const qz = sx * e1y - sy * e1x;
        const v = (dx * qx + dy * qy + dz * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        const d = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (d > tMin && d < best) {
          if (any) return i;
          best = d;
          bestTri = i;
        }
      }
    }
    this.hitT = best;
    return bestTri;
  }

  /** Unit geometric normal of triangle `i` into `out`. */
  normal(i: number, out: [number, number, number]): void {
    const q = i * 12;
    out[0] = this.tri[q + 9]!;
    out[1] = this.tri[q + 10]!;
    out[2] = this.tri[q + 11]!;
  }
}

/** Quickselect: partially order `order[lo..hi]` so the element at `k` has the median centroid along `axis`. */
function selectNth(order: Uint32Array, cen: Float32Array, axis: number, lo: number, hi: number, k: number): void {
  while (hi > lo) {
    const pivot = cen[order[(lo + hi) >> 1]! * 3 + axis]!;
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (cen[order[i]! * 3 + axis]! < pivot) i++;
      while (cen[order[j]! * 3 + axis]! > pivot) j--;
      if (i <= j) {
        const tmp = order[i]!;
        order[i] = order[j]!;
        order[j] = tmp;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else return;
  }
}

/** A lamp the bake lights the rooms with (three.js point-light units: candela, decay 2, smooth range cut). */
export interface VolumeLamp {
  position: V3;
  /** Linear RGB times intensity (candela). */
  color: V3;
  range: number;
}

/** Everything a bake needs. */
export interface VolumeBakeInput {
  grid: VolumeGrid;
  scene: TraceScene;
  /** Direction toward the sun (unit) and its irradiance on a surface facing it; null at night. */
  sun: { direction: V3; irradiance: V3 } | null;
  /**
   * The ambient light the renderer gives an unoccluded surface with normal `n`: `a + b * n.y` per channel
   * (sky hemisphere plus image light). The bake uses it to light the surfaces the rays hit.
   */
  ambient: { a: V3; b: V3 };
  /** The open ground around the building (rays that leave the scene downward land on it). */
  ground: { y: number; albedo: V3 };
  lamps: readonly VolumeLamp[];
  rays?: number;
  passes?: number;
}

/** Fibonacci-sphere ray directions (deterministic). */
export function sphereDirections(count: number): Float32Array {
  const n = Math.max(4, Math.min(512, Math.floor(count)));
  const out = new Float32Array(n * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - ((i + 0.5) / n) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = i * golden;
    out[i * 3] = Math.cos(a) * r;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = Math.sin(a) * r;
  }
  return out;
}

/** A deterministic hash in [0, 1). */
function hash01(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

type Stage = 'trace' | 'bounce' | 'finish' | 'done';

/**
 * Bakes a {@link VolumeBakeInput} in time slices: {@link step} does as much as fits in a budget and
 * returns true once the volume is complete. The result ({@link data}, {@link FLOATS_PER_PROBE} floats per
 * probe in x-fastest, then y, then z order) does not depend on how the work was sliced.
 */
export class LightVolumeBaker {
  readonly data: Float32Array;
  /** 1 for probes in free space, 0 for probes buried in walls (filled from their neighbours at the end). */
  readonly valid: Uint8Array;
  readonly probes: number;
  private readonly rays: number;
  private readonly passes: number;
  private readonly dirs: Float32Array;
  private readonly rotated: Float32Array;
  private readonly hitTri: Int32Array;
  private readonly hitT: Float32Array;
  private readonly hitDirect: Float32Array;
  /** Bounce irradiance from the open ground (constant over passes), 12 per probe. */
  private readonly groundB: Float32Array;
  private prev: Float32Array;
  private stage: Stage = 'trace';
  private pass = 1;
  private cursor = 0;
  private readonly groundL: [number, number, number];
  private readonly nrm: [number, number, number] = [0, 0, 0];
  private readonly sampleOut = new Float32Array(FLOATS_PER_PROBE);
  /** Per-probe accumulator (reused: the bake allocates nothing per probe). */
  private readonly acc = new Float64Array(12);

  constructor(private readonly input: VolumeBakeInput) {
    const g = input.grid;
    this.probes = g.nx * g.ny * g.nz;
    this.rays = Math.max(8, Math.min(256, Math.floor(input.rays ?? VOLUME_RAYS)));
    this.passes = Math.max(1, Math.min(6, Math.floor(input.passes ?? VOLUME_PASSES)));
    this.dirs = sphereDirections(this.rays);
    this.rotated = new Float32Array(this.rays * 3);
    this.data = new Float32Array(this.probes * FLOATS_PER_PROBE);
    this.prev = new Float32Array(this.probes * FLOATS_PER_PROBE);
    this.valid = new Uint8Array(this.probes);
    this.hitTri = new Int32Array(this.probes * this.rays);
    this.hitT = new Float32Array(this.probes * this.rays);
    this.hitDirect = new Float32Array(this.probes * this.rays * 3);
    this.groundB = new Float32Array(this.probes * 12);
    // Radiance of the open ground: sunlit (unshadowed: the building's own shadow is small next to the land in view) plus sky.
    const sun = input.sun;
    const sy = sun ? Math.max(0, sun.direction[1]) : 0;
    const amb = input.ambient;
    this.groundL = [0, 1, 2].map((c) => (clamp01(input.ground.albedo[c as 0 | 1 | 2]) / Math.PI) * ((sun ? sun.irradiance[c as 0 | 1 | 2] * sy : 0) + Math.max(0, amb.a[c as 0 | 1 | 2] + amb.b[c as 0 | 1 | 2]))) as [number, number, number];
  }

  /** Share of the work done (0..1). */
  get progress(): number {
    const units = this.passes + 2;
    const done = this.stage === 'trace' ? 0 : this.stage === 'bounce' ? this.pass : this.stage === 'finish' ? this.passes + 1 : units;
    return Math.min(1, (done + (this.stage === 'done' ? 0 : this.cursor / Math.max(1, this.probes))) / units);
  }

  get done(): boolean {
    return this.stage === 'done';
  }

  /** Work for up to `budgetMs` milliseconds (measured with `now`); true once the volume is complete. */
  step(budgetMs: number, now: () => number = () => performance.now()): boolean {
    const until = now() + Math.max(0.5, budgetMs);
    while (this.stage !== 'done') {
      if (this.stage === 'trace') {
        this.traceProbe(this.cursor++);
        if (this.cursor >= this.probes) this.nextStage();
      } else if (this.stage === 'bounce') {
        this.bounceProbe(this.cursor++);
        if (this.cursor >= this.probes) this.nextStage();
      } else {
        this.finish();
        this.stage = 'done';
        break;
      }
      if ((this.cursor & 7) === 0 && now() > until) break;
    }
    return this.stage === 'done';
  }

  /** Run to completion (tests, workers). */
  run(): Float32Array {
    while (!this.step(1e9)) {
      /* keep going */
    }
    return this.data;
  }

  private nextStage(): void {
    this.cursor = 0;
    if (this.stage === 'trace') {
      this.stage = 'bounce';
      this.pass = 1;
      this.prev.set(this.data);
      return;
    }
    if (this.pass < this.passes) {
      this.pass++;
      this.prev.set(this.data);
      return;
    }
    this.stage = 'finish';
  }

  private probePos(i: number, out: [number, number, number]): void {
    const g = this.input.grid;
    const ix = i % g.nx;
    const iy = Math.floor(i / g.nx) % g.ny;
    const iz = Math.floor(i / (g.nx * g.ny));
    out[0] = g.min[0] + ix * g.spacing;
    out[1] = g.min[1] + iy * g.spacing;
    out[2] = g.min[2] + iz * g.spacing;
  }

  /** This probe's ray set: the shared sphere turned by a per-probe rotation (no aliasing between neighbours). */
  private rotate(i: number): void {
    const a = hash01(i * 3 + 1) * Math.PI * 2;
    const z = hash01(i * 3 + 2) * 2 - 1;
    const r = Math.sqrt(1 - z * z);
    const ax = Math.cos(a) * r, ay = z, az = Math.sin(a) * r;
    const th = hash01(i * 3 + 3) * Math.PI * 2;
    const c = Math.cos(th), s = Math.sin(th), k = 1 - c;
    const m00 = c + ax * ax * k, m01 = ax * ay * k - az * s, m02 = ax * az * k + ay * s;
    const m10 = ay * ax * k + az * s, m11 = c + ay * ay * k, m12 = ay * az * k - ax * s;
    const m20 = az * ax * k - ay * s, m21 = az * ay * k + ax * s, m22 = c + az * az * k;
    const d = this.dirs;
    const o = this.rotated;
    for (let r2 = 0; r2 < this.rays; r2++) {
      const x = d[r2 * 3]!, y = d[r2 * 3 + 1]!, w = d[r2 * 3 + 2]!;
      o[r2 * 3] = m00 * x + m01 * y + m02 * w;
      o[r2 * 3 + 1] = m10 * x + m11 * y + m12 * w;
      o[r2 * 3 + 2] = m20 * x + m21 * y + m22 * w;
    }
  }

  private readonly pos: [number, number, number] = [0, 0, 0];

  /** Trace a probe's rays once: hits, direct light at each hit, sky visibility and the ground's bounce. */
  private traceProbe(i: number): void {
    const { scene, sun, lamps, ground } = this.input;
    const p = this.pos;
    this.probePos(i, p);
    this.rotate(i);
    const R = this.rays;
    const w = (4 * Math.PI) / R;
    let v0 = 0, v1 = 0, v2 = 0, v3 = 0;
    const gb = this.acc;
    gb.fill(0);
    let back = 0;
    const n = this.nrm;
    const maxT = Math.max(30, this.input.grid.spacing * Math.max(this.input.grid.nx, this.input.grid.ny, this.input.grid.nz) * 2);
    for (let r = 0; r < R; r++) {
      const dx = this.rotated[r * 3]!, dy = this.rotated[r * 3 + 1]!, dz = this.rotated[r * 3 + 2]!;
      const slot = i * R + r;
      const tri = scene.intersect(p[0], p[1], p[2], dx, dy, dz, maxT);
      if (tri < 0) {
        if (dy > 0 || p[1] <= ground.y) {
          // Open sky: counts toward the visibility (cosine lobes are applied when it is read).
          v0 += Y0;
          v1 += Y1 * dx;
          v2 += Y1 * dy;
          v3 += Y1 * dz;
          this.hitTri[slot] = MISS;
        } else {
          this.hitTri[slot] = GROUND_HIT;
          for (let c = 0; c < 3; c++) {
            const L = this.groundL[c]!;
            gb[c * 4] = gb[c * 4]! + L * Y0;
            gb[c * 4 + 1] = gb[c * 4 + 1]! + L * Y1 * dx;
            gb[c * 4 + 2] = gb[c * 4 + 2]! + L * Y1 * dy;
            gb[c * 4 + 3] = gb[c * 4 + 3]! + L * Y1 * dz;
          }
        }
        continue;
      }
      const t = scene.hitT;
      this.hitTri[slot] = tri;
      this.hitT[slot] = t;
      scene.normal(tri, n);
      let facing = n[0] * dx + n[1] * dy + n[2] * dz;
      if (facing > 0) {
        if (!scene.twoSided[tri]) back++;
        n[0] = -n[0];
        n[1] = -n[1];
        n[2] = -n[2];
        facing = -facing;
      }
      const hx = p[0] + dx * t + n[0] * 2e-3;
      const hy = p[1] + dy * t + n[1] * 2e-3;
      const hz = p[2] + dz * t + n[2] * 2e-3;
      let er = 0, eg = 0, eb = 0;
      if (sun) {
        const s = sun.direction;
        const cos = n[0] * s[0] + n[1] * s[1] + n[2] * s[2];
        if (cos > 0 && !scene.occluded(hx, hy, hz, s[0], s[1], s[2], maxT)) {
          er += sun.irradiance[0] * cos;
          eg += sun.irradiance[1] * cos;
          eb += sun.irradiance[2] * cos;
        }
      }
      for (const lamp of lamps) {
        const lx = lamp.position[0] - hx, ly = lamp.position[1] - hy, lz = lamp.position[2] - hz;
        const d2 = lx * lx + ly * ly + lz * lz;
        const d = Math.sqrt(d2);
        if (!(d > 1e-3) || d >= lamp.range) continue;
        const cos = (n[0] * lx + n[1] * ly + n[2] * lz) / d;
        if (cos <= 0) continue;
        const f = 1 - (d / lamp.range) ** 4;
        const att = (f * f) / Math.max(0.01, d2);
        if (scene.occluded(hx, hy, hz, lx / d, ly / d, lz / d, d - 0.05)) continue;
        er += lamp.color[0] * att * cos;
        eg += lamp.color[1] * att * cos;
        eb += lamp.color[2] * att * cos;
      }
      this.hitDirect[slot * 3] = er;
      this.hitDirect[slot * 3 + 1] = eg;
      this.hitDirect[slot * 3 + 2] = eb;
    }
    // Buried in a wall, or under the open ground (nothing the bake knows lies there): filled from neighbours.
    this.valid[i] = back / R > BURIED_SHARE || p[1] < ground.y - 0.05 ? 0 : 1;
    const o = i * FLOATS_PER_PROBE;
    // vis(n) = (1/π) E(n) for unit sky radiance: a = Y0 c0, b = (2/3) Y1 c1.
    this.data[o] = Y0 * v0 * w;
    this.data[o + 1] = (2 / 3) * Y1 * v1 * w;
    this.data[o + 2] = (2 / 3) * Y1 * v2 * w;
    this.data[o + 3] = (2 / 3) * Y1 * v3 * w;
    for (let k = 0; k < 12; k++) {
      const c = k % 4 === 0 ? Math.PI * Y0 : ((2 * Math.PI) / 3) * Y1;
      this.groundB[i * 12 + k] = gb[k]! * w * c;
      this.data[o + 4 + k] = this.groundB[i * 12 + k]!;
    }
  }

  /** One bounce pass for a probe: every hit reflects its direct light plus the ambient the previous pass left there. */
  private bounceProbe(i: number): void {
    const { scene, ambient } = this.input;
    const p = this.pos;
    this.probePos(i, p);
    this.rotate(i);
    const R = this.rays;
    const w = (4 * Math.PI) / R;
    const acc = this.acc;
    acc.fill(0);
    const n = this.nrm;
    const s = this.sampleOut;
    const half = this.input.grid.spacing * 0.5;
    for (let r = 0; r < R; r++) {
      const slot = i * R + r;
      const tri = this.hitTri[slot]!;
      if (tri < 0) continue;
      const dx = this.rotated[r * 3]!, dy = this.rotated[r * 3 + 1]!, dz = this.rotated[r * 3 + 2]!;
      const t = this.hitT[slot]!;
      scene.normal(tri, n);
      if (n[0] * dx + n[1] * dy + n[2] * dz > 0) {
        n[0] = -n[0];
        n[1] = -n[1];
        n[2] = -n[2];
      }
      // The light already around the hit point, read on its lit side (half a spacing out along the normal).
      sampleField(this.input.grid, this.prev, this.valid, p[0] + dx * t + n[0] * half, p[1] + dy * t + n[1] * half, p[2] + dz * t + n[2] * half, s);
      const vis = clamp01(s[0]! + s[1]! * n[0] + s[2]! * n[1] + s[3]! * n[2]);
      for (let c = 0; c < 3; c++) {
        const o = 4 + c * 4;
        const bounce = Math.max(0, s[o]! + s[o + 1]! * n[0] + s[o + 2]! * n[1] + s[o + 3]! * n[2]);
        const amb = Math.max(0, ambient.a[c as 0 | 1 | 2] + ambient.b[c as 0 | 1 | 2] * n[1]);
        const E = this.hitDirect[slot * 3 + c]! + vis * amb + bounce;
        const L = (scene.albedo[tri * 3 + c]! / Math.PI) * E;
        acc[c * 4] = acc[c * 4]! + L * Y0;
        acc[c * 4 + 1] = acc[c * 4 + 1]! + L * Y1 * dx;
        acc[c * 4 + 2] = acc[c * 4 + 2]! + L * Y1 * dy;
        acc[c * 4 + 3] = acc[c * 4 + 3]! + L * Y1 * dz;
      }
    }
    const o = i * FLOATS_PER_PROBE;
    for (let k = 0; k < 12; k++) {
      const c = k % 4 === 0 ? Math.PI * Y0 : ((2 * Math.PI) / 3) * Y1;
      this.data[o + 4 + k] = this.groundB[i * 12 + k]! + acc[k]! * w * c;
    }
  }

  /** Probes buried in walls take the mean of their free neighbours (repeatedly), the rest the mean of all free probes. */
  private finish(): void {
    const g = this.input.grid;
    const F = FLOATS_PER_PROBE;
    const ok = this.valid.slice();
    const mean = new Float64Array(F);
    let free = 0;
    for (let i = 0; i < this.probes; i++) {
      if (!ok[i]) continue;
      free++;
      for (let k = 0; k < F; k++) mean[k] = mean[k]! + this.data[i * F + k]!;
    }
    for (let round = 0; round < 4; round++) {
      const filled: number[] = [];
      for (let i = 0; i < this.probes; i++) {
        if (ok[i]) continue;
        const ix = i % g.nx;
        const iy = Math.floor(i / g.nx) % g.ny;
        const iz = Math.floor(i / (g.nx * g.ny));
        const sum = new Float64Array(F);
        let cnt = 0;
        for (const [ox, oy, oz] of NEIGHBOURS) {
          const jx = ix + ox, jy = iy + oy, jz = iz + oz;
          if (jx < 0 || jy < 0 || jz < 0 || jx >= g.nx || jy >= g.ny || jz >= g.nz) continue;
          const j = jx + g.nx * (jy + g.ny * jz);
          if (!ok[j]) continue;
          cnt++;
          for (let k = 0; k < F; k++) sum[k] = sum[k]! + this.data[j * F + k]!;
        }
        if (cnt === 0) continue;
        for (let k = 0; k < F; k++) this.data[i * F + k] = sum[k]! / cnt;
        filled.push(i);
      }
      for (const i of filled) ok[i] = 1;
      if (filled.length === 0) break;
    }
    for (let i = 0; i < this.probes; i++) {
      if (ok[i]) continue;
      for (let k = 0; k < F; k++) this.data[i * F + k] = free > 0 ? mean[k]! / free : k === 0 ? 1 : 0;
    }
    for (let k = 0; k < this.data.length; k++) if (!Number.isFinite(this.data[k]!)) this.data[k] = 0;
  }
}

const NEIGHBOURS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

function clamp01(v: number): number {
  return v > 0 ? (v < 1 ? v : 1) : 0;
}

/**
 * Trilinear read of a probe field at a world point (clamped to the grid), skipping probes flagged invalid
 * in `valid` (null: all valid). Writes {@link FLOATS_PER_PROBE} values into `out`.
 */
export function sampleField(g: VolumeGrid, data: Float32Array, valid: Uint8Array | null, x: number, y: number, z: number, out: Float32Array): void {
  const F = FLOATS_PER_PROBE;
  const fx = clampIdx((x - g.min[0]) / g.spacing, g.nx);
  const fy = clampIdx((y - g.min[1]) / g.spacing, g.ny);
  const fz = clampIdx((z - g.min[2]) / g.spacing, g.nz);
  const x0 = Math.min(g.nx - 2, Math.floor(fx)), y0 = Math.min(g.ny - 2, Math.floor(fy)), z0 = Math.min(g.nz - 2, Math.floor(fz));
  const tx = fx - x0, ty = fy - y0, tz = fz - z0;
  out.fill(0);
  let wsum = 0;
  for (let c = 0; c < 8; c++) {
    const ix = x0 + (c & 1), iy = y0 + ((c >> 1) & 1), iz = z0 + ((c >> 2) & 1);
    const j = ix + g.nx * (iy + g.ny * iz);
    if (valid && !valid[j]) continue;
    const wgt = (c & 1 ? tx : 1 - tx) * ((c >> 1) & 1 ? ty : 1 - ty) * ((c >> 2) & 1 ? tz : 1 - tz);
    if (wgt <= 0) continue;
    wsum += wgt;
    for (let k = 0; k < F; k++) out[k] = out[k]! + data[j * F + k]! * wgt;
  }
  if (wsum > 1e-6) for (let k = 0; k < F; k++) out[k] = out[k]! / wsum;
}

function clampIdx(f: number, n: number): number {
  return Number.isFinite(f) ? Math.max(0, Math.min(n - 1, f)) : 0;
}

/** What a surface at a point with normal `n` receives from the volume: sky visibility and bounce irradiance. */
export interface VolumeSample {
  vis: number;
  bounce: [number, number, number];
}

/** {@link sampleField} evaluated for a normal (CPU twin of the shader). Non-finite input reads the grid's centre. */
export function sampleVolume(g: VolumeGrid, data: Float32Array, x: number, y: number, z: number, n: V3, scratch = new Float32Array(FLOATS_PER_PROBE)): VolumeSample {
  const ok = Number.isFinite(x + y + z);
  const cx = ok ? x : g.min[0] + (g.nx - 1) * g.spacing * 0.5;
  const cy = ok ? y : g.min[1] + (g.ny - 1) * g.spacing * 0.5;
  const cz = ok ? z : g.min[2] + (g.nz - 1) * g.spacing * 0.5;
  sampleField(g, data, null, cx, cy, cz, scratch);
  const s = scratch;
  const ev = (o: number): number => s[o]! + s[o + 1]! * n[0] + s[o + 2]! * n[1] + s[o + 3]! * n[2];
  return { vis: clamp01(ev(0)), bounce: [Math.max(0, ev(4)), Math.max(0, ev(8)), Math.max(0, ev(12))] };
}

/** Float32 → IEEE half (round to nearest), clamped to the half range. */
export function toHalf(v: number): number {
  if (Number.isNaN(v)) return 0;
  const f = Math.max(-65000, Math.min(65000, v));
  const buf = HALF_SCRATCH;
  buf.f[0] = f;
  const x = buf.u[0]!;
  const sign = (x >>> 16) & 0x8000;
  const exp = (x >>> 23) & 0xff;
  let mant = x & 0x7fffff;
  if (exp < 103) return sign;
  if (exp < 113) {
    mant |= 0x800000;
    return sign | ((mant >>> (126 - exp)) + ((mant >>> (125 - exp)) & 1));
  }
  const e = exp - 112;
  const h = sign | (e << 10) | (mant >>> 13);
  return h + ((mant >>> 12) & 1);
}

const HALF_SCRATCH = (() => {
  const b = new ArrayBuffer(4);
  return { f: new Float32Array(b), u: new Uint32Array(b) };
})();

/** Depth (slices) of an atlas allocated for `alloc`: four sub-volumes, each with one padding slice at both ends. */
export function atlasDepth(alloc: Pick<VolumeGrid, 'nz'> = VOLUME_ALLOC): number {
  return ATLAS_SUBVOLUMES * (alloc.nz + 2);
}

/**
 * Lay a baked field out in an RGBA half-float 3D texture allocated for `alloc` (`alloc.nx × alloc.ny ×
 * atlasDepth(alloc)` texels): the grid fills the low corner; sub-volume `t` (vis, R, G, B) occupies slices
 * `t·(alloc.nz+2)+1 … t·(alloc.nz+2)+nz`, with a copy of its edge slice on both sides so the hardware filter
 * never blends two sub-volumes. Writes into `out` when given (it must have the allocated size).
 */
export function packVolumeAtlas(g: VolumeGrid, data: Float32Array, alloc: Readonly<{ nx: number; ny: number; nz: number }> = VOLUME_ALLOC, out?: Uint16Array): Uint16Array {
  const depth = atlasDepth(alloc);
  const size = alloc.nx * alloc.ny * depth * 4;
  const dst = out && out.length === size ? out : new Uint16Array(size);
  if (out === dst) dst.fill(0);
  const slab = alloc.nz + 2;
  const nx = Math.min(g.nx, alloc.nx);
  const ny = Math.min(g.ny, alloc.ny);
  const nz = Math.min(g.nz, alloc.nz);
  for (let t = 0; t < ATLAS_SUBVOLUMES; t++) {
    for (let s = 0; s < nz + 2; s++) {
      const iz = Math.max(0, Math.min(nz - 1, s - 1));
      const zOut = t * slab + s;
      for (let iy = 0; iy < ny; iy++) {
        for (let ix = 0; ix < nx; ix++) {
          const src = (ix + g.nx * (iy + g.ny * iz)) * FLOATS_PER_PROBE + t * 4;
          const o = (ix + alloc.nx * (iy + alloc.ny * zOut)) * 4;
          for (let c = 0; c < 4; c++) dst[o + c] = toHalf(data[src + c]!);
        }
      }
    }
  }
  return dst;
}
