/**
 * A small geometry kit for the vehicle models (dev-only, no dependencies): lofted bodies from superellipse
 * cross-sections, surfaces of revolution (tyres, rims), tubes (frames, hoops, arms), surface-conforming decals
 * and flat helpers. Meshes are indexed triangle lists with smooth (area-weighted) normals.
 *
 * Authoring frame: +X forward, +Y up, +Z to the right. `toLibraryFrame` rotates the finished model so it faces
 * -Z like every other library vehicle.
 */
/** A fresh empty mesh. */
export function mesh() {
    return { p: [], n: [], i: [] };
}
/** Append `src` to `dst`. */
export function append(dst, src) {
    const base = dst.p.length / 3;
    for (const v of src.p)
        dst.p.push(v);
    for (const v of src.n)
        dst.n.push(v);
    for (const v of src.i)
        dst.i.push(v + base);
    return dst;
}
/** Concatenate meshes. */
export function merge(...ms) {
    const out = mesh();
    for (const m of ms)
        append(out, m);
    return out;
}
/** Number of triangles. */
export function triangles(m) {
    return m.i.length / 3;
}
/** Signed power: sgn(x) * |x|^p. */
export function sgnpow(x, p) {
    return Math.sign(x) * Math.abs(x) ** p;
}
/** Recompute area-weighted vertex normals (for the vertices of triangles in `from`..end; default all). */
export function smooth(m, fromTriangle = 0) {
    const acc = new Float64Array(m.p.length);
    for (let t = fromTriangle * 3; t < m.i.length; t += 3) {
        const a = m.i[t];
        const b = m.i[t + 1];
        const c = m.i[t + 2];
        const ux = m.p[b * 3] - m.p[a * 3];
        const uy = m.p[b * 3 + 1] - m.p[a * 3 + 1];
        const uz = m.p[b * 3 + 2] - m.p[a * 3 + 2];
        const vx = m.p[c * 3] - m.p[a * 3];
        const vy = m.p[c * 3 + 1] - m.p[a * 3 + 1];
        const vz = m.p[c * 3 + 2] - m.p[a * 3 + 2];
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        for (const v of [a, b, c]) {
            acc[v * 3] = acc[v * 3] + nx;
            acc[v * 3 + 1] = acc[v * 3 + 1] + ny;
            acc[v * 3 + 2] = acc[v * 3 + 2] + nz;
        }
    }
    m.n = new Array(m.p.length).fill(0);
    for (let v = 0; v < m.p.length / 3; v++) {
        const x = acc[v * 3];
        const y = acc[v * 3 + 1];
        const z = acc[v * 3 + 2];
        const l = Math.hypot(x, y, z) || 1;
        m.n[v * 3] = x / l;
        m.n[v * 3 + 1] = y / l;
        m.n[v * 3 + 2] = z / l;
    }
    return m;
}
/** Apply a function to every position (and recompute the normals). */
export function mapPoints(m, f) {
    for (let k = 0; k < m.p.length; k += 3) {
        const r = f(m.p[k], m.p[k + 1], m.p[k + 2]);
        m.p[k] = r[0];
        m.p[k + 1] = r[1];
        m.p[k + 2] = r[2];
    }
    return smooth(m);
}
/** Translate a mesh in place. */
export function move(m, x, y, z) {
    for (let k = 0; k < m.p.length; k += 3) {
        m.p[k] = m.p[k] + x;
        m.p[k + 1] = m.p[k + 1] + y;
        m.p[k + 2] = m.p[k + 2] + z;
    }
    return m;
}
/** Mirror across the XY plane (z -> -z), flipping the winding. */
export function mirrorZ(m) {
    const out = mesh();
    for (let k = 0; k < m.p.length; k += 3) {
        out.p.push(m.p[k], m.p[k + 1], -m.p[k + 2]);
        out.n.push(m.n[k], m.n[k + 1], -m.n[k + 2]);
    }
    for (let t = 0; t < m.i.length; t += 3)
        out.i.push(m.i[t], m.i[t + 2], m.i[t + 1]);
    return out;
}
/** Scale in place. */
export function scaleMesh(m, sx, sy = sx, sz = sx) {
    for (let k = 0; k < m.p.length; k += 3) {
        m.p[k] = m.p[k] * sx;
        m.p[k + 1] = m.p[k + 1] * sy;
        m.p[k + 2] = m.p[k + 2] * sz;
    }
    return smooth(m);
}
/** Rotate about the X axis (radians). */
export function rotX(m, a) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return mapPoints(m, (x, y, z) => [x, y * c - z * s, y * s + z * c]);
}
/** Rotate about the Y axis (radians). */
export function rotY(m, a) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return mapPoints(m, (x, y, z) => [x * c + z * s, y, -x * s + z * c]);
}
/** Rotate about the Z axis (radians). */
export function rotZ(m, a) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return mapPoints(m, (x, y, z) => [x * c - y * s, x * s + y * c, z]);
}
/** Rotate from the authoring frame (+X forward) to the library frame (-Z forward): (x, y, z) -> (z, y, -x). */
export function toLibraryFrame(m) {
    for (let k = 0; k < m.p.length; k += 3) {
        const x = m.p[k];
        const z = m.p[k + 2];
        m.p[k] = z;
        m.p[k + 2] = -x;
        const nx = m.n[k];
        const nz = m.n[k + 2];
        m.n[k] = nz;
        m.n[k + 2] = -nx;
    }
    return m;
}
/** Linear interpolation of a section at `x` (clamped to the ends). */
export function sectionAt(secs, x) {
    const first = secs[0];
    const last = secs[secs.length - 1];
    const fill = (s) => ({ x: s.x, hw: s.hw, y0: s.y0, y1: s.y1, zc: s.zc ?? 0, e: s.e ?? 2.6 });
    if (x <= first.x)
        return fill(first);
    if (x >= last.x)
        return fill(last);
    for (let k = 0; k < secs.length - 1; k++) {
        const a = secs[k];
        const b = secs[k + 1];
        if (x >= a.x && x <= b.x) {
            const t = (x - a.x) / (b.x - a.x || 1);
            const fa = fill(a);
            const fb = fill(b);
            const l = (u, v) => u + (v - u) * t;
            return { x, hw: l(fa.hw, fb.hw), y0: l(fa.y0, fb.y0), y1: l(fa.y1, fb.y1), zc: l(fa.zc, fb.zc), e: l(fa.e, fb.e) };
        }
    }
    return fill(last);
}
/** Smooth a section list: Catmull-Rom resample to `count` sections between the first and last x. */
export function resample(secs, count) {
    const out = [];
    const x0 = secs[0].x;
    const x1 = secs[secs.length - 1].x;
    const cr = (p0, p1, p2, p3, t) => 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
    for (let k = 0; k < count; k++) {
        const x = x0 + ((x1 - x0) * k) / (count - 1);
        let j = 0;
        while (j < secs.length - 2 && x > secs[j + 1].x)
            j++;
        const a = secs[Math.max(0, j - 1)];
        const b = secs[j];
        const c = secs[j + 1];
        const d = secs[Math.min(secs.length - 1, j + 2)];
        const t = (x - b.x) / (c.x - b.x || 1);
        const ch = (f) => cr(f(a), f(b), f(c), f(d), Math.max(0, Math.min(1, t)));
        out.push({ x, hw: Math.max(0.005, ch((s) => s.hw)), y0: ch((s) => s.y0), y1: Math.max(ch((s) => s.y0) + 0.004, ch((s) => s.y1)), zc: ch((s) => s.zc ?? 0), e: ch((s) => s.e ?? 2.6) });
    }
    return out;
}
/** Point of a section's ring at parameter angle `t`. */
export function ringPoint(s, t) {
    const c = Math.cos(t);
    const sn = Math.sin(t);
    const p = 2 / s.e;
    return [s.x, (s.y0 + s.y1) / 2 + ((s.y1 - s.y0) / 2) * sgnpow(sn, p), s.zc + s.hw * sgnpow(c, p)];
}
/** Height of a section's upper surface at lateral offset `z` (null when outside). */
export function topY(s, z) {
    const u = Math.abs(z - s.zc) / s.hw;
    if (u >= 1)
        return null;
    return (s.y0 + s.y1) / 2 + ((s.y1 - s.y0) / 2) * (1 - u ** s.e) ** (1 / s.e);
}
/** Side-surface lateral offset at height `y` (positive side), or null outside the section. */
export function sideZ(s, y) {
    const hh = (s.y1 - s.y0) / 2;
    const v = Math.abs(y - (s.y0 + s.y1) / 2) / hh;
    if (v >= 1)
        return null;
    return s.zc + s.hw * (1 - v ** s.e) ** (1 / s.e);
}
/** Loft sections into a closed solid with flat end caps. `ring` points per cross-section. */
export function loft(secs, opts = {}) {
    const ring = opts.ring ?? 28;
    const m = mesh();
    const full = secs.map((s) => ({ x: s.x, hw: s.hw, y0: s.y0, y1: s.y1, zc: s.zc ?? 0, e: s.e ?? 2.6 }));
    for (const s of full) {
        for (let k = 0; k < ring; k++) {
            const q = ringPoint(s, (k / ring) * Math.PI * 2);
            m.p.push(q[0], q[1], q[2]);
        }
    }
    for (let j = 0; j < full.length - 1; j++) {
        for (let k = 0; k < ring; k++) {
            const a = j * ring + k;
            const b = j * ring + ((k + 1) % ring);
            const c = (j + 1) * ring + k;
            const d = (j + 1) * ring + ((k + 1) % ring);
            // Counter-clockwise seen from outside (ring runs +Z -> +Y with x increasing).
            m.i.push(a, c, b, b, c, d);
        }
    }
    smooth(m);
    const cap = (s, dir) => {
        const base = m.p.length / 3;
        const c = [s.x, (s.y0 + s.y1) / 2, s.zc];
        m.p.push(c[0], c[1], c[2]);
        m.n.push(dir, 0, 0);
        for (let k = 0; k < ring; k++) {
            const q = ringPoint(s, (k / ring) * Math.PI * 2);
            m.p.push(q[0], q[1], q[2]);
            m.n.push(dir, 0, 0);
        }
        for (let k = 0; k < ring; k++) {
            const a = base + 1 + k;
            const b = base + 1 + ((k + 1) % ring);
            if (dir === 1)
                m.i.push(base, a, b);
            else
                m.i.push(base, b, a);
        }
    };
    // Winding check: sides use (a, c, b) with the ring running +Z to +Y, which faces outward for increasing x.
    if (opts.capStart !== false)
        cap(full[0], -1);
    if (opts.capEnd !== false)
        cap(full[full.length - 1], 1);
    return m;
}
/** A rounded box (superellipse loft of two sections). */
export function roundedBox(cx, cy, cz, w, h, d, e = 5) {
    return loft([
        { x: cx - w / 2, hw: d / 2, y0: cy - h / 2, y1: cy + h / 2, zc: cz, e },
        { x: cx + w / 2, hw: d / 2, y0: cy - h / 2, y1: cy + h / 2, zc: cz, e },
    ], { ring: 20 });
}
/** An ellipsoid (loft of ellipse sections). */
export function ellipsoid(cx, cy, cz, rx, ry, rz, steps = 14, ring = 20) {
    const secs = [];
    for (let k = 0; k <= steps; k++) {
        const a = -Math.PI / 2 + (k / steps) * Math.PI;
        const r = Math.cos(a);
        secs.push({ x: cx + rx * Math.sin(a), hw: Math.max(0.002, rz * r), y0: cy - Math.max(0.002, ry * r), y1: cy + Math.max(0.002, ry * r), zc: cz, e: 2 });
    }
    return loft(secs, { ring, capStart: false, capEnd: false });
}
/** Surface of revolution about the X axis through the origin. `profile` is a list of [x, radius]. */
export function lathe(profile, seg = 36, capEnds = true) {
    const m = mesh();
    for (const [x, r] of profile) {
        for (let k = 0; k < seg; k++) {
            const a = (k / seg) * Math.PI * 2;
            m.p.push(x, r * Math.sin(a), r * Math.cos(a));
        }
    }
    for (let j = 0; j < profile.length - 1; j++) {
        for (let k = 0; k < seg; k++) {
            const a = j * seg + k;
            const b = j * seg + ((k + 1) % seg);
            const c = (j + 1) * seg + k;
            const d = (j + 1) * seg + ((k + 1) % seg);
            m.i.push(a, b, c, b, d, c);
        }
    }
    smooth(m);
    // Orient: make sure normals point away from the axis for a positive-radius outer surface.
    const first = profile[0];
    const last = profile[profile.length - 1];
    const flip = () => {
        for (let t = 0; t < m.i.length; t += 3) {
            const b = m.i[t + 1];
            m.i[t + 1] = m.i[t + 2];
            m.i[t + 2] = b;
        }
        smooth(m);
    };
    // Check the first vertex ring's normal against the radial direction at the profile's widest radius.
    let widest = 0;
    for (let j = 0; j < profile.length; j++)
        if (profile[j][1] > profile[widest][1])
            widest = j;
    const vi = widest * seg;
    const radial = m.p[vi * 3 + 1] * m.n[vi * 3 + 1] + m.p[vi * 3 + 2] * m.n[vi * 3 + 2];
    if (radial < 0)
        flip();
    const cap = (x, r, dir) => {
        if (r < 1e-4)
            return;
        const base = m.p.length / 3;
        m.p.push(x, 0, 0);
        m.n.push(dir, 0, 0);
        for (let k = 0; k < seg; k++) {
            const a = (k / seg) * Math.PI * 2;
            m.p.push(x, r * Math.sin(a), r * Math.cos(a));
            m.n.push(dir, 0, 0);
        }
        for (let k = 0; k < seg; k++) {
            const a = base + 1 + k;
            const b = base + 1 + ((k + 1) % seg);
            if (dir === 1)
                m.i.push(base, b, a);
            else
                m.i.push(base, a, b);
        }
    };
    if (capEnds) {
        cap(first[0], first[1], first[0] < last[0] ? -1 : 1);
        cap(last[0], last[1], first[0] < last[0] ? 1 : -1);
    }
    return m;
}
/** A tube along a polyline (Catmull-Rom smoothed) with optional per-end radii and flat caps. */
export function tube(points, radius, opts = {}) {
    const seg = opts.seg ?? 10;
    const per = opts.smoothPath === false ? 1 : (opts.steps ?? 6);
    const path = [];
    const P = (k) => points[Math.max(0, Math.min(points.length - 1, k))];
    for (let j = 0; j < points.length - 1; j++) {
        for (let s = 0; s < per; s++) {
            const t = s / per;
            const a = P(j - 1);
            const b = P(j);
            const c = P(j + 1);
            const d = P(j + 2);
            const f = (i) => (opts.smoothPath === false ? b[i] + (c[i] - b[i]) * t : 0.5 * (2 * b[i] + (-a[i] + c[i]) * t + (2 * a[i] - 5 * b[i] + 4 * c[i] - d[i]) * t * t + (-a[i] + 3 * b[i] - 3 * c[i] + d[i]) * t * t * t));
            path.push([f(0), f(1), f(2)]);
        }
    }
    path.push(points[points.length - 1]);
    const m = mesh();
    let prevN = [0, 1, 0];
    const r1 = opts.r1 ?? radius;
    for (let j = 0; j < path.length; j++) {
        const a = path[Math.max(0, j - 1)];
        const b = path[Math.min(path.length - 1, j + 1)];
        let tx = b[0] - a[0];
        let ty = b[1] - a[1];
        let tz = b[2] - a[2];
        const tl = Math.hypot(tx, ty, tz) || 1;
        tx /= tl;
        ty /= tl;
        tz /= tl;
        // Parallel-transport the frame.
        let nx = prevN[0];
        let ny = prevN[1];
        let nz = prevN[2];
        const dot = nx * tx + ny * ty + nz * tz;
        nx -= dot * tx;
        ny -= dot * ty;
        nz -= dot * tz;
        let nl = Math.hypot(nx, ny, nz);
        if (nl < 1e-4) {
            nx = ty;
            ny = -tx;
            nz = 0;
            nl = Math.hypot(nx, ny, nz) || 1;
        }
        nx /= nl;
        ny /= nl;
        nz /= nl;
        prevN = [nx, ny, nz];
        const bx = ty * nz - tz * ny;
        const by = tz * nx - tx * nz;
        const bz = tx * ny - ty * nx;
        const r = radius + (r1 - radius) * (j / (path.length - 1));
        const c = path[j];
        for (let k = 0; k < seg; k++) {
            const ang = (k / seg) * Math.PI * 2;
            const ca = Math.cos(ang) * r;
            const sa = Math.sin(ang) * r;
            m.p.push(c[0] + nx * ca + bx * sa, c[1] + ny * ca + by * sa, c[2] + nz * ca + bz * sa);
        }
    }
    for (let j = 0; j < path.length - 1; j++) {
        for (let k = 0; k < seg; k++) {
            const a = j * seg + k;
            const b = j * seg + ((k + 1) % seg);
            const c = (j + 1) * seg + k;
            const d = (j + 1) * seg + ((k + 1) % seg);
            m.i.push(a, b, c, b, d, c);
        }
    }
    smooth(m);
    // Normals must face away from the axis; flip if the first ring points inward.
    const c0 = path[0];
    const dx = m.p[0] - c0[0];
    const dy = m.p[1] - c0[1];
    const dz = m.p[2] - c0[2];
    if (dx * m.n[0] + dy * m.n[1] + dz * m.n[2] < 0) {
        for (let t = 0; t < m.i.length; t += 3) {
            const b = m.i[t + 1];
            m.i[t + 1] = m.i[t + 2];
            m.i[t + 2] = b;
        }
        smooth(m);
    }
    // Round-ish ends: a flat cap on both.
    for (const [ring, centre, dirSign] of [[0, path[0], -1], [path.length - 1, path[path.length - 1], 1]]) {
        const base = m.p.length / 3;
        const pa = path[Math.max(0, ring === 0 ? 0 : ring - 1)];
        const pb = path[Math.min(path.length - 1, ring === 0 ? 1 : ring)];
        const tx = pb[0] - pa[0];
        const ty = pb[1] - pa[1];
        const tz = pb[2] - pa[2];
        const tl = Math.hypot(tx, ty, tz) || 1;
        m.p.push(centre[0], centre[1], centre[2]);
        m.n.push((tx / tl) * dirSign, (ty / tl) * dirSign, (tz / tl) * dirSign);
        for (let k = 0; k < seg; k++) {
            const v = (ring * seg + k) * 3;
            m.p.push(m.p[v], m.p[v + 1], m.p[v + 2]);
            m.n.push((tx / tl) * dirSign, (ty / tl) * dirSign, (tz / tl) * dirSign);
        }
        for (let k = 0; k < seg; k++) {
            const a = base + 1 + k;
            const b = base + 1 + ((k + 1) % seg);
            if (dirSign === 1)
                m.i.push(base, a, b);
            else
                m.i.push(base, b, a);
        }
    }
    return m;
}
/** Flat polygon extruded along Z (outline in X/Y, centred on z = 0 with `depth`). */
export function extrudeXY(outline, depth) {
    const m = mesh();
    const n = outline.length;
    const hz = depth / 2;
    // Side walls with flat normals.
    for (let k = 0; k < n; k++) {
        const a = outline[k];
        const b = outline[(k + 1) % n];
        const ex = b[0] - a[0];
        const ey = b[1] - a[1];
        const l = Math.hypot(ex, ey) || 1;
        const nx = ey / l;
        const ny = -ex / l;
        const base = m.p.length / 3;
        m.p.push(a[0], a[1], -hz, b[0], b[1], -hz, b[0], b[1], hz, a[0], a[1], hz);
        for (let q = 0; q < 4; q++)
            m.n.push(nx, ny, 0);
        m.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    // Caps by ear clipping (outline is simple, counter-clockwise).
    const idx = outline.map((_, k) => k);
    const tris = [];
    const area = (a, b, c) => {
        const A = outline[a];
        const B = outline[b];
        const C = outline[c];
        return (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
    };
    let guard = 0;
    while (idx.length > 3 && guard++ < 2000) {
        let cut = false;
        for (let k = 0; k < idx.length; k++) {
            const a = idx[(k + idx.length - 1) % idx.length];
            const b = idx[k];
            const c = idx[(k + 1) % idx.length];
            if (area(a, b, c) <= 1e-9)
                continue;
            let inside = false;
            for (const o of idx) {
                if (o === a || o === b || o === c)
                    continue;
                if (area(a, b, o) >= 0 && area(b, c, o) >= 0 && area(c, a, o) >= 0) {
                    inside = true;
                    break;
                }
            }
            if (inside)
                continue;
            tris.push([a, b, c]);
            idx.splice(k, 1);
            cut = true;
            break;
        }
        if (!cut)
            break;
    }
    if (idx.length === 3)
        tris.push([idx[0], idx[1], idx[2]]);
    for (const side of [1, -1]) {
        const base = m.p.length / 3;
        for (const [x, y] of outline) {
            m.p.push(x, y, side * hz);
            m.n.push(0, 0, side);
        }
        for (const [a, b, c] of tris) {
            if (side === 1)
                m.i.push(base + a, base + b, base + c);
            else
                m.i.push(base + a, base + c, base + b);
        }
    }
    return m;
}
/**
 * A ribbon decal following the upper surface of a loft at fixed lateral offset `z` from x0 to x1 (half-width `w`),
 * lifted `lift` above it.
 */
export function topRibbon(secs, x0, x1, z, w, lift = 0.004, steps = 40) {
    const m = mesh();
    for (let k = 0; k <= steps; k++) {
        const x = x0 + ((x1 - x0) * k) / steps;
        const s = sectionAt(secs, x);
        for (const zz of [z - w, z + w]) {
            const y = topY(s, Math.max(-s.hw * 0.995, Math.min(s.hw * 0.995, zz))) ?? s.y1;
            m.p.push(x, y + lift, zz);
        }
    }
    for (let k = 0; k < steps; k++) {
        const a = k * 2;
        m.i.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    return smooth(m);
}
/** A disc-shaped decal on the side surface (z > 0 side when `side` is 1) of a loft, centred at (cx, cy). */
export function sideDisc(secs, cx, cy, radius, side, lift = 0.004, rings = 5, seg = 28, squashY = 1) {
    const m = mesh();
    const point = (px, py) => {
        const s = sectionAt(secs, px);
        const y = Math.min(s.y1 - 0.01, Math.max(s.y0 + 0.01, py));
        const z = sideZ(s, y);
        const zz = z === null ? s.hw : z;
        return [px, y, side * (zz + lift)];
    };
    const c = point(cx, cy);
    m.p.push(c[0], c[1], c[2]);
    for (let r = 1; r <= rings; r++) {
        for (let k = 0; k < seg; k++) {
            const a = (k / seg) * Math.PI * 2;
            const q = point(cx + Math.cos(a) * radius * (r / rings), cy + Math.sin(a) * radius * (r / rings) * squashY);
            m.p.push(q[0], q[1], q[2]);
        }
    }
    for (let k = 0; k < seg; k++)
        m.i.push(0, 1 + k, 1 + ((k + 1) % seg));
    for (let r = 1; r < rings; r++) {
        for (let k = 0; k < seg; k++) {
            const a = 1 + (r - 1) * seg + k;
            const b = 1 + (r - 1) * seg + ((k + 1) % seg);
            const c2 = 1 + r * seg + k;
            const d = 1 + r * seg + ((k + 1) % seg);
            m.i.push(a, b, c2, b, d, c2);
        }
    }
    if (side === -1)
        for (let t = 0; t < m.i.length; t += 3)
            [m.i[t + 1], m.i[t + 2]] = [m.i[t + 2], m.i[t + 1]];
    smooth(m);
    // Decals face outward: orient normals by side.
    for (let k = 0; k < m.n.length; k += 3)
        if (m.n[k + 2] * side < 0) {
            m.n[k] = -m.n[k];
            m.n[k + 1] = -m.n[k + 1];
            m.n[k + 2] = -m.n[k + 2];
        }
    return m;
}
/** A ribbon decal on the side surface along a polyline of (x, y) points, width `w` (door seams, trim lines). */
export function sideLine(secs, pts, w, side, lift = 0.003) {
    const m = mesh();
    for (let k = 0; k < pts.length; k++) {
        const [x, y] = pts[k];
        const a = pts[Math.max(0, k - 1)];
        const b = pts[Math.min(pts.length - 1, k + 1)];
        let tx = b[0] - a[0];
        let ty = b[1] - a[1];
        const l = Math.hypot(tx, ty) || 1;
        tx /= l;
        ty /= l;
        for (const sgn of [-1, 1]) {
            const px = x - ty * w * sgn;
            const py = y + tx * w * sgn;
            const s = sectionAt(secs, px);
            const z = sideZ(s, py) ?? s.hw;
            m.p.push(px, py, side * (z + lift));
        }
    }
    for (let k = 0; k < pts.length - 1; k++) {
        const a = k * 2;
        if (side === 1)
            m.i.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        else
            m.i.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    smooth(m);
    for (let k = 0; k < m.n.length; k += 3)
        if (m.n[k + 2] * side < 0) {
            m.n[k] = -m.n[k];
            m.n[k + 1] = -m.n[k + 1];
            m.n[k + 2] = -m.n[k + 2];
        }
    return m;
}
/** Axis-aligned bounds of a mesh. */
export function bounds(m) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < m.p.length; k += 3) {
        for (let a = 0; a < 3; a++) {
            const v = m.p[k + a];
            if (v < min[a])
                min[a] = v;
            if (v > max[a])
                max[a] = v;
        }
    }
    return { min, max };
}
