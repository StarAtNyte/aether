/**
 * Quadric-error-metric mesh simplification by half-edge collapse.
 *
 * Every collapse moves one vertex onto an existing neighbour, so the output
 * indexes the *input* vertex array: no vertex is created or moved, every
 * attribute (normals, colours, UVs) stays valid, and all levels of detail of
 * a mesh can share one GPU vertex buffer. That property is what makes the
 * cluster LOD DAG ({@link buildClusterDag}) cheap in memory.
 *
 * Algorithm (after Garland & Heckbert 1997, with the batching strategy of
 * meshoptimizer's simplifier):
 *
 * 1. Weld vertices with identical positions so attribute seams do not split
 *    the topology (the first copy represents the group in the output).
 * 2. Accumulate area-weighted plane quadrics per vertex, plus perpendicular
 *    "fence" quadrics along open borders so outlines keep their shape.
 * 3. Repeat passes: score every edge in both directions, radix-sort the
 *    candidates by cost and apply the cheapest independent collapses (no
 *    two collapses share a one-ring in one pass), rejecting any collapse
 *    that would flip or fold a triangle. Stop at the target triangle count,
 *    the error limit, or when a pass makes no progress.
 *
 * Locked vertices never move; open-border vertices only slide along their
 * border, or are locked entirely (the default), which keeps cluster-group
 * boundaries of the LOD DAG crack-free.
 *
 * Errors are reported in object units: `sqrt(Qv / Σarea)`, the area-weighted
 * RMS distance of the kept vertex to the planes of the removed surface.
 */
import { floatKey, radixSortByKey } from './sort';

/** Options of {@link simplifyMesh}. */
export interface SimplifyOptions {
  /** Stop once the index count is at or below this (multiple of 3). */
  targetIndexCount: number;
  /** Largest acceptable collapse error in object units (default unlimited). */
  maxError?: number;
  /** Per-vertex lock flags of the input vertex array (non-zero = never moves). */
  locked?: Uint8Array;
  /** Keep open-border vertices fixed (default true). */
  lockBorder?: boolean;
  /** Indices already reference welded (unique-position) vertices: skip welding. */
  welded?: boolean;
  /** Maximum collapse passes (default 64). */
  maxPasses?: number;
}

/** Result of {@link simplifyMesh}. */
export interface SimplifyResult {
  /** Triangles indexing the input vertex array. */
  indices: Uint32Array;
  /** Largest error of an applied collapse, object units (0 when nothing collapsed). */
  error: number;
}

const KIND_INTERIOR = 0;
const KIND_BORDER = 1;
const KIND_LOCKED = 2;
/** Quadric layout: a2 ab ac ad b2 bc bd c2 cd d2 weight. */
const QS = 11;
/** Weight of the border fence planes relative to surface area. */
const BORDER_WEIGHT = 10;
/** Minimum cosine between a triangle normal before and after a collapse. */
const MIN_FLIP_COS = 0.25;

/**
 * Map every vertex to the first vertex sharing its exact position.
 * Hash on the float bit patterns with open addressing (no per-vertex allocation).
 */
export function weldPositions(positions: Float32Array): Uint32Array {
  const n = Math.floor(positions.length / 3);
  const bits = new Uint32Array(positions.buffer, positions.byteOffset, n * 3);
  let size = 1;
  while (size < n * 2) size <<= 1;
  const mask = size - 1;
  const table = new Int32Array(size).fill(-1);
  const remap = new Uint32Array(n);
  for (let v = 0; v < n; v++) {
    const x = bits[v * 3] as number;
    const y = bits[v * 3 + 1] as number;
    const z = bits[v * 3 + 2] as number;
    let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask;
    for (;;) {
      const e = table[h] as number;
      if (e < 0) {
        table[h] = v;
        remap[v] = v;
        break;
      }
      if (bits[e * 3] === x && bits[e * 3 + 1] === y && bits[e * 3 + 2] === z) {
        remap[v] = e;
        break;
      }
      h = (h + 1) & mask;
    }
  }
  return remap;
}

/** Add plane (a, b, c, d) with weight w to quadric slot `q` of `Q`. */
function addPlane(Q: Float64Array, q: number, a: number, b: number, c: number, d: number, w: number): void {
  const o = q * QS;
  Q[o] = (Q[o] as number) + w * a * a;
  Q[o + 1] = (Q[o + 1] as number) + w * a * b;
  Q[o + 2] = (Q[o + 2] as number) + w * a * c;
  Q[o + 3] = (Q[o + 3] as number) + w * a * d;
  Q[o + 4] = (Q[o + 4] as number) + w * b * b;
  Q[o + 5] = (Q[o + 5] as number) + w * b * c;
  Q[o + 6] = (Q[o + 6] as number) + w * b * d;
  Q[o + 7] = (Q[o + 7] as number) + w * c * c;
  Q[o + 8] = (Q[o + 8] as number) + w * c * d;
  Q[o + 9] = (Q[o + 9] as number) + w * d * d;
  Q[o + 10] = (Q[o + 10] as number) + w;
}

/** Normalised error (mean squared plane distance) of the sum of quadrics `qa` + `qb` at (x, y, z). */
function quadricError(Q: Float64Array, qa: number, qb: number, x: number, y: number, z: number): number {
  const a = qa * QS;
  const b = qb * QS;
  const a2 = (Q[a] as number) + (Q[b] as number);
  const ab = (Q[a + 1] as number) + (Q[b + 1] as number);
  const ac = (Q[a + 2] as number) + (Q[b + 2] as number);
  const ad = (Q[a + 3] as number) + (Q[b + 3] as number);
  const b2 = (Q[a + 4] as number) + (Q[b + 4] as number);
  const bc = (Q[a + 5] as number) + (Q[b + 5] as number);
  const bd = (Q[a + 6] as number) + (Q[b + 6] as number);
  const c2 = (Q[a + 7] as number) + (Q[b + 7] as number);
  const cd = (Q[a + 8] as number) + (Q[b + 8] as number);
  const d2 = (Q[a + 9] as number) + (Q[b + 9] as number);
  const w = (Q[a + 10] as number) + (Q[b + 10] as number);
  const e = a2 * x * x + 2 * ab * x * y + 2 * ac * x * z + 2 * ad * x + b2 * y * y + 2 * bc * y * z + 2 * bd * y + c2 * z * z + 2 * cd * z + d2;
  return w > 0 ? Math.max(0, e / w) : 0;
}

/** Compressed vertex → triangle adjacency over the current triangle list. */
interface Adjacency {
  offsets: Uint32Array;
  tris: Uint32Array;
}

function buildAdjacency(tri: Uint32Array, triCount: number, vertexCount: number, out: Adjacency | null): Adjacency {
  const offsets = out && out.offsets.length >= vertexCount + 1 ? out.offsets : new Uint32Array(vertexCount + 1);
  offsets.fill(0, 0, vertexCount + 1);
  for (let i = 0; i < triCount * 3; i++) offsets[(tri[i] as number) + 1]++;
  for (let v = 0; v < vertexCount; v++) offsets[v + 1] = (offsets[v + 1] as number) + (offsets[v] as number);
  const tris = out && out.tris.length >= triCount * 3 ? out.tris : new Uint32Array(triCount * 3);
  const fill = new Uint32Array(vertexCount);
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const v = tri[t * 3 + k] as number;
      tris[(offsets[v] as number) + (fill[v] as number)] = t;
      fill[v]++;
    }
  }
  return { offsets, tris };
}

/** True when the directed edge a→b has no opposite b→a in any triangle around `a` (open border). */
function isBorderEdge(adj: Adjacency, tri: Uint32Array, a: number, b: number): boolean {
  const end = adj.offsets[a + 1] as number;
  for (let i = adj.offsets[a] as number; i < end; i++) {
    const t = (adj.tris[i] as number) * 3;
    const i0 = tri[t] as number;
    const i1 = tri[t + 1] as number;
    const i2 = tri[t + 2] as number;
    // Opposite orientation b→a.
    if ((i0 === b && i1 === a) || (i1 === b && i2 === a) || (i2 === b && i0 === a)) return false;
  }
  return true;
}

/**
 * Simplify a triangle mesh toward `targetIndexCount` indices.
 * `positions` is xyz per vertex; `indices` must be a multiple of 3.
 * Never throws on degenerate input; returns the (possibly unchanged) triangles.
 */
export function simplifyMesh(positions: Float32Array, indices: Uint32Array, opts: SimplifyOptions): SimplifyResult {
  const vertexCount = Math.floor(positions.length / 3);
  const target = Math.max(0, Math.floor(opts.targetIndexCount / 3));
  const maxErr2 = opts.maxError === undefined ? Infinity : opts.maxError * opts.maxError;
  const lockBorder = opts.lockBorder !== false;
  const maxPasses = Math.max(1, opts.maxPasses ?? 64);

  // 1. Welded working triangles (degenerates dropped).
  const remap = opts.welded ? null : weldPositions(positions);
  const tri = new Uint32Array(indices.length - (indices.length % 3));
  let triCount = 0;
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const i0 = indices[i] as number;
    const i1 = indices[i + 1] as number;
    const i2 = indices[i + 2] as number;
    if (i0 >= vertexCount || i1 >= vertexCount || i2 >= vertexCount) continue;
    const a = remap ? (remap[i0] as number) : i0;
    const b = remap ? (remap[i1] as number) : i1;
    const c = remap ? (remap[i2] as number) : i2;
    if (a === b || b === c || a === c) continue;
    tri[triCount * 3] = a;
    tri[triCount * 3 + 1] = b;
    tri[triCount * 3 + 2] = c;
    triCount++;
  }
  if (triCount <= target) return { indices: tri.slice(0, triCount * 3), error: 0 };

  // Lock flags per welded vertex (a group is locked when any copy is).
  const lockedW = new Uint8Array(vertexCount);
  if (opts.locked) {
    for (let v = 0; v < vertexCount && v < opts.locked.length; v++) if (opts.locked[v]) lockedW[remap ? (remap[v] as number) : v] = 1;
  }

  // 2. Quadrics.
  const Q = new Float64Array(vertexCount * QS);
  let adj = buildAdjacency(tri, triCount, vertexCount, null);
  for (let t = 0; t < triCount; t++) {
    const a = tri[t * 3] as number;
    const b = tri[t * 3 + 1] as number;
    const c = tri[t * 3 + 2] as number;
    const ax = positions[a * 3] as number, ay = positions[a * 3 + 1] as number, az = positions[a * 3 + 2] as number;
    const e1x = (positions[b * 3] as number) - ax, e1y = (positions[b * 3 + 1] as number) - ay, e1z = (positions[b * 3 + 2] as number) - az;
    const e2x = (positions[c * 3] as number) - ax, e2y = (positions[c * 3 + 1] as number) - ay, e2z = (positions[c * 3 + 2] as number) - az;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz);
    if (len <= 0) continue;
    nx /= len;
    ny /= len;
    nz /= len;
    const area = len * 0.5;
    const d = -(nx * ax + ny * ay + nz * az);
    addPlane(Q, a, nx, ny, nz, d, area);
    addPlane(Q, b, nx, ny, nz, d, area);
    addPlane(Q, c, nx, ny, nz, d, area);
    // Border fences: a plane through each open edge, perpendicular to the triangle.
    for (let k = 0; k < 3; k++) {
      const p = tri[t * 3 + k] as number;
      const q = tri[t * 3 + ((k + 1) % 3)] as number;
      if (!isBorderEdge(adj, tri, p, q)) continue;
      const px = positions[p * 3] as number, py = positions[p * 3 + 1] as number, pz = positions[p * 3 + 2] as number;
      const ex = (positions[q * 3] as number) - px, ey = (positions[q * 3 + 1] as number) - py, ez = (positions[q * 3 + 2] as number) - pz;
      let fx = ey * nz - ez * ny;
      let fy = ez * nx - ex * nz;
      let fz = ex * ny - ey * nx;
      const fl = Math.hypot(fx, fy, fz);
      if (fl <= 0) continue;
      fx /= fl;
      fy /= fl;
      fz /= fl;
      const fd = -(fx * px + fy * py + fz * pz);
      const w = (ex * ex + ey * ey + ez * ez) * BORDER_WEIGHT;
      addPlane(Q, p, fx, fy, fz, fd, w);
      addPlane(Q, q, fx, fy, fz, fd, w);
    }
  }

  // 3. Collapse passes.
  const kind = new Uint8Array(vertexCount);
  const touched = new Uint32Array(vertexCount);
  const collapseTo = new Int32Array(vertexCount).fill(-1);
  const edgeFrom = new Uint32Array(triCount * 3);
  const edgeTo = new Uint32Array(triCount * 3);
  const edgeKey = new Uint32Array(triCount * 3);
  const edgeCost = new Float64Array(triCount * 3);
  const edgeBorder = new Uint8Array(triCount * 3);
  const order = new Uint32Array(triCount * 3);
  const scratch = new Uint32Array(triCount * 3);
  let maxError = 0;

  for (let pass = 1; pass <= maxPasses && triCount > target; pass++) {
    // Open-border flags per triangle edge, then vertex kinds from the current topology.
    kind.fill(KIND_INTERIOR);
    for (let t = 0; t < triCount; t++) {
      for (let k = 0; k < 3; k++) {
        const a = tri[t * 3 + k] as number;
        const b = tri[t * 3 + ((k + 1) % 3)] as number;
        const border = isBorderEdge(adj, tri, a, b);
        edgeBorder[t * 3 + k] = border ? 1 : 0;
        if (border) {
          if (kind[a] === KIND_INTERIOR) kind[a] = KIND_BORDER;
          if (kind[b] === KIND_INTERIOR) kind[b] = KIND_BORDER;
        }
      }
    }
    for (let v = 0; v < vertexCount; v++) {
      if (lockedW[v] || (lockBorder && kind[v] === KIND_BORDER)) kind[v] = KIND_LOCKED;
    }

    // Candidate collapses: every edge once (a < b), border edges in their only orientation.
    let edges = 0;
    for (let t = 0; t < triCount; t++) {
      for (let k = 0; k < 3; k++) {
        const a = tri[t * 3 + k] as number;
        const b = tri[t * 3 + ((k + 1) % 3)] as number;
        const border = edgeBorder[t * 3 + k] === 1;
        if (!border && a > b) continue;
        const ka = kind[a] as number;
        const kb = kind[b] as number;
        if (ka === KIND_LOCKED && kb === KIND_LOCKED) continue;
        // Border vertices may only slide along a border edge onto another border vertex.
        const aMay = ka === KIND_INTERIOR || (ka === KIND_BORDER && kb !== KIND_INTERIOR && border);
        const bMay = kb === KIND_INTERIOR || (kb === KIND_BORDER && ka !== KIND_INTERIOR && border);
        if (!aMay && !bMay) continue;
        const costAB = aMay ? quadricError(Q, a, b, positions[b * 3] as number, positions[b * 3 + 1] as number, positions[b * 3 + 2] as number) : Infinity;
        const costBA = bMay ? quadricError(Q, a, b, positions[a * 3] as number, positions[a * 3 + 1] as number, positions[a * 3 + 2] as number) : Infinity;
        if (costAB <= costBA) {
          edgeFrom[edges] = a;
          edgeTo[edges] = b;
          edgeCost[edges] = costAB;
        } else {
          edgeFrom[edges] = b;
          edgeTo[edges] = a;
          edgeCost[edges] = costBA;
        }
        edgeKey[edges] = floatKey(edgeCost[edges] as number);
        order[edges] = edges;
        edges++;
      }
    }
    if (edges === 0) break;
    const sorted = radixSortByKey(order, edgeKey, edges, scratch);

    // Apply the cheapest collapses whose endpoints are untouched this pass. Corners
    // already collapsed in this pass are read through `collapseTo`, so flip checks
    // see the current geometry (as in meshoptimizer).
    let removed = 0;
    let collapses = 0;
    const needed = triCount - target;
    for (let i = 0; i < edges && removed < needed; i++) {
      const e = sorted[i] as number;
      const cost = edgeCost[e] as number;
      if (cost > maxErr2) break;
      const from = edgeFrom[e] as number;
      const to = edgeTo[e] as number;
      if (touched[from] === pass || touched[to] === pass) continue;
      const end = adj.offsets[from + 1] as number;
      let ok = true;
      let dies = 0;
      for (let j = adj.offsets[from] as number; j < end; j++) {
        const t = (adj.tris[j] as number) * 3;
        let i0 = tri[t] as number;
        let i1 = tri[t + 1] as number;
        let i2 = tri[t + 2] as number;
        if ((collapseTo[i0] as number) >= 0) i0 = collapseTo[i0] as number;
        if ((collapseTo[i1] as number) >= 0) i1 = collapseTo[i1] as number;
        if ((collapseTo[i2] as number) >= 0) i2 = collapseTo[i2] as number;
        if (i0 === i1 || i1 === i2 || i0 === i2) continue; // already removed this pass
        if (i0 === to || i1 === to || i2 === to) {
          dies++;
          continue;
        }
        if (!keepsOrientation(positions, i0, i1, i2, from, to)) {
          ok = false;
          break;
        }
      }
      if (!ok || dies === 0) continue;
      touched[from] = pass;
      touched[to] = pass;
      collapseTo[from] = to;
      const o = from * QS;
      const p = to * QS;
      for (let k = 0; k < QS; k++) Q[p + k] = (Q[p + k] as number) + (Q[o + k] as number);
      removed += dies;
      collapses++;
      if (cost > maxError) maxError = cost;
    }
    if (collapses === 0) break;

    // Apply the collapses and drop degenerate triangles.
    let w = 0;
    for (let t = 0; t < triCount; t++) {
      let a = tri[t * 3] as number;
      let b = tri[t * 3 + 1] as number;
      let c = tri[t * 3 + 2] as number;
      if ((collapseTo[a] as number) >= 0) a = collapseTo[a] as number;
      if ((collapseTo[b] as number) >= 0) b = collapseTo[b] as number;
      if ((collapseTo[c] as number) >= 0) c = collapseTo[c] as number;
      if (a === b || b === c || a === c) continue;
      tri[w * 3] = a;
      tri[w * 3 + 1] = b;
      tri[w * 3 + 2] = c;
      w++;
    }
    for (let v = 0; v < vertexCount; v++) collapseTo[v] = -1;
    triCount = w;
    adj = buildAdjacency(tri, triCount, vertexCount, adj);
  }
  return { indices: tri.slice(0, triCount * 3), error: Math.sqrt(maxError) };
}

/**
 * True when replacing `from` by `to` in triangle (i0, i1, i2) keeps its
 * facing: the new normal stays within ~75° of the old one and non-degenerate.
 */
function keepsOrientation(p: Float32Array, i0: number, i1: number, i2: number, from: number, to: number): boolean {
  const ax = p[i0 * 3] as number, ay = p[i0 * 3 + 1] as number, az = p[i0 * 3 + 2] as number;
  const bx = p[i1 * 3] as number, by = p[i1 * 3 + 1] as number, bz = p[i1 * 3 + 2] as number;
  const cx = p[i2 * 3] as number, cy = p[i2 * 3 + 1] as number, cz = p[i2 * 3 + 2] as number;
  // Old normal.
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  // New corner positions.
  const tx = p[to * 3] as number, ty = p[to * 3 + 1] as number, tz = p[to * 3 + 2] as number;
  const Ax = i0 === from ? tx : ax, Ay = i0 === from ? ty : ay, Az = i0 === from ? tz : az;
  const Bx = i1 === from ? tx : bx, By = i1 === from ? ty : by, Bz = i1 === from ? tz : bz;
  const Cx = i2 === from ? tx : cx, Cy = i2 === from ? ty : cy, Cz = i2 === from ? tz : cz;
  const Ux = Bx - Ax, Uy = By - Ay, Uz = Bz - Az;
  const Vx = Cx - Ax, Vy = Cy - Ay, Vz = Cz - Az;
  const mx = Uy * Vz - Uz * Vy, my = Uz * Vx - Ux * Vz, mz = Ux * Vy - Uy * Vx;
  const ln = Math.hypot(nx, ny, nz);
  const lm = Math.hypot(mx, my, mz);
  if (lm <= 1e-20 || ln <= 1e-20) return false;
  return (nx * mx + ny * my + nz * mz) >= MIN_FLIP_COS * ln * lm;
}
