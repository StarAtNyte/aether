/**
 * Specular antialiasing of normal-mapped surfaces (three r186).
 *
 * three widens the roughness of every lit pixel by the screen-space change of the *geometry* normal (curved surfaces), not
 * of the shaded one. A normal map (stone joints, roof tiles, water ripples, terrain detail) seen from far away packs many
 * bumps into one pixel: each frame the pixel lands on a different one, so a sharp highlight comes and goes. That is the
 * glitter of distant roofs, paving and water, and it crawls as soon as the camera moves.
 *
 * The fix is the filtered-roughness of Kaplanyan and Hoffman (as in Filament): the variance of the shaded view normal
 * across the pixel quad, from its screen derivatives, is added to the squared roughness, clamped so it never makes a
 * surface more than moderately rough. Up close the normal barely changes between pixels and nothing changes; far away the
 * highlight spreads into the steady sheen the bumps average to. Two derivatives and a dot product per pixel, in the same
 * programs (no new programs, no new passes, every tier).
 */
import { MeshStandardNodeMaterial } from 'three/webgpu';
import * as TSL from 'three/tsl';

/** Screen-space variance scale (Filament's default). */
export const SPECULAR_AA_VARIANCE = 0.15;
/** Largest squared-roughness widening (Filament's default threshold). */
export const SPECULAR_AA_THRESHOLD = 0.2;

/** CPU twin of the shader (unit-tested): the widened perceptual roughness for a roughness and a normal variance. */
export function filteredRoughness(roughness: number, variance: number): number {
  const r = Math.max(0, Math.min(1, roughness));
  const k = Math.min(2 * SPECULAR_AA_VARIANCE * Math.max(0, variance), SPECULAR_AA_THRESHOLD);
  return Math.sqrt(Math.min(1, r * r + k));
}

let installed = false;

/** Widen the roughness of every standard and physical node material by its shaded normal's variance. Idempotent. */
export function installSpecularAA(): boolean {
  if (installed) return true;
  if ((globalThis as { __AETHER_SPECULAR_AA?: boolean }).__AETHER_SPECULAR_AA === false) return false;
  const proto = MeshStandardNodeMaterial?.prototype as unknown as { setupVariants?: (builder: unknown) => unknown } | undefined;
  const t = TSL as unknown as Record<string, unknown>;
  const original = proto?.setupVariants;
  if (!proto || typeof original !== 'function' || !t['roughness'] || !t['normalView'] || !t['dFdx']) return false;
  installed = true;
  type N = { dFdx(): N; dFdy(): N; dot(o: N): N; add(o: N | number): N; mul(o: N | number): N; min(o: N | number): N; sqrt(): N; assign(o: N): void };
  const rough = t['roughness'] as N;
  const normal = t['normalView'] as N;
  proto.setupVariants = function (this: unknown, builder: unknown): unknown {
    const out = original.call(this, builder);
    try {
      const du = normal.dFdx();
      const dv = normal.dFdy();
      const variance = du.dot(du).add(dv.dot(dv));
      const kernel = variance.mul(2 * SPECULAR_AA_VARIANCE).min(SPECULAR_AA_THRESHOLD);
      rough.assign(rough.mul(rough).add(kernel).min(1).sqrt());
    } catch {
      // The material keeps three's own roughness.
    }
    return out;
  };
  return true;
}
