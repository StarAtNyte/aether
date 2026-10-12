import { describe, expect, it } from 'vitest';
import { rng } from '@aether/core';
import { Noise } from '../src/noise';
import { hexToLinear, mixHex, normalizeHex, parseColor, rgbToHex, shadeHex } from '../src/color';

describe('Noise', () => {
  it('is deterministic for a seed and differs across seeds', () => {
    const a = new Noise(rng(42));
    const b = new Noise(rng(42));
    const c = new Noise(rng(43));
    let diff = 0;
    for (let i = 0; i < 200; i++) {
      const x = i * 0.37 - 20;
      const y = i * 0.91 + 3;
      expect(a.noise2(x, y)).toBe(b.noise2(x, y));
      expect(a.noise3(x, y, x * 0.5)).toBe(b.noise3(x, y, x * 0.5));
      diff += Math.abs(a.noise2(x, y) - c.noise2(x, y));
    }
    expect(diff).toBeGreaterThan(1);
  });

  it('stays within [-1, 1] and covers a wide range', () => {
    const n = new Noise(rng(7));
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 20000; i++) {
      const x = (i % 200) * 0.173 - 10;
      const y = Math.floor(i / 200) * 0.191 - 10;
      for (const v of [n.noise2(x, y), n.noise3(x, y, x - y), n.fbm2(x, y, 5)]) {
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
      const r = n.ridged2(x, y);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1.0001);
    }
    expect(min).toBeGreaterThanOrEqual(-1.0001);
    expect(max).toBeLessThanOrEqual(1.0001);
    expect(max - min).toBeGreaterThan(1.2);
  });

  it('is continuous (small steps give small changes)', () => {
    const n = new Noise(rng(3));
    for (let i = 0; i < 500; i++) {
      const x = i * 0.05;
      expect(Math.abs(n.noise2(x, 1.3) - n.noise2(x + 1e-4, 1.3))).toBeLessThan(5e-3);
    }
  });

  it('clamps hostile octave counts', () => {
    const n = new Noise(rng(1));
    expect(Number.isFinite(n.fbm2(1, 2, 1e9))).toBe(true);
    expect(Number.isFinite(n.fbm2(1, 2, Number.NaN))).toBe(true);
    expect(Number.isFinite(n.fbm2(1, 2, -5))).toBe(true);
  });

  it('is fast: 200k noise2 samples in < 100 ms', () => {
    const n = new Noise(rng(9));
    const t0 = performance.now();
    let s = 0;
    for (let i = 0; i < 200_000; i++) s += n.noise2(i * 0.013, i * 0.007);
    expect(Number.isFinite(s)).toBe(true);
    expect(performance.now() - t0).toBeLessThan(100);
  });
});

describe('colors', () => {
  it('normalizes hex, short hex and names', () => {
    expect(normalizeHex('#AABBCC')).toBe('#aabbcc');
    expect(normalizeHex('#abc')).toBe('#aabbcc');
    expect(normalizeHex('Red')).toBe('#e53935');
    expect(normalizeHex('dark green')).toBe('#1b5e20');
    expect(normalizeHex('nope')).toBeNull();
    expect(normalizeHex('__proto__')).toBeNull();
    expect(normalizeHex(123)).toBeNull();
    expect(normalizeHex('#'.padEnd(100, 'a'))).toBeNull();
  });

  it('parses, converts and mixes', () => {
    expect(parseColor('#ff0000')).toEqual([1, 0, 0]);
    expect(rgbToHex([1, 0.5, 0])).toBe('#ff8000');
    expect(rgbToHex([Number.NaN, 2, -1])).toBe('#00ff00');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#000000', '#ffffff', 5)).toBe('#ffffff');
    expect(shadeHex('#808080', -1)).toBe('#000000');
    const l = hexToLinear('#ffffff');
    expect(l).toEqual([1, 1, 1]);
    expect(() => mixHex('bad', '#ffffff', 0.5)).toThrow(TypeError);
  });
});
