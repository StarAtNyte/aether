/**
 * Procedural block atlas: every distinct {@link TileSpec} of a registry is
 * painted into one 16 × 16-pixel cell of an RGBA texture (16 cells per row,
 * 256 × 256 pixels). Patterns are hand-tuned pixel painters (bricks, planks,
 * ores, leaves …) driven by integer hashes, so the atlas is identical on
 * every platform and needs no image assets.
 *
 * Cutout patterns (leaves, glass, flowers, torches) write alpha 0 for holes;
 * every other pixel is opaque. Tiles are aligned to powers of two, so a box
 * filtered mip level ≤ 4 never mixes two tiles (the renderer clamps there).
 */
import type { BlockRegistry, TilePattern, TileSpec } from './blocks';
import { hash3 } from './noise';

/** Tile edge in pixels. */
export const TILE_SIZE = 16;
/** Tiles per atlas row (and column). */
export const ATLAS_TILES = 16;
/** Atlas edge in pixels. */
export const ATLAS_SIZE = TILE_SIZE * ATLAS_TILES;
/** Highest mip level that keeps tiles separate (16 px → 1 px). */
export const ATLAS_MAX_LOD = 4;

/** A painted atlas. */
export interface BlockAtlas {
  /** RGBA8, row 0 at the top, `ATLAS_SIZE × ATLAS_SIZE`. */
  pixels: Uint8Array;
  size: number;
  tilesPerRow: number;
  tileSize: number;
  /** Number of tiles painted. */
  tiles: number;
}

type RGB = [number, number, number];

function rgb(hex: string | undefined, fallback: RGB = [128, 128, 128]): RGB {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return fallback;
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function scale(c: RGB, f: number): RGB {
  return [c[0] * f, c[1] * f, c[2] * f];
}

/** Pixel painter: returns [r, g, b, a] for pixel (x, y) of a tile (y = 0 is the top row). */
type Painter = (x: number, y: number, h: (x: number, y: number, salt?: number) => number, c: { base: RGB; detail: RGB; accent: RGB }) => [number, number, number, number];

const O = 255;

/** Smooth-ish value noise on a coarse grid (wrapping at the tile edge). */
function blob(x: number, y: number, cell: number, h: (x: number, y: number, salt?: number) => number, salt: number): number {
  const n = TILE_SIZE / cell;
  const gx = x / cell;
  const gy = y / cell;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const tx = gx - x0;
  const ty = gy - y0;
  const v = (i: number, j: number): number => h(((i % n) + n) % n, ((j % n) + n) % n, salt);
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * sx;
  const b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * sx;
  return a + (b - a) * sy;
}

/** Nearest / second-nearest distance to `count` jittered points (wrapping), and the nearest point index. */
function cells(x: number, y: number, count: number, h: (x: number, y: number, salt?: number) => number, salt: number): [number, number, number] {
  let d1 = 1e9;
  let d2 = 1e9;
  let best = 0;
  for (let i = 0; i < count; i++) {
    const px = h(i, 0, salt) * TILE_SIZE;
    const py = h(i, 1, salt) * TILE_SIZE;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const dx = x + 0.5 - (px + ox * TILE_SIZE);
        const dy = y + 0.5 - (py + oy * TILE_SIZE);
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < d1) {
          d2 = d1;
          d1 = d;
          best = i;
        } else if (d < d2) d2 = d;
      }
    }
  }
  return [d1, d2, best];
}

function px(c: RGB, a = O): [number, number, number, number] {
  return [c[0], c[1], c[2], a];
}

function jitter(c: RGB, h: number, amount: number): RGB {
  return scale(c, 1 + (h - 0.5) * 2 * amount);
}

const CLEAR: [number, number, number, number] = [0, 0, 0, 0];

const PAINTERS: Readonly<Record<TilePattern, Painter>> = {
  noise: (x, y, h, c) => {
    const r = h(x, y);
    const base = jitter(c.base, h(x, y, 7), 0.05);
    return px(r < 0.12 ? mix(base, c.detail, 0.7) : r > 0.93 ? mix(base, c.accent, 0.6) : base);
  },
  solid: (x, y, h, c) => px(jitter(c.base, h(x, y), 0.02)),
  smooth: (x, y, h, c) => {
    const edge = x === 0 || y === 0 || x === 15 || y === 15;
    return px(edge ? mix(c.base, c.detail, 0.55) : jitter(c.base, h(x, y), 0.025));
  },
  stone: (x, y, h, c) => {
    const b = blob(x, y, 4, h, 3);
    const r = h(x, y);
    let col = b < 0.35 ? mix(c.base, c.detail, 0.55) : b > 0.7 ? mix(c.base, c.accent, 0.45) : c.base;
    if (r < 0.08) col = mix(col, c.detail, 0.6);
    return px(jitter(col, h(x, y, 5), 0.035));
  },
  cobble: (x, y, h, c) => {
    const [d1, d2, k] = cells(x, y, 7, h, 11);
    if (d2 - d1 < 1.1) return px(jitter(c.detail, h(x, y), 0.05));
    const tone = h(k, 3, 13);
    let col = tone < 0.33 ? c.base : tone < 0.66 ? mix(c.base, c.accent, 0.5) : mix(c.base, c.detail, 0.25);
    // Bevel: lighter toward the upper-left inside each stone.
    col = scale(col, 1 + Math.max(-0.12, Math.min(0.12, (2.6 - d1) * 0.04)));
    return px(jitter(col, h(x, y, 2), 0.03));
  },
  mossy: (x, y, h, c) => {
    const [d1, d2, k] = cells(x, y, 7, h, 11);
    const moss = blob(x, y, 4, h, 21) > 0.55;
    if (d2 - d1 < 1.1) return px(moss ? mix(c.accent, c.detail, 0.4) : jitter(c.detail, h(x, y), 0.05));
    const tone = h(k, 3, 13);
    const col = moss ? jitter(c.accent, h(x, y, 4), 0.1) : tone < 0.5 ? c.base : mix(c.base, c.detail, 0.25);
    return px(jitter(col, h(x, y, 2), 0.03));
  },
  dirt: (x, y, h, c) => {
    const r = h(x, y);
    const b = blob(x, y, 4, h, 9);
    let col = b < 0.4 ? mix(c.base, c.detail, 0.35) : c.base;
    if (r < 0.1) col = c.detail;
    else if (r > 0.94) col = c.accent;
    return px(jitter(col, h(x, y, 3), 0.04));
  },
  grass_top: (x, y, h, c) => {
    const r = h(x, y);
    const b = blob(x, y, 4, h, 17);
    let col = mix(c.detail, c.base, b);
    if (r > 0.9) col = c.accent;
    else if (r < 0.08) col = scale(c.detail, 0.9);
    return px(jitter(col, h(x, y, 1), 0.04));
  },
  grass_side: (x, y, h, c) => {
    // Dirt with a jagged green fringe hanging from the top.
    const fringe = 3 + Math.floor(h(x, 0, 31) * 2.4) + (h(x, 1, 31) > 0.82 ? 1 : 0);
    if (y < fringe) {
      const r = h(x, y);
      return px(jitter(r > 0.85 ? c.accent : y === fringe - 1 ? scale(c.detail, 0.85) : c.detail, h(x, y, 2), 0.05));
    }
    const r = h(x, y, 5);
    let col = c.base;
    if (r < 0.1) col = scale(c.base, 0.78);
    else if (r > 0.94) col = scale(c.base, 1.15);
    return px(jitter(col, h(x, y, 3), 0.04));
  },
  snow_side: (x, y, h, c) => {
    const fringe = 3 + Math.floor(h(x, 0, 37) * 2.2);
    if (y < fringe) return px(jitter(y === fringe - 1 ? c.accent : c.detail, h(x, y), 0.02));
    const r = h(x, y, 5);
    return px(jitter(r < 0.1 ? scale(c.base, 0.8) : c.base, h(x, y, 3), 0.04));
  },
  sand: (x, y, h, c) => {
    const r = h(x, y);
    const col = r < 0.16 ? c.detail : r > 0.88 ? c.accent : c.base;
    return px(jitter(col, h(x, y, 4), 0.025));
  },
  gravel: (x, y, h, c) => {
    const [d1, d2, k] = cells(x, y, 11, h, 41);
    if (d2 - d1 < 0.7) return px(scale(c.detail, 0.85));
    const t = h(k, 2, 43);
    const col = t < 0.34 ? c.base : t < 0.67 ? c.detail : c.accent;
    return px(jitter(col, h(x, y), 0.05 + Math.min(0.06, d1 * 0.015)));
  },
  log_side: (x, y, h, c) => {
    const col = h(x, 0, 51);
    const groove = col < 0.28 || (h(x, Math.floor(y / 5), 53) < 0.12);
    const tone = groove ? c.detail : col > 0.8 ? c.accent : c.base;
    return px(jitter(tone, h(x, y), 0.05));
  },
  log_top: (x, y, h, c) => {
    const dx = x - 7.5;
    const dy = y - 7.5;
    const d = Math.max(Math.abs(dx), Math.abs(dy));
    if (d > 6.6) return px(jitter(c.accent, h(x, y), 0.06));
    const ring = Math.floor(Math.sqrt(dx * dx + dy * dy) + h(x, y, 3) * 0.6);
    return px(jitter(ring % 2 === 0 ? c.base : c.detail, h(x, y, 4), 0.03));
  },
  birch_side: (x, y, h, c) => {
    const band = h(Math.floor(x / 3), y, 61);
    if (band < 0.09) return px(c.detail);
    if (band < 0.14) return px(mix(c.base, c.detail, 0.5));
    return px(jitter(h(x, y) > 0.86 ? c.accent : c.base, h(x, y, 2), 0.03));
  },
  planks: (x, y, h, c) => {
    const board = Math.floor(y / 4);
    const offset = Math.floor(h(board, 0, 71) * 16);
    if (y % 4 === 3) return px(scale(c.detail, 0.92));
    if ((x + offset) % 16 === 0) return px(c.detail);
    const grain = h(Math.floor((x + offset) / 3), y, 73);
    const tone = scale(c.base, 0.94 + h(board, 1, 75) * 0.12);
    return px(jitter(grain > 0.82 ? mix(tone, c.accent, 0.5) : grain < 0.12 ? mix(tone, c.detail, 0.4) : tone, h(x, y), 0.025));
  },
  leaves: (x, y, h, c) => {
    const r = h(x, y);
    if (r < 0.16) return CLEAR;
    const b = blob(x, y, 4, h, 81);
    const col = r > 0.88 ? c.accent : b < 0.45 ? c.detail : c.base;
    return px(jitter(col, h(x, y, 2), 0.06));
  },
  ore: (x, y, h, c) => {
    // Stone background with three or four clusters of mineral specks.
    const b = blob(x, y, 4, h, 3);
    let col = b < 0.35 ? mix(c.base, c.accent, 0.5) : c.base;
    for (let k = 0; k < 4; k++) {
      const cx = 2 + h(k, 0, 91) * 11;
      const cy = 2 + h(k, 1, 91) * 11;
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d < 1.6 + h(k, 2, 91) * 0.8) {
        col = d < 0.9 ? mix(c.detail, [255, 255, 255], 0.18) : c.detail;
        break;
      }
    }
    return px(jitter(col, h(x, y, 5), 0.04));
  },
  bricks: (x, y, h, c) => {
    const row = Math.floor(y / 4);
    const offset = row % 2 === 0 ? 0 : 4;
    if (y % 4 === 3 || (x + offset) % 8 === 7) return px(jitter(c.detail, h(x, y), 0.04));
    const brick = Math.floor((x + offset) / 8) + row * 3;
    const tone = scale(c.base, 0.9 + h(brick, 0, 101) * 0.2);
    const top = y % 4 === 0 ? 1.08 : 1;
    return px(jitter(scale(h(x, y, 2) > 0.9 ? c.accent : tone, top), h(x, y, 3), 0.035));
  },
  stone_bricks: (x, y, h, c) => {
    const row = Math.floor(y / 8);
    const offset = row % 2 === 0 ? 0 : 8;
    const lx = (x + offset) % 16;
    if (y % 8 === 7 || lx === 15) return px(jitter(c.detail, h(x, y), 0.04));
    if (y % 8 === 0 || lx === 0) return px(jitter(mix(c.base, c.accent, 0.5), h(x, y), 0.03));
    const b = blob(x, y, 4, h, 111);
    const moss = c.accent[1] > c.accent[0] + 20 && b > 0.62;
    return px(jitter(moss ? c.accent : b < 0.3 ? mix(c.base, c.detail, 0.3) : c.base, h(x, y, 2), 0.035));
  },
  glass: (x, y, h, c) => {
    const edge = x === 0 || y === 0 || x === 15 || y === 15;
    if (edge) return px(c.base, 235);
    // A few diagonal glints.
    if ((x + y === 11 || x + y === 12 || x + y === 20) && x > 2 && x < 13) return px(c.detail, 150);
    return h(x, y) > 0.985 ? px(c.accent, 90) : CLEAR;
  },
  glow: (x, y, h, c) => {
    const [d1, d2, k] = cells(x, y, 6, h, 121);
    if (d2 - d1 < 0.9) return px(scale(c.accent, 0.95));
    const t = h(k, 0, 123);
    return px(jitter(t > 0.5 ? c.detail : c.base, h(x, y), 0.06));
  },
  torch: (x, y, _h, c) => {
    if (x >= 7 && x <= 8 && y >= 6) return px(x === 7 ? c.base : scale(c.base, 0.8));
    if (x >= 6 && x <= 9 && y >= 3 && y <= 5) return px(y === 3 ? c.accent : c.detail);
    if (x >= 7 && x <= 8 && y === 2) return px(c.accent);
    return CLEAR;
  },
  flower: (x, y, h, c) => {
    const stem = x >= 7 && x <= 8 && y >= 7;
    const leaf = (y === 11 && x >= 5 && x <= 6) || (y === 10 && x >= 9 && x <= 10);
    if (stem || leaf) return px(jitter(c.detail, h(x, y), 0.08));
    const dx = x - 7.5;
    const dy = y - 4.5;
    const d = Math.hypot(dx, dy);
    if (d < 1.2) return px(c.accent);
    if (d < 3.3 && (Math.abs(dx) < 1.2 || Math.abs(dy) < 1.2 || d < 2.5)) return px(jitter(c.base, h(x, y, 2), 0.08));
    return CLEAR;
  },
  tall_grass: (x, y, h, c) => {
    // Blades: each column has a random height; brighter tips.
    const height = Math.floor(5 + h(x, 0, 131) * 10);
    if (h(x, 2, 131) < 0.28) return CLEAR;
    if (15 - y >= height) return CLEAR;
    const tip = 15 - y >= height - 2;
    return px(jitter(tip ? c.accent : y > 12 ? scale(c.detail, 0.85) : c.base, h(x, y), 0.06));
  },
  dead_bush: (x, y, _h, c) => {
    const twig =
      (x === 7 && y >= 8) || (x === 8 && y >= 11) || (y === x - 1 && y >= 3 && y < 9 && x > 3) || (x + y === 15 && y >= 4 && y < 9) ||
      (x === 3 && y >= 4 && y <= 6) || (x === 12 && y >= 3 && y <= 5);
    return twig ? px(y < 7 ? c.detail : c.base) : CLEAR;
  },
  cactus_side: (x, y, h, c) => {
    if (x === 0 || x === 15) return CLEAR;
    if ((x === 3 || x === 8 || x === 12) && (y % 4 === 1)) return px(c.accent);
    const ridge = x % 4 === 2;
    return px(jitter(ridge ? c.detail : c.base, h(x, y), 0.04));
  },
  cactus_top: (x, y, h, c) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    if (d > 6.6) return CLEAR;
    return px(jitter(d < 2.6 ? c.detail : c.base, h(x, y), 0.04));
  },
  water: (x, y, h, c) => {
    const wave = Math.sin((x + y * 0.6) * 0.8 + h(0, y, 141) * 2) * 0.5 + 0.5;
    const col = wave > 0.86 ? c.accent : wave < 0.2 ? c.detail : c.base;
    return px(jitter(col, h(x, y), 0.03));
  },
  lava: (x, y, h, c) => {
    const [d1, d2] = cells(x, y, 6, h, 151);
    const crack = d2 - d1;
    const col = crack < 1.0 ? c.detail : crack < 2.2 ? mix(c.base, c.detail, 0.45) : d1 > 3.4 ? c.accent : c.base;
    return px(jitter(col, h(x, y), 0.04));
  },
  wool: (x, y, h, c) => {
    const knit = (x + (y % 2)) % 2 === 0 ? 1.04 : 0.96;
    const r = h(x, y);
    return px(jitter(scale(c.base, knit * (r < 0.07 ? 0.88 : 1)), h(x, y, 2), 0.03));
  },
  tiles: (x, y, h, c) => {
    const row = Math.floor(y / 4);
    const offset = row % 2 === 0 ? 0 : 2;
    const lx = (x + offset) % 4;
    const ly = y % 4;
    if (ly === 3) return px(c.detail);
    if (lx === 3 && ly >= 1) return px(mix(c.base, c.detail, 0.6));
    return px(jitter(ly === 0 ? c.accent : c.base, h(x, y), 0.04));
  },
  bookshelf: (x, y, h, c) => {
    if (y === 0 || y === 15 || y === 7 || y === 8) return px(jitter(c.base, h(x, y), 0.04));
    if (x === 0 || x === 15) return px(c.base);
    const book = Math.floor(x / 2);
    const shelf = y < 7 ? 0 : 1;
    const t = h(book, shelf, 161);
    if (t < 0.12) return px(scale(c.base, 0.45));
    const palette: RGB[] = [c.detail, c.accent, [64, 120, 74], [190, 160, 92], [120, 72, 140]];
    const col = palette[Math.floor(t * palette.length) % palette.length] as RGB;
    const spine = (y === 2 || y === 11) && x % 2 === 0 ? 1.25 : 1;
    return px(jitter(scale(col, spine * (x % 2 === 0 ? 1 : 0.85)), h(x, y), 0.03));
  },
  table_top: (x, y, h, c) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return px(c.detail);
    if (x === 7 || y === 7) return px(scale(c.detail, 1.1));
    return px(jitter(h(x, y) > 0.9 ? c.accent : c.base, h(x, y, 2), 0.04));
  },
  table_side: (x, y, h, c) => {
    if (y <= 2) return px(jitter(scale(c.base, 1.15), h(x, y), 0.03));
    if (y === 3) return px(c.detail);
    // A saw blade and a hammer hanging on the side.
    if (y >= 6 && y <= 9 && x >= 2 && x <= 6) return px(y === 9 && x % 2 === 0 ? scale(c.accent, 0.7) : c.accent);
    if (x === 11 && y >= 5 && y <= 12) return px(c.detail);
    if (y === 5 && x >= 9 && x <= 13) return px(scale(c.accent, 0.8));
    return px(jitter(y % 4 === 3 ? c.detail : c.base, h(x, y, 2), 0.04));
  },
  hay_side: (x, y, h, c) => {
    if (y === 3 || y === 12) return px(c.detail);
    return px(jitter(h(x, 0, 171) > 0.7 ? c.accent : c.base, h(x, y), 0.06));
  },
  hay_top: (x, y, h, c) => {
    const d = Math.hypot(x - 7.5, y - 7.5);
    return px(jitter(Math.floor(d + h(x, y) * 0.8) % 3 === 0 ? c.detail : h(x, y, 3) > 0.8 ? c.accent : c.base, h(x, y, 2), 0.05));
  },
  metal: (x, y, h, c) => {
    if (x === 0 || y === 0) return px(c.accent);
    if (x === 15 || y === 15) return px(c.detail);
    if ((x === 2 || x === 13) && (y === 2 || y === 13)) return px(c.detail);
    const sheen = x + y < 10 ? 1.05 : 1;
    return px(jitter(scale(c.base, sheen), h(x, y), 0.02));
  },
  ice: (x, y, h, c) => {
    const crack = (x * 2 + y) % 13 === 0 || (x + y * 3) % 17 === 0;
    return px(crack ? c.accent : jitter(blob(x, y, 8, h, 181) > 0.5 ? c.base : c.detail, h(x, y), 0.02));
  },
  obsidian: (x, y, h, c) => {
    const b = blob(x, y, 4, h, 191);
    const r = h(x, y);
    return px(r > 0.93 ? c.detail : b > 0.6 ? mix(c.base, c.detail, 0.35) : b < 0.25 ? c.accent : c.base);
  },
  bedrock: (x, y, h, c) => {
    const b = blob(x, y, 2, h, 201);
    return px(jitter(b < 0.33 ? c.detail : b > 0.66 ? c.accent : c.base, h(x, y), 0.05));
  },
  stripes: (x, y, h, c) => px(jitter(Math.floor(y / 2) % 2 === 0 ? c.base : c.detail, h(x, y), 0.03)),
  dots: (x, y, h, c) => px(jitter((x % 4 === 1 && y % 4 === 1) || (x % 4 === 3 && y % 4 === 3) ? c.detail : c.base, h(x, y), 0.03)),
  sandstone: (x, y, h, c) => {
    if (y <= 2) return px(jitter(c.accent, h(x, y), 0.03));
    if (y === 3 || y === 12) return px(c.detail);
    if (y >= 13) return px(jitter(mix(c.base, c.detail, 0.35), h(x, y), 0.03));
    return px(jitter(h(x, y, 2) < 0.1 ? c.detail : c.base, h(x, y), 0.025));
  },
};

/** Paint one tile into `out` (RGBA) at tile slot `slot`. */
export function paintTile(spec: TileSpec, slot: number, out: Uint8Array, atlasSize = ATLAS_SIZE): void {
  const painter = PAINTERS[spec.pattern] ?? PAINTERS.noise;
  const base = rgb(spec.base);
  const colors = { base, detail: rgb(spec.detail, scale(base, 0.8)), accent: rgb(spec.accent, scale(base, 1.15)) };
  const perRow = atlasSize / TILE_SIZE;
  const ox = (slot % perRow) * TILE_SIZE;
  const oy = Math.floor(slot / perRow) * TILE_SIZE;
  // Per-tile salt so identical patterns with different colors still differ slightly.
  let salt = 0;
  for (let i = 0; i < spec.base.length; i++) salt = (salt * 31 + spec.base.charCodeAt(i)) | 0;
  const h = (x: number, y: number, s = 0): number => hash3(x, y, s, salt ^ 0x5bd1e995) / 4294967296;
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const [r, g, b, a] = painter(x, y, h, colors);
      const i = ((oy + y) * atlasSize + ox + x) * 4;
      out[i] = clampByte(r);
      out[i + 1] = clampByte(g);
      out[i + 2] = clampByte(b);
      out[i + 3] = clampByte(a);
    }
  }
}

function clampByte(v: number): number {
  return v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v);
}

/** Paint every tile of a registry into a fresh atlas. */
export function buildAtlas(reg: BlockRegistry): BlockAtlas {
  const pixels = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4);
  const n = Math.min(reg.tiles.length, ATLAS_TILES * ATLAS_TILES);
  for (let i = 0; i < n; i++) paintTile(reg.tiles[i] as TileSpec, i, pixels);
  return { pixels, size: ATLAS_SIZE, tilesPerRow: ATLAS_TILES, tileSize: TILE_SIZE, tiles: n };
}

/** Average opaque color of a painted tile (item icons, particles). */
export function tileAverage(atlas: BlockAtlas, slot: number): [number, number, number] {
  const ox = (slot % atlas.tilesPerRow) * atlas.tileSize;
  const oy = Math.floor(slot / atlas.tilesPerRow) * atlas.tileSize;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = 0; y < atlas.tileSize; y++) {
    for (let x = 0; x < atlas.tileSize; x++) {
      const i = ((oy + y) * atlas.size + ox + x) * 4;
      if ((atlas.pixels[i + 3] as number) < 128) continue;
      r += atlas.pixels[i] as number;
      g += atlas.pixels[i + 1] as number;
      b += atlas.pixels[i + 2] as number;
      n++;
    }
  }
  return n === 0 ? [0, 0, 0] : [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}
