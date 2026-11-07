/**
 * The lightmap as a project asset: one self-describing binary file (`.lmap`) that holds the atlas image (WebP when the
 * browser can encode it, else PNG, else raw RGBA), the 16-bit chart coordinates of every baked mesh and the numbers that made it:
 * the scale of each re-lightable part and the sun keys (`relight.ts`).
 * The same bytes live in the browser cache (IndexedDB, keyed by {@link lightmapKey}) and, for bundled worlds, as a static
 * file named after that key, so a world opened again (or on another machine) shows its baked light without a bake.
 *
 * Image layout: the atlas is `size` × `size` per layer. The file stacks it into `size` × `(layers + 1)·size` RGB: first the sky
 * visibility as grey, then each layer's RGB in order (`relight.ts`: sky0, sky1, lamp, the sun keys' chroma, their luminance).
 * Nothing needs an alpha channel, so a lossy image codec and the 2D canvas (which premultiplies alpha) cannot damage the
 * colours. Version 3 files (one bake for one hour) no longer load: the building keeps its light volume until it is baked again.
 *
 * Caps: {@link LIGHTMAP_MAX_ASSET_BYTES} per file; a larger one is re-encoded at lower quality, and dropped if it still
 * does not fit.
 */
import { hashWords } from './light-volume-cache';
import { LIGHTMAP_VERSION } from './lightmap';
import { lightmapLayers, scaleCount } from './relight';

/** Most bytes of one lightmap file. */
export const LIGHTMAP_MAX_ASSET_BYTES = 16 * 1024 * 1024;
const MAGIC = 0x4d4c4541; // 'AELM' little-endian

export interface LightmapAssetMeta {
  version: number;
  key: string;
  size: number;
  /** Layers stored (`relight.ts` `lightmapLayers(keys.length)`). */
  layers: number;
  /** The value a code of 255 stands for, per stored value (`relight.ts` `scaleCount`). */
  scales: number[];
  /** Directions toward the sun of the sun keys. */
  keys: Array<[number, number, number]>;
  quality: string;
  samples: number;
  density: number;
  charts: number;
  texels: number;
  rays: number;
  /** Wall time of the bake that made it (ms). */
  bakeMs: number;
  /** Triangles per offered mesh, in order; -1 for a mesh that is not baked. */
  tris: number[];
  image: 'webp' | 'png' | 'raw';
}

export interface UnpackedAsset {
  meta: LightmapAssetMeta;
  /** Per mesh: six 16-bit coordinates per triangle, or null. */
  uv: Array<Uint16Array | null>;
  /** The stacked image bytes (WebP, PNG or raw RGBA of `size` × `(layers + 1)·size`). */
  image: Uint8Array;
}

/** Stack the atlas layers (`parts` layers of RGBA, visibility in alpha) into `size` × `(parts + 1)·size` RGBA with opaque alpha. */
export function stackAtlas(layers: Uint8Array, size: number, parts: number): Uint8Array {
  const L = size * size;
  const out = new Uint8Array(L * (parts + 1) * 4);
  for (let o = 0; o < L; o++) {
    const v = layers[o * 4 + 3] as number;
    out[o * 4] = v;
    out[o * 4 + 1] = v;
    out[o * 4 + 2] = v;
    out[o * 4 + 3] = 255;
  }
  for (let p = 0; p < parts; p++) {
    const src = p * L * 4;
    const dst = (p + 1) * L * 4;
    for (let o = 0; o < L; o++) {
      out[dst + o * 4] = layers[src + o * 4] as number;
      out[dst + o * 4 + 1] = layers[src + o * 4 + 1] as number;
      out[dst + o * 4 + 2] = layers[src + o * 4 + 2] as number;
      out[dst + o * 4 + 3] = 255;
    }
  }
  return out;
}

/** The atlas layers back out of a stacked image (the inverse of {@link stackAtlas}: every layer's alpha is the visibility). */
export function unstackAtlas(stacked: Uint8Array, size: number, parts: number): Uint8Array {
  const L = size * size;
  const out = new Uint8Array(L * parts * 4);
  for (let p = 0; p < parts; p++) {
    const src = (p + 1) * L * 4;
    const dst = p * L * 4;
    for (let o = 0; o < L; o++) {
      out[dst + o * 4] = stacked[src + o * 4] as number;
      out[dst + o * 4 + 1] = stacked[src + o * 4 + 1] as number;
      out[dst + o * 4 + 2] = stacked[src + o * 4 + 2] as number;
      out[dst + o * 4 + 3] = stacked[o * 4] as number;
    }
  }
  return out;
}

/** Serialise an asset: magic, header length, header JSON, image length, image, then the coordinates. */
export function packAsset(meta: LightmapAssetMeta, uv: ReadonlyArray<Uint16Array | null>, image: Uint8Array): Uint8Array {
  const head = new TextEncoder().encode(JSON.stringify(meta));
  const uvBytes = uv.reduce((n, u) => n + (u ? u.byteLength : 0), 0);
  const pad = (4 - ((12 + head.length + image.length) % 4)) % 4;
  const out = new Uint8Array(12 + head.length + image.length + pad + uvBytes);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, head.length, true);
  dv.setUint32(8, image.length, true);
  out.set(head, 12);
  out.set(image, 12 + head.length);
  let o = 12 + head.length + image.length + pad;
  for (const u of uv) {
    if (!u) continue;
    out.set(new Uint8Array(u.buffer, u.byteOffset, u.byteLength), o);
    o += u.byteLength;
  }
  return out;
}

/** Parse and validate an asset file; null when it is malformed, from another version or over the caps. */
export function unpackAsset(bytes: Uint8Array): UnpackedAsset | null {
  try {
    if (bytes.length < 16 || bytes.length > LIGHTMAP_MAX_ASSET_BYTES * 4) return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (dv.getUint32(0, true) !== MAGIC) return null;
    const headLen = dv.getUint32(4, true);
    const imageLen = dv.getUint32(8, true);
    if (headLen > 1 << 20 || 12 + headLen + imageLen > bytes.length) return null;
    const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + headLen))) as LightmapAssetMeta;
    if (meta.version !== LIGHTMAP_VERSION || ![256, 512, 1024].includes(meta.size) || !Array.isArray(meta.tris) || meta.tris.length > 4096) return null;
    if (!Array.isArray(meta.keys) || meta.keys.length > 16 || !meta.keys.every((k) => Array.isArray(k) && k.length === 3 && k.every((x) => Number.isFinite(x)))) return null;
    if (meta.layers !== lightmapLayers(meta.keys.length) || !Array.isArray(meta.scales) || meta.scales.length !== scaleCount(meta.keys.length) || !meta.scales.every((x) => Number.isFinite(x) && x > 0)) return null;
    if (meta.image !== 'webp' && meta.image !== 'png' && meta.image !== 'raw') return null;
    const image = bytes.subarray(12 + headLen, 12 + headLen + imageLen);
    if (meta.image === 'raw' && image.length !== meta.size * meta.size * (meta.layers + 1) * 4) return null;
    const pad = (4 - ((12 + headLen + imageLen) % 4)) % 4;
    let o = bytes.byteOffset + 12 + headLen + imageLen + pad;
    const uv: Array<Uint16Array | null> = [];
    for (const t of meta.tris) {
      if (!Number.isInteger(t) || t < -1) return null;
      if (t < 0) {
        uv.push(null);
        continue;
      }
      const len = t * 6;
      if (o - bytes.byteOffset + len * 2 > bytes.length) return null;
      uv.push(new Uint16Array(bytes.buffer.slice(o, o + len * 2)));
      o += len * 2;
    }
    return { meta, uv, image: image.slice() };
  } catch {
    return null;
  }
}

/** A hash of the geometry and volume arrays a bake reads (the part of the key that does not depend on the quality). */
export function contentHash(arrays: ReadonlyArray<ArrayBufferView>): string {
  let a = hashWords(new TextEncoder().encode(`lightmap-content-${LIGHTMAP_VERSION}`));
  for (const [i, v] of arrays.entries()) a = hashWords(v, parseInt(a.slice(0, 7), 16) + i);
  return a;
}

/**
 * {@link contentHash} of arrays made one at a time (`make(i)`, null past the last), with the event loop between them once a
 * slice of `sliceMs` is spent: the same hash, without holding the page for a house's geometry.
 */
export async function contentHashSliced(make: (i: number) => ArrayBufferView | null, sliceMs = 8): Promise<string> {
  let a = hashWords(new TextEncoder().encode(`lightmap-content-${LIGHTMAP_VERSION}`));
  let until = performance.now() + sliceMs;
  for (let i = 0; ; i++) {
    const v = make(i);
    if (!v) break;
    a = hashWords(v, parseInt(a.slice(0, 7), 16) + i);
    if (performance.now() > until) {
      await new Promise((r) => setTimeout(r, 0));
      until = performance.now() + sliceMs;
    }
  }
  return a;
}

/** The content key of a bake: the content hash plus everything small it reads (the plan, the light), file-safe (`lm<version>-<32 hex digits>`). */
export function lightmapKey(content: string, scalars: unknown): string {
  const small = hashWords(new TextEncoder().encode(JSON.stringify([LIGHTMAP_VERSION, content, scalars])));
  return `lm${LIGHTMAP_VERSION}-${content}${small}`;
}
