import { describe, expect, it } from 'vitest';
import type { MeshStandardMaterial } from 'three';
import { MATERIAL_PRESETS, resolveMaterial } from '../src/materials/presets';
import { MaterialCache } from '../src/materials/material-cache';

describe('photographed detail under presets', () => {
  it('natural presets keep their art-directed colour but get a finish for the surface structure', () => {
    for (const [preset, finish] of [['grass', 'grass'], ['dirt', 'soil'], ['stone', 'rock'], ['bark', 'bark'], ['snow', 'snow'], ['sand', 'sand'], ['wood', 'oak']] as const) {
      const r = resolveMaterial({ preset });
      expect(r.finish, preset).toBe(finish);
      expect(r.color, preset).toBe(MATERIAL_PRESETS[preset].color);
      expect(r.roughness, preset).toBe(MATERIAL_PRESETS[preset].roughness);
    }
  });

  it('plain, emissive, glass-like and unnamed materials stay plain; an explicit finish wins', () => {
    for (const preset of ['plastic', 'glass', 'neon', 'lava', 'leaf', 'metal', 'water'] as const) expect(resolveMaterial({ preset }).finish, preset).toBeNull();
    expect(resolveMaterial(undefined).finish).toBeNull();
    expect(resolveMaterial({ preset: 'stone', opacity: 0.4 }).finish).toBeNull();
    expect(resolveMaterial({ preset: 'stone', finish: 'marble' }).finish).toBe('marble');
  });

  it('binds albedo, normal and occlusion maps for a detailed preset (or samples them with nodes) and none for a plain one', () => {
    const cache = new MaterialCache();
    cache.antiTile = false;
    const grass = cache.acquire({ preset: 'grass' }).material as MeshStandardMaterial;
    expect(grass.map).not.toBeNull();
    expect(grass.normalMap).not.toBeNull();
    expect(grass.aoMap).not.toBeNull();
    cache.antiTile = true;
    const lawn = cache.acquire({ preset: 'grass', color: '#4a7a30' }).material as MeshStandardMaterial;
    expect(lawn.map).toBeNull();
    expect(lawn.userData['aetherFinish']).toBe('grass');
    const plastic = cache.acquire({ preset: 'plastic' }).material as MeshStandardMaterial;
    expect(plastic.map).toBeNull();
    expect(plastic.userData['aetherFinish']).toBeUndefined();
    cache.dispose();
  });
});
