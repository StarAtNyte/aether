/**
 * HLOD proxies (docs/ARCHITECTURE-STREAMING.md §3.3, stage 5): per streamed cell, one merged and simplified mesh of
 * everything the cell holds, baked at cook time from the full-detail scene (geometry plus the albedo baked into vertex
 * colours). A far cell draws its proxy instead of its full detail, so the full detail of far cells never loads, and a
 * cell that comes near swaps its full detail in under a dithered cross-fade (`hlod-layer.ts`).
 *
 * This module is the file format and its types; the bake (simplification, meshoptimizer) is `hlod-bake.ts`, imported
 * only by the cook's recording, so the page bundle does not carry the simplifier.
 *
 * **File** (`hlod/proxies.bin` in the package folder, manifest `hlod`): gzip of
 * `u32 'AEH1' | u32 header length | header JSON | blobs`, every blob 4-byte aligned. The header is
 * `{ version, proxies: [{ cell, members, bounds, vertices, indices, offset }] }`; per proxy the blob holds:
 * - positions, 3 x u16 per vertex, quantized to the proxy's bounds (at most 1/65535 of its extent: 1 mm on a 64 m cell);
 * - normals, 4 x i8 per vertex (xyz, then padding);
 * - colours, 4 x u8 per vertex (sRGB-encoded linear albedo, then padding);
 * - indices, u16 when there are at most 65,536 vertices, else u32.
 */

/** Version of the proxy format and of how proxies are built (a viewer reads only its own). */
export const HLOD_VERSION = 1;

/** File of the proxies in a package folder. */
export const HLOD_FILE = 'hlod/proxies.bin';

/** Largest proxy file a viewer reads (bytes, compressed). */
export const MAX_HLOD_BYTES = 64 * 1024 * 1024;

const MAGIC = 0x31484541; // 'AEH1'

/** A proxy's mesh in world space: positions, unit normals and linear colours per vertex, triangles. */
export interface ProxyMesh {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

/** One cell's proxy. */
export interface HlodProxy extends ProxyMesh {
  /** The streaming cell (`level:ix,iz`, cell-streaming.ts). */
  cell: string;
  /** Top-level entities the proxy was baked from, sorted: a viewer uses it only for a cell of exactly these. */
  members: string[];
  /** World bounds of the proxy: min xyz, max xyz. */
  bounds: [number, number, number, number, number, number];
}

/** A proxy's entry in the file header. */
interface ProxyHeader {
  cell: string;
  members: string[];
  bounds: [number, number, number, number, number, number];
  vertices: number;
  indices: number;
  offset: number;
}

const align4 = (n: number): number => (n + 3) & ~3;

function linearToSrgb8(c: number): number {
  const v = c <= 0 ? 0 : c >= 1 ? 1 : c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(v * 255);
}

/** Linear value of each sRGB byte. */
const SRGB_TO_LINEAR = /* @__PURE__ */ (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    t[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return t;
})();

/** Bounds (min xyz, max xyz) of `positions`; zeros when empty. */
export function positionBounds(positions: Float32Array): [number, number, number, number, number, number] {
  if (positions.length < 3) return [0, 0, 0, 0, 0, 0];
  const b: [number, number, number, number, number, number] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k] as number;
      if (v < b[k]!) b[k] = v;
      if (v > b[k + 3]!) b[k + 3] = v;
    }
  }
  return b;
}

/** Bytes of one proxy's blob. */
function blobBytes(vertices: number, indices: number): number {
  return align4(vertices * 6) + vertices * 4 + vertices * 4 + align4(indices * (vertices > 65536 ? 4 : 2));
}

/** Encode proxies into the file's uncompressed body (gzip it for the file: {@link gzipBytes}). */
export function encodeHlod(proxies: readonly HlodProxy[]): Uint8Array<ArrayBuffer> {
  const headers: ProxyHeader[] = [];
  let size = 0;
  for (const p of proxies) {
    const v = p.positions.length / 3;
    headers.push({ cell: p.cell, members: [...p.members], bounds: p.bounds, vertices: v, indices: p.indices.length, offset: size });
    size += blobBytes(v, p.indices.length);
  }
  const head = new TextEncoder().encode(JSON.stringify({ version: HLOD_VERSION, proxies: headers }));
  const start = align4(8 + head.length);
  const out = new Uint8Array(start + size);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, head.length, true);
  out.set(head, 8);
  proxies.forEach((p, n) => {
    const h = headers[n]!;
    const v = h.vertices;
    let o = start + h.offset;
    const b = p.bounds;
    const q = new Uint16Array(out.buffer, o, v * 3);
    for (let i = 0; i < v * 3; i++) {
      const k = i % 3;
      const ext = (b[k + 3] as number) - (b[k] as number);
      q[i] = ext > 0 ? Math.round((((p.positions[i] as number) - (b[k] as number)) / ext) * 65535) : 0;
    }
    o += align4(v * 6);
    const nrm = new Int8Array(out.buffer, o, v * 4);
    for (let i = 0; i < v; i++) for (let k = 0; k < 3; k++) nrm[i * 4 + k] = Math.round(Math.max(-1, Math.min(1, p.normals[i * 3 + k] as number)) * 127);
    o += v * 4;
    const col = new Uint8Array(out.buffer, o, v * 4);
    for (let i = 0; i < v; i++) for (let k = 0; k < 3; k++) col[i * 4 + k] = linearToSrgb8(p.colors[i * 3 + k] as number);
    o += v * 4;
    if (v > 65536) new Uint32Array(out.buffer, o, p.indices.length).set(p.indices);
    else new Uint16Array(out.buffer, o, p.indices.length).set(p.indices);
  });
  return out;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNat = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** Decode a proxy file's uncompressed body (untrusted). Throws on anything malformed. */
export function decodeHlod(bytes: Uint8Array): HlodProxy[] {
  if (bytes.byteLength < 8) throw new Error('hlod: too short');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('hlod: not a proxy file');
  const len = dv.getUint32(4, true);
  if (8 + len > bytes.byteLength) throw new Error('hlod: bad header');
  const head = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + len))) as { version?: unknown; proxies?: unknown };
  if (head.version !== HLOD_VERSION) throw new Error(`hlod: version ${String(head.version)}`);
  if (!Array.isArray(head.proxies) || head.proxies.length > 100_000) throw new Error('hlod: bad proxies');
  const start = align4(8 + len);
  // Copy into an aligned buffer once (the decompressed bytes may sit at any offset).
  const body = new Uint8Array(bytes.byteLength - start);
  body.set(bytes.subarray(start));
  const out: HlodProxy[] = [];
  for (const raw of head.proxies as unknown[]) {
    const h = raw as Partial<ProxyHeader>;
    if (typeof h.cell !== 'string' || h.cell.length > 40 || !Array.isArray(h.members) || !h.members.every((m) => typeof m === 'string') || !Array.isArray(h.bounds) || h.bounds.length !== 6 || !h.bounds.every(isNum)) throw new Error('hlod: bad proxy');
    const v = h.vertices, n = h.indices, off = h.offset;
    if (!isNat(v) || !isNat(n) || !isNat(off) || n % 3 !== 0 || off % 4 !== 0 || off + blobBytes(v, n) > body.byteLength) throw new Error('hlod: proxy out of range');
    const b = h.bounds as HlodProxy['bounds'];
    let o = off;
    const q = new Uint16Array(body.buffer, o, v * 3);
    const positions = new Float32Array(v * 3);
    for (let i = 0; i < v * 3; i++) {
      const k = i % 3;
      positions[i] = (b[k] as number) + ((q[i] as number) / 65535) * ((b[k + 3] as number) - (b[k] as number));
    }
    o += align4(v * 6);
    const nrm = new Int8Array(body.buffer, o, v * 4);
    const normals = new Float32Array(v * 3);
    for (let i = 0; i < v; i++) {
      const x = (nrm[i * 4] as number) / 127, y = (nrm[i * 4 + 1] as number) / 127, z = (nrm[i * 4 + 2] as number) / 127;
      const l = Math.hypot(x, y, z) || 1;
      normals[i * 3] = x / l;
      normals[i * 3 + 1] = y / l;
      normals[i * 3 + 2] = z / l;
    }
    o += v * 4;
    const col = new Uint8Array(body.buffer, o, v * 4);
    const colors = new Float32Array(v * 3);
    for (let i = 0; i < v; i++) for (let k = 0; k < 3; k++) colors[i * 3 + k] = SRGB_TO_LINEAR[col[i * 4 + k] as number] as number;
    o += v * 4;
    const indices = v > 65536 ? new Uint32Array(new Uint32Array(body.buffer, o, n)) : Uint32Array.from(new Uint16Array(body.buffer, o, n));
    for (let i = 0; i < n; i++) if ((indices[i] as number) >= v) throw new Error('hlod: index out of range');
    out.push({ cell: h.cell, members: [...(h.members as string[])], bounds: [...b], positions, normals, colors, indices });
  }
  return out;
}

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

/** Gzip `bytes` (the proxy file). */
export function gzipBytes(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return pipe(bytes, new CompressionStream('gzip'));
}

/** Read a proxy file (gzip of {@link encodeHlod}'s body). Throws on anything malformed. */
export async function readHlodFile(bytes: Uint8Array<ArrayBuffer>): Promise<HlodProxy[]> {
  return decodeHlod(await pipe(bytes, new DecompressionStream('gzip')));
}

/** The members key of a set of top-level entities (sorted, joined). */
export function membersKey(ids: Iterable<string>): string {
  return [...ids].sort().join('\u0000');
}
