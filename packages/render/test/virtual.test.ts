import { describe, expect, it } from 'vitest';
import { simplifyMesh, weldPositions } from '../src/virtual/simplify';
import { buildClusters, clusterBounds, splitClusters } from '../src/virtual/clusters';
import { assembleCut, backfacing, buildClusterDag, createCutScratch, cutIndexCount, LOD_STRIDE, selectCut, type CutView } from '../src/virtual/cluster-dag';
import { floatKey, morton3, radixSortByKey } from '../src/virtual/sort';

/** Closed icosphere (shared vertices), optionally bumpy. */
function icosphere(subdivisions: number, bumps = 0): { positions: Float32Array; indices: Uint32Array } {
  const t = (1 + Math.sqrt(5)) / 2;
  const verts: number[] = [-1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, 0, 0, -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, t, 0, -1, t, 0, 1, -t, 0, -1, -t, 0, 1];
  let faces = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];
  for (let s = 0; s < subdivisions; s++) {
    const cache = new Map<number, number>();
    const mid = (a: number, b: number): number => {
      const key = a < b ? a * 1e6 + b : b * 1e6 + a;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      const i = verts.length / 3;
      for (let k = 0; k < 3; k++) verts.push(((verts[a * 3 + k] as number) + (verts[b * 3 + k] as number)) / 2);
      cache.set(key, i);
      return i;
    };
    const next: number[] = [];
    for (let f = 0; f < faces.length; f += 3) {
      const a = faces[f] as number, b = faces[f + 1] as number, c = faces[f + 2] as number;
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      next.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
    }
    faces = next;
  }
  const positions = new Float32Array(verts.length);
  for (let i = 0; i < verts.length; i += 3) {
    const l = Math.hypot(verts[i] as number, verts[i + 1] as number, verts[i + 2] as number);
    const nx = (verts[i] as number) / l, ny = (verts[i + 1] as number) / l, nz = (verts[i + 2] as number) / l;
    const r = 1 + bumps * Math.sin(nx * 7) * Math.cos(nz * 5);
    positions[i] = nx * r;
    positions[i + 1] = ny * r;
    positions[i + 2] = nz * r;
  }
  return { positions, indices: Uint32Array.from(faces) };
}

/** A flat grid (open border) of n×n quads in the XZ plane. */
function grid(n: number): { positions: Float32Array; indices: Uint32Array } {
  const positions = new Float32Array((n + 1) * (n + 1) * 3);
  for (let z = 0; z <= n; z++) for (let x = 0; x <= n; x++) positions.set([x / n, 0, z / n], (z * (n + 1) + x) * 3);
  const idx: number[] = [];
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const a = z * (n + 1) + x;
      idx.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
    }
  }
  return { positions, indices: Uint32Array.from(idx) };
}

/** Number of directed edges without an opposite edge (0 = closed, crack-free surface). */
function openEdges(indices: Uint32Array, weld: Uint32Array): number {
  const edges = new Map<string, number>();
  for (let i = 0; i < indices.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const a = weld[indices[i + k] as number] as number;
      const b = weld[indices[i + ((k + 1) % 3)] as number] as number;
      const key = `${a},${b}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const key of edges.keys()) {
    const [a, b] = key.split(',');
    if (!edges.has(`${b},${a}`)) open++;
  }
  return open;
}

function faceNormal(p: Float32Array, idx: Uint32Array, i: number): [number, number, number] {
  const a = (idx[i] as number) * 3, b = (idx[i + 1] as number) * 3, c = (idx[i + 2] as number) * 3;
  const ux = (p[b] as number) - (p[a] as number), uy = (p[b + 1] as number) - (p[a + 1] as number), uz = (p[b + 2] as number) - (p[a + 2] as number);
  const vx = (p[c] as number) - (p[a] as number), vy = (p[c + 1] as number) - (p[a + 1] as number), vz = (p[c + 2] as number) - (p[a + 2] as number);
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

describe('sorting helpers', () => {
  it('radix-sorts indices by float keys (small and large inputs)', () => {
    for (const n of [10, 5000]) {
      const vals = Array.from({ length: n }, (_, i) => ((i * 7919) % 1000) / 37 + 0.001);
      const keys = Uint32Array.from(vals.map(floatKey));
      const order = Uint32Array.from(vals.map((_, i) => i));
      const sorted = radixSortByKey(order, keys, n, new Uint32Array(n));
      for (let i = 1; i < n; i++) expect(vals[sorted[i] as number]).toBeGreaterThanOrEqual(vals[sorted[i - 1] as number] as number);
    }
  });

  it('maps non-positive and NaN keys to 0 and keeps float order', () => {
    expect(floatKey(-1)).toBe(0);
    expect(floatKey(Number.NaN)).toBe(0);
    expect(floatKey(2)).toBeGreaterThan(floatKey(1));
    expect(morton3(1, 1, 1)).toBeGreaterThan(morton3(0, 0, 0));
  });
});

describe('simplifyMesh', () => {
  it('welds duplicated positions', () => {
    const p = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0]);
    expect(Array.from(weldPositions(p))).toEqual([0, 1, 0, 1]);
  });

  it('halves a closed sphere, keeps it closed and never flips faces', () => {
    const m = icosphere(4, 0.05);
    const res = simplifyMesh(m.positions, m.indices, { targetIndexCount: m.indices.length / 2 });
    expect(res.indices.length / 3).toBeLessThanOrEqual(m.indices.length / 6);
    expect(res.indices.length / 3).toBeGreaterThan(m.indices.length / 6 - 64);
    expect(res.error).toBeGreaterThan(0);
    expect(res.error).toBeLessThan(0.05);
    expect(openEdges(res.indices, weldPositions(m.positions))).toBe(0);
    // Outward facing: every normal points away from the centre.
    for (let i = 0; i < res.indices.length; i += 3) {
      const n = faceNormal(m.positions, res.indices, i);
      const c = (res.indices[i] as number) * 3;
      expect(n[0] * (m.positions[c] as number) + n[1] * (m.positions[c + 1] as number) + n[2] * (m.positions[c + 2] as number)).toBeGreaterThan(0);
    }
  });

  it('only references input vertices (no new vertices) and error grows with reduction', () => {
    const m = icosphere(4, 0.1);
    const a = simplifyMesh(m.positions, m.indices, { targetIndexCount: m.indices.length / 2 });
    const b = simplifyMesh(m.positions, m.indices, { targetIndexCount: m.indices.length / 10 });
    for (const v of b.indices) expect(v).toBeLessThan(m.positions.length / 3);
    expect(b.error).toBeGreaterThan(a.error);
  });

  it('respects maxError and locked vertices', () => {
    const m = icosphere(3, 0.1);
    const capped = simplifyMesh(m.positions, m.indices, { targetIndexCount: 0, maxError: 1e-4 });
    expect(capped.error).toBeLessThanOrEqual(1e-4);
    const locked = new Uint8Array(m.positions.length / 3).fill(1);
    const none = simplifyMesh(m.positions, m.indices, { targetIndexCount: 0, locked });
    expect(none.indices.length).toBe(m.indices.length);
    expect(none.error).toBe(0);
  });

  it('keeps open borders when lockBorder is set and collapses a flat interior', () => {
    const g = grid(16);
    const res = simplifyMesh(g.positions, g.indices, { targetIndexCount: 0 });
    // A flat grid's interior costs nothing to remove; the 64 border vertices stay.
    const used = new Set(res.indices);
    for (let i = 0; i <= 16; i++) {
      expect(used.has(i)).toBe(true);
      expect(used.has(16 * 17 + i)).toBe(true);
    }
    expect(res.indices.length / 3).toBeLessThan(g.indices.length / 6);
    expect(res.error).toBeLessThan(1e-6);
  });

  it('survives degenerate input', () => {
    expect(simplifyMesh(new Float32Array(0), new Uint32Array(0), { targetIndexCount: 0 }).indices.length).toBe(0);
    const p = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(simplifyMesh(p, Uint32Array.from([0, 0, 1, 0, 1, 9]), { targetIndexCount: 0 }).indices.length).toBe(0);
  });
});

describe('clusters', () => {
  it('assigns every triangle exactly once with at most maxTriangles per cluster', () => {
    const m = icosphere(4);
    const set = buildClusters(m.positions, m.indices, 64);
    expect(set.offsets[set.count]).toBe(m.indices.length);
    for (let c = 0; c < set.count; c++) expect(((set.offsets[c + 1] as number) - (set.offsets[c] as number)) / 3).toBeLessThanOrEqual(64);
    const seen = new Set<string>();
    for (let i = 0; i < set.indices.length; i += 3) seen.add(`${set.indices[i]},${set.indices[i + 1]},${set.indices[i + 2]}`);
    expect(seen.size).toBe(m.indices.length / 3);
    // Compact: mean radius within 1.8x of a disc holding 64 of the sphere's triangles.
    const b = clusterBounds(m.positions, set);
    let mean = 0;
    for (let c = 0; c < set.count; c++) mean += (b.spheres[c * 4 + 3] as number) / set.count;
    const ideal = Math.sqrt((64 / (m.indices.length / 3)) * 4);
    expect(mean).toBeLessThan(ideal * 1.8);
  });

  it('splits along Morton order into balanced parts', () => {
    const m = icosphere(2);
    const set = splitClusters(m.positions, m.indices, 100);
    expect(set.count).toBe(Math.ceil(320 / 100));
    expect(set.offsets[set.count]).toBe(m.indices.length);
  });

  it('builds normal cones that cull back-facing clusters only', () => {
    const m = icosphere(4);
    const set = buildClusters(m.positions, m.indices, 64);
    const b = clusterBounds(m.positions, set);
    // Camera far on +z: clusters on the far side (-z) are back-facing, near side never.
    let culled = 0;
    for (let c = 0; c < set.count; c++) {
      const q = c * 4;
      const cz = b.spheres[q + 2] as number;
      const hit = backfacing(b.cones, q, (b.spheres[q] as number) - 0, (b.spheres[q + 1] as number) - 0, cz - 50, b.spheres[q + 3] as number);
      if (hit) {
        culled++;
        expect(cz).toBeLessThan(0);
      }
    }
    expect(culled).toBeGreaterThan(set.count / 5);
  });
});

describe('cluster LOD DAG', () => {
  const m = icosphere(5, 0.05);
  const dag = buildClusterDag(m.positions, m.indices);
  const weld = weldPositions(m.positions);
  const pixelScale = 1000;

  const view = (dist: number, threshold = 1): CutView => ({ cx: 0, cy: 0, cz: dist, pixelScale, threshold, planes: null, backface: false });

  it('reduces to a few roots with monotone errors and enclosing spheres', () => {
    expect(dag.baseTriangles).toBe(m.indices.length / 3);
    expect(dag.roots.length).toBeLessThanOrEqual(4);
    expect(dag.levelTriangles.length).toBeGreaterThan(5);
    for (let c = 0; c < dag.count; c++) {
      const o = c * LOD_STRIDE;
      const self = dag.lod[o] as number;
      const parent = dag.lod[o + 5] as number;
      expect(parent).toBeGreaterThanOrEqual(self);
      if (parent !== Infinity) {
        // Parent LOD sphere encloses the child's.
        const d = Math.hypot((dag.lod[o + 6] as number) - (dag.lod[o + 1] as number), (dag.lod[o + 7] as number) - (dag.lod[o + 2] as number), (dag.lod[o + 8] as number) - (dag.lod[o + 3] as number));
        expect(d + (dag.lod[o + 4] as number)).toBeLessThanOrEqual((dag.lod[o + 9] as number) * 1.0001 + 1e-5);
      }
    }
  });

  it('selects the full-detail mesh at zero threshold and the roots far away', () => {
    const out = new Uint32Array(dag.count);
    const s = createCutScratch(dag);
    const nFull = selectCut(dag, { ...view(3), threshold: 0 }, out, s);
    expect(cutIndexCount(dag, out, nFull)).toBe(m.indices.length);
    const nFar = selectCut(dag, view(1e7), out, s);
    let rootTris = 0;
    for (const r of dag.roots) rootTris += ((dag.offsets[r + 1] as number) - (dag.offsets[r] as number)) / 3;
    expect(cutIndexCount(dag, out, nFar) / 3).toBe(rootTris);
  });

  it('every cut is watertight (no cracks between LOD levels) and detail falls with distance', () => {
    const out = new Uint32Array(dag.count);
    const s = createCutScratch(dag);
    const target = new Uint32Array(dag.indices.length);
    let prev = Infinity;
    for (const dist of [1.2, 2, 5, 12, 40, 150, 800]) {
      const n = selectCut(dag, view(dist), out, s);
      const count = assembleCut(dag, out, n, target);
      expect(openEdges(target.subarray(0, count), weld)).toBe(0);
      expect(count).toBeLessThanOrEqual(prev);
      prev = count;
    }
    expect(prev).toBeLessThan(m.indices.length / 10);
  });

  it('culls clusters outside the frustum and back faces', () => {
    const out = new Uint32Array(dag.count);
    const s = createCutScratch(dag);
    const all = cutIndexCount(dag, out, selectCut(dag, view(3), out, s));
    // Plane x ≥ 0.5 keeps only a cap of the sphere.
    const planes = Float64Array.from([1, 0, 0, -0.5]);
    const capped = cutIndexCount(dag, out, selectCut(dag, { ...view(3), planes }, out, s));
    expect(capped).toBeLessThan(all / 2);
    const front = cutIndexCount(dag, out, selectCut(dag, { ...view(3), backface: true }, out, s));
    expect(front).toBeLessThan(all * 0.8);
    // Plane entirely excluding the sphere: nothing.
    expect(selectCut(dag, { ...view(3), planes: Float64Array.from([1, 0, 0, -5]) }, out, s)).toBe(0);
  });

  it('assembly stops at the target capacity', () => {
    const out = new Uint32Array(dag.count);
    const n = selectCut(dag, { ...view(3), threshold: 0 }, out, createCutScratch(dag));
    const small = new Uint32Array(1000);
    const written = assembleCut(dag, out, n, small);
    expect(written).toBeLessThanOrEqual(1000);
    expect(written % 3).toBe(0);
  });
});
