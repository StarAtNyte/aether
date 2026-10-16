/**
 * Polygon triangulation with holes (ear clipping; holes are joined to the
 * outline by bridge edges first). Polygons in architecture are small (rooms,
 * slabs, roof faces), so the simple O(n²) algorithm is plenty and robust.
 *
 * Winding convention: the returned triangles have a POSITIVE shoelace area in
 * (x, z), i.e. the same orientation as {@link positive} polygons. Seen from
 * above (+Y looking down) with three.js axes, such a triangle faces DOWN
 * (normal −Y); callers emitting upward faces reverse each triangle.
 */
import { positive, signedArea } from './math2';
function cross(o, a, b) {
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}
function pointInTriangle(p, a, b, c) {
    const d1 = cross(a, b, p);
    const d2 = cross(b, c, p);
    const d3 = cross(c, a, p);
    const neg = d1 < -1e-12 || d2 < -1e-12 || d3 < -1e-12;
    const pos = d1 > 1e-12 || d2 > 1e-12 || d3 > 1e-12;
    return !(neg && pos);
}
function segmentsCross(a, b, c, d) {
    const d1 = cross(c, d, a);
    const d2 = cross(c, d, b);
    const d3 = cross(a, b, c);
    const d4 = cross(a, b, d);
    return ((d1 > 1e-12 && d2 < -1e-12) || (d1 < -1e-12 && d2 > 1e-12)) && ((d3 > 1e-12 && d4 < -1e-12) || (d3 < -1e-12 && d4 > 1e-12));
}
/**
 * Join holes into the outline with bridge edges (each hole's right-most
 * vertex to the nearest outline vertex it can see). Returns one polygon of
 * vertex indices into `points` (outline first, then each hole).
 */
function bridgeHoles(points, outline, holes) {
    let ring = outline.slice();
    const ordered = holes.slice().sort((h1, h2) => Math.max(...h2.map((i) => points[i][0])) - Math.max(...h1.map((i) => points[i][0])));
    for (const hole of ordered) {
        let hi = 0;
        for (let k = 1; k < hole.length; k++)
            if (points[hole[k]][0] > points[hole[hi]][0])
                hi = k;
        const hp = points[hole[hi]];
        let best = -1;
        let bestD = Infinity;
        for (let k = 0; k < ring.length; k++) {
            const rp = points[ring[k]];
            const d = (rp[0] - hp[0]) ** 2 + (rp[1] - hp[1]) ** 2;
            if (d >= bestD)
                continue;
            // Visible: the bridge crosses no ring edge and no hole edge.
            let blocked = false;
            for (let e = 0; e < ring.length && !blocked; e++) {
                const a = points[ring[e]];
                const b = points[ring[(e + 1) % ring.length]];
                if (segmentsCross(hp, rp, a, b))
                    blocked = true;
            }
            for (let e = 0; e < hole.length && !blocked; e++) {
                const a = points[hole[e]];
                const b = points[hole[(e + 1) % hole.length]];
                if (segmentsCross(hp, rp, a, b))
                    blocked = true;
            }
            if (!blocked) {
                best = k;
                bestD = d;
            }
        }
        if (best < 0)
            continue; // unreachable hole (degenerate input): skip it rather than fail
        const holeRing = [...hole.slice(hi), ...hole.slice(0, hi), hole[hi]];
        ring = [...ring.slice(0, best + 1), ...holeRing, ...ring.slice(best)];
    }
    return ring;
}
/**
 * Triangulate `outline` minus `holes`. Returns `{ points, triangles }` where
 * `points` is the outline followed by the holes (re-wound: outline positive,
 * holes negative) and `triangles` holds index triples with positive shoelace
 * area. Degenerate input yields as many triangles as could be found.
 */
export function triangulate(outline, holes = []) {
    const outer = positive(outline);
    const points = [...outer];
    const outerIdx = outer.map((_, i) => i);
    const holeIdx = [];
    for (const h of holes) {
        if (h.length < 3)
            continue;
        const hp = positive(h).reverse();
        const start = points.length;
        points.push(...hp);
        holeIdx.push(hp.map((_, i) => start + i));
    }
    const ring = holeIdx.length > 0 ? bridgeHoles(points, outerIdx, holeIdx) : outerIdx;
    const triangles = [];
    const idx = ring.slice();
    let guard = idx.length * idx.length + 16;
    while (idx.length > 3 && guard-- > 0) {
        let clipped = false;
        for (let i = 0; i < idx.length; i++) {
            const ia = idx[(i + idx.length - 1) % idx.length];
            const ib = idx[i];
            const ic = idx[(i + 1) % idx.length];
            const a = points[ia];
            const b = points[ib];
            const c = points[ic];
            if (cross(a, b, c) <= 1e-12)
                continue; // reflex or degenerate
            let ear = true;
            for (const j of idx) {
                if (j === ia || j === ib || j === ic)
                    continue;
                const p = points[j];
                // Bridge duplicates share coordinates with ear corners: ignore exact copies.
                if ((p[0] === a[0] && p[1] === a[1]) || (p[0] === b[0] && p[1] === b[1]) || (p[0] === c[0] && p[1] === c[1]))
                    continue;
                if (pointInTriangle(p, a, b, c)) {
                    ear = false;
                    break;
                }
            }
            if (!ear)
                continue;
            triangles.push(ia, ib, ic);
            idx.splice(i, 1);
            clipped = true;
            break;
        }
        if (!clipped) {
            // Numerically stuck (collinear runs): drop the flattest vertex and continue.
            let flat = 0;
            let best = Infinity;
            for (let i = 0; i < idx.length; i++) {
                const a = points[idx[(i + idx.length - 1) % idx.length]];
                const b = points[idx[i]];
                const c = points[idx[(i + 1) % idx.length]];
                const v = Math.abs(cross(a, b, c));
                if (v < best) {
                    best = v;
                    flat = i;
                }
            }
            idx.splice(flat, 1);
        }
    }
    if (idx.length === 3) {
        const [ia, ib, ic] = idx;
        if (cross(points[ia], points[ib], points[ic]) > 1e-12)
            triangles.push(ia, ib, ic);
    }
    return { points, triangles };
}
/** Total area of a triangulation (for tests: equals outline area minus hole areas). */
export function triangulatedArea(points, triangles) {
    let s = 0;
    for (let i = 0; i < triangles.length; i += 3) {
        s += signedArea([points[triangles[i]], points[triangles[i + 1]], points[triangles[i + 2]]]);
    }
    return s;
}
