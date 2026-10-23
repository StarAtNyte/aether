import { describe, expect, it } from 'vitest';
import { NOISE_PERIOD, NOISE_SIZE, NOISE_STD, noisePixels, tileableGradientNoise } from '../src/materials/noise-texture';

describe('noise texture', () => {
  const px = noisePixels();

  it('has the spread of the 3D gradient noise it replaces, centred on 0.5', () => {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      let sq = 0;
      const n = NOISE_SIZE * NOISE_SIZE;
      for (let i = 0; i < n; i++) {
        const v = ((px[i * 4 + c] as number) / 255 - 0.5) * 2;
        sum += v;
        sq += v * v;
      }
      const mean = sum / n;
      const std = Math.sqrt(sq / n - mean * mean);
      expect(Math.abs(mean)).toBeLessThan(0.03);
      expect(std).toBeGreaterThan(NOISE_STD * 0.95);
      expect(std).toBeLessThan(NOISE_STD * 1.05);
    }
  });

  it('tiles without a seam (the edge texels continue into the opposite edge)', () => {
    const f = tileableGradientNoise(NOISE_SIZE, NOISE_PERIOD, 5);
    let step = 0;
    let seam = 0;
    for (let y = 0; y < NOISE_SIZE; y++) {
      step += Math.abs((f[y * NOISE_SIZE + 1] as number) - (f[y * NOISE_SIZE] as number));
      seam += Math.abs((f[y * NOISE_SIZE] as number) - (f[y * NOISE_SIZE + NOISE_SIZE - 1] as number));
    }
    expect(seam / NOISE_SIZE).toBeLessThan((step / NOISE_SIZE) * 2);
  });

  it('keeps its three fields independent', () => {
    let dot = 0;
    for (let i = 0; i < NOISE_SIZE * NOISE_SIZE; i++) dot += (((px[i * 4] as number) - 127.5) * ((px[i * 4 + 1] as number) - 127.5)) / (127.5 * 127.5);
    expect(Math.abs(dot / (NOISE_SIZE * NOISE_SIZE))).toBeLessThan(0.02);
  });
});
