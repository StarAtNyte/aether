import { hexToLinear } from '../color';
import { mat3FromEulerDeg, mat3Scale } from './math3';
/** Caps the total number of vertices a generator may allocate. */
export class VertexBudget {
    maxVertices;
    usedVertices = 0;
    constructor(maxVertices) {
        this.maxVertices = maxVertices;
    }
    /** Vertices allocated so far. */
    get used() {
        return this.usedVertices;
    }
    /** Record `n` new vertices; throws a RangeError once the budget is exceeded. */
    charge(n) {
        this.usedVertices += n;
        if (this.usedVertices > this.maxVertices) {
            throw new RangeError(`vertex budget exceeded: generators may allocate at most ${this.maxVertices} vertices`);
        }
    }
}
/** Coerce to a finite number or throw a TypeError naming the argument. */
export function finite(v, what) {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n))
        throw new TypeError(`${what}: expected a finite number`);
    return n;
}
function grow(arr, needed) {
    if (needed <= arr.length)
        return arr;
    let cap = Math.max(16, arr.length * 2);
    while (cap < needed)
        cap *= 2;
    const next = new arr.constructor(cap);
    next.set(arr);
    return next;
}
/** Growable vertex/index buffers used to construct a {@link Mesh}. */
export class MeshBuilder {
    pos;
    nor;
    uv;
    idx;
    /** Number of vertices written. */
    vcount = 0;
    /** Number of indices written. */
    icount = 0;
    constructor(vertexCapacity = 64, indexCapacity = vertexCapacity * 3) {
        this.pos = new Float32Array(Math.max(3, vertexCapacity * 3));
        this.nor = new Float32Array(Math.max(3, vertexCapacity * 3));
        this.uv = new Float32Array(Math.max(2, vertexCapacity * 2));
        this.idx = new Uint32Array(Math.max(3, indexCapacity));
    }
    /** Append a vertex; returns its index. */
    vertex(x, y, z, nx, ny, nz, u, v) {
        const i = this.vcount;
        if ((i + 1) * 3 > this.pos.length) {
            this.pos = grow(this.pos, (i + 1) * 3);
            this.nor = grow(this.nor, (i + 1) * 3);
            this.uv = grow(this.uv, (i + 1) * 2);
        }
        const o = i * 3;
        this.pos[o] = x;
        this.pos[o + 1] = y;
        this.pos[o + 2] = z;
        this.nor[o] = nx;
        this.nor[o + 1] = ny;
        this.nor[o + 2] = nz;
        this.uv[i * 2] = u;
        this.uv[i * 2 + 1] = v;
        this.vcount = i + 1;
        return i;
    }
    /** Append a counter-clockwise triangle. */
    tri(a, b, c) {
        const o = this.icount;
        if (o + 3 > this.idx.length)
            this.idx = grow(this.idx, o + 3);
        this.idx[o] = a;
        this.idx[o + 1] = b;
        this.idx[o + 2] = c;
        this.icount = o + 3;
    }
    /** Append a quad a-b-c-d (counter-clockwise) as two triangles. */
    quad(a, b, c, d) {
        this.tri(a, b, c);
        this.tri(a, c, d);
    }
    /** Finish into an exactly-sized mesh, charging the budget. */
    build(budget) {
        return new Mesh(this.pos.slice(0, this.vcount * 3), this.nor.slice(0, this.vcount * 3), this.uv.slice(0, this.vcount * 2), this.idx.slice(0, this.icount), null, budget);
    }
}
const scratchMat = new Float64Array(9);
const scratchRgb = [0, 0, 0];
/** Concrete {@link MeshHandle}: an indexed triangle mesh in typed arrays. */
export class Mesh {
    /** @internal packed xyz positions */
    positions;
    /** @internal packed xyz unit normals */
    normals;
    /** @internal packed uv */
    uvs;
    /** @internal triangle indices (CCW) */
    indices;
    /** @internal linear rgb per vertex or null */
    colors;
    /** @internal terrain layer weights (4 per vertex) for `api.addSplat`; dropped by every mesh operation */
    splat = null;
    /** @internal shared allocation budget */
    budget;
    constructor(positions, normals, uvs, indices, colors, budget) {
        budget.charge(positions.length / 3);
        this.positions = positions;
        this.normals = normals;
        this.uvs = uvs;
        this.indices = indices;
        this.colors = colors;
        this.budget = budget;
    }
    /** Number of vertices. */
    get vertexCount() {
        return this.positions.length / 3;
    }
    /** Number of triangles. */
    get triangleCount() {
        return this.indices.length / 3;
    }
    translate(x, y, z) {
        const tx = finite(x, 'translate(x)');
        const ty = finite(y, 'translate(y)');
        const tz = finite(z, 'translate(z)');
        const p = this.positions;
        for (let i = 0; i < p.length; i += 3) {
            p[i] = p[i] + tx;
            p[i + 1] = p[i + 1] + ty;
            p[i + 2] = p[i + 2] + tz;
        }
        return this;
    }
    rotate(xDeg, yDeg, zDeg) {
        mat3FromEulerDeg(finite(xDeg, 'rotate(x)'), finite(yDeg, 'rotate(y)'), finite(zDeg, 'rotate(z)'), scratchMat);
        return this.applyMatrix(scratchMat);
    }
    scale(x, y, z) {
        const sx = finite(x, 'scale(x)');
        const sy = y === undefined ? sx : finite(y, 'scale(y)');
        const sz = z === undefined ? sx : finite(z, 'scale(z)');
        mat3Scale(sx, sy, sz, scratchMat);
        return this.applyMatrix(scratchMat);
    }
    /**
     * p' = m·p + t; normals use the cofactor matrix (inverse-transpose up to a
     * positive factor). A negative determinant (mirroring) flips the winding.
     * @internal
     */
    applyMatrix(m, tx = 0, ty = 0, tz = 0) {
        const m00 = m[0], m01 = m[1], m02 = m[2];
        const m10 = m[3], m11 = m[4], m12 = m[5];
        const m20 = m[6], m21 = m[7], m22 = m[8];
        const c00 = m11 * m22 - m12 * m21, c01 = m12 * m20 - m10 * m22, c02 = m10 * m21 - m11 * m20;
        const c10 = m02 * m21 - m01 * m22, c11 = m00 * m22 - m02 * m20, c12 = m01 * m20 - m00 * m21;
        const c20 = m01 * m12 - m02 * m11, c21 = m02 * m10 - m00 * m12, c22 = m00 * m11 - m01 * m10;
        const det = m00 * c00 + m01 * c01 + m02 * c02;
        const sign = det < 0 ? -1 : 1;
        const p = this.positions;
        const n = this.normals;
        for (let i = 0; i < p.length; i += 3) {
            const x = p[i], y = p[i + 1], z = p[i + 2];
            p[i] = m00 * x + m01 * y + m02 * z + tx;
            p[i + 1] = m10 * x + m11 * y + m12 * z + ty;
            p[i + 2] = m20 * x + m21 * y + m22 * z + tz;
            const nx = n[i], ny = n[i + 1], nz = n[i + 2];
            const ox = c00 * nx + c01 * ny + c02 * nz;
            const oy = c10 * nx + c11 * ny + c12 * nz;
            const oz = c20 * nx + c21 * ny + c22 * nz;
            const len = Math.hypot(ox, oy, oz);
            if (len > 1e-20) {
                const k = sign / len;
                n[i] = ox * k;
                n[i + 1] = oy * k;
                n[i + 2] = oz * k;
            }
        }
        if (det < 0)
            this.flipWinding();
        return this;
    }
    /** Reverse triangle winding (front ↔ back). @internal */
    flipWinding() {
        const idx = this.indices;
        for (let i = 0; i < idx.length; i += 3) {
            const t = idx[i + 1];
            idx[i + 1] = idx[i + 2];
            idx[i + 2] = t;
        }
        return this;
    }
    displace(fn) {
        if (typeof fn !== 'function')
            throw new TypeError('displace(fn): fn must be a function');
        const p = this.positions;
        const n = this.normals;
        for (let i = 0; i < p.length; i += 3) {
            const d = finite(fn(p[i], p[i + 1], p[i + 2]), 'displace: fn result');
            p[i] = p[i] + n[i] * d;
            p[i + 1] = p[i + 1] + n[i + 1] * d;
            p[i + 2] = p[i + 2] + n[i + 2] * d;
        }
        return this.recomputeNormals();
    }
    vertexColor(fn) {
        if (typeof fn !== 'function')
            throw new TypeError('vertexColor(fn): fn must be a function');
        const p = this.positions;
        const colors = this.colors ?? new Float32Array(p.length);
        let lastHex = '';
        for (let i = 0; i < p.length; i += 3) {
            const hex = fn(p[i], p[i + 1], p[i + 2]);
            if (typeof hex !== 'string')
                throw new TypeError('vertexColor: fn must return a "#rrggbb" string');
            if (hex !== lastHex) {
                hexToLinear(hex, scratchRgb);
                lastHex = hex;
            }
            colors[i] = scratchRgb[0];
            colors[i + 1] = scratchRgb[1];
            colors[i + 2] = scratchRgb[2];
        }
        this.colors = colors;
        return this;
    }
    merge(other) {
        if (!(other instanceof Mesh))
            throw new TypeError('merge(other): other must be a mesh created by the api');
        const nv = this.vertexCount;
        const ov = other.vertexCount;
        this.budget.charge(ov);
        this.positions = concatF32(this.positions, other.positions);
        this.normals = concatF32(this.normals, other.normals);
        this.uvs = concatF32(this.uvs, other.uvs);
        if (this.colors || other.colors) {
            const c = new Float32Array((nv + ov) * 3);
            if (this.colors)
                c.set(this.colors);
            else
                c.fill(1, 0, nv * 3);
            if (other.colors)
                c.set(other.colors, nv * 3);
            else
                c.fill(1, nv * 3);
            this.colors = c;
        }
        const idx = new Uint32Array(this.indices.length + other.indices.length);
        idx.set(this.indices);
        const oi = other.indices;
        const base = this.indices.length;
        for (let i = 0; i < oi.length; i++)
            idx[base + i] = oi[i] + nv;
        this.indices = idx;
        return this;
    }
    clone() {
        return new Mesh(this.positions.slice(), this.normals.slice(), this.uvs.slice(), this.indices.slice(), this.colors ? this.colors.slice() : null, this.budget);
    }
    bounds() {
        return computeBounds(this.positions);
    }
    /**
     * Recompute smooth, area-weighted vertex normals. Vertices sharing a position
     * whose previous normals were similar (seams) are averaged together, while
     * hard edges (previous normals > ~45° apart) stay hard.
     * @internal
     */
    recomputeNormals() {
        const p = this.positions;
        const idx = this.indices;
        const old = this.normals;
        const nv = p.length / 3;
        const acc = new Float32Array(p.length);
        for (let t = 0; t < idx.length; t += 3) {
            const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
            const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2];
            const e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
            const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
            addTo(acc, a, fx, fy, fz);
            addTo(acc, b, fx, fy, fz);
            addTo(acc, c, fx, fy, fz);
        }
        // Group vertices by exact position with a numeric hash + chain.
        const head = new Map();
        const next = new Int32Array(nv).fill(-1);
        for (let i = 0; i < nv; i++) {
            const h = positionHash(p, i * 3);
            const prev = head.get(h);
            if (prev !== undefined)
                next[i] = prev;
            head.set(h, i);
        }
        const out = new Float32Array(p.length);
        for (let i = 0; i < nv; i++) {
            const o = i * 3;
            let sx = acc[o], sy = acc[o + 1], sz = acc[o + 2];
            const h = positionHash(p, o);
            for (let j = head.get(h) ?? -1; j !== -1; j = next[j]) {
                if (j === i)
                    continue;
                const q = j * 3;
                if (p[q] !== p[o] || p[q + 1] !== p[o + 1] || p[q + 2] !== p[o + 2])
                    continue;
                const dot = old[o] * old[q] + old[o + 1] * old[q + 1] + old[o + 2] * old[q + 2];
                if (dot < 0.7)
                    continue;
                sx += acc[q];
                sy += acc[q + 1];
                sz += acc[q + 2];
            }
            const len = Math.hypot(sx, sy, sz);
            if (len > 1e-20) {
                out[o] = sx / len;
                out[o + 1] = sy / len;
                out[o + 2] = sz / len;
            }
            else {
                out[o] = old[o];
                out[o + 1] = old[o + 1];
                out[o + 2] = old[o + 2];
            }
        }
        this.normals = out;
        return this;
    }
    /** Un-index the mesh so every triangle has its own vertices and face normal (faceted look). @internal */
    toFlat() {
        const idx = this.indices;
        const n = idx.length;
        this.budget.charge(n);
        const p = this.positions, uv = this.uvs, col = this.colors;
        const np = new Float32Array(n * 3);
        const nn = new Float32Array(n * 3);
        const nuv = new Float32Array(n * 2);
        const ncol = col ? new Float32Array(n * 3) : null;
        const ni = new Uint32Array(n);
        for (let t = 0; t < n; t += 3) {
            for (let k = 0; k < 3; k++) {
                const src = idx[t + k];
                const dst = t + k;
                np[dst * 3] = p[src * 3];
                np[dst * 3 + 1] = p[src * 3 + 1];
                np[dst * 3 + 2] = p[src * 3 + 2];
                nuv[dst * 2] = uv[src * 2];
                nuv[dst * 2 + 1] = uv[src * 2 + 1];
                if (ncol && col) {
                    ncol[dst * 3] = col[src * 3];
                    ncol[dst * 3 + 1] = col[src * 3 + 1];
                    ncol[dst * 3 + 2] = col[src * 3 + 2];
                }
                ni[dst] = dst;
            }
            const a = t * 3, b = a + 3, c = a + 6;
            const e1x = np[b] - np[a], e1y = np[b + 1] - np[a + 1], e1z = np[b + 2] - np[a + 2];
            const e2x = np[c] - np[a], e2y = np[c + 1] - np[a + 1], e2z = np[c + 2] - np[a + 2];
            let fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
            const len = Math.hypot(fx, fy, fz);
            if (len > 1e-20) {
                fx /= len;
                fy /= len;
                fz /= len;
            }
            else {
                fx = 0;
                fy = 1;
                fz = 0;
            }
            for (let k = 0; k < 9; k += 3) {
                nn[a + k] = fx;
                nn[a + k + 1] = fy;
                nn[a + k + 2] = fz;
            }
        }
        this.positions = np;
        this.normals = nn;
        this.uvs = nuv;
        this.colors = ncol;
        this.indices = ni;
        return this;
    }
    /**
     * Fast vertex painting with linear colors: `fn` writes into `out` (reused).
     * @internal
     */
    paintFn(fn) {
        const p = this.positions, n = this.normals;
        const colors = this.colors ?? new Float32Array(p.length);
        const out = [1, 1, 1];
        for (let i = 0; i < p.length; i += 3) {
            fn(p[i], p[i + 1], p[i + 2], n[i], n[i + 1], n[i + 2], out);
            colors[i] = out[0];
            colors[i + 1] = out[1];
            colors[i + 2] = out[2];
        }
        this.colors = colors;
        return this;
    }
    /** Paint every vertex with one linear color. @internal */
    paint(rgb) {
        const colors = this.colors ?? new Float32Array(this.positions.length);
        for (let i = 0; i < colors.length; i += 3) {
            colors[i] = rgb[0];
            colors[i + 1] = rgb[1];
            colors[i + 2] = rgb[2];
        }
        this.colors = colors;
        return this;
    }
}
function addTo(acc, o, x, y, z) {
    acc[o] = acc[o] + x;
    acc[o + 1] = acc[o + 1] + y;
    acc[o + 2] = acc[o + 2] + z;
}
function concatF32(a, b) {
    const out = new Float32Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out;
}
function positionHash(p, o) {
    const x = Math.round(p[o] * 1e4);
    const y = Math.round(p[o + 1] * 1e4);
    const z = Math.round(p[o + 2] * 1e4);
    return (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) | 0;
}
/** Bounds of packed xyz positions (zeros for an empty array). */
export function computeBounds(p, start = 0, end = p.length / 3) {
    if (end <= start)
        return { min: [0, 0, 0], max: [0, 0, 0] };
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = start * 3; i < end * 3; i += 3) {
        const x = p[i], y = p[i + 1], z = p[i + 2];
        if (x < minX)
            minX = x;
        if (x > maxX)
            maxX = x;
        if (y < minY)
            minY = y;
        if (y > maxY)
            maxY = y;
        if (z < minZ)
            minZ = z;
        if (z > maxZ)
            maxZ = z;
    }
    return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}
/** Grow `target` bounds to include `b` (mutates and returns target). */
export function unionBounds(target, b) {
    for (let k = 0; k < 3; k++) {
        target.min[k] = Math.min(target.min[k], b.min[k]);
        target.max[k] = Math.max(target.max[k], b.max[k]);
    }
    return target;
}
