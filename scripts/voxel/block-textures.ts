/**
 * Block texture sheets: downloads the pinned ambientCG (CC0) materials of `assets/voxel-textures.json`
 * (SHA-256 checked, host allow-listed, size capped, archives listed before extraction), scales every map
 * to 128 px in a headless browser and writes three sheets plus an index to `apps/studio/public/blocks/`:
 *
 * - `block-albedo.webp`  sRGB colour,
 * - `block-normal.webp`  OpenGL tangent-space normals (re-normalised after scaling),
 * - `block-orm.webp`     R ambient occlusion (or 1), G roughness, B height (displacement),
 * - `block-materials.json` material keys, grid slots, mean linear colour, source ids and licence.
 *
 * Run: `npx tsx scripts/voxel/block-textures.ts`. The sheets are committed; the script is only needed to
 * change the material list.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { z } from 'zod';
import { withBrowserPage } from '../assets/browser';
import { SOURCE_DIR } from '../assets/fetch';

const ROOT = resolve(import.meta.dirname, '../..');
const Sources = z.object({
  licence: z.literal('CC0-1.0'),
  licenceUrl: z.string().url(),
  resolution: z.literal('1K-JPG'),
  size: z.number().int().min(32).max(512),
  columns: z.number().int().min(1).max(16),
  materials: z.array(z.object({ key: z.string().regex(/^[a-z][a-z-]{1,23}$/), id: z.string().regex(/^[A-Za-z0-9]{4,24}$/), note: z.string(), sha256: z.string().regex(/^[0-9a-f]{64}$/) })).min(1).max(64),
});
const MAX_ARCHIVE = 40 * 1024 * 1024;
const ALLOWED_HOSTS = new Set(['ambientcg.com', 'acg-download.struffelproductions.com']);
const OUT = join(ROOT, 'apps/studio/public/blocks');

async function download(url: string): Promise<Buffer> {
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    const host = new URL(current).hostname;
    if (!ALLOWED_HOSTS.has(host)) throw new Error(`host ${host} is not allowed`);
    const res = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(120_000) });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location') as string, current).toString();
      continue;
    }
    if (!res.ok) throw new Error(`GET ${current}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_ARCHIVE) throw new Error(`GET ${current}: larger than ${MAX_ARCHIVE} bytes`);
    return buf;
  }
  throw new Error(`GET ${url}: too many redirects`);
}

function extract(zip: string, dir: string, id: string): void {
  const env = { PATH: process.env['PATH'] ?? '/usr/bin:/bin' };
  const list = spawnSync('unzip', ['-Z1', zip], { encoding: 'utf8', timeout: 60_000, env });
  if (list.status !== 0) throw new Error(`unzip -Z1 ${zip} failed`);
  for (const entry of list.stdout.split('\n')) {
    if (entry === '') continue;
    if (entry.startsWith('/') || entry.split(/[\\/]/).includes('..')) throw new Error(`unsafe archive entry ${entry}`);
  }
  mkdirSync(dir, { recursive: true });
  const r = spawnSync('unzip', ['-q', '-o', zip, `${id}_1K-JPG_*.jpg`, '-d', dir], { timeout: 120_000, env });
  if (r.status !== 0 && r.status !== 11) throw new Error(`unzip ${zip} failed`);
}

const PAGE = `
const S = SIZE_PLACEHOLDER;
const COLS = COLS_PLACEHOLDER;
window.__sheets = null;
async function decode(b64) {
  if (!b64) return null;
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = new OffscreenCanvas(S, S);
  const ctx = c.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, S, S);
  return ctx.getImageData(0, 0, S, S).data;
}
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
window.__begin = (rows) => {
  const mk = () => new OffscreenCanvas(S * COLS, S * rows);
  window.__sheets = { rows, albedo: mk(), normal: mk(), orm: mk() };
  for (const k of ['albedo', 'normal', 'orm']) {
    const ctx = window.__sheets[k].getContext('2d');
    ctx.fillStyle = k === 'normal' ? '#8080ff' : '#808080';
    ctx.fillRect(0, 0, S * COLS, S * rows);
  }
};
window.__add = async (job) => {
  const color = await decode(job.color);
  const normal = await decode(job.normal);
  const rough = await decode(job.rough);
  const ao = await decode(job.ao);
  const height = await decode(job.height);
  const n = S * S;
  const mean = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) mean[c] += lin(color[i * 4 + c] / 255);
  for (let c = 0; c < 3; c++) mean[c] /= n;
  const nor = new Uint8ClampedArray(n * 4);
  const orm = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    let x = normal ? normal[o] / 127.5 - 1 : 0, y = normal ? normal[o + 1] / 127.5 - 1 : 0, z = normal ? normal[o + 2] / 127.5 - 1 : 1;
    const l = Math.hypot(x, y, z) || 1;
    nor[o] = Math.round((x / l * 0.5 + 0.5) * 255); nor[o + 1] = Math.round((y / l * 0.5 + 0.5) * 255); nor[o + 2] = Math.round((z / l * 0.5 + 0.5) * 255); nor[o + 3] = 255;
    orm[o] = ao ? ao[o] : 255;
    orm[o + 1] = rough ? rough[o] : 204;
    orm[o + 2] = height ? height[o] : 128;
    orm[o + 3] = 255;
  }
  const x = (job.slot % COLS) * S, y = Math.floor(job.slot / COLS) * S;
  const col = new Uint8ClampedArray(color);
  for (let i = 0; i < n; i++) col[i * 4 + 3] = 255;
  window.__sheets.albedo.getContext('2d').putImageData(new ImageData(col, S, S), x, y);
  window.__sheets.normal.getContext('2d').putImageData(new ImageData(nor, S, S), x, y);
  window.__sheets.orm.getContext('2d').putImageData(new ImageData(orm, S, S), x, y);
  return mean;
};
async function encode(canvas, q) {
  const blob = await canvas.convertToBlob({ type: 'image/webp', quality: q });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}
window.__finish = async () => ({ albedo: await encode(window.__sheets.albedo, 0.9), normal: await encode(window.__sheets.normal, 0.93), orm: await encode(window.__sheets.orm, 0.9) });
window.__ready = true;
`;

function mapFile(dir: string, id: string, suffix: string): string | null {
  const p = join(dir, `${id}_1K-JPG_${suffix}.jpg`);
  return existsSync(p) ? readFileSync(p).toString('base64') : null;
}

async function main(): Promise<void> {
  const cfg = Sources.parse(JSON.parse(readFileSync(join(ROOT, 'assets/voxel-textures.json'), 'utf8')));
  mkdirSync(join(SOURCE_DIR, 'ambientcg'), { recursive: true });
  for (const m of cfg.materials) {
    const zip = join(SOURCE_DIR, 'ambientcg', `${m.id}_1K-JPG.zip`);
    let data: Buffer | null = existsSync(zip) ? readFileSync(zip) : null;
    if (!data || createHash('sha256').update(data).digest('hex') !== m.sha256) {
      console.log(`download ${m.id}`);
      data = await download(`https://ambientcg.com/get?file=${m.id}_1K-JPG.zip`);
      writeFileSync(zip, data);
    }
    const got = createHash('sha256').update(data).digest('hex');
    if (got !== m.sha256) throw new Error(`${m.id}: sha256 mismatch (got ${got})`);
    const dir = join(SOURCE_DIR, 'ambientcg', m.id);
    if (!existsSync(join(dir, `${m.id}_1K-JPG_Color.jpg`))) extract(zip, dir, m.id);
  }
  const rows = Math.ceil(cfg.materials.length / cfg.columns);
  mkdirSync(OUT, { recursive: true });
  const index: Array<{ key: string; slot: number; source: string; mean: [number, number, number] }> = [];
  const sheets = await withBrowserPage(async (page) => {
    await page.addScriptTag({ content: PAGE.replace('SIZE_PLACEHOLDER', String(cfg.size)).replace('COLS_PLACEHOLDER', String(cfg.columns)) });
    await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true);
    await page.evaluate((r) => (window as unknown as { __begin(r: number): void }).__begin(r), rows);
    let slot = 0;
    for (const m of cfg.materials) {
      const dir = join(SOURCE_DIR, 'ambientcg', m.id);
      const color = mapFile(dir, m.id, 'Color');
      const normal = mapFile(dir, m.id, 'NormalGL');
      if (!color || !normal) throw new Error(`${m.id}: Color / NormalGL maps missing`);
      const mean = await page.evaluate((job) => (window as unknown as { __add(j: unknown): Promise<[number, number, number]> }).__add(job), {
        slot,
        color,
        normal,
        rough: mapFile(dir, m.id, 'Roughness'),
        ao: mapFile(dir, m.id, 'AmbientOcclusion'),
        height: mapFile(dir, m.id, 'Displacement'),
      });
      index.push({ key: m.key, slot, source: `ambientcg/${m.id}`, mean: mean.map((v) => Math.round(v * 1e4) / 1e4) as [number, number, number] });
      slot++;
    }
    return page.evaluate(() => (window as unknown as { __finish(): Promise<Record<string, string>> }).__finish());
  });
  for (const k of ['albedo', 'normal', 'orm'] as const) writeFileSync(join(OUT, `block-${k}.webp`), Buffer.from(sheets[k] ?? '', 'base64'));
  const files = Object.fromEntries((['albedo', 'normal', 'orm'] as const).map((k) => [k, createHash('sha256').update(readFileSync(join(OUT, `block-${k}.webp`))).digest('hex').slice(0, 16)]));
  writeFileSync(
    join(OUT, 'block-materials.json'),
    `${JSON.stringify({ licence: cfg.licence, licenceUrl: cfg.licenceUrl, size: cfg.size, columns: cfg.columns, rows, files, materials: index }, null, 1)}\n`,
  );
  console.log(`wrote ${index.length} materials (${cfg.size} px) to ${OUT}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
