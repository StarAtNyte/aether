/**
 * Layered terrain in the renderer: the geometry gets a four-component
 * `splat` attribute, the material resolves with `splat` only when it can be
 * drawn layered, and the node material builds from the finish maps.
 */
import { describe, expect, it } from 'vitest';
import { MeshStandardMaterial } from 'three';
import { primitiveOutput } from '@aether/procgen';
import { partToBufferGeometry } from '../src/geometry/buffer-geometry';
import { createMaterial, MaterialCache } from '../src/materials/material-cache';
import { FinishTextures } from '../src/materials/finish-textures';
import { materialKey, resolveMaterial } from '../src/materials/presets';
import { SPLAT_KEY, SPLAT_LAYERS } from '../src/materials/terrain-splat';
function boxPart() {
    return primitiveOutput({ kind: 'primitive', primitive: 'box', size: [2, 1, 1] }).parts[0];
}
describe('terrain layer weights in the geometry', () => {
    it('become a four-component splat attribute when the material asks for layering', () => {
        const part = boxPart();
        const vc = part.positions.length / 3;
        const splat = new Float32Array(vc * 4).fill(0.25);
        const g = partToBufferGeometry({ ...part, material: { splat: true, vertexColors: true }, splat });
        expect(g.getAttribute('splat').itemSize).toBe(4);
        expect(g.getAttribute('splat').array).toBe(splat);
    });
    it('are plain grass when the part asks for layering without weights, and absent otherwise', () => {
        const part = boxPart();
        const vc = part.positions.length / 3;
        const g = partToBufferGeometry({ ...part, material: { splat: true } });
        const a = g.getAttribute('splat').array;
        expect(a.length).toBe(vc * 4);
        expect([a[0], a[1], a[2], a[3]]).toEqual([1, 0, 0, 0]);
        expect(partToBufferGeometry({ ...part, splat: new Float32Array(vc * 4) }).getAttribute('splat')).toBeUndefined();
    });
});
describe('layered terrain materials', () => {
    const spec = { preset: 'grass', vertexColors: true, splat: true };
    it('resolve with splat only for opaque, vertex-coloured parts that have weights', () => {
        expect(resolveMaterial(spec, { hasVertexColors: true }).splat).toBe(true);
        expect(resolveMaterial(spec, { hasVertexColors: true }).finish).toBeNull();
        expect(resolveMaterial(spec, { hasVertexColors: false }).splat).toBe(false);
        expect(resolveMaterial(spec, { hasVertexColors: true, hasSplat: false }).splat).toBe(false);
        expect(resolveMaterial({ ...spec, opacity: 0.5 }, { hasVertexColors: true }).splat).toBe(false);
        expect(resolveMaterial({ preset: 'grass' }, { hasVertexColors: true }).splat).toBe(false);
        // Without layering a grass preset still gets its photographed detail.
        expect(resolveMaterial({ preset: 'grass' }, {}).finish).toBe('grass');
    });
    it('get their own cache key', () => {
        const a = resolveMaterial(spec, { hasVertexColors: true });
        const b = resolveMaterial({ preset: 'grass', vertexColors: true }, { hasVertexColors: true });
        expect(materialKey(a)).not.toBe(materialKey(b));
    });
    it('build as a node material over the four layer finishes, and stay plain without finishes', () => {
        const finishes = new FinishTextures();
        try {
            const m = createMaterial(resolveMaterial(spec, { hasVertexColors: true }), 'standard', undefined, finishes);
            expect(m).toBeInstanceOf(MeshStandardMaterial);
            expect(m.userData[SPLAT_KEY]).toBe(true);
            expect(m.colorNode).toBeDefined();
            expect(m.normalNode).toBeDefined();
            expect(finishes.count).toBe(SPLAT_LAYERS.length);
            const plain = createMaterial(resolveMaterial(spec, { hasVertexColors: true }), 'standard');
            expect(plain.userData[SPLAT_KEY]).toBeUndefined();
        }
        finally {
            finishes.dispose();
        }
    });
    it('stay plain (vertex colours) when layering is switched off, as on software rasterisers', () => {
        const finishes = new FinishTextures();
        try {
            const m = createMaterial(resolveMaterial(spec, { hasVertexColors: true }), 'standard', undefined, finishes, false, undefined, false);
            expect(m.userData[SPLAT_KEY]).toBeUndefined();
            expect(finishes.count).toBe(0);
        }
        finally {
            finishes.dispose();
        }
    });
    it('are switched off by the cache setting', () => {
        const cache = new MaterialCache();
        try {
            cache.layeredTerrain = false;
            const plain = cache.acquire(spec, { hasVertexColors: true });
            expect(plain.material.userData[SPLAT_KEY]).toBeUndefined();
        }
        finally {
            cache.dispose();
        }
    });
    it('uses the four finishes in weight order: grass, rock, soil, snow', () => {
        expect([...SPLAT_LAYERS]).toEqual(['grass', 'rock', 'soil', 'snow']);
    });
});
