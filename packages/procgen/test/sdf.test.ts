import { describe, expect, it } from 'vitest';
import type { GeneratorDef } from '@aether/core';
import { VertexBudget, type Mesh } from '../src/kernel/mesh';
import { compileSdf, meshSdf, sdfMesh, SDF_LIMITS } from '../src/kernel/sdf';
import { createNodeSandbox } from '../src/node';
import { compileGenerator, runCompiled } from '../src/sandbox/runner';
import { expectUnitNormals, signedVolume, windingMismatch } from './helpers';

const budget = (): VertexBudget => new VertexBudget(10_000_000);

function area(m: Mesh): number {
  const p = m.positions, idx = m.indices;
  let a = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const i = (idx[t] as number) * 3, j = (idx[t + 1] as number) * 3, k = (idx[t + 2] as number) * 3;
    const ux = (p[j] as number) - (p[i] as number), uy = (p[j + 1] as number) - (p[i + 1] as number), uz = (p[j + 2] as number) - (p[i + 2] as number);
    const vx = (p[k] as number) - (p[i] as number), vy = (p[k + 1] as number) - (p[i + 1] as number), vz = (p[k + 2] as number) - (p[i + 2] as number);
    a += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return a;
}

/** Every edge is shared by exactly two triangles, once in each direction (closed, consistently wound). */
function isClosed(m: Mesh): boolean {
  const edges = new Map<string, number>();
  const idx = m.indices;
  for (let t = 0; t < idx.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = idx[t + e] as number, b = idx[t + ((e + 1) % 3)] as number;
      const key = `${a},${b}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  for (const [key, n] of edges) {
    const [a, b] = key.split(',');
    if (n !== 1 || edges.get(`${b},${a}`) !== 1) return false;
  }
  return true;
}

describe('sdf mesher', () => {
  it('meshes a sphere as a closed, outward, accurate surface', () => {
    const m = sdfMesh(budget(), { shape: 'sphere', r: 1 }, { resolution: 48 });
    expect(m.triangleCount).toBeGreaterThan(1000);
    expect(isClosed(m)).toBe(true);
    expect(signedVolume(m)).toBeGreaterThan(0);
    expect(signedVolume(m) / ((4 / 3) * Math.PI)).toBeCloseTo(1, 1);
    expect(area(m) / (4 * Math.PI)).toBeCloseTo(1, 1);
    expectUnitNormals(m.normals);
    expect(windingMismatch(m.positions, m.normals, m.indices)).toBe(0);
    // normals point away from the centre, vertices sit on the surface
    const p = m.positions, n = m.normals;
    for (let i = 0; i < p.length; i += 3) {
      const r = Math.hypot(p[i] as number, p[i + 1] as number, p[i + 2] as number);
      expect(Math.abs(r - 1)).toBeLessThan(0.01);
      expect(((p[i] as number) * (n[i] as number) + (p[i + 1] as number) * (n[i + 1] as number) + (p[i + 2] as number) * (n[i + 2] as number)) / r).toBeGreaterThan(0.98);
    }
  });

  it('follows the cell size and caps triangles by coarsening', () => {
    const coarse = sdfMesh(budget(), { shape: 'sphere', r: 1 }, { cell: 0.1 });
    const fine = sdfMesh(budget(), { shape: 'sphere', r: 1 }, { cell: 0.05 });
    expect(fine.triangleCount / coarse.triangleCount).toBeGreaterThan(3);
    const capped = meshSdf(budget(), (x, y, z) => Math.hypot(x, y, z) - 1, [-1, -1, -1], [1, 1, 1], { cell: 0.01, maxTriangles: 5000 });
    expect(capped.triangleCount).toBeLessThanOrEqual(5000);
    expect(capped.triangleCount).toBeGreaterThan(1000);
    expect(isClosed(capped)).toBe(true);
  });

  it('adds the detail function to the distance', () => {
    const plain = sdfMesh(budget(), { shape: 'sphere', r: 1 }, { resolution: 32 });
    const grown = sdfMesh(budget(), { shape: 'sphere', r: 1 }, { resolution: 32, detail: () => -0.2 });
    expect(grown.bounds().max[1]).toBeCloseTo(1.2, 1);
    expect(plain.bounds().max[1]).toBeCloseTo(1, 1);
    expect(() => sdfMesh(budget(), { shape: 'sphere', r: 1 }, { detail: () => NaN })).toThrow(/finite/);
  });

  it('returns an empty mesh when there is no surface in the bounds', () => {
    const m = sdfMesh(budget(), { shape: 'sphere', r: 1 }, { min: [5, 5, 5], max: [6, 6, 6] });
    expect(m.triangleCount).toBe(0);
  });
});

describe('sdf tree compiler', () => {
  it('evaluates shapes, booleans and transforms', () => {
    const f = (tree: unknown, x: number, y: number, z: number): number => compileSdf(tree).f(x, y, z);
    const a = { shape: 'sphere', r: 1 };
    const b = { shape: 'sphere', r: 1, at: [1.5, 0, 0] };
    expect(f({ op: 'union', items: [a, b] }, 1.5, 0, 0)).toBeCloseTo(-1, 5);
    expect(f({ op: 'union', items: [a, b] }, -1, 0, 0)).toBeCloseTo(0, 5);
    // a smooth union fills the waist between the spheres
    expect(f({ op: 'union', items: [a, b], k: 0.5 }, 0.75, 0.7, 0)).toBeLessThan(f({ op: 'union', items: [a, b] }, 0.75, 0.7, 0));
    // subtract carves b out of a; intersect keeps the lens
    expect(f({ op: 'subtract', a, b }, 0.75, 0, 0)).toBeGreaterThan(0);
    expect(f({ op: 'subtract', a, b }, -0.5, 0, 0)).toBeLessThan(0);
    expect(f({ op: 'intersect', items: [a, b] }, 0.75, 0, 0)).toBeLessThan(0);
    expect(f({ op: 'intersect', items: [a, b] }, -0.5, 0, 0)).toBeGreaterThan(0);
    // rotation like MeshHandle.rotate (Euler XYZ degrees), scale multiplies distances
    const bar = { shape: 'box', size: [2, 0.2, 0.2], rot: [0, 0, 90], at: [0, 1, 0] };
    expect(f(bar, 0, 1.9, 0)).toBeLessThan(0);
    expect(f(bar, 0.9, 1, 0)).toBeGreaterThan(0);
    expect(f({ shape: 'sphere', r: 1, scale: 2 }, 3, 0, 0)).toBeCloseTo(1, 5);
    expect(f({ shape: 'cylinder', r: 0.5, h: 2 }, 0, 0.9, 0)).toBeLessThan(0);
    expect(f({ shape: 'torus', R: 1, r: 0.1 }, 1, 0, 0)).toBeCloseTo(-0.1, 5);
    expect(f({ shape: 'capsule', a: [0, 0, 0], b: [0, 1, 0], r: 0.1 }, 0.2, 0.5, 0)).toBeCloseTo(0.1, 5);
    expect(f({ shape: 'cone', a: [0, 0, 0], b: [0, 1, 0], ra: 0.3, rb: 0.1 }, 0, 1.2, 0)).toBeCloseTo(0.1, 3);
    expect(f({ shape: 'ellipsoid', r: [1, 2, 1] }, 0, 1.9, 0)).toBeLessThan(0);
  });

  it('computes conservative bounds through transforms and booleans', () => {
    const c = compileSdf({ op: 'union', items: [{ shape: 'sphere', r: 1 }, { shape: 'box', size: [1, 1, 1], at: [3, 0, 0], rot: [0, 45, 0] }] });
    expect(c.min[0]).toBeLessThanOrEqual(-1);
    expect(c.max[0]).toBeGreaterThanOrEqual(3 + Math.SQRT1_2 - 1e-9);
    const s = compileSdf({ op: 'subtract', a: { shape: 'sphere', r: 1 }, b: { shape: 'sphere', r: 5 } });
    expect(s.max[0]).toBe(1);
  });

  it('rejects malformed and oversized trees', () => {
    expect(() => compileSdf({ shape: 'teapot' })).toThrow(/unknown shape/);
    expect(() => compileSdf({ op: 'melt', items: [] })).toThrow(/unknown op/);
    expect(() => compileSdf({ shape: 'sphere' })).toThrow(/finite/);
    expect(() => compileSdf({ op: 'union', items: [] })).toThrow(/non-empty/);
    expect(() => compileSdf(null)).toThrow(/node object/);
    expect(() => compileSdf({ shape: 'figure', garment: 'toga' })).toThrow(/garment/);
    let deep: unknown = { shape: 'sphere', r: 1 };
    for (let i = 0; i < SDF_LIMITS.MAX_DEPTH; i++) deep = { op: 'union', items: [deep] };
    expect(() => compileSdf(deep)).toThrow(/deeper/);
    const many = { op: 'union', items: Array.from({ length: SDF_LIMITS.MAX_NODES }, () => ({ shape: 'sphere', r: 1 })) };
    expect(() => compileSdf(many)).toThrow(/at most/);
  });

  it('builds a deterministic standing figure about 2 m tall facing +Z', () => {
    const fig = { shape: 'figure', seed: 3 };
    const a = sdfMesh(budget(), fig, { resolution: 64 });
    const b = sdfMesh(budget(), fig, { resolution: 64 });
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    const bb = a.bounds();
    expect(bb.max[1]).toBeGreaterThan(1.85);
    expect(bb.max[1]).toBeLessThan(2.1);
    expect(bb.min[1]).toBeGreaterThan(-0.03);
    expect(windingMismatch(a.positions, a.normals, a.indices)).toBe(0);
    const c = compileSdf(fig);
    expect(c.f(0, 1.2, 0)).toBeLessThan(0); // the torso is solid
    expect(c.f(0, 1.2, 0.6)).toBeGreaterThan(0);
  });
});

describe('api.sdf through the sandboxes', () => {
  // A tree nested deeper than the membrane's per-level import depth: it must cross as one JSON value.
  const source = `
let tree = { shape: 'sphere', r: 0.5 };
for (let i = 0; i < 10; i++) tree = { op: 'union', k: 0.05, items: [tree, { shape: 'capsule', a: [0, 0, 0], b: [0, 0.3 + i * 0.05, 0], r: 0.1, at: [0.1 * i, 0, 0] }] };
const m = api.sdf({ op: 'subtract', a: tree, b: { shape: 'box', size: [0.4, 0.4, 0.4], at: [0, 0.5, 0], rot: [0, 30, 0] } },
  { resolution: 40, detail: (x, y, z) => 0.002 * api.noise3(x * 9, y * 9, z * 9) });
api.add(m, { finish: 'plaster', color: '#ece5d8' });
return api.build();`;
  const def: GeneratorDef = { id: 'sdf-gen', description: 'sdf test', params: {}, source };

  it('runs in the node:vm sandbox', async () => {
    const out = await createNodeSandbox().run(def, {}, 1);
    expect(out.stats.triangles).toBeGreaterThan(500);
    expect(out.bounds.min[1]).toBeCloseTo(0, 4);
    const p = out.parts[0];
    expect(p && windingMismatch(p.positions, p.normals, p.indices)).toBeLessThan(0.001);
  });

  it('runs in the worker sandbox core the same way', () => {
    const out = runCompiled(compileGenerator(source, Function), {}, 1);
    expect(out.stats.triangles).toBeGreaterThan(500);
  });

  it('reports bad trees as generator errors', async () => {
    const bad = { ...def, source: `api.add(api.sdf({ shape: 'blob' }), { color: '#ffffff' }); return api.build();` };
    await expect(createNodeSandbox().run(bad, {}, 1)).rejects.toThrow(/unknown shape/);
    const cyclic = { ...def, source: `const t = { op: 'union', items: [] }; t.items.push(t); api.sdf(t); return api.build();` };
    await expect(createNodeSandbox().run(cyclic, {}, 1)).rejects.toThrow(/plain JSON/);
  });
});
