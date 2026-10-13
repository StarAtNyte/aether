/**
 * Procedural nebula for the sky dome: soft violet / teal / magenta gas
 * clouds plus a brighter galactic band, as a pure function of the view
 * direction. Evaluated per dome vertex only when the environment changes,
 * so it costs nothing per frame. Deterministic (hash-based value noise).
 */

/** Plane normal of the galactic band (unit vector; the band is the great circle around it). */
const BAND_NORMAL: readonly [number, number, number] = [0.32, 0.55, -0.77];
/** Angular half-width of the galactic band (as a dot product with the band normal). */
const BAND_WIDTH = 0.2;

/** Nebula palette in linear-ish RGB (0..1), mixed by noise. */
const VIOLET: readonly [number, number, number] = [0.2, 0.08, 0.36];
const TEAL: readonly [number, number, number] = [0.03, 0.24, 0.3];
const MAGENTA: readonly [number, number, number] = [0.38, 0.06, 0.24];
const CORE: readonly [number, number, number] = [0.42, 0.36, 0.52];

function hash3(x: number, y: number, z: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Smooth 3D value noise in [0, 1]. */
export function valueNoise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = smooth(x - xi);
  const fy = smooth(y - yi);
  const fz = smooth(z - zi);
  const x00 = lerp(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), fx);
  const x10 = lerp(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), fx);
  const x01 = lerp(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), fx);
  const x11 = lerp(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), fx);
  return lerp(lerp(x00, x10, fy), lerp(x01, x11, fy), fz);
}

function fbm3(x: number, y: number, z: number): number {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  for (let o = 0; o < 4; o++) {
    sum += amp * valueNoise3(x * f, y * f, z * f);
    f *= 2.03;
    amp *= 0.5;
  }
  return sum / 0.9375;
}

/**
 * Additive nebula color for unit direction (dx, dy, dz), scaled by
 * `strength` (0..1), written into `out` (RGB, 0..~0.6). Zero allocations.
 */
export function nebulaAt(dx: number, dy: number, dz: number, strength: number, out: [number, number, number]): [number, number, number] {
  out[0] = 0;
  out[1] = 0;
  out[2] = 0;
  if (!(strength > 0)) return out;
  const n = fbm3(dx * 2.2 + 11, dy * 2.2 + 3, dz * 2.2 + 7);
  const hue = fbm3(dx * 1.3 + 41, dy * 1.3 + 17, dz * 1.3 + 29);
  // Gas: only the denser half of the noise shows, squared for soft wispy edges.
  const gas = Math.max(0, n - 0.42) / 0.58;
  const density = gas * gas;
  const dot = dx * BAND_NORMAL[0] + dy * BAND_NORMAL[1] + dz * BAND_NORMAL[2];
  const band = Math.exp(-(dot * dot) / (BAND_WIDTH * BAND_WIDTH));
  const dust = 0.55 + 0.45 * fbm3(dx * 6 + 5, dy * 6 + 9, dz * 6 + 1);
  const a = Math.max(0, Math.min(1, hue * 1.6 - 0.3));
  for (let i = 0; i < 3; i++) {
    const tint = (VIOLET[i] as number) * (1 - a) + (a < 0.5 ? (TEAL[i] as number) : (MAGENTA[i] as number)) * a;
    out[i] = (tint * density * 1.4 + (CORE[i] as number) * band * dust * 0.32 + tint * band * 0.5) * strength;
  }
  return out;
}
