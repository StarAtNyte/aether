/**
 * Bounding-volume hierarchy over a mesh's triangles for fast raycasts.
 *
 * three.js tests every triangle of a mesh on each raycast. Picking, gizmo
 * snapping, brushes and the chase camera's occlusion test (every play frame)
 * all raycast the scene, so a 130k-triangle terrain cost milliseconds per
 * ray. {@link accelerateRaycast} swaps a large mesh's `raycast` for a BVH
 * traversal that returns the nearest hit, with the same `Intersection`
 * fields three.js produces (`distance`, `point`, `face` with `a/b/c` and an
 * object-space `normal`, `faceIndex`, `object`), the same material-side
 * culling and the same near/far filtering.
 *
 * The tree is warmed in a worker, or built lazily on the first raycast (a linear BVH: triangles
 * sorted by the Morton code of their centroids, at most
 * {@link LEAF_TRIANGLES} per leaf), cached per geometry, and refitted in
 * O(n) when the position attribute changes
 * (mesh editing previews), rebuilt when the index changes. Traversal and
 * refits allocate nothing; a hit allocates its result record, like three.
 *
 * Meshes with geometry groups, multi-materials, morph targets, skinning or a
 * custom draw range keep three's own raycast.
 */
import { BackSide, DoubleSide, Matrix4, Mesh, Ray, Sphere, Vector3, type BufferAttribute, type BufferGeometry, type Intersection, type Material, type Object3D, type Raycaster } from 'three';

import { buildTriangleBvh, refitTriangleBvh, type TriangleBvh } from './raycast-bvh-build';
import { BvhBuildClient } from './raycast-bvh-client';
export type { TriangleBvh } from './raycast-bvh-build';
const LEAF_BIT = 0x80000000;

/** Meshes with fewer triangles keep three's brute-force raycast (cheaper than a tree). */
export const BVH_MIN_TRIANGLES = 512;
/** Triangles per leaf. */
export { LEAF_TRIANGLES } from './raycast-bvh-build';
/** Traversal stack depth (Morton splits: at most 30 code bits plus log2(n) equal-code halvings). */
const STACK_SIZE = 96;

const cache = new WeakMap<BufferGeometry, TriangleBvh>();
const warmups = new WeakMap<BufferGeometry, Promise<void>>();
const bvhBuilds = new BvhBuildClient();

/** Initial camera sight tests should await warmup rather than forcing cold BVHs onto the UI thread. */
export async function warmRaycastTrees(root: Object3D, boundMs = Infinity): Promise<void> {
  if (!bvhBuilds.available) return;
  const geometries = new Set<BufferGeometry>();
  root.traverse(object => {
    const mesh = object as Mesh;
    if (mesh.isMesh && mesh.raycast === bvhRaycast && bvhEligible(mesh)) geometries.add(mesh.geometry);
  });
  performance.mark(`aether:bvh-warm-${geometries.size}`);
  const all = Promise.all([...geometries].map(geometry => warmTriangleBvh(geometry))).then(() => undefined);
  // Bounded: the builds go on in the worker, and a pick that needs a tree before it is done builds it itself.
  if (!Number.isFinite(boundMs)) await all;
  else await Promise.race([all, new Promise<void>(resolve => setTimeout(resolve, boundMs))]);
}

/** Build the idle picking cache off-thread; never install results for edited or disposed geometry. */
export function warmTriangleBvh(geometry: BufferGeometry, client = bvhBuilds): Promise<void> {
  const pending = warmups.get(geometry);
  if (pending) return pending;
  const raw = plainArrays(geometry), position = geometry.getAttribute('position') as BufferAttribute | undefined;
  const index = geometry.getIndex(), n = triangleCount(geometry);
  if (!raw || !position || n < BVH_MIN_TRIANGLES) return Promise.resolve();
  const positionVersion = position.version, indexVersion = index?.version ?? 0;
  const current = cache.get(geometry);
  if (current && current.positions === raw.p && current.index === raw.idx && current.triangleCount === n
    && current.positionVersion === positionVersion && current.indexVersion === indexVersion) return Promise.resolve();
  let disposed = false;
  const onDispose = (): void => { disposed = true; };
  geometry.addEventListener('dispose', onDispose);
  const install = (result: Awaited<ReturnType<BvhBuildClient['build']>>): void => {
    if (disposed || geometry.getAttribute('position') !== position || geometry.getIndex() !== index
      || position.array !== raw.p || position.version !== positionVersion || (index?.array ?? null) !== raw.idx
      || (index?.version ?? 0) !== indexVersion || triangleCount(geometry) !== n) return;
    // A real pick may have built/refitted the current tree while warmup was pending. Preserve its identity.
    const existing = cache.get(geometry);
    if (existing && existing.positions === raw.p && existing.index === raw.idx && existing.triangleCount === n
      && existing.positionVersion === positionVersion && existing.indexVersion === indexVersion) return;
    if (result) cache.set(geometry, { ...result, positions: raw.p, index: raw.idx, positionVersion, indexVersion });
    else triangleBvh(geometry);
  };
  const done = client.build(raw.p, raw.idx as Uint16Array | Uint32Array | null, n).then(result => {
    if (result) install(result);
    // A failed worker must not turn every queued warmup into one uninterruptible microtask chain.
    else return new Promise<void>(resolve => onIdle(() => { install(null); resolve(); }));
  }).finally(() => { geometry.removeEventListener('dispose', onDispose); warmups.delete(geometry); });
  warmups.set(geometry, done);
  return done;
}

function triangleCount(g: BufferGeometry): number {
  const index = g.getIndex();
  const pos = g.getAttribute('position');
  if (!pos) return 0;
  return Math.floor((index ? index.count : pos.count) / 3);
}

/** Vertex id of corner `k` (0..2) of triangle `t`. */
function vertex(index: BufferAttribute | null, t: number, k: number): number {
  return index ? index.getX(t * 3 + k) : t * 3 + k;
}

/** True when a mesh can use the BVH raycast. */
export function bvhEligible(mesh: Mesh): boolean {
  const g = mesh.geometry as BufferGeometry | undefined;
  if (!g || Array.isArray(mesh.material) || g.groups.length > 0) return false;
  if (Object.keys(g.morphAttributes).length > 0 || (mesh as Mesh & { isSkinnedMesh?: boolean }).isSkinnedMesh === true) return false;
  if (g.drawRange.start !== 0 || (Number.isFinite(g.drawRange.count) && g.drawRange.count < (g.getIndex()?.count ?? g.getAttribute('position')?.count ?? 0))) return false;
  return plainArrays(g) !== null && triangleCount(g) >= BVH_MIN_TRIANGLES;
}

/** Raw arrays of a geometry with plain (non-interleaved, non-normalized) float32 xyz positions. */
function plainArrays(g: BufferGeometry): { p: Float32Array; idx: ArrayLike<number> | null } | null {
  const pos = g.getAttribute('position') as (BufferAttribute & { isInterleavedBufferAttribute?: boolean }) | undefined;
  if (!pos || pos.isInterleavedBufferAttribute === true || pos.itemSize !== 3 || pos.normalized || !(pos.array instanceof Float32Array)) return null;
  const index = g.getIndex();
  if (index && !(index.array instanceof Uint32Array || index.array instanceof Uint16Array)) return null;
  return { p: pos.array, idx: index ? index.array : null };
}

/** Build (or fetch, refit or rebuild) the BVH of `geometry`. */
export function triangleBvh(geometry: BufferGeometry): TriangleBvh | null {
  const pos = geometry.getAttribute('position') as BufferAttribute | undefined;
  if (!pos) return null;
  const index = geometry.getIndex();
  const n = triangleCount(geometry);
  const cached = cache.get(geometry);
  if (cached && cached.triangleCount === n && cached.indexVersion === (index?.version ?? 0) && cached.positions === pos.array && cached.index === (index ? index.array : null)) {
    if (cached.positionVersion !== pos.version) {
      refitTriangleBvh(cached, cached.positions, cached.index);
      cached.positionVersion = pos.version;
    }
    return cached;
  }
  const raw = plainArrays(geometry);
  if (!raw) return null;
  const built = buildTriangleBvh(raw.p, raw.idx, n, pos.version, index?.version ?? 0);
  cache.set(geometry, built);
  return built;
}

// Scratch (module-level: raycasts are synchronous and never re-entrant).
const _inverse = new Matrix4();
const _ray = new Ray();
const _sphere = new Sphere();
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _point = new Vector3();
const _stack = new Int32Array(STACK_SIZE);
const _edge1 = new Vector3();
const _edge2 = new Vector3();

/**
 * Scalars shared with the inner functions through typed arrays: passing or
 * returning doubles across non-inlined calls boxes them (a heap number per
 * call), which would allocate per visited node.
 * `_rayS`: origin xyz, direction xyz, inverse direction xyz, culling side.
 */
const _out = new Float64Array(2);
const _rayS = new Float64Array(10);
/** Current best hit distance during a traversal (read by {@link boxEntry}). */
const _best = new Float64Array(1);

/** Slab test: true when the ray enters node `b`'s box before `far`; the entry distance goes to `_out[0]`. */
function boxEntry(boxes: Float32Array, b: number): boolean {
  const far = _best[0] as number;
  const r = _rayS;
  const ox = r[0] as number, oy = r[1] as number, oz = r[2] as number;
  const ix = r[6] as number, iy = r[7] as number, iz = r[8] as number;
  let t1 = ((boxes[b] as number) - ox) * ix;
  let t2 = ((boxes[b + 3] as number) - ox) * ix;
  let tmin = Math.min(t1, t2);
  let tmax = Math.max(t1, t2);
  t1 = ((boxes[b + 1] as number) - oy) * iy;
  t2 = ((boxes[b + 4] as number) - oy) * iy;
  tmin = Math.max(tmin, Math.min(t1, t2));
  tmax = Math.min(tmax, Math.max(t1, t2));
  t1 = ((boxes[b + 2] as number) - oz) * iz;
  t2 = ((boxes[b + 5] as number) - oz) * iz;
  tmin = Math.max(tmin, Math.min(t1, t2));
  tmax = Math.min(tmax, Math.max(t1, t2));
  if (Number.isNaN(tmin) || Number.isNaN(tmax)) return false;
  if (tmax >= Math.max(tmin, 0) && tmin <= far) {
    _out[0] = Math.max(tmin, 0);
    return true;
  }
  return false;
}

/**
 * Nearest local-space hit along `ray` (Möller–Trumbore). Returns the hit
 * distance (in local ray units) and writes the triangle id into `out[0]`,
 * or Infinity when nothing is hit before the optional local-space upper bound.
 */
export function bvhNearest(tree: TriangleBvh, p: Float32Array, idx: ArrayLike<number> | null, ray: Ray, side: number, out: Int32Array, maxDistance = Infinity): number {
  const { boxes, nodes, tris } = tree;
  const dx = ray.direction.x, dy = ray.direction.y, dz = ray.direction.z;
  const r = _rayS;
  r[0] = ray.origin.x;
  r[1] = ray.origin.y;
  r[2] = ray.origin.z;
  r[3] = dx;
  r[4] = dy;
  r[5] = dz;
  // Axis-parallel rays: a huge finite inverse instead of Infinity avoids 0 × ∞ = NaN in the slab test.
  r[6] = dx !== 0 ? 1 / dx : 1e30;
  r[7] = dy !== 0 ? 1 / dy : 1e30;
  r[8] = dz !== 0 ? 1 / dz : 1e30;
  r[9] = side;
  let best = maxDistance;
  _best[0] = best;
  let bestTri = -1;
  let sp = 0;
  _stack[sp++] = 0;
  while (sp > 0) {
    const node = _stack[--sp] as number;
    if (!boxEntry(boxes, node * 6)) continue;
    const meta = nodes[node * 2 + 1] as number;
    if ((meta & LEAF_BIT) !== 0) {
      const start = nodes[node * 2] as number;
      const count = meta & ~LEAF_BIT;
      for (let i = start; i < start + count; i++) {
        const t = tris[i] as number;
        const a = (idx ? (idx[t * 3] as number) : t * 3) * 3;
        const b = (idx ? (idx[t * 3 + 1] as number) : t * 3 + 1) * 3;
        const c = (idx ? (idx[t * 3 + 2] as number) : t * 3 + 2) * 3;
        _a.set(p[a] as number, p[a + 1] as number, p[a + 2] as number);
        _b.set(p[b] as number, p[b + 1] as number, p[b + 2] as number);
        _c.set(p[c] as number, p[c + 1] as number, p[c + 2] as number);
        if (triangleHit() && (_out[1] as number) < best) {
          best = _out[1] as number;
          _best[0] = best;
          bestTri = t;
        }
      }
      continue;
    }
    const left = node + 1;
    const right = nodes[node * 2] as number;
    if (sp + 2 > STACK_SIZE) continue; // pathological depth: skip rather than overflow
    // Visit the nearer child first.
    const tl = boxEntry(boxes, left * 6) ? (_out[0] as number) : Infinity;
    const tr = boxEntry(boxes, right * 6) ? (_out[0] as number) : Infinity;
    if (tl <= tr) {
      if (tr !== Infinity) _stack[sp++] = right;
      if (tl !== Infinity) _stack[sp++] = left;
    } else {
      if (tl !== Infinity) _stack[sp++] = left;
      if (tr !== Infinity) _stack[sp++] = right;
    }
  }
  out[0] = bestTri;
  return bestTri < 0 ? Infinity : best;
}

/** Ray/triangle (_a, _b, _c) test with three's material-side culling; the hit distance goes to `_out[1]`. */
function triangleHit(): boolean {
  const r = _rayS;
  const ox = r[0] as number, oy = r[1] as number, oz = r[2] as number;
  const dx = r[3] as number, dy = r[4] as number, dz = r[5] as number;
  const side = r[9] as number;
  _edge1.subVectors(_b, _a);
  _edge2.subVectors(_c, _a);
  // p = d × e2
  const px = dy * _edge2.z - dz * _edge2.y;
  const py = dz * _edge2.x - dx * _edge2.z;
  const pz = dx * _edge2.y - dy * _edge2.x;
  const det = _edge1.x * px + _edge1.y * py + _edge1.z * pz;
  // det = e1·(d×e2) = −d·(e1×e2): positive when the ray meets the front face (as three.js decides it).
  if (side === DoubleSide) {
    if (Math.abs(det) < 1e-12) return false;
  } else if (side === BackSide) {
    if (det > -1e-12) return false;
  } else if (det < 1e-12) {
    return false;
  }
  const inv = 1 / det;
  const tx = ox - _a.x, ty = oy - _a.y, tz = oz - _a.z;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return false;
  const qx = ty * _edge1.z - tz * _edge1.y;
  const qy = tz * _edge1.x - tx * _edge1.z;
  const qz = tx * _edge1.y - ty * _edge1.x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < 0 || u + v > 1) return false;
  const t = (_edge2.x * qx + _edge2.y * qy + _edge2.z * qz) * inv;
  if (!(t >= 0)) return false;
  _out[1] = t;
  return true;
}

const _hit = new Int32Array(1);

/** `Mesh.raycast` replacement backed by the BVH (nearest hit only). */
export function bvhRaycast(this: Mesh, raycaster: Raycaster, intersects: Intersection[]): void {
  const geometry = this.geometry as BufferGeometry;
  const material = this.material as Material;
  if (!material || (material as Material & { visible?: boolean }).visible === false) return;
  if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
  _sphere.copy(geometry.boundingSphere as Sphere).applyMatrix4(this.matrixWorld);
  if (!raycaster.ray.intersectsSphere(_sphere)) return;
  const tree = triangleBvh(geometry);
  const pos = geometry.getAttribute('position') as BufferAttribute | undefined;
  if (!tree || !pos) {
    Mesh.prototype.raycast.call(this, raycaster, intersects);
    return;
  }
  const index = geometry.getIndex();
  _inverse.copy(this.matrixWorld).invert();
  _ray.copy(raycaster.ray).applyMatrix4(_inverse);
  let limit = Infinity;
  const origin = raycaster.ray.origin;
  // A cheap coverage hint avoids scale-bound setup for ordinary nearby meshes.
  if (Number.isFinite(raycaster.far) && raycaster.far >= 0 && raycaster.far < _sphere.radius
    + Math.abs(origin.x - _sphere.center.x) + Math.abs(origin.y - _sphere.center.y) + Math.abs(origin.z - _sphere.center.z)) {
    // sqrt(3) * max column norm bounds the inverse's operator norm, including shear.
    // It maps a world-space distance to a conservative local radius, not a guessed scale along the ray.
    const e = this.matrixWorld.elements;
    const rounding = (Math.abs(origin.x) + Math.abs(origin.y) + Math.abs(origin.z)
      + Math.abs(e[12]!) + Math.abs(e[13]!) + Math.abs(e[14]!)) * Number.EPSILON * 16;
    limit = (raycaster.far + rounding) * _inverse.getMaxScaleOnAxis() * Math.sqrt(3) + 1e-9;
  }
  const local = bvhNearest(tree, tree.positions, tree.index, _ray, material.side, _hit, limit);
  const tri = _hit[0] as number;
  if (local === Infinity || tri < 0) return;
  _ray.at(local, _point);
  const world = _point.clone().applyMatrix4(this.matrixWorld);
  const distance = raycaster.ray.origin.distanceTo(world);
  if (distance < raycaster.near || distance > raycaster.far) return;
  const a = vertex(index, tri, 0);
  const b = vertex(index, tri, 1);
  const c = vertex(index, tri, 2);
  _a.fromBufferAttribute(pos, a);
  _b.fromBufferAttribute(pos, b);
  _c.fromBufferAttribute(pos, c);
  const normal = new Vector3().subVectors(_c, _b).cross(_edge1.subVectors(_a, _b)).normalize();
  intersects.push({ distance, point: world, object: this, face: { a, b, c, normal, materialIndex: 0 }, faceIndex: tri });
}

type IdleScheduler = (cb: () => void) => void;

/** requestIdleCallback where available (not Safari), otherwise a short timeout. */
const onIdle: IdleScheduler = (cb) => {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (typeof ric === 'function') ric(cb, { timeout: 2000 });
  else setTimeout(cb, 250);
};

/**
 * Use the BVH raycast for `mesh` when it is large enough (no-op otherwise)
 * and warm its tree in a worker at the next idle moment. Early picks retain
 * synchronous construction; custom schedulers retain their synchronous callback.
 * Returns true when enabled.
 */
export function accelerateRaycast(mesh: Mesh, idle: IdleScheduler | null = onIdle): boolean {
  if (!(mesh instanceof Mesh) || !bvhEligible(mesh)) return false;
  mesh.raycast = bvhRaycast;
  const geometry = mesh.geometry as BufferGeometry;
  if (idle && !cache.has(geometry)) {
    let disposed = false;
    const onDispose = (): void => { disposed = true; };
    geometry.addEventListener('dispose', onDispose);
    idle(() => {
      geometry.removeEventListener('dispose', onDispose);
      // Skip geometries that were disposed or replaced in the meantime.
      if (!disposed && mesh.geometry === geometry && geometry.getAttribute('position')) {
        if (idle === onIdle) void warmTriangleBvh(geometry);
        else triangleBvh(geometry);
      }
    });
  }
  return true;
}
