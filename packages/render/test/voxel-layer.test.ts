import { describe, expect, it } from 'vitest';
import { Color } from 'three';
import { VoxelLayer } from '../src/voxel/voxel-layer';

const ATLAS = 16;

function layerWithAtlas(): VoxelLayer {
  const layer = new VoxelLayer();
  layer.setAtlas(new Uint8Array(ATLAS * ATLAS * 4).fill(200), ATLAS, new Uint16Array(3));
  return layer;
}

describe('VoxelLayer terrain fog', () => {
  it('sets the fog uniforms and bumps the version only on change', () => {
    const layer = layerWithAtlas();
    const fog = new Color(0.5, 0.6, 0.7);
    const v0 = layer.version;
    layer.setFog(fog, 64, 128, 0);
    const v1 = layer.version;
    expect(v1).toBeGreaterThan(v0);
    layer.setFog(fog, 64, 128, 0);
    expect(layer.version).toBe(v1);
    layer.setFogOrigin(10, -4);
    const v2 = layer.version;
    expect(v2).toBeGreaterThan(v1);
    layer.setFogOrigin(10, -4);
    expect(layer.version).toBe(v2);
    layer.dispose();
  });

  it('rejects non-finite values (the fade stays well-formed)', () => {
    const layer = layerWithAtlas();
    const v = layer.version;
    layer.setFogOrigin(Number.NaN, 0);
    expect(layer.version).toBe(v);
    // far ≤ near or NaN: clamped to a valid fade instead of a division by zero in the shader.
    expect(() => layer.setFog(new Color(), 50, Number.NaN, Number.POSITIVE_INFINITY)).not.toThrow();
    layer.dispose();
  });

  it('ignores fog before the atlas (no materials yet)', () => {
    const layer = new VoxelLayer();
    const v = layer.version;
    layer.setFog(new Color(), 1, 2, 0);
    layer.setFogOrigin(1, 2);
    expect(layer.version).toBe(v);
    layer.dispose();
  });
});
