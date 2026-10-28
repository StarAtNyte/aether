import { describe, expect, it } from 'vitest';
import type { Material } from 'three';
import { MaterialCache } from '../src/materials/material-cache';
import { ANTI_TILE_FINISHES, antiTileProgramKey, DETAIL_MID, DETAIL_MID_AMOUNT, DETAIL_FAR, MID_DETAIL_FINISHES, needsAntiTile } from '../src/materials/anti-tile';

type NodeCarrier = Material & { colorNode?: unknown; roughnessNode?: unknown; aoNode?: unknown; normalNode?: unknown };

describe('anti-tiling', () => {
  it('large-tile finishes get blended lookups for colour, roughness, occlusion and normals; small ones do not', () => {
    const cache = new MaterialCache();
    const floor = cache.acquire({ finish: 'concrete' }).material as NodeCarrier;
    expect(floor.colorNode).toBeTruthy();
    expect(floor.roughnessNode).toBeTruthy();
    expect(floor.aoNode).toBeTruthy();
    expect(floor.normalNode).toBeTruthy();
    // Patterned finishes (planks, brick, tiles) keep a single lookup: two shifted copies would only ghost.
    for (const finish of ['oak', 'brick', 'tile', 'marble'] as const) expect((cache.acquire({ finish }).material as NodeCarrier).colorNode ?? null, finish).toBeNull();
    // A 0.5 m weave repeats too finely to show a pattern.
    const fabric = cache.acquire({ finish: 'fabric' }).material as NodeCarrier;
    expect(fabric.colorNode ?? null).toBeNull();
    // Presets with photographed detail follow their finish's tile size.
    const lawn = cache.acquire({ preset: 'grass' }).material as NodeCarrier;
    expect(lawn.colorNode).toBeTruthy();
    const plain = cache.acquire({ preset: 'plastic' }).material as NodeCarrier;
    expect(plain.colorNode ?? null).toBeNull();
    cache.dispose();
  });
  it('can be switched off for materials created afterwards (software rasterisers, low memory)', () => {
    const cache = new MaterialCache();
    cache.antiTile = false;
    const floor = cache.acquire({ finish: 'concrete' }).material as NodeCarrier;
    expect(floor.colorNode ?? null).toBeNull();
    expect((floor as unknown as { map: unknown }).map).not.toBeNull();
    expect(floor.userData['aetherFinish']).toBeUndefined();
    cache.antiTile = true;
    const wall = cache.acquire({ finish: 'plaster' }).material as NodeCarrier;
    expect(wall.colorNode).toBeTruthy();
    cache.dispose();
  });
  it('samples the maps with nodes instead of binding them, and marks the material so live colour updates keep the finish scale', () => {
    const cache = new MaterialCache();
    const m = cache.acquire({ finish: 'rock' }).material as unknown as { map: unknown; normalMap: unknown; aoMap: unknown; roughnessMap: unknown; userData: Record<string, unknown> };
    expect(m.map).toBeNull();
    expect(m.normalMap).toBeNull();
    expect(m.aoMap).toBeNull();
    expect(m.roughnessMap).toBeNull();
    expect(m.userData['aetherFinish']).toBe('rock');
    const oak = cache.acquire({ finish: 'oak' }).material as unknown as { map: unknown };
    expect(oak.map).not.toBeNull();
    const plain = cache.acquire({ finish: 'fabric' }).material as unknown as { map: unknown; userData: Record<string, unknown> };
    expect(plain.map).not.toBeNull();
    expect(plain.userData['aetherFinish']).toBeUndefined();
    cache.dispose();
  });
  it('decides by finish and tile size', () => {
    expect(needsAntiTile('concrete', 3)).toBe(true);
    expect(needsAntiTile('grass', 0.9)).toBe(true);
    expect(needsAntiTile('grass', 0.5)).toBe(false);
    expect(needsAntiTile('grass', Number.NaN)).toBe(false);
    expect(needsAntiTile('brick', 3)).toBe(false);
    expect(needsAntiTile('oak', 3)).toBe(false);
  });
});

describe('mid-range ground breakup', () => {
  it('only natural ground finishes get it, each of them an anti-tiled one', () => {
    for (const f of MID_DETAIL_FINISHES) expect(ANTI_TILE_FINISHES.has(f)).toBe(true);
    for (const wall of ['plaster', 'concrete', 'terrazzo', 'carpet', 'bark']) expect(MID_DETAIL_FINISHES.has(wall)).toBe(false);
    expect(MID_DETAIL_FINISHES.has('grass')).toBe(true);
  });
  it('fades in before the far macro lookup does and keeps the mean tone (amplitudes are small)', () => {
    expect(DETAIL_MID[0]).toBeLessThan(DETAIL_MID[1]);
    expect(DETAIL_MID[1]).toBeLessThanOrEqual(DETAIL_FAR[0]);
    expect(DETAIL_MID_AMOUNT[0] + DETAIL_MID_AMOUNT[1]).toBeLessThan(1);
  });
  it('keys the compiled program by the textures it samples: finishes never share one (cobble drew as plaster)', () => {
    const cache = new MaterialCache();
    const key = (spec: { finish: 'cobble' | 'stone' | 'plaster'; color?: string }): string => (cache.acquire(spec).material as Material).customProgramCacheKey();
    const [cobble, stone, plaster] = [key({ finish: 'cobble', color: '#cdbfa3' }), key({ finish: 'stone', color: '#cdbfa3' }), key({ finish: 'plaster', color: '#cdbfa3' })];
    expect(new Set([cobble, stone, plaster]).size).toBe(3);
    // The same finish in another colour keeps its program: only factors differ.
    expect(key({ finish: 'plaster', color: '#f2e9dc' })).toBe(plaster);
    // The key names the maps themselves.
    const maps = cache.finishes.get('cobble');
    expect(cobble).toBe(antiTileProgramKey(maps, 1.2, { finish: 'cobble', stochastic: false, detail: true }));
    cache.dispose();
  });
});
