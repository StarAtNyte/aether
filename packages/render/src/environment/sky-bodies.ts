/**
 * Pixel generators (pure, deterministic, no three.js) for the sun and the moon that sit in the sky dome:
 * a radial sun sprite (a hard bright disc inside a tight corona; the wide aureole comes from the sky
 * model's aerosol scattering) and a moon disc with maria, craters and a phase terminator.
 */

/** Edge of the generated sprites in pixels. */
export const BODY_TEXTURE_SIZE = 128;

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Hash noise in [0, 1) of an integer lattice point. */
function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = x - xi;
  const ty = y - yi;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(x: number, y: number, seed: number): number {
  let v = 0;
  let a = 0.5;
  let f = 1;
  for (let o = 0; o < 5; o++) {
    v += a * valueNoise(x * f, y * f, seed + o * 17);
    a *= 0.5;
    f *= 2;
  }
  return v;
}

/**
 * RGBA8 pixels of the sun sprite. The sprite spans four times the disc's diameter: a solid bright disc
 * with a soft edge, then a corona that falls off quickly. Premultiplied-friendly (alpha = intensity).
 */
export function sunSpritePixels(size = BODY_TEXTURE_SIZE): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = ((x + 0.5) / size) * 2 - 1;
      const dy = ((y + 0.5) / size) * 2 - 1;
      const r = Math.hypot(dx, dy);
      const disc = 1 - smoothstep(0.23, 0.26, r);
      const corona = 0.55 * Math.exp(-Math.max(0, r - 0.2) * 9) + 0.14 * Math.exp(-r * 3.2);
      const edge = 1 - smoothstep(0.85, 1, r);
      const v = Math.min(1, Math.max(disc, corona) * edge);
      const k = (y * size + x) * 4;
      out[k] = 255;
      out[k + 1] = 255;
      out[k + 2] = 255;
      out[k + 3] = Math.round(v * 255);
    }
  }
  return out;
}

/**
 * RGBA8 pixels of the moon disc: pale highland grey with darker maria (large smooth patches), a few
 * craters, a soft limb and the lit fraction `phase` in (0, 1]: 1 is full, smaller values leave the left
 * side in shadow behind a soft terminator (the dark side keeps a faint earthshine).
 */
export function moonPixels(phase: number, size = BODY_TEXTURE_SIZE): Uint8Array {
  const p = Number.isFinite(phase) ? Math.max(0.02, Math.min(1, phase)) : 1;
  const out = new Uint8Array(size * size * 4);
  // The terminator is an ellipse: its horizontal radius runs from -1 (new) through 0 (half) to +1 (full).
  const term = 2 * p - 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = ((x + 0.5) / size) * 2 - 1;
      const dy = ((y + 0.5) / size) * 2 - 1;
      const r = Math.hypot(dx, dy);
      const k = (y * size + x) * 4;
      if (r >= 1) {
        out[k + 3] = 0;
        continue;
      }
      const nx = dx * 2.4 + 5;
      const ny = dy * 2.4 + 3;
      const maria = smoothstep(0.5, 0.62, fbm(nx * 0.8, ny * 0.8, 3));
      let tone = 0.86 - 0.34 * maria + 0.12 * (fbm(nx * 3, ny * 3, 9) - 0.5);
      // Craters: bright rims, dark floors, on a coarse jittered grid.
      const cell = 6;
      const cx = Math.floor((dx + 1) * cell * 0.5);
      const cy = Math.floor((dy + 1) * cell * 0.5);
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const gx = cx + i;
          const gy = cy + j;
          if (hash(gx, gy, 41) < 0.55) continue;
          const px = ((gx + 0.3 + 0.4 * hash(gx, gy, 5)) / cell) * 2 - 1;
          const py = ((gy + 0.3 + 0.4 * hash(gx, gy, 6)) / cell) * 2 - 1;
          const cr = 0.035 + 0.05 * hash(gx, gy, 7);
          const d = Math.hypot(dx - px, dy - py) / cr;
          if (d < 1) tone -= 0.1 * smoothstep(1, 0.6, d);
          else if (d < 1.35) tone += 0.07 * (1 - (d - 1) / 0.35);
        }
      }
      tone *= 1 - 0.28 * smoothstep(0.7, 1, r);
      // Phase: x position along the terminator ellipse decides lit or dark.
      const half = Math.sqrt(Math.max(0, 1 - dy * dy));
      const edge = dx + term * half;
      const lit = p >= 0.995 ? 1 : smoothstep(-0.05, 0.07, edge);
      const light = 0.05 + 0.95 * lit;
      const v = Math.max(0, Math.min(1, tone)) * light;
      out[k] = Math.round(v * 255 * 0.97);
      out[k + 1] = Math.round(v * 255 * 0.98);
      out[k + 2] = Math.round(v * 255);
      out[k + 3] = Math.round((1 - smoothstep(0.96, 1, r)) * 255);
    }
  }
  return out;
}

/**
 * RGBA8 pixels of the sun's crepuscular rays: a soft radial glow broken into spokes of unequal width and
 * brightness by angular noise (the rays seen through gaps in cloud and haze). Pure white, alpha = intensity,
 * for an additive sprite tinted by the sunlight; deterministic.
 */
export function sunRaysPixels(size = 256): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const spokes = 46;
  const phase: number[] = [];
  for (let i = 0; i < spokes; i++) phase.push(hash(i, 3, 77));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = ((x + 0.5) / size) * 2 - 1;
      const dy = ((y + 0.5) / size) * 2 - 1;
      const r = Math.hypot(dx, dy);
      const ang = (Math.atan2(dy, dx) / (Math.PI * 2) + 0.5) * spokes;
      const i0 = Math.floor(ang) % spokes;
      const i1 = (i0 + 1) % spokes;
      const t = ang - Math.floor(ang);
      const s = t * t * (3 - 2 * t);
      // Spoke strength: sparse (most are faint), smoothly interpolated around the circle.
      const a = (phase[i0] as number) ** 2.2 * (1 - s) + (phase[i1] as number) ** 2.2 * s;
      const ripple = 0.55 + 0.45 * valueNoise(ang * 3.1, r * 4, 11);
      const falloff = Math.exp(-r * 3.4) * (1 - smoothstep(0.7, 1, r));
      const v = Math.min(1, (0.1 + 0.9 * a * ripple) * falloff * (1 - Math.exp(-r * 40)));
      const k = (y * size + x) * 4;
      out[k] = 255;
      out[k + 1] = 255;
      out[k + 2] = 255;
      out[k + 3] = Math.round(v * 255);
    }
  }
  return out;
}
