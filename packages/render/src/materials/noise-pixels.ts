/** Pure deterministic material-noise kernels, shared with the preparation worker. */
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
  // Preserve double precision while sharing identical x interpolation work across all rows.
  const columns = Math.max(0, Math.ceil(size));
  const cells0 = new Float64Array(columns), cells1 = new Float64Array(columns);
  const offsets = new Float64Array(columns), weights = new Float64Array(columns);
  for (let x = 0; x < size; x++) {
    const fx = x / cell, x0 = Math.floor(fx), tx = fx - x0;
    cells0[x] = x0; cells1[x] = (x0 + 1) % period;
    offsets[x] = tx; weights[x] = fade(tx);
  }
  for (let y = 0; y < size; y++) {
    const fy = y / cell;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    const y1 = (y0 + 1) % period;
    const v = fade(ty);
    const row0 = y0 * period, row1 = y1 * period;
    for (let x = 0; x < size; x++) {
      const x0 = cells0[x]!, x1 = cells1[x]!, tx = offsets[x]!, u = weights[x]!;
      const i00 = row0 + x0, i10 = row0 + x1, i01 = row1 + x0, i11 = row1 + x1;
      const n00 = gx[i00]! * tx + gy[i00]! * ty;
      const n10 = gx[i10]! * (tx - 1) + gy[i10]! * ty;
      const n01 = gx[i01]! * tx + gy[i01]! * (ty - 1);
      const n11 = gx[i11]! * (tx - 1) + gy[i11]! * (ty - 1);
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
    for (let i = 0; i < f.length; i++) { const v = f[i]!; sq += v * v; }
    const gain = NOISE_STD / Math.sqrt(sq / f.length);
    for (let i = 0; i < f.length; i++) {
      const v = Math.max(-1, Math.min(1, (f[i] as number) * gain)) * 0.5 + 0.5;
      px[i * 4 + c] = Math.round(v * 255);
    }
  }
  for (let i = 3; i < px.length; i += 4) px[i] = 255;
  return px;
}
