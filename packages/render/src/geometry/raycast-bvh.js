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
 * The tree is built lazily on the first raycast (a linear BVH: triangles
 * sorted by the Morton code of their centroids, at most
 * {@link LEAF_TRIANGLES} per leaf), cached per geometry, and refitted in
 * O(n) when the position attribute changes
 * (mesh editing previews), rebuilt when the index changes. Traversal and
 * refits allocate nothing; a hit allocates its result record, like three.
 *
 * Meshes with geometry groups, multi-materials, morph targets, skinning or a
 * custom draw range keep three's own raycast.
 */
import { BackSide, DoubleSide, Matrix4, Mesh, Ray, Sphere, Vector3 } from 'three';
/** Meshes with fewer triangles keep three's brute-force raycast (cheaper than a tree). */
export const BVH_MIN_TRIANGLES = 512;
/** Triangles per leaf. */
export const LEAF_TRIANGLES = 8;
/** Traversal stack depth (Morton splits: at most 30 code bits plus log2(n) equal-code halvings). */
const STACK_SIZE = 96;
const LEAF_BIT = 0x80000000;
const cache = new WeakMap();
function triangleCount(g) {
    const index = g.getIndex();
    const pos = g.getAttribute('position');
    if (!pos)
        return 0;
    return Math.floor((index ? index.count : pos.count) / 3);
}
/** Vertex id of corner `k` (0..2) of triangle `t`. */
function vertex(index, t, k) {
    return index ? index.getX(t * 3 + k) : t * 3 + k;
}
/** True when a mesh can use the BVH raycast. */
export function bvhEligible(mesh) {
    const g = mesh.geometry;
    if (!g || Array.isArray(mesh.material) || g.groups.length > 0)
        return false;
    if (Object.keys(g.morphAttributes).length > 0 || mesh.isSkinnedMesh === true)
        return false;
    if (g.drawRange.start !== 0 || (Number.isFinite(g.drawRange.count) && g.drawRange.count < (g.getIndex()?.count ?? g.getAttribute('position')?.count ?? 0)))
        return false;
    return plainArrays(g) !== null && triangleCount(g) >= BVH_MIN_TRIANGLES;
}
/** Raw arrays of a geometry with plain (non-interleaved, non-normalized) float32 xyz positions. */
function plainArrays(g) {
    const pos = g.getAttribute('position');
    if (!pos || pos.isInterleavedBufferAttribute === true || pos.itemSize !== 3 || pos.normalized || !(pos.array instanceof Float32Array))
        return null;
    const index = g.getIndex();
    if (index && !(index.array instanceof Uint32Array || index.array instanceof Uint16Array))
        return null;
    return { p: pos.array, idx: index ? index.array : null };
}
/** Build (or fetch, refit or rebuild) the BVH of `geometry`. */
export function triangleBvh(geometry) {
    const pos = geometry.getAttribute('position');
    if (!pos)
        return null;
    const index = geometry.getIndex();
    const n = triangleCount(geometry);
    const cached = cache.get(geometry);
    if (cached && cached.triangleCount === n && cached.indexVersion === (index?.version ?? 0) && cached.positions === pos.array && cached.index === (index ? index.array : null)) {
        if (cached.positionVersion !== pos.version) {
            refit(cached, cached.positions, cached.index);
            cached.positionVersion = pos.version;
        }
        return cached;
    }
    const raw = plainArrays(geometry);
    if (!raw)
        return null;
    const built = build(raw.p, raw.idx, n, pos.version, index?.version ?? 0);
    cache.set(geometry, built);
    return built;
}
/** Spread the low 10 bits of `v` so two zero bits separate each (Morton encoding). */
function spread10(v) {
    let x = v & 0x3ff;
    x = (x | (x << 16)) & 0x030000ff;
    x = (x | (x << 8)) & 0x0300f00f;
    x = (x | (x << 4)) & 0x030c30c3;
    x = (x | (x << 2)) & 0x09249249;
    return x;
}
/**
 * Linear BVH build: sort triangles by the Morton code of their centroids
 * (LSD radix sort, O(n)), split each range at the highest differing code
 * bit (binary search), then compute every box bottom-up with {@link refit}.
 * About 10x faster than a median-split build with similar query cost on
 * terrain-like meshes.
 */
function build(p, idx, n, positionVersion, indexVersion) {
    const cx = new Float32Array(n);
    const cy = new Float32Array(n);
    const cz = new Float32Array(n);
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let t = 0; t < n; t++) {
        const a = (idx ? idx[t * 3] : t * 3) * 3;
        const b = (idx ? idx[t * 3 + 1] : t * 3 + 1) * 3;
        const c = (idx ? idx[t * 3 + 2] : t * 3 + 2) * 3;
        const x = (p[a] + p[b] + p[c]) / 3;
        const y = (p[a + 1] + p[b + 1] + p[c + 1]) / 3;
        const z = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
        cx[t] = x;
        cy[t] = y;
        cz[t] = z;
        if (x < minX)
            minX = x;
        if (y < minY)
            minY = y;
        if (z < minZ)
            minZ = z;
        if (x > maxX)
            maxX = x;
        if (y > maxY)
            maxY = y;
        if (z > maxZ)
            maxZ = z;
    }
    const sx = maxX > minX ? 1023 / (maxX - minX) : 0;
    const sy = maxY > minY ? 1023 / (maxY - minY) : 0;
    const sz = maxZ > minZ ? 1023 / (maxZ - minZ) : 0;
    let codes = new Uint32Array(n);
    let tris = new Uint32Array(n);
    for (let t = 0; t < n; t++) {
        const qx = Number.isFinite(cx[t]) ? Math.floor((cx[t] - minX) * sx) : 0;
        const qy = Number.isFinite(cy[t]) ? Math.floor((cy[t] - minY) * sy) : 0;
        const qz = Number.isFinite(cz[t]) ? Math.floor((cz[t] - minZ) * sz) : 0;
        codes[t] = ((spread10(qx) << 2) | (spread10(qy) << 1) | spread10(qz)) >>> 0;
        tris[t] = t;
    }
    // LSD radix sort (4 × 8 bits) of (code, triangle) pairs.
    let codesB = new Uint32Array(n);
    let trisB = new Uint32Array(n);
    const counts = new Uint32Array(256);
    for (let shift = 0; shift < 32; shift += 8) {
        counts.fill(0);
        for (let i = 0; i < n; i++) {
            const bucket = (codes[i] >>> shift) & 0xff;
            counts[bucket] = counts[bucket] + 1;
        }
        let sum = 0;
        for (let k = 0; k < 256; k++) {
            const c = counts[k];
            counts[k] = sum;
            sum += c;
        }
        for (let i = 0; i < n; i++) {
            const code = codes[i];
            const bucket = (code >>> shift) & 0xff;
            const slot = counts[bucket];
            counts[bucket] = slot + 1;
            codesB[slot] = code;
            trisB[slot] = tris[i];
        }
        [codes, codesB] = [codesB, codes];
        [tris, trisB] = [trisB, tris];
    }
    // Topology in preorder (left child = parent + 1, inner nodes store the right child).
    const maxNodes = Math.max(1, 2 * n);
    const nodes = new Uint32Array(maxNodes * 2);
    let nodeCount = 0;
    const stackStart = [0];
    const stackEnd = [n];
    const stackPatch = [-1];
    while (stackStart.length > 0) {
        const start = stackStart.pop();
        const end = stackEnd.pop();
        const patch = stackPatch.pop();
        const node = nodeCount++;
        if (patch >= 0)
            nodes[patch * 2] = node;
        const count = end - start;
        if (count <= LEAF_TRIANGLES) {
            nodes[node * 2] = start;
            nodes[node * 2 + 1] = (count | LEAF_BIT) >>> 0;
            continue;
        }
        const first = codes[start];
        const last = codes[end - 1];
        let mid;
        if (first === last) {
            mid = (start + end) >> 1;
        }
        else {
            // Highest differing bit; the first index whose code has it set splits the range.
            const bit = 31 - Math.clz32((first ^ last) >>> 0);
            const prefix = (last >>> bit) << bit;
            let lo = start;
            let hi = end - 1;
            while (lo < hi) {
                const m = (lo + hi) >> 1;
                if (codes[m] >= prefix)
                    hi = m;
                else
                    lo = m + 1;
            }
            mid = lo;
            // Keep leaves reasonably balanced when one side would be tiny.
            if (mid - start < 1 || end - mid < 1)
                mid = (start + end) >> 1;
        }
        nodes[node * 2 + 1] = 0;
        // The left subtree is emitted next (node + 1); the right child patches this node's slot.
        stackStart.push(mid);
        stackEnd.push(end);
        stackPatch.push(node);
        stackStart.push(start);
        stackEnd.push(mid);
        stackPatch.push(-1);
    }
    const tree = {
        boxes: new Float32Array(nodeCount * 6),
        nodes: nodes.slice(0, nodeCount * 2),
        tris,
        positions: p,
        index: idx,
        nodeCount,
        triangleCount: n,
        positionVersion,
        indexVersion,
    };
    refit(tree, p, idx);
    return tree;
}
/** Recompute node boxes after vertices moved (same topology). Allocation-free. */
function refit(tree, p, idx) {
    const { boxes, nodes, tris } = tree;
    // Children always have larger indices than their parent (preorder): walk backwards.
    for (let node = tree.nodeCount - 1; node >= 0; node--) {
        const meta = nodes[node * 2 + 1];
        const b = node * 6;
        if ((meta & LEAF_BIT) !== 0) {
            const start = nodes[node * 2];
            const count = meta & ~LEAF_BIT;
            let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
            for (let i = start; i < start + count; i++) {
                const t = tris[i];
                for (let k = 0; k < 3; k++) {
                    const v = (idx ? idx[t * 3 + k] : t * 3 + k) * 3;
                    const x = p[v], y = p[v + 1], z = p[v + 2];
                    if (x < minX)
                        minX = x;
                    if (y < minY)
                        minY = y;
                    if (z < minZ)
                        minZ = z;
                    if (x > maxX)
                        maxX = x;
                    if (y > maxY)
                        maxY = y;
                    if (z > maxZ)
                        maxZ = z;
                }
            }
            boxes[b] = minX;
            boxes[b + 1] = minY;
            boxes[b + 2] = minZ;
            boxes[b + 3] = maxX;
            boxes[b + 4] = maxY;
            boxes[b + 5] = maxZ;
        }
        else {
            const l = (node + 1) * 6;
            const r = nodes[node * 2] * 6;
            for (let k = 0; k < 3; k++) {
                boxes[b + k] = Math.min(boxes[l + k], boxes[r + k]);
                boxes[b + 3 + k] = Math.max(boxes[l + 3 + k], boxes[r + 3 + k]);
            }
        }
    }
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
function boxEntry(boxes, b) {
    const far = _best[0];
    const r = _rayS;
    const ox = r[0], oy = r[1], oz = r[2];
    const ix = r[6], iy = r[7], iz = r[8];
    let t1 = (boxes[b] - ox) * ix;
    let t2 = (boxes[b + 3] - ox) * ix;
    let tmin = Math.min(t1, t2);
    let tmax = Math.max(t1, t2);
    t1 = (boxes[b + 1] - oy) * iy;
    t2 = (boxes[b + 4] - oy) * iy;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
    t1 = (boxes[b + 2] - oz) * iz;
    t2 = (boxes[b + 5] - oz) * iz;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
    if (Number.isNaN(tmin) || Number.isNaN(tmax))
        return false;
    if (tmax >= Math.max(tmin, 0) && tmin <= far) {
        _out[0] = Math.max(tmin, 0);
        return true;
    }
    return false;
}
/**
 * Nearest local-space hit along `ray` (Möller–Trumbore). Returns the hit
 * distance (in local ray units) and writes the triangle id into `out[0]`,
 * or Infinity when nothing is hit.
 */
export function bvhNearest(tree, p, idx, ray, side, out) {
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
    let best = Infinity;
    _best[0] = best;
    let bestTri = -1;
    let sp = 0;
    _stack[sp++] = 0;
    while (sp > 0) {
        const node = _stack[--sp];
        if (!boxEntry(boxes, node * 6))
            continue;
        const meta = nodes[node * 2 + 1];
        if ((meta & LEAF_BIT) !== 0) {
            const start = nodes[node * 2];
            const count = meta & ~LEAF_BIT;
            for (let i = start; i < start + count; i++) {
                const t = tris[i];
                const a = (idx ? idx[t * 3] : t * 3) * 3;
                const b = (idx ? idx[t * 3 + 1] : t * 3 + 1) * 3;
                const c = (idx ? idx[t * 3 + 2] : t * 3 + 2) * 3;
                _a.set(p[a], p[a + 1], p[a + 2]);
                _b.set(p[b], p[b + 1], p[b + 2]);
                _c.set(p[c], p[c + 1], p[c + 2]);
                if (triangleHit() && _out[1] < best) {
                    best = _out[1];
                    _best[0] = best;
                    bestTri = t;
                }
            }
            continue;
        }
        const left = node + 1;
        const right = nodes[node * 2];
        if (sp + 2 > STACK_SIZE)
            continue; // pathological depth: skip rather than overflow
        // Visit the nearer child first.
        const tl = boxEntry(boxes, left * 6) ? _out[0] : Infinity;
        const tr = boxEntry(boxes, right * 6) ? _out[0] : Infinity;
        if (tl <= tr) {
            if (tr !== Infinity)
                _stack[sp++] = right;
            if (tl !== Infinity)
                _stack[sp++] = left;
        }
        else {
            if (tl !== Infinity)
                _stack[sp++] = left;
            if (tr !== Infinity)
                _stack[sp++] = right;
        }
    }
    out[0] = bestTri;
    return best;
}
/** Ray/triangle (_a, _b, _c) test with three's material-side culling; the hit distance goes to `_out[1]`. */
function triangleHit() {
    const r = _rayS;
    const ox = r[0], oy = r[1], oz = r[2];
    const dx = r[3], dy = r[4], dz = r[5];
    const side = r[9];
    _edge1.subVectors(_b, _a);
    _edge2.subVectors(_c, _a);
    // p = d × e2
    const px = dy * _edge2.z - dz * _edge2.y;
    const py = dz * _edge2.x - dx * _edge2.z;
    const pz = dx * _edge2.y - dy * _edge2.x;
    const det = _edge1.x * px + _edge1.y * py + _edge1.z * pz;
    // det = e1·(d×e2) = −d·(e1×e2): positive when the ray meets the front face (as three.js decides it).
    if (side === DoubleSide) {
        if (Math.abs(det) < 1e-12)
            return false;
    }
    else if (side === BackSide) {
        if (det > -1e-12)
            return false;
    }
    else if (det < 1e-12) {
        return false;
    }
    const inv = 1 / det;
    const tx = ox - _a.x, ty = oy - _a.y, tz = oz - _a.z;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1)
        return false;
    const qx = ty * _edge1.z - tz * _edge1.y;
    const qy = tz * _edge1.x - tx * _edge1.z;
    const qz = tx * _edge1.y - ty * _edge1.x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1)
        return false;
    const t = (_edge2.x * qx + _edge2.y * qy + _edge2.z * qz) * inv;
    if (!(t >= 0))
        return false;
    _out[1] = t;
    return true;
}
const _hit = new Int32Array(1);
/** `Mesh.raycast` replacement backed by the BVH (nearest hit only). */
export function bvhRaycast(raycaster, intersects) {
    const geometry = this.geometry;
    const material = this.material;
    if (!material || material.visible === false)
        return;
    if (geometry.boundingSphere === null)
        geometry.computeBoundingSphere();
    _sphere.copy(geometry.boundingSphere).applyMatrix4(this.matrixWorld);
    if (!raycaster.ray.intersectsSphere(_sphere))
        return;
    const tree = triangleBvh(geometry);
    const pos = geometry.getAttribute('position');
    if (!tree || !pos) {
        Mesh.prototype.raycast.call(this, raycaster, intersects);
        return;
    }
    const index = geometry.getIndex();
    _inverse.copy(this.matrixWorld).invert();
    _ray.copy(raycaster.ray).applyMatrix4(_inverse);
    const local = bvhNearest(tree, tree.positions, tree.index, _ray, material.side, _hit);
    const tri = _hit[0];
    if (local === Infinity || tri < 0)
        return;
    _ray.at(local, _point);
    const world = _point.clone().applyMatrix4(this.matrixWorld);
    const distance = raycaster.ray.origin.distanceTo(world);
    if (distance < raycaster.near || distance > raycaster.far)
        return;
    const a = vertex(index, tri, 0);
    const b = vertex(index, tri, 1);
    const c = vertex(index, tri, 2);
    _a.fromBufferAttribute(pos, a);
    _b.fromBufferAttribute(pos, b);
    _c.fromBufferAttribute(pos, c);
    const normal = new Vector3().subVectors(_c, _b).cross(_edge1.subVectors(_a, _b)).normalize();
    intersects.push({ distance, point: world, object: this, face: { a, b, c, normal, materialIndex: 0 }, faceIndex: tri });
}
/** requestIdleCallback where available (not Safari), otherwise a short timeout. */
const onIdle = (cb) => {
    const ric = globalThis.requestIdleCallback;
    if (typeof ric === 'function')
        ric(cb, { timeout: 2000 });
    else
        setTimeout(cb, 250);
};
/**
 * Use the BVH raycast for `mesh` when it is large enough (no-op otherwise)
 * and build its tree at the next idle moment, so the first pick or camera
 * occlusion test never pays for the build. Returns true when enabled.
 */
export function accelerateRaycast(mesh, idle = onIdle) {
    if (!(mesh instanceof Mesh) || !bvhEligible(mesh))
        return false;
    mesh.raycast = bvhRaycast;
    const geometry = mesh.geometry;
    if (idle && !cache.has(geometry)) {
        idle(() => {
            // Skip geometries that were disposed or replaced in the meantime.
            if (mesh.geometry === geometry && geometry.getAttribute('position'))
                triangleBvh(geometry);
        });
    }
    return true;
}
