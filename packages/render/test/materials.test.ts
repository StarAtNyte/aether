import { describe, expect, it } from 'vitest';
import { DoubleSide, FrontSide, MeshStandardMaterial } from 'three';
import { MaterialPreset } from '@aether/core';
import { MATERIAL_PRESETS, materialKey, mergeMaterial, resolveMaterial, skinned } from '../src/materials/presets';
import { MaterialCache } from '../src/materials/material-cache';

describe('resolveMaterial', () => {
  it('has a preset entry for every schema preset', () => {
    for (const p of MaterialPreset.options) expect(MATERIAL_PRESETS[p], p).toBeDefined();
  });

  it('defaults to plastic', () => {
    const r = resolveMaterial(undefined);
    expect(r.color).toBe(MATERIAL_PRESETS.plastic.color);
    expect(r.transparent).toBe(false);
    expect(r.emissiveIntensity).toBe(0);
    expect(r.emissive).toBe('#000000');
  });

  it('applies overrides on top of the preset', () => {
    const r = resolveMaterial({ preset: 'metal', color: '#FF0000', roughness: 0.9 });
    expect(r.color).toBe('#ff0000');
    expect(r.roughness).toBe(0.9);
    expect(r.metalness).toBe(1);
  });

  it('makes glass and water transparent, lava and neon emissive', () => {
    expect(resolveMaterial({ preset: 'glass' }).transparent).toBe(true);
    const water = resolveMaterial({ preset: 'water' });
    expect(water.transparent).toBe(true);
    expect(water.emissiveIntensity).toBeGreaterThan(0);
    expect(resolveMaterial({ preset: 'lava' }).emissiveIntensity).toBeGreaterThan(1);
    const neon = resolveMaterial({ preset: 'neon', color: '#00ff88' });
    expect(neon.emissive).toBe('#00ff88');
    expect(neon.emissiveIntensity).toBeGreaterThan(1);
  });

  it('an explicit emissive color without intensity glows at 1', () => {
    const r = resolveMaterial({ emissive: '#ffaa00' });
    expect(r.emissive).toBe('#ffaa00');
    expect(r.emissiveIntensity).toBe(1);
  });

  it('falls back on invalid (untrusted) values instead of throwing', () => {
    const r = resolveMaterial({ preset: 'nope' as never, color: 'red', roughness: Number.NaN, opacity: 7, emissiveIntensity: -3 } as never);
    expect(r.color).toBe(MATERIAL_PRESETS.plastic.color);
    expect(r.roughness).toBe(MATERIAL_PRESETS.plastic.roughness);
    expect(r.opacity).toBe(1);
  });

  it('ignores inherited preset names (prototype keys)', () => {
    expect(resolveMaterial({ preset: 'constructor' as never }).color).toBe(MATERIAL_PRESETS.plastic.color);
  });

  it('enables vertex colors only when the geometry has them', () => {
    expect(resolveMaterial({ vertexColors: true }).vertexColors).toBe(false);
    expect(resolveMaterial({}, { hasVertexColors: true }).vertexColors).toBe(true);
    expect(resolveMaterial({ vertexColors: false }, { hasVertexColors: true }).vertexColors).toBe(false);
  });

  // Regression: painted generator parts were multiplied by their preset colour (pink cherry
  // blossom rendered olive green, stone castles and trees near black).
  it('uses a white base for generator parts whose albedo is in their vertex colours', () => {
    const leaf = resolveMaterial({ preset: 'leaf', vertexColors: true }, { hasVertexColors: true });
    expect(leaf.color).toBe('#ffffff');
    expect(leaf.vertexColors).toBe(true);
    expect(leaf.roughness).toBe(MATERIAL_PRESETS.leaf.roughness);
    // An explicit colour still tints the vertex colours (user recolouring).
    expect(resolveMaterial({ preset: 'leaf', vertexColors: true, color: '#ff0000' }, { hasVertexColors: true }).color).toBe('#ff0000');
    // Geometry without colours keeps the preset colour.
    expect(resolveMaterial({ preset: 'leaf', vertexColors: true }).color).toBe(MATERIAL_PRESETS.leaf.color);
    // Surfaces that merely allow vertex colours (the ground plane's tint variation) keep the preset colour.
    expect(resolveMaterial({ preset: 'grass' }, { hasVertexColors: true }).color).toBe(MATERIAL_PRESETS.grass.color);
    // Emissive presets that follow their colour still glow in the preset colour.
    const neon = resolveMaterial({ preset: 'neon', vertexColors: true }, { hasVertexColors: true });
    expect(neon.color).toBe('#ffffff');
    expect(neon.emissive).toBe(MATERIAL_PRESETS.neon.color);
  });
});

describe('materialKey', () => {
  it('is equal for equivalent specs and differs by variant', () => {
    const a = materialKey(resolveMaterial({ preset: 'wood' }));
    const b = materialKey(resolveMaterial({ preset: 'wood', color: MATERIAL_PRESETS.wood.color }));
    expect(a).toBe(b);
    expect(materialKey(resolveMaterial({ preset: 'wood' }), 'ghost')).not.toBe(a);
  });
});

describe('mergeMaterial', () => {
  it('entity wins for single-part outputs', () => {
    expect(mergeMaterial({ color: '#111111', roughness: 0.2 }, { color: '#222222' }, 1)).toEqual({ color: '#222222', roughness: 0.2 });
  });

  it('styled parts keep their look in multi-part outputs; opacity/flatShading always apply', () => {
    const m = mergeMaterial({ preset: 'leaf' }, { color: '#ff0000', metalness: 0.5, opacity: 0.5, flatShading: true }, 3);
    expect(m.color).toBeUndefined();
    expect(m.preset).toBe('leaf');
    expect(m.metalness).toBeUndefined();
    expect(m.opacity).toBe(0.5);
    expect(m.flatShading).toBe(true);
    // A bare part takes the entity material for unset fields.
    expect(mergeMaterial({ roughness: 0.1 }, { color: '#ff0000', roughness: 0.9 }, 2)).toEqual({ color: '#ff0000', roughness: 0.1 });
  });

  it('handles missing sides', () => {
    expect(mergeMaterial(undefined, undefined, 1)).toEqual({});
    expect(mergeMaterial({ color: '#123456' }, undefined, 2)).toEqual({ color: '#123456' });
  });
});

describe('MaterialCache', () => {
  it('shares, refcounts and disposes materials', () => {
    const cache = new MaterialCache();
    const a = cache.acquire({ preset: 'stone' });
    const b = cache.acquire({ preset: 'stone' });
    expect(a.material).toBe(b.material);
    expect(cache.refs(a.key)).toBe(2);
    let disposed = 0;
    a.material.addEventListener('dispose', () => disposed++);
    cache.release(a.key);
    expect(disposed).toBe(0);
    cache.release(b.key);
    expect(disposed).toBe(1);
    expect(cache.size).toBe(0);
  });

  it('builds standard materials with transparency, sides and ghost tint', () => {
    const cache = new MaterialCache();
    const glass = cache.acquire({ preset: 'glass' }, { doubleSided: true }).material as MeshStandardMaterial;
    expect(glass).toBeInstanceOf(MeshStandardMaterial);
    expect(glass.transparent).toBe(true);
    expect(glass.depthWrite).toBe(false);
    expect(glass.side).toBe(DoubleSide);
    const ghost = cache.acquire({ preset: 'stone' }, {}, 'ghost').material as MeshStandardMaterial;
    expect(ghost.transparent).toBe(true);
    expect(ghost.opacity).toBeLessThan(0.5);
    expect(ghost.depthWrite).toBe(false);
    expect(ghost.side).toBe(FrontSide);
    cache.dispose();
    expect(cache.size).toBe(0);
  });
});

describe('doubleSided', () => {
  it('a part that asks for both faces is drawn two-sided and keyed apart from a one-sided one', () => {
    const one = resolveMaterial({ preset: 'glass' });
    const two = resolveMaterial({ preset: 'glass', doubleSided: true });
    expect(one.doubleSided).toBe(false);
    expect(two.doubleSided).toBe(true);
    expect(materialKey(one)).not.toBe(materialKey(two));
    expect(mergeMaterial({ doubleSided: true, finish: 'facade' }, undefined, 3).doubleSided).toBe(true);
  });
});

describe('skins', () => {
  const soil = { id: 'tex-0123456789ab' };
  it('a preset with a finish behind it takes the skin of that finish (dirt draws as soil)', () => {
    expect(skinned({ preset: 'dirt', color: '#a85a3a' }, { soil }).texture).toEqual(soil);
    expect(resolveMaterial(skinned({ preset: 'dirt' }, { soil })).texture?.id).toBe(soil.id);
  });
  it('leaves a finish or preset with no skin, and a part that names its own texture, alone', () => {
    expect(skinned({ preset: 'metal' }, { soil }).texture).toBeUndefined();
    expect(skinned({ finish: 'plaster' }, { soil }).texture).toBeUndefined();
    const own = { id: 'tex-ffffffffffff' };
    expect(skinned({ finish: 'soil', texture: own }, { soil }).texture).toEqual(own);
  });
});
