/**
 * `furn-part`: the generator behind a drawer, cabinet door or appliance door
 * that is its own entity. Its params name the piece it belongs to (`of`), the
 * part (`part`, e.g. "drawer-0") and the piece's own params (`p`), so the
 * part regenerates from the same recipe as its carcass and follows a
 * re-styled piece ("walnut kitchen") without any extra bookkeeping.
 */
import { isForbiddenKey } from '@aether/core';
import { buildFurniturePart, furnitureById, resolveSpec } from './index';
const PART_ID = /^[a-z][a-z0-9-]{0,31}$/;
/** Validate untrusted `furn-part` params (throws a readable error). */
export function parsePartParams(params) {
    const of = params['of'];
    const part = params['part'];
    if (typeof of !== 'string' || of.length > 40 || isForbiddenKey(of))
        throw new Error('furn-part: "of" must be a furniture generator id');
    const def = furnitureById(of);
    if (!def || !def.interactive)
        throw new Error(`furn-part: "${of.slice(0, 40)}" has no movable parts`);
    if (typeof part !== 'string' || !PART_ID.test(part))
        throw new Error('furn-part: "part" must be a part id such as "drawer-0"');
    const raw = params['p'];
    const given = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const sz = params['size'];
    const size = Array.isArray(sz) && sz.length === 3 && sz.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 20) ? [sz[0], sz[1], sz[2]] : [0.5, 0.5, 0.02];
    return { of, part, p: resolveSpec(def.params, given), size };
}
/** Build the geometry of a part (empty when the piece has no such part). */
export function buildPart(params, seed) {
    const r = parsePartParams(params);
    const def = furnitureById(r.of);
    const out = def ? buildFurniturePart(def, r.p, seed, r.part) : null;
    return out ?? { parts: [], colliders: [] };
}
