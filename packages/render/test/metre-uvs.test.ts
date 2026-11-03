import { describe, expect, it } from 'vitest';
import { VertexBudget } from '../../procgen/src/kernel/mesh';
import { box, cylinder } from '../../procgen/src/kernel/primitives';
import { metreUvMesh } from '../src/geometry/metre-uvs';
import { partToBufferGeometry, SPLIT_SOURCE_KEY } from '../src/geometry/buffer-geometry';

/** Largest metres-per-UV-unit stretch over the triangles of a mesh (1 = true size). */
function worstStretch(p: Float32Array, t: Float32Array, idx: ArrayLike<number>): number {
  let worst = 1;
  for (let f = 0; f < idx.length; f += 3) {
    const a = idx[f]!, b = idx[f + 1]!, c = idx[f + 2]!;
    const e = (i: number, j: number): number => Math.hypot(p[j * 3]! - p[i * 3]!, p[j * 3 + 1]! - p[i * 3 + 1]!, p[j * 3 + 2]! - p[i * 3 + 2]!);
    const u = (i: number, j: number): number => Math.hypot(t[j * 2]! - t[i * 2]!, t[j * 2 + 1]! - t[i * 2 + 1]!);
    for (const [i, j] of [[a, b], [b, c], [c, a]] as const) {
      const r = e(i, j) / Math.max(1e-9, u(i, j));
      worst = Math.max(worst, r, 1 / r);
    }
  }
  return worst;
}

function arrays(m: { positions: Float32Array; normals: Float32Array; indices: Uint32Array; uvs: Float32Array }) {
  return { positions: m.positions, normals: m.normals, indices: m.indices, uvs: m.uvs };
}

describe('metre UVs', () => {
  it('rescales a long box whose faces span 0..1 to true size, sharing its streams', () => {
    const m = box(new VertexBudget(1e6), 30, 1, 2);
    const src = arrays(m);
    expect(worstStretch(src.positions, src.uvs, src.indices)).toBeGreaterThan(10);
    const r = metreUvMesh(src);
    expect(r.positions).toBe(src.positions);
    expect(r.projected).toBe(src.indices.length / 3);
    expect(worstStretch(r.positions, r.uvs, r.indices)).toBeLessThan(1.001);
  });

  it('keeps metric UVs as authored', () => {
    const m = box(new VertexBudget(1e6), 1, 1, 1);
    const src = arrays(m);
    const r = metreUvMesh(src);
    expect(r.uvs).toBe(src.uvs);
    expect(r.projected).toBe(0);
  });

  it('projects a tall column per facet, splitting corners where the plane turns, at no more than the facet slant', () => {
    const m = cylinder(new VertexBudget(1e6), 0.5, 0.5, 9, 16);
    const src = arrays(m);
    const r = metreUvMesh(src);
    expect(r.positions.length).toBeGreaterThan(src.positions.length);
    // A facet projected on the plane of its dominant axis is foreshortened by at most cos 45°.
    expect(worstStretch(r.positions, r.uvs, r.indices)).toBeLessThan(1.5);
    // v runs up the column as authored (bottom to top).
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < r.uvs.length / 2; i++) {
      lo = Math.min(lo, r.uvs[i * 2 + 1]!);
      hi = Math.max(hi, r.uvs[i * 2 + 1]!);
    }
    expect(hi - lo).toBeGreaterThan(8.9);
  });

  it('gives the geometry the split streams for consumers that pair them with its attributes', () => {
    const m = cylinder(new VertexBudget(1e6), 0.5, 0.5, 9, 16);
    const g = partToBufferGeometry({ positions: m.positions, normals: m.normals, indices: m.indices, uvs: m.uvs, material: { finish: 'stone' } } as never);
    const split = g.userData[SPLIT_SOURCE_KEY] as { positions: Float32Array; indices: Uint32Array };
    expect(split.positions.length / 3).toBe(g.getAttribute('position').count);
    expect(g.getAttribute('uv').count).toBe(g.getAttribute('position').count);
  });
});
