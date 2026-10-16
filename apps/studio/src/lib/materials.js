/**
 * Material library shown in the Assets panel and the inspector: every
 * preset plus a few styled combinations. Each entry is a plain
 * `MaterialSpec` (validated again when dropped from a drag payload).
 */
import { MaterialSpec, inspectUntrusted } from '@aether/core';
import { MATERIAL_PRESETS } from '@aether/render';
const titled = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/** The material library, presets first. */
export const MATERIAL_LIBRARY = Object.freeze([
    ...Object.keys(MATERIAL_PRESETS).map((preset) => ({
        id: preset,
        name: titled(preset),
        spec: { preset },
        swatch: MATERIAL_PRESETS[preset].color,
        ...(preset === 'neon' || preset === 'emissive' || preset === 'lava' ? { glow: true } : {}),
    })),
    { id: 'brushed-steel', name: 'Brushed steel', spec: { preset: 'metal', color: '#b8bec6', roughness: 0.35, metalness: 1 }, swatch: '#b8bec6' },
    { id: 'copper', name: 'Copper', spec: { preset: 'metal', color: '#c27a4a', roughness: 0.3, metalness: 1 }, swatch: '#c27a4a' },
    { id: 'neon-pink', name: 'Neon pink', spec: { preset: 'neon', color: '#ff3fb4' }, swatch: '#ff3fb4', glow: true },
    { id: 'neon-cyan', name: 'Neon cyan', spec: { preset: 'neon', color: '#3ff0ff' }, swatch: '#3ff0ff', glow: true },
    { id: 'frosted-glass', name: 'Frosted glass', spec: { preset: 'glass', roughness: 0.6, opacity: 0.6 }, swatch: '#dfe9f2' },
    { id: 'matte-black', name: 'Matte black', spec: { preset: 'plastic', color: '#1d1f24', roughness: 0.9 }, swatch: '#1d1f24' },
    { id: 'clay', name: 'Clay', spec: { preset: 'plastic', color: '#c98b6b', roughness: 1 }, swatch: '#c98b6b' },
]);
/** Drag-and-drop MIME type of library materials. */
export const MATERIAL_DRAG_TYPE = 'application/x-aether-material';
/** Drag payload of a library material. */
export function materialDragData(m) {
    return JSON.stringify({ name: m.name, spec: m.spec });
}
/** Parse an (untrusted) material drag payload; null when invalid. */
export function parseMaterialDrag(text) {
    if (typeof text !== 'string' || text.length === 0 || text.length > 4096)
        return null;
    let value;
    try {
        value = JSON.parse(text);
    }
    catch {
        return null;
    }
    if (!inspectUntrusted(value, { maxDepth: 4, maxNodes: 64, maxStringLength: 120 }).ok || typeof value !== 'object' || value === null)
        return null;
    const v = value;
    const spec = MaterialSpec.safeParse(v['spec']);
    const name = typeof v['name'] === 'string' ? v['name'].slice(0, 60) : 'material';
    return spec.success ? { name, spec: spec.data } : null;
}
