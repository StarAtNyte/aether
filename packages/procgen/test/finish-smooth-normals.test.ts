import { describe, expect, it } from 'vitest';
import { finishPixels } from '../src/finish-pixels';

/** Tilt of the normal map along x, per texel, in [-1, 1]. */
function tiltX(normal: Uint8Array, n: number): Float32Array {
  const out = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) out[i] = ((normal[i * 4] as number) / 255) * 2 - 1;
  return out;
}

/** Standard deviation of the tilt after averaging in `b × b` blocks (the low-frequency part). */
function blockSpread(t: Float32Array, n: number, b: number): number {
  const means: number[] = [];
  for (let by = 0; by < n; by += b) {
    for (let bx = 0; bx < n; bx += b) {
      let sum = 0;
      for (let y = 0; y < b; y++) for (let x = 0; x < b; x++) sum += t[(by + y) * n + bx + x] as number;
      means.push(sum / (b * b));
    }
  }
  const mu = means.reduce((a, c) => a + c, 0) / means.length;
  return Math.sqrt(means.reduce((a, c) => a + (c - mu) ** 2, 0) / means.length);
}

describe('smooth finishes (paint, glaze) normal maps', () => {
  it('are dead flat: a quantised low-frequency relief would band and blotch under a close grazing light', () => {
    for (const id of ['paint', 'ceramic'] as const) {
      const n = 128;
      const { normal } = finishPixels(id, n);
      const t = tiltX(normal, n);
      // Every texel within one 8-bit step of the neutral normal (128 / 255 maps to -0.0039 .. 0).
      expect(Math.max(...t.map(Math.abs))).toBeLessThanOrEqual(0.01);
      expect(blockSpread(t, n, 16)).toBeLessThanOrEqual(0.005);
    }
  });
  it('the paint finish binds no normal map at all (no relief to alias)', async () => {
    const { FINISHES } = await import('@aether/arch');
    expect(FINISHES.paint.bump).toBe(0);
  });
});
