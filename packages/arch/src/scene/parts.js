import { placedEntity } from '../compile';
import { FURNITURE, furnitureByKind, furnitureSize, resolveSpec } from '../furniture/index';
/** Catalogue entry of a kind, or undefined. */
export function partInfo(kind) {
    const def = furnitureByKind(kind);
    return def ? infoOf(def) : undefined;
}
function infoOf(def) {
    const params = Object.entries(def.params).map(([name, s]) => ({
        name,
        type: s.type,
        default: s.default,
        ...(s.min !== undefined ? { min: s.min } : {}),
        ...(s.max !== undefined ? { max: s.max } : {}),
        ...(s.options ? { options: s.options } : {}),
        ...(s.description ? { description: s.description } : {}),
    }));
    return { kind: def.kind, generator: def.id, mount: def.mount, description: def.description, size: furnitureSize(def), frontClearance: def.frontClearance, againstWall: def.againstWall, params };
}
/** Every kind of part, in catalogue order. */
export function listParts() {
    return FURNITURE.map(infoOf);
}
/** All kinds of part. */
export function partKinds() {
    return FURNITURE.map((f) => f.kind);
}
/**
 * Compact catalogue text for prompts: one line per kind with its mount, default
 * size and parameters (`name=default (min..max)` or `{options}`).
 */
export function describeParts() {
    return listParts()
        .map((p) => {
        const ps = p.params
            .map((q) => {
            const range = q.options ? `{${q.options.join('|')}}` : q.min !== undefined && q.max !== undefined ? `(${q.min}..${q.max})` : '';
            return `${q.name}=${typeof q.default === 'string' ? q.default : JSON.stringify(q.default)}${range}`;
        })
            .join(' ');
        return `- ${p.kind} [${p.mount}${p.againstWall ? ', usually against a wall' : ''}] ${p.size.map((v) => Math.round(v * 100) / 100).join('×')} m, front clearance ${p.frontClearance} m: ${ps}`;
    })
        .join('\n');
}
/** Parameters of a part after defaults and clamping, plus a note for everything that was changed. */
export function resolvePartParams(def, given) {
    const notes = [];
    const g = given ?? {};
    const known = new Set(Object.keys(def.params));
    const unknown = Object.keys(g).filter((k) => !known.has(k));
    if (unknown.length > 0)
        notes.push(`ignored unknown parameter${unknown.length > 1 ? 's' : ''} ${unknown.slice(0, 6).join(', ')} (${def.kind} has: ${[...known].join(', ')})`);
    const params = resolveSpec(def.params, g);
    for (const k of Object.keys(g)) {
        if (!known.has(k))
            continue;
        const spec = def.params[k];
        const want = g[k];
        if (spec.type === 'number' || spec.type === 'int') {
            const n = typeof want === 'number' ? want : Number.NaN;
            if (!Number.isFinite(n))
                notes.push(`${k}: ${JSON.stringify(want)} is not a number; used ${JSON.stringify(params[k])}`);
            else if (params[k] !== n)
                notes.push(`${k}: ${n} is outside ${spec.min}..${spec.max}; used ${JSON.stringify(params[k])}`);
        }
        else if (spec.type === 'enum' && params[k] !== want && String(want).toLowerCase() !== String(params[k]).toLowerCase()) {
            notes.push(`${k}: "${String(want).slice(0, 30)}" is not one of {${(spec.options ?? []).join('|')}}; used "${String(params[k])}"`);
        }
        else if (spec.type === 'color' && params[k] !== String(want).toLowerCase()) {
            notes.push(`${k}: ${JSON.stringify(want).slice(0, 30)} is not a #rrggbb colour; used ${JSON.stringify(params[k])}`);
        }
    }
    return { params, notes };
}
/** Wall pieces: where the bottom of a piece of height `h` hangs by default (centre of art at eye height). */
export function defaultWallBottom(kind, h, ceiling) {
    switch (kind) {
        case 'art':
            return Math.max(0.9, Math.min(ceiling - h - 0.25, 1.55 - h / 2));
        case 'mirror':
            return Math.max(0.2, Math.min(ceiling - h - 0.25, 1.5 - h / 2));
        case 'tv':
            return 1.05;
        case 'sconce':
            return 1.7;
        case 'switch':
            return 1.1;
        case 'whiteboard':
            return 0.9;
        case 'curtain':
            return 0;
        case 'cornice':
            return Math.max(0, ceiling - h);
        default:
            return Math.max(0, Math.min(1.2, ceiling - h - 0.2));
    }
}
/** Plausible height range (bottom of the piece above the floor) of wall pieces, for sanity checks. */
export function wallBottomRange(kind, h, ceiling) {
    switch (kind) {
        case 'art':
            return [0.6, Math.max(0.7, ceiling - h - 0.1)];
        case 'mirror':
            return [0, Math.max(0.1, ceiling - h - 0.1)];
        case 'tv':
            return [0.5, 1.7];
        case 'sconce':
            return [1.3, 2.2];
        case 'switch':
            return [0.9, 1.4];
        case 'whiteboard':
            return [0.4, 1.5];
        case 'curtain':
            return [0, 1.2];
        case 'cornice':
            return [Math.max(0, ceiling - h - 0.05), Math.max(0, ceiling - h + 0.02)];
        default:
            return [0, Math.max(0.1, ceiling - h)];
    }
}
/** Plausible size range of each kind (width, depth, height in metres): beyond it a piece reads as a mistake. */
export const KIND_SIZE_LIMITS = Object.freeze({
    sofa: { w: [1.0, 3.8], d: [0.65, 1.3], h: [0.55, 1.1] },
    armchair: { w: [0.55, 1.2], d: [0.6, 1.2], h: [0.6, 1.2] },
    bed: { w: [0.7, 2.3], d: [1.7, 2.4], h: [0.3, 1.8] },
    nightstand: { w: [0.3, 0.8], d: [0.3, 0.6], h: [0.35, 0.8] },
    wardrobe: { w: [0.6, 3.5], d: [0.4, 0.8], h: [1.6, 2.7] },
    desk: { w: [0.8, 2.4], d: [0.45, 1.0], h: [0.65, 0.85] },
    'dining-table': { w: [0.7, 3.4], d: [0.7, 1.4], h: [0.7, 0.8] },
    'coffee-table': { w: [0.4, 1.6], d: [0.4, 1.0], h: [0.3, 0.55] },
    chair: { w: [0.35, 0.6], d: [0.35, 0.65], h: [0.75, 1.1] },
    bookshelf: { w: [0.4, 3.0], d: [0.2, 0.55], h: [0.8, 2.7] },
    tv: { w: [0.5, 2.2], d: [0.02, 0.15], h: [0.3, 1.3] },
    art: { w: [0.15, 2.8], d: [0, 0.12], h: [0.15, 2.4] },
    mirror: { w: [0.2, 2.2], d: [0, 0.12], h: [0.2, 2.4] },
    plant: { h: [0.2, 2.6] },
});
/** Warm interior light of a ceiling fitting (same calibration as the room recipes). */
export function fittingLight(range, intensity = 1.2) {
    return { type: 'point', color: '#ffd7a6', intensity: Math.round(intensity * 0.45 * 100) / 100, range: Math.max(4, Math.min(24, range)), castShadow: false };
}
/** Turn an {@link ItemSpec} into an `add`-ready entity tagged `placed`. */
export function itemEntity(spec) {
    const def = spec.def;
    const size = spec.asset ? spec.asset.size : furnitureSize(def, spec.params);
    const placed = {
        kind: def.kind,
        generator: def.id,
        params: spec.params,
        x: spec.pos[0],
        y: spec.pos[1],
        z: spec.pos[2],
        yaw: spec.yaw,
        size,
        def,
        footprint: [],
        name: spec.name ?? titleCase(def.kind),
        ...(spec.light ? { light: spec.light } : {}),
        ...(spec.asset ? { asset: spec.asset.id } : {}),
    };
    const e = placedEntity(placed, spec.id, spec.levelId, spec.room, spec.level, true);
    e.tags = [...new Set([...(e.tags ?? []), 'placed'])];
    return e;
}
function titleCase(kind) {
    const s = kind.replace(/-/g, ' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
}
