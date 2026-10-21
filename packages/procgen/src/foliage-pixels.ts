/**
 * Procedural foliage cards: RGBA8 images of leaf clusters, needle sprays, grass blades and fern fronds
 * with a hard-cut alpha (the renderer draws them alpha-tested, so they need no sorting and cast real
 * leaf shadows). A tree is a few hundred quads carrying these, not tens of thousands of leaves.
 *
 * - Colours are neutral-green *ratios* around 0.7-1.0: the card's vertex colours (shade inside the
 *   crown, light on top, an autumn tint) multiply them, so one texture serves every season.
 * - Pixels under transparent areas hold the card's mean colour, so mip levels never pick up a dark
 *   halo around the cut-out.
 * - Pure and deterministic (seeded per kind): identical in the compute worker, inline and in tests.
 */
import { rng } from '@aether/core';

/** The foliage card kinds (mirrors `MaterialSpec.foliage`). */
export type FoliageKind = 'broadleaf' | 'shrub' | 'needles' | 'grass' | 'fern' | 'blossom' | 'flower';

/** Default atlas edge length in pixels (2 × 2 card variants of 256 px). */
export const FOLIAGE_TEXTURE_SIZE = 512;
/** Card variants per atlas axis: an atlas holds `FOLIAGE_CELLS²` different cards; a card's UVs pick one cell. */
export const FOLIAGE_CELLS = 2;
/** Largest edge the synthesiser accepts. */
export const MAX_FOLIAGE_TEXTURE_SIZE = 1024;
/** Alpha at or above which a pixel is solid (the renderer's alpha test). */
export const FOLIAGE_ALPHA_CUT = 128;

type RGB = readonly [number, number, number];

/** A card under construction: colour and coverage per pixel. */
class Canvas {
  readonly rgb: Float32Array;
  readonly a: Float32Array;

  constructor(readonly n: number) {
    this.rgb = new Float32Array(n * n * 3);
    this.a = new Float32Array(n * n);
  }

  /** Paint `color` where `dist(px, py)` (pixels, negative inside) says so, within a bounding box. */
  stamp(x0: number, y0: number, x1: number, y1: number, dist: (x: number, y: number) => number, color: (x: number, y: number) => RGB): void {
    const n = this.n;
    const ix0 = Math.max(0, Math.floor(x0));
    const iy0 = Math.max(0, Math.floor(y0));
    const ix1 = Math.min(n - 1, Math.ceil(x1));
    const iy1 = Math.min(n - 1, Math.ceil(y1));
    for (let y = iy0; y <= iy1; y++) {
      for (let x = ix0; x <= ix1; x++) {
        const d = dist(x + 0.5, y + 0.5);
        const cover = Math.min(1, Math.max(0, 0.5 - d));
        if (cover <= 0) continue;
        const i = y * n + x;
        const c = color(x + 0.5, y + 0.5);
        const prev = this.a[i] as number;
        // "Over": the new shape covers the old by `cover`; where nothing was drawn it takes the colour outright.
        const w = prev <= 0 ? 1 : cover;
        this.rgb[i * 3] = (this.rgb[i * 3] as number) * (1 - w) + c[0] * w;
        this.rgb[i * 3 + 1] = (this.rgb[i * 3 + 1] as number) * (1 - w) + c[1] * w;
        this.rgb[i * 3 + 2] = (this.rgb[i * 3 + 2] as number) * (1 - w) + c[2] * w;
        this.a[i] = Math.max(prev, cover);
      }
    }
  }

  /** RGBA8 with the mean colour under transparent pixels. */
  bake(): Uint8Array {
    const n = this.n;
    const out = new Uint8Array(n * n * 4);
    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;
    for (let i = 0; i < n * n; i++) {
      if ((this.a[i] as number) >= 0.5) {
        r += this.rgb[i * 3] as number;
        g += this.rgb[i * 3 + 1] as number;
        b += this.rgb[i * 3 + 2] as number;
        count++;
      }
    }
    const mean: RGB = count > 0 ? [r / count, g / count, b / count] : [0.7, 0.85, 0.5];
    for (let i = 0; i < n * n; i++) {
      const solid = (this.a[i] as number) > 0;
      const k = i * 4;
      out[k] = to8(solid ? (this.rgb[i * 3] as number) : mean[0]);
      out[k + 1] = to8(solid ? (this.rgb[i * 3 + 1] as number) : mean[1]);
      out[k + 2] = to8(solid ? (this.rgb[i * 3 + 2] as number) : mean[2]);
      out[k + 3] = Math.round(Math.min(1, (this.a[i] as number) * 1.0) * 255);
    }
    return out;
  }
}

function to8(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

/** Distance (pixels) from a point to the segment a-b. */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * One leaf: an ovate blade from (cx, cy) along `angle` (radians, 0 = +x, y down), `len` long and `wid` wide,
 * with a pointed tip, a pale midrib and a darker rim.
 */
function leaf(c: Canvas, cx: number, cy: number, angle: number, len: number, wid: number, tone: number, tint: RGB): void {
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const reach = len + wid;
  const hw = wid / 2;
  c.stamp(
    cx - reach,
    cy - reach,
    cx + reach,
    cy + reach,
    (px, py) => {
      const dx = px - cx;
      const dy = py - cy;
      const x = dx * ca + dy * sa;
      const y = -dx * sa + dy * ca;
      const u = x / len;
      if (u < -0.05 || u > 1.05) return Math.hypot(Math.min(0, x) + Math.max(0, x - len), y) + 0.5;
      const w = hw * Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, Math.max(0, u)) ** 0.78)), 0.85) * (1 - 0.18 * u);
      return Math.abs(y) - w;
    },
    (px, py) => {
      const dx = px - cx;
      const dy = py - cy;
      const x = dx * ca + dy * sa;
      const y = -dx * sa + dy * ca;
      const u = Math.min(1, Math.max(0, x / len));
      const w = hw * Math.pow(Math.max(0, Math.sin(Math.PI * u ** 0.78)), 0.85) * (1 - 0.18 * u) + 1e-3;
      const rim = Math.min(1, Math.abs(y) / w);
      const rib = Math.max(0, 1 - Math.abs(y) / 0.9) * 0.16;
      const k = tone * (1 - 0.2 * rim * rim) + rib - 0.12 * (1 - u);
      return [tint[0] * k, tint[1] * k, tint[2] * k];
    },
  );
}

/** A thick line with round ends. */
function stroke(c: Canvas, ax: number, ay: number, bx: number, by: number, width: number, color: (t: number) => RGB): void {
  const hw = width / 2;
  const l2 = (bx - ax) ** 2 + (by - ay) ** 2;
  c.stamp(
    Math.min(ax, bx) - hw - 1,
    Math.min(ay, by) - hw - 1,
    Math.max(ax, bx) + hw + 1,
    Math.max(ay, by) + hw + 1,
    (px, py) => segDist(px, py, ax, ay, bx, by) - hw,
    (px, py) => color(l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / l2))),
  );
}

const WOOD: RGB = [0.5, 0.4, 0.3];

function broadleafCard(n: number, small: boolean, variant: number): Uint8Array {
  const r = rng((small ? 0x5b1e : 0x0a1f) + variant * 0x9e37);
  const c = new Canvas(n);
  // A short leafy twig from the bottom centre: leaves sit along it and at its end, fanning outward.
  const base: [number, number] = [n * 0.5, n * 0.96];
  const count = small ? 54 : 30;
  const len = n * (small ? 0.19 : 0.26);
  const wid = len * (small ? 0.58 : 0.62);
  const items: Array<{ x: number; y: number; a: number; tone: number; s: number }> = [];
  for (let i = 0; i < count; i++) {
    const t = r();
    const spread = (r() - 0.5) * 2;
    const reach = (0.12 + 0.62 * Math.sqrt(t)) * n;
    const ang = -Math.PI / 2 + spread * (0.35 + 0.6 * t);
    const x = base[0] + Math.cos(ang) * reach * (0.55 + 0.5 * Math.abs(spread));
    const y = base[1] - Math.sin(-ang) * reach * 0.0 + Math.sin(ang) * reach;
    items.push({ x, y, a: -Math.PI / 2 + spread * (0.9 + 0.5 * r()) + (r() - 0.5) * 0.5, tone: 0.72 + r() * 0.3, s: 0.8 + r() * 0.45 });
  }
  // Back to front: lower leaves first.
  items.sort((p, q) => q.y - p.y);
  for (const it of items) stroke(c, base[0] + (it.x - base[0]) * 0.35, base[1] + (it.y - base[1]) * 0.35, it.x, it.y, 1.6, () => WOOD);
  for (const it of items) leaf(c, it.x, it.y, it.a, len * it.s, wid * it.s, it.tone, [0.86, 0.98, 0.62]);
  return c.bake();
}

function needleCard(n: number, variant: number): Uint8Array {
  const r = rng(0x7e21 + variant * 0x9e37);
  const c = new Canvas(n);
  // A spray along +x (the branch) with paired needles sweeping forward: twig at mid height, tip on the right.
  const mid = n * 0.5;
  const pairs = 52;
  stroke(c, n * 0.02, mid, n * 0.98, mid + (r() - 0.5) * 3, 3.2, (t) => [WOOD[0] * (1 - 0.2 * t), WOOD[1] * (1 - 0.2 * t), WOOD[2] * (1 - 0.2 * t)]);
  for (let i = 0; i < pairs; i++) {
    const t = (i + r() * 0.6) / pairs;
    const x = n * (0.06 + 0.9 * t);
    for (const sd of [-1, 1]) {
      const ang = (0.9 + r() * 0.35) * sd; // radians off the twig direction
      const len = n * (0.3 - 0.18 * t) * (0.8 + r() * 0.4);
      const dx = Math.cos(ang) * len;
      const dy = Math.sin(ang) * len;
      const tone = 0.7 + r() * 0.3;
      stroke(c, x, mid, x + dx, mid + dy, 3.6 - 1.2 * t, (u) => [0.78 * tone * (0.82 + 0.28 * u), 0.96 * tone * (0.82 + 0.3 * u), 0.62 * tone * (0.8 + 0.2 * u)]);
    }
  }
  return c.bake();
}

function grassCard(n: number, variant: number): Uint8Array {
  const r = rng(0x6a55 + variant * 0x9e37);
  const c = new Canvas(n);
  // Many thin, curved blades of different heights (a real tuft is dozens of hair-fine blades, not a few fat ones). Each
  // blade is lighter along its fold than at its edges, and every blade darkens toward the root, where the tuft shades
  // itself: the card reads as a clump with depth, and its straight bottom edge disappears into the ground.
  const blades = 64;
  for (let i = 0; i < blades; i++) {
    const x0 = n * (0.08 + 0.84 * r());
    const tall = r() < 0.3;
    const h = n * ((tall ? 0.72 : 0.36) + (tall ? 0.26 : 0.32) * r());
    const lean = (r() - 0.5) * n * 0.46;
    const bend = (r() - 0.5) * n * 0.18;
    const w0 = n * (0.006 + 0.007 * r());
    const tone = 0.66 + r() * 0.34;
    const dry = r() < 0.1;
    const top = n - h;
    c.stamp(
      Math.min(x0, x0 + lean + bend) - w0 - 3,
      top - 2,
      Math.max(x0, x0 + lean + bend) + w0 + 3,
      n,
      (px, py) => {
        const t = Math.min(1, Math.max(0, (n - py) / h));
        if (py < top - 1) return 5;
        const xc = x0 + lean * t * t + bend * Math.sin(t * Math.PI);
        const w = w0 * Math.pow(Math.max(0, 1 - t), 0.6) + 0.3;
        return Math.abs(px - xc) - w;
      },
      (px, py) => {
        const t = Math.min(1, Math.max(0, (n - py) / h));
        const xc = x0 + lean * t * t + bend * Math.sin(t * Math.PI);
        const w = w0 * Math.pow(Math.max(0, 1 - t), 0.6) + 0.3;
        const fold = 1 - 0.28 * Math.min(1, Math.abs(px - xc) / w) ** 2;
        const rootT = Math.min(1, t / 0.35);
        const root = 0.42 + 0.58 * rootT * rootT * (3 - 2 * rootT);
        const k = tone * fold * root;
        return dry ? [0.95 * k, 0.86 * k, 0.6 * k] : [(0.7 + 0.3 * t) * k, (0.8 + 0.2 * t) * k, (0.62 + 0.2 * t) * k];
      },
    );
  }
  return c.bake();
}

function fernCard(n: number, variant: number): Uint8Array {
  const r = rng(0x3f09 + variant * 0x9e37);
  const c = new Canvas(n);
  // A frond along +x with a gentle droop; leaflets in pairs shrinking toward the tip.
  const rib = (t: number): [number, number] => [n * (0.03 + 0.94 * t), n * (0.5 + 0.12 * t * t)];
  let prev = rib(0);
  for (let i = 1; i <= 24; i++) {
    const p = rib(i / 24);
    stroke(c, prev[0], prev[1], p[0], p[1], 3, () => [0.5, 0.55, 0.38]);
    prev = p;
  }
  for (let i = 1; i <= 17; i++) {
    const t = i / 18;
    const p = rib(t);
    const len = n * 0.34 * Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.9)) * (1 - 0.35 * t) + n * 0.03;
    for (const sd of [-1, 1]) {
      const ang = sd * (1.05 - 0.4 * t + (r() - 0.5) * 0.12);
      leaf(c, p[0], p[1], ang, len * (0.9 + r() * 0.2), len * 0.2, 0.7 + r() * 0.3, [0.8, 0.98, 0.6]);
    }
  }
  return c.bake();
}

/** A round blossom: five overlapping petals around a slightly darker heart (a neutral card: the vertex colour tints it). */
function blossom(c: Canvas, cx: number, cy: number, r: number, tone: number): void {
  const petals = 5;
  const rot = (cx * 0.37 + cy * 0.21) % (Math.PI * 2);
  for (let k = 0; k < petals; k++) {
    const a = rot + (k / petals) * Math.PI * 2;
    const px = cx + Math.cos(a) * r * 0.5;
    const py = cy + Math.sin(a) * r * 0.5;
    const pr = r * 0.52;
    c.stamp(
      px - pr - 1,
      py - pr - 1,
      px + pr + 1,
      py + pr + 1,
      (x, y) => Math.hypot(x - px, y - py) - pr,
      (x, y) => {
        const edge = Math.hypot(x - px, y - py) / pr;
        const k2 = tone * (1 - 0.1 * edge * edge);
        return [k2, k2 * 0.97, k2 * 0.98];
      },
    );
  }
  c.stamp(
    cx - r * 0.25,
    cy - r * 0.25,
    cx + r * 0.25,
    cy + r * 0.25,
    (x, y) => Math.hypot(x - cx, y - cy) - r * 0.2,
    () => [tone * 0.7, tone * 0.62, tone * 0.5],
  );
}

function blossomCard(n: number, variant: number): Uint8Array {
  const r = rng(0xb105 + variant * 0x9e37);
  const c = new Canvas(n);
  // A flowering twig from the bottom centre: sprays of blossoms along and at the end of dark side twigs.
  const base: [number, number] = [n * 0.5, n * 0.97];
  const spots: Array<{ x: number; y: number; s: number; tone: number }> = [];
  for (let i = 0; i < 46; i++) {
    const t = r();
    const spread = (r() - 0.5) * 2;
    const reach = (0.1 + 0.66 * Math.sqrt(t)) * n;
    const ang = -Math.PI / 2 + spread * (0.3 + 0.62 * t);
    spots.push({ x: base[0] + Math.cos(ang) * reach * (0.6 + 0.45 * Math.abs(spread)), y: base[1] + Math.sin(ang) * reach, s: 0.8 + r() * 0.5, tone: 0.8 + r() * 0.2 });
  }
  spots.sort((p, q) => q.y - p.y);
  for (const it of spots) stroke(c, base[0] + (it.x - base[0]) * 0.3, base[1] + (it.y - base[1]) * 0.3, it.x, it.y, 1.8, () => [0.32, 0.26, 0.22]);
  for (const it of spots) blossom(c, it.x, it.y, n * 0.075 * it.s, it.tone);
  return c.bake();
}

function flowerCard(n: number, variant: number): Uint8Array {
  const r = rng(0xf10e + variant * 0x9e37);
  const c = new Canvas(n);
  // A clump of slim stems topped with open flowers. The card is neutral: the generator's vertex colours run from
  // leaf green at the bottom to the flower colour at the top, so stems come out green and heads coloured.
  const stems = 11;
  for (let i = 0; i < stems; i++) {
    const x0 = n * (0.12 + 0.76 * r());
    const h = n * (0.45 + 0.45 * r());
    const lean = (r() - 0.5) * n * 0.22;
    const topX = x0 + lean;
    const topY = n - h;
    stroke(c, x0, n, topX, topY, 1.6, () => [0.78, 0.84, 0.66]);
    // A pair of narrow leaves low on the stem.
    leaf(c, x0, n - h * 0.25, -Math.PI / 2 - 0.9, n * 0.12, n * 0.035, 0.75, [0.78, 0.9, 0.62]);
    leaf(c, x0, n - h * 0.3, -Math.PI / 2 + 0.9, n * 0.1, n * 0.03, 0.7, [0.78, 0.9, 0.62]);
    const pr = n * (0.045 + 0.03 * r());
    blossom(c, topX, topY, pr * 1.5, 0.85 + 0.15 * r());
  }
  return c.bake();
}

/** One card of `kind`, `n` pixels square, variant `v` (a different seed). */
function card(kind: FoliageKind, n: number, v: number): Uint8Array {
  switch (kind) {
    case 'broadleaf':
      return broadleafCard(n, false, v);
    case 'shrub':
      return broadleafCard(n, true, v);
    case 'needles':
      return needleCard(n, v);
    case 'grass':
      return grassCard(n, v);
    case 'fern':
      return fernCard(n, v);
    case 'blossom':
      return blossomCard(n, v);
    case 'flower':
      return flowerCard(n, v);
  }
}

/**
 * RGBA8 pixels (`size × size`) of a foliage atlas: {@link FOLIAGE_CELLS} × {@link FOLIAGE_CELLS} card variants of
 * `kind` (cell `i` at column `i % 2`, row `i / 2`, row 0 at the top of the image). Deterministic; `size` is clamped
 * to a power of two between 32 and {@link MAX_FOLIAGE_TEXTURE_SIZE}.
 */
export function foliagePixels(kind: FoliageKind, size: number = FOLIAGE_TEXTURE_SIZE): { size: number; rgba: Uint8Array } {
  const n = Math.max(32, Math.min(MAX_FOLIAGE_TEXTURE_SIZE, 2 ** Math.round(Math.log2(Math.max(32, size)))));
  const c = n / FOLIAGE_CELLS;
  const out = new Uint8Array(n * n * 4);
  for (let v = 0; v < FOLIAGE_CELLS * FOLIAGE_CELLS; v++) {
    const px = card(kind, c, v);
    const ox = (v % FOLIAGE_CELLS) * c;
    const oy = Math.floor(v / FOLIAGE_CELLS) * c;
    for (let y = 0; y < c; y++) out.set(px.subarray(y * c * 4, (y + 1) * c * 4), ((oy + y) * n + ox) * 4);
  }
  return { size: n, rgba: out };
}

/**
 * UV rectangle (u0, v0, u1, v1) of atlas cell `cell` (0 … 3). The atlas is uploaded with flipY off, so v0 is the
 * cell's top edge in the image (where a card's tips go) and v1 its bottom edge (a card's base).
 */
export function foliageCellUv(cell: number): [number, number, number, number] {
  const i = Math.max(0, Math.min(FOLIAGE_CELLS * FOLIAGE_CELLS - 1, Math.floor(Number.isFinite(cell) ? cell : 0)));
  const k = 1 / FOLIAGE_CELLS;
  const col = i % FOLIAGE_CELLS;
  const row = Math.floor(i / FOLIAGE_CELLS);
  return [col * k, row * k, (col + 1) * k, (row + 1) * k];
}
