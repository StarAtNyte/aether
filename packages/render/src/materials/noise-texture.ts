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

export const NOISE_SIZE = 256;
/** Lattice cells across the texture (the texture repeats every `NOISE_PERIOD` units of the noise lattice). */
export const NOISE_PERIOD = 16;
/** Standard deviation of `mx_noise_float` (measured on 200 000 samples); the field is scaled to it. */
export const NOISE_STD = 0.2666;
/** The skew that maps a world position onto the texture plane: no direction in the field is a dead axis for walls. */
export const NOISE_SKEW: readonly [number, number] = Object.freeze([0.7, 0.37]) as readonly [number, number];

function hash(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Tileable 2D gradient noise on a lattice of `period` cells, `size` samples across; raw values (about -0.7..0.7). */
export function tileableGradientNoise(size: number, period: number, seed: number): Float32Array {
  const out = new Float32Array(size * size);
  const gx = new Float32Array(period * period);
  const gy = new Float32Array(period * period);
  for (let j = 0; j < period; j++) {
    for (let i = 0; i < period; i++) {
      const a = hash(i, j, seed) * Math.PI * 2;
      gx[j * period + i] = Math.cos(a);
      gy[j * period + i] = Math.sin(a);
    }
  }
  const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
  const cell = size / period;
  for (let y = 0; y < size; y++) {
    const fy = y / cell;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    const y1 = (y0 + 1) % period;
    const v = fade(ty);
    for (let x = 0; x < size; x++) {
      const fx = x / cell;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const x1 = (x0 + 1) % period;
      const u = fade(tx);
      const dot = (cx: number, cy: number, dx: number, dy: number): number => (gx[cy * period + cx] as number) * dx + (gy[cy * period + cx] as number) * dy;
      const n00 = dot(x0, y0, tx, ty);
      const n10 = dot(x1, y0, tx - 1, ty);
      const n01 = dot(x0, y1, tx, ty - 1);
      const n11 = dot(x1, y1, tx - 1, ty - 1);
      const a = n00 + (n10 - n00) * u;
      const b = n01 + (n11 - n01) * u;
      out[y * size + x] = a + (b - a) * v;
    }
  }
  return out;
}

/** RGBA8 pixels: three independent fields (R, G, B) at `value * 0.5 + 0.5`, spread matched to `mx_noise_float`; A = 255. */
export function noisePixels(size = NOISE_SIZE, period = NOISE_PERIOD): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  for (let c = 0; c < 3; c++) {
    const f = tileableGradientNoise(size, period, 17 + c * 101);
    let sq = 0;
    for (const v of f) sq += v * v;
    const gain = NOISE_STD / Math.sqrt(sq / f.length);
    for (let i = 0; i < f.length; i++) {
      const v = Math.max(-1, Math.min(1, (f[i] as number) * gain)) * 0.5 + 0.5;
      px[i * 4 + c] = Math.round(v * 255);
    }
  }
  for (let i = 3; i < px.length; i += 4) px[i] = 255;
  return px;
}

let shared: DataTexture | null = null;

/** The one noise texture every material shares (created on first use). */
export function sharedNoiseTexture(): DataTexture {
  if (shared) return shared;
  const t = new DataTexture(noisePixels(), NOISE_SIZE, NOISE_SIZE, RGBAFormat, UnsignedByteType);
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
