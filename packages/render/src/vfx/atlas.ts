/**
 * The particle sprite atlas: one row of square cells (glow, smoke puff,
 * four-point star, ring, paper flake), white with the shape in alpha so the
 * particle colour tints it. Deterministic pixels (no randomness outside the
 * seeded hash), generated once per renderer.
 */

/** Number of cells in the atlas row. */
export const ATLAS_CELLS = 5;

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Integer hash → [0, 1). */
function hash2(x: number, y: number, s: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(s, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Tileable-enough value noise on a lattice of `period` cells. */
function valueNoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const w = (i: number): number => ((i % period) + period) % period;
  const a = hash2(w(xi), w(yi), seed);
  const b = hash2(w(xi + 1), w(yi), seed);
  const c = hash2(w(xi), w(yi + 1), seed);
  const d = hash2(w(xi + 1), w(yi + 1), seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Alpha (0..1) of cell `cell` at normalised coordinates (dx, dy in -1..1). */
function cellAlpha(cell: number, dx: number, dy: number, px: number, py: number, size: number): number {
  const r = Math.hypot(dx, dy);
  switch (cell) {
    case 0: // glow: bright core, long soft falloff
      return Math.pow(1 - smooth(0, 1, r), 2.2);
    case 1: {
      // smoke puff: a soft disc broken up by two octaves of noise
      const n = 0.6 * valueNoise((px / size) * 5, (py / size) * 5, 5, 11) + 0.4 * valueNoise((px / size) * 11, (py / size) * 11, 11, 23);
      const edge = 1 - smooth(0.25 + 0.35 * n, 1, r);
      return Math.max(0, Math.min(1, edge * (0.55 + 0.6 * n)));
    }
    case 2: {
      // four-point star with a round core
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      const rays = Math.max(Math.exp(-ay * 18) * (1 - smooth(0, 1, ax)), Math.exp(-ax * 18) * (1 - smooth(0, 1, ay)));
      const core = Math.pow(1 - smooth(0, 0.45, r), 2);
      return Math.min(1, rays * 0.9 + core);
    }
    case 3: {
      // ring: a soft band near the rim
      const band = Math.exp(-Math.pow((r - 0.78) / 0.09, 2));
      return band * (1 - smooth(0.95, 1, r));
    }
    default: {
      // paper flake: a crisp rounded rectangle
      const ax = Math.abs(dx) / 0.9;
      const ay = Math.abs(dy) / 0.6;
      const q = Math.pow(Math.pow(ax, 6) + Math.pow(ay, 6), 1 / 6);
      return 1 - smooth(0.88, 1, q);
    }
  }
}

/** RGBA8 pixels of the atlas (`cell * ATLAS_CELLS` wide, `cell` high), row 0 at the bottom. */
export function atlasPixels(cell = 64): Uint8Array {
  const w = cell * ATLAS_CELLS;
  const px = new Uint8Array(w * cell * 4);
  for (let c = 0; c < ATLAS_CELLS; c++) {
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        const dx = ((x + 0.5) / cell) * 2 - 1;
        const dy = ((y + 0.5) / cell) * 2 - 1;
        // Leave a one-texel clear border so mip levels never bleed into the neighbour cell.
        const border = x === 0 || y === 0 || x === cell - 1 || y === cell - 1;
        const a = border ? 0 : cellAlpha(c, dx, dy, x, y, cell);
        const o = (y * w + c * cell + x) * 4;
        px[o] = 255;
        px[o + 1] = 255;
        px[o + 2] = 255;
        px[o + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
      }
    }
  }
  return px;
}
