import { finite, Mesh, MeshBuilder } from './mesh';
import { signedArea2, triangulate } from './triangulate';
/** Hard caps on kernel inputs (protect CPU/memory against hostile arguments). */
export const KERNEL_LIMITS = Object.freeze({
    MAX_DIMENSION: 10_000,
    MIN_DIMENSION: 1e-4,
    MAX_SEGMENTS: 256,
    MAX_PROFILE_POINTS: 1024,
    MAX_SHAPE_POINTS: 512,
    MAX_PATH_POINTS: 2048,
    MAX_GRID: 512,
    MAX_ICO_DETAIL: 4,
});
const TAU = Math.PI * 2;
/** Positive dimension clamped to [MIN_DIMENSION, MAX_DIMENSION]. */
export function dim(v, what) {
    const n = Math.abs(finite(v, what));
    return Math.min(KERNEL_LIMITS.MAX_DIMENSION, Math.max(KERNEL_LIMITS.MIN_DIMENSION, n));
}
/** Integer segment count, defaulting when undefined, clamped to [min, max]. */
export function segments(v, def, min, max = KERNEL_LIMITS.MAX_SEGMENTS) {
    if (v === undefined || v === null)
        return def;
    const n = Math.round(finite(v, 'segments'));
    return n < min ? min : n > max ? max : n;
}
function readPoints2(input, what, max) {
    if (!Array.isArray(input))
        throw new TypeError(`${what}: expected an array of [x, y] pairs`);
    if (input.length > max)
        throw new RangeError(`${what}: at most ${max} points`);
    const out = [];
    for (let i = 0; i < input.length; i++) {
        const p = input[i];
        if (!Array.isArray(p) || p.length < 2)
            throw new TypeError(`${what}[${i}]: expected [x, y]`);
        const x = finite(p[0], `${what}[${i}][0]`);
        const y = finite(p[1], `${what}[${i}][1]`);
        if (Math.abs(x) > KERNEL_LIMITS.MAX_DIMENSION || Math.abs(y) > KERNEL_LIMITS.MAX_DIMENSION) {
            throw new RangeError(`${what}[${i}]: coordinates must be within ±${KERNEL_LIMITS.MAX_DIMENSION}`);
        }
        out.push([x, y]);
    }
    return out;
}
function readPoints3(input, what, max) {
    if (!Array.isArray(input))
        throw new TypeError(`${what}: expected an array of [x, y, z] points`);
    if (input.length > max)
        throw new RangeError(`${what}: at most ${max} points`);
    const out = [];
    for (let i = 0; i < input.length; i++) {
        const p = input[i];
        if (!Array.isArray(p) || p.length < 3)
            throw new TypeError(`${what}[${i}]: expected [x, y, z]`);
        const v = [finite(p[0], `${what}[${i}][0]`), finite(p[1], `${what}[${i}][1]`), finite(p[2], `${what}[${i}][2]`)];
        if (v.some((c) => Math.abs(c) > KERNEL_LIMITS.MAX_DIMENSION)) {
            throw new RangeError(`${what}[${i}]: coordinates must be within ±${KERNEL_LIMITS.MAX_DIMENSION}`);
        }
        out.push(v);
    }
    return out;
}
/** Axis-aligned box centered on the origin; 24 vertices with hard edges. */
export function box(budget, w, h, d) {
    const hx = dim(w, 'box(w)') / 2, hy = dim(h, 'box(h)') / 2, hz = dim(d, 'box(d)') / 2;
    const b = new MeshBuilder(24, 36);
    // [normal, u axis, v axis] with u × v = normal
    const faces = [
        [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
        [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
        [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
        [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
        [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
        [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
    ];
    const half = [hx, hy, hz];
    const ext = (axis) => Math.abs(axis[0]) * half[0] + Math.abs(axis[1]) * half[1] + Math.abs(axis[2]) * half[2];
    for (const [n, u, v] of faces) {
        const hn = ext(n), hu = ext(u), hv = ext(v);
        const base = b.vcount;
        for (let k = 0; k < 4; k++) {
            const su = k === 1 || k === 2 ? 1 : -1;
            const sv = k >= 2 ? 1 : -1;
            b.vertex(n[0] * hn + u[0] * hu * su + v[0] * hv * sv, n[1] * hn + u[1] * hu * su + v[1] * hv * sv, n[2] * hn + u[2] * hu * su + v[2] * hv * sv, n[0], n[1], n[2], (su + 1) / 2, (sv + 1) / 2);
        }
        b.quad(base, base + 1, base + 2, base + 3);
    }
    return b.build(budget);
}
/**
 * Surface of revolution around +Y. `profile` holds [radius, y] pairs; repeat a
 * point to get a sharp crease. Descending profiles are reversed so faces
 * always point outward.
 */
export function latheInto(b, profileIn, segs) {
    let profile = profileIn.map(([r, y]) => [Math.max(0, r), y]);
    let orient = 0;
    for (let j = 0; j + 1 < profile.length; j++) {
        const p0 = profile[j], p1 = profile[j + 1];
        orient += (p0[0] + p1[0]) * (p1[1] - p0[1]);
    }
    if (orient < 0)
        profile = profile.reverse();
    const len = profile.length;
    const nr = new Float64Array(len);
    const ny = new Float64Array(len);
    for (let j = 0; j < len; j++) {
        const p = profile[j];
        const prev = profile[j - 1];
        const next = profile[j + 1];
        // a duplicated neighbour marks a sharp crease: use only the other side
        const usePrev = prev !== undefined && !(prev[0] === p[0] && prev[1] === p[1]);
        const useNext = next !== undefined && !(next[0] === p[0] && next[1] === p[1]);
        const a = usePrev ? prev : p;
        const c = useNext ? next : p;
        let tr = c[0] - a[0];
        let ty = c[1] - a[1];
        if (tr === 0 && ty === 0)
            ty = 1;
        const l = Math.hypot(tr, ty);
        tr /= l;
        ty /= l;
        nr[j] = ty;
        ny[j] = -tr;
        // a pole (on the axis, leaving it mostly horizontally) gets an exact axial normal
        if (p[0] === 0 && Math.abs(tr) > Math.abs(ty)) {
            nr[j] = 0;
            ny[j] = -tr > 0 ? 1 : -1;
        }
    }
    const base = b.vcount;
    for (let i = 0; i <= segs; i++) {
        const phi = (i / segs) * TAU;
        const s = Math.sin(phi), co = Math.cos(phi);
        for (let j = 0; j < len; j++) {
            const p = profile[j];
            b.vertex(p[0] * s, p[1], p[0] * co, nr[j] * s, ny[j], nr[j] * co, i / segs, len > 1 ? j / (len - 1) : 0);
        }
    }
    for (let i = 0; i < segs; i++) {
        for (let j = 0; j + 1 < len; j++) {
            const a = base + i * len + j;
            const bb = base + (i + 1) * len + j;
            const c = bb + 1;
            const d = a + 1;
            const r0 = profile[j][0];
            const r1 = profile[j + 1][0];
            if (r0 > 0)
                b.tri(a, bb, d);
            if (r1 > 0)
                b.tri(bb, c, d);
        }
    }
}
/** Flat disc at height y facing up (+Y) or down. */
export function discInto(b, y, r, segs, up) {
    const ny = up ? 1 : -1;
    const center = b.vertex(0, y, 0, 0, ny, 0, 0.5, 0.5);
    const ring = b.vcount;
    for (let i = 0; i <= segs; i++) {
        const phi = (i / segs) * TAU;
        const s = Math.sin(phi), c = Math.cos(phi);
        b.vertex(r * s, y, r * c, 0, ny, 0, 0.5 + 0.5 * s, 0.5 + 0.5 * c);
    }
    for (let i = 0; i < segs; i++) {
        if (up)
            b.tri(center, ring + i, ring + i + 1);
        else
            b.tri(center, ring + i + 1, ring + i);
    }
}
/** Generic lathe (see {@link latheInto}); validates the profile. */
export function lathe(budget, profile, segs) {
    const pts = readPoints2(profile, 'lathe(profile)', KERNEL_LIMITS.MAX_PROFILE_POINTS);
    if (pts.length < 2)
        throw new RangeError('lathe(profile): need at least 2 points');
    const s = segments(segs, 12, 3);
    const b = new MeshBuilder((s + 1) * pts.length, s * pts.length * 6);
    latheInto(b, pts, s);
    return b.build(budget);
}
/** UV sphere; detail 0..6 maps to 8..32 longitudinal segments. */
export function sphere(budget, r, detail) {
    const radius = dim(r, 'sphere(r)');
    const level = segments(detail, 2, 0, 6);
    const cols = 8 + 4 * level;
    const rows = cols / 2;
    const profile = [];
    for (let j = 0; j <= rows; j++) {
        const a = -Math.PI / 2 + (j / rows) * Math.PI;
        profile.push([j === 0 || j === rows ? 0 : radius * Math.cos(a), radius * Math.sin(a)]);
    }
    const b = new MeshBuilder((cols + 1) * (rows + 1), cols * rows * 6);
    latheInto(b, profile, cols);
    return b.build(budget);
}
/** Cylinder along Y centered on the origin (rTop may be 0 → cone). Capped. */
export function cylinder(budget, rTop, rBottom, h, segs) {
    const rt = Math.abs(finite(rTop, 'cylinder(rTop)')) > 0 ? dim(rTop, 'cylinder(rTop)') : 0;
    const rb = Math.abs(finite(rBottom, 'cylinder(rBottom)')) > 0 ? dim(rBottom, 'cylinder(rBottom)') : 0;
    if (rt === 0 && rb === 0)
        throw new RangeError('cylinder: at least one radius must be > 0');
    const height = dim(h, 'cylinder(h)');
    const s = segments(segs, 16, 3);
    const b = new MeshBuilder((s + 1) * 6, s * 12);
    latheInto(b, [[rb, -height / 2], [rt, height / 2]], s);
    if (rt > 0)
        discInto(b, height / 2, rt, s, true);
    if (rb > 0)
        discInto(b, -height / 2, rb, s, false);
    return b.build(budget);
}
/** Cone along Y centered on the origin (apex up). */
export function cone(budget, r, h, segs) {
    return cylinder(budget, 0, r, h, segs);
}
/** Torus in the XY plane (facing +Z), ring radius r and tube radius `tube`. */
export function torus(budget, r, tube, radialSegs = 10, tubularSegs = 24) {
    const R = dim(r, 'torus(r)');
    const t = dim(tube, 'torus(tube)');
    const rs = segments(radialSegs, 10, 3, 64);
    const ts = segments(tubularSegs, 24, 3, 128);
    const b = new MeshBuilder((rs + 1) * (ts + 1), rs * ts * 6);
    for (let j = 0; j <= rs; j++) {
        const v = (j / rs) * TAU;
        const cv = Math.cos(v), sv = Math.sin(v);
        for (let i = 0; i <= ts; i++) {
            const u = (i / ts) * TAU;
            const cu = Math.cos(u), su = Math.sin(u);
            b.vertex((R + t * cv) * cu, (R + t * cv) * su, t * sv, cv * cu, cv * su, sv, i / ts, j / rs);
        }
    }
    for (let j = 1; j <= rs; j++) {
        for (let i = 1; i <= ts; i++) {
            const a = (ts + 1) * j + i - 1;
            const bb = (ts + 1) * (j - 1) + i - 1;
            const c = (ts + 1) * (j - 1) + i;
            const d = (ts + 1) * j + i;
            b.tri(a, bb, d);
            b.tri(bb, c, d);
        }
    }
    return b.build(budget);
}
/** Capsule along Y centered on the origin; `h` is the TOTAL height (clamped ≥ 2r). */
export function capsule(budget, r, h, segs = 12) {
    const radius = dim(r, 'capsule(r)');
    const height = Math.max(2 * radius, dim(h, 'capsule(h)'));
    const half = (height - 2 * radius) / 2;
    const q = 5;
    const profile = [];
    for (let k = 0; k <= q; k++) {
        const a = -Math.PI / 2 + (k / q) * (Math.PI / 2);
        profile.push([k === 0 ? 0 : radius * Math.cos(a), -half + radius * Math.sin(a)]);
    }
    for (let k = 0; k <= q; k++) {
        const a = (k / q) * (Math.PI / 2);
        profile.push([k === q ? 0 : radius * Math.cos(a), half + radius * Math.sin(a)]);
    }
    const s = segments(segs, 12, 3, 64);
    const b = new MeshBuilder((s + 1) * profile.length, s * profile.length * 6);
    latheInto(b, profile, s);
    return b.build(budget);
}
/** Plane in XZ at y = 0 facing +Y, centered on the origin. */
export function plane(budget, w, d, segX, segZ) {
    const width = dim(w, 'plane(w)');
    const depth = dim(d, 'plane(d)');
    const sx = segments(segX, 1, 1, KERNEL_LIMITS.MAX_GRID);
    const sz = segments(segZ, 1, 1, KERNEL_LIMITS.MAX_GRID);
    return gridMesh(budget, sx, sz, width, depth, null);
}
/**
 * Regular grid in XZ (cols × rows cells) with y from `heights` (row-major over
 * z then x: index iz * (cols + 1) + ix) or 0. Normals from central differences.
 */
export function gridMesh(budget, cols, rows, width, depth, heights) {
    const b = new MeshBuilder((cols + 1) * (rows + 1), cols * rows * 6);
    const dx = width / cols;
    const dz = depth / rows;
    const at = (ix, iz) => heights ? heights[Math.min(rows, Math.max(0, iz)) * (cols + 1) + Math.min(cols, Math.max(0, ix))] : 0;
    for (let iz = 0; iz <= rows; iz++) {
        for (let ix = 0; ix <= cols; ix++) {
            const y = at(ix, iz);
            let nx = 0, ny = 1, nz = 0;
            if (heights) {
                const hl = at(ix - 1, iz), hr = at(ix + 1, iz), hd = at(ix, iz - 1), hu = at(ix, iz + 1);
                const sx = (hr - hl) / ((Math.min(cols, ix + 1) - Math.max(0, ix - 1)) * dx);
                const sz = (hu - hd) / ((Math.min(rows, iz + 1) - Math.max(0, iz - 1)) * dz);
                const l = Math.hypot(sx, 1, sz);
                nx = -sx / l;
                ny = 1 / l;
                nz = -sz / l;
            }
            b.vertex(-width / 2 + ix * dx, y, -depth / 2 + iz * dz, nx, ny, nz, ix / cols, 1 - iz / rows);
        }
    }
    for (let iz = 0; iz < rows; iz++) {
        for (let ix = 0; ix < cols; ix++) {
            const a = iz * (cols + 1) + ix;
            const c = a + 1;
            const bb = a + cols + 1;
            const d = bb + 1;
            b.tri(a, bb, c);
            b.tri(c, bb, d);
        }
    }
    return b.build(budget);
}
/** Heightfield grid centered on the origin: y = height(x, z) (meters). */
export function heightfield(budget, cols, rows, width, depth, height) {
    if (typeof height !== 'function')
        throw new TypeError('heightfield(height): height must be a function (x, z) => y');
    const c = segments(cols, 32, 1, KERNEL_LIMITS.MAX_GRID);
    const r = segments(rows, 32, 1, KERNEL_LIMITS.MAX_GRID);
    const w = dim(width, 'heightfield(width)');
    const d = dim(depth, 'heightfield(depth)');
    const heights = new Float64Array((c + 1) * (r + 1));
    for (let iz = 0; iz <= r; iz++) {
        for (let ix = 0; ix <= c; ix++) {
            const y = finite(height(-w / 2 + (ix * w) / c, -d / 2 + (iz * d) / r), 'heightfield: height result');
            heights[iz * (c + 1) + ix] = Math.max(-KERNEL_LIMITS.MAX_DIMENSION, Math.min(KERNEL_LIMITS.MAX_DIMENSION, y));
        }
    }
    return gridMesh(budget, c, r, w, d, heights);
}
/** Polygon (XY plane) extruded along Z, centered (z ∈ [-depth/2, depth/2]), with caps. */
export function extrude(budget, shape, depth) {
    const raw = readPoints2(shape, 'extrude(shape)', KERNEL_LIMITS.MAX_SHAPE_POINTS);
    const pts = [];
    for (const p of raw) {
        const last = pts[pts.length - 1];
        if (!last || last[0] !== p[0] || last[1] !== p[1])
            pts.push(p);
    }
    const first = pts[0];
    const lastP = pts[pts.length - 1];
    if (pts.length > 1 && first && lastP && first[0] === lastP[0] && first[1] === lastP[1])
        pts.pop();
    if (pts.length < 3)
        throw new RangeError('extrude(shape): need at least 3 distinct points');
    let xs = pts.map((p) => p[0]);
    let ys = pts.map((p) => p[1]);
    const area = signedArea2(xs, ys);
    if (Math.abs(area) < 1e-10)
        throw new RangeError('extrude(shape): polygon has zero area');
    if (area < 0) {
        xs = xs.reverse();
        ys = ys.reverse();
    }
    const hz = dim(depth, 'extrude(depth)') / 2;
    const n = xs.length;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
        minX = Math.min(minX, xs[i]);
        maxX = Math.max(maxX, xs[i]);
        minY = Math.min(minY, ys[i]);
        maxY = Math.max(maxY, ys[i]);
    }
    const su = 1 / Math.max(1e-9, maxX - minX);
    const sv = 1 / Math.max(1e-9, maxY - minY);
    const tris = triangulate(xs, ys);
    const b = new MeshBuilder(n * 6, tris.length * 2 + n * 6);
    // caps
    const front = b.vcount;
    for (let i = 0; i < n; i++)
        b.vertex(xs[i], ys[i], hz, 0, 0, 1, (xs[i] - minX) * su, (ys[i] - minY) * sv);
    const back = b.vcount;
    for (let i = 0; i < n; i++)
        b.vertex(xs[i], ys[i], -hz, 0, 0, -1, 1 - (xs[i] - minX) * su, (ys[i] - minY) * sv);
    for (let t = 0; t < tris.length; t += 3) {
        const a = tris[t], c = tris[t + 1], d = tris[t + 2];
        b.tri(front + a, front + c, front + d);
        b.tri(back + a, back + d, back + c);
    }
    // sides (one quad per edge, hard edges)
    let perimeter = 0;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ex = xs[j] - xs[i], ey = ys[j] - ys[i];
        const len = Math.hypot(ex, ey);
        const nx = ey / len, ny = -ex / len;
        const u0 = perimeter;
        perimeter += len;
        const v0 = b.vertex(xs[i], ys[i], -hz, nx, ny, 0, u0, 0);
        b.vertex(xs[j], ys[j], -hz, nx, ny, 0, perimeter, 0);
        b.vertex(xs[j], ys[j], hz, nx, ny, 0, perimeter, 1);
        b.vertex(xs[i], ys[i], hz, nx, ny, 0, u0, 1);
        b.quad(v0, v0 + 1, v0 + 2, v0 + 3);
    }
    return b.build(budget);
}
/**
 * Tube along a polyline using parallel-transport frames (no twisting), with
 * flat end caps. `radiusAt(t)` (t ∈ [0, 1] along the path) allows tapering.
 */
export function tube(budget, pathIn, radius, radialSegments, radiusAt) {
    const raw = readPoints3(pathIn, 'tube(path)', KERNEL_LIMITS.MAX_PATH_POINTS);
    const path = [];
    for (const p of raw) {
        const last = path[path.length - 1];
        if (!last || Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) > 1e-7)
            path.push(p);
    }
    if (path.length < 2)
        throw new RangeError('tube(path): need at least 2 distinct points');
    const r = dim(radius, 'tube(radius)');
    const rs = segments(radialSegments, 8, 3, 64);
    const n = path.length;
    const frames = transportFrames(path);
    const lengths = new Float64Array(n);
    for (let i = 1; i < n; i++) {
        const a = path[i - 1], c = path[i];
        lengths[i] = lengths[i - 1] + Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    }
    const total = lengths[n - 1];
    const b = new MeshBuilder(n * (rs + 1) + 2 * (rs + 2), n * rs * 6 + rs * 6);
    const radii = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const t = lengths[i] / total;
        radii[i] = radiusAt ? r * Math.max(0, finite(radiusAt(t), 'tube radius')) : r;
    }
    for (let i = 0; i < n; i++) {
        const p = path[i];
        const o = i * 9;
        for (let j = 0; j <= rs; j++) {
            const th = (j / rs) * TAU;
            const c = Math.cos(th), s = Math.sin(th);
            const dx = c * frames[o + 3] + s * frames[o + 6];
            const dy = c * frames[o + 4] + s * frames[o + 7];
            const dz = c * frames[o + 5] + s * frames[o + 8];
            const ri = radii[i];
            b.vertex(p[0] + dx * ri, p[1] + dy * ri, p[2] + dz * ri, dx, dy, dz, j / rs, lengths[i] / total);
        }
    }
    for (let i = 0; i + 1 < n; i++) {
        for (let j = 0; j < rs; j++) {
            const a = i * (rs + 1) + j;
            const bb = a + rs + 1;
            b.tri(a, a + 1, bb);
            b.tri(bb, a + 1, bb + 1);
        }
    }
    // caps
    for (const end of [0, n - 1]) {
        const ri = radii[end];
        if (ri <= 0)
            continue;
        const o = end * 9;
        const sign = end === 0 ? -1 : 1;
        const tx = frames[o] * sign, ty = frames[o + 1] * sign, tz = frames[o + 2] * sign;
        const p = path[end];
        const center = b.vertex(p[0], p[1], p[2], tx, ty, tz, 0.5, 0.5);
        const ring = b.vcount;
        for (let j = 0; j <= rs; j++) {
            const th = (j / rs) * TAU;
            const c = Math.cos(th), s = Math.sin(th);
            const dx = c * frames[o + 3] + s * frames[o + 6];
            const dy = c * frames[o + 4] + s * frames[o + 7];
            const dz = c * frames[o + 5] + s * frames[o + 8];
            b.vertex(p[0] + dx * ri, p[1] + dy * ri, p[2] + dz * ri, tx, ty, tz, 0.5 + 0.5 * c, 0.5 + 0.5 * s);
        }
        for (let j = 0; j < rs; j++) {
            if (sign > 0)
                b.tri(center, ring + j, ring + j + 1);
            else
                b.tri(center, ring + j + 1, ring + j);
        }
    }
    return b.build(budget);
}
/**
 * Parallel-transport frames along a polyline: per point [tangent, normal,
 * binormal] (9 floats), with binormal = tangent × normal.
 */
export function transportFrames(path) {
    const n = path.length;
    const f = new Float64Array(n * 9);
    for (let i = 0; i < n; i++) {
        const a = path[Math.max(0, i - 1)];
        const c = path[Math.min(n - 1, i + 1)];
        let tx = c[0] - a[0], ty = c[1] - a[1], tz = c[2] - a[2];
        const l = Math.hypot(tx, ty, tz) || 1;
        tx /= l;
        ty /= l;
        tz /= l;
        f[i * 9] = tx;
        f[i * 9 + 1] = ty;
        f[i * 9 + 2] = tz;
    }
    // initial normal: perpendicular to t0 using the least-aligned axis
    const t0x = f[0], t0y = f[1], t0z = f[2];
    const ax = Math.abs(t0x), ay = Math.abs(t0y), az = Math.abs(t0z);
    let ux = 0, uy = 0, uz = 0;
    if (ax <= ay && ax <= az)
        ux = 1;
    else if (ay <= az)
        uy = 1;
    else
        uz = 1;
    // n = normalize(u - (u·t) t)
    const dot = ux * t0x + uy * t0y + uz * t0z;
    let nx = ux - dot * t0x, ny = uy - dot * t0y, nz = uz - dot * t0z;
    let nl = Math.hypot(nx, ny, nz);
    nx /= nl;
    ny /= nl;
    nz /= nl;
    for (let i = 0; i < n; i++) {
        const o = i * 9;
        const tx = f[o], ty = f[o + 1], tz = f[o + 2];
        if (i > 0) {
            // project previous normal onto the plane of the new tangent (transport)
            const d = nx * tx + ny * ty + nz * tz;
            let px = nx - d * tx, py = ny - d * ty, pz = nz - d * tz;
            nl = Math.hypot(px, py, pz);
            if (nl < 1e-9) {
                // tangent flipped onto the old normal: fall back to the old binormal direction
                const p = o - 9;
                px = f[p + 6];
                py = f[p + 7];
                pz = f[p + 8];
                nl = 1;
            }
            nx = px / nl;
            ny = py / nl;
            nz = pz / nl;
        }
        f[o + 3] = nx;
        f[o + 4] = ny;
        f[o + 5] = nz;
        f[o + 6] = ty * nz - tz * ny;
        f[o + 7] = tz * nx - tx * nz;
        f[o + 8] = tx * ny - ty * nx;
    }
    return f;
}
/** Subdivided icosahedron (unit directions scaled by r), shared vertices, smooth normals. */
export function icosphere(budget, r, detail) {
    const radius = dim(r, 'icosphere(r)');
    const level = segments(detail, 1, 0, KERNEL_LIMITS.MAX_ICO_DETAIL);
    const t = (1 + Math.sqrt(5)) / 2;
    const verts = [-1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, 0, 0, -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, t, 0, -1, t, 0, 1, -t, 0, -1, -t, 0, 1];
    let faces = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];
    for (let i = 0; i < verts.length; i += 3) {
        const l = Math.hypot(verts[i], verts[i + 1], verts[i + 2]);
        verts[i] = verts[i] / l;
        verts[i + 1] = verts[i + 1] / l;
        verts[i + 2] = verts[i + 2] / l;
    }
    for (let s = 0; s < level; s++) {
        const cache = new Map();
        const mid = (a, b) => {
            const key = a < b ? a * 100003 + b : b * 100003 + a;
            const hit = cache.get(key);
            if (hit !== undefined)
                return hit;
            let x = (verts[a * 3] + verts[b * 3]) / 2;
            let y = (verts[a * 3 + 1] + verts[b * 3 + 1]) / 2;
            let z = (verts[a * 3 + 2] + verts[b * 3 + 2]) / 2;
            const l = Math.hypot(x, y, z);
            x /= l;
            y /= l;
            z /= l;
            const idx = verts.length / 3;
            verts.push(x, y, z);
            cache.set(key, idx);
            return idx;
        };
        const next = [];
        for (let f = 0; f < faces.length; f += 3) {
            const a = faces[f], b = faces[f + 1], c = faces[f + 2];
            const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
            next.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
        }
        faces = next;
    }
    const nv = verts.length / 3;
    const b = new MeshBuilder(nv, faces.length);
    for (let i = 0; i < nv; i++) {
        const x = verts[i * 3], y = verts[i * 3 + 1], z = verts[i * 3 + 2];
        b.vertex(x * radius, y * radius, z * radius, x, y, z, 0.5 + Math.atan2(x, z) / TAU, 0.5 + Math.asin(Math.max(-1, Math.min(1, y))) / Math.PI);
    }
    for (let f = 0; f < faces.length; f += 3)
        b.tri(faces[f], faces[f + 1], faces[f + 2]);
    return b.build(budget);
}
/**
 * Low-poly rock: icosphere displaced by seeded 3D noise, then un-indexed so
 * every facet has its own normal (flat-shaded look).
 */
export function icosphereRock(budget, noise, random, r, roughness, detail = 2) {
    const radius = dim(r, 'icosphereRock(r)');
    const rough = Math.min(1, Math.max(0, finite(roughness, 'icosphereRock(roughness)')));
    const mesh = icosphere(budget, radius, detail);
    const ox = random() * 100, oy = random() * 100, oz = random() * 100;
    const p = mesh.positions;
    for (let i = 0; i < p.length; i += 3) {
        const x = p[i] / radius, y = p[i + 1] / radius, z = p[i + 2] / radius;
        const n = 0.65 * noise.noise3(x * 1.2 + ox, y * 1.2 + oy, z * 1.2 + oz) + 0.35 * noise.noise3(x * 2.9 - oz, y * 2.9 + ox, z * 2.9 - oy);
        const k = Math.max(0.35, 1 + rough * 0.55 * n);
        p[i] = x * radius * k;
        p[i + 1] = y * radius * k;
        p[i + 2] = z * radius * k;
    }
    return mesh.toFlat();
}
