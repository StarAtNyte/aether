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
/**
 * Cluster `indices` (triangles over `positions`). Adjacency uses `weld`
 * (vertex → representative with the same position) when given, so attribute
 * seams do not cut clusters apart.
 */
export function buildClusters(positions, indices, maxTriangles = CLUSTER_TRIANGLES, weld) {
    const triCount = Math.floor(indices.length / 3);
    const vertexCount = Math.floor(positions.length / 3);
    const cap = Math.max(1, Math.floor(maxTriangles));
    if (triCount === 0)
        return { indices: new Uint32Array(0), offsets: new Uint32Array(1), count: 0 };
    const vid = (i) => {
        const v = indices[i];
        return weld ? weld[v] : v;
    };
    // Morton order of centroids.
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < triCount * 3; i++) {
        const v = indices[i] * 3;
        const x = positions[v], y = positions[v + 1], z = positions[v + 2];
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
    const ext = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-9);
    const keys = new Uint32Array(triCount);
    for (let t = 0; t < triCount; t++) {
        let cx = 0, cy = 0, cz = 0;
        for (let k = 0; k < 3; k++) {
            const v = indices[t * 3 + k] * 3;
            cx += positions[v];
            cy += positions[v + 1];
            cz += positions[v + 2];
        }
        keys[t] = morton3((cx / 3 - minX) / ext, (cy / 3 - minY) / ext, (cz / 3 - minZ) / ext);
    }
    const order0 = new Uint32Array(triCount);
    for (let t = 0; t < triCount; t++)
        order0[t] = t;
    const order = radixSortByKey(order0, keys, triCount, new Uint32Array(triCount));
    // Vertex → triangle adjacency (CSR) over welded ids.
    const offs = new Uint32Array(vertexCount + 1);
    for (let i = 0; i < triCount * 3; i++)
        offs[vid(i) + 1] = offs[vid(i) + 1] + 1;
    for (let v = 0; v < vertexCount; v++)
        offs[v + 1] = offs[v + 1] + offs[v];
    const adj = new Uint32Array(triCount * 3);
    const fill = new Uint32Array(vertexCount);
    for (let t = 0; t < triCount; t++) {
        for (let k = 0; k < 3; k++) {
            const v = vid(t * 3 + k);
            adj[offs[v] + fill[v]] = t;
            fill[v] = fill[v] + 1;
        }
    }
    const assigned = new Int32Array(triCount).fill(-1);
    const queued = new Int32Array(triCount).fill(-1);
    const queue = new Uint32Array(triCount);
    const out = new Uint32Array(triCount * 3);
    const offsets = [0];
    let written = 0;
    let cluster = 0;
    let cursor = 0;
    /** Next unassigned triangle in Morton order. */
    const nextSeed = () => {
        while (cursor < triCount && assigned[order[cursor]] >= 0)
            cursor++;
        return cursor < triCount ? order[cursor] : -1;
    };
    // Centroids for the continuation distance test.
    const cen = new Float32Array(triCount * 3);
    for (let t = 0; t < triCount; t++) {
        for (let k = 0; k < 3; k++) {
            const v = indices[t * 3 + k] * 3;
            cen[t * 3] = cen[t * 3] + positions[v] / 3;
            cen[t * 3 + 1] = cen[t * 3 + 1] + positions[v + 1] / 3;
            cen[t * 3 + 2] = cen[t * 3 + 2] + positions[v + 2] / 3;
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
                const t = queue[head++];
                if (assigned[t] >= 0)
                    continue;
                assigned[t] = cluster;
                out[written++] = indices[t * 3];
                out[written++] = indices[t * 3 + 1];
                out[written++] = indices[t * 3 + 2];
                sx += cen[t * 3];
                sy += cen[t * 3 + 1];
                sz += cen[t * 3 + 2];
                size++;
                for (let k = 0; k < 3; k++) {
                    const v = vid(t * 3 + k);
                    const end = offs[v + 1];
                    for (let j = offs[v]; j < end; j++) {
                        const n = adj[j];
                        if (assigned[n] < 0 && queued[n] !== cluster) {
                            queued[n] = cluster;
                            queue[tail++] = n;
                        }
                    }
                }
            }
            if (size >= cap)
                break;
            // The connected patch ran out (a hole left by earlier clusters): continue with the
            // nearest of the next few unassigned triangles in Morton order, but only when it is
            // close to this cluster; otherwise the cluster ends small rather than scattered.
            const first = nextSeed();
            s = -1;
            if (first < 0)
                break;
            const mx = sx / size, my = sy / size, mz = sz / size;
            let best = -1;
            let bestD = Infinity;
            for (let i = cursor, seen = 0; i < triCount && seen < 16; i++) {
                const t = order[i];
                if (assigned[t] >= 0)
                    continue;
                seen++;
                const dx = cen[t * 3] - mx, dy = cen[t * 3 + 1] - my, dz = cen[t * 3 + 2] - mz;
                const d = dx * dx + dy * dy + dz * dz;
                if (d < bestD) {
                    bestD = d;
                    best = t;
                }
            }
            if (best >= 0 && bestD <= reach2(ext, size, triCount))
                s = best;
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
function reach2(ext, size, total) {
    const r = ext * Math.sqrt(Math.max(size, 8) / Math.max(total, 1)) * 2;
    return r * r;
}
/**
 * Split `indices` into ⌈n / maxTriangles⌉ equal clusters along the Morton
 * order of the triangle centroids: balanced, compact pieces for the small
 * simplified groups of a DAG level (no fragments).
 */
export function splitClusters(positions, indices, maxTriangles = CLUSTER_TRIANGLES) {
    const triCount = Math.floor(indices.length / 3);
    if (triCount === 0)
        return { indices: new Uint32Array(0), offsets: new Uint32Array(1), count: 0 };
    const parts = Math.ceil(triCount / Math.max(1, maxTriangles));
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < triCount * 3; i++) {
        const v = indices[i] * 3;
        const x = positions[v], y = positions[v + 1], z = positions[v + 2];
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
    const ext = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-9);
    const keys = new Uint32Array(triCount);
    const order0 = new Uint32Array(triCount);
    for (let t = 0; t < triCount; t++) {
        let cx = 0, cy = 0, cz = 0;
        for (let k = 0; k < 3; k++) {
            const v = indices[t * 3 + k] * 3;
            cx += positions[v];
            cy += positions[v + 1];
            cz += positions[v + 2];
        }
        keys[t] = morton3((cx / 3 - minX) / ext, (cy / 3 - minY) / ext, (cz / 3 - minZ) / ext);
        order0[t] = t;
    }
    const order = radixSortByKey(order0, keys, triCount, new Uint32Array(triCount));
    const out = new Uint32Array(triCount * 3);
    const offsets = new Uint32Array(parts + 1);
    for (let i = 0; i < triCount; i++) {
        const t = order[i];
        out[i * 3] = indices[t * 3];
        out[i * 3 + 1] = indices[t * 3 + 1];
        out[i * 3 + 2] = indices[t * 3 + 2];
    }
    for (let p = 0; p <= parts; p++)
        offsets[p] = Math.round((p * triCount) / parts) * 3;
    return { indices: out, offsets, count: parts };
}
/** Bounding spheres and normal cones of every cluster of `set`. */
export function clusterBounds(positions, set) {
    const spheres = new Float32Array(set.count * 4);
    const cones = new Float32Array(set.count * 4);
    for (let c = 0; c < set.count; c++) {
        const a = set.offsets[c];
        const b = set.offsets[c + 1];
        sphereOfIndices(positions, set.indices, a, b, spheres, c * 4);
        // Area-weighted mean normal, then the widest deviation from it.
        let ax = 0, ay = 0, az = 0;
        for (let i = a; i < b; i += 3) {
            triNormal(positions, set.indices, i);
            ax += _n[0];
            ay += _n[1];
            az += _n[2];
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
                if (area2 <= 0)
                    continue;
                const d = (_n[0] * ax + _n[1] * ay + _n[2] * az) / area2;
                if (d < minDot)
                    minDot = d;
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
function triNormal(p, idx, i) {
    const a = idx[i] * 3;
    const b = idx[i + 1] * 3;
    const c = idx[i + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    _n[0] = uy * vz - uz * vy;
    _n[1] = uz * vx - ux * vz;
    _n[2] = ux * vy - uy * vx;
    return Math.hypot(_n[0], _n[1], _n[2]);
}
/** Bounding sphere (AABB centre, max distance) of the vertices referenced by `idx[a..b)` into `out[o..o+4)`. */
export function sphereOfIndices(p, idx, a, b, out, o) {
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = a; i < b; i++) {
        const v = idx[i] * 3;
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
    if (a >= b) {
        out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
        return;
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
    let r2 = 0;
    for (let i = a; i < b; i++) {
        const v = idx[i] * 3;
        const dx = p[v] - cx, dy = p[v + 1] - cy, dz = p[v + 2] - cz;
        const d = dx * dx + dy * dy + dz * dz;
        if (d > r2)
            r2 = d;
    }
    out[o] = cx;
    out[o + 1] = cy;
    out[o + 2] = cz;
    // Grow by one float ulp-ish margin so float32 storage stays conservative.
    out[o + 3] = Math.sqrt(r2) * (1 + 1e-6) + 1e-7;
}
/** Smallest sphere (approximate) enclosing two spheres. */
export function mergeSpheres(s, a, t, b, out, o) {
    const ax = s[a], ay = s[a + 1], az = s[a + 2], ar = s[a + 3];
    const bx = t[b], by = t[b + 1], bz = t[b + 2], br = t[b + 3];
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const d = Math.hypot(dx, dy, dz);
    if (d + br <= ar) {
        out[o] = ax;
        out[o + 1] = ay;
        out[o + 2] = az;
        out[o + 3] = ar;
        return;
    }
    if (d + ar <= br) {
        out[o] = bx;
        out[o + 1] = by;
        out[o + 2] = bz;
        out[o + 3] = br;
        return;
    }
    const r = (d + ar + br) / 2;
    const k = (r - ar) / d;
    out[o] = ax + dx * k;
    out[o + 1] = ay + dy * k;
    out[o + 2] = az + dz * k;
    out[o + 3] = r * (1 + 1e-6);
}
