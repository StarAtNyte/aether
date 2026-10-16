/**
 * Roofs over a rectangular footprint: flat (with parapet), gable, hip
 * (pyramid when square) and shed. A pitched roof is a set of planar faces
 * whose UNDERSIDE passes through the top outer edge of the walls (y = 0 at
 * the footprint edge) and continues past it by the overhang; the top surface
 * sits one roof-thickness above, measured perpendicular to the slope. A
 * fascia band closes the perimeter, gable / shed ends get wall infill, and a
 * ridge cap finishes the top. Tile UVs run along the eaves (u) and up the
 * slope (v) so tile rows stay horizontal on every face.
 */
import { Geom, box } from './mesh';
import { PartSet } from './parts';
import { triangulate } from './triangulate';
function sub(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(a) {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
}
/** Newell normal of a planar polygon, oriented to face up. */
function upNormal(pts) {
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        nx += (a[1] - b[1]) * (a[2] + b[2]);
        ny += (a[2] - b[2]) * (a[0] + b[0]);
        nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const n = norm([nx, ny, nz]);
    return n[1] < 0 ? [-n[0], -n[1], -n[2]] : n;
}
/**
 * Planar polygon (3D, non-vertical) as triangles facing up or down. UVs:
 * u along the horizontal eave direction, v up the slope (metres).
 */
function planar(g, pts, up, dy = 0) {
    const n = upNormal(pts);
    const plan = pts.map((p) => [p[0], p[2]]);
    const { triangles } = triangulate(plan);
    // Eave direction: horizontal, perpendicular to the steepest ascent.
    const horizontal = Math.hypot(n[0], n[2]);
    const e = horizontal > 1e-6 ? norm([-n[2], 0, n[0]]) : [1, 0, 0];
    const s = norm(cross(n, e));
    const slope = s[1] < 0 ? [-s[0], -s[1], -s[2]] : s;
    const base = g.vertexCount;
    const sign = up ? 1 : -1;
    // triangulate re-winds to positive area: map back through the same positive ordering.
    const positiveOrder = signedAreaPlan(plan) >= 0;
    const ordered = positiveOrder ? pts : pts.slice().reverse();
    for (const p of ordered) {
        const y = p[1] + dy;
        g.vertex(p[0], y, p[2], n[0] * sign, n[1] * sign, n[2] * sign, p[0] * e[0] + p[2] * e[2], p[0] * slope[0] + y * slope[1] + p[2] * slope[2]);
    }
    for (let k = 0; k < triangles.length; k += 3) {
        const a = base + triangles[k];
        const b = base + triangles[k + 1];
        const c = base + triangles[k + 2];
        if (up)
            g.i.push(a, c, b);
        else
            g.i.push(a, b, c);
    }
}
function signedAreaPlan(poly) {
    let s = 0;
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        s += a[0] * b[1] - b[0] * a[1];
    }
    return s / 2;
}
/** Vertical fascia quads along the boundary edges of the faces (edges used by one face only). */
function fascia(g, faces, dy, center) {
    const k = (p) => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)},${Math.round(p[2] * 1e4)}`;
    const count = new Map();
    const edges = [];
    for (const f of faces) {
        for (let i = 0; i < f.length; i++) {
            const a = f[i];
            const b = f[(i + 1) % f.length];
            const ek = [k(a), k(b)].sort().join('|');
            count.set(ek, (count.get(ek) ?? 0) + 1);
            edges.push([a, b]);
        }
    }
    for (const [a, b] of edges) {
        if (count.get([k(a), k(b)].sort().join('|')) !== 1)
            continue;
        const c0 = [a[0], a[1], a[2]];
        const c1 = [b[0], b[1], b[2]];
        const c2 = [b[0], b[1] + dy, b[2]];
        const c3 = [a[0], a[1] + dy, a[2]];
        const n = cross(sub(c1, c0), sub(c3, c0));
        const mid = [(a[0] + b[0]) / 2 - center[0], 0, (a[2] + b[2]) / 2 - center[2]];
        if (n[0] * mid[0] + n[2] * mid[2] < 0)
            g.quadAuto(c1, c0, c3, c2);
        else
            g.quadAuto(c0, c1, c2, c3);
    }
}
/** Ridge height of a pitched roof above the eave line (for planning storeys and views). */
export function roofRise(p) {
    const tan = Math.tan((p.pitch * Math.PI) / 180);
    switch (p.shape) {
        case 'flat':
            return 0;
        case 'gable':
            return (p.ridgeAlongX ? p.depth / 2 : p.width / 2) * tan;
        case 'hip':
            return (Math.min(p.width, p.depth) / 2) * tan;
        case 'shed':
            return (p.ridgeAlongX ? p.depth : p.width) * tan;
    }
}
/** Build a roof (see the module docs). */
export function buildRoof(p) {
    if (p.shape === 'flat')
        return buildFlatRoof(p);
    const set = new PartSet();
    // Work in a frame where the slope falls along ±Z (ridge along X); rotate at the end.
    const swap = p.shape === 'hip' ? p.depth > p.width : !p.ridgeAlongX;
    const W = swap ? p.depth : p.width;
    const D = swap ? p.width : p.depth;
    const hx = W / 2;
    const hz = D / 2;
    const o = p.overhang;
    const tan = Math.tan((p.pitch * Math.PI) / 180);
    const cos = Math.cos((p.pitch * Math.PI) / 180);
    const dy = p.thickness / Math.max(0.2, cos);
    const eaveY = -o * tan;
    const faces = [];
    const walls = new Geom();
    const trim = new Geom();
    if (p.shape === 'gable') {
        const R = hz * tan;
        const X = hx + o;
        faces.push([
            [-X, eaveY, hz + o],
            [X, eaveY, hz + o],
            [X, R, 0],
            [-X, R, 0],
        ]);
        faces.push([
            [X, eaveY, -hz - o],
            [-X, eaveY, -hz - o],
            [-X, R, 0],
            [X, R, 0],
        ]);
        // Gable infill triangles at both ends (outer and inner faces).
        for (const sx of [-1, 1]) {
            const x = sx * hx;
            const tri = [
                [x, 0, -hz],
                [x, 0, hz],
                [x, R, 0],
            ];
            gableFace(walls, tri, sx);
            gableFace(walls, tri.map((q) => [q[0] - sx * 0.2, q[1], q[2]]), (-sx));
        }
        trim.merge(box(-X, R + dy - 0.02, -0.07, X, R + dy + 0.05, 0.07));
    }
    else if (p.shape === 'hip') {
        const R = hz * tan;
        const rx = Math.max(0, hx - hz);
        const ex = hx + o;
        const ez = hz + o;
        faces.push([
            [-ex, eaveY, ez],
            [ex, eaveY, ez],
            [rx, R, 0],
            [-rx, R, 0],
        ]);
        faces.push([
            [ex, eaveY, -ez],
            [-ex, eaveY, -ez],
            [-rx, R, 0],
            [rx, R, 0],
        ]);
        faces.push([
            [ex, eaveY, ez],
            [ex, eaveY, -ez],
            [rx, R, 0],
        ]);
        faces.push([
            [-ex, eaveY, -ez],
            [-ex, eaveY, ez],
            [-rx, R, 0],
        ]);
        if (rx > 0.05)
            trim.merge(box(-rx, R + dy - 0.02, -0.07, rx, R + dy + 0.05, 0.07));
    }
    else {
        // Shed: high side at −Z, low eave at +Z.
        const R = D * tan;
        const X = hx + o;
        const yAt = (z) => (hz - z) * tan;
        faces.push([
            [-X, yAt(hz + o), hz + o],
            [X, yAt(hz + o), hz + o],
            [X, yAt(-hz - o), -hz - o],
            [-X, yAt(-hz - o), -hz - o],
        ]);
        for (const sx of [-1, 1]) {
            const x = sx * hx;
            const tri = [
                [x, 0, -hz],
                [x, 0, hz],
                [x, R, -hz],
            ];
            gableFace(walls, tri, sx);
            gableFace(walls, tri.map((q) => [q[0] - sx * 0.2, q[1], q[2]]), (-sx));
        }
        // High wall infill along −Z.
        walls.quadAuto([hx, 0, -hz], [-hx, 0, -hz], [-hx, R, -hz], [hx, R, -hz]);
        walls.quadAuto([-hx, 0, -hz + 0.2], [hx, 0, -hz + 0.2], [hx, R, -hz + 0.2], [-hx, R, -hz + 0.2]);
    }
    const top = new Geom();
    const under = new Geom();
    for (const f of faces) {
        planar(top, f, true, dy);
        planar(under, f, false);
    }
    const edges = new Geom();
    fascia(edges, faces, dy, [0, 0, 0]);
    if (swap)
        for (const g of [top, under, edges, walls, trim])
            g.rotateY(90);
    set.add(top, p.finish).add(under, p.trim).add(edges, p.trim).add(walls, p.gableWall).add(trim, p.trim);
    // Colliders: one hull per face slab.
    for (const f of faces) {
        const pts = [];
        for (const q of f) {
            const [x, z] = swap ? [q[2], -q[0]] : [q[0], q[2]];
            pts.push(x, q[1], z, x, q[1] + dy, z);
        }
        set.hull(pts);
    }
    return set.build();
}
function gableFace(g, tri, facing) {
    const [a, b, c] = tri;
    const n = cross(sub(b, a), sub(c, a));
    const base = g.vertexCount;
    const nx = facing;
    const flip = n[0] * facing < 0;
    for (const p of [a, b, c])
        g.vertex(p[0], p[1], p[2], nx, 0, 0, p[2], p[1]);
    if (flip)
        g.i.push(base, base + 2, base + 1);
    else
        g.i.push(base, base + 1, base + 2);
}
/** Flat roof: a slab with an optional parapet and coping. */
function buildFlatRoof(p) {
    const set = new PartSet();
    const hx = p.width / 2 + p.overhang;
    const hz = p.depth / 2 + p.overhang;
    const t = p.thickness;
    set.add(box(-hx, 0, -hz, hx, t, hz), p.finish);
    set.boxMinMax(-hx, 0, -hz, hx, t, hz);
    if (p.parapet > 0.01) {
        const w = 0.2;
        const h = t + p.parapet;
        const par = new Geom()
            .merge(box(-hx, t, -hz, hx, h, -hz + w))
            .merge(box(-hx, t, hz - w, hx, h, hz))
            .merge(box(-hx, t, -hz + w, -hx + w, h, hz - w))
            .merge(box(hx - w, t, -hz + w, hx, h, hz - w));
        set.add(par, p.gableWall);
        const cap = new Geom()
            .merge(box(-hx - 0.02, h, -hz - 0.02, hx + 0.02, h + 0.04, -hz + w + 0.02))
            .merge(box(-hx - 0.02, h, hz - w - 0.02, hx + 0.02, h + 0.04, hz + 0.02))
            .merge(box(-hx - 0.02, h, -hz + w, -hx + w + 0.02, h + 0.04, hz - w))
            .merge(box(hx - w - 0.02, h, -hz + w, hx + 0.02, h + 0.04, hz - w));
        set.add(cap, p.trim);
        set.boxMinMax(-hx, t, -hz, hx, h, -hz + w);
        set.boxMinMax(-hx, t, hz - w, hx, h, hz);
        set.boxMinMax(-hx, t, -hz + w, -hx + w, h, hz - w);
        set.boxMinMax(hx - w, t, -hz + w, hx, h, hz - w);
    }
    return set.build();
}
