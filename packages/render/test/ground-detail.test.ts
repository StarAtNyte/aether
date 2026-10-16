import { describe, expect, it } from 'vitest';
import type { Material } from 'three';
import { MaterialCache } from '../src/materials/material-cache';
import { GROUND_PATTERN_FINISHES, NORMAL_STRENGTH, WETNESS, groundWeather, needsAntiTile } from '../src/materials/anti-tile';
import { WINDOW_COLOR, facadeGlow, nightGlow } from '../src/materials/facade-glow';

type NodeCarrier = Material & { colorNode?: unknown; roughnessNode?: unknown; normalNode?: unknown; emissiveNode?: unknown };

describe('ground and masonry finishes', () => {
  it('patterned paving and ashlar get the distance and weather nodes without a second ghosting lookup', () => {
    const cache = new MaterialCache();
    for (const finish of ['stone', 'cobble', 'limestone'] as const) {
      expect(GROUND_PATTERN_FINISHES.has(finish)).toBe(true);
      const m = cache.acquire({ finish }).material as NodeCarrier;
      expect(m.colorNode, finish).toBeTruthy();
      expect(m.roughnessNode, finish).toBeTruthy();
    }
    // Planks, tiles and marble keep their classic single-lookup maps.
    for (const finish of ['oak', 'tile', 'marble'] as const) expect((cache.acquire({ finish }).material as NodeCarrier).colorNode ?? null, finish).toBeNull();
    cache.dispose();
  });

  it('detail lookups can be switched off for weak GPUs without losing the finish', () => {
    const cache = new MaterialCache();
    cache.groundDetail = false;
    const m = cache.acquire({ finish: 'asphalt' }).material as NodeCarrier;
    expect(m.colorNode).toBeTruthy();
    expect(m.normalNode).toBeTruthy();
    cache.dispose();
  });

  it('surfaces that can hold puddles are listed, and plants and wood are not', () => {
    expect(WETNESS['asphalt']?.rain).toBeGreaterThan(WETNESS['concrete']?.rain ?? 1);
    for (const f of ['grass', 'oak', 'plaster', 'fabric']) expect(WETNESS[f]).toBeUndefined();
    for (const w of Object.values(WETNESS)) {
      expect(w.base).toBeGreaterThanOrEqual(0);
      expect(w.base + w.rain).toBeLessThanOrEqual(1);
    }
  });

  it('plaster and concrete walls get a stronger relief than the faint photographed maps give', () => {
    expect(NORMAL_STRENGTH['plaster']).toBeGreaterThan(1.5);
    expect(NORMAL_STRENGTH['concrete']).toBeGreaterThan(1.2);
    for (const v of Object.values(NORMAL_STRENGTH)) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(3);
    }
  });

  it('small tiles are never anti-tiled', () => {
    expect(needsAntiTile('cobble', 0.5)).toBe(false);
    expect(needsAntiTile('cobble', 2.4)).toBe(true);
  });

  it('wetness is clamped and shared by all ground materials', () => {
    const cache = new MaterialCache();
    cache.setWetness(5);
    expect(groundWeather.value).toBe(1);
    cache.setWetness(-2);
    expect(groundWeather.value).toBe(0);
    cache.setWetness(Number.NaN);
    expect(groundWeather.value).toBe(0);
    cache.setWetness(0.5);
    expect(groundWeather.value).toBe(0.5);
    cache.setWetness(0);
    cache.dispose();
  });
});

describe('facade windows', () => {
  it('only the facade finish emits, and the glow follows the sun below the horizon', () => {
    const cache = new MaterialCache();
    const facade = cache.acquire({ finish: 'facade' }).material as NodeCarrier;
    expect(facade.emissiveNode).toBeTruthy();
    expect((cache.acquire({ finish: 'concrete' }).material as NodeCarrier).emissiveNode ?? null).toBeNull();
    cache.dispose();
  });

  it('nightGlow is 0 by day, 1 at night, smooth between, and safe for bad input', () => {
    expect(nightGlow(40)).toBe(0);
    expect(nightGlow(-20)).toBe(1);
    const dusk = nightGlow(0);
    expect(dusk).toBeGreaterThan(0);
    expect(dusk).toBeLessThan(1);
    expect(nightGlow(-2)).toBeGreaterThan(nightGlow(2));
    expect(nightGlow(Number.NaN)).toBe(0);
  });

  it('the shared uniform follows the sky and warm colour stays warm', () => {
    const cache = new MaterialCache();
    cache.setSkyElevation(-30);
    expect(facadeGlow.value).toBe(1);
    cache.setSkyElevation(30);
    expect(facadeGlow.value).toBe(0);
    expect(WINDOW_COLOR[0]).toBeGreaterThan(WINDOW_COLOR[2]);
    cache.dispose();
  });
});
