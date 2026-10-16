import { assetShapeSize, catalogEntry, getCatalog } from '@aether/assets';
import { furnitureById, furnitureByKind, furnitureSize } from './index';
/**
 * Library models per furniture kind, in order of preference (realistic,
 * real-world sized), each with the building styles it suits — a carved
 * classic sofa would clash with a modern flat, so modern styles keep the
 * parametric piece there.
 */
export const FURNITURE_ASSETS = {
    sofa: [{ id: 'sofa-classic', styles: ['classic'] }],
    armchair: [{ id: 'armchair-classic', styles: ['classic'] }],
    'coffee-table': [{ id: 'coffee-table-round', styles: ['modern', 'scandinavian', 'japandi', 'classic', 'industrial'] }],
    nightstand: [{ id: 'nightstand-classic', styles: ['classic'] }],
    pendant: [{ id: 'pendant-lamp', styles: ['modern', 'scandinavian', 'industrial', 'japandi'] }],
};
/** The library model a layout should use for a kind in a style, or null (catalog not loaded, or none fits). */
export function furnitureAsset(kind, style = 'modern') {
    if (!getCatalog())
        return null;
    for (const opt of FURNITURE_ASSETS[kind] ?? []) {
        if (!opt.styles.includes(style))
            continue;
        const e = catalogEntry(opt.id);
        if (e && e.kind === 'model')
            return { id: opt.id, size: [e.size[0], e.size[1], e.size[2]] };
    }
    return null;
}
/** Furniture semantics of an entity: its definition (from the generator or the asset's fallback) and size. */
export function furnitureOfEntity(e) {
    const s = e.shape;
    if (s.kind === 'procedural') {
        const def = furnitureById(s.generator);
        return def ? { def, size: furnitureSize(def, s.params), params: s.params } : null;
    }
    if (s.kind === 'asset') {
        const fb = s.fallback?.kind === 'procedural' ? s.fallback : null;
        const def = (fb ? furnitureById(fb.generator) : undefined) ?? (e.arch?.kind ? furnitureByKind(e.arch.kind) : undefined);
        if (!def)
            return null;
        const size = assetShapeSize(s) ?? furnitureSize(def, fb?.params);
        return { def, size, params: fb?.params ?? {} };
    }
    return null;
}
