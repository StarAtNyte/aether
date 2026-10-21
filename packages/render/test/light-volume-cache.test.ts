import { describe, expect, it } from 'vitest';
import { hashWords, volumeKey } from '../src/environment/light-volume-cache';

const grid = { min: [0, 0, 0] as [number, number, number], spacing: 0.5, nx: 3, ny: 3, nz: 3 };

describe('light volume cache keys', () => {
  it('hash every byte, including an unaligned tail and a view into a larger buffer', () => {
    const a = new Float32Array([1, 2, 3, 4]);
    const b = new Float32Array([1, 2, 3, 4.0001]);
    expect(hashWords(a)).toBe(hashWords(new Float32Array([1, 2, 3, 4])));
    expect(hashWords(a)).not.toBe(hashWords(b));
    expect(hashWords(a)).toHaveLength(16);
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
    expect(hashWords(bytes)).not.toBe(hashWords(new Uint8Array([1, 2, 3, 4, 5, 6, 8])));
    const big = new Float32Array([9, 1, 2, 3, 4, 9]);
    expect(hashWords(big.subarray(1, 5))).toBe(hashWords(a));
    expect(hashWords(new Uint8Array(big.buffer, 5, 8))).toHaveLength(16);
  });

  it('changes with the triangles, the albedo, the sidedness, the grid and the lighting', () => {
    const arrays = () => ({ positions: new Float32Array(18).fill(1), albedo: new Float32Array(6).fill(0.5), twoSided: new Uint8Array(2) });
    const key = (a = arrays(), g = grid, s: unknown = [1]) => volumeKey(g, a, s);
    const base = key();
    expect(key()).toBe(base);
    const moved = arrays();
    moved.positions[7] = 1.5;
    expect(key(moved)).not.toBe(base);
    const tinted = arrays();
    tinted.albedo[0] = 0.6;
    expect(key(tinted)).not.toBe(base);
    const sided = arrays();
    sided.twoSided[1] = 1;
    expect(key(sided)).not.toBe(base);
    expect(key(arrays(), { ...grid, spacing: 0.55 })).not.toBe(base);
    expect(key(arrays(), grid, [2])).not.toBe(base);
  });
});
