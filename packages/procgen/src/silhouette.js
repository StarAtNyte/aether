/** Rasterize the silhouette of `out` on a `size × size` grid. */
export function silhouette(out, view, size = 48) {
    const u = 0;
    const v = view === 'front' ? 1 : 2;
    const minU = out.bounds.min[u];
    const maxU = out.bounds.max[u];
    const minV = out.bounds.min[v];
    const maxV = out.bounds.max[v];
    const extent = Math.max(maxU - minU, maxV - minV, 1e-6);
    const grid = new Uint8Array(size * size);
    // Map the bounds onto [0, size] so pixel centres (x + 0.5) cover the full extent.
    const toPx = (val, min) => ((val - min) / extent) * size;
    for (const part of out.parts) {
        const p = part.positions;
        const idx = part.indices;
        for (let t = 0; t + 2 < idx.length; t += 3) {
            const a = idx[t] * 3;
            const b = idx[t + 1] * 3;
            const c = idx[t + 2] * 3;
            fillTriangle(grid, size, toPx(p[a + u], minU), toPx(p[a + v], minV), toPx(p[b + u], minU), toPx(p[b + v], minV), toPx(p[c + u], minU), toPx(p[c + v], minV));
        }
    }
    let filled = 0;
    let boundary = 0;
    let x0 = size;
    let x1 = -1;
    let y0 = size;
    let y1 = -1;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (!grid[y * size + x])
                continue;
            filled++;
            x0 = Math.min(x0, x);
            x1 = Math.max(x1, x);
            y0 = Math.min(y0, y);
            y1 = Math.max(y1, y);
            const edge = x === 0 || y === 0 || x === size - 1 || y === size - 1 || !grid[y * size + x - 1] || !grid[y * size + x + 1] || !grid[(y - 1) * size + x] || !grid[(y + 1) * size + x];
            if (edge)
                boundary++;
        }
    }
    if (filled === 0)
        return { coverage: 0, fill: 0, complexity: 0, aspect: 0 };
    const boxArea = (x1 - x0 + 1) * (y1 - y0 + 1);
    return { coverage: filled / (size * size), fill: filled / boxArea, complexity: boundary / filled, aspect: (y1 - y0 + 1) / (x1 - x0 + 1) };
}
function edgeFn(ax, ay, bx, by, px, py) {
    return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
}
function fillTriangle(grid, size, ax, ay, bx, by, cx, cy) {
    const area = edgeFn(ax, ay, bx, by, cx, cy);
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const maxX = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const maxY = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)));
    if (Math.abs(area) < 1e-9) {
        // Degenerate in this projection (an edge-on face): mark its vertices' cells only.
        for (const [x, y] of [[ax, ay], [bx, by], [cx, cy]]) {
            const xi = Math.min(size - 1, Math.floor(x));
            const yi = Math.min(size - 1, Math.floor(y));
            if (xi >= 0 && yi >= 0 && xi < size && yi < size)
                grid[yi * size + xi] = 1;
        }
        return;
    }
    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            const px = x + 0.5;
            const py = y + 0.5;
            const w0 = edgeFn(bx, by, cx, cy, px, py);
            const w1 = edgeFn(cx, cy, ax, ay, px, py);
            const w2 = edgeFn(ax, ay, bx, by, px, py);
            if ((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0))
                grid[y * size + x] = 1;
        }
    }
}
/**
 * Headless "render" check for generated objects: the object must be grounded
 * (base near y = 0), roughly centred, of plausible size, visible from the
 * front and the top, and not a bare box (some outline complexity).
 */
export function checkSilhouette(out) {
    const { min, max } = out.bounds;
    const w = max[0] - min[0];
    const h = max[1] - min[1];
    const d = max[2] - min[2];
    const big = Math.max(w, h, d);
    if (!(big > 0.15 && big < 120))
        return { ok: false, error: `implausible size (${w.toFixed(2)} × ${h.toFixed(2)} × ${d.toFixed(2)} m)` };
    if (min[1] < -0.6 || min[1] > 0.6)
        return { ok: false, error: `the base must sit at y = 0 (lowest point is y = ${min[1].toFixed(2)})` };
    const cx = (min[0] + max[0]) / 2;
    const cz = (min[2] + max[2]) / 2;
    if (Math.abs(cx) > big * 0.35 || Math.abs(cz) > big * 0.35)
        return { ok: false, error: 'the object must be centred on x = 0, z = 0' };
    const front = silhouette(out, 'front');
    const top = silhouette(out, 'top');
    if (front.coverage < 0.03 || top.coverage < 0.02)
        return { ok: false, error: 'the object is nearly invisible (almost no projected area)' };
    if (front.fill > 0.985 && top.fill > 0.985 && out.stats.triangles <= 24)
        return { ok: false, error: 'the object is a single box; add recognizable parts' };
    return { ok: true, front, top };
}
