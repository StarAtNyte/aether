import { describe, expect, it } from 'vitest';
import { DoubleSide, FrontSide, MeshStandardMaterial } from 'three';
import { MaterialPreset } from '@aether/core';
import { MATERIAL_PRESETS, materialKey, mergeMaterial, resolveMaterial } from '../src/materials/presets';
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
