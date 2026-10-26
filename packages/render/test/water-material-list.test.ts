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
});
