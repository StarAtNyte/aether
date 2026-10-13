/**
 * Mesh editing operations on {@link MeshData}. All operations are pure (the
 * input is never mutated), deterministic and bounded by the document's mesh
 * limits. Face selections are triangle indices; vertex selections are vertex
 * indices (split copies of a selected vertex move with it).
 */
import type { MeshData } from '@aether/core';
import { builderWithVertices, MeshBuilder, slotOf } from './builder';
import { boundaryVertices, buildTopology, edgeKey, faceNormal, signedVolume, syncCopies, weldMap, type Topology } from './topology';

const _n: [number, number, number] = [0, 0, 0];

function faceSet(mesh: MeshData, faces: Iterable<number> | null): Set<number> {
  const count = mesh.indices.length / 3;
  const out = new Set<number>();
  if (faces === null) {
    for (let t = 0; t < count; t++) out.add(t);
    return out;
  }
  for (const f of faces) if (Number.isInteger(f) && f >= 0 && f < count) out.add(f);
  return out;
}

/** Average (area-weighted) unit normal of faces; [0, 1, 0] when degenerate. */
export function averageNormal(mesh: MeshData, faces: Iterable<number>): [number, number, number] {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const t of faces) {
    faceNormal(mesh, t, _n);
    x += _n[0];
    y += _n[1];
    z += _n[2];
  }
  const len = Math.hypot(x, y, z);
  return len > 1e-12 ? [x / len, y / len, z / len] : [0, 1, 0];
}

/**
 * Extrude a face region along its average normal by `distance`. The region
 * gets new vertices; every open boundary edge of the region gets a side quad
 * with its own (hard-edged) vertices. Closed manifold input stays closed.
 */
export function extrudeFaces(mesh: MeshData, faces: Iterable<number>, distance: number): MeshData {
  const sel = faceSet(mesh, faces);
  if (sel.size === 0 || !Number.isFinite(distance)) return mesh;
  const idx = mesh.indices;
  const weld = weldMap(mesh.positions);
  const [nx, ny, nz] = averageNormal(mesh, sel);
  const dx = nx * distance;
  const dy = ny * distance;
  const dz = nz * distance;
  // Directed welded edges of the region; boundary = no opposite edge inside the region.
  const directed = new Set<number>();
  const dirKey = (a: number, b: number): number => a * 65_536 + b;
  for (const t of sel) {
    for (let k = 0; k < 3; k++) {
      const a = weld[idx[t * 3 + k] as number] as number;
      const b = weld[idx[t * 3 + ((k + 1) % 3)] as number] as number;
      directed.add(dirKey(a, b));
    }
  }
  let boundaryCount = 0;
  for (const t of sel) {
    for (let k = 0; k < 3; k++) {
      const a = weld[idx[t * 3 + k] as number] as number;
      const b = weld[idx[t * 3 + ((k + 1) % 3)] as number] as number;
      if (!directed.has(dirKey(b, a))) boundaryCount++;
    }
  }
  const out = builderWithVertices(mesh, sel.size * 3 + boundaryCount * 4, mesh.indices.length / 3 + boundaryCount * 2);
  const moved = new Map<number, number>();
  const lift = (v: number): number => {
    let m = moved.get(v);
    if (m === undefined) {
      m = out.copyVertex(mesh, v);
      out.setPosition(m, (out.positions[m * 3] as number) + dx, (out.positions[m * 3 + 1] as number) + dy, (out.positions[m * 3 + 2] as number) + dz);
      moved.set(v, m);
    }
    return m;
  };
  const tris = idx.length / 3;
  for (let t = 0; t < tris; t++) {
    const a = idx[t * 3] as number;
    const b = idx[t * 3 + 1] as number;
    const c = idx[t * 3 + 2] as number;
    if (sel.has(t)) out.triangle(lift(a), lift(b), lift(c), slotOf(mesh, t));
    else out.triangle(a, b, c, slotOf(mesh, t));
  }
  if (Math.abs(distance) < 1e-12) return out.build();
  for (const t of sel) {
    for (let k = 0; k < 3; k++) {
      const va = idx[t * 3 + k] as number;
      const vb = idx[t * 3 + ((k + 1) % 3)] as number;
      if (directed.has(dirKey(weld[vb] as number, weld[va] as number))) continue;
      // Side quad (va, vb, vb', va') with its own vertices for a crisp edge.
      const a0 = out.copyVertex(mesh, va);
      const b0 = out.copyVertex(mesh, vb);
      const b1 = out.copyVertex(mesh, vb);
      const a1 = out.copyVertex(mesh, va);
      out.setPosition(b1, (out.positions[b1 * 3] as number) + dx, (out.positions[b1 * 3 + 1] as number) + dy, (out.positions[b1 * 3 + 2] as number) + dz);
      out.setPosition(a1, (out.positions[a1 * 3] as number) + dx, (out.positions[a1 * 3 + 1] as number) + dy, (out.positions[a1 * 3 + 2] as number) + dz);
      // (b − a) × (d·n) faces away from the region for d > 0 (walls of a boss)
      // and toward it for d < 0 (walls of a recess): the same winding is right for both.
      const slot = slotOf(mesh, t);
      out.triangle(a0, b0, b1, slot);
      out.triangle(a0, b1, a1, slot);
    }
  }
  return out.build();
}

/**
 * Inset each selected triangle: an inner triangle scaled toward the centroid
 * by `amount` (0..0.95) plus a ring of three quads. Outer vertices are shared
 * with the neighbours, so the surface stays watertight.
 */
export function insetFaces(mesh: MeshData, faces: Iterable<number>, amount: number): MeshData {
  const sel = faceSet(mesh, faces);
  const t01 = Math.min(0.95, Math.max(0, Number.isFinite(amount) ? amount : 0));
  if (sel.size === 0 || t01 === 0) return mesh;
  const idx = mesh.indices;
  const out = builderWithVertices(mesh, sel.size * 3, idx.length / 3 + sel.size * 6);
  const tris = idx.length / 3;
  const p = mesh.positions;
  for (let t = 0; t < tris; t++) {
    const v = [idx[t * 3] as number, idx[t * 3 + 1] as number, idx[t * 3 + 2] as number] as const;
    const slot = slotOf(mesh, t);
    if (!sel.has(t)) {
      out.triangle(v[0], v[1], v[2], slot);
      continue;
    }
    const cx = ((p[v[0] * 3] as number) + (p[v[1] * 3] as number) + (p[v[2] * 3] as number)) / 3;
    const cy = ((p[v[0] * 3 + 1] as number) + (p[v[1] * 3 + 1] as number) + (p[v[2] * 3 + 1] as number)) / 3;
    const cz = ((p[v[0] * 3 + 2] as number) + (p[v[1] * 3 + 2] as number) + (p[v[2] * 3 + 2] as number)) / 3;
    const inner = v.map((vi) => {
      const ni = out.copyVertex(mesh, vi);
      const x = out.positions[ni * 3] as number;
      const y = out.positions[ni * 3 + 1] as number;
      const z = out.positions[ni * 3 + 2] as number;
      out.setPosition(ni, x + (cx - x) * t01, y + (cy - y) * t01, z + (cz - z) * t01);
      return ni;
    }) as [number, number, number];
    out.triangle(inner[0], inner[1], inner[2], slot);
    for (let k = 0; k < 3; k++) {
      const a = v[k] as number;
      const b = v[(k + 1) % 3] as number;
      const ia = inner[k] as number;
      const ib = inner[(k + 1) % 3] as number;
      out.triangle(a, b, ib, slot);
      out.triangle(a, ib, ia, slot);
    }
  }
  return out.build();
}

/**
 * Subdivide: every edge of the selected faces (all faces when `faces` is
 * null) is split at its midpoint; neighbouring faces that share a split edge
 * are split too, so no T-junctions (cracks) appear. With `smooth` and a whole
 * mesh selection, Loop subdivision weights are applied on the welded topology.
 */
export function subdivide(mesh: MeshData, faces: Iterable<number> | null = null, opts: { smooth?: boolean } = {}): MeshData {
  const sel = faceSet(mesh, faces);
  if (sel.size === 0) return mesh;
  const idx = mesh.indices;
  const tris = idx.length / 3;
  // Split decisions use welded edges, so faces on the other side of a hard edge
  // or UV seam (separate vertex copies) are split too and no crack opens.
  const weld = weldMap(mesh.positions);
  const wk = (a: number, b: number): number => edgeKey(weld[a] as number, weld[b] as number);
  const split = new Set<number>();
  for (const t of sel) {
    for (let k = 0; k < 3; k++) split.add(wk(idx[t * 3 + k] as number, idx[t * 3 + ((k + 1) % 3)] as number));
  }
  const out = builderWithVertices(mesh, split.size * 2, tris + sel.size * 3 + split.size * 2);
  const mid = new Map<number, number>();
  const midpoint = (a: number, b: number): number => {
    const k = edgeKey(a, b);
    let m = mid.get(k);
    if (m === undefined) {
      m = a < b ? out.lerpVertex(mesh, a, b, 0.5) : out.lerpVertex(mesh, b, a, 0.5);
      mid.set(k, m);
    }
    return m;
  };
  for (let t = 0; t < tris; t++) {
    const v0 = idx[t * 3] as number;
    const v1 = idx[t * 3 + 1] as number;
    const v2 = idx[t * 3 + 2] as number;
    const slot = slotOf(mesh, t);
    const s01 = split.has(wk(v0, v1));
    const s12 = split.has(wk(v1, v2));
    const s20 = split.has(wk(v2, v0));
    const count = (s01 ? 1 : 0) + (s12 ? 1 : 0) + (s20 ? 1 : 0);
    if (count === 0) {
      out.triangle(v0, v1, v2, slot);
    } else if (count === 3) {
      const m01 = midpoint(v0, v1);
      const m12 = midpoint(v1, v2);
      const m20 = midpoint(v2, v0);
      out.triangle(v0, m01, m20, slot);
      out.triangle(m01, v1, m12, slot);
      out.triangle(m20, m12, v2, slot);
      out.triangle(m01, m12, m20, slot);
    } else if (count === 1) {
      // Rotate so the split edge is (a, b).
      const [a, b, c] = s01 ? [v0, v1, v2] : s12 ? [v1, v2, v0] : [v2, v0, v1];
      const m = midpoint(a, b);
      out.triangle(a, m, c, slot);
      out.triangle(m, b, c, slot);
    } else {
      // Two split edges: rotate so the unsplit edge is (c, a).
      const [a, b, c] = !s20 ? [v0, v1, v2] : !s01 ? [v1, v2, v0] : [v2, v0, v1];
      const mab = midpoint(a, b);
      const mbc = midpoint(b, c);
      out.triangle(mab, b, mbc, slot);
      out.triangle(a, mab, mbc, slot);
      out.triangle(a, mbc, c, slot);
    }
  }
  const result = out.build();
  if (opts.smooth && sel.size === tris) loopSmooth(mesh, result, mid);
  return result;
}

/**
 * Loop subdivision positions for a fully split mesh: original vertices get
 * the Loop vertex rule, edge points the (3/8, 3/8, 1/8, 1/8) rule; open
 * boundaries use the 1-D (1/8, 6/8, 1/8) and (1/2, 1/2) rules.
 */
function loopSmooth(src: MeshData, out: MeshData, mid: Map<number, number>): void {
  const topo = buildTopology(src);
  const { weld } = topo;
  const p = src.positions;
  const q = out.positions;
  const boundary = boundaryVertices(topo);
  // Opposite vertices of each welded edge (for interior edge points).
  const opposite = new Map<number, number[]>();
  const idx = src.indices;
  for (let t = 0; t < idx.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = weld[idx[t + k] as number] as number;
      const b = weld[idx[t + ((k + 1) % 3)] as number] as number;
      const c = weld[idx[t + ((k + 2) % 3)] as number] as number;
      const key = edgeKey(a, b);
      const list = opposite.get(key);
      if (list) list.push(c);
      else opposite.set(key, [c]);
    }
  }
  // Edge points (written to every split midpoint of that welded edge).
  for (const [key, m] of mid) {
    const a0 = Math.floor(key / 65_536);
    const b0 = key - a0 * 65_536;
    const a = weld[a0] as number;
    const b = weld[b0] as number;
    const opp = opposite.get(edgeKey(a, b)) ?? [];
    for (let k = 0; k < 3; k++) {
      const pa = p[a * 3 + k] as number;
      const pb = p[b * 3 + k] as number;
      if (opp.length === 2) {
        q[m * 3 + k] = 0.375 * (pa + pb) + 0.125 * ((p[(opp[0] as number) * 3 + k] as number) + (p[(opp[1] as number) * 3 + k] as number));
      } else {
        q[m * 3 + k] = 0.5 * (pa + pb);
      }
    }
  }
  // Vertex points (original vertex indices keep their index in `out`).
  for (const w of topo.reps) {
    const start = topo.nStart[w] as number;
    const end = topo.nStart[w + 1] as number;
    const n = end - start;
    if (n === 0) continue;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    let used = 0;
    const onBoundary = boundary.has(w);
    for (let i = start; i < end; i++) {
      const u = topo.neighbors[i] as number;
      if (onBoundary && !boundary.has(u)) continue;
      if (onBoundary && (topo.edgeFaces.get(edgeKey(w, u)) ?? 0) !== 1) continue;
      nx += p[u * 3] as number;
      ny += p[u * 3 + 1] as number;
      nz += p[u * 3 + 2] as number;
      used++;
    }
    let x: number;
    let y: number;
    let z: number;
    if (onBoundary) {
      if (used !== 2) continue;
      x = 0.75 * (p[w * 3] as number) + 0.125 * nx;
      y = 0.75 * (p[w * 3 + 1] as number) + 0.125 * ny;
      z = 0.75 * (p[w * 3 + 2] as number) + 0.125 * nz;
    } else {
      const beta = n === 3 ? 3 / 16 : 3 / (8 * n);
      x = (1 - n * beta) * (p[w * 3] as number) + beta * nx;
      y = (1 - n * beta) * (p[w * 3 + 1] as number) + beta * ny;
      z = (1 - n * beta) * (p[w * 3 + 2] as number) + beta * nz;
    }
    for (let i = topo.copyStart[w] as number; i < (topo.copyStart[w + 1] as number); i++) {
      const v = topo.copies[i] as number;
      q[v * 3] = x;
      q[v * 3 + 1] = y;
      q[v * 3 + 2] = z;
    }
  }
}

/**
 * Laplacian smoothing on the welded topology. Vertices on an open boundary
 * stay fixed unless `pinBoundary` is false. `weights` (per vertex, 0..1)
 * limits the effect (soft selection); null smooths everything.
 */
export function smoothMesh(mesh: MeshData, opts: { iterations?: number; factor?: number; weights?: Float32Array | null; pinBoundary?: boolean } = {}): MeshData {
  const iterations = Math.min(50, Math.max(1, Math.round(opts.iterations ?? 2)));
  const factor = Math.min(1, Math.max(0, opts.factor ?? 0.5));
  const topo = buildTopology(mesh);
  const pinned = opts.pinBoundary === false ? new Set<number>() : boundaryVertices(topo);
  const positions = mesh.positions.slice();
  const next = positions.slice();
  for (let it = 0; it < iterations; it++) {
    for (const w of topo.reps) {
      const wt = opts.weights ? (opts.weights[w] as number) : 1;
      if (wt <= 0 || pinned.has(w)) continue;
      const start = topo.nStart[w] as number;
      const end = topo.nStart[w + 1] as number;
      if (end === start) continue;
      let x = 0;
      let y = 0;
      let z = 0;
      for (let i = start; i < end; i++) {
        const u = topo.neighbors[i] as number;
        x += positions[u * 3] as number;
        y += positions[u * 3 + 1] as number;
        z += positions[u * 3 + 2] as number;
      }
      const inv = 1 / (end - start);
      const f = factor * wt;
      next[w * 3] = (positions[w * 3] as number) + (x * inv - (positions[w * 3] as number)) * f;
      next[w * 3 + 1] = (positions[w * 3 + 1] as number) + (y * inv - (positions[w * 3 + 1] as number)) * f;
      next[w * 3 + 2] = (positions[w * 3 + 2] as number) + (z * inv - (positions[w * 3 + 2] as number)) * f;
    }
    positions.set(next);
  }
  syncCopies(positions, topo);
  return { ...mesh, positions, indices: mesh.indices.slice() };
}

/**
 * Merge vertices closer than `distance`, drop collapsed triangles and unused
 * vertices. Returns the new mesh and how many vertices were removed.
 */
export function mergeByDistance(mesh: MeshData, distance: number): { mesh: MeshData; removed: number } {
  const d = Math.max(1e-6, Number.isFinite(distance) ? distance : 1e-4);
  const n = mesh.positions.length / 3;
  const p = mesh.positions;
  const target = new Uint32Array(n);
  const grid = new Map<string, number[]>();
  const cell = (x: number): number => Math.floor(x / d);
  const d2 = d * d;
  for (let v = 0; v < n; v++) {
    const x = p[v * 3] as number;
    const y = p[v * 3 + 1] as number;
    const z = p[v * 3 + 2] as number;
    const cx = cell(x);
    const cy = cell(y);
    const cz = cell(z);
    let found = -1;
    for (let ix = -1; ix <= 1 && found < 0; ix++) {
      for (let iy = -1; iy <= 1 && found < 0; iy++) {
        for (let iz = -1; iz <= 1 && found < 0; iz++) {
          const list = grid.get(`${cx + ix},${cy + iy},${cz + iz}`);
          if (!list) continue;
          for (const u of list) {
            const ex = (p[u * 3] as number) - x;
            const ey = (p[u * 3 + 1] as number) - y;
            const ez = (p[u * 3 + 2] as number) - z;
            if (ex * ex + ey * ey + ez * ez <= d2) {
              found = u;
              break;
            }
          }
        }
      }
    }
    if (found >= 0) target[v] = found;
    else {
      target[v] = v;
      const key = `${cx},${cy},${cz}`;
      const list = grid.get(key);
      if (list) list.push(v);
      else grid.set(key, [v]);
    }
  }
  return compact(mesh, target);
}

/** Remap vertices through `target`, drop degenerate faces and unused vertices. */
function compact(mesh: MeshData, target: Uint32Array): { mesh: MeshData; removed: number } {
  const idx = mesh.indices;
  const keep: number[] = [];
  for (let t = 0; t < idx.length / 3; t++) {
    const a = target[idx[t * 3] as number] as number;
    const b = target[idx[t * 3 + 1] as number] as number;
    const c = target[idx[t * 3 + 2] as number] as number;
    if (a !== b && b !== c && c !== a) keep.push(t);
  }
  const n = mesh.positions.length / 3;
  const used = new Int32Array(n).fill(-1);
  const out = new MeshBuilder(mesh, 0, 0);
  for (const t of keep) {
    const tri: number[] = [];
    for (let k = 0; k < 3; k++) {
      const v = target[idx[t * 3 + k] as number] as number;
      let m = used[v] as number;
      if (m < 0) {
        m = out.copyVertex(mesh, v);
        used[v] = m;
      }
      tri.push(m);
    }
    out.triangle(tri[0] as number, tri[1] as number, tri[2] as number, slotOf(mesh, t));
  }
  if (out.triangleCount === 0) return { mesh, removed: 0 };
  const result = out.build();
  return { mesh: result, removed: n - result.positions.length / 3 };
}

/** Delete faces (and vertices nothing uses any more). Refuses to delete every face. */
export function deleteFaces(mesh: MeshData, faces: Iterable<number>): MeshData {
  const sel = faceSet(mesh, faces);
  const tris = mesh.indices.length / 3;
  if (sel.size === 0 || sel.size >= tris) return mesh;
  const target = new Uint32Array(mesh.positions.length / 3).map((_, i) => i);
  const filtered: MeshData = { ...mesh, indices: new Uint32Array(0), faceMaterials: null };
  const idx: number[] = [];
  const slots: number[] = [];
  for (let t = 0; t < tris; t++) {
    if (sel.has(t)) continue;
    idx.push(mesh.indices[t * 3] as number, mesh.indices[t * 3 + 1] as number, mesh.indices[t * 3 + 2] as number);
    slots.push(slotOf(mesh, t));
  }
  filtered.indices = Uint32Array.from(idx);
  filtered.faceMaterials = mesh.faceMaterials ? Uint8Array.from(slots) : null;
  return compact(filtered, target).mesh;
}

/** Reverse the winding of the selected faces (all when null): flips their normals. */
export function flipFaces(mesh: MeshData, faces: Iterable<number> | null = null): MeshData {
  const sel = faceSet(mesh, faces);
  const indices = mesh.indices.slice();
  for (const t of sel) {
    const b = indices[t * 3 + 1] as number;
    indices[t * 3 + 1] = indices[t * 3 + 2] as number;
    indices[t * 3 + 2] = b;
  }
  return { ...mesh, indices };
}

/**
 * Recompute normals: make the winding consistent across each connected
 * component (flood fill over shared edges), then flip components whose
 * signed volume is negative so normals point outward.
 */
export function orientOutward(mesh: MeshData): { mesh: MeshData; flipped: number } {
  const idx = mesh.indices.slice();
  const tris = idx.length / 3;
  const weld = weldMap(mesh.positions);
  const w = (t: number, k: number): number => weld[idx[t * 3 + k] as number] as number;
  // edge → faces
  const edgeFacesMap = new Map<number, number[]>();
  for (let t = 0; t < tris; t++) {
    for (let k = 0; k < 3; k++) {
      const key = edgeKey(w(t, k), w(t, (k + 1) % 3));
      const list = edgeFacesMap.get(key);
      if (list) list.push(t);
      else edgeFacesMap.set(key, [t]);
    }
  }
  const has = (t: number, a: number, b: number): boolean => {
    for (let k = 0; k < 3; k++) if (w(t, k) === a && w(t, (k + 1) % 3) === b) return true;
    return false;
  };
  const flip = (t: number): void => {
    const b = idx[t * 3 + 1] as number;
    idx[t * 3 + 1] = idx[t * 3 + 2] as number;
    idx[t * 3 + 2] = b;
  };
  const component = new Int32Array(tris).fill(-1);
  let comps = 0;
  for (let seed = 0; seed < tris; seed++) {
    if (component[seed] !== -1) continue;
    const members: number[] = [seed];
    component[seed] = comps;
    for (let i = 0; i < members.length; i++) {
      const t = members[i] as number;
      for (let k = 0; k < 3; k++) {
        const a = w(t, k);
        const b = w(t, (k + 1) % 3);
        for (const u of edgeFacesMap.get(edgeKey(a, b)) ?? []) {
          if (u === t || component[u] !== -1) continue;
          // Consistent neighbours traverse the shared edge in the opposite direction.
          if (has(u, a, b)) flip(u);
          component[u] = comps;
          members.push(u);
        }
      }
    }
    if (signedVolume({ positions: mesh.positions, indices: idx }, members) < 0) for (const t of members) flip(t);
    comps++;
  }
  // Net change: faces whose winding differs from the input.
  let flipped = 0;
  for (let t = 0; t < tris; t++) if (idx[t * 3 + 1] !== mesh.indices[t * 3 + 1]) flipped++;
  return { mesh: { ...mesh, indices: idx }, flipped };
}

/**
 * Simple UV unwrap. `box`: each face is projected along its dominant axis
 * (vertices are split where faces of different projections meet). `planar`:
 * everything projected along the dominant axis of the average normal.
 * `scale` = UV units per metre.
 */
export function unwrapUVs(mesh: MeshData, mode: 'box' | 'planar', scale = 1): MeshData {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const idx = mesh.indices;
  const tris = idx.length / 3;
  const axisOf = (x: number, y: number, z: number): number => {
    const ax = Math.abs(x);
    const ay = Math.abs(y);
    const az = Math.abs(z);
    return ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
  };
  let globalAxis = 1;
  if (mode === 'planar') {
    const n = averageNormal(mesh, faceSet(mesh, null));
    globalAxis = axisOf(n[0], n[1], n[2]);
  }
  const src: MeshData = { ...mesh, uvs: mesh.uvs ?? new Float32Array((mesh.positions.length / 3) * 2) };
  const out = new MeshBuilder(src, 0, 0);
  const remap = new Map<number, number>();
  const p = mesh.positions;
  for (let t = 0; t < tris; t++) {
    let axis = globalAxis;
    if (mode === 'box') {
      faceNormal(mesh, t, _n);
      axis = axisOf(_n[0], _n[1], _n[2]);
    }
    const tri: number[] = [];
    for (let k = 0; k < 3; k++) {
      const v = idx[t * 3 + k] as number;
      const key = v * 3 + axis;
      let m = remap.get(key);
      if (m === undefined) {
        m = out.copyVertex(src, v);
        const x = p[v * 3] as number;
        const y = p[v * 3 + 1] as number;
        const z = p[v * 3 + 2] as number;
        const uv = out.uvs as Float32Array;
        uv[m * 2] = (axis === 0 ? z : x) * s;
        uv[m * 2 + 1] = (axis === 1 ? z : y) * s;
        remap.set(key, m);
      }
      tri.push(m);
    }
    out.triangle(tri[0] as number, tri[1] as number, tri[2] as number, slotOf(mesh, t));
  }
  return out.build();
}

/** Vertex indices of faces, including every split copy at the same positions. */
export function faceVertices(mesh: MeshData, faces: Iterable<number>, topo?: Topology): Set<number> {
  const t0 = topo ?? buildTopology(mesh);
  const out = new Set<number>();
  for (const t of faces) for (let k = 0; k < 3; k++) for (const v of copiesOf(t0, mesh.indices[t * 3 + k] as number)) out.add(v);
  return out;
}

/** All vertex indices sharing the position of `v` (split copies). */
export function copiesOf(topo: Topology, v: number): number[] {
  const w = topo.weld[v] as number;
  const out: number[] = [];
  for (let i = topo.copyStart[w] as number; i < (topo.copyStart[w + 1] as number); i++) out.push(topo.copies[i] as number);
  return out;
}

/**
 * Soft-selection weights: 1 on selected vertices, falling off to 0 at
 * `radius` metres from the nearest selected vertex (smooth Hermite).
 * Uses a spatial grid, so cost is roughly linear in the vertex count.
 */
export function softWeights(mesh: MeshData, selected: Iterable<number>, radius: number): Float32Array {
  const n = mesh.positions.length / 3;
  const w = new Float32Array(n);
  const p = mesh.positions;
  const sel: number[] = [];
  for (const v of selected) if (v >= 0 && v < n) {
    w[v] = 1;
    sel.push(v);
  }
  if (!(radius > 0) || sel.length === 0) return w;
  const r2 = radius * radius;
  const grid = new Map<string, number[]>();
  const c = (x: number): number => Math.floor(x / radius);
  for (const v of sel) {
    const key = `${c(p[v * 3] as number)},${c(p[v * 3 + 1] as number)},${c(p[v * 3 + 2] as number)}`;
    const list = grid.get(key);
    if (list) list.push(v);
    else grid.set(key, [v]);
  }
  for (let v = 0; v < n; v++) {
    if (w[v] === 1) continue;
    const x = p[v * 3] as number;
    const y = p[v * 3 + 1] as number;
    const z = p[v * 3 + 2] as number;
    const cx = c(x);
    const cy = c(y);
    const cz = c(z);
    let best = r2;
    for (let ix = -1; ix <= 1; ix++) {
      for (let iy = -1; iy <= 1; iy++) {
        for (let iz = -1; iz <= 1; iz++) {
          const list = grid.get(`${cx + ix},${cy + iy},${cz + iz}`);
          if (!list) continue;
          for (const u of list) {
            const ex = (p[u * 3] as number) - x;
            const ey = (p[u * 3 + 1] as number) - y;
            const ez = (p[u * 3 + 2] as number) - z;
            const d2 = ex * ex + ey * ey + ez * ez;
            if (d2 < best) best = d2;
          }
        }
      }
    }
    if (best < r2) {
      const t = 1 - Math.sqrt(best) / radius;
      w[v] = t * t * (3 - 2 * t);
    }
  }
  return w;
}

/**
 * Transform vertices: `p' = p + w · (M·p − p)` with a column-major 4×4
 * matrix (three.js `Matrix4.elements` layout). Returns new positions.
 */
export function transformVertices(positions: Float32Array, weights: Float32Array, matrix: ArrayLike<number>): Float32Array {
  const out = positions.slice();
  const m = matrix;
  const n = positions.length / 3;
  for (let v = 0; v < n; v++) {
    const wt = weights[v] as number;
    if (!(wt > 0)) continue;
    const x = positions[v * 3] as number;
    const y = positions[v * 3 + 1] as number;
    const z = positions[v * 3 + 2] as number;
    const tx = (m[0] as number) * x + (m[4] as number) * y + (m[8] as number) * z + (m[12] as number);
    const ty = (m[1] as number) * x + (m[5] as number) * y + (m[9] as number) * z + (m[13] as number);
    const tz = (m[2] as number) * x + (m[6] as number) * y + (m[10] as number) * z + (m[14] as number);
    out[v * 3] = x + (tx - x) * wt;
    out[v * 3 + 1] = y + (ty - y) * wt;
    out[v * 3 + 2] = z + (tz - z) * wt;
  }
  return out;
}

/** Unique edges of faces as pairs of vertex indices (welded, deduplicated). */
export function faceEdges(mesh: MeshData, faces: Iterable<number> | null = null): Uint32Array {
  const sel = faceSet(mesh, faces);
  const weld = weldMap(mesh.positions);
  const seen = new Set<number>();
  const out: number[] = [];
  for (const t of sel) {
    for (let k = 0; k < 3; k++) {
      const a = weld[mesh.indices[t * 3 + k] as number] as number;
      const b = weld[mesh.indices[t * 3 + ((k + 1) % 3)] as number] as number;
      if (a === b) continue;
      const key = edgeKey(a, b);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(a, b);
    }
  }
  return Uint32Array.from(out);
}
