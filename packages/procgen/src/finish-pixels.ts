/**
 * Procedural texture synthesis of the physically based finishes
 * (@aether/arch `FINISHES`): seamlessly tileable albedo, roughness / AO and
 * tangent-space normal maps generated in plain TypeScript, so a hardwood
 * floor, a marble counter or a brick facade look the same on WebGPU and
 * WebGL2 and no third-party image asset is needed.
 *
 * One texture tile covers `FinishDef.tile` metres (geometry carries metre
 * UVs). Albedo is stored as a *ratio* to the finish's base colour, scaled
 * into 8 bits by {@link finishAlbedoScale}: the renderer sets the material
 * colour to `base × scale`, so a tintable finish (paint, fabric, tiles)
 * recolours with `material.color` while keeping its pattern, and a natural
 * one (woods, marble) keeps its grain under a tint.
 *
 * Pure and deterministic (seeded per finish), so it runs identically in the
 * compute worker, inline, and in Node tests.
 */
import { FINISHES, type FinishDef } from '@aether/arch';
import { rng, type MaterialFinish } from '@aether/core';

/** Default texture edge length (pixels, power of two). */
export const FINISH_TEXTURE_SIZE = 256;
/** Largest texture edge the synthesiser accepts. */
export const MAX_FINISH_TEXTURE_SIZE = 1024;

/** Pixels of one finish: three RGBA8 images of `size × size`. */
export interface FinishPixels {
  size: number;
  /** Albedo ratio to the base colour, divided by {@link finishAlbedoScale} (linear, not sRGB). */
  albedo: Uint8Array;
  /** R = ambient occlusion, G = roughness (absolute), B = lit-window mask (facades; 0 elsewhere), A = 255 (three's ORM layout). */
  orm: Uint8Array;
  /** Tangent-space normal map (flat = 128, 128, 255). */
  normal: Uint8Array;
}

/** Per-pixel fields a pattern writes before composition. */
interface Fields {
  n: number;
  /** Height (0..1): grout, seams and grain valleys are low. */
  height: Float32Array;
  /** Accent mix (0 = base colour, 1 = accent colour). */
  accent: Float32Array;
  /** Brightness multiplier (per board / tile / stone tint variation, mottling). */
  shade: Float32Array;
  /** Roughness multiplier around the finish roughness. */
  rough: Float32Array;
  /** Cavity darkening (1 = none). */
  ao: Float32Array;
  /** Emission mask (facade windows that glow after dark); written to the ORM blue channel when a pattern sets it. */
  lit?: Float32Array;
}

function hexRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return [lin(((n >> 16) & 255) / 255), lin(((n >> 8) & 255) / 255), lin((n & 255) / 255)];
}

/** Brightest shade multiplier any pattern writes (variation above the base). */
const MAX_SHADE = 1.18;

/**
 * Factor dividing the albedo ratios so they fit in 8 bits (accents lighter
 * than the base, e.g. light mortar between dark bricks, and bright shade
 * variation give ratios above 1). The material colour is multiplied by it.
 */
export function finishAlbedoScale(def: Pick<FinishDef, 'color' | 'accent'>): number {
  const b = hexRgb(def.color);
  const a = hexRgb(def.accent);
  let m = 1;
  for (let i = 0; i < 3; i++) m = Math.max(m, (a[i] as number) / Math.max(1e-4, b[i] as number));
  return m * MAX_SHADE;
}

// --- tileable noise ------------------------------------------------------------

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Tileable value-noise lattice of `period × period` random values. */
function lattice(random: () => number, period: number): Float32Array {
  const l = new Float32Array(period * period);
  for (let i = 0; i < l.length; i++) l[i] = random();
  return l;
}

function sampleLattice(l: Float32Array, period: number, x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = smooth(x - xi);
  const fy = smooth(y - yi);
  const x0 = ((xi % period) + period) % period;
  const y0 = ((yi % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;
  const a = (l[y0 * period + x0] as number) + ((l[y0 * period + x1] as number) - (l[y0 * period + x0] as number)) * fx;
  const b = (l[y1 * period + x0] as number) + ((l[y1 * period + x1] as number) - (l[y1 * period + x0] as number)) * fx;
  return a + (b - a) * fy;
}

/**
 * Tileable fractal noise in [0, 1]: `octaves` octaves starting at `px × py`
 * cells per tile (anisotropic when they differ, e.g. wood grain).
 */
function fbmField(random: () => number, n: number, px: number, py: number, octaves: number): Float32Array {
  const out = new Float32Array(n * n);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const fx = px << o;
    const fy = py << o;
    const p = Math.max(fx, fy);
    const l = lattice(random, p);
    // Sample a p×p lattice at (u·fx, v·fy): periods fx and fy divide p only when equal, so
    // anisotropic octaves use separate lattices per axis period (fx, fy ≤ p, both powers of two).
    for (let y = 0; y < n; y++) {
      const v = (y / n) * fy;
      for (let x = 0; x < n; x++) {
        const k = y * n + x;
        out[k] = (out[k] as number) + amp * sampleAniso(l, fx, fy, (x / n) * fx, v);
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) / total;
  return out;
}

/** Value noise with independent integer periods per axis (lattice sized max(px, py)²). */
function sampleAniso(l: Float32Array, px: number, py: number, x: number, y: number): number {
  const p = Math.max(px, py);
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = smooth(x - xi);
  const fy = smooth(y - yi);
  const x0 = ((xi % px) + px) % px;
  const y0 = ((yi % py) + py) % py;
  const x1 = (x0 + 1) % px;
  const y1 = (y0 + 1) % py;
  const a = (l[y0 * p + x0] as number) + ((l[y0 * p + x1] as number) - (l[y0 * p + x0] as number)) * fx;
  const b = (l[y1 * p + x0] as number) + ((l[y1 * p + x1] as number) - (l[y1 * p + x0] as number)) * fx;
  return a + (b - a) * fy;
}

/** Hash of an integer cell (deterministic per finish seed) in [0, 1). */
function cellHash(seed: number, i: number, j: number): number {
  let h = (seed ^ Math.imul(i, 374761393) ^ Math.imul(j, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Distance to the nearest / second nearest feature point of a tileable Worley grid (`cells` per tile). */
function worley(seed: number, cells: number, u: number, v: number, out: { f1: number; f2: number; id: number }): void {
  const px = u * cells;
  const py = v * cells;
  const cx = Math.floor(px);
  const cy = Math.floor(py);
  let f1 = Infinity;
  let f2 = Infinity;
  let id = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const gx = cx + dx;
      const gy = cy + dy;
      const wx = ((gx % cells) + cells) % cells;
      const wy = ((gy % cells) + cells) % cells;
      const fx = gx + 0.15 + 0.7 * cellHash(seed, wx, wy) - px;
      const fy = gy + 0.15 + 0.7 * cellHash(seed + 17, wx, wy) - py;
      const d = Math.sqrt(fx * fx + fy * fy);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = wy * cells + wx;
      } else if (d < f2) f2 = d;
    }
  }
  out.f1 = f1;
  out.f2 = f2;
  out.id = id;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Soft groove profile: 0 inside a joint of half-width `w` (in pixels), 1 away from it. */
function joint(distPx: number, w: number): number {
  return smooth(clamp01((distPx - w) / Math.max(1, w * 1.2)));
}

// --- patterns -------------------------------------------------------------------

type Pattern = (f: Fields, random: () => number, seed: number) => void;

/** Board floors: `rows` boards per tile across V, each split once along U at a random stagger. */
function boards(rows: number, gapPx: number, gapDepth: number, grainContrast: number): Pattern {
  return (f, random, seed) => {
    const n = f.n;
    const grain = fbmField(random, n, 2, 32, 3);
    const figure = fbmField(random, n, 4, 4, 3);
    const rowPx = n / rows;
    for (let y = 0; y < n; y++) {
      const row = Math.floor(y / rowPx);
      const inRow = y - row * rowPx;
      const stagger = cellHash(seed, row, 1) * n;
      for (let x = 0; x < n; x++) {
        const k = y * n + x;
        const ux = (x + stagger) % n;
        const board = ux < n / 2 ? 0 : 1;
        const endDist = Math.min(ux, Math.abs(ux - n / 2), n - ux);
        const edge = Math.min(inRow, rowPx - inRow);
        const seam = Math.min(joint(edge, gapPx), joint(endDist, gapPx));
        const bh = cellHash(seed + 5, row, board);
        // Grain: long streaks plus ring figure warped by low-frequency noise.
        const g = grain[k] as number;
        const rings = 0.5 + 0.5 * Math.sin(((y / n) * rows * 3 + (figure[k] as number) * 6 + bh * 9) * Math.PI);
        const streak = clamp01((g - 0.35) * 2.2);
        const a = clamp01(0.18 + bh * 0.35 + streak * grainContrast * 0.6 + rings * grainContrast * 0.25);
        f.accent[k] = a;
        f.shade[k] = 0.9 + bh * 0.2;
        f.height[k] = seam * (0.85 + 0.15 * g) + (1 - seam) * (1 - gapDepth);
        f.rough[k] = 0.9 + 0.25 * streak + (1 - seam) * 0.3;
        f.ao[k] = 0.55 + 0.45 * seam;
      }
    }
  };
}

/** Herringbone parquet: boards 1 × `len` widths, `p = 2·len` widths per tile. */
function herringbone(len: number): Pattern {
  return (f, random, seed) => {
    const n = f.n;
    const grain = fbmField(random, n, 4, 32, 3);
    const period = 2 * len;
    const px = n / period;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const k = y * n + x;
        const bx = x / px;
        const by = y / px;
        let hit = -1;
        let edge = 0;
        let horizontal = false;
        // Boards of one diagonal chain: V_j = [j, j+1] × [j, j+len], H_j = [j+1, j+1+len] × [j, j+1];
        // chains repeat by (len, −len). Search the chains that can cover (bx, by).
        const m0 = Math.floor((bx - by) / (2 * len));
        for (let m = m0 - 1; m <= m0 + 1 && hit < 0; m++) {
          const sx = bx - m * len;
          const sy = by + m * len;
          const jv = Math.floor(sx);
          if (sy >= jv && sy < jv + len) {
            hit = cellHash(seed, jv, m) * 997;
            edge = Math.min(sx - jv, jv + 1 - sx, sy - jv, jv + len - sy);
            horizontal = false;
            break;
          }
          const jh = Math.floor(sy);
          if (sx >= jh + 1 && sx < jh + 1 + len) {
            hit = cellHash(seed + 3, jh, m) * 997;
            edge = Math.min(sx - jh - 1, jh + 1 + len - sx, sy - jh, jh + 1 - sy);
            horizontal = true;
          }
        }
        const bh = hit >= 0 ? (hit % 1) : 0.5;
        const seam = joint(edge * px, 0.8);
        const g = horizontal ? (grain[k] as number) : (grain[x * n + y] as number);
        const streak = clamp01((g - 0.35) * 2.2);
        f.accent[k] = clamp01(0.15 + bh * 0.4 + streak * 0.45);
        f.shade[k] = 0.9 + bh * 0.18;
        f.height[k] = 0.15 + 0.85 * seam;
        f.rough[k] = 0.9 + 0.25 * streak + (1 - seam) * 0.3;
        f.ao[k] = 0.6 + 0.4 * seam;
      }
    }
  };
}

/** Marble: soft clouds plus sharp, warped veins. */
const veined: Pattern = (f, random) => {
  const n = f.n;
  const warp = fbmField(random, n, 2, 2, 5);
  const cloud = fbmField(random, n, 4, 4, 4);
  const fine = fbmField(random, n, 8, 8, 3);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const k = y * n + x;
      const u = x / n;
      const v = y / n;
      // A few thin veins running diagonally, a faint second set and soft cloudiness: polished white marble, not frost.
      const t = (u * 1 + v * 1) * Math.PI * 2 + (warp[k] as number) * 7;
      const vein = Math.pow(1 - Math.abs(Math.sin(t)), 46);
      const vein2 = Math.pow(1 - Math.abs(Math.sin(t * 2.3 + (fine[k] as number) * 4)), 60) * 0.3;
      const a = clamp01(vein * 0.75 + vein2 + ((cloud[k] as number) - 0.5) * 0.12);
      f.accent[k] = a;
      f.shade[k] = 0.97 + ((cloud[k] as number) - 0.5) * 0.1;
      f.height[k] = 1 - a * 0.1;
      f.rough[k] = 1 + a * 0.6;
      f.ao[k] = 1;
    }
  }
};

/** Terrazzo: chips of three tones in a fine matrix. */
const speckle: Pattern = (f, random, seed) => {
  const n = f.n;
  const w = { f1: 0, f2: 0, id: 0 };
  const w2 = { f1: 0, f2: 0, id: 0 };
  const mottle = fbmField(random, n, 8, 8, 2);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const k = y * n + x;
      worley(seed, 14, x / n, y / n, w);
      worley(seed + 99, 30, x / n, y / n, w2);
      const big = w.f1 < 0.22 + 0.12 * cellHash(seed, w.id, 7) ? 1 : 0;
      const small = w2.f1 < 0.18 ? 1 : 0;
      const tone = big ? cellHash(seed, w.id, 3) : small ? cellHash(seed, w2.id, 5) : -1;
      f.accent[k] = tone < 0 ? 0.08 * (mottle[k] as number) : tone < 0.5 ? 0.85 : 0.35;
      f.shade[k] = tone < 0 ? 1 : tone > 0.8 ? MAX_SHADE / 1.02 : 0.95;
      f.height[k] = 0.95 + 0.05 * (mottle[k] as number);
      f.rough[k] = tone < 0 ? 1.1 : 0.8;
      f.ao[k] = 1;
    }
  }
};

/** Plaster / concrete: layered mottling and fine pores. */
function mottled(strength: number, pores: number): Pattern {
  return (f, random) => {
    const n = f.n;
    const low = fbmField(random, n, 3, 3, 4);
    const fine = fbmField(random, n, 32, 32, 2);
    for (let i = 0; i < n * n; i++) {
      const l = low[i] as number;
      const p = fine[i] as number;
      f.accent[i] = clamp01((l - 0.5) * 1.6 * strength + 0.5 * strength);
      f.shade[i] = 1 - strength * 0.06 + (p - 0.5) * 0.05;
      f.height[i] = 0.5 + (l - 0.5) * 0.12 + (p - 0.5) * pores;
      f.rough[i] = 1 + (p - 0.5) * 0.15;
      f.ao[i] = 1 - pores * 0.25 * clamp01(0.4 - p);
    }
  };
}

/** Grid tiles: `cells × cells` per tile, grout of `groutPx`. */
function gridTiles(cells: number, groutPx: number, rowsPerCell = 1, stagger = false): Pattern {
  return (f, random, seed) => {
    const n = f.n;
    const cw = n / cells;
    const ch = n / (cells * rowsPerCell);
    const glaze = fbmField(random, n, 8, 8, 2);
    for (let y = 0; y < n; y++) {
      const row = Math.floor(y / ch);
      const off = stagger && row % 2 === 1 ? cw / 2 : 0;
      const iy = y - row * ch;
      for (let x = 0; x < n; x++) {
        const k = y * n + x;
        const xs = (x + off) % n;
        const col = Math.floor(xs / cw);
        const ix = xs - col * cw;
        const d = Math.min(ix, cw - ix, iy, ch - iy);
        const g = joint(d, groutPx);
        const th = cellHash(seed, col, row);
        f.accent[k] = 1 - g;
        f.shade[k] = g * (0.95 + th * 0.08 + ((glaze[k] as number) - 0.5) * 0.03) + (1 - g);
        // Tiles bevel into the grout.
        f.height[k] = 0.2 + 0.8 * Math.sqrt(g);
        f.rough[k] = g + (1 - g) * 3;
        f.ao[k] = 0.65 + 0.35 * g;
      }
    }
  };
}

/** Flagstone: irregular stones (Worley cells) with mortar joints. */
const flagstone: Pattern = (f, random, seed) => {
  const n = f.n;
  const w = { f1: 0, f2: 0, id: 0 };
  const rough = fbmField(random, n, 8, 8, 3);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const k = y * n + x;
      worley(seed, 4, x / n, y / n, w);
      const edge = (w.f2 - w.f1) * (n / 4);
      const g = joint(edge, 1.3);
      const th = cellHash(seed, w.id, 11);
      const r = rough[k] as number;
      f.accent[k] = clamp01((1 - g) * 0.75 + th * 0.2 + (r - 0.5) * 0.3);
      f.shade[k] = 0.92 + th * 0.12;
      f.height[k] = 0.25 + 0.75 * g * (0.8 + 0.2 * r);
      f.rough[k] = 1 + (1 - g) * 0.2;
      f.ao[k] = 0.55 + 0.45 * g;
    }
  }
};

/**
 * Natural rock face: soft large-scale tone patches, a mid-scale mottling, fine grain and a few thin irregular cracks. No regular
 * joints (a paving pattern on a boulder reads as crazy paving), so it works on any mesh, boulders and cliffs alike.
 */
const granite: Pattern = (f, random, seed) => {
  const n = f.n;
  const w = { f1: 0, f2: 0, id: 0 };
  const big = fbmField(random, n, 4, 4, 4);
  const mid = fbmField(random, n, 16, 16, 3);
  const grain = fbmField(random, n, 64, 64, 2);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const k = y * n + x;
      worley(seed, 3, x / n, y / n, w);
      const edge = (w.f2 - w.f1) * (n / 3);
      // A crack only where two cells almost meet and the mid-scale noise agrees: thin, broken, never a grid.
      const crack = (1 - joint(edge, 0.7)) * clamp01(((mid[k] as number) - 0.42) * 6);
      const b = big[k] as number;
      const m = mid[k] as number;
      const g = grain[k] as number;
      f.accent[k] = clamp01(0.3 + (b - 0.5) * 0.8 + (m - 0.5) * 0.4 + (g - 0.5) * 0.3 + crack * 0.35);
      f.shade[k] = 0.9 + m * 0.18 - crack * 0.2;
      f.height[k] = clamp01(0.45 + (b - 0.5) * 0.5 + (m - 0.5) * 0.35 + (g - 0.5) * 0.25 - crack * 0.3);
      f.rough[k] = 1 + (g - 0.5) * 0.25;
      f.ao[k] = 0.8 + 0.2 * (1 - crack);
    }
  }
};

/** Bricks in running bond: `cols` bricks per row, `rows` courses per tile. */
function bricks(cols: number, rows: number, mortarPx: number): Pattern {
  return (f, random, seed) => {
    const n = f.n;
    const cw = n / cols;
    const ch = n / rows;
    const surf = fbmField(random, n, 16, 16, 3);
    for (let y = 0; y < n; y++) {
      const row = Math.floor(y / ch);
      const iy = y - row * ch;
      const off = row % 2 === 1 ? cw / 2 : 0;
      for (let x = 0; x < n; x++) {
        const k = y * n + x;
        const xs = (x + off) % n;
        const col = Math.floor(xs / cw);
        const ix = xs - col * cw;
        const g = joint(Math.min(ix, cw - ix, iy, ch - iy), mortarPx);
        const th = cellHash(seed, col, row);
        const s = surf[k] as number;
        f.accent[k] = 1 - g;
        f.shade[k] = 1 + g * (th * 0.3 - 0.18 + (s - 0.5) * 0.12);
        f.height[k] = 0.15 + 0.85 * g * (0.85 + 0.15 * s);
        f.rough[k] = 1;
        f.ao[k] = 0.5 + 0.5 * g;
      }
    }
  };
}

/**
 * Building facade: 4 × 4 window bays per tile. Each bay is a recessed glass pane in a mullioned frame over a
 * spandrel wall; panes vary in tint and reflectivity, some have blinds drawn, and the panes are marked in the `lit` mask (the
 * renderer lights a share of them after dark). Everything is deterministic from the finish seed.
 */
const facade: Pattern = (f, random, seed) => {
  const n = f.n;
  const bays = 4;
  const cell = n / bays;
  const lit = new Float32Array(n * n);
  f.lit = lit;
  const grain = fbmField(random, n, 24, 24, 2);
  const px = n / 256;
  for (let y = 0; y < n; y++) {
    const fy = Math.floor(y / cell);
    const iy = y - fy * cell;
    for (let x = 0; x < n; x++) {
      const k = y * n + x;
      const fx = Math.floor(x / cell);
      const ix = x - fx * cell;
      // Pane rectangle inside the bay: 2.1 m wide, 1.9 m tall, sill 0.5 m above the floor line.
      const left = cell * 0.15;
      const right = cell * 0.85;
      const top = cell * 0.2;
      const bottom = cell * 0.83;
      const dIn = Math.min(ix - left, right - ix, iy - top, bottom - iy);
      const pane = aaStep(dIn, 3 * px, 1 * px);
      const frame = aaStep(dIn, -1 * px, 1 * px) * (1 - pane);
      const h = cellHash(seed, fx, fy);
      const h2 = cellHash(seed + 31, fx, fy);
      const blind = h2 < 0.14 ? 1 : 0;
      const g = grain[k] as number;
      // Wall: weathered, with a slab edge line at each floor.
      const slab = 1 - aaStep(Math.abs(iy - cell * 0.97), 1.5 * px, 1 * px) * 0.0;
      const wallShade = 0.9 + (g - 0.5) * 0.25 + (iy > cell * 0.93 ? -0.1 : 0) * slab;
      const paneShade = 0.55 + h * 0.85;
      f.accent[k] = pane * (blind ? 0.35 : 1);
      f.shade[k] = pane > 0.5 ? paneShade : frame > 0.5 ? 0.62 : wallShade;
      f.height[k] = pane > 0.5 ? 0.15 : frame > 0.5 ? 1 : 0.7 + (g - 0.5) * 0.06;
      f.rough[k] = pane > 0.5 ? (blind ? 1.4 : 0.22) : frame > 0.5 ? 0.8 : 1.5 + (g - 0.5) * 0.3;
      f.ao[k] = pane > 0.5 ? 0.65 + 0.35 * clamp01(dIn / (14 * px)) : frame > 0.5 ? 0.8 : 1;
      // Every pane may glow; which ones do is decided per window in the shader (world position hash), so the 4 × 4 tile's lit pattern never repeats.
      // What the glow shows: a lit room, not a flat pane. Ceiling wash (brightest under the ceiling), furniture dark at the sill,
      // curtains at the sides, a mullion cross in some panes and drawn blinds as slats.
      let room = 0;
      if (pane > 0.5) {
        const pu = (ix - left) / (right - left);
        const pv = (iy - top) / (bottom - top);
        room = 1 - 0.5 * pv;
        if (cellHash(seed + 77, fx, fy) < 0.5 && pv > 0.7) room *= 0.4 + 0.3 * Math.abs(Math.sin(pu * 7));
        if (cellHash(seed + 53, fx, fy) < 0.4 && (pu < 0.17 || pu > 0.83)) room *= 0.5;
        if (Math.abs(pu - 0.5) < 0.018 || (cellHash(seed + 91, fx, fy) < 0.3 && Math.abs(pv - 0.5) < 0.018)) room *= 0.12;
        if (blind) room = 0.35 + 0.3 * (0.5 + 0.5 * Math.sin(pv * Math.PI * 14));
      }
      lit[k] = pane * room;
    }
  }
};

/** Woven fabric: over-under threads. */
function weave(threads: number, depth: number): Pattern {
  return (f, random) => {
    const n = f.n;
    const fuzz = fbmField(random, n, 32, 32, 2);
    const slub = fbmField(random, n, 4, 64, 2);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const k = y * n + x;
        const u = (x / n) * threads;
        const v = (y / n) * threads;
        const cu = Math.floor(u);
        const cv = Math.floor(v);
        const warpOver = (cu + cv) % 2 === 0;
        const fu = u - cu;
        const fv = v - cv;
        const h = warpOver ? Math.sin(fv * Math.PI) * 0.6 + Math.sin(fu * Math.PI) * 0.4 : Math.sin(fu * Math.PI) * 0.6 + Math.sin(fv * Math.PI) * 0.4;
        f.height[k] = 0.5 + (h - 0.5) * depth + ((fuzz[k] as number) - 0.5) * 0.12;
        // Even cloth: the thread relief carries the look; the slub streaks stay faint (strong ones read as marble on white linen).
        f.accent[k] = clamp01((1 - h) * 0.45 + ((slub[k] as number) - 0.5) * 0.18);
        f.shade[k] = 1;
        f.rough[k] = 1;
        f.ao[k] = 0.85 + 0.15 * h;
      }
    }
  };
}

/** Velvet / carpet pile: soft fine noise with directional crush. */
function pile(cells: number, crush: number): Pattern {
  return (f, random) => {
    const n = f.n;
    const fine = fbmField(random, n, cells, cells, 2);
    const crushF = fbmField(random, n, 2, 2, 3);
    for (let i = 0; i < n * n; i++) {
      const p = fine[i] as number;
      const c = crushF[i] as number;
      f.accent[i] = clamp01((1 - p) * 0.5 + (c - 0.5) * crush);
      f.shade[i] = 1;
      f.height[i] = p;
      f.rough[i] = 1;
      f.ao[i] = 0.75 + 0.25 * p;
    }
  };
}

/** Pebbled leather grain. */
const leatherGrain: Pattern = (f, random, seed) => {
  const n = f.n;
  const w = { f1: 0, f2: 0, id: 0 };
  const wear = fbmField(random, n, 3, 3, 3);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const k = y * n + x;
      worley(seed, 40, x / n, y / n, w);
      const crease = clamp01((w.f2 - w.f1) * 4);
      const we = wear[k] as number;
      f.height[k] = 0.3 + 0.7 * crease;
      f.accent[k] = clamp01((1 - crease) * 0.5 + (we - 0.5) * 0.8);
      f.shade[k] = 0.95 + (we - 0.5) * 0.12;
      f.rough[k] = 0.85 + (1 - crease) * 0.4 - (we - 0.5) * 0.3;
      f.ao[k] = 0.8 + 0.2 * crease;
    }
  }
};

/** Brushed metal: fine streaks along U. */
const brushed: Pattern = (f, random) => {
  const n = f.n;
  const streak = fbmField(random, n, 1, 128, 2);
  const low = fbmField(random, n, 2, 2, 2);
  for (let i = 0; i < n * n; i++) {
    const s = streak[i] as number;
    f.accent[i] = clamp01((s - 0.5) * 1.5 + 0.5) * 0.6;
    f.shade[i] = 1;
    f.height[i] = 0.5 + (s - 0.5) * 0.3;
    f.rough[i] = 0.85 + (s - 0.5) * 0.5 + ((low[i] as number) - 0.5) * 0.2;
    f.ao[i] = 1;
  }
};

/**
 * Barely-there surface (paint, glaze, glass, mirror). The relief is fine grain only (orange-peel
 * scale): a low-frequency height field has slopes far below one 8-bit normal step, so the normal map
 * turns into hard-edged bands that a close light at a grazing angle (a pendant under a ceiling)
 * draws as blotches. Only the albedo keeps a very soft, low-frequency wash.
 */
function subtle(amount: number, cells: number): Pattern {
  return (f, random) => {
    const n = f.n;
    const low = fbmField(random, n, cells, cells, 3);
    const grain = fbmField(random, n, 64, 64, 2);
    for (let i = 0; i < n * n; i++) {
      const l = low[i] as number;
      const g = grain[i] as number;
      f.accent[i] = clamp01(0.5 + (l - 0.5) * 2) * amount * 0.5;
      f.shade[i] = 1;
      f.height[i] = 0.5 + (g - 0.5) * amount * 0.35;
      f.rough[i] = 1 + (g - 0.5) * amount * 0.5;
      f.ao[i] = 1;
    }
  };
}

/** Clay roof tiles: overlapping courses (each course shades toward its lower edge). */
const roofTiles: Pattern = (f, random, seed) => {
  const n = f.n;
  const rows = 6;
  const cols = 5;
  const surf = fbmField(random, n, 8, 8, 3);
  for (let y = 0; y < n; y++) {
    const rowPx = n / rows;
    const row = Math.floor(y / rowPx);
    const t = (y - row * rowPx) / rowPx;
    const off = row % 2 === 1 ? n / cols / 2 : 0;
    for (let x = 0; x < n; x++) {
      const k = y * n + x;
      const xs = (x + off) % n;
      const col = Math.floor(xs / (n / cols));
      const ix = (xs - col * (n / cols)) / (n / cols);
      const curve = Math.sin(ix * Math.PI);
      const th = cellHash(seed, col, row);
      const gap = joint(Math.min(ix, 1 - ix) * (n / cols), 1);
      f.height[k] = clamp01(0.15 + 0.7 * t + 0.15 * curve) * gap;
      f.accent[k] = clamp01(0.25 + th * 0.5 + ((surf[k] as number) - 0.5) * 0.5 + (1 - t) * 0.2);
      f.shade[k] = 0.88 + th * 0.18;
      f.rough[k] = 1;
      f.ao[k] = 0.55 + 0.45 * Math.min(1, t * 3) * gap;
    }
  }
};

/** Standing-seam metal roof: raised seams across U. */
const standingSeam: Pattern = (f, random) => {
  const n = f.n;
  const seams = 3;
  const streak = fbmField(random, n, 2, 32, 2);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const k = y * n + x;
      const p = (x / n) * seams;
      const d = Math.abs(p - Math.round(p)) * (n / seams);
      const seam = 1 - smooth(clamp01(d / 2.5));
      f.height[k] = 0.4 + 0.6 * seam;
      f.accent[k] = clamp01(((streak[k] as number) - 0.5) * 1.2 + 0.4) * (1 - seam * 0.5);
      f.shade[k] = 1 + seam * 0.05;
      f.rough[k] = 1 + ((streak[k] as number) - 0.5) * 0.4;
      f.ao[k] = 1 - 0.25 * smooth(clamp01((5 - d) / 5)) * (1 - seam);
    }
  }
};

/** Turf: blades of grass. */
const turf: Pattern = (f, random) => {
  const n = f.n;
  const blades = fbmField(random, n, 64, 64, 2);
  const patches = fbmField(random, n, 4, 4, 3);
  for (let i = 0; i < n * n; i++) {
    const b = blades[i] as number;
    const p = patches[i] as number;
    f.accent[i] = clamp01((1 - b) * 0.7 + (p - 0.5) * 0.8);
    f.shade[i] = 0.9 + p * 0.2;
    f.height[i] = b;
    f.rough[i] = 1;
    f.ao[i] = 0.7 + 0.3 * b;
  }
};

/** Pebbles / gravel. */
function pebbles(cells: number): Pattern {
  return (f, random, seed) => {
    const n = f.n;
    const w = { f1: 0, f2: 0, id: 0 };
    const surf = fbmField(random, n, 16, 16, 2);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const k = y * n + x;
        worley(seed, cells, x / n, y / n, w);
        const dome = clamp01(1 - w.f1 * 1.6);
        const th = cellHash(seed, w.id, 13);
        f.height[k] = Math.sqrt(dome);
        f.accent[k] = clamp01(th * 0.9 + ((surf[k] as number) - 0.5) * 0.3);
        f.shade[k] = 0.85 + th * 0.3;
        f.rough[k] = 1;
        f.ao[k] = 0.45 + 0.55 * Math.sqrt(dome);
      }
    }
  };
}

/** Water ripples. */
const ripples: Pattern = (f, random) => {
  const n = f.n;
  const a = fbmField(random, n, 4, 4, 4);
  for (let i = 0; i < n * n; i++) {
    const h = a[i] as number;
    f.height[i] = h;
    f.accent[i] = clamp01((h - 0.5) * 1.5 + 0.5);
    f.shade[i] = 1;
    f.rough[i] = 1;
    f.ao[i] = 1;
  }
};

/**
 * Foliage: about `count` small overlapping leaves stamped at random angles (wrapped, so the tile repeats), drawn in
 * random layer order; gaps between leaves are dark, a pale midrib runs along each, and leaves differ in tone.
 */
function leaves(count: number): Pattern {
  return (f, _random, seed) => {
    const n = f.n;
    const layer = new Float32Array(n * n).fill(-1);
    for (let i = 0; i < n * n; i++) {
      f.accent[i] = 0.1;
      f.shade[i] = 0.5;
      f.height[i] = 0.05;
      f.rough[i] = 1;
      f.ao[i] = 0.28;
    }
    const L = n * 0.085;
    const W = n * 0.03;
    for (let k = 0; k < count; k++) {
      const cx = cellHash(seed, k, 1) * n;
      const cy = cellHash(seed, k, 2) * n;
      const ang = cellHash(seed, k, 3) * Math.PI;
      const z = cellHash(seed, k, 4);
      const tone = cellHash(seed, k, 5);
      const scale = 0.75 + 0.5 * cellHash(seed, k, 6);
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const r = Math.ceil(L * scale) + 1;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const u = (dx * ca + dy * sa) / (L * scale);
          const v = (-dx * sa + dy * ca) / (W * scale);
          // Leaf outline: widest a third along, pointed at both ends.
          const t = (u + 1) / 2;
          if (t < 0 || t > 1) continue;
          const half = Math.sin(Math.PI * Math.pow(t, 0.8));
          if (Math.abs(v) > half) continue;
          const x = (((Math.round(cx) + dx) % n) + n) % n;
          const y = (((Math.round(cy) + dy) % n) + n) % n;
          const idx = y * n + x;
          if (z < (layer[idx] as number)) continue;
          layer[idx] = z;
          const rib = 1 - clamp01(Math.abs(v) / 0.16);
          const edge = 1 - Math.abs(v) / Math.max(0.05, half);
          f.accent[idx] = clamp01(0.25 + tone * 0.55 + rib * 0.35);
          f.shade[idx] = 0.72 + z * 0.4 + edge * 0.1;
          f.height[idx] = 0.35 + z * 0.55 + edge * 0.1;
          f.rough[idx] = 0.9;
          f.ao[idx] = 0.45 + z * 0.55;
        }
      }
    }
  };
}

// --- wall coverings ----------------------------------------------------------------

/** Signed distance between two tile coordinates in [0, 1) with wrap-around, in tile units (-0.5..0.5). */
function wrapDelta(a: number, b: number): number {
  const d = a - b;
  return d - Math.round(d);
}

/** Anti-aliased step: 0 below `edge - w`, 1 above `edge + w`. */
function aaStep(x: number, edge: number, w: number): number {
  return smooth(clamp01((x - edge + w) / (2 * w)));
}

/** Fine paper fibre: horizontal and vertical flecks that every wallpaper carries. */
function paperFibre(f: Fields, random: () => number, amount: number): Float32Array {
  const n = f.n;
  const fibre = fbmField(random, n, 64, 8, 2);
  const tooth = fbmField(random, n, 128, 128, 1);
  for (let i = 0; i < n * n; i++) {
    const v = (fibre[i] as number) - 0.5;
    const t = (tooth[i] as number) - 0.5;
    f.shade[i] = 1 + v * amount * 0.5 + t * amount * 0.25;
    f.height[i] = 0.5 + v * 0.1 + t * 0.12;
    f.rough[i] = 1 + t * 0.12;
    f.ao[i] = 1;
  }
  return fibre;
}

/** Plain textured paper (lining paper, grasscloth): fibres only. */
const wallpaperPlain: Pattern = (f, random) => {
  const n = f.n;
  const weave = fbmField(random, n, 4, 96, 2);
  paperFibre(f, random, 0.16);
  for (let i = 0; i < n * n; i++) {
    const w = (weave[i] as number) - 0.5;
    f.accent[i] = clamp01(0.45 + w * 0.9);
    f.shade[i] = (f.shade[i] as number) * (1 + w * 0.06);
    f.height[i] = (f.height[i] as number) + w * 0.25;
  }
};

/** Regency stripes: `count` broad bands with a hairline each, on a paper ground. */
function wallpaperStripe(count: number): Pattern {
  return (f, random) => {
    const n = f.n;
    paperFibre(f, random, 0.1);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const k = y * n + x;
        const u = (((x / n) * count) % 1 + 1) % 1;
        const off = Math.abs(wrapDelta(u, 0.5));
        const motif = 1 - aaStep(off, 0.3, 0.02);
        const edgeLine = 1 - aaStep(Math.abs(off - 0.38), 0.02, 0.008);
        f.accent[k] = clamp01(motif * 0.9 + edgeLine * 0.6);
        f.height[k] = (f.height[k] as number) + (motif > 0.5 ? 0.12 : 0);
      }
    }
  };
}

/**
 * Small-scale floral in half-drop: a five-petal flower with a centre on a stem
 * with two leaves, repeated on a 2×2 lattice per tile.
 */
const wallpaperFloral: Pattern = (f, random, seed) => {
  const n = f.n;
  paperFibre(f, random, 0.1);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const k = y * n + x;
      const u = x / n;
      const v = y / n;
      let motif = 0;
      let centre = 0;
      let leaf = 0;
      // Flowers sit at (0.25, 0.25) and (0.75, 0.75); small sprigs at the other two lattice points.
      for (const [cx, cy] of [[0.25, 0.25], [0.75, 0.75]] as const) {
        const dx = wrapDelta(u, cx);
        const dy = wrapDelta(v, cy);
        const r = Math.sqrt(dx * dx + dy * dy);
        const th = Math.atan2(dy, dx);
        const petal = 0.135 * (0.55 + 0.45 * Math.abs(Math.cos(2.5 * th + (cellHash(seed, Math.round(cx * 4), 1) - 0.5))));
        motif = Math.max(motif, 1 - aaStep(r, petal, 0.006));
        centre = Math.max(centre, 1 - aaStep(r, 0.035, 0.006));
      }
      for (const [cx, cy] of [[0.75, 0.25], [0.25, 0.75]] as const) {
        // A pair of leaves: two ellipses tilted ±35°.
        for (const tilt of [-0.6, 0.6]) {
          const dx = wrapDelta(u, cx);
          const dy = wrapDelta(v, cy);
          const c = Math.cos(tilt);
          const s = Math.sin(tilt);
          const lx = (dx * c + dy * s) / 0.085;
          const ly = (-dx * s + dy * c) / 0.032;
          leaf = Math.max(leaf, 1 - aaStep(lx * lx + ly * ly, 1, 0.12));
        }
      }
      const ink = Math.max(motif, leaf);
      f.accent[k] = clamp01(ink * (0.78 - centre * 0.5));
      f.height[k] = (f.height[k] as number) + ink * 0.1 - centre * 0.05;
      f.shade[k] = (f.shade[k] as number) * (1 - centre * 0.08);
    }
  }
};

/** Damask: mirrored ogee medallions on a diamond lattice, drawn with lobed outlines. */
const wallpaperDamask: Pattern = (f, random) => {
  const n = f.n;
  paperFibre(f, random, 0.08);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const k = y * n + x;
      const u = x / n;
      const v = y / n;
      let ink = 0;
      for (const [cx, cy] of [[0.25, 0.25], [0.75, 0.75]] as const) {
        const dx = Math.abs(wrapDelta(u, cx)) * 2;
        const dy = wrapDelta(v, cy) * 2;
        // Ogee outline: |x| <= profile(y) where the profile swells in the middle and pinches to a point.
        const t = Math.abs(dy);
        const profile = 0.62 * Math.sin(Math.PI * Math.min(1, t * 1.05)) ** 0.8 * (1 + 0.28 * Math.cos(t * Math.PI * 3));
        const inside = 1 - aaStep(dx, profile, 0.03);
        const ring = (1 - aaStep(Math.abs(dx - profile * 0.72), 0.05, 0.015)) * (t < 0.95 ? 1 : 0);
        const core = 1 - aaStep(Math.hypot(dx * 1.2, dy * 0.9), 0.17, 0.02);
        const lace = 0.5 + 0.5 * Math.sin((dx * 22 + t * 14));
        ink = Math.max(ink, ring * 0.9, core * 0.95, inside * (lace > 0.72 ? 0.55 : 0) * (t < 0.8 ? 1 : 0));
      }
      f.accent[k] = clamp01(ink * 0.85);
      f.height[k] = (f.height[k] as number) + ink * 0.14;
      f.shade[k] = (f.shade[k] as number) * (1 + ink * 0.03);
    }
  }
};

/** Geometric scallops (art-deco fans): overlapping arcs in half-drop. */
const wallpaperGeometric: Pattern = (f, random) => {
  const n = f.n;
  paperFibre(f, random, 0.08);
  const cells = 4;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const k = y * n + x;
      const gu = (x / n) * cells;
      const gv = (y / n) * cells;
      let best = 0;
      // Fan centred on the lower edge of every cell; odd rows shift by half a cell.
      for (let dj = 0; dj <= 1; dj++) {
        const row = Math.floor(gv) + dj;
        const shift = row % 2 === 0 ? 0 : 0.5;
        const cu = Math.round(gu - shift) + shift;
        const dx = gu - cu;
        const dy = gv - row;
        const r = Math.hypot(dx, dy) * 2;
        for (const radius of [0.5, 0.75, 1.0]) {
          const line = 1 - aaStep(Math.abs(r - radius), 0.045, 0.012);
          best = Math.max(best, line * (dy <= 0 ? 1 : 0));
        }
      }
      f.accent[k] = clamp01(best * 0.9);
      f.height[k] = (f.height[k] as number) + best * 0.14;
    }
  }
};

/** Shaker wall panelling: recessed rectangular fields with bevelled rails, `cells` fields per tile across. */
function panelling(cells: number): Pattern {
  return (f, random) => {
    const n = f.n;
    const fine = fbmField(random, n, 32, 32, 2);
    const pw = n / cells;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const k = y * n + x;
        const ix = x % pw;
        const iy = y % pw;
        const edge = Math.min(ix, pw - ix, iy, pw - iy) / pw;
        // Rail (flat frame) 0..0.14, bevel 0.14..0.2, recessed field after.
        const bevel = smooth(clamp01((edge - 0.14) / 0.06));
        f.height[k] = 0.9 - 0.5 * bevel;
        f.accent[k] = bevel * 0.0;
        f.shade[k] = 1 - 0.06 * bevel + ((fine[k] as number) - 0.5) * 0.02;
        f.rough[k] = 1;
        f.ao[k] = 0.7 + 0.3 * (1 - bevel * (edge < 0.2 ? 1 : 0.4)) + 0.0;
        if (edge >= 0.2) f.ao[k] = 0.88;
      }
    }
  };
}

/** Vertical timber slats on a dark felt backing. */
const woodSlats: Pattern = (f, random, seed) => {
  const n = f.n;
  const grain = fbmField(random, n, 2, 64, 3);
  const slats = 8;
  const sw = n / slats;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const k = y * n + x;
      const s = Math.floor(x / sw);
      const ix = x - s * sw;
      const edge = Math.min(ix, sw - ix);
      const gap = 1 - joint(edge, sw * 0.14);
      const th = cellHash(seed, s, 3);
      const g = grain[k] as number;
      f.accent[k] = clamp01(gap * 0.95 + (1 - gap) * (0.1 + g * 0.5 + th * 0.2));
      f.shade[k] = gap > 0.5 ? 0.55 : 0.88 + th * 0.2;
      f.height[k] = 0.2 + 0.8 * (1 - gap);
      f.rough[k] = 0.95 + (1 - gap) * 0.1;
      f.ao[k] = 0.35 + 0.65 * (1 - gap);
    }
  }
};

/** Pattern of every texture recipe. */
const PATTERNS: Readonly<Record<FinishDef['pattern'], Pattern>> = Object.freeze({
  planks: boards(12, 0.9, 0.85, 0.8),
  'deck-boards': boards(8, 2.2, 0.95, 0.7),
  herringbone: herringbone(4),
  veined,
  speckle,
  plaster: mottled(0.5, 0.14),
  smooth: subtle(0.12, 3),
  'grid-tiles': gridTiles(4, 1.3),
  subway: gridTiles(4, 1.4, 2, true),
  flagstone,
  granite,
  bricks: bricks(6, 16, 1.6),
  weave: weave(48, 0.8),
  velvet: pile(64, 0.35),
  'grain-leather': leatherGrain,
  pile: pile(96, 0.15),
  brushed,
  mirror: subtle(0.02, 2),
  glass: subtle(0.03, 2),
  frosted: pile(128, 0.05),
  glaze: subtle(0.05, 4),
  'roof-tiles': roofTiles,
  'standing-seam': standingSeam,
  turf,
  pebbles: pebbles(22),
  ripples,
  leaves: leaves(520),
  'paper-plain': wallpaperPlain,
  'paper-stripe': wallpaperStripe(4),
  'paper-floral': wallpaperFloral,
  'paper-damask': wallpaperDamask,
  'paper-geometric': wallpaperGeometric,
  'panel-shaker': panelling(2),
  slats: woodSlats,
  facade,
});

function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Synthesise the texture maps of finish `id` at `size × size` pixels
 * (rounded to a power of two in 16..{@link MAX_FINISH_TEXTURE_SIZE}).
 * Throws for an unknown finish id.
 */
export function finishPixels(id: MaterialFinish, size = FINISH_TEXTURE_SIZE): FinishPixels {
  if (!Object.hasOwn(FINISHES, id)) throw new Error(`unknown finish "${String(id).slice(0, 40)}"`);
  const def = FINISHES[id];
  const n = Math.min(MAX_FINISH_TEXTURE_SIZE, Math.max(16, 2 ** Math.round(Math.log2(Number.isFinite(size) ? size : FINISH_TEXTURE_SIZE))));
  const seed = seedOf(id);
  const f: Fields = { n, height: new Float32Array(n * n), accent: new Float32Array(n * n), shade: new Float32Array(n * n), rough: new Float32Array(n * n), ao: new Float32Array(n * n) };
  // Patterns are authored for 256 px; joint widths scale with the resolution.
  PATTERNS[def.pattern](f, rng(seed), seed);
  const base = hexRgb(def.color);
  const acc = hexRgb(def.accent);
  const ratio = [0, 1, 2].map((i) => (acc[i] as number) / Math.max(1e-4, base[i] as number)) as [number, number, number];
  const inv = 1 / finishAlbedoScale(def);
  const albedo = new Uint8Array(n * n * 4);
  const orm = new Uint8Array(n * n * 4);
  const normal = new Uint8Array(n * n * 4);
  const strength = def.bump * 3.5;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const k = y * n + x;
      const o = k * 4;
      const a = f.accent[k] as number;
      const s = f.shade[k] as number;
      for (let c = 0; c < 3; c++) albedo[o + c] = Math.round(clamp01((1 + ((ratio[c] as number) - 1) * a) * s * inv) * 255);
      albedo[o + 3] = 255;
      orm[o] = Math.round(clamp01(f.ao[k] as number) * 255);
      orm[o + 1] = Math.round(clamp01(def.roughness * (f.rough[k] as number)) * 255);
      orm[o + 2] = f.lit ? Math.round(clamp01(f.lit[k] as number) * 255) : 0;
      orm[o + 3] = 255;
      // Central differences with wrap-around (seamless).
      const xl = (x + n - 1) % n;
      const xr = (x + 1) % n;
      const yd = (y + n - 1) % n;
      const yu = (y + 1) % n;
      const dx = ((f.height[y * n + xr] as number) - (f.height[y * n + xl] as number)) * strength * (n / 256);
      const dy = ((f.height[yu * n + x] as number) - (f.height[yd * n + x] as number)) * strength * (n / 256);
      const l = Math.sqrt(dx * dx + dy * dy + 1);
      normal[o] = Math.round((-dx / l * 0.5 + 0.5) * 255);
      normal[o + 1] = Math.round((-dy / l * 0.5 + 0.5) * 255);
      normal[o + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
      normal[o + 3] = 255;
    }
  }
  return { size: n, albedo, orm, normal };
}
