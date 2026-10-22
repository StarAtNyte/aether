/**
 * From a rectified surface to one clean square of it: reject what is not the surface (objects the description's boxes missed),
 * find the largest well-covered square, and fill its remaining holes with the surface's own texture.
 */
import { blurPlane, cloneImage, luminance, newImage, rng, type FImage } from './raster';

/** A square of an image. */
export interface Square {
  x: number;
  y: number;
  size: number;
  /** Share of its texels that are valid. */
  fill: number;
}

/** Crop a square (or any rectangle) of an image and its mask. */
export function crop(img: FImage, valid: Uint8Array, x: number, y: number, w: number, h: number): { image: FImage; valid: Uint8Array } {
  const out = newImage(w, h);
  const v = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const s = (y + j) * img.width + (x + i);
      const d = j * w + i;
      out.data[d * 3] = img.data[s * 3] as number;
      out.data[d * 3 + 1] = img.data[s * 3 + 1] as number;
      out.data[d * 3 + 2] = img.data[s * 3 + 2] as number;
      v[d] = valid[s] as number;
    }
  }
  return { image: out, valid: v };
}

/** Dilate the zeros of a mask by `r` texels (4-neighbourhood passes). */
export function erodeValid(valid: Uint8Array, w: number, h: number, r: number): Uint8Array {
  let cur = valid;
  for (let pass = 0; pass < r; pass++) {
    const next = new Uint8Array(cur);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!cur[i]) continue;
        if ((x > 0 && !cur[i - 1]) || (x < w - 1 && !cur[i + 1]) || (y > 0 && !cur[i - w]) || (y < h - 1 && !cur[i + w])) next[i] = 0;
      }
    }
    cur = next;
  }
  return cur;
}

/**
 * Drop texels that differ from the surface's typical look: after the large-scale light is divided out, a texel whose colour is far
 * (in log ratio, relative to the spread of the rest) from the median is an object, a shadow edge or a highlight.
 * Returns a new mask; the input is untouched.
 */
export function rejectOutliers(img: FImage, valid: Uint8Array, strength = 3.4): Uint8Array {
  const { width: w, height: h } = img;
  const n = w * h;
  const lum = luminance(img);
  const m = new Float32Array(n);
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (valid[i]) {
      m[i] = 1;
      count++;
    }
  }
  if (count < 64) return new Uint8Array(valid);
  const sigma = Math.max(3, Math.min(w, h) / 10);
  const lumM = new Float32Array(n);
  for (let i = 0; i < n; i++) lumM[i] = (lum[i] as number) * (m[i] as number);
  const num = blurPlane(lumM, w, h, sigma);
  const den = blurPlane(m, w, h, sigma);
  const rel = new Float32Array(n);
  const chroma = new Float32Array(n);
  const samples: number[] = [];
  const csamples: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!valid[i]) continue;
    const low = (den[i] as number) > 0.02 ? (num[i] as number) / (den[i] as number) : (lum[i] as number);
    rel[i] = Math.log(Math.max(1e-4, lum[i] as number) / Math.max(1e-4, low));
    const r = img.data[i * 3] as number;
    const g = img.data[i * 3 + 1] as number;
    const b = img.data[i * 3 + 2] as number;
    const s = r + g + b + 1e-5;
    chroma[i] = Math.hypot(r / s - 1 / 3, g / s - 1 / 3, b / s - 1 / 3);
    if (i % 3 === 0) {
      samples.push(rel[i] as number);
      csamples.push(chroma[i] as number);
    }
  }
  const median = (a: number[]): number => {
    const s = [...a].sort((p, q) => p - q);
    return s[Math.floor(s.length / 2)] as number;
  };
  const med = median(samples);
  const mad = Math.max(0.03, median(samples.map((v) => Math.abs(v - med))) * 1.4826);
  // Chroma of the region as a whole (its mean colour is what the surface is); objects of another colour stand out.
  const cmed = median(csamples);
  const cmad = Math.max(0.01, median(csamples.map((v) => Math.abs(v - cmed))) * 1.4826);
  const out = new Uint8Array(valid);
  for (let i = 0; i < n; i++) {
    if (!valid[i]) continue;
    if (Math.abs((rel[i] as number) - med) > strength * mad + 0.12 || Math.abs((chroma[i] as number) - cmed) > strength * cmad + 0.05) out[i] = 0;
  }
  // Grow the rejected areas so their soft edges go too.
  return erodeValid(out, w, h, 2);
}

/**
 * The largest square with at least `minFill` of its texels valid, no smaller than `minSize`. Searches sizes from the largest
 * possible downwards and, at each size, every placement on a coarse grid; the best-covered placement of the first size that works
 * wins. Null when even the smallest square is too empty.
 */
export function bestSquare(valid: Uint8Array, w: number, h: number, minSize: number, minFill = 0.93, maxSize = Math.min(w, h)): Square | null {
  // Integral image of the mask.
  const iw = w + 1;
  const sat = new Int32Array(iw * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += valid[y * w + x] as number;
      sat[(y + 1) * iw + x + 1] = (sat[y * iw + x + 1] as number) + row;
    }
  }
  const sum = (x: number, y: number, s: number): number => (sat[(y + s) * iw + x + s] as number) - (sat[y * iw + x + s] as number) - (sat[(y + s) * iw + x] as number) + (sat[y * iw + x] as number);
  for (let s = Math.min(maxSize, w, h); s >= minSize; s = Math.floor(s * 0.93) === s ? s - 1 : Math.floor(s * 0.93)) {
    const stride = Math.max(1, Math.floor(s / 14));
    let best: Square | null = null;
    for (let y = 0; y + s <= h; y += stride) {
      for (let x = 0; x + s <= w; x += stride) {
        const fill = sum(x, y, s) / (s * s);
        if (fill >= minFill && (!best || fill > best.fill)) best = { x, y, size: s, fill };
      }
    }
    if (best) return best;
  }
  return null;
}

/**
 * Fill the invalid texels of a square: smooth colour from the valid ones around (a push-pull pyramid), then the fine texture of
 * valid texels nearby copied on top, so a patch does not read as a blur. Deterministic. Returns a filled copy.
 */
export function fillHoles(img: FImage, valid: Uint8Array, seed = 7): FImage {
  const { width: w, height: h } = img;
  const n = w * h;
  let holes = 0;
  for (let i = 0; i < n; i++) if (!valid[i]) holes++;
  if (holes === 0) return cloneImage(img);
  if (holes === n) return cloneImage(img);
  // Push-pull: weighted averages down a pyramid, then back up filling the unknowns.
  type Level = { w: number; h: number; c: Float32Array; a: Float32Array };
  const levels: Level[] = [];
  const base: Level = { w, h, c: new Float32Array(n * 3), a: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    if (valid[i]) {
      base.a[i] = 1;
      for (let k = 0; k < 3; k++) base.c[i * 3 + k] = img.data[i * 3 + k] as number;
    }
  }
  levels.push(base);
  while ((levels[levels.length - 1] as Level).w > 1 || (levels[levels.length - 1] as Level).h > 1) {
    const p = levels[levels.length - 1] as Level;
    const lw = Math.max(1, p.w >> 1);
    const lh = Math.max(1, p.h >> 1);
    const l: Level = { w: lw, h: lh, c: new Float32Array(lw * lh * 3), a: new Float32Array(lw * lh) };
    for (let y = 0; y < lh; y++) {
      for (let x = 0; x < lw; x++) {
        let a = 0;
        const c = [0, 0, 0];
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const sx = Math.min(p.w - 1, x * 2 + dx);
            const sy = Math.min(p.h - 1, y * 2 + dy);
            const s = sy * p.w + sx;
            const wt = p.a[s] as number;
            a += wt;
            for (let k = 0; k < 3; k++) c[k] = (c[k] as number) + (p.c[s * 3 + k] as number) * wt;
          }
        }
        const o = y * lw + x;
        if (a > 0) {
          for (let k = 0; k < 3; k++) l.c[o * 3 + k] = (c[k] as number) / a;
          l.a[o] = Math.min(1, a / 4);
        }
      }
    }
    levels.push(l);
  }
  for (let li = levels.length - 2; li >= 0; li--) {
    const f = levels[li] as Level;
    const coarse = levels[li + 1] as Level;
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        const i = y * f.w + x;
        const a = f.a[i] as number;
        if (a >= 1) continue;
        const cx = Math.min(coarse.w - 1, x >> 1);
        const cy = Math.min(coarse.h - 1, y >> 1);
        const ci = cy * coarse.w + cx;
        for (let k = 0; k < 3; k++) f.c[i * 3 + k] = (f.c[i * 3 + k] as number) * a + (coarse.c[ci * 3 + k] as number) * (1 - a);
        f.a[i] = 1;
      }
    }
  }
  const smooth = new Float32Array(base.c);
  // Fine texture: residual of valid texels over their own local mean, copied from random valid neighbours.
  const blurred = newImage(w, h);
  const plane = new Float32Array(n);
  for (let k = 0; k < 3; k++) {
    for (let i = 0; i < n; i++) plane[i] = smooth[i * 3 + k] as number;
    const b = blurPlane(plane, w, h, 3);
    for (let i = 0; i < n; i++) blurred.data[i * 3 + k] = b[i] as number;
  }
  const validIdx: number[] = [];
  for (let i = 0; i < n; i++) if (valid[i]) validIdx.push(i);
  const rand = rng(seed);
  const out = cloneImage(img);
  for (let i = 0; i < n; i++) {
    if (valid[i]) continue;
    const j = validIdx[Math.floor(rand() * validIdx.length)] as number;
    for (let k = 0; k < 3; k++) {
      // The residual of a valid texel over the smooth field at its place, as a ratio so dark and bright areas scale it alike.
      const res = (img.data[j * 3 + k] as number) / Math.max(1e-4, blurred.data[j * 3 + k] as number);
      out.data[i * 3 + k] = Math.max(0, (smooth[i * 3 + k] as number) * Math.min(2.5, Math.max(0.4, res)));
    }
  }
  return out;
}
