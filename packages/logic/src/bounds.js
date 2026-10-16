import { assetShapeSize } from '@aether/assets';
import { inverseRotate } from './vec';
/** Thin shapes (planes) still get a usable trigger height (meters, half). */
const MIN_HALF_HEIGHT = 0.5;
/** Derive the containment volume of an entity (scale applied, rotation not). */
export function zoneShapeOf(entity) {
    const s = entity.transform.scale;
    const sx = Math.abs(s[0]), sy = Math.abs(s[1]), sz = Math.abs(s[2]);
    const shape = entity.shape;
    if (shape.kind === 'primitive') {
        const [w, h, d] = shape.size;
        switch (shape.primitive) {
            case 'sphere': {
                const r = (w / 2) * Math.max(sx, sy, sz);
                return { kind: 'sphere', half: [r, r, r] };
            }
            case 'cylinder':
            case 'cone':
            case 'capsule':
                return { kind: 'cylinder', half: [(w / 2) * Math.max(sx, sz), (h / 2) * sy, (w / 2) * Math.max(sx, sz)] };
            case 'torus':
                return { kind: 'cylinder', half: [(w / 2) * Math.max(sx, sz), Math.max((h / 2) * sy, MIN_HALF_HEIGHT), (w / 2) * Math.max(sx, sz)] };
            case 'plane':
                return { kind: 'box', half: [(w / 2) * sx, MIN_HALF_HEIGHT, (d / 2) * sz] };
            case 'box':
                return { kind: 'box', half: [(w / 2) * sx, (h / 2) * sy, (d / 2) * sz] };
        }
    }
    if (shape.kind === 'scatter') {
        return { kind: 'box', half: [(shape.area[0] / 2) * sx, MIN_HALF_HEIGHT * sy, (shape.area[1] / 2) * sz] };
    }
    if (shape.kind === 'procedural' && shape.generator === 'arch-door') {
        // Door leaves (@aether/arch): the hinge sits on the leaf edge, so the zone must be the real leaf.
        const p = shape.params;
        const num = (k, d, lo, hi) => {
            const v = Object.hasOwn(p, k) ? p[k] : undefined;
            return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
        };
        return { kind: 'box', half: [(num('width', 0.9, 0.4, 4) / 2) * sx, (num('height', 2.1, 1.5, 4) / 2) * sy, (num('thickness', 0.045, 0.02, 0.12) / 2) * sz] };
    }
    if (shape.kind === 'procedural' && shape.generator === 'arch-sash') {
        // Window casements: the hinge sits on the left edge, so the zone must be the real casement.
        const q = shape.params;
        const num = (k, d) => {
            const v = Object.hasOwn(q, k) ? q[k] : undefined;
            return typeof v === 'number' && Number.isFinite(v) ? Math.min(3, Math.max(0.2, v)) : d;
        };
        return { kind: 'box', half: [(num('width', 1) / 2) * sx, (num('height', 1.2) / 2) * sy, 0.03 * sz] };
    }
    if (shape.kind === 'procedural' && shape.generator === 'furn-part') {
        // Drawers and cabinet doors: the part box recorded by the arch compiler (the hinge sits on its edge).
        const dims = shape.params['size'];
        if (Array.isArray(dims) && dims.length === 3 && dims.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 20)) {
            return { kind: 'box', half: [(dims[0] / 2) * sx, (dims[1] / 2) * sy, (dims[2] / 2) * sz] };
        }
    }
    if (shape.kind === 'asset') {
        const size = assetShapeSize(shape);
        if (size)
            return { kind: 'box', half: [(size[0] / 2) * sx, Math.max(size[1] / 2, MIN_HALF_HEIGHT) * sy, (size[2] / 2) * sz] };
    }
    if (shape.kind === 'model' && shape.fitSize !== undefined) {
        const h = shape.fitSize / 2;
        return { kind: 'box', half: [h * sx, h * sy, h * sz] };
    }
    return { kind: 'box', half: [0.5 * sx, 0.5 * sy, 0.5 * sz] };
}
const local = [0, 0, 0];
/**
 * True when point `p` lies inside `zone` placed at `center` with rotation `rot`,
 * expanded by `margin` meters on every side.
 */
export function insideZone(zone, center, rot, p, margin = 0) {
    local[0] = p[0] - center[0];
    local[1] = p[1] - center[1];
    local[2] = p[2] - center[2];
    if (zone.kind === 'sphere') {
        const r = zone.half[0] + margin;
        return local[0] * local[0] + local[1] * local[1] + local[2] * local[2] <= r * r;
    }
    inverseRotate(rot, local, local);
    if (Math.abs(local[1]) > zone.half[1] + margin)
        return false;
    if (zone.kind === 'cylinder') {
        const r = zone.half[0] + margin;
        return local[0] * local[0] + local[2] * local[2] <= r * r;
    }
    return Math.abs(local[0]) <= zone.half[0] + margin && Math.abs(local[2]) <= zone.half[2] + margin;
}
/**
 * True when point `p` is within the footprint of `zone` (expanded by `margin`
 * horizontally) and between the zone's bottom and `height` meters above its top.
 * Used for "standing on" checks (plates, pads, belts).
 */
export function onTopOfZone(zone, center, rot, p, height, margin = 0.05) {
    local[0] = p[0] - center[0];
    local[1] = p[1] - center[1];
    local[2] = p[2] - center[2];
    inverseRotate(rot, local, local);
    const hy = zone.half[1];
    if (local[1] < -hy || local[1] > hy + height)
        return false;
    if (zone.kind === 'box')
        return Math.abs(local[0]) <= zone.half[0] + margin && Math.abs(local[2]) <= zone.half[2] + margin;
    const r = zone.half[0] + margin;
    return local[0] * local[0] + local[2] * local[2] <= r * r;
}
