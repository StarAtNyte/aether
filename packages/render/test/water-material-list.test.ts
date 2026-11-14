import { describe, expect, it } from 'vitest';
import { MaterialCache } from '../src/materials/material-cache';

describe('cached water pass materials', () => {
  it('reuses lists until shader membership changes and honors final release', () => {
    const cache = new MaterialCache();
    const empty = cache.waterMaterials();
    cache.acquire({ preset: 'stone' });
    expect(cache.waterMaterials()).toBe(empty);
    cache.waterTier = 'high';
    const first = cache.acquire({ preset: 'water' });
    const retained = cache.acquire({ preset: 'water' });
    const one = cache.waterMaterials();
    expect(one).toEqual([first.material]);
    expect(cache.waterMaterials()).toBe(one);
    cache.acquire({ preset: 'metal' });
    expect(cache.waterMaterials()).toBe(one);
    cache.release(first.key);
    expect(cache.waterMaterials()).toBe(one);
    cache.waterTier = 'standard';
    const second = cache.acquire({ preset: 'water' });
    expect(cache.waterMaterials()).toEqual([first.material, second.material]);
    expect(one).toEqual([first.material]);
    cache.release(retained.key);
    expect(cache.waterMaterials()).toEqual([second.material]);
    cache.release(second.key);
    expect(cache.waterMaterials()).toEqual([]);
    cache.dispose();
    const disposed = cache.waterMaterials();
    expect(disposed).toEqual([]);
    expect(cache.waterMaterials()).toBe(disposed);
  });

  it('counts live water shaders and falls as moving water, so generator rivers and falls get a running clock', () => {
    const cache = new MaterialCache();
    cache.acquire({ preset: 'stone' });
    const classic = cache.acquire({ preset: 'water', waterKind: 'fall' });
    expect(cache.hasMovingWater).toBe(false); // no water tier: the classic look does not animate
    cache.release(classic.key);
    cache.waterTier = 'high';
    const fall = cache.acquire({ preset: 'water', waterKind: 'fall', color: '#7fb8b0' });
    expect(fall.material.userData['aetherWaterfall']).toBe(true);
    expect(cache.hasMovingWater).toBe(true);
    const river = cache.acquire({ preset: 'water', waterKind: 'river', waterFlow: [0, 1.6] });
    cache.release(fall.key);
    expect(cache.hasMovingWater).toBe(true);
    cache.release(river.key);
    expect(cache.hasMovingWater).toBe(false);
    cache.acquire({ preset: 'water', waterKind: 'fall' });
    cache.dispose();
    expect(cache.hasMovingWater).toBe(false);
  });
});
