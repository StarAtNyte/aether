import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { MaterialCache } from '../src/materials/material-cache';
import { buildExportScene } from '../src/view/gltf-export';
function exportedMaterial(cache, spec) {
    const content = new Group();
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), cache.acquire(spec).material);
    content.add(mesh);
    const scene = buildExportScene(content, null);
    const out = scene.root.children[0].material;
    scene.dispose();
    return out;
}
describe('glTF export of finish materials', () => {
    it('writes the textures of anti-tiled finishes, which bind no classic maps (regression: they exported as flat colour)', () => {
        const cache = new MaterialCache();
        const rock = cache.acquire({ finish: 'rock' }).material;
        expect(rock.map).toBeNull();
        const out = exportedMaterial(cache, { finish: 'rock' });
        expect(out.map).not.toBeNull();
        expect(out.normalMap).not.toBeNull();
        expect(out.roughnessMap).not.toBeNull();
        cache.dispose();
    });
    it('still writes the maps of finishes that bind them', () => {
        const cache = new MaterialCache();
        const out = exportedMaterial(cache, { finish: 'oak' });
        expect(out.map).not.toBeNull();
        expect(out.normalMap).not.toBeNull();
        cache.dispose();
    });
    it('exports plain materials without maps', () => {
        const cache = new MaterialCache();
        const out = exportedMaterial(cache, { preset: 'plastic' });
        expect(out.map).toBeNull();
        cache.dispose();
    });
});
