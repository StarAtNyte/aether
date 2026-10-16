/**
 * Geometry helpers for the quality heuristics: world-space bounds of
 * entities (renderer-supplied when available, otherwise estimated from the
 * shape spec) and the classification of scenery vs. content.
 */
import { assetShapeSize } from '@aether/assets';
import { decodeMeshCached, meshBounds, worldTransform } from '@aether/core';
/** Entities whose footprint exceeds this are treated as scenery (metres). */
export const SCENERY_FOOTPRINT = 60;
const TERRAIN_GENERATORS = new Set(['terrain', 'island', 'mountain', 'cloud']);
const SCENERY_TAGS = new Set(['backdrop', 'terrain', 'ground', 'sky', 'scenery']);
function num(params, key) {
    const v = params[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
/** Local size [w, h, d] of a procedural generator at its params (rough, base at y = 0). */
export function proceduralSize(generator, params) {
    const h = num(params, 'height');
    const s = num(params, 'size');
    const len = num(params, 'length');
    switch (generator) {
        case 'tree-pine':
        case 'tree-oak':
        case 'tree-palm': {
            const height = h ?? 6;
            return [height * 0.55, height, height * 0.55];
        }
        case 'house': {
            const w = num(params, 'width') ?? 6;
            const d = num(params, 'depth') ?? 5;
            const floors = num(params, 'floors') ?? 1;
            return [w, floors * 3 + 2, d];
        }
        case 'tower':
        case 'windmill': {
            const height = h ?? 10;
            const r = num(params, 'radius') ?? height * 0.2;
            return [r * 2, height, r * 2];
        }
        case 'wall':
        case 'fence':
            return [len ?? 8, h ?? 2.5, num(params, 'thickness') ?? 0.6];
        case 'bridge':
        case 'dock':
        case 'ramp':
            return [num(params, 'width') ?? 3, h ?? 1.5, len ?? 10];
        case 'car':
            return [(len ?? 4.2) * 0.45, (len ?? 4.2) * 0.35, len ?? 4.2];
        case 'boat':
            return [(len ?? 5) * 0.4, (len ?? 5) * 0.35, len ?? 5];
        case 'bench':
            return [len ?? 1.8, 0.9, 0.6];
        case 'table':
            return [num(params, 'width') ?? 1.6, h ?? 0.8, num(params, 'depth') ?? 0.9];
        case 'stairs':
            return [num(params, 'width') ?? 2, h ?? 2, num(params, 'depth') ?? 3];
        case 'arch':
            return [num(params, 'width') ?? 4, h ?? 5, num(params, 'thickness') ?? 1];
        case 'terrain':
        case 'island':
        case 'mountain':
            return [s ?? 120, h ?? 20, s ?? 120];
        default: {
            if (h !== undefined)
                return [h * 0.6, h, h * 0.6];
            if (s !== undefined)
                return [s, s, s];
            if (len !== undefined)
                return [len * 0.5, len * 0.4, len];
            return [2, 2, 2];
        }
    }
}
/** Estimated world-space bounds of an entity from its spec (no renderer); null for shapeless entities. */
export function estimateBounds(world, e) {
    const shape = e.shape;
    let size;
    let baseAtZero = false;
    switch (shape.kind) {
        case 'none':
            return null;
        case 'primitive':
            size = [shape.size[0], shape.size[1], shape.size[2]];
            break;
        case 'procedural':
            size = proceduralSize(shape.generator, shape.params);
            baseAtZero = true;
            break;
        case 'model':
            size = [shape.fitSize ?? 2, shape.fitSize ?? 2, shape.fitSize ?? 2];
            baseAtZero = true;
            break;
        case 'scatter':
            size = [shape.area[0], 1, shape.area[1]];
            baseAtZero = true;
            break;
        case 'asset': {
            const s = assetShapeSize(shape);
            size = s ?? [shape.fitSize ?? 1, shape.fitSize ?? 1, shape.fitSize ?? 1];
            baseAtZero = true;
            break;
        }
        case 'mesh': {
            const asset = Object.hasOwn(world.meshes, shape.mesh) ? world.meshes[shape.mesh] : undefined;
            if (!asset)
                return null;
            let b;
            try {
                b = meshBounds(decodeMeshCached(asset).positions);
            }
            catch {
                return null;
            }
            size = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
            baseAtZero = true;
            break;
        }
    }
    let t;
    try {
        t = worldTransform(world, e.id);
    }
    catch {
        return null;
    }
    const sx = Math.abs(size[0] * t.scale[0]) / 2;
    const sy = Math.abs(size[1] * t.scale[1]);
    const sz = Math.abs(size[2] * t.scale[2]) / 2;
    const [px, py, pz] = t.position;
    const minY = baseAtZero ? py : py - sy / 2;
    return { min: [px - sx, minY, pz - sz], max: [px + sx, minY + sy, pz + sz] };
}
/** True when the entity is backdrop/terrain/ground scenery rather than content. */
export function isScenery(e, b) {
    if (e.tags.some((t) => SCENERY_TAGS.has(t)))
        return true;
    if (e.shape.kind === 'procedural' && TERRAIN_GENERATORS.has(e.shape.generator))
        return true;
    if (b && Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]) > SCENERY_FOOTPRINT)
        return true;
    return false;
}
/** Visible, non-template content entities with bounds (scenery and scatter excluded unless `withScatter`). */
export function placedContent(world, boundsOf, withScatter = false) {
    const out = [];
    for (const e of Object.values(world.entities)) {
        if (!e.visible || e.template || e.shape.kind === 'none')
            continue;
        if (e.shape.kind === 'scatter' && !withScatter)
            continue;
        const b = boundsOf?.(e.id) ?? estimateBounds(world, e);
        if (!b || !b.min.every(Number.isFinite) || !b.max.every(Number.isFinite))
            continue;
        if (isScenery(e, b))
            continue;
        out.push({ id: e.id, entity: e, bounds: b, root: e.parent === null });
    }
    return out;
}
/** Volume of the intersection of two boxes (0 when disjoint). */
export function overlapVolume(a, b) {
    let v = 1;
    for (let i = 0; i < 3; i++) {
        const lo = Math.max(a.min[i], b.min[i]);
        const hi = Math.min(a.max[i], b.max[i]);
        if (hi <= lo)
            return 0;
        v *= hi - lo;
    }
    return v;
}
/** Box volume (with a 1 cm floor per axis so flat things still count). */
export function volume(b) {
    return Math.max(0.01, b.max[0] - b.min[0]) * Math.max(0.01, b.max[1] - b.min[1]) * Math.max(0.01, b.max[2] - b.min[2]);
}
/** Horizontal radius of the content around its centroid. */
export function contentExtent(items) {
    if (items.length === 0)
        return { center: [0, 0], radius: 0 };
    let cx = 0;
    let cz = 0;
    for (const p of items) {
        cx += (p.bounds.min[0] + p.bounds.max[0]) / 2;
        cz += (p.bounds.min[2] + p.bounds.max[2]) / 2;
    }
    cx /= items.length;
    cz /= items.length;
    let r = 0;
    for (const p of items) {
        const dx = Math.max(Math.abs(p.bounds.min[0] - cx), Math.abs(p.bounds.max[0] - cx));
        const dz = Math.max(Math.abs(p.bounds.min[2] - cz), Math.abs(p.bounds.max[2] - cz));
        r = Math.max(r, Math.hypot(dx, dz));
    }
    return { center: [cx, cz], radius: r };
}
/** Behaviours/tags that make hovering legitimate. */
export function mayFloat(e) {
    if (e.tags.some((t) => /fly|float|hover|sky|cloud|bird|balloon|space|planet|star|moon|sun/.test(t)))
        return true;
    if (e.behaviors.some((b) => b.type === 'bob' || b.type === 'orbit' || b.type === 'spin' || b.type === 'collectible' || b.type === 'magnet'))
        return true;
    if (e.light && e.shape.kind === 'primitive' && e.shape.size.every((s) => s < 0.6))
        return true;
    if (e.physics?.body === 'dynamic' || e.physics?.body === 'kinematic')
        return true;
    if (e.shape.kind === 'procedural' && (e.shape.generator === 'cloud' || e.shape.generator === 'portal' || e.shape.generator === 'crystal'))
        return true;
    return false;
}
