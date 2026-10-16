import { STRUCTURE_SCHEMAS } from './params';
import { buildWall } from './wall';
import { buildBasin, buildCeiling, buildColumn, buildRailing, buildSlab } from './elements';
import { buildRoof } from './roof';
import { buildStair } from './stair';
import { buildDoor, buildFrame, buildSash, buildWindow } from './openings';
/** Ids of the structural generators. */
export const STRUCTURE_IDS = Object.freeze(Object.keys(STRUCTURE_SCHEMAS));
/** True when `id` names a structural generator. */
export function isStructureId(id) {
    return Object.hasOwn(STRUCTURE_SCHEMAS, id);
}
/** Validation error of structural params (message lists the first issues). */
export class ArchParamsError extends Error {
    name = 'ArchParamsError';
}
function parseWith(id, schema, params) {
    const res = schema.safeParse(params ?? {});
    if (!res.success) {
        const issues = res.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
        throw new ArchParamsError(`${id} params invalid: ${issues}`);
    }
    return res.data;
}
/**
 * Parse params for a structural generator (defaults applied, plain JSON
 * out). Throws {@link ArchParamsError} for invalid params.
 */
export function parseStructureParams(id, params) {
    return parseWith(id, STRUCTURE_SCHEMAS[id], params);
}
/** Build a structural element from raw params (validated here). */
export function buildStructure(id, params) {
    const S = STRUCTURE_SCHEMAS;
    switch (id) {
        case 'arch-wall':
            return buildWall(parseWith(id, S[id], params));
        case 'arch-slab':
            return buildSlab(parseWith(id, S[id], params));
        case 'arch-ceiling':
            return buildCeiling(parseWith(id, S[id], params));
        case 'arch-roof':
            return buildRoof(parseWith(id, S[id], params));
        case 'arch-stair':
            return buildStair(parseWith(id, S[id], params));
        case 'arch-door':
            return buildDoor(parseWith(id, S[id], params));
        case 'arch-frame':
            return buildFrame(parseWith(id, S[id], params));
        case 'arch-window':
            return buildWindow(parseWith(id, S[id], params));
        case 'arch-sash':
            return buildSash(parseWith(id, S[id], params));
        case 'arch-railing':
            return buildRailing(parseWith(id, S[id], params));
        case 'arch-column':
            return buildColumn(parseWith(id, S[id], params));
        case 'arch-basin':
            return buildBasin(parseWith(id, S[id], params));
    }
}
/** One-line descriptions (catalogue / docs). */
export const STRUCTURE_DESCRIPTIONS = Object.freeze({
    'arch-wall': 'Straight wall along +X with openings (doors / windows), mitred joins, per-side finishes and skirting.',
    'arch-slab': 'Floor slab from a plan polygon (holes for stairwells / pools); top at y = 0.',
    'arch-ceiling': 'Ceiling surface from a plan polygon, facing down at y = 0, optional cove.',
    'arch-roof': 'Roof over a rectangular footprint: flat (parapet), gable, hip or shed.',
    'arch-stair': 'Straight, L or U stair ascending along +X with treads, soffit and handrails.',
    'arch-door': 'Door leaf (panel, flush, glass, slab) with lever handles and hinges.',
    'arch-frame': 'Door frame: jamb linings and architraves on both faces.',
    'arch-window': 'Window: frame, mullions, sashes, glass, interior sill and drip sill.',
    'arch-sash': 'Opening casement of a window: frame, glass and handle; swings on its left edge.',
    'arch-railing': 'Railing along a plan polyline (glass, bars, cable or solid).',
    'arch-column': 'Round or square column.',
    'arch-basin': 'Swimming pool basin recessed below y = 0 with coping and water.',
});
