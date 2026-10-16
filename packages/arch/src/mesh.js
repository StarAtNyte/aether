/**
 * Small typed-array mesh toolkit for architecture and furniture.
 *
 * A {@link Geom} is a growable triangle mesh (positions, normals, metric UVs,
 * indices) with in-place transforms. Primitives are tuned for realistic
 * interiors: {@link roundedBox} gives furniture soft, light-catching edges
 * (sharp CG boxes are the first thing that makes a render look fake), and
 * every surface carries UVs in METRES so the renderer's tiling finishes
 * (wood grain, fabric weave, tiles) keep a real-world scale.
 *
 * Winding: counter-clockwise triangles seen from the side the normal points
 * to (three.js front faces).
 */
import { triangulate } from './triangulate';
/** Growable triangle mesh. Transforms mutate in place and return `this`. */
export class Geom {
    p = [];
    n = [];
    uv = [];
    i = [];
    /** Number of vertices. */
    get vertexCount() {
        return this.p.length / 3;
    }
    /** Number of triangles. */
    get triangleCount() {
        return this.i.length / 3;
    }
    /** Append one vertex; returns its index. */
    vertex(x, y, z, nx, ny, nz, u, v) {
        const index = this.p.length / 3;
        this.p.push(x, y, z);
        this.n.push(nx, ny, nz);
        this.uv.push(u, v);
        return index;
    }
    /** Append one triangle by vertex index. */
    tri(a, b, c) {
        this.i.push(a, b, c);
        return this;
    }
    /**
     * A flat quad. Corners in counter-clockwise order seen from the front;
     * `n` is its normal; UVs per corner (metres).
     */
    quad(c0, c1, c2, c3, n, uv) {
        const nx = n[0];
        const ny = n[1];
        const nz = n[2];
        const a = this.vertex(c0[0], c0[1], c0[2], nx, ny, nz, uv[0], uv[1]);
        const b = this.vertex(c1[0], c1[1], c1[2], nx, ny, nz, uv[2], uv[3]);
        const c = this.vertex(c2[0], c2[1], c2[2], nx, ny, nz, uv[4], uv[5]);
        const d = this.vertex(c3[0], c3[1], c3[2], nx, ny, nz, uv[6], uv[7]);
        this.i.push(a, b, c, a, c, d);
        return this;
    }
    /**
     * A flat quad with automatic metric UVs: u along c0→c1, v along c0→c3
     * (offset by `u0`, `v0`).
     */
    quadAuto(c0, c1, c2, c3, u0 = 0, v0 = 0) {
        const ex = [c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]];
        const ey = [c3[0] - c0[0], c3[1] - c0[1], c3[2] - c0[2]];
        const nx = ex[1] * ey[2] - ex[2] * ey[1];
        const ny = ex[2] * ey[0] - ex[0] * ey[2];
        const nz = ex[0] * ey[1] - ex[1] * ey[0];
        const len = Math.hypot(nx, ny, nz);
        if (!(len > 1e-12))
            return this;
        const lu = Math.hypot(ex[0], ex[1], ex[2]);
        const lv = Math.hypot(ey[0], ey[1], ey[2]);
        // c2 projected on the (ex, ey) frame for a general quad.
        const d2 = [c2[0] - c0[0], c2[1] - c0[1], c2[2] - c0[2]];
        const u2 = lu > 0 ? (d2[0] * ex[0] + d2[1] * ex[1] + d2[2] * ex[2]) / lu : 0;
        const v2 = lv > 0 ? (d2[0] * ey[0] + d2[1] * ey[1] + d2[2] * ey[2]) / lv : 0;
        return this.quad(c0, c1, c2, c3, [nx / len, ny / len, nz / len], [u0, v0, u0 + lu, v0, u0 + u2, v0 + v2, u0, v0 + lv]);
    }
    /**
     * A horizontal polygon (plan points `[x, z]`) at height `y`, facing up
     * (`up`) or down. Holes are cut out. UVs are plan metres (x, z).
     */
    flatPolygon(outline, y, up, holes = []) {
        const { points, triangles } = triangulate(outline, holes);
        const base = this.vertexCount;
        const ny = up ? 1 : -1;
        for (const p of points)
            this.vertex(p[0], y, p[1], 0, ny, 0, p[0], p[1]);
        for (let k = 0; k < triangles.length; k += 3) {
            const a = base + triangles[k];
            const b = base + triangles[k + 1];
            const c = base + triangles[k + 2];
            // Positive shoelace triangles face down (see triangulate): flip for up.
            if (up)
                this.i.push(a, c, b);
            else
                this.i.push(a, b, c);
        }
        return this;
    }
    /** Append another mesh. */
    merge(other) {
        const base = this.vertexCount;
        for (let k = 0; k < other.p.length; k++)
            this.p.push(other.p[k]);
        for (let k = 0; k < other.n.length; k++)
            this.n.push(other.n[k]);
        for (let k = 0; k < other.uv.length; k++)
            this.uv.push(other.uv[k]);
        for (let k = 0; k < other.i.length; k++)
            this.i.push(base + other.i[k]);
        return this;
    }
    /** Translate. */
    translate(x, y, z) {
        for (let k = 0; k < this.p.length; k += 3) {
            this.p[k] = this.p[k] + x;
            this.p[k + 1] = this.p[k + 1] + y;
            this.p[k + 2] = this.p[k + 2] + z;
        }
        return this;
    }
    /** Rotate about the Y axis by `deg` (three.js convention: +X turns toward −Z). */
    rotateY(deg) {
        return this.rotateAxis(1, deg);
    }
    /** Rotate about the X axis by `deg`. */
    rotateX(deg) {
        return this.rotateAxis(0, deg);
    }
    /** Rotate about the Z axis by `deg`. */
    rotateZ(deg) {
        return this.rotateAxis(2, deg);
    }
    rotateAxis(axis, deg) {
        const t = (deg * Math.PI) / 180;
        const c = Math.cos(t);
        const s = Math.sin(t);
        const rot = (arr) => {
            for (let k = 0; k < arr.length; k += 3) {
                const x = arr[k];
                const y = arr[k + 1];
                const z = arr[k + 2];
                if (axis === 1) {
                    arr[k] = x * c + z * s;
                    arr[k + 2] = -x * s + z * c;
                }
                else if (axis === 0) {
                    arr[k + 1] = y * c - z * s;
                    arr[k + 2] = y * s + z * c;
                }
                else {
                    arr[k] = x * c - y * s;
                    arr[k + 1] = x * s + y * c;
                }
            }
        };
        rot(this.p);
        rot(this.n);
        return this;
    }
    /** Scale (normals stay correct under non-uniform scale; negative scale flips winding). */
    scale(x, y = x, z = x) {
        for (let k = 0; k < this.p.length; k += 3) {
            this.p[k] = this.p[k] * x;
            this.p[k + 1] = this.p[k + 1] * y;
            this.p[k + 2] = this.p[k + 2] * z;
            const nx = this.n[k] / x;
            const ny = this.n[k + 1] / y;
            const nz = this.n[k + 2] / z;
            const len = Math.hypot(nx, ny, nz) || 1;
            this.n[k] = nx / len;
            this.n[k + 1] = ny / len;
            this.n[k + 2] = nz / len;
        }
        if (x * y * z < 0)
            this.flip();
        return this;
    }
    /** Reverse triangle winding (normals unchanged). */
    flip() {
        for (let k = 0; k < this.i.length; k += 3) {
            const b = this.i[k + 1];
            this.i[k + 1] = this.i[k + 2];
            this.i[k + 2] = b;
        }
        return this;
    }
    /**
     * Re-derive UVs by box projection in metres (object space), like the
     * renderer's fallback: top/bottom → (x, z), front/back → (x, y), sides → (z, y).
     */
    boxUvs() {
        for (let k = 0, v = 0; k < this.p.length; k += 3, v += 2) {
            const ax = Math.abs(this.n[k]);
            const ay = Math.abs(this.n[k + 1]);
            const az = Math.abs(this.n[k + 2]);
            if (ay >= ax && ay >= az) {
                this.uv[v] = this.p[k];
                this.uv[v + 1] = this.p[k + 2];
            }
            else if (az >= ax) {
                this.uv[v] = this.p[k];
                this.uv[v + 1] = this.p[k + 1];
            }
            else {
                this.uv[v] = this.p[k + 2];
                this.uv[v + 1] = this.p[k + 1];
            }
        }
        return this;
    }
    /** Copy. */
    clone() {
        return new Geom().merge(this);
    }
    /** Axis-aligned bounds `[minX, minY, minZ, maxX, maxY, maxZ]` (zeros when empty). */
    bounds() {
        if (this.p.length === 0)
            return [0, 0, 0, 0, 0, 0];
        const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
        for (let k = 0; k < this.p.length; k += 3) {
            for (let a = 0; a < 3; a++) {
                const v = this.p[k + a];
                if (v < b[a])
                    b[a] = v;
                if (v > b[a + 3])
                    b[a + 3] = v;
            }
        }
        return b;
    }
    /** Freeze into typed arrays. */
    toData() {
        return { positions: new Float32Array(this.p), normals: new Float32Array(this.n), uvs: new Float32Array(this.uv), indices: new Uint32Array(this.i) };
    }
}
/** Axis-aligned box from min to max corner (flat shaded, metric UVs). */
export function box(x0, y0, z0, x1, y1, z1, opts = {}) {
    const g = new Geom();
    // +X
    g.quadAuto([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], -z1, y0);
    // −X
    g.quadAuto([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], z0, y0);
    // +Z
    g.quadAuto([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], x0, y0);
    // −Z
    g.quadAuto([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], -x1, y0);
    if (opts.top !== false)
        g.quadAuto([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], x0, -z1);
    if (opts.bottom !== false)
        g.quadAuto([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], x0, z0);
    return g;
}
/** Box centred on (cx, cy, cz) with full size (w, h, d). */
export function boxC(cx, cy, cz, w, h, d) {
    return box(cx - w / 2, cy - h / 2, cz - d / 2, cx + w / 2, cy + h / 2, cz + d / 2);
}
/**
 * A box with rounded edges and corners of radius `r` (clamped to half the
 * smallest side), centred on the origin, full size (w, h, d). `seg` arc
 * segments per rounded edge. Smooth normals; metric box-projected UVs.
 */
export function roundedBox(w, h, d, r, seg = 3) {
    const g = new Geom();
    const hx = Math.max(1e-4, w / 2);
    const hy = Math.max(1e-4, h / 2);
    const hz = Math.max(1e-4, d / 2);
    const rad = Math.max(0, Math.min(r, hx * 0.999, hy * 0.999, hz * 0.999));
    if (rad < 1e-4)
        return box(-hx, -hy, -hz, hx, hy, hz);
    const s = Math.max(1, Math.min(8, Math.round(seg)));
    const samples = (half) => {
        const out = [-half];
        for (let k = 1; k <= s; k++)
            out.push(-half + (rad * k) / s);
        for (let k = s - 1; k >= 0; k--)
            out.push(half - (rad * k) / s);
        // Collapse the duplicate in the middle when the flat span is zero.
        return out.filter((v, idx) => idx === 0 || Math.abs(v - out[idx - 1]) > 1e-7);
    };
    const ix = hx - rad;
    const iy = hy - rad;
    const iz = hz - rad;
    const clamp = (v, m) => (v < -m ? -m : v > m ? m : v);
    // Faces: [normal axis, sign, u axis, v axis].
    const faces = [
        [0, 1, 2, 1],
        [0, -1, 2, 1],
        [1, 1, 0, 2],
        [1, -1, 0, 2],
        [2, 1, 0, 1],
        [2, -1, 0, 1],
    ];
    const half = [hx, hy, hz];
    for (const [na, sign, ua, va] of faces) {
        const us = samples(half[ua]);
        const vs = samples(half[va]);
        const base = g.vertexCount;
        const p = [0, 0, 0];
        for (const v of vs) {
            for (const u of us) {
                p[na] = sign * half[na];
                p[ua] = u;
                p[va] = v;
                const cx = clamp(p[0], ix);
                const cy = clamp(p[1], iy);
                const cz = clamp(p[2], iz);
                let nx = p[0] - cx;
                let ny = p[1] - cy;
                let nz = p[2] - cz;
                const len = Math.hypot(nx, ny, nz);
                if (len > 1e-9) {
                    nx /= len;
                    ny /= len;
                    nz /= len;
                }
                else {
                    nx = na === 0 ? sign : 0;
                    ny = na === 1 ? sign : 0;
                    nz = na === 2 ? sign : 0;
                }
                g.vertex(cx + nx * rad, cy + ny * rad, cz + nz * rad, nx, ny, nz, 0, 0);
            }
        }
        const cols = us.length;
        // Winding: (u, v) basis must turn counter-clockwise around the outward normal.
        const ccw = ((ua + 1) % 3 === va ? 1 : -1) * sign > 0;
        for (let j = 0; j + 1 < vs.length; j++) {
            for (let k = 0; k + 1 < cols; k++) {
                const a = base + j * cols + k;
                const b = a + 1;
                const c = a + cols + 1;
                const e = a + cols;
                if (ccw)
                    g.i.push(a, b, c, a, c, e);
                else
                    g.i.push(a, c, b, a, e, c);
            }
        }
    }
    return g.boxUvs();
}
/**
 * Cylinder (or frustum) along +Y from y = 0 to `h`, radii `rBottom` / `rTop`,
 * `seg` sides. Smooth sides; flat caps unless disabled. UVs: around = arc
 * metres, up = height metres; caps planar.
 */
export function cylinder(rBottom, rTop, h, seg = 24, caps = {}) {
    const g = new Geom();
    const n = Math.max(3, Math.min(96, Math.round(seg)));
    const slope = (rBottom - rTop) / Math.max(1e-6, h);
    const nl = Math.hypot(1, slope);
    const circ = Math.PI * (rBottom + rTop);
    for (let k = 0; k <= n; k++) {
        const t = (k / n) * Math.PI * 2;
        const c = Math.cos(t);
        const s = Math.sin(t);
        const u = (k / n) * circ;
        g.vertex(c * rBottom, 0, s * rBottom, c / nl, slope / nl, s / nl, u, 0);
        g.vertex(c * rTop, h, s * rTop, c / nl, slope / nl, s / nl, u, h);
    }
    for (let k = 0; k < n; k++) {
        const a = k * 2;
        g.i.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
    if (caps.top !== false && rTop > 1e-5)
        disc(g, rTop, h, n, true);
    if (caps.bottom !== false && rBottom > 1e-5)
        disc(g, rBottom, 0, n, false);
    return g;
}
function disc(g, r, y, n, up) {
    const c0 = g.vertex(0, y, 0, 0, up ? 1 : -1, 0, 0, 0);
    for (let k = 0; k <= n; k++) {
        const t = (k / n) * Math.PI * 2;
        g.vertex(Math.cos(t) * r, y, Math.sin(t) * r, 0, up ? 1 : -1, 0, Math.cos(t) * r, Math.sin(t) * r);
    }
    for (let k = 0; k < n; k++) {
        const a = c0 + 1 + k;
        if (up)
            g.i.push(c0, a + 1, a);
        else
            g.i.push(c0, a, a + 1);
    }
}
/**
 * Surface of revolution around +Y from a profile of `[radius, y]` points
 * (bottom to top). Smooth normals from the profile tangent.
 */
export function lathe(profile, seg = 24) {
    const g = new Geom();
    const n = Math.max(3, Math.min(96, Math.round(seg)));
    const m = profile.length;
    if (m < 2)
        return g;
    // Profile normals (outward, in the r/y plane).
    const pn = [];
    let len = 0;
    const along = [0];
    for (let j = 0; j < m; j++) {
        const prev = profile[Math.max(0, j - 1)];
        const next = profile[Math.min(m - 1, j + 1)];
        const dr = next[0] - prev[0];
        const dy = next[1] - prev[1];
        const l = Math.hypot(dr, dy) || 1;
        pn.push([dy / l, -dr / l]);
        if (j > 0) {
            len += Math.hypot(profile[j][0] - profile[j - 1][0], profile[j][1] - profile[j - 1][1]);
            along.push(len);
        }
    }
    for (let k = 0; k <= n; k++) {
        const t = (k / n) * Math.PI * 2;
        const c = Math.cos(t);
        const s = Math.sin(t);
        for (let j = 0; j < m; j++) {
            const p = profile[j];
            const q = pn[j];
            g.vertex(c * p[0], p[1], s * p[0], c * q[0], q[1], s * q[0], (k / n) * Math.PI * 2 * Math.max(0.05, p[0]), along[j]);
        }
    }
    for (let k = 0; k < n; k++) {
        for (let j = 0; j + 1 < m; j++) {
            const a = k * m + j;
            const b = (k + 1) * m + j;
            g.i.push(a, a + 1, b + 1, a, b + 1, b);
        }
    }
    return g;
}
/** UV sphere centred on the origin. */
export function sphere(r, seg = 16) {
    const profile = [];
    const rings = Math.max(4, Math.round(seg / 2));
    for (let j = 0; j <= rings; j++) {
        const a = -Math.PI / 2 + (j / rings) * Math.PI;
        profile.push([Math.max(1e-5, Math.cos(a) * r), Math.sin(a) * r]);
    }
    return lathe(profile, seg);
}
/**
 * Prism: a plan polygon extruded from y0 to y1 with flat caps. Side UVs run
 * along the perimeter (metres).
 */
export function extrude(poly, y0, y1, caps = {}) {
    const g = new Geom();
    const pts = poly.length >= 3 && signedPositive(poly) ? poly.slice() : poly.slice().reverse();
    let u = 0;
    for (let k = 0; k < pts.length; k++) {
        const a = pts[k];
        const b = pts[(k + 1) % pts.length];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (l < 1e-6)
            continue;
        // Positive-area outline: outward normal is (dz, -dx)… pick the order that faces out.
        g.quadAuto([b[0], y0, b[1]], [a[0], y0, a[1]], [a[0], y1, a[1]], [b[0], y1, b[1]], u, y0);
        u += l;
    }
    if (caps.top !== false)
        g.flatPolygon(pts, y1, true);
    if (caps.bottom !== false)
        g.flatPolygon(pts, y0, false);
    return g;
}
function signedPositive(poly) {
    let s = 0;
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        s += a[0] * b[1] - b[0] * a[1];
    }
    return s > 0;
}
/**
 * Tube along a 3D polyline with radius `r` (parallel-transport frames,
 * `seg` sides). Used for handrails, chair frames and lamp arms.
 */
export function tube(path, r, seg = 10) {
    const g = new Geom();
    const m = path.length;
    if (m < 2)
        return g;
    const n = Math.max(3, Math.min(32, Math.round(seg)));
    const tangents = [];
    for (let j = 0; j < m; j++) {
        const a = path[Math.max(0, j - 1)];
        const b = path[Math.min(m - 1, j + 1)];
        const t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const l = Math.hypot(t[0], t[1], t[2]) || 1;
        tangents.push([t[0] / l, t[1] / l, t[2] / l]);
    }
    const t0 = tangents[0];
    let normal = Math.abs(t0[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const crossV = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const norm = (a) => {
        const l = Math.hypot(a[0], a[1], a[2]) || 1;
        return [a[0] / l, a[1] / l, a[2] / l];
    };
    let binormal = norm(crossV(t0, normal));
    normal = norm(crossV(binormal, t0));
    let along = 0;
    for (let j = 0; j < m; j++) {
        const t = tangents[j];
        if (j > 0) {
            binormal = norm(crossV(t, normal));
            normal = norm(crossV(binormal, t));
            const a = path[j - 1];
            const b = path[j];
            along += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        }
        const c = path[j];
        for (let k = 0; k <= n; k++) {
            const ang = (k / n) * Math.PI * 2;
            const cs = Math.cos(ang);
            const sn = Math.sin(ang);
            const nx = normal[0] * cs + binormal[0] * sn;
            const ny = normal[1] * cs + binormal[1] * sn;
            const nz = normal[2] * cs + binormal[2] * sn;
            g.vertex(c[0] + nx * r, c[1] + ny * r, c[2] + nz * r, nx, ny, nz, (k / n) * Math.PI * 2 * r, along);
        }
    }
    for (let j = 0; j + 1 < m; j++) {
        for (let k = 0; k < n; k++) {
            const a = j * (n + 1) + k;
            const b = (j + 1) * (n + 1) + k;
            g.i.push(a, b + 1, b, a, a + 1, b + 1);
        }
    }
    return g;
}
