import { describe, expect, it } from 'vitest';
import { isKitOfPieces } from '../src/virtual/virtual-mesh';

/** n separate axis boxes (12 triangles each, 8 shared corners). */
function boxes(n: number): { positions: Float32Array; indices: Uint32Array } {
  const positions = new Float32Array(n * 8 * 3);
  const indices = new Uint32Array(n * 36);
  const faces = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0];
  for (let b = 0; b < n; b++) {
    for (let v = 0; v < 8; v++) {
      positions.set([b * 2 + (v & 1 ? 0.2 : 0), v & 2 ? 0.2 : 0, v & 4 ? 0.2 : 0], (b * 8 + v) * 3);
    }
    for (let i = 0; i < 36; i++) indices[b * 36 + i] = b * 8 + (faces[i] as number);
  }
  return { positions, indices };
}

/** One continuous grid surface of (s × s) cells. */
function grid(s: number): { positions: Float32Array; indices: Uint32Array } {
  const positions = new Float32Array((s + 1) * (s + 1) * 3);
  const indices = new Uint32Array(s * s * 6);
  for (let z = 0; z <= s; z++) for (let x = 0; x <= s; x++) positions.set([x, Math.sin(x + z), z], (z * (s + 1) + x) * 3);
  let k = 0;
  for (let z = 0; z < s; z++) for (let x = 0; x < s; x++) {
    const a = z * (s + 1) + x;
    indices.set([a, a + s + 1, a + 1, a + 1, a + s + 1, a + s + 2], k);
    k += 6;
  }
  return { positions, indices };
}

describe('isKitOfPieces', () => {
  it('flags many small separate pieces and keeps a continuous surface virtual', () => {
    const k = boxes(2000);
    expect(isKitOfPieces(k.positions, k.indices)).toBe(true);
    const g = grid(150);
    expect(isKitOfPieces(g.positions, g.indices)).toBe(false);
  });
});
