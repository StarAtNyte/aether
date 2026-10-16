/** Wording that asks for a realistic look. */
export const REALISTIC_RE = /\b(?:realistic(?:ally)?|photo-?realistic|photoreal|life-?like|true[- ]to[- ]life|naturalistic)\b/i;
function num(v, fallback) {
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function copy(p, keys) {
    const out = {};
    for (const k of keys)
        if (p[k] !== undefined)
            out[k] = p[k];
    return out;
}
/** The realistic stand-in for a stylised generator, or null when there is none. */
export function realisticStandIn(generator, params) {
    switch (generator) {
        case 'tree-oak':
            return { generator: 'tree-broadleaf', params: { ...copy(params, ['color', 'trunkColor']), height: Math.max(6, num(params['height'], 6) * 1.5), variant: Math.min(2, Math.max(0, Math.round(num(params['variant'], 2)))) } };
        case 'hero-cherry-tree':
            // Cherry blossom: a wide broadleaf crown in blossom pink on a dark, twisting trunk.
            return { generator: 'tree-broadleaf', params: { color: typeof params['blossomColor'] === 'string' ? params['blossomColor'] : '#f1a9c0', trunkColor: typeof params['barkColor'] === 'string' ? params['barkColor'] : '#3b2a24', height: Math.max(5, num(params['height'], 5.5) * 1.35), variant: 2, blossom: 1 } };
        case 'tree-pine':
            return { generator: 'tree-spruce', params: { ...copy(params, ['color', 'trunkColor']), height: Math.max(8, num(params['height'], 7) * 1.6), snow: params['snow'] === true ? 0.8 : 0 } };
        case 'bush':
            return { generator: 'shrub', params: { ...copy(params, ['color']), size: num(params['size'], 1.2) } };
        case 'flowers':
            return { generator: 'wildflowers', params: { ...copy(params, ['color']), size: num(params['size'], 0.6) * 0.8 } };
        case 'grass-tuft':
            return { generator: 'meadow-grass', params: { ...copy(params, ['color']), size: num(params['size'], 0.5) } };
        case 'rock':
            return { generator: 'boulder', params: { ...copy(params, ['color']), size: num(params['size'], 1.5), lichen: params['mossy'] === true ? 0.6 : 0.15, variant: Math.min(2, Math.max(0, Math.round(num(params['variant'], 0)))) } };
        default:
            return null;
    }
}
function swapShape(shape) {
    let n = 0;
    if (shape.kind === 'scatter' && typeof shape.of === 'object' && shape.of !== null)
        n += swapShape(shape.of);
    if (shape.kind === 'procedural' && typeof shape.generator === 'string') {
        const params = typeof shape.params === 'object' && shape.params !== null && !Array.isArray(shape.params) ? shape.params : {};
        const stand = realisticStandIn(shape.generator, params);
        if (stand) {
            shape.generator = stand.generator;
            shape.params = stand.params;
            n++;
        }
    }
    return n;
}
/** Exchange the stylised nature parts of a plan for realistic ones (in place); returns how many shapes changed. */
export function makeRealistic(patches) {
    let n = 0;
    for (const p of patches) {
        if (p.op === 'add' && p.entity && typeof p.entity === 'object') {
            const shape = p.entity.shape;
            if (shape)
                n += swapShape(shape);
        }
    }
    return n;
}
/** Apply the realistic exchange to a plan when the request asks for it. */
export function realisticPlan(request, plan) {
    if (!REALISTIC_RE.test(request) || plan.patches.length === 0)
        return plan;
    const patches = structuredClone(plan.patches);
    const changed = makeRealistic(patches);
    if (changed === 0)
        return plan;
    return { ...plan, patches, plan: `${plan.plan} Realistic look: ${changed} stylised nature parts exchanged for realistic vegetation.`.trim() };
}
