/**
 * Foliage cards in the renderer: the flag resolves for opaque parts only, the material carries the
 * cut-out texture and alpha test, authored card UVs survive, and the textures are shared and disposed.
 */
import { describe, expect, it } from 'vitest';
import { DataTexture, MeshStandardMaterial } from 'three';
import { primitiveOutput } from '@aether/procgen';
import { partToBufferGeometry } from '../src/geometry/buffer-geometry';
import { FoliageTextures } from '../src/materials/foliage-textures';
import { createMaterial, MaterialCache } from '../src/materials/material-cache';
import { materialKey, resolveMaterial } from '../src/materials/presets';
import type { MeshPart } from '../src/types';

const spec = { foliage: 'broadleaf', vertexColors: true } as const;

describe('foliage materials', () => {
  it('resolve with the card kind for opaque parts, never for see-through ones, and key separately', () => {
    expect(resolveMaterial(spec, { hasVertexColors: true }).foliage).toBe('broadleaf');
    expect(resolveMaterial({ ...spec, opacity: 0.5 }, { hasVertexColors: true }).foliage).toBeNull();
    expect(resolveMaterial({ vertexColors: true }, { hasVertexColors: true }).foliage).toBeNull();
    expect(materialKey(resolveMaterial(spec, { hasVertexColors: true }))).not.toBe(materialKey(resolveMaterial({ foliage: 'needles', vertexColors: true }, { hasVertexColors: true })));
  });

  it('get the card texture, an alpha test and single-sided drawing', () => {
    const tex = new FoliageTextures();
    try {
      const m = createMaterial(resolveMaterial(spec, { hasVertexColors: true }), 'standard', undefined, undefined, false, tex);
      expect(m).toBeInstanceOf(MeshStandardMaterial);
      expect(m.map).toBeInstanceOf(DataTexture);
      expect(m.alphaTest).toBe(0.5);
      // Single-sampled post chains: coverage would dither the whole card into a stipple.
      expect(m.alphaToCoverage).toBe(false);
      expect(m.transparent).toBe(false);
      expect(m.userData['aetherFoliage']).toBe('broadleaf');
      // Without textures (a context that cannot make them) the material is plain.
      expect(createMaterial(resolveMaterial(spec, { hasVertexColors: true }), 'standard').map).toBeNull();
    } finally {
      tex.dispose();
    }
  });

  it('share one texture per kind and drop them on dispose', () => {
    const tex = new FoliageTextures();
    const a = tex.get('grass');
    expect(tex.get('grass')).toBe(a);
    expect(tex.get('fern')).not.toBe(a);
    expect(tex.count).toBe(2);
    tex.dispose();
    expect(tex.count).toBe(0);
  });

  it('a cache hands out foliage materials that share their texture', () => {
    const cache = new MaterialCache();
    try {
      const a = cache.acquire(spec, { hasVertexColors: true });
      const b = cache.acquire({ foliage: 'broadleaf', vertexColors: true, roughness: 0.5 }, { hasVertexColors: true });
      expect((a.material as MeshStandardMaterial).map).toBe((b.material as MeshStandardMaterial).map);
      expect(cache.foliage.count).toBe(1);
    } finally {
      cache.dispose();
    }
  });

  it('keep authored card UVs instead of the box projection', () => {
    const base = primitiveOutput({ kind: 'primitive', primitive: 'box', size: [1, 1, 1] }).parts[0] as MeshPart;
    const n = base.positions.length / 3;
    const uvs = new Float32Array(n * 2).map((_, i) => (i % 2 === 0 ? 0.25 : 0.75));
    const g = partToBufferGeometry({ ...base, uvs, material: { foliage: 'grass' } });
    expect(g.getAttribute('uv').array).toBe(uvs);
    const boxed = partToBufferGeometry({ ...base, uvs, material: {} });
    expect(boxed.getAttribute('uv').array).not.toBe(uvs);
  });
});
