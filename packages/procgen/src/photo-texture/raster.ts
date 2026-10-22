/**
 * Float images for the texture work: interleaved RGB in linear light, bounded sizes, deterministic, no dependencies.
 *
 * Everything the photo-texture pipeline does (rectify, fill, de-light, tile, derive maps) runs on these, so it behaves the same in
 * the browser, a worker and Node tests.
 */

/** An RGBA8 raster as a host decoder returns it (structurally `RasterLike` of `../surface`). */
export interface Rgba8 {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/** Linear-light RGB, row-major, top row first. */
export interface FImage {
  width: number;
  height: number;
  /** `width * height * 3` floats. */
  data: Float32Array;
}

/** Largest image the pipeline allocates (pixels). */
export const MAX_PIXELS = 4096 * 4096;

const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const v = i / 255;
  SRGB_TO_LINEAR[i] = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** sRGB (0..1) → linear. */
export const toLinear = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
/** Linear → sRGB (0..1). */
export const toSrgb = (v: number): number => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055);

/** A zeroed image. */
export function newImage(width: number, height: number): FImage {
  if (!(width >= 1 && height >= 1) || width * height > MAX_PIXELS) throw new Error(`image size ${width}x${height} is out of range`);
  return { width: Math.floor(width), height: Math.floor(height), data: new Float32Array(Math.floor(width) * Math.floor(height) * 3) };
}

/** A copy. */
export function cloneImage(img: FImage): FImage {
  return { width: img.width, height: img.height, data: new Float32Array(img.data) };
}

/** Decode an RGBA8 raster (sRGB) into linear light, alpha ignored. */
export function fromRgba8(r: Rgba8): FImage {
  const out = newImage(r.width, r.height);
  const n = r.width * r.height;
  for (let i = 0; i < n; i++) {
    out.data[i * 3] = SRGB_TO_LINEAR[r.data[i * 4] as number] as number;
    out.data[i * 3 + 1] = SRGB_TO_LINEAR[r.data[i * 4 + 1] as number] as number;
    out.data[i * 3 + 2] = SRGB_TO_LINEAR[r.data[i * 4 + 2] as number] as number;
  }
  return out;
}

/** Encode to RGBA8: sRGB-encoded when `srgb`, else the linear values scaled by `scale` (maps that hold data). */
export function toRgba8(img: FImage, opts: { srgb?: boolean; scale?: number } = {}): Uint8Array {
  const out = new Uint8Array(img.width * img.height * 4);
  const scale = opts.scale ?? 1;
  const n = img.width * img.height;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const v = (img.data[i * 3 + c] as number) * scale;
      const e = opts.srgb ? toSrgb(Math.max(0, Math.min(1, v))) : Math.max(0, Math.min(1, v));
      out[i * 4 + c] = Math.round(e * 255);
    }
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Luminance plane (Rec. 709 on linear values). */
export function luminance(img: FImage): Float32Array {
  const n = img.width * img.height;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = 0.2126 * (img.data[i * 3] as number) + 0.7152 * (img.data[i * 3 + 1] as number) + 0.0722 * (img.data[i * 3 + 2] as number);
  return out;
}

/** Mean of each channel over the pixels where `mask` is non-zero (all pixels without a mask). */
export function meanColour(img: FImage, mask?: Uint8Array): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let k = 0;
  const n = img.width * img.height;
  for (let i = 0; i < n; i++) {
    if (mask && !mask[i]) continue;
    r += img.data[i * 3] as number;
    g += img.data[i * 3 + 1] as number;
    b += img.data[i * 3 + 2] as number;
    k++;
  }
  return k === 0 ? [0, 0, 0] : [r / k, g / k, b / k];
}

/** `#rrggbb` of a linear colour. */
export function linearToHex(c: readonly [number, number, number]): string {
  return `#${c.map((v) => Math.round(Math.max(0, Math.min(1, toSrgb(v))) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** Bilinear sample of channel triple at pixel-centre coordinates (x, y in pixels), clamped at the edges. */
export function sampleBilinear(img: FImage, x: number, y: number, out: Float32Array | number[], o = 0): void {
  const fx = Math.max(0, Math.min(img.width - 1, x - 0.5));
  const fy = Math.max(0, Math.min(img.height - 1, y - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(img.width - 1, x0 + 1);
  const y1 = Math.min(img.height - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const w = img.width;
  const d = img.data;
  for (let c = 0; c < 3; c++) {
    const a = (d[(y0 * w + x0) * 3 + c] as number) * (1 - tx) + (d[(y0 * w + x1) * 3 + c] as number) * tx;
    const b = (d[(y1 * w + x0) * 3 + c] as number) * (1 - tx) + (d[(y1 * w + x1) * 3 + c] as number) * tx;
    out[o + c] = a * (1 - ty) + b * ty;
  }
}

/** Half-size copy by 2x2 box average (odd edges are clamped). */
export function halve(img: FImage): FImage {
  const w = Math.max(1, img.width >> 1);
  const h = Math.max(1, img.height >> 1);
  const out = newImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.min(img.width - 1, x * 2);
      const x1 = Math.min(img.width - 1, x * 2 + 1);
      const y0 = Math.min(img.height - 1, y * 2);
      const y1 = Math.min(img.height - 1, y * 2 + 1);
      for (let c = 0; c < 3; c++) {
        out.data[(y * w + x) * 3 + c] = ((img.data[(y0 * img.width + x0) * 3 + c] as number) + (img.data[(y0 * img.width + x1) * 3 + c] as number) + (img.data[(y1 * img.width + x0) * 3 + c] as number) + (img.data[(y1 * img.width + x1) * 3 + c] as number)) / 4;
      }
    }
  }
  return out;
}

/** The image and its successive halves down to one pixel (index 0 is the image itself). */
export function pyramid(img: FImage, maxLevels = 12): FImage[] {
  const out = [img];
  while (out.length < maxLevels) {
    const last = out[out.length - 1] as FImage;
    if (last.width <= 1 && last.height <= 1) break;
    out.push(halve(last));
  }
  return out;
}

/**
 * Resize to `w x h`: area average when shrinking, bilinear when growing. With `wrap` the edges wrap (tiles stay seamless).
 */
export function resize(img: FImage, w: number, h: number, wrap = false): FImage {
  if (img.width === w && img.height === h) return cloneImage(img);
  let src = img;
  // Shrink by halves while at least twice too big, then finish with bilinear.
  while (src.width >= w * 2 && src.height >= h * 2) src = halve(src);
  const out = newImage(w, h);
  const tmp = new Float32Array(3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = ((x + 0.5) * src.width) / w;
      const sy = ((y + 0.5) * src.height) / h;
      if (wrap) sampleWrap(src, sx, sy, tmp);
      else sampleBilinear(src, sx, sy, tmp);
      const o = (y * w + x) * 3;
      out.data[o] = tmp[0] as number;
      out.data[o + 1] = tmp[1] as number;
      out.data[o + 2] = tmp[2] as number;
    }
  }
  return out;
}

/** Bilinear sample with wrap-around edges. */
export function sampleWrap(img: FImage, x: number, y: number, out: Float32Array | number[]): void {
  const w = img.width;
  const h = img.height;
  const fx = x - 0.5;
  const fy = y - 0.5;
  const x0f = Math.floor(fx);
  const y0f = Math.floor(fy);
  const tx = fx - x0f;
  const ty = fy - y0f;
  const x0 = ((x0f % w) + w) % w;
  const y0 = ((y0f % h) + h) % h;
  const x1 = (x0 + 1) % w;
  const y1 = (y0 + 1) % h;
  const d = img.data;
  for (let c = 0; c < 3; c++) {
    const a = (d[(y0 * w + x0) * 3 + c] as number) * (1 - tx) + (d[(y0 * w + x1) * 3 + c] as number) * tx;
    const b = (d[(y1 * w + x0) * 3 + c] as number) * (1 - tx) + (d[(y1 * w + x1) * 3 + c] as number) * tx;
    out[c] = a * (1 - ty) + b * ty;
  }
}

/** One running-sum box blur pass over a single-channel plane (O(n), any radius). `wrap`: edges wrap, else clamp. */
function boxPass(src: Float32Array, dst: Float32Array, w: number, h: number, r: number, horizontal: boolean, wrap: boolean): void {
  const len = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const stride = horizontal ? 1 : w;
  const lineStride = horizontal ? w : 1;
  const inv = 1 / (2 * r + 1);
  const at = (i: number): number => (wrap ? ((i % len) + len) % len : i < 0 ? 0 : i >= len ? len - 1 : i);
  for (let l = 0; l < lines; l++) {
    const base = l * lineStride;
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[base + at(i) * stride] as number;
    for (let i = 0; i < len; i++) {
      dst[base + i * stride] = acc * inv;
      acc += (src[base + at(i + r + 1) * stride] as number) - (src[base + at(i - r) * stride] as number);
    }
  }
}

/** Gaussian-like blur of a plane (three box passes), radius from `sigma` in pixels. */
export function blurPlane(plane: Float32Array, w: number, h: number, sigma: number, wrap = false): Float32Array {
  if (!(sigma > 0.3)) return new Float32Array(plane);
  // Three box passes of width r*2+1 approximate a gaussian of variance 3 * ((2r+1)^2 - 1) / 12.
  const r = Math.max(1, Math.round((Math.sqrt((12 * sigma * sigma) / 3 + 1) - 1) / 2));
  const cap = Math.max(1, Math.floor((Math.min(w, h) - 1) / 2));
  const rr = wrap ? Math.min(r, cap) : r;
  let a: Float32Array = new Float32Array(plane);
  let b: Float32Array = new Float32Array(plane.length);
  for (let pass = 0; pass < 3; pass++) {
    boxPass(a, b, w, h, rr, true, wrap);
    boxPass(b, a, w, h, rr, false, wrap);
  }
  return a;
}

/** Blur all three channels of an image. */
export function blurImage(img: FImage, sigma: number, wrap = false): FImage {
  const n = img.width * img.height;
  const out = newImage(img.width, img.height);
  const plane = new Float32Array(n);
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < n; i++) plane[i] = img.data[i * 3 + c] as number;
    const b = blurPlane(plane, img.width, img.height, sigma, wrap);
    for (let i = 0; i < n; i++) out.data[i * 3 + c] = b[i] as number;
  }
  return out;
}

/** Deterministic generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
