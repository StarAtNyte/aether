/**
 * Terrain photographs packed as texture arrays: layers hold the pixels of their finishes, follow later updates, and
 * the layered terrain material draws through the stack.
 */
import { describe, expect, it } from 'vitest';
import { FinishTextures } from '../src/materials/finish-textures';
import { SPLAT_LAYERS } from '../src/materials/terrain-splat';
import { createMaterial } from '../src/materials/material-cache';
import { resolveMaterial } from '../src/materials/presets';

describe('splat arrays', () => {
  it('pack one layer per finish and share one stack per list', () => {
    const f = new FinishTextures();
    f.configure({ size: 32 });
    const a = f.stack(SPLAT_LAYERS);
    expect(a.layers).toBe(4);
    expect(f.stack(SPLAT_LAYERS)).toBe(a);
    const stride = 32 * 32 * 4;
    expect((a.map.image as { depth: number }).depth).toBe(4);
    expect((a.map.image.data as Uint8Array).length).toBe(stride * 4);
    // The neutral placeholder pixels of each finish are in its layer.
    for (let i = 0; i < 4; i++) {
      const src = (f.get(SPLAT_LAYERS[i] as (typeof SPLAT_LAYERS)[number]).map.image as { data: Uint8Array }).data;
      expect((a.map.image.data as Uint8Array).slice(i * stride, i * stride + 8)).toEqual(src.slice(0, 8));
    }
    f.dispose();
  });

  it('follow the pixels a finish gets later', async () => {
    const f = new FinishTextures();
    f.configure({ size: 16, synth: async (_id, size) => ({ size, albedo: new Uint8Array(size * size * 4).fill(77), orm: new Uint8Array(size * size * 4).fill(66), normal: new Uint8Array(size * size * 4).fill(55) }) });
    const a = f.stack(SPLAT_LAYERS);
    await new Promise((r) => setTimeout(r, 20));
    const stride = 16 * 16 * 4;
    expect((a.map.image.data as Uint8Array)[stride * 2]).toBe(77);
    expect((a.orm.image.data as Uint8Array)[stride * 3 + 5]).toBe(66);
    expect((a.normal.image.data as Uint8Array)[1]).toBe(55);
    f.dispose();
  });

  it('are what the layered terrain material is built from', () => {
    const f = new FinishTextures();
    const m = createMaterial(resolveMaterial({ preset: 'grass', vertexColors: true, splat: true }, { hasVertexColors: true }), 'standard', undefined, f, false, undefined, true, null, null, true);
    expect(m.userData['aetherSplat']).toBe(true);
    // One stack for the four layers, however many materials use it.
    const before = f.stack(SPLAT_LAYERS);
    createMaterial(resolveMaterial({ preset: 'grass', vertexColors: true, splat: true }, { hasVertexColors: true }), 'standard', undefined, f, false, undefined, true, null, null, true);
    expect(f.stack(SPLAT_LAYERS)).toBe(before);
    f.dispose();
  });
});
