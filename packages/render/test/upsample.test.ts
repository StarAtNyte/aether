import { describe, expect, it } from 'vitest';
import { halton, jitterOffset } from '../src/gpu/upsample';
import { lodBiasFor, MAX_LOD_BIAS, onTextureLodBias, setTextureLodBias, textureLodBias } from '../src/gpu/lod-bias';

describe('temporal upsampling jitter', () => {
  it('halton values lie in [0, 1) and differ between bases', () => {
    expect(halton(1, 2)).toBe(0.5);
    expect(halton(2, 2)).toBe(0.25);
    expect(halton(1, 3)).toBeCloseTo(1 / 3);
    for (let i = 1; i < 64; i++) {
      for (const b of [2, 3]) {
        const h = halton(i, b);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThan(1);
      }
    }
  });

  it('cycles through eight distinct sub-texel offsets centred on zero', () => {
    const seen = new Set<string>();
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < 8; i++) {
      const [x, y] = jitterOffset(i);
      expect(Math.abs(x)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(y)).toBeLessThanOrEqual(0.5);
      seen.add(`${x.toFixed(4)},${y.toFixed(4)}`);
      sx += x;
      sy += y;
    }
    expect(seen.size).toBe(8);
    expect(Math.abs(sx / 8)).toBeLessThan(0.1);
    expect(Math.abs(sy / 8)).toBeLessThan(0.1);
    expect(jitterOffset(8)).toEqual(jitterOffset(0));
  });
});

describe('texture level bias of a scaled scene pass', () => {
  it('is zero near the frame size and log2 of the scale below, limited', () => {
    expect(lodBiasFor(1)).toBe(0);
    expect(lodBiasFor(0.95)).toBe(0);
    expect(lodBiasFor(0.5)).toBeCloseTo(-1);
    expect(lodBiasFor(0.25)).toBeCloseTo(-2);
    expect(lodBiasFor(0.1)).toBe(-MAX_LOD_BIAS);
    expect(lodBiasFor(Number.NaN)).toBe(0);
  });

  it('holds only values it can use', () => {
    setTextureLodBias(-1.5);
    expect(textureLodBias()).toBe(-1.5);
    setTextureLodBias(3);
    expect(textureLodBias()).toBe(0);
    setTextureLodBias(-9);
    expect(textureLodBias()).toBe(-MAX_LOD_BIAS);
    setTextureLodBias(Number.NaN);
    expect(textureLodBias()).toBe(0);
  });

  it('turns off with __AETHER_LOD_BIAS = false and reaches listeners', () => {
    const seen: number[] = [];
    onTextureLodBias((b) => seen.push(b));
    setTextureLodBias(-0.5);
    expect(seen[seen.length - 1]).toBe(-0.5);
    (globalThis as { __AETHER_LOD_BIAS?: boolean }).__AETHER_LOD_BIAS = false;
    setTextureLodBias(-0.5);
    expect(textureLodBias()).toBe(0);
    delete (globalThis as { __AETHER_LOD_BIAS?: boolean }).__AETHER_LOD_BIAS;
    setTextureLodBias(0);
  });
});
