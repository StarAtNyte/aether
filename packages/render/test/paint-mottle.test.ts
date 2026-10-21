import { describe, expect, it } from 'vitest';
import { createMaterial } from '../src/materials/material-cache';
import { resolveMaterial } from '../src/materials/presets';

describe('paint mottle', () => {
  it('painted surfaces get a colour node (no normal map) where the anti-tiling lookups run, not elsewhere', () => {
    const r = resolveMaterial({ finish: 'paint', color: '#f2efe8' });
    const on = createMaterial(r, 'standard', undefined, undefined, true);
    const off = createMaterial(r, 'standard', undefined, undefined, false);
    expect((on as unknown as { colorNode?: unknown }).colorNode).toBeTruthy();
    expect(on.normalMap).toBeNull();
    expect((off as unknown as { colorNode?: unknown }).colorNode ?? null).toBeNull();
    // The resolved colour is kept as the albedo the light volume bakes with.
    expect(on.userData['aetherAlbedo']).toHaveLength(3);
  });
});
