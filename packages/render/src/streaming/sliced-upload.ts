/**
 * Geometry uploads in slices (WebGL2), for the render-preparation queue (docs/ARCHITECTURE-STREAMING.md, section 3.8).
 *
 * three uploads a vertex or index buffer with one `bufferData` call the first time an object is drawn or prepared: a
 * terrain or a merged street of tens of megabytes was one call of 100–450 ms on the main thread. Here a large static
 * attribute is uploaded before that, one step at a time: the buffer is allocated (`bufferData` with a size only), then
 * filled with `bufferSubData` in chunks of {@link UPLOAD_CHUNK_BYTES}, and handed to three's backend only once complete.
 * three then finds the buffer in place and only reads its layout (`WebGLAttributeUtils.createAttribute` skips
 * `_createBuffer` when `bufferGPU` is set). The object is not drawn until its preparation is done, so a half-filled
 * buffer is never drawn.
 *
 * Small, dynamic and interleaved attributes are left to three, as is everything on WebGPU.
 */

/** Bytes of one `bufferSubData` slice. */
export const UPLOAD_CHUNK_BYTES = 1024 * 1024;
/** Attributes smaller than this are uploaded by three in one call, as before. */
export const SLICED_MIN_BYTES = 1024 * 1024;

const STATIC_DRAW = 35044;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

interface Attr {
  array: ArrayBufferView & { length: number; BYTES_PER_ELEMENT?: number };
  version: number;
  usage?: number;
  isInterleavedBufferAttribute?: boolean;
}
interface Geometry {
  index: Attr | null;
  attributes: Record<string, Attr>;
  addEventListener?(type: string, listener: () => void): void;
}
type GL = Pick<WebGL2RenderingContext, 'createBuffer' | 'bindBuffer' | 'bufferData' | 'bufferSubData' | 'deleteBuffer'>;
/** The parts of three's WebGL backend used here. */
export interface SlicedUploadBackend {
  isWebGLBackend?: boolean;
  gl: GL;
  get(object: object): { bufferGPU?: WebGLBuffer; bufferType?: number; version?: number };
  state: { resetVertexState(): void };
}

interface Pending {
  buffer: WebGLBuffer;
  target: number;
  offset: number;
  version: number;
}

/** Counters for probes. */
export interface SlicedUploadStats {
  /** Attributes uploaded in slices. */
  attributes: number;
  /** Bytes uploaded in slices. */
  bytes: number;
  /** Slices (`bufferSubData` calls). */
  slices: number;
}

/**
 * A stepper for the preparation queue: `step(geometry)` does at most one slice of upload work for the geometry's large
 * attributes and returns true once none is left to upload (then three's own upload has nothing large to do). Null when
 * the backend is not WebGL2.
 */
export function slicedUploads(backend: unknown): { step(geometry: unknown): boolean; readonly stats: SlicedUploadStats } | null {
  const b = backend as SlicedUploadBackend | null;
  if (!b || b.isWebGLBackend !== true || !b.gl || typeof b.get !== 'function' || typeof b.state?.resetVertexState !== 'function') return null;
  const gl = b.gl;
  const pending = new WeakMap<Attr, Pending>();
  const watched = new WeakSet<object>();
  const stats: SlicedUploadStats = { attributes: 0, bytes: 0, slices: 0 };

  const drop = (attr: Attr): void => {
    const p = pending.get(attr);
    if (!p) return;
    pending.delete(attr);
    // Not handed over yet: three made its own buffer (or the attribute changed), so this one is unused.
    if (b.get(attr).bufferGPU !== p.buffer) gl.deleteBuffer(p.buffer);
  };
  const bind = (target: number, buffer: WebGLBuffer | null): void => {
    // An element buffer binds to the current vertex array: leave none bound (through three's state, so its cache agrees).
    if (target === ELEMENT_ARRAY_BUFFER) b.state.resetVertexState();
    gl.bindBuffer(target, buffer);
  };

  /** One slice of work for `attr`; false when it had nothing to do. */
  const advance = (attr: Attr, target: number): boolean => {
    const data = b.get(attr);
    if (data.bufferGPU !== undefined) {
      drop(attr);
      return false;
    }
    let p = pending.get(attr);
    if (p && p.version !== attr.version) {
      drop(attr);
      p = undefined;
    }
    const bytes = attr.array.byteLength;
    if (!p) {
      const buffer = gl.createBuffer();
      if (!buffer) return false;
      bind(target, buffer);
      gl.bufferData(target, bytes, STATIC_DRAW);
      bind(target, null);
      pending.set(attr, { buffer, target, offset: 0, version: attr.version });
      return true;
    }
    const per = attr.array.BYTES_PER_ELEMENT ?? 1;
    const count = Math.max(1, Math.floor(UPLOAD_CHUNK_BYTES / per));
    const first = p.offset / per;
    const n = Math.min(count, attr.array.length - first);
    bind(target, p.buffer);
    gl.bufferSubData(target, p.offset, attr.array, first, n);
    bind(target, null);
    p.offset += n * per;
    stats.slices++;
    stats.bytes += n * per;
    if (p.offset >= bytes) {
      // Complete: three's backend takes it as if it had made it.
      pending.delete(attr);
      data.bufferGPU = p.buffer;
      data.bufferType = target;
      data.version = attr.version;
      stats.attributes++;
    }
    return true;
  };

  const sliced = (attr: Attr | null | undefined): attr is Attr =>
    !!attr && !attr.isInterleavedBufferAttribute && ArrayBuffer.isView(attr.array) && attr.array.byteLength >= SLICED_MIN_BYTES && (attr.usage ?? STATIC_DRAW) === STATIC_DRAW;

  return {
    stats,
    step(geometry: unknown): boolean {
      const g = geometry as Geometry | null;
      if (!g || typeof g !== 'object' || !g.attributes) return true;
      if (!watched.has(g) && typeof g.addEventListener === 'function') {
        watched.add(g);
        g.addEventListener('dispose', () => {
          if (g.index) drop(g.index);
          for (const a of Object.values(g.attributes)) drop(a);
        });
      }
      if (sliced(g.index) && advance(g.index, ELEMENT_ARRAY_BUFFER)) return false;
      for (const name in g.attributes) {
        const a = g.attributes[name];
        if (sliced(a) && advance(a, ARRAY_BUFFER)) return false;
      }
      return true;
    },
  };
}
