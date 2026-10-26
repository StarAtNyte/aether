/** Frozen pre-optimization material noise for exact comparisons. */
const NOISE_SIZE=256,NOISE_PERIOD=16,NOISE_STD=.2666;
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
