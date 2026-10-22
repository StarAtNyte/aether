/**
 * Take the light out of a photographed surface: the picture shows albedo times illumination, and the room's own lights will light the
 * result again. The slow gradient (a window's falloff, a lamp's pool, a shadow of the bed) is divided out per channel; the pattern
 * that remains is the surface itself, as ratios around 1 of its mean colour.
 */
import { blurPlane, newImage, type FImage } from './raster';

/** Result of {@link delight}. */
export interface Delit {
  /** Ratios around 1 (per channel mean 1). */
  ratio: FImage;
  /** The mean colour the surface had in the picture (linear): the colour the ratios multiply. */
  mean: [number, number, number];
  /** Standard deviation of the luminance ratio: how much pattern there is (0 = flat paint). */
  contrast: number;
}

/**
 * Flatten the large-scale lighting of `img` (every texel valid, or give `valid`). `sigma` is the size, in texels, of the
 * smallest variation still counted as lighting (default a third of the image).
 */
export function delight(img: FImage, opts: { valid?: Uint8Array; sigma?: number; keepShading?: number } = {}): Delit {
  const { width: w, height: h } = img;
  const n = w * h;
  const sigma = opts.sigma ?? Math.max(4, Math.min(w, h) / 3);
  const keep = Math.max(0, Math.min(1, opts.keepShading ?? 0));
  const mask = new Float32Array(n);
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (!opts.valid || opts.valid[i]) {
      mask[i] = 1;
      count++;
    }
  }
  // A linear ramp across the whole picture (a window on one side) cannot be blurred away at the edges: fit and divide it out first.
  const work = new Float32Array(img.data);
  if (count > 16) {
    for (let c = 0; c < 3; c++) {
      // Least squares of v = a + b x + c y over the valid texels (x, y in -0.5..0.5).
      let sw = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sv = 0, svx = 0, svy = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (!mask[i]) continue;
          const px = x / w - 0.5;
          const py = y / h - 0.5;
          const v = img.data[i * 3 + c] as number;
          sw++; sx += px; sy += py; sxx += px * px; syy += py * py; sxy += px * py; sv += v; svx += v * px; svy += v * py;
        }
      }
      // Solve the 3x3 normal equations.
      const A = [[sw, sx, sy], [sx, sxx, sxy], [sy, sxy, syy]];
      const B = [sv, svx, svy];
      const det = (m: number[][]): number => (m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!)) - (m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!)) + (m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!));
      const D = det(A);
      if (Math.abs(D) < 1e-9) continue;
      const col = (k: number): number => det(A.map((row, r) => row.map((v, cc) => (cc === k ? (B[r] as number) : v))));
      const a = col(0) / D;
      const b = col(1) / D;
      const cy = col(2) / D;
      const m0 = sv / sw;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const fit = Math.max(0.3 * m0, a + b * (x / w - 0.5) + cy * (y / h - 0.5));
        work[(y * w + x) * 3 + c] = ((img.data[(y * w + x) * 3 + c] as number) * m0) / Math.max(1e-4, fit);
      }
    }
  }
  const den = blurPlane(mask, w, h, sigma);
  const mean: [number, number, number] = [0, 0, 0];
  const low: Float32Array[] = [];
  const plane = new Float32Array(n);
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < n; i++) {
      plane[i] = (work[i * 3 + c] as number) * (mask[i] as number);
      mean[c] = (mean[c] as number) + (plane[i] as number);
    }
    mean[c] = count > 0 ? (mean[c] as number) / count : 0;
    const num = blurPlane(plane, w, h, sigma);
    const l = new Float32Array(n);
    for (let i = 0; i < n; i++) l[i] = (den[i] as number) > 0.02 ? (num[i] as number) / (den[i] as number) : (mean[c] as number);
    low.push(l);
  }
  const ratio = newImage(w, h);
  let sum = 0;
  let sum2 = 0;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const m = Math.max(1e-4, mean[c] as number);
      const l = Math.max(1e-4, low[c]![i] as number);
      // The gradient is divided out; `keep` leaves a share of it (soft fabrics keep their folds' shading).
      const gain = (m / l) ** (1 - keep);
      let r = ((work[i * 3 + c] as number) / m) * gain;
      // Highlights and deep shadow are lighting too: compress them softly.
      if (r > 1.6) r = 1.6 + (r - 1.6) * 0.35;
      if (r < 0.35) r = 0.35 - (0.35 - r) * 0.5;
      ratio.data[i * 3 + c] = Math.max(0.02, Math.min(3.2, r));
    }
    if (mask[i]) {
      const l = 0.2126 * (ratio.data[i * 3] as number) + 0.7152 * (ratio.data[i * 3 + 1] as number) + 0.0722 * (ratio.data[i * 3 + 2] as number);
      sum += l;
      sum2 += l * l;
    }
  }
  // Re-centre each channel on 1 over the valid texels (the compression above moves the mean a little).
  for (let c = 0; c < 3; c++) {
    let s = 0;
    for (let i = 0; i < n; i++) if (mask[i]) s += ratio.data[i * 3 + c] as number;
    const k = count > 0 && s > 0 ? count / s : 1;
    for (let i = 0; i < n; i++) ratio.data[i * 3 + c] = (ratio.data[i * 3 + c] as number) * k;
  }
  const mu = count > 0 ? sum / count : 1;
  const contrast = count > 0 ? Math.sqrt(Math.max(0, sum2 / count - mu * mu)) / Math.max(1e-3, mu) : 0;
  return { ratio, mean, contrast };
}
