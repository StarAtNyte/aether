/**
 * Room geometry used by the compiler and the layouts: room outlines, their
 * edges with outward normals and compass sides, spans shared by two rooms,
 * exterior spans, the building outline and polygon offsetting.
 */
import { EPS, positive, samePoint } from './math2';
/** Outline of a plan room (positive winding). */
export function roomPolygon(room) {
    if (room.polygon)
        return positive(room.polygon.map((p) => [p[0], p[1]]));
    const [x0, z0, x1, z1] = room.rect ?? [0, 0, 1, 1];
    return positive([
        [Math.min(x0, x1), Math.min(z0, z1)],
        [Math.max(x0, x1), Math.min(z0, z1)],
        [Math.max(x0, x1), Math.max(z0, z1)],
        [Math.min(x0, x1), Math.max(z0, z1)],
    ]);
}
/** Compass side of an outward normal (north = −Z). */
export function compassOf(nx, nz) {
    if (Math.abs(nx) > Math.abs(nz))
        return nx > 0 ? 'east' : 'west';
    return nz > 0 ? 'south' : 'north';
}
/** Outward normal of a compass side. */
export function compassNormal(side) {
    switch (side) {
        case 'north':
            return [0, -1];
        case 'south':
            return [0, 1];
        case 'east':
            return [1, 0];
        case 'west':
            return [-1, 0];
    }
}
/** Edges of a positive-winding polygon with outward normals. */
export function roomEdges(poly) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const length = Math.hypot(dx, dz);
        if (length < EPS)
            continue;
        const dir = [dx / length, dz / length];
        // Positive shoelace winding (see math2): the outward normal of a→b is (dz, −dx).
        const outN = [dir[1], -dir[0]];
        out.push({ a, b, length, dir, out: outN, side: compassOf(outN[0], outN[1]) });
    }
    return out;
}
/** Point at distance t along an edge. */
export function edgePoint(e, t) {
    return [e.a[0] + e.dir[0] * t, e.a[1] + e.dir[1] * t];
}
/**
 * Spans where two room outlines share a boundary (collinear, overlapping
 * edges with opposite outward normals), longest first.
 */
export function sharedSpans(a, b, tol = 0.02) {
    const out = [];
    for (const ea of roomEdges(a)) {
        for (const eb of roomEdges(b)) {
            if (ea.out[0] * eb.out[0] + ea.out[1] * eb.out[1] > -0.999)
                continue;
            // Collinear: eb's endpoints on ea's line.
            const offA = (eb.a[0] - ea.a[0]) * ea.out[0] + (eb.a[1] - ea.a[1]) * ea.out[1];
            if (Math.abs(offA) > tol)
                continue;
            const s0 = (eb.a[0] - ea.a[0]) * ea.dir[0] + (eb.a[1] - ea.a[1]) * ea.dir[1];
            const s1 = (eb.b[0] - ea.a[0]) * ea.dir[0] + (eb.b[1] - ea.a[1]) * ea.dir[1];
            const t0 = Math.max(0, Math.min(s0, s1));
            const t1 = Math.min(ea.length, Math.max(s0, s1));
            if (t1 - t0 > tol)
                out.push({ edge: ea, t0, t1 });
        }
    }
    return out.sort((p, q) => q.t1 - q.t0 - (p.t1 - p.t0));
}
/**
 * Exterior spans of a room: parts of its edges not shared with any other
 * (indoor) room, optionally only on one compass side. Longest first.
 */
export function exteriorSpans(room, others, side, tol = 0.02) {
    const shared = others.flatMap((o) => sharedSpans(room, o, tol));
    const out = [];
    for (const e of roomEdges(room)) {
        if (side && e.side !== side)
            continue;
        let free = [[0, e.length]];
        for (const s of shared)
            if (samePoint(s.edge.a, e.a) && samePoint(s.edge.b, e.b))
                free = subtract(free, s.t0, s.t1);
        for (const [t0, t1] of free)
            if (t1 - t0 > 0.3)
                out.push({ edge: e, t0, t1 });
    }
    return out.sort((p, q) => q.t1 - q.t0 - (p.t1 - p.t0));
}
function subtract(spans, c0, c1) {
    const out = [];
    for (const [a, b] of spans) {
        if (c1 <= a || c0 >= b)
            out.push([a, b]);
        else {
            if (c0 > a)
                out.push([a, c0]);
            if (c1 < b)
                out.push([c1, b]);
        }
    }
    return out;
}
/** Chain exterior network walls into closed outline loops (positive winding). */
export function outlineLoops(walls, tol = 0.02) {
    const segs = walls.filter((w) => w.exterior).map((w) => ({ a: w.a, b: w.b, used: false }));
    const loops = [];
    for (const start of segs) {
        if (start.used)
            continue;
        start.used = true;
        const loop = [start.a, start.b];
        let tip = start.b;
        let guard = segs.length + 2;
        while (!samePoint(tip, loop[0], tol) && guard-- > 0) {
            const next = segs.find((s) => !s.used && (samePoint(s.a, tip, tol) || samePoint(s.b, tip, tol)));
            if (!next)
                break;
            next.used = true;
            tip = samePoint(next.a, tip, tol) ? next.b : next.a;
            if (!samePoint(tip, loop[0], tol))
                loop.push(tip);
        }
        if (loop.length >= 3)
            loops.push(positive(loop));
    }
    return loops;
}
/**
 * Offset a positive-winding polygon outward by `d` (negative = inward) with
 * mitred corners (clamped for very sharp corners).
 */
export function offsetPolygon(poly, d) {
    const n = poly.length;
    const out = [];
    const edges = roomEdges(poly);
    if (edges.length !== n)
        return poly.map((p) => [p[0], p[1]]);
    for (let i = 0; i < n; i++) {
        const prev = edges[(i + n - 1) % n];
        const next = edges[i];
        const nx = prev.out[0] + next.out[0];
        const nz = prev.out[1] + next.out[1];
        const len = Math.hypot(nx, nz);
        const p = poly[i];
        if (len < 1e-6) {
            out.push([p[0] + next.out[0] * d, p[1] + next.out[1] * d]);
            continue;
        }
        const cosHalf = (nx / len) * next.out[0] + (nz / len) * next.out[1];
        const scale = d / Math.max(0.25, cosHalf);
        out.push([p[0] + (nx / len) * scale, p[1] + (nz / len) * scale]);
    }
    return out;
}
/** Area of the overlap of two polygons, estimated on a grid (for overlap validation). */
export function overlapArea(a, b, cell = 0.1) {
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (const p of a) {
        x0 = Math.min(x0, p[0]);
        z0 = Math.min(z0, p[1]);
        x1 = Math.max(x1, p[0]);
        z1 = Math.max(z1, p[1]);
    }
    let bx0 = Infinity;
    let bz0 = Infinity;
    let bx1 = -Infinity;
    let bz1 = -Infinity;
    for (const p of b) {
        bx0 = Math.min(bx0, p[0]);
        bz0 = Math.min(bz0, p[1]);
        bx1 = Math.max(bx1, p[0]);
        bz1 = Math.max(bz1, p[1]);
    }
    const ix0 = Math.max(x0, bx0);
    const iz0 = Math.max(z0, bz0);
    const ix1 = Math.min(x1, bx1);
    const iz1 = Math.min(z1, bz1);
    if (ix1 <= ix0 || iz1 <= iz0)
        return 0;
    let count = 0;
    for (let x = ix0 + cell / 2; x < ix1; x += cell) {
        for (let z = iz0 + cell / 2; z < iz1; z += cell)
            if (inside(x, z, a) && inside(x, z, b))
                count++;
    }
    return count * cell * cell;
}
function inside(x, z, poly) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const p = poly[i];
        const q = poly[j];
        if (p[1] > z !== q[1] > z && x < ((q[0] - p[0]) * (z - p[1])) / (q[1] - p[1]) + p[0])
            c = !c;
    }
    return c;
}
