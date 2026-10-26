/** Frozen pre-optimization cloud algorithm for exact browser comparisons. */
import {rng} from '@aether/core/random';
const OCTAVES=6,BASE_PERIOD=4,COVER_STEP=.05,SHADOW_STEPS=5;
interface CloudSun{x:number;y:number}
function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function quantiseCover(cover: number): number {
  const c = Number.isFinite(cover) ? Math.max(0, Math.min(1, cover)) : 0;
  return Math.round(c / COVER_STEP) * COVER_STEP;
}

export function fractalNoise(size: number, seed: number, stretch = 1): Float32Array {
  const random = rng(seed);
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < OCTAVES; o++) {
    const period = BASE_PERIOD << o;
    const periodY = Math.min(256, period * stretch);
    const lattice = new Float32Array(period * periodY);
    for (let i = 0; i < lattice.length; i++) lattice[i] = random();
    const at = (i: number, j: number): number => lattice[(((j % periodY) + periodY) % periodY) * period + (((i % period) + period) % period)] as number;
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * periodY;
      const yi = Math.floor(fy);
      const ty = fy - yi;
      const sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * period;
        const xi = Math.floor(fx);
        const tx = fx - xi;
        const sx = tx * tx * (3 - 2 * tx);
        const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * sx;
        const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * sx;
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
export function cloudPixels(size: number, cover: number, fbm: Float32Array, sun?: CloudSun): Uint8Array {
  const c = quantiseCover(cover);
  const out = new Uint8Array(size * size * 4);
  // Cover 0 → threshold at the top of the noise range (clear sky); cover 1 → everything is cloud.
  const threshold = 1 - c * 1.1;
  const dens = (i: number): number => smoothstep(threshold, threshold + 0.4, fbm[i] as number);
  const mask = size - 1;
  const sx = sun ? sun.x : 0;
  const sy = sun ? sun.y : 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const d = fbm[i] as number;
      const alpha = smoothstep(threshold, threshold + 0.16, d);
      const core = smoothstep(threshold + 0.04, threshold + 0.4, d);
      let shade = 1 - 0.5 * core;
      if (sun && alpha > 0) {
        // Optical depth toward the sun (the texture is tileable, so sample with wrap-around).
        let depth = 0;
        for (let k = 1; k <= SHADOW_STEPS; k++) {
          const px = (Math.round(x + sx * k) & mask) >>> 0;
          const py = (Math.round(y + sy * k) & mask) >>> 0;
          depth += dens(py * size + px);
        }
        const through = Math.exp(-0.62 * depth);
        // Sunlit side up to 1, deep shade down to 0.3; thin cloud gets a forward-scatter glow.
        shade = (0.58 + 0.42 * through) * (1 - 0.32 * core) + 0.22 * (1 - core) * through;
        shade = Math.min(1.12, shade);
      }
      const v = Math.round(Math.max(0, Math.min(1, shade)) * 255);
      out[i * 4] = v;
      out[i * 4 + 1] = v;
      out[i * 4 + 2] = v;
      out[i * 4 + 3] = Math.round(alpha * 255);
    }
  }
  return out;
}
