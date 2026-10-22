/**
 * Project texture sets in the renderer: the material resolves the reference, binds neutral maps at once, fills them when the
 * registry has the files, retiles to the set's size, honours a tile override and a piece's skins.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { clearTextureSets, registerTextureSet } from '@aether/assets';
import { MaterialCache } from '../src/materials/material-cache';
import { FinishTextures, type PixelLoader } from '../src/materials/finish-textures';
import { mergeMaterial, resolveMaterial, skinned } from '../src/materials/presets';
import { tick } from './helpers';

const ID = 'tex-0123456789ab';
const def = { name: 'linen', provenance: 'photographed' as const, tile: 0.8, tiers: [256 as const], albedoScale: 2.5, mean: '#e0d8c8' };
const files = { albedo: '/t/a.webp', orm: '/t/o.webp', normal: '/t/n.webp' };
const loader: PixelLoader = async (url, size) => new Uint8Array(size * size * 4).fill(url.includes('/a.') ? 90 : url.includes('/o.') ? 140 : 128);

afterEach(() => clearTextureSets());

describe('texture sets in materials', () => {
  it('resolve only on opaque finishes and enter the cache key', () => {
    const a = resolveMaterial({ finish: 'fabric', color: '#ffffff', texture: { id: ID } });
    const b = resolveMaterial({ finish: 'fabric', color: '#ffffff' });
    expect(a.texture?.id).toBe(ID);
    expect(b.texture).toBeUndefined();
    expect(resolveMaterial({ preset: 'plastic', texture: { id: ID } }).texture).toBeUndefined();
    expect(resolveMaterial({ finish: 'glass', texture: { id: ID } }).texture).toBeUndefined();
  });

  it('skins match finish and colour, the colour key first', () => {
    const skins = { fabric: { id: ID }, 'fabric#f7f4ee': { id: 'tex-aaaaaaaaaaaa' } };
    expect(skinned({ finish: 'fabric', color: '#F7F4EE' }, skins).texture?.id).toBe('tex-aaaaaaaaaaaa');
    expect(skinned({ finish: 'fabric', color: '#112233' }, skins).texture?.id).toBe(ID);
    expect(skinned({ finish: 'oak' }, skins).texture).toBeUndefined();
    expect(mergeMaterial({ finish: 'fabric', color: '#112233' }, undefined, 3, skins).texture?.id).toBe(ID);
  });

  it('bind neutral maps at once, then the set pixels and tile size', async () => {
    const cache = new MaterialCache();
    cache.finishes.configure({ size: 16 });
    cache.finishes.usePhotos(null, loader);
    const h = cache.acquire({ finish: 'fabric', color: '#cccccc', texture: { id: ID } });
    const m = h.material as import('three').MeshStandardMaterial;
    expect(m.map).not.toBeNull();
    expect(m.userData['aetherTexture']).toBe(ID);
    const before = (m.map?.image as { data: Uint8Array }).data[0];
    // Nothing registered yet: still neutral.
    await tick(5);
    expect((m.map?.image as { data: Uint8Array }).data[0]).toBe(before);
    registerTextureSet({ id: ID, def, tiers: { 256: files } });
    await tick(10);
    expect((m.map?.image as { data: Uint8Array }).data[0]).toBe(90);
    expect(m.map?.repeat.x).toBeCloseTo(1 / 0.8, 6);
    cache.dispose();
  });

  it('a tile override clones the maps with their own repeat', async () => {
    const ft = new FinishTextures();
    ft.configure({ size: 16 });
    ft.usePhotos(null, loader);
    registerTextureSet({ id: ID, def, tiers: { 256: files } });
    const base = ft.getSet(ID);
    const big = ft.getSet(ID, 2);
    await tick(10);
    expect(base.map.repeat.x).toBeCloseTo(1 / 0.8, 6);
    expect(big.map.repeat.x).toBeCloseTo(0.5, 6);
    expect(big.map).not.toBe(base.map);
    ft.dispose();
  });
});
