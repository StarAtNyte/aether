import { describe, expect, it } from 'vitest';
import { generateBuiltinSync } from '../src/index';
import { trimFlatTriangles } from '../src/generators/terrain';
import { Mesh, VertexBudget } from '../src/kernel/mesh';

describe('mountain foothills', () => {
  const out = generateBuiltinSync('mountain', { size: 80, height: 30, resolution: 64, groundColor: '#c8b27a' }, 7);
  const part = out.parts[0]!;

  it('has no flat plate: no triangle lies entirely on the ground', () => {
    const { positions, indices } = part;
    for (let i = 0; i < indices.length; i += 3) {
      const ys = [indices[i]!, indices[i + 1]!, indices[i + 2]!].map((v) => positions[v * 3 + 1]!);
      expect(Math.max(...ys)).toBeGreaterThan(0.05);
    }
    // Far fewer triangles than the full 64×64 grid.
    expect(indices.length / 3).toBeLessThan(64 * 64 * 2 * 0.8);
  });

  it('still stands on y = 0 with a full-grid heightfield collider', () => {
    expect(out.bounds.min[1]).toBeCloseTo(0, 6);
    const hf = out.colliders.find((c) => c.kind === 'heightfield');
    expect(hf).toBeDefined();
    if (hf?.kind === 'heightfield') {
      expect(hf.heights.length).toBe(65 * 65);
      expect(Math.min(...hf.heights)).toBe(0);
    }
  });

  it('paints the lowest slopes in the ground color', () => {
    const { positions, colors, indices } = part;
    expect(colors).toBeDefined();
    const used = new Set(indices);
    let best = -1;
    let bestY = Infinity;
    for (const v of used) {
      const y = positions[v * 3 + 1]!;
      if (y < bestY) {
        bestY = y;
        best = v;
      }
    }
    // #c8b27a in linear space ≈ (0.578, 0.445, 0.195): warm sand, not the default grass green.
    const r = colors![best * 3]!;
    const g = colors![best * 3 + 1]!;
    const b = colors![best * 3 + 2]!;
    expect(r).toBeGreaterThan(b * 1.8);
    expect(r).toBeGreaterThan(g * 0.9);
  });
});

describe('trimFlatTriangles', () => {
  const budget = (): VertexBudget => new VertexBudget(1000);
  const quad = (ys: number[]): Mesh =>
    new Mesh(
      new Float32Array([0, ys[0]!, 0, 1, ys[1]!, 0, 0, ys[2]!, 1, 1, ys[3]!, 1]),
      new Float32Array(12).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)),
      new Float32Array(8),
      new Uint32Array([0, 2, 1, 1, 2, 3]),
      null,
      budget(),
    );

  it('drops only all-flat triangles and keeps the vertices', () => {
    const m = quad([0, 0, 0, 2]);
    trimFlatTriangles(m, 0.01);
    expect(Array.from(m.indices)).toEqual([1, 2, 3]);
    expect(m.vertexCount).toBe(4);
  });

  it('never trims a completely flat mesh to nothing', () => {
    const m = quad([0, 0, 0, 0]);
    trimFlatTriangles(m, 0.01);
    expect(m.indices.length).toBe(6);
  });
});
