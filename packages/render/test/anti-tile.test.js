import { describe, expect, it } from 'vitest';
import { MaterialCache } from '../src/materials/material-cache';
import { needsAntiTile } from '../src/materials/anti-tile';
describe('anti-tiling', () => {
    it('large-tile finishes get blended lookups for colour, roughness, occlusion and normals; small ones do not', () => {
        const cache = new MaterialCache();
        const floor = cache.acquire({ finish: 'concrete' }).material;
        expect(floor.colorNode).toBeTruthy();
        expect(floor.roughnessNode).toBeTruthy();
        expect(floor.aoNode).toBeTruthy();
        expect(floor.normalNode).toBeTruthy();
        // Patterned finishes (planks, brick, tiles) keep a single lookup: two shifted copies would only ghost.
        for (const finish of ['oak', 'brick', 'tile', 'marble'])
            expect(cache.acquire({ finish }).material.colorNode ?? null, finish).toBeNull();
        // A 0.5 m weave repeats too finely to show a pattern.
        const fabric = cache.acquire({ finish: 'fabric' }).material;
        expect(fabric.colorNode ?? null).toBeNull();
        // Presets with photographed detail follow their finish's tile size.
        const lawn = cache.acquire({ preset: 'grass' }).material;
        expect(lawn.colorNode).toBeTruthy();
        const plain = cache.acquire({ preset: 'plastic' }).material;
        expect(plain.colorNode ?? null).toBeNull();
        cache.dispose();
    });
    it('can be switched off for materials created afterwards (software rasterisers, low memory)', () => {
        const cache = new MaterialCache();
        cache.antiTile = false;
        const floor = cache.acquire({ finish: 'concrete' }).material;
        expect(floor.colorNode ?? null).toBeNull();
        expect(floor.map).not.toBeNull();
        expect(floor.userData['aetherFinish']).toBeUndefined();
        cache.antiTile = true;
        const wall = cache.acquire({ finish: 'plaster' }).material;
        expect(wall.colorNode).toBeTruthy();
        cache.dispose();
    });
    it('samples the maps with nodes instead of binding them, and marks the material so live colour updates keep the finish scale', () => {
        const cache = new MaterialCache();
        const m = cache.acquire({ finish: 'rock' }).material;
        expect(m.map).toBeNull();
        expect(m.normalMap).toBeNull();
        expect(m.aoMap).toBeNull();
        expect(m.roughnessMap).toBeNull();
        expect(m.userData['aetherFinish']).toBe('rock');
        const oak = cache.acquire({ finish: 'oak' }).material;
        expect(oak.map).not.toBeNull();
        const plain = cache.acquire({ finish: 'fabric' }).material;
        expect(plain.map).not.toBeNull();
        expect(plain.userData['aetherFinish']).toBeUndefined();
        cache.dispose();
    });
    it('decides by finish and tile size', () => {
        expect(needsAntiTile('concrete', 3)).toBe(true);
        expect(needsAntiTile('grass', 0.9)).toBe(true);
        expect(needsAntiTile('grass', 0.5)).toBe(false);
        expect(needsAntiTile('grass', Number.NaN)).toBe(false);
        expect(needsAntiTile('brick', 3)).toBe(false);
        expect(needsAntiTile('oak', 3)).toBe(false);
    });
});
