/**
 * Plan (x/z) geometry helpers. A plan point is `[x, z]` in metres, matching
 * the World IR ground plane (Y up). Polygons are arrays of points without a
 * repeated closing vertex. Everything here is pure and allocation-light; hot
 * paths (navigation rasterisation) use the scalar variants.
 */
/** Tolerance for "the same point" in plan space (1 mm). */
export const EPS = 1e-3;
/** Round to millimetres (stable JSON, fewer float artefacts). */
export function mm(n) {
    const r = Math.round(n * 1000) / 1000;
    return r === 0 ? 0 : r;
}
/** Round to centimetres. */
export function cm(n) {
    const r = Math.round(n * 100) / 100;
    return r === 0 ? 0 : r;
}
/** True when both points are within `eps` of each other. */
export function samePoint(a, b, eps = EPS) {
    return Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps;
}
/** Euclidean distance. */
export function dist(a, b) {
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
}
/** Signed area (positive for counter-clockwise when x points right and z points down the screen, i.e. the shoelace sum). */
export function signedArea(poly) {
    let s = 0;
    for (let i = 0, n = poly.length; i < n; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % n];
        s += a[0] * b[1] - b[0] * a[1];
    }
    return s / 2;
}
/** Absolute area in m². */
export function area(poly) {
    return Math.abs(signedArea(poly));
}
/** Copy with a positive signed area (consistent winding for triangulation and edge normals). */
export function positive(poly) {
    const out = poly.map((p) => [p[0], p[1]]);
    return signedArea(out) < 0 ? out.reverse() : out;
}
/** Area-weighted centroid (vertex average for degenerate polygons). */
export function centroid(poly) {
    let a = 0;
    let cx = 0;
    let cz = 0;
    for (let i = 0, n = poly.length; i < n; i++) {
        const p = poly[i];
        const q = poly[(i + 1) % n];
        const c = p[0] * q[1] - q[0] * p[1];
        a += c;
        cx += (p[0] + q[0]) * c;
        cz += (p[1] + q[1]) * c;
    }
    if (Math.abs(a) < 1e-9) {
        let sx = 0;
        let sz = 0;
        for (const p of poly) {
            sx += p[0];
            sz += p[1];
        }
        return [sx / Math.max(1, poly.length), sz / Math.max(1, poly.length)];
    }
    return [cx / (3 * a), cz / (3 * a)];
}
/** Axis-aligned bounds `[minX, minZ, maxX, maxZ]`. */
export function bounds(poly) {
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (const p of poly) {
        if (p[0] < x0)
            x0 = p[0];
        if (p[1] < z0)
            z0 = p[1];
        if (p[0] > x1)
            x1 = p[0];
        if (p[1] > z1)
            z1 = p[1];
    }
    return [x0, z0, x1, z1];
}
/** Even-odd point-in-polygon test (points exactly on an edge may go either way). */
export function pointInPolygon(x, z, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i];
        const b = poly[j];
        if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0])
            inside = !inside;
    }
    return inside;
}
/** Distance from (px, pz) to the segment a–b. */
export function pointSegmentDistance(px, pz, ax, az, bx, bz) {
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}
/** Parameter t of the projection of p onto the infinite line a→b (0 at a, 1 at b). */
export function projectT(p, a, b) {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len2 = dx * dx + dz * dz;
    return len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2 : 0;
}
/**
 * Intersection of the infinite lines p + t·r and q + u·s. Returns `t` (along
 * the first line) or null when the lines are (nearly) parallel.
 */
export function lineIntersectT(p, r, q, s) {
    const cross = r[0] * s[1] - r[1] * s[0];
    if (Math.abs(cross) < 1e-9)
        return null;
    return ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / cross;
}
/** Unit direction a→b (zero vector for coincident points). */
export function direction(a, b) {
    const len = dist(a, b);
    return len > 0 ? [(b[0] - a[0]) / len, (b[1] - a[1]) / len] : [0, 0];
}
/**
 * Yaw in degrees that turns an entity's local +X axis onto the plan
 * direction (dx, dz) (three.js Y rotation: +X maps to (cos θ, −sin θ)).
 */
export function yawOf(dx, dz) {
    return (Math.atan2(-dz, dx) * 180) / Math.PI;
}
/** Rotate a local plan vector (x along +X, z along +Z) by `yawDeg` into the parent frame. */
export function rotateYaw(x, z, yawDeg) {
    const t = (yawDeg * Math.PI) / 180;
    const c = Math.cos(t);
    const s = Math.sin(t);
    return [x * c + z * s, -x * s + z * c];
}
/** Remove consecutive duplicates and collinear vertices (keeps the outline). */
export function simplifyPolygon(poly, eps = EPS) {
    const pts = [];
    for (const p of poly)
        if (pts.length === 0 || !samePoint(pts[pts.length - 1], p, eps))
            pts.push([p[0], p[1]]);
    if (pts.length > 1 && samePoint(pts[0], pts[pts.length - 1], eps))
        pts.pop();
    let changed = true;
    while (changed && pts.length > 3) {
        changed = false;
        for (let i = 0; i < pts.length; i++) {
            const a = pts[(i + pts.length - 1) % pts.length];
            const b = pts[i];
            const c = pts[(i + 1) % pts.length];
            const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
            if (Math.abs(cross) < eps * Math.max(1e-6, dist(a, c))) {
                pts.splice(i, 1);
                changed = true;
                break;
            }
        }
    }
    return pts;
}
/** True when the polygon is an axis-aligned rectangle (after simplification). */
export function isAxisRectangle(poly, eps = EPS) {
    const p = simplifyPolygon(poly, eps);
    if (p.length !== 4)
        return false;
    const [x0, z0, x1, z1] = bounds(p);
    return p.every((q) => (Math.abs(q[0] - x0) <= eps || Math.abs(q[0] - x1) <= eps) && (Math.abs(q[1] - z0) <= eps || Math.abs(q[1] - z1) <= eps));
}
/** Axis-aligned rectangle polygon (counter-clockwise in shoelace terms). */
export function rect(x0, z0, x1, z1) {
    return [
        [x0, z0],
        [x1, z0],
        [x1, z1],
        [x0, z1],
    ];
}
/** True when segments a–b and c–d properly intersect or touch. */
export function segmentsIntersect(a, b, c, d) {
    const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    const o1 = o(a, b, c);
    const o2 = o(a, b, d);
    const o3 = o(c, d, a);
    const o4 = o(c, d, b);
    if (o1 !== o2 && o3 !== o4)
        return true;
    const on = (p, q, r) => Math.min(p[0], r[0]) - EPS <= q[0] && q[0] <= Math.max(p[0], r[0]) + EPS && Math.min(p[1], r[1]) - EPS <= q[1] && q[1] <= Math.max(p[1], r[1]) + EPS;
    if (o1 === 0 && on(a, c, b))
        return true;
    if (o2 === 0 && on(a, d, b))
        return true;
    if (o3 === 0 && on(c, a, d))
        return true;
    if (o4 === 0 && on(c, b, d))
        return true;
    return false;
}
/** True when the polygon's edges do not cross each other (adjacent edges excluded). */
export function isSimplePolygon(poly) {
    const n = poly.length;
    if (n < 3)
        return false;
    for (let i = 0; i < n; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % n];
        for (let j = i + 1; j < n; j++) {
            if (j === i || (j + 1) % n === i || (i + 1) % n === j)
                continue;
            if (segmentsIntersect(a, b, poly[j], poly[(j + 1) % n]))
                return false;
        }
    }
    return true;
}
/** Perimeter length. */
export function perimeter(poly) {
    let s = 0;
    for (let i = 0; i < poly.length; i++)
        s += dist(poly[i], poly[(i + 1) % poly.length]);
    return s;
}
/**
 * A point well inside the polygon (for labels and navigation seeds): the
 * centroid when it is inside, otherwise the centre of the widest horizontal
 * span through the vertical middle.
 */
export function interiorPoint(poly) {
    const c = centroid(poly);
    if (pointInPolygon(c[0], c[1], poly))
        return c;
    const [, z0, , z1] = bounds(poly);
    let best = c;
    let bestW = -1;
    for (let k = 1; k < 8; k++) {
        const z = z0 + ((z1 - z0) * k) / 8;
        const xs = [];
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const a = poly[i];
            const b = poly[j];
            if (a[1] > z !== b[1] > z)
                xs.push(((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]);
        }
        xs.sort((p, q) => p - q);
        for (let i = 0; i + 1 < xs.length; i += 2) {
            const w = xs[i + 1] - xs[i];
            if (w > bestW) {
                bestW = w;
                best = [(xs[i] + xs[i + 1]) / 2, z];
            }
        }
    }
    return best;
}
/**
 * Clip a polygon by a CONVEX polygon (Sutherland–Hodgman). Both in any
 * winding; returns the intersection outline (possibly empty).
 */
export function clipPolygon(subject, clip) {
    const c = positive(clip);
    let out = subject.map((p) => [p[0], p[1]]);
    for (let i = 0; i < c.length && out.length > 0; i++) {
        const a = c[i];
        const b = c[(i + 1) % c.length];
        // Inside = left of a→b for a positive (shoelace) polygon: cross ≥ 0.
        const inside = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= -1e-9;
        const input = out;
        out = [];
        for (let k = 0; k < input.length; k++) {
            const p = input[k];
            const q = input[(k + 1) % input.length];
            const ip = inside(p);
            const iq = inside(q);
            if (ip)
                out.push(p);
            if (ip !== iq) {
                const dx = q[0] - p[0];
                const dz = q[1] - p[1];
                const den = (b[0] - a[0]) * dz - (b[1] - a[1]) * dx;
                if (Math.abs(den) > 1e-12) {
                    const t = ((b[1] - a[1]) * (p[0] - a[0]) - (b[0] - a[0]) * (p[1] - a[1])) / den;
                    out.push([p[0] + dx * t, p[1] + dz * t]);
                }
            }
        }
    }
    return simplifyPolygon(out);
}
/** True when the polygon is convex (either winding). */
export function isConvex(poly) {
    let sign = 0;
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const c = poly[(i + 2) % poly.length];
        const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
        if (Math.abs(cr) < 1e-9)
            continue;
        const s = Math.sign(cr);
        if (sign === 0)
            sign = s;
        else if (s !== sign)
            return false;
    }
    return true;
}
