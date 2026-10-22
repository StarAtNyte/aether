import { describe, expect, it } from 'vitest';
import { clampRatio, denoisePatch, luminance, newImage, noiseLevel, rng } from '../src/photo-texture';

function step(n: number, seed: number, sigma: number) {
  const r = rng(seed);
  const img = newImage(n, n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) img.data[(j * n + i) * 3 + c] = (i < n / 2 ? 0.3 : 0.6) + sigma * (r() + r() + r() - 1.5) * 2;
  return img;
}
const sd = (a: Float32Array, x0: number, x1: number, n: number): number => {
  let s = 0, s2 = 0, k = 0;
  for (let j = 4; j < n - 4; j++) for (let i = x0; i < x1; i++) { const v = a[j * n + i] as number; s += v; s2 += v * v; k++; }
  return Math.sqrt(Math.max(0, s2 / k - (s / k) ** 2));
};

describe('photo patch denoise', () => {
  it('removes grain from flat areas and keeps the edge', () => {
    const n = 64;
    const img = step(n, 5, 0.03);
    const out = denoisePatch(img).image;
    const a = luminance(img), b = luminance(out);
    expect(sd(b, 6, 26, n)).toBeLessThan(sd(a, 6, 26, n) * 0.4);
    const mid = (b[(32 * n) + 40] as number) - (b[(32 * n) + 24] as number);
    expect(mid).toBeGreaterThan(0.25);
  });
  it('measures noise', () => {
    expect(noiseLevel(step(64, 3, 0.04))).toBeGreaterThan(noiseLevel(step(64, 3, 0.005)));
  });
  it('clamps a speck in a ratio image', () => {
    const img = newImage(32, 32);
    img.data.fill(1);
    img.data[100 * 3] = 6;
    expect(clampRatio(img, 3).data[100 * 3]).toBeLessThan(2);
  });
});
