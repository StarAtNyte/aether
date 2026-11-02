/**
 * Photographed leaf cards. The procedural cards (`@aether/procgen` `foliagePixels`) draw every leaf as the same
 * smooth blade, which reads as paper up close. Here the cards are composed from real leaves, fronds and grass
 * tufts cut out of CC0 Poly Haven photographs (`public/foliage/leaf-sprites.webp`, made by
 * `scripts/foliage/leaf-sprites.ts`):
 *
 * - each card variant (2 × 2 per atlas) is a seeded arrangement of sprites: a leafy twig for trees, a dense clump
 *   of mixed leaves for shrubs, a frond for ferns, tufts for grass; every leaf drops a soft shadow on the leaves
 *   under it and gets its own brightness, so a card has depth and no two leaves are alike;
 * - the result is turned into the cards' convention, a neutral *ratio* image the vertex colours tint (the photo's
 *   own green is divided out, its veins, mottling and shading stay), with the mean colour under transparent pixels
 *   so mip levels never grow a dark halo.
 *
 * Planning is pure and deterministic ({@link photoPlan}, {@link neutralise}, tested); drawing needs a 2D canvas
 * and runs once per kind when the sheet has loaded. Without a canvas or the sheet the procedural cards stay.
 */
import { rng } from '@aether/core/random';
import type { FoliageKind } from '@aether/procgen/foliage';

/** Sprite kinds of the sheet. */
export type SpriteUse = 'leaf-broad' | 'leaf-narrow' | 'frond' | 'tuft' | 'needle' | 'blossom' | 'flower';

/** One sprite of the sheet (pixels) and its mean linear colour. */
export interface LeafSprite {
  use: SpriteUse;
  x: number;
  y: number;
  w: number;
  h: number;
  mean: [number, number, number];
}

/** The validated sprite index. */
export interface LeafSheet {
  width: number;
  height: number;
  sprites: LeafSprite[];
}

/**
 * Card kinds composed from photographed sprites (grass keeps its hair-fine procedural blades: photo tufts thin out).
 * Needles, blossoms and flowers need their own sprites in the sheet; without them those kinds keep procedural cards.
 */
export const PHOTO_KINDS: ReadonlySet<FoliageKind> = new Set<FoliageKind>(['broadleaf', 'shrub', 'fern', 'needles', 'blossom', 'flower']);

/** The sprite kind a card kind cannot be composed without. */
const NEEDS: Partial<Record<FoliageKind, SpriteUse>> = { broadleaf: 'leaf-broad', shrub: 'leaf-broad', fern: 'frond', needles: 'needle', blossom: 'blossom', flower: 'flower' };

/**
 * Card kinds whose sprites are drawn as grey values: the vertex colour alone sets their hue (a blossom tree is pink or
 * white, a meadow's flowers any colour), so the photographed petals' own colour must not show through.
 */
const GREY_KINDS: ReadonlySet<FoliageKind> = new Set<FoliageKind>(['blossom', 'flower']);

const USES: ReadonlySet<string> = new Set(['leaf-broad', 'leaf-narrow', 'frond', 'tuft', 'needle', 'blossom', 'flower']);
const MAX_SHEET = 4096;
const MAX_SPRITES = 256;

/** Validate `leaf-sprites.json` (null when malformed, out of bounds or missing a kind a card needs). */
export function parseLeafSheet(raw: unknown): LeafSheet | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const { width, height, sprites } = r;
  const int = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
  if (!int(width, 16, MAX_SHEET) || !int(height, 16, MAX_SHEET) || !Array.isArray(sprites) || sprites.length < 1 || sprites.length > MAX_SPRITES) return null;
  const out: LeafSprite[] = [];
  for (const s of sprites as unknown[]) {
    if (!s || typeof s !== 'object') return null;
    const o = s as Record<string, unknown>;
    const { use, x, y, w, h, mean } = o;
    if (typeof use !== 'string' || !USES.has(use)) return null;
    if (!int(x, 0, width - 1) || !int(y, 0, height - 1) || !int(w, 2, width) || !int(h, 2, height) || x + w > width || y + h > height) return null;
    if (!Array.isArray(mean) || mean.length !== 3 || !mean.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1)) return null;
    out.push({ use: use as SpriteUse, x, y, w, h, mean: [mean[0] as number, mean[1] as number, mean[2] as number] });
  }
  const has = (u: SpriteUse): boolean => out.some((s) => s.use === u);
  if (!has('leaf-broad') || !has('frond') || !has('tuft')) return null;
  return { width, height, sprites: out };
}

/**
 * One sprite placement in a card cell (pixels of the cell): the sprite's base (middle of its bottom edge) sits at
 * `x, y`, it is turned by `angle` radians (0: tip up, positive: clockwise), scaled to `length` pixels from base to
 * tip, mirrored when `flip`, and drawn at `tone` brightness. Ops are in drawing order (back to front).
 */
export interface DrawOp {
  sprite: number;
  x: number;
  y: number;
  angle: number;
  length: number;
  flip: boolean;
  tone: number;
  /** A twig stroke from (x0, y0) to the base, drawn first (0 width: none). */
  twig: { x0: number; y0: number; width: number };
}

function pick(sheet: LeafSheet, uses: readonly SpriteUse[], r: () => number): number {
  const ids: number[] = [];
  sheet.sprites.forEach((s, i) => {
    if (uses.includes(s.use)) ids.push(i);
  });
  if (ids.length === 0) return 0;
  return ids[Math.min(ids.length - 1, Math.floor(r() * ids.length))] as number;
}

/**
 * The seeded arrangement of card variant `variant` of `kind` in a cell `c` pixels square (pure, deterministic).
 * Cards keep the orientation the generators expect: tree and shrub cards grow from the bottom centre, fern cards
 * along +x from the left edge, grass from the bottom edge.
 */
export function photoPlan(kind: FoliageKind, c: number, sheet: LeafSheet, variant: number): DrawOp[] {
  const r = rng(0x1eaf + variant * 7919 + kind.length * 104729);
  const ops: DrawOp[] = [];
  const none = { x0: 0, y0: 0, width: 0 };
  if (kind === 'needles') {
    // A conifer spray lying along +x from the left edge's middle (the spruce's cards grow along their branch): the
    // main twig and two shorter side twigs forking forward from it.
    const main = pick(sheet, ['needle'], r);
    ops.push({ sprite: main, x: c * 0.02, y: c * 0.5, angle: Math.PI / 2 + (r() - 0.5) * 0.08, length: c * 0.94, flip: r() < 0.5, tone: 0.9 + 0.15 * r(), twig: none });
    for (const side of [-1, 1]) {
      const sprite = pick(sheet, ['needle'], r);
      const x = c * (0.28 + 0.2 * r());
      ops.push({ sprite, x, y: c * (0.5 + side * 0.04), angle: Math.PI / 2 + side * (0.55 + 0.25 * r()), length: c * (0.42 + 0.12 * r()), flip: r() < 0.5, tone: 0.75 + 0.2 * r(), twig: none });
    }
    // The side twigs lie under the main one.
    ops.push(ops.shift() as DrawOp);
    return ops;
  }
  if (kind === 'blossom') {
    // A flowering twig from the bottom centre: open flowers crowded along short dark side twigs, no leaves (the card
    // takes one colour, the blossom's).
    const base = { x: c * 0.5, y: c * 0.97 };
    const items: DrawOp[] = [];
    const count = 16 + Math.floor(r() * 6);
    for (let i = 0; i < count; i++) {
      const t = r();
      const a = (r() - 0.5) * 2 * 0.95;
      const reach = c * (0.2 + 0.55 * Math.sqrt(t));
      const length = c * (0.15 + 0.08 * r());
      const angle = (r() - 0.5) * 1.6;
      // The whole flower stays inside its cell (its tip and its half-width around the base-tip line).
      const mx = length * (Math.abs(Math.sin(angle)) + 0.4);
      const x = Math.max(mx, Math.min(c - mx, base.x + Math.sin(a) * reach));
      const y = Math.max(length * (Math.abs(Math.cos(angle)) + 0.4), Math.min(c * 0.99, base.y - Math.cos(a) * reach));
      const twig = i % 3 === 0 ? { x0: base.x + (x - base.x) * 0.35, y0: base.y + (y - base.y) * 0.35, width: Math.max(1, c * 0.012) } : none;
      items.push({ sprite: pick(sheet, ['blossom'], r), x, y, angle, length, flip: r() < 0.5, tone: 0.7 + 0.4 * r(), twig });
    }
    items.sort((p, q) => q.y - p.y);
    ops.push(...items);
    return ops;
  }
  if (kind === 'flower') {
    // A clump of slim stems from the bottom edge, each with an open flower; a few narrow leaves at the foot. The card
    // is grey: the generator's vertex colours run from leaf green at the bottom to the flower colour at the top.
    const n = 3 + (variant % 2);
    for (let i = 0; i < 2; i++) {
      const sprite = pick(sheet, ['leaf-narrow'], r);
      ops.push({ sprite, x: c * (0.35 + 0.3 * r()), y: c * 0.99, angle: (i === 0 ? -1 : 1) * (0.3 + 0.3 * r()), length: c * (0.3 + 0.1 * r()), flip: r() < 0.5, tone: 0.55 + 0.15 * r(), twig: none });
    }
    for (let i = 0; i < n; i++) {
      const x0 = c * (0.3 + 0.4 * (i / Math.max(1, n - 1))) + (r() - 0.5) * c * 0.06;
      const headY = c * (0.32 + 0.3 * r());
      const x = x0 + (r() - 0.5) * c * 0.18;
      const length = c * (0.24 + 0.1 * r());
      const y = Math.max(length + c * 0.02, headY);
      const sprite = pick(sheet, r() < 0.6 ? ['flower'] : ['blossom'], r);
      ops.push({ sprite, x: Math.max(length * 0.55, Math.min(c - length * 0.55, x)), y, angle: (r() - 0.5) * 0.5, length, flip: r() < 0.5, tone: 0.85 + 0.2 * r(), twig: { x0, y0: c * 0.995, width: Math.max(1, c * 0.014) } });
    }
    return ops;
  }
  if (kind === 'fern') {
    // One frond lying along +x, its base at the left edge's middle.
    const sprite = pick(sheet, ['frond'], () => (variant + 0.5) / 4);
    ops.push({ sprite, x: c * 0.02, y: c * 0.5, angle: Math.PI / 2, length: c * 0.96, flip: r() < 0.5, tone: 1, twig: none });
    return ops;
  }
  if (kind === 'grass') {
    // Two or three tufts side by side, the widest at the back.
    const n = 2 + (variant % 2);
    for (let i = 0; i < n; i++) {
      const sprite = pick(sheet, ['tuft'], r);
      const s = sheet.sprites[sprite] as LeafSprite;
      const length = Math.min(c * (0.55 + 0.4 * r()), (c * 0.9 * s.h) / s.w);
      ops.push({ sprite, x: c * (0.2 + 0.6 * (n === 1 ? 0.5 : i / (n - 1))) + (r() - 0.5) * c * 0.1, y: c * 0.995, angle: (r() - 0.5) * 0.12, length, flip: r() < 0.5, tone: 0.85 + 0.25 * r(), twig: none });
    }
    return ops;
  }
  const shrub = kind === 'shrub';
  const base = { x: c * 0.5, y: c * 0.97 };
  // Tree cards carry many small leaves (a card is a leafy spray some 0.5-0.9 m across, its leaves a hand long): a dozen
  // big leaves per card read as vine leaves blown up to the size of a crown.
  const count = shrub ? 15 + Math.floor(r() * 5) : 26 + Math.floor(r() * 7);
  const items: DrawOp[] = [];
  for (let i = 0; i < count; i++) {
    const t = r();
    const spread = (r() - 0.5) * 2;
    // Attachment points: along a short twig for trees (fan outward), over an upper oval for shrubs (dense clump).
    const reach = shrub ? c * (0.12 + 0.42 * Math.sqrt(t)) : c * (0.1 + 0.62 * Math.sqrt(t));
    const a = spread * (shrub ? 1.05 : 0.95);
    let x = base.x + Math.sin(a) * reach * (shrub ? 1.05 : 0.9);
    let y = base.y - Math.cos(a) * reach;
    let length = c * (shrub ? 0.2 + 0.1 * r() : 0.15 + 0.07 * r());
    const angle = a * (0.85 + 0.4 * r()) + (r() - 0.5) * 0.5;
    const sprite = pick(sheet, shrub ? (r() < 0.35 ? ['leaf-narrow'] : ['leaf-broad']) : ['leaf-broad'], r);
    // The whole leaf stays inside its cell (a clipped leaf shows a straight cut in the crown).
    for (let k = 0; k < 6; k++) {
      const tipX = x + Math.sin(angle) * length;
      const tipY = y - Math.cos(angle) * length;
      const half = length * 0.38;
      if (Math.min(x, tipX) - half >= c * 0.02 && Math.max(x, tipX) + half <= c * 0.98 && Math.min(y, tipY) - half >= c * 0.02 && Math.max(y, tipY) <= c * 0.99) break;
      length *= 0.86;
      x = base.x + (x - base.x) * 0.9;
      y = base.y + (y - base.y) * 0.9;
    }
    // Shrubs show a few short stems near the base; tree leaves hang on their own stalks (long twigs read as hair).
    const twig = shrub && i % 4 === 0 ? { x0: base.x + (x - base.x) * 0.45, y0: base.y + (y - base.y) * 0.45, width: Math.max(1, c * 0.01) } : none;
    items.push({ sprite, x, y, angle, length, flip: r() < 0.5, tone: 0.72 + 0.36 * r(), twig });
  }
  // Back to front: the leaves nearest the base (lowest, in the shade of the others) first.
  items.sort((p, q) => q.y - p.y);
  ops.push(...items);
  return ops;
}

function srgbToLinear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Ratio level the mean leaf colour maps to (brighter leaf pixels go up to 1). */
export const RATIO_MEAN = 0.78;

/**
 * Turn composed sRGB pixels (straight alpha) into the cards' convention in place: linear ratios to the mean colour
 * of the solid pixels, scaled so the mean sits at {@link RATIO_MEAN}; transparent pixels take the mean so mips do
 * not darken the cut-out's edge. Returns the mean linear colour (before the division).
 */
export function neutralise(rgba: Uint8Array | Uint8ClampedArray, cut = 128): [number, number, number] {
  const n = rgba.length >> 2;
  const mean = [0, 0, 0];
  let solid = 0;
  for (let i = 0; i < n; i++) {
    if ((rgba[i * 4 + 3] as number) < cut) continue;
    for (let c = 0; c < 3; c++) mean[c] = (mean[c] as number) + srgbToLinear(rgba[i * 4 + c] as number);
    solid++;
  }
  const m: [number, number, number] = solid > 0 ? [(mean[0] as number) / solid, (mean[1] as number) / solid, (mean[2] as number) / solid] : [0.5, 0.5, 0.5];
  const fill = Math.round(RATIO_MEAN * 255);
  for (let i = 0; i < n; i++) {
    const k = i * 4;
    if ((rgba[k + 3] as number) === 0) {
      rgba[k] = rgba[k + 1] = rgba[k + 2] = fill;
      continue;
    }
    for (let c = 0; c < 3; c++) {
      const ratio = (srgbToLinear(rgba[k + c] as number) / Math.max(1e-4, m[c] as number)) * RATIO_MEAN;
      rgba[k + c] = Math.max(0, Math.min(255, Math.round(ratio * 255)));
    }
  }
  return m;
}

type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function canvas2d(w: number, h: number): { ctx: Ctx2D; read: () => Uint8ClampedArray; flush: () => void } | null {
  try {
    const c: OffscreenCanvas | HTMLCanvasElement = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = c.getContext('2d', { willReadFrequently: true }) as Ctx2D | null;
    if (!ctx) return null;
    // A one-pixel read makes the canvas run the drawing queued so far (filters and shadows are rasterised then, not at drawImage).
    return { ctx, read: () => ctx.getImageData(0, 0, w, h).data, flush: () => void ctx.getImageData(0, 0, 1, 1) };
  } catch {
    return null;
  }
}

/** An atlas in progress: one step per card variant (each is a few tens of milliseconds), then `finish`. */
export interface PhotoAtlasJob {
  steps: Array<() => void>;
  finish(): Uint8Array;
}

/**
 * Compose the `size × size` atlas (2 × 2 variants) of `kind` from the sheet image. Null when the kind has no
 * photographed sprites or no 2D canvas is available.
 */
export function composePhotoAtlas(kind: FoliageKind, size: number, sheet: LeafSheet, image: CanvasImageSource): Uint8Array | null {
  const job = photoAtlasJob(kind, size, sheet, image);
  if (!job) return null;
  for (const step of job.steps) step();
  return job.finish();
}

/**
 * The same atlas as {@link composePhotoAtlas}, in pieces: a caller that must not hold the main thread (the cards of a
 * whole forest are made at once) runs one step per task. Null in the same cases.
 */
export function photoAtlasJob(kind: FoliageKind, size: number, sheet: LeafSheet, image: CanvasImageSource): PhotoAtlasJob | null {
  if (!PHOTO_KINDS.has(kind) || !(size >= 32) || size > 4096) return null;
  const need = NEEDS[kind];
  if (need && !sheet.sprites.some((sp) => sp.use === need)) return null;
  const grey = GREY_KINDS.has(kind);
  const cv = canvas2d(size, size);
  if (!cv) return null;
  const { ctx } = cv;
  const c = size / 2;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const hasFilter = 'filter' in ctx;
  const steps: Array<() => void> = [];
  // Two steps per variant (the first half of its leaves, then the rest): the pieces stay near 100 ms on a slow rasteriser.
  for (let step = 0; step < 8; step++) steps.push(() => {
    const v = step >> 1;
    const ox = (v % 2) * c;
    const oy = Math.floor(v / 2) * c;
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, c, c);
    ctx.clip();
    const plan = photoPlan(kind, c, sheet, v);
    const half = Math.ceil(plan.length / 2);
    for (const op of step % 2 === 0 ? plan.slice(0, half) : plan.slice(half)) {
      const s = sheet.sprites[op.sprite];
      if (!s) continue;
      if (op.twig.width > 0) {
        ctx.shadowColor = 'rgba(0,0,0,0)';
        ctx.strokeStyle = grey ? 'rgb(96,96,96)' : 'rgb(92,74,52)';
        ctx.lineWidth = op.twig.width;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(ox + op.twig.x0, oy + op.twig.y0);
        ctx.lineTo(ox + op.x, oy + op.y);
        ctx.stroke();
      }
      const k = op.length / s.h;
      ctx.save();
      ctx.translate(ox + op.x, oy + op.y);
      ctx.rotate(op.angle);
      if (op.flip) ctx.scale(-1, 1);
      // A soft shadow on whatever lies below: leaves overlap in depth, not as flat stickers.
      ctx.shadowColor = 'rgba(8,14,4,0.55)';
      ctx.shadowBlur = Math.max(1, c * 0.012);
      ctx.shadowOffsetX = c * 0.006;
      ctx.shadowOffsetY = c * 0.01;
      if (hasFilter) ctx.filter = grey ? `grayscale(1) brightness(${op.tone.toFixed(3)})` : `brightness(${op.tone.toFixed(3)})`;
      ctx.drawImage(image, s.x, s.y, s.w, s.h, (-s.w * k) / 2, -s.h * k, s.w * k, s.h * k);
      ctx.restore();
    }
    ctx.restore();
    cv.flush();
  });
  const finish = (): Uint8Array => {
    const px = cv.read();
    // Hard alpha for the alpha test (the canvas anti-aliases edges and the shadow adds faint alpha around leaves).
    for (let i = 3; i < px.length; i += 4) px[i] = (px[i] as number) >= 170 ? 255 : 0;
    // Shadow pixels outside every leaf were made transparent above; unpremultiplied colour of semi-solid edges is kept.
    const out = new Uint8Array(px.buffer.slice(0));
    neutralise(out);
    return out;
  };
  return { steps, finish };
}

/** The sheet and its decoded image. */
export interface LeafPhotos {
  sheet: LeafSheet;
  image: ImageBitmap;
}

/** Fetch and decode the leaf sprite sheet from `baseUrl` (e.g. `/foliage/`). Null on any failure. */
export async function loadLeafPhotos(baseUrl: string): Promise<LeafPhotos | null> {
  try {
    if (typeof fetch !== 'function' || typeof createImageBitmap !== 'function') return null;
    const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const res = await fetch(`${base}leaf-sprites.json`);
    if (!res.ok) return null;
    const text = await res.text();
    if (text.length > 128 * 1024) return null;
    const sheet = parseLeafSheet(JSON.parse(text));
    if (!sheet) return null;
    const img = await fetch(`${base}leaf-sprites.webp`);
    if (!img.ok) return null;
    const blob = await img.blob();
    if (blob.size > 16 * 1024 * 1024) return null;
    const image = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    if (image.width !== sheet.width || image.height !== sheet.height) {
      image.close();
      return null;
    }
    return { sheet, image };
  } catch {
    return null;
  }
}
