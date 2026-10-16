/** Zoom limits (pixels per metre). */
export const PLAN_ZOOM = Object.freeze([6, 400]);
/**
 * Camera that fits plan bounds `[x0, z0, x1, z1]` into a `width`×`height` px
 * view, keeping `insets` px free (overlay bars over the plan), centred in
 * the free area.
 */
export function fitPlan(bounds, width, height, insets = 64) {
    const [x0, z0, x1, z1] = bounds;
    const m = typeof insets === 'number' ? { top: insets, right: insets, bottom: insets, left: insets } : insets;
    const w = Math.max(1, x1 - x0);
    const h = Math.max(1, z1 - z0);
    const vw = Math.max(1, width - m.left - m.right);
    const vh = Math.max(1, height - m.top - m.bottom);
    const scale = clampZoom(Math.min(vw / w, vh / h));
    // Shift the centre so the plan sits in the middle of the free area, not of the whole view.
    const shiftX = (m.left - m.right) / 2 / scale;
    const shiftZ = (m.top - m.bottom) / 2 / scale;
    return { cx: (x0 + x1) / 2 - shiftX, cz: (z0 + z1) / 2 - shiftZ, scale };
}
/** Clamp a zoom to {@link PLAN_ZOOM}. */
export function clampZoom(scale) {
    return Number.isFinite(scale) ? Math.max(PLAN_ZOOM[0], Math.min(PLAN_ZOOM[1], scale)) : PLAN_ZOOM[0];
}
/** The SVG viewBox `[x, y, w, h]` (plan metres) of a camera in a `width`×`height` px view. */
export function viewBox(cam, width, height) {
    const w = Math.max(1, width) / cam.scale;
    const h = Math.max(1, height) / cam.scale;
    return [cam.cx - w / 2, cam.cz - h / 2, w, h];
}
/** Zoom by `factor` keeping the plan point under the pixel (`px`, `py`) fixed. */
export function zoomAt(cam, factor, px, py, width, height) {
    const scale = clampZoom(cam.scale * (Number.isFinite(factor) && factor > 0 ? factor : 1));
    // Plan point under the cursor before the zoom.
    const mx = cam.cx + (px - width / 2) / cam.scale;
    const mz = cam.cz + (py - height / 2) / cam.scale;
    return { scale, cx: mx - (px - width / 2) / scale, cz: mz - (py - height / 2) / scale };
}
/** Pan by a pixel delta. */
export function panBy(cam, dx, dy) {
    return { ...cam, cx: cam.cx - dx / cam.scale, cz: cam.cz - dy / cam.scale };
}
/** Room fill and label-dot colours per room type (muted fills, saturated dots). */
const ROOM_COLORS = Object.freeze({
    living: ['#f3ece0', '#d08a3c'],
    dining: ['#f3eadf', '#c9772f'],
    kitchen: ['#e9efe2', '#6f9a4b'],
    bedroom: ['#e6ecf4', '#5b7fb5'],
    kids: ['#efe8f4', '#9a6bbf'],
    bathroom: ['#e2eff1', '#3f9aa6'],
    office: ['#ece9f5', '#7465b8'],
    'open-office': ['#ece9f5', '#7465b8'],
    meeting: ['#f2e8ec', '#b45f7c'],
    cafe: ['#f4ebe2', '#b26b3c'],
    hall: ['#efeeec', '#8a8780'],
    entry: ['#efeeec', '#8a8780'],
    lobby: ['#efeeec', '#8a8780'],
    storage: ['#eceae6', '#7d786f'],
    laundry: ['#e7eef0', '#5f8d99'],
    terrace: ['#ebe7de', '#9c8c6d'],
    garage: ['#e9e9e9', '#6f6f6f'],
    studio: ['#f1ebe2', '#c27c3e'],
});
/** `[fill, dot]` colours of a room type. */
export function roomColors(kind) {
    return ROOM_COLORS[kind] ?? ['#eeedea', '#8a8780'];
}
/** Area label ("18.4 m²"). */
export function areaLabel(m2) {
    return `${Number.isFinite(m2) ? (m2 >= 100 ? Math.round(m2) : Math.round(m2 * 10) / 10) : 0} m²`;
}
/** Length label of a drawn edge ("3.45 m"). */
export function lengthLabel(m) {
    return `${(Number.isFinite(m) ? m : 0).toFixed(2)} m`;
}
/** Outline of a rectangle dragged from `a` to `b` (empty when thinner than 0.3 m). */
export function dragRect(a, b) {
    const x0 = Math.min(a[0], b[0]);
    const x1 = Math.max(a[0], b[0]);
    const z0 = Math.min(a[1], b[1]);
    const z1 = Math.max(a[1], b[1]);
    if (x1 - x0 < 0.3 || z1 - z0 < 0.3)
        return [];
    return [
        [x0, z0],
        [x1, z0],
        [x1, z1],
        [x0, z1],
    ];
}
/** Shoelace area of an outline (m², absolute). */
export function outlineArea(poly) {
    let a = 0;
    for (let i = 0; i < poly.length; i++) {
        const p = poly[i];
        const q = poly[(i + 1) % poly.length];
        a += p[0] * q[1] - q[0] * p[1];
    }
    return Math.abs(a) / 2;
}
/** True when `p` closes a polygon being drawn (near its first point, three or more points placed). */
export function closesPolygon(points, p, reach = 0.25) {
    const first = points[0];
    return points.length >= 3 && first !== undefined && Math.hypot(first[0] - p[0], first[1] - p[1]) <= reach;
}
/** SVG path data of a polyline / polygon. */
export function pathOf(points, closed) {
    if (points.length === 0)
        return '';
    const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p[0])} ${round(p[1])}`).join(' ');
    return closed ? `${d} Z` : d;
}
function round(n) {
    return Math.round(n * 1000) / 1000;
}
