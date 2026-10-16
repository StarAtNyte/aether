function finite(v, fallback) {
    return Number.isFinite(v) ? v : fallback;
}
/**
 * Fit a directional shadow camera around `bounds` (null/empty → a default
 * area around the origin) for a light coming FROM `direction` (unit vector
 * from the scene toward the light).
 */
export function fitShadowCamera(bounds, direction, opts = {}) {
    const minHalf = opts.minHalf ?? 12;
    const maxHalf = opts.maxHalf ?? 160;
    let center = [0, 0, 0];
    let radius = minHalf / 1.05;
    if (bounds && bounds.max[0] >= bounds.min[0] && bounds.max[1] >= bounds.min[1] && bounds.max[2] >= bounds.min[2]) {
        const cx = finite((bounds.min[0] + bounds.max[0]) / 2, 0);
        const cy = finite((bounds.min[1] + bounds.max[1]) / 2, 0);
        const cz = finite((bounds.min[2] + bounds.max[2]) / 2, 0);
        const dx = finite(bounds.max[0] - bounds.min[0], 0);
        const dy = finite(bounds.max[1] - bounds.min[1], 0);
        const dz = finite(bounds.max[2] - bounds.min[2], 0);
        radius = Math.hypot(dx, dy, dz) / 2;
        // Content larger than the cap: keep shadows sharp around the center.
        center = [Math.max(-1e4, Math.min(1e4, cx)), Math.max(-1e4, Math.min(1e4, cy)), Math.max(-1e4, Math.min(1e4, cz))];
    }
    const halfSize = Math.max(minHalf, Math.min(maxHalf, radius * 1.05));
    const len = Math.hypot(direction[0], direction[1], direction[2]) || 1;
    const dist = halfSize * 2 + 20;
    const position = [
        center[0] + (direction[0] / len) * dist,
        center[1] + (direction[1] / len) * dist,
        center[2] + (direction[2] / len) * dist,
    ];
    return { center, position, halfSize, near: 0.5, far: dist + halfSize * 2 + 20, mapSize: halfSize > 60 ? 4096 : 2048 };
}
