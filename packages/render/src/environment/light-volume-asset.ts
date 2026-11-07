/**
 * The re-lightable light volume as a file (`.lvol`): what a cooked package ships beside its lightmap, so a viewer lights the
 * building without baking. One self-describing binary: magic, header JSON (version, key, grid, sun keys), then the probe data
 * as half floats, gzipped (static hosts do not compress `.bin`-like files): per probe the sky visibility (4 halves) and the two
 * free-distance codes, then the parts as the volume stores them (`relight.ts` `volumeLightFloats`).
 *
 * Half precision keeps about three significant digits of irradiance (the bake's own noise is larger), and the codes are small
 * integers, exact in half.
 */
import { FLOATS_PER_PROBE, GEOMETRY_OFFSET, toHalf, type V3, type VolumeGrid } from './light-volume';
import { parseGrid } from './light-volume-protocol';
import { volumeLightFloats } from './relight';

/** Bump with the layout below: older files stop loading (the volume is then baked as before). */
export const VOLUME_ASSET_VERSION = 1;
const MAGIC = 0x564c4541; // 'AELV' little-endian
/** Most bytes of one volume file (compressed). */
export const VOLUME_MAX_ASSET_BYTES = 16 * 1024 * 1024;

export interface VolumeAsset {
  key: string;
  grid: VolumeGrid;
  keys: V3[];
  /** {@link FLOATS_PER_PROBE} floats per probe: visibility and free distances (light floats zero). */
  data: Float32Array;
  /** The parts as stored, `volumeLightFloats(keys)` floats per probe. */
  light: Float32Array;
}

/** Halves per probe in the file. */
function halvesPerProbe(keys: number): number {
  return 6 + volumeLightFloats(keys);
}

/** Serialise a volume (uncompressed; see {@link packVolumeAsset}). */
export function encodeVolumeAsset(a: VolumeAsset): Uint8Array {
  const run = encodeSteps(a);
  while (!run.step(Infinity)) {
    /* at once */
  }
  return run.out;
}

/** The encoding of {@link encodeVolumeAsset} in steps of about `ms` milliseconds (the page's thread: a publish packs it). */
function encodeSteps(a: VolumeAsset): { out: Uint8Array; step(ms: number): boolean } {
  const g = a.grid;
  const probes = g.nx * g.ny * g.nz;
  const head = new TextEncoder().encode(JSON.stringify({ version: VOLUME_ASSET_VERSION, key: a.key, grid: g, keys: a.keys }));
  const pad = (2 - ((8 + head.length) % 2)) % 2;
  const H = halvesPerProbe(a.keys.length);
  const out = new Uint8Array(8 + head.length + pad + probes * H * 2);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, head.length, true);
  out.set(head, 8);
  const halves = new Uint16Array(out.buffer, 8 + head.length + pad, probes * H);
  const PF = volumeLightFloats(a.keys.length);
  let i = 0;
  const step = (ms: number): boolean => {
    const until = Number.isFinite(ms) ? performance.now() + ms : Infinity;
    for (; i < probes; i++) {
      const o = i * H;
      const d = i * FLOATS_PER_PROBE;
      for (let k = 0; k < 4; k++) halves[o + k] = toHalf(a.data[d + k] as number);
      halves[o + 4] = toHalf(a.data[d + GEOMETRY_OFFSET] as number);
      halves[o + 5] = toHalf(a.data[d + GEOMETRY_OFFSET + 1] as number);
      for (let k = 0; k < PF; k++) halves[o + 6 + k] = toHalf(a.light[i * PF + k] as number);
      if ((i & 255) === 255 && performance.now() > until) {
        i++;
        return i >= probes;
      }
    }
    return true;
  };
  return { out, step };
}

/** Parse an uncompressed volume file; null when it is malformed or from another version. */
export function decodeVolumeAsset(bytes: Uint8Array): VolumeAsset | null {
  try {
    if (bytes.length < 16) return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (dv.getUint32(0, true) !== MAGIC) return null;
    const headLen = dv.getUint32(4, true);
    if (headLen > 1 << 16 || 8 + headLen > bytes.length) return null;
    const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + headLen))) as { version?: unknown; key?: unknown; grid?: unknown; keys?: unknown };
    if (meta.version !== VOLUME_ASSET_VERSION || typeof meta.key !== 'string') return null;
    const grid = parseGrid(meta.grid);
    if (!grid || !Array.isArray(meta.keys) || meta.keys.length > 16) return null;
    const keys: V3[] = [];
    for (const k of meta.keys as unknown[]) {
      if (!Array.isArray(k) || k.length !== 3 || !k.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
      keys.push([k[0], k[1], k[2]] as V3);
    }
    const probes = grid.nx * grid.ny * grid.nz;
    const H = halvesPerProbe(keys.length);
    const pad = (2 - ((8 + headLen) % 2)) % 2;
    const start = 8 + headLen + pad;
    if (bytes.length !== start + probes * H * 2) return null;
    const halves = new Uint16Array(bytes.slice(start).buffer);
    const data = new Float32Array(probes * FLOATS_PER_PROBE);
    const PF = volumeLightFloats(keys.length);
    const light = new Float32Array(probes * PF);
    for (let i = 0; i < probes; i++) {
      const o = i * H;
      const d = i * FLOATS_PER_PROBE;
      for (let k = 0; k < 4; k++) data[d + k] = fromHalf(halves[o + k] as number);
      data[d + GEOMETRY_OFFSET] = fromHalf(halves[o + 4] as number);
      data[d + GEOMETRY_OFFSET + 1] = fromHalf(halves[o + 5] as number);
      for (let k = 0; k < PF; k++) light[i * PF + k] = fromHalf(halves[o + 6 + k] as number);
    }
    for (let i = 0; i < light.length; i++) if (!Number.isFinite(light[i] as number)) return null;
    return { key: meta.key, grid, keys, data, light };
  } catch {
    return null;
  }
}

/** IEEE half → float. */
export function fromHalf(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const m = h & 0x3ff;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? Number.NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes.slice().buffer]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** The file's bytes: the encoding gzipped. */
export async function packVolumeAsset(a: VolumeAsset): Promise<Uint8Array> {
  // Encoded in slices with the event loop between them (19 k probes of 100 floats held the page for a few hundred ms).
  const run = encodeSteps(a);
  while (!run.step(8)) await new Promise((r) => setTimeout(r, 0));
  return pipe(run.out, new CompressionStream('gzip'));
}

/** A file's volume; null when it does not decompress or parse. */
export async function unpackVolumeAsset(bytes: Uint8Array): Promise<VolumeAsset | null> {
  try {
    if (bytes.length > VOLUME_MAX_ASSET_BYTES) return null;
    return decodeVolumeAsset(await pipe(bytes, new DecompressionStream('gzip')));
  } catch {
    return null;
  }
}
