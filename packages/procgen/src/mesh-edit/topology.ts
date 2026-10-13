/**
 * Topology helpers for editable meshes. Generated meshes split vertices at
 * hard edges and UV seams, so connectivity is computed on WELDED vertices
 * (vertices at the same position share one id). Every operation keeps split
 * copies consistent by working on welded ids and writing back to all copies.
 */
import type { MeshData } from '@aether/core';

/** Welded topology of a mesh. */
export interface Topology {
  /** Welded id (the smallest vertex index at that position) per vertex. */
  weld: Uint32Array;
  /** Vertex indices per welded id: `copies[start[w] .. start[w + 1])`. */
  copyStart: Uint32Array;
  copies: Uint32Array;
  /** Welded neighbour ids (CSR): `neighbors[nStart[w] .. nStart[w + 1])`. */
  nStart: Uint32Array;
  neighbors: Uint32Array;
  /** Welded ids that are representatives (weld[v] === v). */
  reps: Uint32Array;
  /** Number of faces using each welded edge (key → count). */
  edgeFaces: Map<number, number>;
}

/** Quantisation step used to weld coincident vertices (metres). */
export const WELD_EPSILON = 1e-5;

/** Undirected edge key of two vertex ids (< 65 536 each, so the key is an exact integer). */
export function edgeKey(a: number, b: number): number {
  return a < b ? a * 65_536 + b : b * 65_536 + a;
}

/** The two vertex ids of an edge key. */
export function edgeEnds(key: number): [number, number] {
  const a = Math.floor(key / 65_536);
  return [a, key - a * 65_536];
}

/** Map each vertex to the smallest-index vertex at the same (quantised) position. */
export function weldMap(positions: Float32Array, eps = WELD_EPSILON): Uint32Array {
  const n = positions.length / 3;
  const out = new Uint32Array(n);
  const seen = new Map<string, number>();
  const inv = 1 / eps;
  for (let v = 0; v < n; v++) {
    const key = `${Math.round((positions[v * 3] as number) * inv)},${Math.round((positions[v * 3 + 1] as number) * inv)},${Math.round((positions[v * 3 + 2] as number) * inv)}`;
    const hit = seen.get(key);
    if (hit === undefined) {
      seen.set(key, v);
      out[v] = v;
    } else out[v] = hit;
  }
  return out;
}

/** Build the welded topology (O(vertices + triangles)). */
export function buildTopology(mesh: Pick<MeshData, 'positions' | 'indices'>): Topology {
  const n = mesh.positions.length / 3;
  const weld = weldMap(mesh.positions);
  // copies (CSR by welded id)
  const count = new Uint32Array(n + 1);
  for (let v = 0; v < n; v++) {
    const w = (weld[v] as number) + 1;
    count[w] = (count[w] as number) + 1;
  }
  const copyStart = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) copyStart[i + 1] = (copyStart[i] as number) + (count[i + 1] as number);
  const fill = copyStart.slice(0, n);
  const copies = new Uint32Array(n);
  for (let v = 0; v < n; v++) {
    const w = weld[v] as number;
    const at = fill[w] as number;
    copies[at] = v;
    fill[w] = at + 1;
  }
  // edges
  const idx = mesh.indices;
  const edgeFaces = new Map<number, number>();
  const adj = new Map<number, Set<number>>();
  const link = (a: number, b: number): void => {
    let s = adj.get(a);
    if (!s) adj.set(a, (s = new Set()));
    s.add(b);
  };
  for (let t = 0; t < idx.length; t += 3) {
    const a = weld[idx[t] as number] as number;
    const b = weld[idx[t + 1] as number] as number;
    const c = weld[idx[t + 2] as number] as number;
    for (const [x, y] of [[a, b], [b, c], [c, a]] as const) {
      if (x === y) continue;
      const k = edgeKey(x, y);
      edgeFaces.set(k, (edgeFaces.get(k) ?? 0) + 1);
      link(x, y);
      link(y, x);
    }
  }
  const nStart = new Uint32Array(n + 1);
  for (let w = 0; w < n; w++) nStart[w + 1] = (nStart[w] as number) + (adj.get(w)?.size ?? 0);
  const neighbors = new Uint32Array(nStart[n] as number);
  for (let w = 0; w < n; w++) {
    const s = adj.get(w);
    if (!s) continue;
    let o = nStart[w] as number;
    for (const x of s) neighbors[o++] = x;
  }
  const repList: number[] = [];
  for (let v = 0; v < n; v++) if (weld[v] === v) repList.push(v);
  return { weld, copyStart, copies, nStart, neighbors, reps: Uint32Array.from(repList), edgeFaces };
}

/** Welded ids lying on an open boundary (an edge used by exactly one face). */
export function boundaryVertices(topo: Topology): Set<number> {
  const out = new Set<number>();
  for (const [k, c] of topo.edgeFaces) {
    if (c !== 1) continue;
    const [a, b] = edgeEnds(k);
    out.add(a);
    out.add(b);
  }
  return out;
}

/** Copy the position of each representative to all its split copies. */
export function syncCopies(positions: Float32Array, topo: Topology): void {
  const { weld } = topo;
  for (let v = 0; v < weld.length; v++) {
    const w = weld[v] as number;
    if (w === v) continue;
    positions[v * 3] = positions[w * 3] as number;
    positions[v * 3 + 1] = positions[w * 3 + 1] as number;
    positions[v * 3 + 2] = positions[w * 3 + 2] as number;
  }
}

/** Mesh health: open boundary edges, non-manifold edges (> 2 faces) and degenerate triangles. */
export interface MeshHealth {
  vertices: number;
  triangles: number;
  boundaryEdges: number;
  nonManifoldEdges: number;
  degenerate: number;
  /** Every edge has exactly two faces (a closed 2-manifold). */
  closed: boolean;
}

/** Analyse mesh health on the welded topology. */
export function meshHealth(mesh: Pick<MeshData, 'positions' | 'indices'>): MeshHealth {
  const topo = buildTopology(mesh);
  let boundary = 0;
  let nonManifold = 0;
  for (const c of topo.edgeFaces.values()) {
    if (c === 1) boundary++;
    else if (c > 2) nonManifold++;
  }
  let degenerate = 0;
  const idx = mesh.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const a = topo.weld[idx[t] as number];
    const b = topo.weld[idx[t + 1] as number];
    const c = topo.weld[idx[t + 2] as number];
    if (a === b || b === c || c === a) degenerate++;
  }
  return { vertices: mesh.positions.length / 3, triangles: idx.length / 3, boundaryEdges: boundary, nonManifoldEdges: nonManifold, degenerate, closed: boundary === 0 && nonManifold === 0 };
}

/** Signed volume of a mesh (positive when faces wind counter-clockwise seen from outside). */
export function signedVolume(mesh: Pick<MeshData, 'positions' | 'indices'>, faces?: Iterable<number>): number {
  const p = mesh.positions;
  const idx = mesh.indices;
  let vol = 0;
  const one = (t: number): void => {
    const a = (idx[t * 3] as number) * 3;
    const b = (idx[t * 3 + 1] as number) * 3;
    const c = (idx[t * 3 + 2] as number) * 3;
    const ax = p[a] as number, ay = p[a + 1] as number, az = p[a + 2] as number;
    const bx = p[b] as number, by = p[b + 1] as number, bz = p[b + 2] as number;
    const cx = p[c] as number, cy = p[c + 1] as number, cz = p[c + 2] as number;
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  };
  if (faces) for (const t of faces) one(t);
  else for (let t = 0; t < idx.length / 3; t++) one(t);
  return vol;
}

/** Face normal (unnormalised, length = 2 × area) of triangle `t`, written into `out`. */
export function faceNormal(mesh: Pick<MeshData, 'positions' | 'indices'>, t: number, out: [number, number, number]): [number, number, number] {
  const p = mesh.positions;
  const a = (mesh.indices[t * 3] as number) * 3;
  const b = (mesh.indices[t * 3 + 1] as number) * 3;
  const c = (mesh.indices[t * 3 + 2] as number) * 3;
  const ux = (p[b] as number) - (p[a] as number), uy = (p[b + 1] as number) - (p[a + 1] as number), uz = (p[b + 2] as number) - (p[a + 2] as number);
  const vx = (p[c] as number) - (p[a] as number), vy = (p[c + 1] as number) - (p[a + 1] as number), vz = (p[c + 2] as number) - (p[a + 2] as number);
  out[0] = uy * vz - uz * vy;
  out[1] = uz * vx - ux * vz;
  out[2] = ux * vy - uy * vx;
  return out;
}
