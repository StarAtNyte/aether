/**
 * The compressed encoding of a geometry-cache entry (format 2), used by the geometry cache (ddc.ts) and the cooked packs
 * (cook/format.ts). It is loaded only where entries are written or read: the generation lanes (gen.worker.ts), the cook
 * script and tests, never the page bundle.
 *
 * Every typed array of the output is stored on its own, chosen by the property that holds it:
 *
 * - `positions` and hull `points`: snapped to a 2^-11 m grid (error at most 0.25 mm) and stored with meshopt's
 *   exponential filter (one exponent per component) and vertex codec. Arrays reaching past 4,096 m are stored losslessly.
 * - `normals`: octahedral, 12 bits a component (angle error under 0.05°), meshopt filter and vertex codec. Arrays that are
 *   not unit length (zero normals) take the exponential path on a 2^-14 grid instead.
 * - `uvs` (2^-16 grid, which a 4,096 px atlas reads to a sixteenth of a texel), `colors` and `splat` (2^-12),
 *   heightfield `heights` (2^-16): exponential filter and vertex codec.
 * - Triangle `indices`: meshopt index codec (triangles may come back rotated, winding kept).
 * - An array whose values equal an earlier array's (a prepared part's 16-bit indices and the 32-bit ones they came from,
 *   split indices, a trimesh collider's copy of the part's streams) is stored as a reference to it.
 * - Anything else: meshopt's lossless vertex codec, or raw bytes.
 *
 * The whole is then deflated (gzip, the platform's CompressionStream), since static hosts do not compress `.bin`.
 *
 * Layout: `u32 magic 'AEQ2' | u32 inner length | gzip(inner)`; inner: `u32 header length | header JSON | blobs`, the header
 * being `{ table, json }` as in format 1, with table rows `[type, offset, bytes, count, codec, a]`. A format 1 entry (no
 * magic) is still read.
 */
import { MeshoptEncoder } from 'meshoptimizer/encoder';
import { MeshoptDecoder } from 'meshoptimizer/decoder';
import type { GeneratorOutput } from '../types';
import { decodeOutput, encodeOutput, type EncodedOutput } from './ddc';

/** `AEQ2`, little-endian. A format 1 entry starts with its header length, which is far smaller. */
export const ENTRY_MAGIC = 0x32514541;

/** Whether new entries are written compressed (`__AETHER_GEOMETRY_COMPRESS`, on unless set to false). */
export function compressEntries(): boolean {
  return (globalThis as { __AETHER_GEOMETRY_COMPRESS?: unknown }).__AETHER_GEOMETRY_COMPRESS !== false;
}

type Tag = 'f32' | 'f64' | 'u32' | 'u16' | 'u8' | 'i32' | 'i16' | 'i8';
type Ctor = Float32ArrayConstructor | Float64ArrayConstructor | Uint32ArrayConstructor | Uint16ArrayConstructor | Uint8ArrayConstructor | Int32ArrayConstructor | Int16ArrayConstructor | Int8ArrayConstructor;
const TYPES: Readonly<Record<Tag, Ctor>> = { f32: Float32Array, f64: Float64Array, u32: Uint32Array, u16: Uint16Array, u8: Uint8Array, i32: Int32Array, i16: Int16Array, i8: Int8Array };
type Typed = Float32Array | Float64Array | Uint32Array | Uint16Array | Uint8Array | Int32Array | Int16Array | Int8Array;

function tagOf(a: ArrayBufferView): Tag | null {
  if (a instanceof Float32Array) return 'f32';
  if (a instanceof Float64Array) return 'f64';
  if (a instanceof Uint32Array) return 'u32';
  if (a instanceof Uint16Array) return 'u16';
  if (a instanceof Uint8Array) return 'u8';
  if (a instanceof Int32Array) return 'i32';
  if (a instanceof Int16Array) return 'i16';
  if (a instanceof Int8Array) return 'i8';
  return null;
}

/**
 * Codecs: `r` raw bytes; `v` lossless vertex codec (a = stride); `x` exponential filter + vertex codec (a = stride);
 * `o` octahedral normals (12 bits, decoded to float xyz); `t` triangle index codec (a = 2 | 4); `=` same values as row a.
 */
type Codec = 'r' | 'v' | 'x' | 'o' | 't' | '=';
type Row = [Tag, number, number, number, Codec, number];

let ready: Promise<void> | null = null;
/** Resolves once the meshopt encoder and decoder are compiled (call before any encode or decode). */
export function codecReady(): Promise<void> {
  ready ??= Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]).then(() => undefined);
  return ready;
}

const bytesOf = (a: ArrayBufferView): Uint8Array => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

/** Grid (log2 of the step, negated) and components per vertex of the lossy float roles. */
const FLOAT_ROLES: Readonly<Record<string, { grid: number; size: number }>> = {
  positions: { grid: 11, size: 3 },
  points: { grid: 11, size: 3 },
  uvs: { grid: 16, size: 2 },
  colors: { grid: 12, size: 3 },
  splat: { grid: 12, size: 4 },
  heights: { grid: 16, size: 1 },
};

/** Largest magnitude, or -1 when any value is not finite. */
function maxAbs(a: Float32Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    const v = a[i]!;
    if (!Number.isFinite(v)) return -1;
    const x = v < 0 ? -v : v;
    if (x > m) m = x;
  }
  return m;
}

/** Exponential filter on a 2^-grid grid: values snapped to it, bits enough for the largest; null when that needs over 24 bits. */
function encodeExp(a: Float32Array, size: number, grid: number): Uint8Array | null {
  const n = a.length / size;
  if (!Number.isInteger(n) || n === 0) return null;
  const m = maxAbs(a);
  if (m < 0) return null;
  const bits = (m > 0 ? Math.floor(Math.log2(m)) + 1 : 0) + grid + 2;
  if (bits > 24) return null;
  const scale = 2 ** grid;
  const snapped = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) snapped[i] = Math.round(a[i]! * scale) / scale;
  const filtered = MeshoptEncoder.encodeFilterExp(snapped, n, size * 4, Math.max(bits, 2), 'SharedComponent');
  return MeshoptEncoder.encodeVertexBuffer(filtered, n, size * 4);
}

/** Octahedral normals, or null when any is not unit length (within 1e-3). */
function encodeOct(a: Float32Array): Uint8Array | null {
  const n = a.length / 3;
  if (!Number.isInteger(n) || n === 0) return null;
  const src = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const x = a[i * 3]!, y = a[i * 3 + 1]!, z = a[i * 3 + 2]!;
    const l = x * x + y * y + z * z;
    if (!(Math.abs(l - 1) <= 2e-3)) return null;
    src[i * 4] = x;
    src[i * 4 + 1] = y;
    src[i * 4 + 2] = z;
  }
  const filtered = MeshoptEncoder.encodeFilterOct(src, n, 8, 12);
  return MeshoptEncoder.encodeVertexBuffer(filtered, n, 8);
}

function sameValues(a: Typed, b: Typed): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const isIndexTag = (t: Tag): boolean => t === 'u32' || t === 'u16';

async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(data: Uint8Array, expected: number): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('gzip'));
  const out = new Uint8Array(await new Response(stream).arrayBuffer());
  if (out.byteLength !== expected) throw new Error('bad inner length');
  return out;
}

/** Bytes of an entry's typed arrays by codec, from the last {@link encodeEntry} (diagnostics and the cook report). */
export interface EncodeStats {
  rawBytes: number;
  innerBytes: number;
  bytes: number;
}

/**
 * Serialize an output, compressed (format 2) unless `__AETHER_GEOMETRY_COMPRESS` is false or `compress` says otherwise.
 * The output is untouched. Requires {@link codecReady}.
 */
export async function encodeEntry(out: GeneratorOutput, compress = compressEntries()): Promise<EncodedOutput & { stats?: EncodeStats }> {
  if (!compress) return encodeOutput(out);
  await codecReady();
  return packEntry(encodeInner(out));
}

/** The uncompressed inner part of a format 2 entry (synchronous: every array is copied, so the output may be transferred right after). */
export interface InnerEntry {
  inner: Uint8Array;
  rawBytes: number;
}

/** First, synchronous half of {@link encodeEntry}; {@link codecReady} must have resolved. */
export function encodeInner(out: GeneratorOutput): InnerEntry {
  const arrays: Typed[] = [];
  const rows: Row[] = [];
  const blobs: Uint8Array[] = [];
  const index = new Map<ArrayBufferView, number>();
  let offset = 0;
  let rawBytes = 0;
  const json = JSON.stringify({ v: 1, out }, (key: string, value: unknown) => {
    if (!ArrayBuffer.isView(value)) return value;
    let i = index.get(value);
    if (i !== undefined) return { $a: i };
    const tag = tagOf(value);
    if (!tag) throw new Error('unsupported array type');
    const a = value as Typed;
    i = rows.length;
    index.set(value, i);
    arrays.push(a);
    rawBytes += a.byteLength;
    let codec: Codec = 'r';
    let param = 0;
    let blob: Uint8Array | null = null;
    // An array with the values of an earlier one (any integer width, or identical floats).
    for (let j = 0; j < arrays.length - 1 && a.length > 0; j++) {
      const b = arrays[j]!;
      const bt = rows[j]![0];
      if ((isIndexTag(tag) && isIndexTag(bt)) || bt === tag) {
        if (sameValues(a, b)) {
          codec = '=';
          param = j;
          blob = new Uint8Array(0);
          break;
        }
      }
    }
    if (!blob && a.length > 0) {
      const role = FLOAT_ROLES[key];
      if (tag === 'f32' && key === 'normals') {
        blob = encodeOct(a as Float32Array);
        if (blob) codec = 'o';
        else {
          blob = encodeExp(a as Float32Array, 3, 14);
          if (blob) [codec, param] = ['x', 12];
        }
      } else if (tag === 'f32' && role && a.length % role.size === 0) {
        blob = encodeExp(a as Float32Array, role.size, role.grid);
        if (blob) [codec, param] = ['x', role.size * 4];
      } else if (isIndexTag(tag) && key === 'indices' && a.length % 3 === 0) {
        const size = a.BYTES_PER_ELEMENT;
        blob = MeshoptEncoder.encodeIndexBuffer(bytesOf(a), a.length, size);
        [codec, param] = ['t', size];
      }
      if (!blob && a.byteLength % 4 === 0 && tag !== 'f64') {
        blob = MeshoptEncoder.encodeVertexBuffer(bytesOf(a), a.byteLength / 4, 4);
        [codec, param] = ['v', 4];
      }
      if (blob && blob.byteLength >= a.byteLength && codec === 'v') blob = null;
    }
    if (!blob) {
      blob = bytesOf(a).slice();
      [codec, param] = ['r', 0];
    }
    rows.push([tag, offset, blob.byteLength, a.length, codec, param]);
    blobs.push(blob);
    offset += Math.ceil(blob.byteLength / 4) * 4;
    return { $a: i };
  });
  const header = new TextEncoder().encode(JSON.stringify({ table: rows, json }));
  const headLen = Math.ceil((4 + header.byteLength) / 4) * 4;
  const inner = new Uint8Array(headLen + offset);
  new DataView(inner.buffer).setUint32(0, header.byteLength, true);
  inner.set(header, 4);
  for (let k = 0; k < blobs.length; k++) inner.set(blobs[k]!, headLen + rows[k]![1]);
  return { inner, rawBytes };
}

/** Second half of {@link encodeEntry}: deflate the inner part and frame it. */
export async function packEntry({ inner, rawBytes }: InnerEntry): Promise<EncodedOutput & { stats: EncodeStats }> {
  const packed = await gzip(inner);
  const outer = new Uint8Array(8 + packed.byteLength);
  const dv = new DataView(outer.buffer);
  dv.setUint32(0, ENTRY_MAGIC, true);
  dv.setUint32(4, inner.byteLength, true);
  outer.set(packed, 8);
  return { blob: new Blob([outer]), bytes: outer.byteLength, stats: { rawBytes, innerBytes: inner.byteLength, bytes: outer.byteLength } };
}

/** True when the entry at `at` is format 2. */
export function isCompressedEntry(buf: ArrayBuffer, at = 0, size = buf.byteLength - at): boolean {
  return size >= 8 && new DataView(buf, at, 8).getUint32(0, true) === ENTRY_MAGIC;
}

/**
 * Inverse of {@link encodeEntry} (and of format 1's `encodeOutput`): every array gets a buffer of its own (safe to
 * transfer). `at` and `size` select one entry inside a larger buffer (a cooked pack). Throws on malformed data.
 */
export async function decodeEntry(buf: ArrayBuffer, at = 0, size = buf.byteLength - at): Promise<GeneratorOutput> {
  if (!Number.isInteger(at) || !Number.isInteger(size) || at < 0 || size < 0 || at + size > buf.byteLength) throw new Error('bad entry range');
  if (!isCompressedEntry(buf, at, size)) return decodeOutput(buf, at, size);
  await codecReady();
  const innerLen = new DataView(buf, at, 8).getUint32(4, true);
  if (innerLen > 1 << 30) throw new Error('bad inner length');
  const inner = await gunzip(new Uint8Array(buf, at + 8, size - 8), innerLen);
  const len = new DataView(inner.buffer).getUint32(0, true);
  if (4 + len > inner.byteLength) throw new Error('bad header length');
  const { table, json } = JSON.parse(new TextDecoder().decode(inner.subarray(4, 4 + len))) as { table: Row[]; json: string };
  if (!Array.isArray(table) || typeof json !== 'string') throw new Error('bad header');
  const base = Math.ceil((4 + len) / 4) * 4;
  const views: Typed[] = [];
  for (const row of table) {
    if (!Array.isArray(row) || row.length !== 6) throw new Error('bad array entry');
    const [tag, off, bytes, count, codec, a] = row;
    const C = TYPES[tag];
    if (!C || ![off, bytes, count, a].every((x) => Number.isInteger(x) && x >= 0)) throw new Error('bad array entry');
    const start = base + off;
    if (start + bytes > inner.byteLength) throw new Error('array out of range');
    const src = inner.subarray(start, start + bytes);
    const outBytes = count * C.BYTES_PER_ELEMENT;
    if (outBytes > 1 << 30) throw new Error('array too large');
    let view: Typed;
    switch (codec) {
      case 'r':
        if (bytes !== outBytes) throw new Error('bad raw array');
        view = new C(src.slice().buffer);
        break;
      case '=': {
        const from = views[a];
        if (!from || from.length !== count) throw new Error('bad array reference');
        // The same type shares the array (outputs are immutable; a transfer lists each buffer once); another width copies.
        if (from instanceof C) view = from;
        else {
          view = new C(count);
          view.set(from as never);
        }
        break;
      }
      case 'v':
      case 'x': {
        if (a === 0 || a % 4 !== 0 || outBytes % a !== 0) throw new Error('bad stride');
        const target = new Uint8Array(outBytes);
        MeshoptDecoder.decodeVertexBuffer(target, outBytes / a, a, src, codec === 'x' ? 'EXPONENTIAL' : undefined);
        view = new C(target.buffer);
        break;
      }
      case 'o': {
        if (tag !== 'f32' || count % 3 !== 0) throw new Error('bad normals');
        const n = count / 3;
        const target = new Int16Array(n * 4);
        MeshoptDecoder.decodeVertexBuffer(new Uint8Array(target.buffer), n, 8, src, 'OCTAHEDRAL');
        const f = new Float32Array(count);
        for (let i = 0; i < n; i++) {
          const x = target[i * 4]!, y = target[i * 4 + 1]!, z = target[i * 4 + 2]!;
          const l = Math.hypot(x, y, z) || 1;
          f[i * 3] = x / l;
          f[i * 3 + 1] = y / l;
          f[i * 3 + 2] = z / l;
        }
        view = f;
        break;
      }
      case 't': {
        if ((a !== 2 && a !== 4) || a !== C.BYTES_PER_ELEMENT || count % 3 !== 0) throw new Error('bad index array');
        const target = new Uint8Array(outBytes);
        MeshoptDecoder.decodeIndexBuffer(target, count, a, src);
        view = new C(target.buffer);
        break;
      }
      default:
        throw new Error('bad codec');
    }
    views.push(view);
  }
  const doc = JSON.parse(json, (_k, value: unknown) => {
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && typeof (value as { $a?: unknown }).$a === 'number' && Object.keys(value).length === 1) {
      const v = views[(value as { $a: number }).$a];
      if (!v) throw new Error('bad array reference');
      return v;
    }
    return value;
  }) as { v: number; out: GeneratorOutput };
  if (doc.v !== 1 || !doc.out || !Array.isArray(doc.out.parts)) throw new Error('bad entry');
  return doc.out;
}
