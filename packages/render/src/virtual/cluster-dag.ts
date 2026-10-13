/**
 * Cluster LOD DAG — the data structure behind virtual geometry
 * ("Nanite-style" continuous level of detail).
 *
 * Build (offline, in a worker for big meshes):
 *
 * 1. Level 0: the source triangles split into ~128-triangle clusters.
 * 2. Repeat per level: group ~4 adjacent clusters, merge their triangles,
 *    simplify the group to half with the group's outer boundary locked (so
 *    neighbouring groups always meet without cracks), and split the result
 *    into new, coarser clusters. Every new cluster records the group it
 *    came from (its children) and the group's error and bounding sphere.
 * 3. Stop when a level no longer reduces or one cluster remains.
 *
 * Errors accumulate (parent ≥ child) and every group sphere encloses its
 * children's spheres, so the projected error is monotone up the DAG. A
 * cluster is drawn when its own projected error is below the threshold but
 * its parents' is not; because all clusters made from one group share the
 * same error and sphere, that local rule always selects a watertight cut.
 *
 * Simplification is by half-edge collapse, so every level indexes the
 * original vertex array and all LODs share one vertex buffer.
 */
import { buildClusters, clusterBounds, mergeSpheres, splitClusters, CLUSTER_TRIANGLES } from './clusters';
import { simplifyMesh, weldPositions } from './simplify';
import { morton3, radixSortByKey } from './sort';

/** Floats per cluster in {@link ClusterDag.lod}. */
export const LOD_STRIDE = 10;
/** Upper bound on DAG levels (the 50 % reduction per level reaches one cluster far sooner). */
export const MAX_DAG_LEVELS = 32;
/** Clusters per group (simplified together). */
export const GROUP_SIZE = 4;
/** A group whose simplification keeps more than this share of its triangles is left as is. */
const MIN_REDUCTION = 0.85;

/** The built hierarchy (plain typed arrays: transferable to and from workers). */
export interface ClusterDag {
  vertexCount: number;
  /** All clusters' triangles, cluster `c` at `indices[offsets[c] .. offsets[c + 1])`. */
  indices: Uint32Array;
  offsets: Uint32Array;
  count: number;
  /** Culling sphere per cluster: cx, cy, cz, r. */
  spheres: Float32Array;
  /** Normal cone per cluster: axis xyz, sin(half angle) (≥ 1 = never back-face culled). */
  cones: Float32Array;
  /**
   * LOD data per cluster ({@link LOD_STRIDE} floats): own error, own LOD
   * sphere (xyzr), parent error (`Infinity` for roots), parent LOD sphere.
   */
  lod: Float32Array;
  /** Group that produced each cluster (−1 for level-0 clusters). */
  source: Int32Array;
  /** Children (clusters) of group `g`: `groupClusters[groupOffsets[g] .. groupOffsets[g + 1])`. */
  groupOffsets: Uint32Array;
  groupClusters: Uint32Array;
  /** Clusters without parents: where a cut traversal starts. */
  roots: Uint32Array;
  /** Triangles of the source mesh (level 0). */
  baseTriangles: number;
  /** Triangles of each level that was built (level 0 first). */
  levelTriangles: number[];
}

/** Options of {@link buildClusterDag}. */
export interface DagBuildOptions {
  clusterTriangles?: number;
  groupSize?: number;
  /** Called between levels (progress, cooperative yielding is the caller's job). */
  onLevel?: (level: number, clusters: number, triangles: number) => void;
}

/** Growable typed storage used while building. */
class Grow<T extends Float32Array | Uint32Array | Int32Array> {
  data: T;
  length = 0;
  constructor(private readonly make: (n: number) => T, cap: number) {
    this.data = make(Math.max(16, cap));
  }
  reserve(n: number): void {
    if (this.length + n <= this.data.length) return;
    let cap = this.data.length * 2;
    while (cap < this.length + n) cap *= 2;
    const next = this.make(cap);
    next.set(this.data.subarray(0, this.length));
    this.data = next;
  }
  push(v: number): void {
    this.reserve(1);
    this.data[this.length++] = v;
  }
  done(): T {
    return this.data.slice(0, this.length) as T;
  }
}

/** Build the cluster LOD DAG of an indexed triangle mesh. */
export function buildClusterDag(positions: Float32Array, indices: Uint32Array, opts: DagBuildOptions = {}): ClusterDag {
  const vertexCount = Math.floor(positions.length / 3);
  const clusterTris = Math.max(8, Math.floor(opts.clusterTriangles ?? CLUSTER_TRIANGLES));
  const groupSize = Math.max(2, Math.floor(opts.groupSize ?? GROUP_SIZE));
  const weld = weldPositions(positions);

  const pool = new Grow((n) => new Uint32Array(n), indices.length * 2);
  const offsets = new Grow((n) => new Uint32Array(n), 1024);
  const spheres = new Grow((n) => new Float32Array(n), 4096);
  const cones = new Grow((n) => new Float32Array(n), 4096);
  const lod = new Grow((n) => new Float32Array(n), 10240);
  const source = new Grow((n) => new Int32Array(n), 1024);
  const groupOffsets = new Grow((n) => new Uint32Array(n), 256);
  const groupClusters = new Grow((n) => new Uint32Array(n), 1024);
  offsets.push(0);
  groupOffsets.push(0);
  let count = 0;

  /** Append clusters (indices over the global vertex array) produced from group `group` with error/sphere. */
  const addClusters = (set: { indices: Uint32Array; offsets: Uint32Array; count: number }, group: number, err: number, sphere: Float32Array | null): number[] => {
    const b = clusterBounds(positions, set);
    const ids: number[] = [];
    pool.reserve(set.indices.length);
    pool.data.set(set.indices, pool.length);
    const base = pool.length;
    pool.length += set.indices.length;
    for (let c = 0; c < set.count; c++) {
      offsets.push(base + (set.offsets[c + 1] as number));
      for (let k = 0; k < 4; k++) {
        spheres.push(b.spheres[c * 4 + k] as number);
        cones.push(b.cones[c * 4 + k] as number);
      }
      lod.push(err);
      for (let k = 0; k < 4; k++) lod.push(sphere ? (sphere[k] as number) : (b.spheres[c * 4 + k] as number));
      lod.push(Infinity);
      for (let k = 0; k < 4; k++) lod.push(0);
      source.push(group);
      ids.push(count++);
    }
    return ids;
  };

  // Level 0.
  const level0 = buildClusters(positions, indices, clusterTris, weld);
  let current = addClusters(level0, -1, 0, null);
  const levelTriangles = [Math.floor(level0.indices.length / 3)];

  // Scratch shared across levels.
  const vertGroup = new Int32Array(vertexCount).fill(-1);
  const locked = new Uint8Array(vertexCount);
  const localId = new Int32Array(vertexCount).fill(-1);
  const groupSphere = new Float32Array(4);

  for (let level = 1; level < MAX_DAG_LEVELS && current.length > 1; level++) {
    const groups = formGroups(current, pool.data, offsets.data, spheres.data, weld, vertexCount, groupSize);
    // Vertices shared between groups are locked (their positions define the seams between groups).
    const touchedVerts: number[] = [];
    for (let g = 0; g < groups.length; g++) {
      for (const c of groups[g] as number[]) {
        const a = offsets.data[c] as number;
        const b = offsets.data[c + 1] as number;
        for (let i = a; i < b; i++) {
          const v = weld[pool.data[i] as number] as number;
          const prev = vertGroup[v] as number;
          if (prev === -1) {
            vertGroup[v] = g;
            touchedVerts.push(v);
          } else if (prev !== g) locked[v] = 1;
        }
      }
    }
    const next: number[] = [];
    let reduced = false;
    let levelTris = 0;
    for (const members of groups) {
      // Merge the group's triangles into a compact local mesh over welded vertices.
      let n = 0;
      for (const c of members) n += (offsets.data[c + 1] as number) - (offsets.data[c] as number);
      const localIdx = new Uint32Array(n);
      const globalOf: number[] = [];
      let w = 0;
      for (const c of members) {
        const a = offsets.data[c] as number;
        const b = offsets.data[c + 1] as number;
        for (let i = a; i < b; i++) {
          const v = weld[pool.data[i] as number] as number;
          let l = localId[v] as number;
          if (l < 0) {
            l = globalOf.length;
            localId[v] = l;
            globalOf.push(v);
          }
          localIdx[w++] = l;
        }
      }
      const m = globalOf.length;
      const localPos = new Float32Array(m * 3);
      const localLock = new Uint8Array(m);
      for (let l = 0; l < m; l++) {
        const v = globalOf[l] as number;
        localPos[l * 3] = positions[v * 3] as number;
        localPos[l * 3 + 1] = positions[v * 3 + 1] as number;
        localPos[l * 3 + 2] = positions[v * 3 + 2] as number;
        localLock[l] = locked[v] as number;
        localId[v] = -1;
      }
      const target = Math.floor(n / 6) * 3;
      const res = simplifyMesh(localPos, localIdx, { targetIndexCount: target, locked: localLock, lockBorder: true, welded: true });
      if (res.indices.length > n * MIN_REDUCTION) {
        // Cannot simplify this group (all locked, or tiny): its clusters stay roots for now.
        for (const c of members) next.push(c);
        levelTris += n / 3;
        continue;
      }
      reduced = true;
      // Group error and LOD sphere: monotone over the children.
      let childErr = 0;
      const first = members[0] as number;
      groupSphere.set(lod.data.subarray(first * LOD_STRIDE + 1, first * LOD_STRIDE + 5));
      for (const c of members) {
        const e = lod.data[c * LOD_STRIDE] as number;
        if (e > childErr) childErr = e;
        mergeSpheres(groupSphere, 0, lod.data, c * LOD_STRIDE + 1, groupSphere, 0);
      }
      const err = childErr + res.error;
      const gid = groupOffsets.length - 1;
      for (const c of members) {
        groupClusters.push(c);
        const o = c * LOD_STRIDE;
        lod.data[o + 5] = err;
        lod.data[o + 6] = groupSphere[0] as number;
        lod.data[o + 7] = groupSphere[1] as number;
        lod.data[o + 8] = groupSphere[2] as number;
        lod.data[o + 9] = groupSphere[3] as number;
      }
      groupOffsets.push(groupClusters.length);
      // Back to global (welded representative) vertex ids, then re-cluster.
      const globalIdx = new Uint32Array(res.indices.length);
      for (let i = 0; i < res.indices.length; i++) globalIdx[i] = globalOf[res.indices[i] as number] as number;
      const set = splitClusters(positions, globalIdx, clusterTris);
      for (const id of addClusters(set, gid, err, groupSphere)) next.push(id);
      levelTris += globalIdx.length / 3;
    }
    for (const v of touchedVerts) {
      vertGroup[v] = -1;
      locked[v] = 0;
    }
    if (!reduced) break;
    levelTriangles.push(Math.round(levelTris));
    opts.onLevel?.(level, next.length, Math.round(levelTris));
    current = next;
  }

  const lodData = lod.done();
  const roots: number[] = [];
  for (let c = 0; c < count; c++) if (lodData[c * LOD_STRIDE + 5] === Infinity) roots.push(c);
  return {
    vertexCount,
    indices: pool.done(),
    offsets: offsets.done(),
    count,
    spheres: spheres.done(),
    cones: cones.done(),
    lod: lodData,
    source: source.done(),
    groupOffsets: groupOffsets.done(),
    groupClusters: groupClusters.done(),
    roots: Uint32Array.from(roots),
    baseTriangles: Math.floor(indices.length / 3),
    levelTriangles,
  };
}

/**
 * Partition clusters into groups of up to `size` adjacent clusters (sharing
 * welded vertices), seeded in Morton order so groups are compact.
 */
function formGroups(ids: number[], pool: Uint32Array, offsets: Uint32Array, spheres: Float32Array, weld: Uint32Array, vertexCount: number, size: number): number[][] {
  const n = ids.length;
  // Vertex → local cluster CSR.
  const vOff = new Uint32Array(vertexCount + 1);
  for (let k = 0; k < n; k++) {
    const c = ids[k] as number;
    for (let i = offsets[c] as number; i < (offsets[c + 1] as number); i++) vOff[(weld[pool[i] as number] as number) + 1]++;
  }
  for (let v = 0; v < vertexCount; v++) vOff[v + 1] = (vOff[v + 1] as number) + (vOff[v] as number);
  const vClusters = new Uint32Array(vOff[vertexCount] as number);
  const fill = new Uint32Array(vertexCount);
  for (let k = 0; k < n; k++) {
    const c = ids[k] as number;
    for (let i = offsets[c] as number; i < (offsets[c + 1] as number); i++) {
      const v = weld[pool[i] as number] as number;
      vClusters[(vOff[v] as number) + (fill[v] as number)] = k;
      fill[v]++;
    }
  }
  // Morton order of cluster centres.
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const c of ids) {
    const x = spheres[c * 4] as number, y = spheres[c * 4 + 1] as number, z = spheres[c * 4 + 2] as number;
    minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
  }
  const ext = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-9);
  const keys = new Uint32Array(n);
  const order0 = new Uint32Array(n);
  for (let k = 0; k < n; k++) {
    const c = ids[k] as number;
    keys[k] = morton3(((spheres[c * 4] as number) - minX) / ext, ((spheres[c * 4 + 1] as number) - minY) / ext, ((spheres[c * 4 + 2] as number) - minZ) / ext);
    order0[k] = k;
  }
  const order = radixSortByKey(order0, keys, n, new Uint32Array(n));

  const assigned = new Uint8Array(n);
  const shared = new Uint32Array(n);
  const stamp = new Uint32Array(n);
  let round = 0;
  const groups: number[][] = [];
  for (let s = 0; s < n; s++) {
    const seed = order[s] as number;
    if (assigned[seed]) continue;
    assigned[seed] = 1;
    const members = [seed];
    while (members.length < size) {
      round++;
      let best = -1;
      let bestShared = 0;
      for (const k of members) {
        const c = ids[k] as number;
        for (let i = offsets[c] as number; i < (offsets[c + 1] as number); i++) {
          const v = weld[pool[i] as number] as number;
          for (let j = vOff[v] as number; j < (vOff[v + 1] as number); j++) {
            const o = vClusters[j] as number;
            if (assigned[o]) continue;
            if (stamp[o] !== round) {
              stamp[o] = round;
              shared[o] = 0;
            }
            shared[o]++;
            if ((shared[o] as number) > bestShared) {
              bestShared = shared[o] as number;
              best = o;
            }
          }
        }
      }
      if (best < 0) break;
      assigned[best] = 1;
      members.push(best);
    }
    groups.push(members.map((k) => ids[k] as number));
  }
  return groups;
}

/** Camera description for {@link selectCut}, in the mesh's object space. */
export interface CutView {
  /** Camera position (object space). */
  cx: number;
  cy: number;
  cz: number;
  /** Pixels per object unit at distance 1 (projection scale × object scale). */
  pixelScale: number;
  /** Largest acceptable projected error in pixels. */
  threshold: number;
  /** Frustum planes (nx, ny, nz, d; inside where n·p + d ≥ 0), normalised; null disables culling. */
  planes: Float64Array | null;
  /** Back-face cluster culling (only for single-sided materials). */
  backface: boolean;
}

/** Reusable traversal state for {@link selectCut} (one per DAG). */
export interface CutScratch {
  stack: Uint32Array;
  groupStamp: Uint32Array;
  stamp: number;
}

/** Scratch sized for `dag`. */
export function createCutScratch(dag: ClusterDag): CutScratch {
  return { stack: new Uint32Array(Math.max(1, dag.count)), groupStamp: new Uint32Array(Math.max(1, dag.groupOffsets.length - 1)), stamp: 0 };
}

/** Distance floor for error projection (avoids division blow-up inside a sphere). */
const NEAR = 1e-3;

/** Projected error (pixels) of `err` for a LOD sphere at `lod[o..o+4)`. */
function projected(lod: Float32Array, o: number, err: number, v: CutView): number {
  if (err === 0) return 0;
  if (err === Infinity) return Infinity;
  const dx = (lod[o] as number) - v.cx;
  const dy = (lod[o + 1] as number) - v.cy;
  const dz = (lod[o + 2] as number) - v.cz;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - (lod[o + 3] as number);
  return (err * v.pixelScale) / (d > NEAR ? d : NEAR);
}

/** True when a sphere is completely outside one of the planes. */
function sphereOutside(planes: Float64Array, x: number, y: number, z: number, r: number): boolean {
  for (let p = 0; p < planes.length; p += 4) {
    if ((planes[p] as number) * x + (planes[p + 1] as number) * y + (planes[p + 2] as number) * z + (planes[p + 3] as number) < -r) return true;
  }
  return false;
}

/**
 * Select the clusters to draw for `view` into `out` (cluster ids); returns
 * how many. Subtrees outside the frustum are skipped, and selected clusters
 * are frustum- and (optionally) back-face culled with their own bounds.
 * Allocation-free; O(selected + refined) clusters.
 */
export function selectCut(dag: ClusterDag, view: CutView, out: Uint32Array, s: CutScratch): number {
  const { lod, spheres, cones, source, groupOffsets, groupClusters } = dag;
  const planes = view.planes;
  s.stamp = (s.stamp + 1) >>> 0;
  if (s.stamp === 0) {
    s.groupStamp.fill(0);
    s.stamp = 1;
  }
  let top = 0;
  for (let i = 0; i < dag.roots.length; i++) s.stack[top++] = dag.roots[i] as number;
  let n = 0;
  while (top > 0) {
    const c = s.stack[--top] as number;
    const o = c * LOD_STRIDE;
    // The LOD sphere encloses this cluster and all its descendants.
    if (planes && sphereOutside(planes, lod[o + 1] as number, lod[o + 2] as number, lod[o + 3] as number, lod[o + 4] as number)) continue;
    const g = source[c] as number;
    if (g >= 0 && projected(lod, o + 1, lod[o] as number, view) > view.threshold) {
      // Too coarse: refine into the group it was built from (once per group).
      if (s.groupStamp[g] === s.stamp) continue;
      s.groupStamp[g] = s.stamp;
      const end = groupOffsets[g + 1] as number;
      for (let j = groupOffsets[g] as number; j < end; j++) s.stack[top++] = groupClusters[j] as number;
      continue;
    }
    // Draw this cluster unless culled by its own bounds.
    const q = c * 4;
    const x = spheres[q] as number, y = spheres[q + 1] as number, z = spheres[q + 2] as number, r = spheres[q + 3] as number;
    if (planes && sphereOutside(planes, x, y, z, r)) continue;
    if (view.backface && backfacing(cones, q, x - view.cx, y - view.cy, z - view.cz, r)) continue;
    out[n++] = c;
  }
  return n;
}

/**
 * Normal-cone back-face test with the cluster's bounding sphere: every
 * triangle faces away from the camera when the view vector `v` (camera →
 * centre) lies within (90° − α) of the cone axis, with margin for the
 * sphere radius.
 */
export function backfacing(cones: Float32Array, q: number, vx: number, vy: number, vz: number, r: number): boolean {
  const sinA = cones[q + 3] as number;
  if (sinA >= 1) return false;
  const len = Math.sqrt(vx * vx + vy * vy + vz * vz);
  if (len <= r) return false;
  const cosT = ((cones[q] as number) * vx + (cones[q + 1] as number) * vy + (cones[q + 2] as number) * vz) / len;
  if (cosT <= 0) return false;
  const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
  const cosA = Math.sqrt(Math.max(0, 1 - sinA * sinA));
  // cos(θ + α) · |v| ≥ r  ⇒  every point of the sphere sees only back faces.
  return (cosT * cosA - sinT * sinA) * len >= r;
}

/** Copy the triangles of `count` selected clusters into `target`; returns the index count written (stops at capacity). */
export function assembleCut(dag: ClusterDag, selected: Uint32Array, count: number, target: Uint32Array): number {
  let w = 0;
  for (let i = 0; i < count; i++) {
    const c = selected[i] as number;
    const a = dag.offsets[c] as number;
    const b = dag.offsets[c + 1] as number;
    if (w + (b - a) > target.length) break;
    // Element loop instead of set(subarray): no view object per cluster on the per-frame path.
    for (let i = a; i < b; i++) target[w++] = dag.indices[i] as number;
  }
  return w;
}

/** Index count of the selected clusters. */
export function cutIndexCount(dag: ClusterDag, selected: Uint32Array, count: number): number {
  let n = 0;
  for (let i = 0; i < count; i++) {
    const c = selected[i] as number;
    n += (dag.offsets[c + 1] as number) - (dag.offsets[c] as number);
  }
  return n;
}
