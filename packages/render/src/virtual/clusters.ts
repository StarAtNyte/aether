/**
 * Meshlet clustering: split a triangle list into spatially compact clusters
 * of at most `maxTriangles` triangles, each with a bounding sphere and a
 * normal cone for frustum and back-face culling.
 *
 * Seeds are taken in Morton order of the triangle centroids and grown
 * breadth-first over vertex-sharing neighbours, so clusters are compact
 * patches and consecutive clusters are spatial neighbours. Runs in linear
 * time with typed arrays only.
 */
import { morton3, radixSortByKey } from './sort';

/** Default triangles per cluster (Nanite uses 128). */
export const CLUSTER_TRIANGLES = 128;

/** A clustered triangle list. */
export interface ClusterSet {
  /** Triangles reordered so each cluster is contiguous (indices into the vertex array). */
  indices: Uint32Array;
  /** Cluster `c` covers `indices[offsets[c] .. offsets[c + 1])` (index units). */
  offsets: Uint32Array;
  count: number;
}

/** Per-cluster culling data, packed. */
export interface ClusterBounds {
  /** cx, cy, cz, radius per cluster. */
  spheres: Float32Array;
  /**
   * Normal cone per cluster: axis x, y, z and the sine of the cone's half
   * angle (`>= 1` disables back-face culling for that cluster).
   */
  cones: Float32Array;
}

/**
 * Cluster `indices` (triangles over `positions`). Adjacency uses `weld`
 * (vertex → representative with the same position) when given, so attribute
 * seams do not cut clusters apart.
 */
export function buildClusters(positions: Float32Array, indices: Uint32Array, maxTriangles = CLUSTER_TRIANGLES, weld?: Uint32Array): ClusterSet {
  const triCount = Math.floor(indices.length / 3);
  const vertexCount = Math.floor(positions.length / 3);
  const cap = Math.max(1, Math.floor(maxTriangles));
  if (triCount === 0) return { indices: new Uint32Array(0), offsets: new Uint32Array(1), count: 0 };
  const vid = (i: number): number => {
    const v = indices[i] as number;
    return weld ? (weld[v] as number) : v;
  };

  // Morton order of centroids.
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < triCount * 3; i++) {
    const v = (indices[i] as number) * 3;
    const x = positions[v] as number, y = positions[v + 1] as number, z = positions[v + 2] as number;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const ext = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-9);
  const keys = new Uint32Array(triCount);
  for (let t = 0; t < triCount; t++) {
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < 3; k++) {
      const v = (indices[t * 3 + k] as number) * 3;
      cx += positions[v] as number;
      cy += positions[v + 1] as number;
      cz += positions[v + 2] as number;
    }
    keys[t] = morton3((cx / 3 - minX) / ext, (cy / 3 - minY) / ext, (cz / 3 - minZ) / ext);
  }
  const order0 = new Uint32Array(triCount);
  for (let t = 0; t < triCount; t++) order0[t] = t;
  const order = radixSortByKey(order0, keys, triCount, new Uint32Array(triCount));

  // Vertex → triangle adjacency (CSR) over welded ids.
  const offs = new Uint32Array(vertexCount + 1);
  for (let i = 0; i < triCount * 3; i++) offs[vid(i) + 1] = (offs[vid(i) + 1] as number) + 1;
  for (let v = 0; v < vertexCount; v++) offs[v + 1] = (offs[v + 1] as number) + (offs[v] as number);
  const adj = new Uint32Array(triCount * 3);
  const fill = new Uint32Array(vertexCount);
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const v = vid(t * 3 + k);
      adj[(offs[v] as number) + (fill[v] as number)] = t;
      fill[v] = (fill[v] as number) + 1;
    }
  }

  const assigned = new Int32Array(triCount).fill(-1);
  const queued = new Int32Array(triCount).fill(-1);
  const queue = new Uint32Array(triCount);
  const out = new Uint32Array(triCount * 3);
  const offsets: number[] = [0];
  let written = 0;
  let cluster = 0;
  let cursor = 0;
  /** Next unassigned triangle in Morton order. */
  const nextSeed = (): number => {
    while (cursor < triCount && (assigned[order[cursor] as number] as number) >= 0) cursor++;
    return cursor < triCount ? (order[cursor] as number) : -1;
  };
  // Centroids for the continuation distance test.
  const cen = new Float32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const v = (indices[t * 3 + k] as number) * 3;
      cen[t * 3] = (cen[t * 3] as number) + (positions[v] as number) / 3;
      cen[t * 3 + 1] = (cen[t * 3 + 1] as number) + (positions[v + 1] as number) / 3;
      cen[t * 3 + 2] = (cen[t * 3 + 2] as number) + (positions[v + 2] as number) / 3;
    }
  }
  for (let seed = nextSeed(); seed >= 0; seed = nextSeed()) {
    let head = 0;
    let tail = 0;
    let size = 0;
    let sx = 0, sy = 0, sz = 0;
    let s = seed;
    while (size < cap && s >= 0) {
      if (queued[s] !== cluster) {
        queued[s] = cluster;
        queue[tail++] = s;
      }
      while (head < tail && size < cap) {
        const t = queue[head++] as number;
        if ((assigned[t] as number) >= 0) continue;
        assigned[t] = cluster;
        out[written++] = indices[t * 3] as number;
        out[written++] = indices[t * 3 + 1] as number;
        out[written++] = indices[t * 3 + 2] as number;
        sx += cen[t * 3] as number;
        sy += cen[t * 3 + 1] as number;
        sz += cen[t * 3 + 2] as number;
        size++;
        for (let k = 0; k < 3; k++) {
          const v = vid(t * 3 + k);
          const end = offs[v + 1] as number;
          for (let j = offs[v] as number; j < end; j++) {
            const n = adj[j] as number;
            if ((assigned[n] as number) < 0 && queued[n] !== cluster) {
              queued[n] = cluster;
              queue[tail++] = n;
            }
          }
        }
      }
      if (size >= cap) break;
      // The connected patch ran out (a hole left by earlier clusters): continue with the
      // nearest of the next few unassigned triangles in Morton order, but only when it is
      // close to this cluster; otherwise the cluster ends small rather than scattered.
      const first = nextSeed();
      s = -1;
      if (first < 0) break;
      const mx = sx / size, my = sy / size, mz = sz / size;
      let best = -1;
      let bestD = Infinity;
      for (let i = cursor, seen = 0; i < triCount && seen < 16; i++) {
        const t = order[i] as number;
        if ((assigned[t] as number) >= 0) continue;
        seen++;
        const dx = (cen[t * 3] as number) - mx, dy = (cen[t * 3 + 1] as number) - my, dz = (cen[t * 3 + 2] as number) - mz;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = t;
        }
      }
      if (best >= 0 && bestD <= reach2(ext, size, triCount)) s = best;
    }
    offsets.push(written);
    cluster++;
  }
  return { indices: out, offsets: Uint32Array.from(offsets), count: cluster };
}

/**
 * Squared distance within which a continuation seed may join a cluster:
 * about twice the expected radius of a cluster of `size` triangles on a
 * mesh of extent `ext` with `total` triangles.
 */
function reach2(ext: number, size: number, total: number): number {
  const r = ext * Math.sqrt(Math.max(size, 8) / Math.max(total, 1)) * 2;
  return r * r;
}

/**
 * Split `indices` into ⌈n / maxTriangles⌉ equal clusters along the Morton
 * order of the triangle centroids: balanced, compact pieces for the small
 * simplified groups of a DAG level (no fragments).
 */
export function splitClusters(positions: Float32Array, indices: Uint32Array, maxTriangles = CLUSTER_TRIANGLES): ClusterSet {
  const triCount = Math.floor(indices.length / 3);
  if (triCount === 0) return { indices: new Uint32Array(0), offsets: new Uint32Array(1), count: 0 };
  const parts = Math.ceil(triCount / Math.max(1, maxTriangles));
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < triCount * 3; i++) {
    const v = (indices[i] as number) * 3;
    const x = positions[v] as number, y = positions[v + 1] as number, z = positions[v + 2] as number;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const ext = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-9);
  const keys = new Uint32Array(triCount);
  const order0 = new Uint32Array(triCount);
  for (let t = 0; t < triCount; t++) {
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < 3; k++) {
      const v = (indices[t * 3 + k] as number) * 3;
      cx += positions[v] as number;
      cy += positions[v + 1] as number;
      cz += positions[v + 2] as number;
    }
    keys[t] = morton3((cx / 3 - minX) / ext, (cy / 3 - minY) / ext, (cz / 3 - minZ) / ext);
    order0[t] = t;
  }
  const order = radixSortByKey(order0, keys, triCount, new Uint32Array(triCount));
  const out = new Uint32Array(triCount * 3);
  const offsets = new Uint32Array(parts + 1);
  for (let i = 0; i < triCount; i++) {
    const t = order[i] as number;
    out[i * 3] = indices[t * 3] as number;
    out[i * 3 + 1] = indices[t * 3 + 1] as number;
    out[i * 3 + 2] = indices[t * 3 + 2] as number;
  }
  for (let p = 0; p <= parts; p++) offsets[p] = Math.round((p * triCount) / parts) * 3;
  return { indices: out, offsets, count: parts };
}

/** Bounding spheres and normal cones of every cluster of `set`. */
export function clusterBounds(positions: Float32Array, set: ClusterSet): ClusterBounds {
  const spheres = new Float32Array(set.count * 4);
  const cones = new Float32Array(set.count * 4);
  for (let c = 0; c < set.count; c++) {
    const a = set.offsets[c] as number;
    const b = set.offsets[c + 1] as number;
    sphereOfIndices(positions, set.indices, a, b, spheres, c * 4);
    // Area-weighted mean normal, then the widest deviation from it.
    let ax = 0, ay = 0, az = 0;
    for (let i = a; i < b; i += 3) {
      triNormal(positions, set.indices, i);
      ax += _n[0] as number;
      ay += _n[1] as number;
      az += _n[2] as number;
    }
    const len = Math.hypot(ax, ay, az);
    let sinHalf = 1;
    if (len > 1e-12) {
      ax /= len;
      ay /= len;
      az /= len;
      let minDot = 1;
      for (let i = a; i < b; i += 3) {
        const area2 = triNormal(positions, set.indices, i);
        if (area2 <= 0) continue;
        const d = ((_n[0] as number) * ax + (_n[1] as number) * ay + (_n[2] as number) * az) / area2;
        if (d < minDot) minDot = d;
      }
      // Cone half angle α with cos α = minDot; store sin α (≥ 1 when α ≥ 90°: never culled).
      sinHalf = minDot <= 0 ? 1 : Math.sqrt(Math.max(0, 1 - minDot * minDot));
    }
    cones[c * 4] = ax;
    cones[c * 4 + 1] = ay;
    cones[c * 4 + 2] = az;
    cones[c * 4 + 3] = len > 1e-12 ? sinHalf : 1;
  }
  return { spheres, cones };
}

const _n = new Float64Array(3);

/** Unnormalised normal of the triangle at index offset `i` into `_n`; returns its length (2 × area). */
function triNormal(p: Float32Array, idx: Uint32Array, i: number): number {
  const a = (idx[i] as number) * 3;
  const b = (idx[i + 1] as number) * 3;
  const c = (idx[i + 2] as number) * 3;
  const ux = (p[b] as number) - (p[a] as number), uy = (p[b + 1] as number) - (p[a + 1] as number), uz = (p[b + 2] as number) - (p[a + 2] as number);
  const vx = (p[c] as number) - (p[a] as number), vy = (p[c + 1] as number) - (p[a + 1] as number), vz = (p[c + 2] as number) - (p[a + 2] as number);
  _n[0] = uy * vz - uz * vy;
  _n[1] = uz * vx - ux * vz;
  _n[2] = ux * vy - uy * vx;
  return Math.hypot(_n[0], _n[1], _n[2]);
}

/** Bounding sphere (AABB centre, max distance) of the vertices referenced by `idx[a..b)` into `out[o..o+4)`. */
export function sphereOfIndices(p: Float32Array, idx: Uint32Array, a: number, b: number, out: Float32Array, o: number): void {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = a; i < b; i++) {
    const v = (idx[i] as number) * 3;
    const x = p[v] as number, y = p[v + 1] as number, z = p[v + 2] as number;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  if (a >= b) {
    out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
    return;
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  let r2 = 0;
  for (let i = a; i < b; i++) {
    const v = (idx[i] as number) * 3;
    const dx = (p[v] as number) - cx, dy = (p[v + 1] as number) - cy, dz = (p[v + 2] as number) - cz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d > r2) r2 = d;
  }
  out[o] = cx;
  out[o + 1] = cy;
  out[o + 2] = cz;
  // Grow by one float ulp-ish margin so float32 storage stays conservative.
  out[o + 3] = Math.sqrt(r2) * (1 + 1e-6) + 1e-7;
}

/** Smallest sphere (approximate) enclosing two spheres. */
export function mergeSpheres(s: Float32Array, a: number, t: Float32Array, b: number, out: Float32Array, o: number): void {
  const ax = s[a] as number, ay = s[a + 1] as number, az = s[a + 2] as number, ar = s[a + 3] as number;
  const bx = t[b] as number, by = t[b + 1] as number, bz = t[b + 2] as number, br = t[b + 3] as number;
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const d = Math.hypot(dx, dy, dz);
  if (d + br <= ar) {
    out[o] = ax; out[o + 1] = ay; out[o + 2] = az; out[o + 3] = ar;
    return;
  }
  if (d + ar <= br) {
    out[o] = bx; out[o + 1] = by; out[o + 2] = bz; out[o + 3] = br;
    return;
  }
  const r = (d + ar + br) / 2;
  const k = (r - ar) / d;
  out[o] = ax + dx * k;
  out[o + 1] = ay + dy * k;
  out[o + 2] = az + dz * k;
  out[o + 3] = r * (1 + 1e-6);
}
