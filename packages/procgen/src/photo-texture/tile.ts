/**
 * Tiles: make a square of a photographed surface repeat without a seam, and make it larger than the square the photograph gave.
 *
 * - {@link seamless}: the offset trick with a contrast-preserving blend. The picture is also read shifted by half a period; near the
 *   borders the shifted copy (whose own seam is in the middle) is used, near the middle the original, and the weights are chosen so
 *   the pattern does not wash out where they mix.
 * - {@link quilt}: image quilting (Efros and Freeman): blocks of the exemplar are placed with a small overlap, each chosen to match
 *   what is already there and joined along the cheapest seam, giving a larger, non-repeating field from a small square.
 */
import { luminance, newImage, rng, type FImage } from './raster';

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** A seamless copy of a square image (ratios around 1; each channel keeps its mean). */
export function seamless(img: FImage): FImage {
  const { width: w, height: h } = img;
  const out = newImage(w, h);
  const mean = [0, 0, 0];
  for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) mean[c] = (mean[c] as number) + (img.data[i * 3 + c] as number) / (w * h);
  for (let y = 0; y < h; y++) {
    // 1 in the middle of the image, 0 on its borders (so the borders read the shifted copy).
    const wy = smoothstep(0, 0.5, 1 - Math.abs((2 * (y + 0.5)) / h - 1));
    for (let x = 0; x < w; x++) {
      const wx = smoothstep(0, 0.5, 1 - Math.abs((2 * (x + 0.5)) / w - 1));
      // The weight of the original is 1 only where both axes are central; separable and 0 at any border.
      const a = wx * wy;
      const sx = (x + (w >> 1)) % w;
      const sy = (y + (h >> 1)) % h;
      const norm = Math.sqrt(a * a + (1 - a) * (1 - a));
      for (let c = 0; c < 3; c++) {
        const p = img.data[(y * w + x) * 3 + c] as number;
        const q = img.data[(sy * w + sx) * 3 + c] as number;
        const m = mean[c] as number;
        out.data[(y * w + x) * 3 + c] = Math.max(0.01, (a * (p - m) + (1 - a) * (q - m)) / norm + m);
      }
    }
  }
  return out;
}

/** Minimum-cost vertical path through a cost grid (rows x cols); returns the column of the path in each row. */
function minCutVertical(cost: Float32Array, rows: number, cols: number): Int32Array {
  const acc = new Float32Array(cost);
  for (let y = 1; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let best = acc[(y - 1) * cols + x] as number;
      if (x > 0) best = Math.min(best, acc[(y - 1) * cols + x - 1] as number);
      if (x < cols - 1) best = Math.min(best, acc[(y - 1) * cols + x + 1] as number);
      acc[y * cols + x] = (acc[y * cols + x] as number) + best;
    }
  }
  const path = new Int32Array(rows);
  let x = 0;
  for (let i = 1; i < cols; i++) if ((acc[(rows - 1) * cols + i] as number) < (acc[(rows - 1) * cols + x] as number)) x = i;
  path[rows - 1] = x;
  for (let y = rows - 2; y >= 0; y--) {
    let bx = x;
    for (const nx of [x - 1, x, x + 1]) if (nx >= 0 && nx < cols && (acc[y * cols + nx] as number) < (acc[y * cols + bx] as number)) bx = nx;
    x = bx;
    path[y] = x;
  }
  return path;
}

/**
 * A `size x size` field quilted from `src` (blocks of about a quarter of its side, overlap a sixth of a block). The result is not
 * seamless by itself: pass it through {@link seamless}. Deterministic for a seed.
 */
export function quilt(src: FImage, size: number, seed = 11): FImage {
  const bs = Math.max(16, Math.min(Math.floor(Math.min(src.width, src.height) * 0.45), 96));
  const ov = Math.max(4, Math.round(bs / 6));
  const step = bs - ov;
  const out = newImage(size, size);
  const rand = rng(seed);
  const lumSrc = luminance(src);
  const maxX = src.width - bs;
  const maxY = src.height - bs;
  if (maxX < 1 || maxY < 1) return out;
  const tries = 40;
  const filled = new Uint8Array(size * size);
  for (let by = 0; by * step < size; by++) {
    for (let bx = 0; bx * step < size; bx++) {
      const ox = bx * step;
      const oy = by * step;
      // Choose the block whose overlap with what is already placed matches best.
      let bestX = Math.floor(rand() * maxX);
      let bestY = Math.floor(rand() * maxY);
      if (bx > 0 || by > 0) {
        let bestErr = Infinity;
        for (let t = 0; t < tries; t++) {
          const sx = Math.floor(rand() * maxX);
          const sy = Math.floor(rand() * maxY);
          let err = 0;
          let cnt = 0;
          for (let j = 0; j < bs; j += 2) {
            for (let i = 0; i < bs; i += 2) {
              const X = ox + i;
              const Y = oy + j;
              if (X >= size || Y >= size || !filled[Y * size + X]) continue;
              const s = (sy + j) * src.width + sx + i;
              const d = (Y * size + X) * 3;
              for (let c = 0; c < 3; c++) {
                const e = (src.data[s * 3 + c] as number) - (out.data[d + c] as number);
                err += e * e;
              }
              cnt++;
            }
          }
          const e = cnt > 0 ? err / cnt : 0;
          if (e < bestErr) {
            bestErr = e;
            bestX = sx;
            bestY = sy;
          }
        }
      }
      // Seams: a vertical cut in the left overlap and a horizontal cut in the top overlap.
      const keepMask = new Uint8Array(bs * bs).fill(1);
      if (bx > 0) {
        const cost = new Float32Array(bs * ov);
        for (let j = 0; j < bs; j++) {
          for (let i = 0; i < ov; i++) {
            const X = ox + i;
            const Y = oy + j;
            if (X >= size || Y >= size || !filled[Y * size + X]) continue;
            const s = (bestY + j) * src.width + bestX + i;
            const d = (Y * size + X) * 3;
            let e = 0;
            for (let c = 0; c < 3; c++) e += ((src.data[s * 3 + c] as number) - (out.data[d + c] as number)) ** 2;
            cost[j * ov + i] = e;
          }
        }
        const path = minCutVertical(cost, bs, ov);
        for (let j = 0; j < bs; j++) for (let i = 0; i < (path[j] as number); i++) keepMask[j * bs + i] = 0;
      }
      if (by > 0) {
        // Transposed problem for the top overlap.
        const cost = new Float32Array(bs * ov);
        for (let i = 0; i < bs; i++) {
          for (let j = 0; j < ov; j++) {
            const X = ox + i;
            const Y = oy + j;
            if (X >= size || Y >= size || !filled[Y * size + X]) continue;
            const s = (bestY + j) * src.width + bestX + i;
            const d = (Y * size + X) * 3;
            let e = 0;
            for (let c = 0; c < 3; c++) e += ((src.data[s * 3 + c] as number) - (out.data[d + c] as number)) ** 2;
            cost[i * ov + j] = e;
          }
        }
        const path = minCutVertical(cost, bs, ov);
        for (let i = 0; i < bs; i++) for (let j = 0; j < (path[i] as number); j++) keepMask[j * bs + i] = 0;
      }
      for (let j = 0; j < bs; j++) {
        for (let i = 0; i < bs; i++) {
          const X = ox + i;
          const Y = oy + j;
          if (X >= size || Y >= size) continue;
          const d = Y * size + X;
          if (filled[d] && !keepMask[j * bs + i]) continue;
          const s = (bestY + j) * src.width + bestX + i;
          out.data[d * 3] = src.data[s * 3] as number;
          out.data[d * 3 + 1] = src.data[s * 3 + 1] as number;
          out.data[d * 3 + 2] = src.data[s * 3 + 2] as number;
          filled[d] = 1;
        }
      }
    }
  }
  void lumSrc;
  return out;
}
