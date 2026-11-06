/**
 * CPU copies of uploaded render-only geometry (docs/PERFORMANCE.md, "CPU copies after upload").
 *
 * three keeps every vertex and index array on the CPU after it has gone to the GPU. For geometry that only the GPU reads
 * after that (building merges, shadow and view cell batches) the copy is dead weight: on Lisbon Hills 120 MB of merged
 * geometry, 59 MB of shadow batches and 142 MB of view batches. Engines drop such arrays once uploaded (three's own
 * `onUploadCallback` on WebGLRenderer; the WebGPU renderer and its WebGL2 backend never call it).
 *
 * A geometry is registered with {@link releaseAfterUpload}; {@link sweepUploads}, called at the start of each frame, swaps
 * the array of every attribute named (and the index) for an empty array of the same type once three's backend holds a
 * buffer for it. three uploads only what a pass reads (the sun's depth pass, positions), so an attribute goes when a pass
 * that reads it has drawn; one no pass reads keeps its copy. Counts, item sizes and array types stay, which is all three
 * reads to draw; the bounds are computed before the first array goes and fixed. Readers that need the data again ask the owner through the
 * {@link CpuSource} registered with it: {@link cpuGeometry} for a full copy (export), {@link cpuPieces} for positions
 * (shadow batches). Picking, physics and lightmaps read the members, which keep their arrays.
 *
 * `__AETHER_RELEASE_CPU_GEOMETRY = false` keeps every copy (A/B runs).
 */
import type { BufferAttribute, BufferGeometry, InterleavedBufferAttribute, Matrix4 } from 'three';

/** The owner's way back to the data of a released geometry. */
export interface CpuSource {
  /** A new geometry with the released geometry's contents (the caller disposes it). */
  restore?(): BufferGeometry | null;
  /**
   * Indexed pieces whose triangles, transformed by their matrix, are the released geometry's triangles in its own
   * frame and order (members of a merge). Their arrays stay on the CPU.
   */
  pieces?(): ReadonlyArray<{ geometry: BufferGeometry; matrix: Matrix4 }> | null;
}

interface Entry {
  source: CpuSource;
  /** Attribute names to release ('index' for the index); null: all of them. */
  names: ReadonlySet<string> | null;
  released: boolean;
  bytes: number;
}

/** Counters for probes (`globalThis.__aetherCpuRelease`). */
export interface CpuReleaseStats {
  /** Geometries whose arrays were released. */
  geometries: number;
  /** Bytes released so far (running total). */
  bytes: number;
  /** Geometries waiting for their upload. */
  pending: number;
  /** Full copies made again ({@link cpuGeometry}). */
  restored: number;
}

const entries = new WeakMap<BufferGeometry, Entry>();
const pending = new Set<BufferGeometry>();
const stats: CpuReleaseStats = { geometries: 0, bytes: 0, pending: 0, restored: 0 };
(globalThis as { __aetherCpuRelease?: CpuReleaseStats }).__aetherCpuRelease = stats;

function enabled(): boolean {
  return (globalThis as { __AETHER_RELEASE_CPU_GEOMETRY?: boolean }).__AETHER_RELEASE_CPU_GEOMETRY !== false;
}

/**
 * Release the CPU arrays of `geometry` once it is uploaded (all its attributes, or `names`; 'index' names the index).
 * Only for geometry nothing changes after this and that only the GPU reads, or whose readers go through `source`.
 */
export function releaseAfterUpload(geometry: BufferGeometry, source: CpuSource = {}, names: readonly string[] | null = null): void {
  if (!enabled() || entries.has(geometry)) return;
  entries.set(geometry, { source, names: names ? new Set(names) : null, released: false, bytes: 0 });
  pending.add(geometry);
  stats.pending = pending.size;
  geometry.addEventListener('dispose', () => {
    pending.delete(geometry);
    stats.pending = pending.size;
  });
}

/** Whether `geometry`'s arrays were released (its data must come from {@link cpuGeometry} or {@link cpuPieces}). */
export function released(geometry: BufferGeometry): boolean {
  return entries.get(geometry)?.released === true;
}

/**
 * `geometry` with its data: itself while its arrays are kept, else a new copy from its owner (`temporary`: the caller
 * disposes it), or null when the owner cannot make one.
 */
export function cpuGeometry(geometry: BufferGeometry): { geometry: BufferGeometry; temporary: boolean } | null {
  const e = entries.get(geometry);
  if (!e?.released) return { geometry, temporary: false };
  const copy = e.source.restore?.() ?? null;
  if (!copy) return null;
  stats.restored++;
  return { geometry: copy, temporary: true };
}

/** The pieces of a released geometry (see {@link CpuSource.pieces}); null while its arrays are kept or without pieces. */
export function cpuPieces(geometry: BufferGeometry): ReadonlyArray<{ geometry: BufferGeometry; matrix: Matrix4 }> | null {
  const e = entries.get(geometry);
  return e?.released ? e.source.pieces?.() ?? null : null;
}

/** The parts of three's backend read here (WebGL2: `bufferGPU`, WebGPU: `buffer`). */
interface Backend {
  has(object: object): boolean;
  get(object: object): { bufferGPU?: unknown; buffer?: unknown };
}

type Attr = BufferAttribute | InterleavedBufferAttribute;

function uploaded(backend: Backend, a: Attr): boolean {
  const key = (a as InterleavedBufferAttribute).isInterleavedBufferAttribute ? (a as InterleavedBufferAttribute).data : a;
  if (!backend.has(key)) return false;
  const d = backend.get(key);
  return d.bufferGPU !== undefined || d.buffer !== undefined;
}

/** Most geometries checked per call (the set is checked in turns). */
const SWEEP_MAX = 64;

/**
 * Release the arrays of registered geometries that three has uploaded. Call after a drawn frame. Returns the bytes
 * released by this call.
 */
export function sweepUploads(backend: unknown): number {
  if (pending.size === 0) return 0;
  const b = backend as Backend | null;
  if (!b || typeof b.has !== 'function' || typeof b.get !== 'function') return 0;
  let freed = 0;
  let checked = 0;
  for (const g of pending) {
    if (++checked > SWEEP_MAX) break;
    const e = entries.get(g);
    pending.delete(g);
    if (!e) continue;
    const { bytes, left } = release(b, g, e);
    freed += bytes;
    // Attributes three has not uploaded yet (a pass that reads only positions drew it so far) are checked again later,
    // after the others; an attribute no pass reads keeps its copy.
    if (left) pending.add(g);
  }
  stats.pending = pending.size;
  return freed;
}

/** Drop the uploaded arrays of `g` that `e` names; `left`: some are still waiting for their upload. */
function release(b: Backend, g: BufferGeometry, e: Entry): { bytes: number; left: boolean } {
  let bytes = 0;
  let left = false;
  const drop = (a: Attr | null, name: string): void => {
    if (!a || (e.names && !e.names.has(name)) || (a as InterleavedBufferAttribute).isInterleavedBufferAttribute) return;
    const attr = a as BufferAttribute & { count: number };
    const array = attr.array;
    if (array.length === 0) return;
    if (!uploaded(b, a)) {
      left = true;
      return;
    }
    if (!e.released) {
      // Bounds first, while the positions are here; then fixed (a recompute would read the empty array).
      if (!g.boundingBox) g.computeBoundingBox();
      if (!g.boundingSphere) g.computeBoundingSphere();
      const fixed = g as BufferGeometry & { computeBoundingBox(): void; computeBoundingSphere(): void };
      fixed.computeBoundingBox = keepBounds;
      fixed.computeBoundingSphere = keepBounds;
      e.released = true;
      stats.geometries++;
    }
    bytes += array.byteLength;
    // Same type: three reads the array's type (vertex format, index type) when it draws. The count stays.
    const count = attr.count;
    attr.array = new (array.constructor as new (n: number) => typeof array)(0);
    attr.count = count;
  };
  if (g.index) drop(g.index, 'index');
  for (const name in g.attributes) drop(g.attributes[name]!, name);
  e.bytes += bytes;
  stats.bytes += bytes;
  return { bytes, left };
}

function keepBounds(): void {
  // Released geometry keeps the bounds computed before its arrays went.
}
