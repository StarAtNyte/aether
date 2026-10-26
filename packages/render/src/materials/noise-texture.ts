/**
 * A shared, tileable noise texture for the low-frequency world-space variation of lit surfaces (blend seams, macro
 * patches, roughness mottle).
 *
 * `mx_noise_float` is a 3D gradient noise: eight hashed lattice gradients and the interpolation between them, about a
 * hundred arithmetic operations per call, and the anti-tiled finishes took three of them per pixel (the lawn or plaza
 * that covers half of a default view paid that for every pixel). The variation they make is smooth and wide (metres
 * to tens of metres), so a bilinear fetch from a small precomputed field gives the same picture for one texture read.
 *
 * The field is 2D gradient noise made tileable (period {@link NOISE_PERIOD} lattice cells over {@link NOISE_SIZE}
 * texels), one independent field per colour channel, scaled to the spread of `mx_noise_float` (standard deviation
 * 0.267) and stored as `value * 0.5 + 0.5` like the shader code uses it. A 3D position is mapped onto the plane by a
 * fixed skew, so walls vary along their height too (see {@link noiseCoords}).
 */
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RGBAFormat, RepeatWrapping, UnsignedByteType } from 'three';
import { positionWorld, texture, vec2 } from 'three/tsl';
import type { Node } from 'three/webgpu';

import { NOISE_SIZE, NOISE_PERIOD, NOISE_SKEW } from './noise-pixels';
import { materialNoiseField } from '../gpu/procedural-fields';
export { NOISE_SIZE, NOISE_PERIOD, NOISE_STD, NOISE_SKEW, tileableGradientNoise, noisePixels } from './noise-pixels';

let shared: DataTexture | null = null;

/** The one noise texture every material shares (created on first use). */
export function sharedNoiseTexture(): DataTexture {
  if (shared) return shared;
  const t = new DataTexture(materialNoiseField(), NOISE_SIZE, NOISE_SIZE, RGBAFormat, UnsignedByteType);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = NoColorSpace;
  t.name = 'aether:noise';
  t.needsUpdate = true;
  shared = t;
  return t;
}

/**
 * Lookup of the shared field: `p` is a world position, `scale` the lattice frequency (1/m, like the argument of
 * `mx_noise_float(p * scale)`), `channel` the field (0..2), `offset` shifts the field. Returns a node in [0, 1]
 * with the spread of `mx_noise_float(...) * 0.5 + 0.5`.
 */
export function noise01(p: typeof positionWorld, scale: number, channel: 0 | 1 | 2, offset: readonly [number, number] = [0, 0]): Node<'float'> {
  const k = scale / NOISE_PERIOD;
  const uvw = vec2(p.x.add(p.y.mul(NOISE_SKEW[0])).mul(k).add(offset[0]), p.z.add(p.y.mul(NOISE_SKEW[1])).mul(k).add(offset[1]));
  const s = texture(sharedNoiseTexture(), uvw);
  return channel === 0 ? s.r : channel === 1 ? s.g : s.b;
}
