/**
 * Leaf sprite sheet for the foliage cards: downloads the pinned Poly Haven (CC0) leaf, frond, conifer twig,
 * flower and grass photographs of `assets/foliage-sources.json` (host allow-listed, size capped, SHA-256 checked),
 * cuts the individual leaves, fronds, needle sprays, flower heads and grass tufts out of each atlas by their alpha
 * (connected regions that do not touch the border, filtered by size, fill and, for flowers, colour), scales them
 * to a common size per kind and packs them into one sheet:
 *
 * - `apps/studio/public/foliage/leaf-sprites.webp`  sRGB colour with the cut-out alpha,
 * - `apps/studio/public/foliage/leaf-sprites.json`  sprite rectangles, kinds, sources and licence.
 *
 * The renderer composes its leaf cards from these sprites (`render/src/materials/foliage-photo.ts`). Run:
 * `npx tsx scripts/foliage/leaf-sprites.ts`. The sheet is committed; the script is only needed to change
 * the sources.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { withBrowserPage } from '../assets/browser';
import { SOURCE_DIR } from '../assets/fetch';

const ROOT = resolve(import.meta.dirname, '../..');
const OUT = join(ROOT, 'apps/studio/public/foliage');
const MAX_FILE = 16 * 1024 * 1024;
const ALLOWED_HOSTS = new Set(['dl.polyhaven.org']);

const File = z.object({ url: z.string().url(), sha256: z.string().regex(/^[0-9a-f]{64}$/) });
const Config = z.object({
  licence: z.literal('CC0-1.0'),
  licenceUrl: z.string().url(),
  retrieved: z.string(),
  sources: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9_]{2,40}$/),
        page: z.string().url(),
        author: z.string().max(120),
        use: z.enum(['leaf-broad', 'leaf-narrow', 'frond', 'tuft', 'needle', 'blossom', 'flower']),
        max: z.number().int().min(1).max(24),
        diffuse: File,
        alpha: File,
      }),
    )
    .min(1)
    .max(16),
});

async function fetchPinned(file: z.infer<typeof File>, cacheName: string): Promise<Buffer> {
  const path = join(SOURCE_DIR, 'polyhaven-foliage', cacheName);
  if (existsSync(path)) {
    const buf = readFileSync(path);
    if (createHash('sha256').update(buf).digest('hex') === file.sha256) return buf;
  }
  const host = new URL(file.url).hostname;
  if (!ALLOWED_HOSTS.has(host)) throw new Error(`host ${host} is not allowed`);
  console.log(`download ${file.url}`);
  const res = await fetch(file.url, { redirect: 'error', signal: AbortSignal.timeout(120_000), headers: { 'user-agent': 'aether-asset-fetch' } });
  if (!res.ok) throw new Error(`GET ${file.url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_FILE) throw new Error(`GET ${file.url}: larger than ${MAX_FILE} bytes`);
  const got = createHash('sha256').update(buf).digest('hex');
  if (got !== file.sha256) throw new Error(`${file.url}: sha256 mismatch (got ${got})`);
  mkdirSync(join(SOURCE_DIR, 'polyhaven-foliage'), { recursive: true });
  writeFileSync(path, buf);
  return buf;
}

/** Page code: decode, label regions, cut sprites, pack, encode. */
const PAGE = `
window.__sprites = [];
async function decode(b64) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, bmp.width, bmp.height);
}
const RULES = {
  // Leaves are taller than wide and never fill their box like a disc does (berries, seed heads).
  'leaf-broad': { minArea: 1500, minFill: 0.3, maxFill: 0.72, minAspect: 0.95, minH: 40, region: null },
  'leaf-narrow': { minArea: 600, minFill: 0.18, maxFill: 0.72, minAspect: 1.2, minH: 50, region: null },
  frond: { minArea: 3000, minFill: 0.12, maxFill: 1, minAspect: 2, minH: 200, region: null },
  tuft: { minArea: 2500, minFill: 0.08, maxFill: 1, minAspect: 0, minH: 60, region: 0.55 },
  // A conifer spray: a twig with its needles, taller than wide.
  needle: { minArea: 2500, minFill: 0.12, maxFill: 0.65, minAspect: 0.8, minH: 100, region: null },
  // Open flowers: round heads (5 petals, a daisy), not leaves (colour, below) and not loose petals (size).
  blossom: { minArea: 500, minFill: 0.35, maxFill: 0.95, minAspect: 0.6, minH: 20, region: null, flower: true },
  flower: { minArea: 6000, minFill: 0.45, maxFill: 0.95, minAspect: 0.6, minH: 70, region: null, flower: true },
};
window.__extract = async (job) => {
  const diff = await decode(job.diffuse);
  const alpha = await decode(job.alpha);
  const W = alpha.width, H = alpha.height;
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) mask[i] = alpha.data[i * 4] >= 128 ? 1 : 0;
  const label = new Int32Array(W * H).fill(-1);
  const regions = [];
  const stack = new Int32Array(W * H);
  for (let start = 0; start < W * H; start++) {
    if (!mask[start] || label[start] >= 0) continue;
    const id = regions.length;
    let sp = 0, area = 0, x0 = W, y0 = H, x1 = -1, y1 = -1;
    stack[sp++] = start;
    label[start] = id;
    while (sp > 0) {
      const p = stack[--sp];
      const x = p % W, y = (p / W) | 0;
      area++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (mask[q] && label[q] < 0) { label[q] = id; stack[sp++] = q; }
      }
    }
    regions.push({ id, area, x0, y0, x1, y1 });
  }
  const rule = RULES[job.use];
  const picked = regions.filter((r) => {
    const w = r.x1 - r.x0 + 1, h = r.y1 - r.y0 + 1;
    if (r.area < rule.minArea || h < rule.minH) return false;
    if (r.x0 <= 1 || r.y0 <= 1 || r.x1 >= W - 2 || r.y1 >= H - 2) return false;
    const fill = r.area / (w * h);
    if (fill < rule.minFill || fill > rule.maxFill || h / w < rule.minAspect) return false;
    if (rule.region !== null && r.y0 < H * rule.region) return false;
    if (rule.flower && h / w > 1.6) return false;
    return true;
  }).filter((r) => {
    // Flowers: keep the coloured heads, drop the green leaves and stems of the same sheet.
    if (!rule.flower) return true;
    let rs = 0, gs = 0, bs = 0, n = 0;
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
      const s = y * W + x;
      if (label[s] !== r.id) continue;
      rs += diff.data[s * 4]; gs += diff.data[s * 4 + 1]; bs += diff.data[s * 4 + 2]; n++;
    }
    return n > 0 && gs < Math.max(rs, bs) * 0.98;
  }).filter((r) => {
    if (rule.flower) return true;
    // Not a leaf: pale, unsaturated patches (cut fruit, seed heads, petals) on more than a few percent of the region.
    let pale = 0;
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
      const s = y * W + x;
      if (label[s] !== r.id) continue;
      if (Math.min(diff.data[s * 4], diff.data[s * 4 + 1], diff.data[s * 4 + 2]) > 165) pale++;
    }
    return pale / r.area < 0.03;
  }).sort((a, b) => b.area - a.area || a.y0 - b.y0 || a.x0 - b.x0).slice(0, job.max);
  for (const r of picked) {
    const pad = 2;
    const x0 = Math.max(0, r.x0 - pad), y0 = Math.max(0, r.y0 - pad), x1 = Math.min(W - 1, r.x1 + pad), y1 = Math.min(H - 1, r.y1 + pad);
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const img = new ImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = (y0 + y) * W + (x0 + x), d = (y * w + x) * 4;
      img.data[d] = diff.data[s * 4]; img.data[d + 1] = diff.data[s * 4 + 1]; img.data[d + 2] = diff.data[s * 4 + 2];
      // Keep the soft edge of this region only (a neighbour inside the box stays transparent).
      let own = label[s] === r.id;
      if (!own) for (let dy = -1; dy <= 1 && !own; dy++) for (let dx = -1; dx <= 1 && !own; dx++) {
        const nx = x0 + x + dx, ny = y0 + y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && label[ny * W + nx] === r.id) own = true;
      }
      img.data[d + 3] = own ? alpha.data[s * 4] : 0;
    }
    const c = new OffscreenCanvas(w, h);
    c.getContext('2d').putImageData(img, 0, 0);
    window.__sprites.push({ use: job.use, source: job.id, canvas: c, w, h });
  }
  return picked.length;
};
const TARGET = { 'leaf-broad': ['max', 160], 'leaf-narrow': ['h', 192], frond: ['h', 416], tuft: ['w', 336], needle: ['h', 320], blossom: ['max', 112], flower: ['max', 176] };
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
window.__pack = async (sheetW) => {
  const items = window.__sprites.map((s, i) => {
    const [mode, t] = TARGET[s.use];
    const k = mode === 'max' ? t / Math.max(s.w, s.h) : mode === 'h' ? t / s.h : t / s.w;
    return { i, s, w: Math.max(4, Math.round(s.w * k)), h: Math.max(4, Math.round(s.h * k)) };
  });
  const order = items.slice().sort((a, b) => b.h - a.h || a.i - b.i);
  let x = 0, y = 0, rowH = 0;
  const gap = 4;
  for (const it of order) {
    if (x + it.w > sheetW) { x = 0; y += rowH + gap; rowH = 0; }
    it.x = x; it.y = y;
    x += it.w + gap;
    rowH = Math.max(rowH, it.h);
  }
  // The sheet is read on the CPU only (cards are composed from it), so its height need not be a power of two.
  const sheetH = Math.ceil((y + rowH) / 64) * 64;
  const sheet = new OffscreenCanvas(sheetW, sheetH);
  const ctx = sheet.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const out = [];
  for (const it of items) {
    ctx.drawImage(it.s.canvas, it.x, it.y, it.w, it.h);
    const px = ctx.getImageData(it.x, it.y, it.w, it.h).data;
    const mean = [0, 0, 0];
    let wsum = 0;
    for (let p = 0; p < it.w * it.h; p++) {
      const a = px[p * 4 + 3] / 255;
      if (a < 0.5) continue;
      for (let c = 0; c < 3; c++) mean[c] += lin(px[p * 4 + c] / 255);
      wsum++;
    }
    out.push({ use: it.s.use, source: it.s.source, x: it.x, y: it.y, w: it.w, h: it.h, mean: mean.map((m) => Math.round((m / Math.max(1, wsum)) * 1e4) / 1e4) });
  }
  const blob = await sheet.convertToBlob({ type: 'image/webp', quality: 0.92 });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { width: sheetW, height: sheetH, sprites: out, webp: btoa(s) };
};
window.__ready = true;
`;

interface Packed {
  width: number;
  height: number;
  sprites: Array<{ use: string; source: string; x: number; y: number; w: number; h: number; mean: [number, number, number] }>;
  webp: string;
}

async function main(): Promise<void> {
  const cfg = Config.parse(JSON.parse(readFileSync(join(ROOT, 'assets/foliage-sources.json'), 'utf8')));
  const files = new Map<string, { diffuse: string; alpha: string }>();
  for (const s of cfg.sources) {
    files.set(s.id, { diffuse: (await fetchPinned(s.diffuse, `${s.id}_diff_1k.jpg`)).toString('base64'), alpha: (await fetchPinned(s.alpha, `${s.id}_alpha_1k.jpg`)).toString('base64') });
  }
  const packed = await withBrowserPage(async (page) => {
    await page.addScriptTag({ content: PAGE });
    await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true);
    for (const s of cfg.sources) {
      const f = files.get(s.id)!;
      const n = await page.evaluate((job) => (window as unknown as { __extract(j: unknown): Promise<number> }).__extract(job), { id: s.id, use: s.use, max: s.max, diffuse: f.diffuse, alpha: f.alpha });
      console.log(`${s.id}: ${n} ${s.use} sprites`);
    }
    return page.evaluate((w) => (window as unknown as { __pack(w: number): Promise<Packed> }).__pack(w), 1024);
  });
  mkdirSync(OUT, { recursive: true });
  const webp = Buffer.from(packed.webp, 'base64');
  writeFileSync(join(OUT, 'leaf-sprites.webp'), webp);
  const index = {
    licence: cfg.licence,
    licenceUrl: cfg.licenceUrl,
    sources: cfg.sources.map((s) => ({ id: s.id, page: s.page, author: s.author })),
    width: packed.width,
    height: packed.height,
    file: createHash('sha256').update(webp).digest('hex').slice(0, 16),
    sprites: packed.sprites,
  };
  writeFileSync(join(OUT, 'leaf-sprites.json'), `${JSON.stringify(index, null, 1)}\n`);
  console.log(`wrote ${packed.sprites.length} sprites (${packed.width}x${packed.height}, ${webp.length} bytes) to ${OUT}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
