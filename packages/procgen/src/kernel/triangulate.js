/**
 * Ear-clipping triangulation for simple polygons (convex or concave, no holes).
 * Input must be counter-clockwise without consecutive duplicate points.
 * Always terminates: when no valid ear exists (degenerate/self-intersecting
 * input) it clips the current vertex anyway.
 */
/** Twice the signed area of a polygon (positive = counter-clockwise). */
export function signedArea2(xs, ys) {
    let a = 0;
    const n = xs.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        a += (xs[j] - xs[i]) * (ys[j] + ys[i]);
    }
    return a;
}
function cross(ax, ay, bx, by, cx, cy) {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}
function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
    return cross(ax, ay, bx, by, px, py) >= 0 && cross(bx, by, cx, cy, px, py) >= 0 && cross(cx, cy, ax, ay, px, py) >= 0;
}
/**
 * Triangulate a CCW polygon. Returns vertex indices (3 per triangle, CCW).
 * Complexity O(n²) typical, O(n³) worst case; callers cap n.
 */
export function triangulate(xs, ys) {
    const n = xs.length;
    const out = [];
    if (n < 3)
        return out;
    const prev = new Int32Array(n);
    const next = new Int32Array(n);
    for (let i = 0; i < n; i++) {
        prev[i] = (i + n - 1) % n;
        next[i] = (i + 1) % n;
    }
    let remaining = n;
    let cur = 0;
    let misses = 0;
    while (remaining > 3) {
        const a = prev[cur];
        const c = next[cur];
        const ax = xs[a], ay = ys[a];
        const bx = xs[cur], by = ys[cur];
        const cx = xs[c], cy = ys[c];
        let ear = cross(ax, ay, bx, by, cx, cy) > 1e-12;
        if (ear) {
            for (let v = next[c]; v !== a; v = next[v]) {
                const vx = xs[v], vy = ys[v];
                if ((vx === ax && vy === ay) || (vx === bx && vy === by) || (vx === cx && vy === cy))
                    continue;
                if (inTriangle(vx, vy, ax, ay, bx, by, cx, cy)) {
                    ear = false;
                    break;
                }
            }
        }
        if (ear || misses > remaining) {
            out.push(a, cur, c);
            next[a] = c;
            prev[c] = a;
            remaining--;
            cur = c;
            misses = 0;
        }
        else {
            cur = c;
            misses++;
        }
    }
    out.push(prev[cur], cur, next[cur]);
    return out;
}
