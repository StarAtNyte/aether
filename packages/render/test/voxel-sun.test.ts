/**
 * The voxel terrain's sun: it follows the hour (warm and low at dusk, white and high at noon, cool and dim as
 * moonlight at night) and bumps the layer's version only when something changed.
 */
import { describe, expect, it } from 'vitest';
import { VoxelLayer } from '../src/voxel/voxel-layer';
import type { TerrainMaterials } from '../src/voxel/terrain-material';

function layer(): VoxelLayer {
  const l = new VoxelLayer();
  l.setAtlas(new Uint8Array(16 * 16 * 4).fill(200), 16, new Uint16Array(3));
  return l;
}

function uniforms(l: VoxelLayer): TerrainMaterials['uniforms'] {
  return (l as unknown as { mats: TerrainMaterials }).mats.uniforms;
}

const WHITE: [number, number, number] = [1, 1, 1];

describe('voxel sun', () => {
  it('stands high and white at noon, and is warm and low at the end of the day', () => {
    const l = layer();
    l.setLighting(1, WHITE, 12);
    const noon = { dir: uniforms(l).sunDirection.value.clone(), col: uniforms(l).sunColor.value.clone() };
    l.setLighting(0.7, WHITE, 17.6);
    const dusk = { dir: uniforms(l).sunDirection.value.clone(), col: uniforms(l).sunColor.value.clone() };
    expect(noon.dir.y).toBeGreaterThan(dusk.dir.y);
    expect(noon.dir.length()).toBeCloseTo(1, 4);
    expect(dusk.dir.length()).toBeCloseTo(1, 4);
    expect(noon.col.g / noon.col.r).toBeGreaterThan(0.9);
    // Dusk is redder: green and blue fall away faster than red.
    expect(dusk.col.b / dusk.col.r).toBeLessThan(noon.col.b / noon.col.r);
    expect(dusk.col.r).toBeLessThanOrEqual(noon.col.r);
    l.dispose();
  });

  it('is a dim cool moonlight from above the horizon at night', () => {
    const l = layer();
    l.setLighting(0, WHITE, 0);
    const u = uniforms(l);
    expect(u.sunDirection.value.y).toBeGreaterThan(0.3);
    expect(u.sunColor.value.b).toBeGreaterThan(u.sunColor.value.r);
    expect(u.sunColor.value.r).toBeLessThan(0.2);
    l.dispose();
  });

  it('bumps the version only when the light changes and ignores a missing or non-finite hour', () => {
    const l = layer();
    l.setLighting(1, WHITE, 12);
    const v = l.version;
    l.setLighting(1, WHITE, 12);
    expect(l.version).toBe(v);
    l.setLighting(1, WHITE, 14);
    expect(l.version).toBeGreaterThan(v);
    const v2 = l.version;
    l.setLighting(1, WHITE);
    l.setLighting(1, WHITE, Number.NaN);
    expect(l.version).toBe(v2);
    l.dispose();
  });
});
