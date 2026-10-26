/** Pure deterministic cloud-noise kernel, shared with the preparation worker. */
import { rng } from '@aether/core/random';
export const CLOUD_TEXTURE_SIZE = 256;
export const CLOUD_SEED = 0xc10d5;
const OCTAVES = 6;
const BASE_PERIOD = 4;

/**
 * Tileable fractal noise in [0, 1], `OCTAVES` octaves starting at `BASE_PERIOD` lattice cells per tile.
 * `stretch` (an integer ≥ 1) multiplies the lattice density along y, which draws streaks along x.
 */
export function fractalNoise(size: number, seed: number, stretch = 1): Float32Array {
  const random = rng(seed);
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  // Reused by all octaves; Float64 retains the original JS arithmetic exactly.
  const x0 = new Uint16Array(size), x1 = new Uint16Array(size), weights = new Float64Array(size);
  for (let o = 0; o < OCTAVES; o++) {
    const period = BASE_PERIOD << o;
    const periodY = Math.min(256, period * stretch);
    const lattice = new Float32Array(period * periodY);
    for (let i = 0; i < lattice.length; i++) lattice[i] = random();
    // X weights repeat in every row.
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * period, xi = Math.floor(fx), tx = fx - xi;
      x0[x] = xi % period; x1[x] = (xi + 1) % period;
      weights[x] = tx * tx * (3 - 2 * tx);
    }
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * periodY;
      const yi = Math.floor(fy);
      const ty = fy - yi;
      const sy = ty * ty * (3 - 2 * ty);
      const row0 = (yi % periodY) * period, row1 = ((yi + 1) % periodY) * period;
      for (let x = 0; x < size; x++) {
        const lo = x0[x]!, hi = x1[x]!, sx = weights[x]!;
        const a0 = lattice[row0 + lo]!, a1 = lattice[row0 + hi]!;
        const b0 = lattice[row1 + lo]!, b1 = lattice[row1 + hi]!;
        const a = a0 + (a1 - a0) * sx;
        const b = b0 + (b1 - b0) * sx;
        const k = y * size + x;
        out[k] = (out[k] as number) + amp * (a + (b - a) * sy);
      }
    }
    total += amp;
    amp *= 0.52;
  }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) / total;
  return out;
}
