/**
 * Validation of user-imported images (textures, decals, posters) and HDR
 * environment maps. Only the header is parsed: format by magic bytes (never
 * by file extension or the browser-reported MIME type), dimensions, and
 * byte / pixel caps. Decoding happens later in the browser's image decoder.
 */

/** Accepted raster formats. */
export type ImageFormat = 'png' | 'jpeg' | 'webp';

export interface ImageInfo {
  format: ImageFormat;
  mime: `image/${ImageFormat}`;
  width: number;
  height: number;
}

export interface ImageLimits {
  maxBytes: number;
  maxSide: number;
}

export const DEFAULT_IMAGE_LIMITS: ImageLimits = { maxBytes: 12 * 1024 * 1024, maxSide: 8192 };
export const DEFAULT_HDR_LIMITS: ImageLimits = { maxBytes: 24 * 1024 * 1024, maxSide: 4096 };

export type ImageResult = { ok: true; info: ImageInfo } | { ok: false; error: string };
export type HdrResult = { ok: true; width: number; height: number } | { ok: false; error: string };

const u32be = (b: Uint8Array, o: number): number => ((b[o]! << 24) >>> 0) + (b[o + 1]! << 16) + (b[o + 2]! << 8) + b[o + 3]!;
const u16be = (b: Uint8Array, o: number): number => (b[o]! << 8) | b[o + 1]!;
const u16le = (b: Uint8Array, o: number): number => b[o]! | (b[o + 1]! << 8);
const u24le = (b: Uint8Array, o: number): number => b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16);

function png(b: Uint8Array): [number, number] | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 33 || !sig.every((v, i) => b[i] === v)) return null;
  if (String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!) !== 'IHDR') return null;
  return [u32be(b, 16), u32be(b, 20)];
}

function jpeg(b: Uint8Array): [number, number] | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let o = 2;
  // Walk segments to the first start-of-frame marker (bounded by the file length).
  while (o + 9 < b.length) {
    if (b[o] !== 0xff) return null;
    const marker = b[o + 1]!;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      o += 2;
      continue;
    }
    const len = u16be(b, o + 2);
    if (len < 2) return null;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return [u16be(b, o + 7), u16be(b, o + 5)];
    o += 2 + len;
  }
  return null;
}

function webp(b: Uint8Array): [number, number] | null {
  if (b.length < 30 || String.fromCharCode(b[0]!, b[1]!, b[2]!, b[3]!) !== 'RIFF' || String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!) !== 'WEBP') return null;
  const chunk = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
  if (chunk === 'VP8 ') return [u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff];
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
  }
  if (chunk === 'VP8X') return [u24le(b, 24) + 1, u24le(b, 27) + 1];
  return null;
}

/** Validate a PNG / JPEG / WebP image by its header. Never throws. */
export function validateImage(bytes: Uint8Array, limits: Partial<ImageLimits> = {}): ImageResult {
  const lim = { ...DEFAULT_IMAGE_LIMITS, ...limits };
  if (bytes.byteLength > lim.maxBytes) return { ok: false, error: `the image is too large (limit ${Math.round(lim.maxBytes / 1024 / 1024)} MB)` };
  const checks: Array<[ImageFormat, (b: Uint8Array) => [number, number] | null]> = [
    ['png', png],
    ['jpeg', jpeg],
    ['webp', webp],
  ];
  for (const [format, read] of checks) {
    const dims = read(bytes);
    if (!dims) continue;
    const [width, height] = dims;
    if (!(width > 0 && height > 0)) return { ok: false, error: 'the image has no pixels' };
    if (width > lim.maxSide || height > lim.maxSide) return { ok: false, error: `the image is too big (${width}×${height}, limit ${lim.maxSide} px per side)` };
    return { ok: true, info: { format, mime: `image/${format}`, width, height } };
  }
  return { ok: false, error: 'unsupported image (use PNG, JPEG or WebP)' };
}

/** Validate a Radiance `.hdr` (RGBE) environment map by its header. Never throws. */
export function validateHdr(bytes: Uint8Array, limits: Partial<ImageLimits> = {}): HdrResult {
  const lim = { ...DEFAULT_HDR_LIMITS, ...limits };
  if (bytes.byteLength > lim.maxBytes) return { ok: false, error: `the HDR file is too large (limit ${Math.round(lim.maxBytes / 1024 / 1024)} MB)` };
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.byteLength, 4096)));
  if (!head.startsWith('#?RADIANCE') && !head.startsWith('#?RGBE')) return { ok: false, error: 'not a Radiance .hdr file' };
  if (!/FORMAT=32-bit_rle_rgbe/.test(head)) return { ok: false, error: 'only RGBE .hdr files are supported' };
  const m = /\n-Y (\d{1,5}) \+X (\d{1,5})\n/.exec(head);
  if (!m) return { ok: false, error: 'unsupported .hdr orientation (expected -Y h +X w)' };
  const height = Number(m[1]);
  const width = Number(m[2]);
  if (!(width > 0 && height > 0)) return { ok: false, error: 'the HDR image has no pixels' };
  if (width > lim.maxSide || height > lim.maxSide) return { ok: false, error: `the HDR image is too big (${width}×${height}, limit ${lim.maxSide} px)` };
  return { ok: true, width, height };
}
