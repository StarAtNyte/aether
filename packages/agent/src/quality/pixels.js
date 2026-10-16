/** Gradient magnitude (0–1 luminance units) counted as an edge. */
const EDGE = 0.08;
/** Cell size for coverage (pixels). */
const CELL = 8;
/** Compute {@link ViewStats} for an RGBA image of `w × h`. */
export function viewStatsFromPixels(rgba, w, h) {
    const n = w * h;
    if (n <= 0 || rgba.length < n * 4)
        return { coverage: 0, edgeDensity: 0, luminance: 0, contrast: 0, colorfulness: 0 };
    const lum = new Float32Array(n);
    let sum = 0;
    let rgSum = 0;
    let ybSum = 0;
    let rgSq = 0;
    let ybSq = 0;
    for (let i = 0; i < n; i++) {
        const r = (rgba[i * 4] ?? 0) / 255;
        const g = (rgba[i * 4 + 1] ?? 0) / 255;
        const b = (rgba[i * 4 + 2] ?? 0) / 255;
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        lum[i] = l;
        sum += l;
        const rg = r - g;
        const yb = 0.5 * (r + g) - b;
        rgSum += rg;
        ybSum += yb;
        rgSq += rg * rg;
        ybSq += yb * yb;
    }
    const mean = sum / n;
    let varSum = 0;
    for (let i = 0; i < n; i++)
        varSum += (lum[i] - mean) ** 2;
    const rgMean = rgSum / n;
    const ybMean = ybSum / n;
    const sdRgYb = Math.sqrt(Math.max(0, rgSq / n - rgMean * rgMean) + Math.max(0, ybSq / n - ybMean * ybMean));
    const colorfulness = Math.min(1, (sdRgYb + 0.3 * Math.hypot(rgMean, ybMean)) / 0.6);
    let edges = 0;
    const cols = Math.max(1, Math.floor(w / CELL));
    const rows = Math.max(1, Math.floor(h / CELL));
    const cellEdges = new Uint16Array(cols * rows);
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const i = y * w + x;
            const gx = lum[i + 1] - lum[i - 1];
            const gy = lum[i + w] - lum[i - w];
            if (Math.abs(gx) + Math.abs(gy) > EDGE) {
                edges++;
                const c = Math.min(rows - 1, Math.floor(y / CELL)) * cols + Math.min(cols - 1, Math.floor(x / CELL));
                cellEdges[c] = (cellEdges[c] ?? 0) + 1;
            }
        }
    }
    let covered = 0;
    for (let c = 0; c < cellEdges.length; c++)
        if ((cellEdges[c] ?? 0) >= 2)
            covered++;
    return {
        coverage: covered / cellEdges.length,
        edgeDensity: edges / Math.max(1, (w - 2) * (h - 2)),
        luminance: mean,
        contrast: Math.sqrt(varSum / n),
        colorfulness,
    };
}
