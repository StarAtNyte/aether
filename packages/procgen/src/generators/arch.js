import { FURNITURE, buildPart, parsePartParams, STRUCTURE_DESCRIPTIONS, STRUCTURE_IDS, buildFurniture, buildStructure, parseStructureParams } from '@aether/arch';
function now() {
    return typeof performance !== 'undefined' ? performance.now() : 0;
}
/** Convert arch output to a generator output (bounds + triangle count computed). */
export function archToOutput(out, ms) {
    const parts = [];
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    let triangles = 0;
    for (const p of out.parts) {
        if (p.indices.length === 0)
            continue;
        parts.push({ positions: p.positions, normals: p.normals, indices: p.indices, uvs: p.uvs, material: p.material });
        triangles += p.indices.length / 3;
        for (let k = 0; k < p.positions.length; k += 3) {
            for (let a = 0; a < 3; a++) {
                const v = p.positions[k + a];
                if (v < min[a])
                    min[a] = v;
                if (v > max[a])
                    max[a] = v;
            }
        }
    }
    const bounds = parts.length > 0 ? { min, max } : { min: [0, 0, 0], max: [0, 0, 0] };
    const colliders = out.colliders.map((c) => {
        if (c.kind === 'box')
            return c.rotation ? { kind: 'box', halfExtents: c.halfExtents, offset: c.offset, rotation: c.rotation } : { kind: 'box', halfExtents: c.halfExtents, offset: c.offset };
        if (c.kind === 'hull')
            return { kind: 'hull', points: c.points, offset: c.offset };
        return { kind: 'trimesh', positions: c.positions, indices: c.indices };
    });
    return { parts, colliders, bounds, stats: { triangles, ms } };
}
/** Catalogue param hints for structural generators (the full schema is zod-validated). */
const STRUCTURE_HINTS = {
    'arch-wall': { length: { type: 'number', default: 4, min: 0.05, max: 80, description: 'length along +X (m); also openings[], finishA/finishB, thickness, height' } },
    'arch-slab': { thickness: { type: 'number', default: 0.2, min: 0.01, max: 5, description: 'polygon [[x,z]…] required; holes, finish' } },
    'arch-ceiling': { cove: { type: 'number', default: 0, min: 0, max: 0.4, description: 'polygon [[x,z]…] required' } },
    'arch-roof': { width: { type: 'number', default: 10, min: 0.5, max: 200, description: 'footprint X' }, depth: { type: 'number', default: 8, min: 0.5, max: 200, description: 'footprint Z' }, shape: { type: 'enum', default: 'gable', options: ['flat', 'gable', 'hip', 'shed'], description: 'roof form' } },
    'arch-stair': { rise: { type: 'number', default: 3, min: 0.2, max: 30, description: 'floor-to-floor height' }, shape: { type: 'enum', default: 'straight', options: ['straight', 'l', 'u'], description: 'layout' } },
    'arch-door': { width: { type: 'number', default: 0.9, min: 0.4, max: 4, description: 'leaf width' }, style: { type: 'enum', default: 'panel', options: ['panel', 'flush', 'glass', 'slab'], description: 'leaf style' } },
    'arch-frame': { width: { type: 'number', default: 0.9, min: 0.4, max: 12, description: 'opening width' }, height: { type: 'number', default: 2.1, min: 0.4, max: 30, description: 'opening height' } },
    'arch-window': { width: { type: 'number', default: 1.2, min: 0.3, max: 12, description: 'width' }, height: { type: 'number', default: 1.4, min: 0.3, max: 10, description: 'height' } },
    'arch-sash': { width: { type: 'number', default: 1, min: 0.2, max: 3, description: 'casement width' }, height: { type: 'number', default: 1.2, min: 0.2, max: 3, description: 'casement height' } },
    'arch-railing': { height: { type: 'number', default: 1.05, min: 0.3, max: 2, description: 'points [[x,z]…] required' } },
    'arch-column': { size: { type: 'number', default: 0.3, min: 0.05, max: 3, description: 'diameter / side' }, height: { type: 'number', default: 2.8, min: 0.2, max: 30, description: 'height' } },
    'arch-basin': { width: { type: 'number', default: 8, min: 0.5, max: 60, description: 'pool X' }, length: { type: 'number', default: 4, min: 0.5, max: 60, description: 'pool Z' } },
};
function structural(id) {
    return {
        id,
        description: STRUCTURE_DESCRIPTIONS[id],
        category: 'architecture',
        params: STRUCTURE_HINTS[id],
        resolve: (params) => parseStructureParams(id, params),
        generate(params) {
            const t0 = now();
            return archToOutput(buildStructure(id, params), now() - t0);
        },
    };
}
/** Structural generators. */
export const ARCH_STRUCTURE_GENERATORS = STRUCTURE_IDS.map(structural);
/** Furniture generators. */
export const ARCH_FURNITURE_GENERATORS = FURNITURE.map((def) => ({
    id: def.id,
    description: def.description,
    category: 'interior',
    params: def.params,
    generate(params, api) {
        const t0 = now();
        return archToOutput(buildFurniture(def, params, api.seed), now() - t0);
    },
}));
/** A drawer, cabinet door or appliance door of an interactive piece (own entity so it can open). */
export const FURN_PART_GENERATOR = {
    id: 'furn-part',
    description: 'One openable part (drawer, cabinet door, fridge door) of an interactive furniture piece; params: of (furn-* id), part (e.g. "drawer-0"), p (the piece params), size.',
    category: 'interior',
    params: { part: { type: 'enum', default: 'drawer-0', options: ['drawer-0'], description: 'part id within the piece (see the piece entity children)' } },
    resolve: (params) => {
        const r = parsePartParams(params);
        return { of: r.of, part: r.part, p: r.p, size: r.size };
    },
    generate(params, api) {
        const t0 = now();
        return archToOutput(buildPart(params, api.seed), now() - t0);
    },
};
