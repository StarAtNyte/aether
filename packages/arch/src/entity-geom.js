import { rotateYaw } from './math2';
function params(e) {
    return e.shape.kind === 'procedural' ? e.shape.params : {};
}
/** World-space outline of a room or slab entity (`polygon` param), or null. */
export function placedPolygon(e, key = 'polygon') {
    const raw = params(e)[key];
    if (!Array.isArray(raw))
        return null;
    const pos = e.transform.position;
    const yaw = e.transform.rotation[1];
    const out = [];
    for (const p of raw.slice(0, 256)) {
        if (!Array.isArray(p) || typeof p[0] !== 'number' || typeof p[1] !== 'number')
            return null;
        const r = rotateYaw(p[0], p[1], yaw);
        out.push([pos[0] + r[0], pos[2] + r[1]]);
    }
    return out.length >= 3 ? out : null;
}
