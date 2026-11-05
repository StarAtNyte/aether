import { describe, expect, it } from 'vitest';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { SPECULAR_AA_THRESHOLD, filteredRoughness, installSpecularAA } from '../src/gpu/specular-aa';

describe('specular antialiasing', () => {
  it('leaves a smooth normal alone and widens a varying one, within the threshold', () => {
    expect(filteredRoughness(0.3, 0)).toBeCloseTo(0.3, 6);
    expect(filteredRoughness(0.3, 0.2)).toBeGreaterThan(0.3);
    expect(filteredRoughness(0.1, 100)).toBeCloseTo(Math.sqrt(0.01 + SPECULAR_AA_THRESHOLD), 6);
    expect(filteredRoughness(0.95, 100)).toBeLessThanOrEqual(1);
  });

  it('wraps the standard node material once', () => {
    const before = (MeshStandardNodeMaterial.prototype as unknown as { setupVariants: unknown }).setupVariants;
    expect(installSpecularAA()).toBe(true);
    const after = (MeshStandardNodeMaterial.prototype as unknown as { setupVariants: unknown }).setupVariants;
    expect(after).not.toBe(before);
    expect(installSpecularAA()).toBe(true);
    expect((MeshStandardNodeMaterial.prototype as unknown as { setupVariants: unknown }).setupVariants).toBe(after);
  });
});
