/**
 * A photograph carries sensor noise and JPEG blocking, and a texture made from a small patch of it repeats that grain across a whole
 * wall or bedspread. Before a patch becomes a tile it is regularised: noise is measured, an edge-preserving filter smooths flat areas
 * (a weave, a wood grain and a crease edge survive; speckle and 8 x 8 block steps do not), small high-frequency detail under the noise
 * floor is cored out, and extreme ratios are clamped after the light is divided out.
 */
import { blurPlane, luminance, newImage, type FImage } from './raster';

/** Robust noise level of an image's luminance (standard deviation of the finest detail, by the median absolute deviation). */
export function noiseLevel(img: FImage): number {
  const { width: w, height: h } = img;
  const y = luminance(img);
  const d: number[] = [];
  for (let j = 1; j < h - 1; j += 1) {
    for (let i = 1; i < w - 1; i += 1) {
      const k = j * w + i;
      // The Laplacian of flat or smoothly shaded areas is zero; what is left is noise (and edges, which the median ignores).
      d.push(Math.abs(4 * (y[k] as number) - (y[k - 1] as number) - (y[k + 1] as number) - (y[k - w] as number) - (y[k + w] as number)));
    }
  }
  if (d.length === 0) return 0;
  d.sort((a, b) => a - b);
  return ((d[Math.floor(d.length / 2)] as number) / 0.6745) / Math.sqrt(20);
}

/** Edge-preserving smoothing: each texel is the mean of its neighbours weighted by distance and by luminance difference. */
export function bilateral(img: FImage, opts: { radius?: number; sigmaS?: number; sigmaR: number }): FImage {
  const { width: w, height: h } = img;
  const r = opts.radius ?? 3;
  const ss = opts.sigmaS ?? r * 0.7;
  const sr = Math.max(1e-6, opts.sigmaR);
  const y = luminance(img);
  const out = newImage(w, h);
  const spatial: number[] = [];
  for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) spatial.push(Math.exp(-(di * di + dj * dj) / (2 * ss * ss)));
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      let sw = 0;
      let a = 0;
      let b = 0;
      let c = 0;
      let s = 0;
      for (let dj = -r; dj <= r; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj >= h) {
          s += 2 * r + 1;
          continue;
        }
        for (let di = -r; di <= r; di++, s++) {
          const ii = i + di;
          if (ii < 0 || ii >= w) continue;
          const q = jj * w + ii;
          const dy = (y[q] as number) - (y[k] as number);
          const wt = (spatial[s] as number) * Math.exp(-(dy * dy) / (2 * sr * sr));
          sw += wt;
          a += wt * (img.data[q * 3] as number);
          b += wt * (img.data[q * 3 + 1] as number);
          c += wt * (img.data[q * 3 + 2] as number);
        }
      }
      out.data[k * 3] = a / sw;
      out.data[k * 3 + 1] = b / sw;
      out.data[k * 3 + 2] = c / sw;
    }
  }
  return out;
}

/** Shrink fine detail (the part a small blur takes off) that is under `floor` towards zero: noise goes, real texture above it stays. */
export function coreDetail(img: FImage, floor: number, sigma = 1.1): FImage {
  const { width: w, height: h } = img;
  const n = w * h;
  const out = newImage(w, h);
  const plane = new Float32Array(n);
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < n; i++) plane[i] = img.data[i * 3 + c] as number;
    const low = blurPlane(plane, w, h, sigma);
    for (let i = 0; i < n; i++) {
      const d = (plane[i] as number) - (low[i] as number);
      const m = Math.max(0, Math.abs(d) - floor);
      out.data[i * 3 + c] = (low[i] as number) + Math.sign(d) * m;
    }
  }
  return out;
}

/** Regularise a photographed patch: bilateral filter tuned to its measured noise, then coring of what is left under the noise floor. */
export function denoisePatch(img: FImage): { image: FImage; noise: number } {
  const noise = noiseLevel(img);
  if (!(noise > 1e-5)) return { image: img, noise };
  const smooth = bilateral(img, { radius: 3, sigmaS: 2, sigmaR: Math.max(noise * 3, 0.004) });
  return { image: coreDetail(smooth, noise * 1.2), noise };
}

/** Clamp every channel of a ratio image (mean 1) to within `k` standard deviations of 1, so no speck or glare dominates a tile. */
export function clampRatio(img: FImage, k = 3): FImage {
  const n = img.width * img.height;
  const out = newImage(img.width, img.height);
  for (let c = 0; c < 3; c++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += ((img.data[i * 3 + c] as number) - 1) ** 2;
    const sd = Math.sqrt(s / Math.max(1, n));
    const lim = Math.max(0.02, k * sd);
    for (let i = 0; i < n; i++) out.data[i * 3 + c] = 1 + Math.max(-lim, Math.min(lim, (img.data[i * 3 + c] as number) - 1));
  }
  return out;
}
