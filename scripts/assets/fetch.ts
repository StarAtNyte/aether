/**
 * Download the curated CC0 asset sources listed in `assets/sources.json`
 * into a local cache outside the repository (default
 * `~/.cache/aether-asset-src`, override with `AETHER_ASSET_SRC`).
 *
 * Usage: `npm run assets:fetch` (then `npm run assets:build`).
 *
 * - Sequential, polite downloads (one request at a time, short pauses).
 * - Every archive is verified against its recorded SHA-256; Poly Haven files
 *   against the MD5 the Poly Haven API publishes. Mismatches abort.
 * - Only CC0-1.0 / CC-BY-4.0 entries are accepted; Kenney archives must also
 *   carry a CC0 `License.txt`.
 * - Archives are extracted with `unzip` (argument array, no shell) into a
 *   fresh directory; entries escaping the target directory are refused.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { z } from 'zod';

const ROOT = resolve(import.meta.dirname, '../..');
/** Local download cache (never inside the repository). */
export const SOURCE_DIR = resolve(process.env['AETHER_ASSET_SRC'] ?? join(homedir(), '.cache', 'aether-asset-src'));

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const PAUSE_MS = 400;
const ALLOWED_LICENCES = new Set(['CC0-1.0', 'CC-BY-4.0']);
// ambientCG serves downloads from its own CDN host (Struffel Productions runs ambientCG).
const ALLOWED_HOSTS = new Set(['kenney.nl', 'api.polyhaven.com', 'dl.polyhaven.org', 'ambientcg.com', 'acg-download.struffelproductions.com']);

const Pack = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  provider: z.literal('kenney'),
  title: z.string(),
  version: z.string(),
  author: z.string(),
  licence: z.string(),
  licenceUrl: z.string().url(),
  page: z.string().url(),
  url: z.string().url(),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  retrieved: z.string(),
});
/** Schema of `assets/sources.json`. */
export const Sources = z.object({
  packs: z.array(Pack).max(64),
  polyhaven: z.object({
    licence: z.string(),
    api: z.string().url(),
    models: z.array(z.string().regex(/^[A-Za-z0-9_]+$/)).max(64),
    hdris: z.array(z.string().regex(/^[A-Za-z0-9_]+$/)).max(16),
    resolution: z.enum(['1k', '2k']),
  }),
  /** ambientCG PBR materials for the photo finishes (pinned SHA-256 per archive). */
  ambientcg: z
    .object({
      licence: z.literal('CC0-1.0'),
      licenceUrl: z.string().url(),
      resolution: z.literal('1K-JPG'),
      materials: z
        .array(
          z.object({
            finish: z.string().regex(/^[a-z-]+$/),
            id: z.string().regex(/^[A-Za-z0-9]+$/),
            /** Real-world size of one texture tile in metres (default: the finish's own tile). */
            tile: z.number().positive().max(10).optional(),
            sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
          }),
        )
        .max(32),
    })
    .optional(),
});
export type Sources = z.infer<typeof Sources>;

/** Read and validate `assets/sources.json`. */
export function readSources(): Sources {
  return Sources.parse(JSON.parse(readFileSync(join(ROOT, 'assets', 'sources.json'), 'utf8')));
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function checkUrl(url: string): void {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname)) throw new Error(`refusing to download from ${u.origin}`);
}

async function download(url: string, cap: number): Promise<Buffer> {
  checkUrl(url);
  await sleep(PAUSE_MS);
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(180_000) });
  if (!res.ok || !res.body) throw new Error(`GET ${url}: HTTP ${res.status}`);
  checkUrl(res.url);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of res.body) {
    total += chunk.byteLength;
    if (total > cap) throw new Error(`GET ${url}: larger than ${cap} bytes`);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function json(url: string): Promise<unknown> {
  return JSON.parse((await download(url, 8 * 1024 * 1024)).toString('utf8')) as unknown;
}

const hash = (algo: 'sha256' | 'md5', data: Buffer): string => createHash(algo).update(data).digest('hex');

/** Every path inside `dir` (recursive). */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function extract(zip: string, dir: string): void {
  // List first: refuse absolute paths and `..` segments before anything is written.
  const list = spawnSync('unzip', ['-Z1', zip], { encoding: 'utf8', timeout: 60_000, env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin' } });
  if (list.status !== 0) throw new Error(`unzip -Z1 ${zip} failed: ${list.stderr}`);
  for (const entry of list.stdout.split('\n')) {
    if (entry === '') continue;
    if (entry.startsWith('/') || entry.split(/[\\/]/).includes('..')) throw new Error(`unsafe archive entry ${entry}`);
  }
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const r = spawnSync('unzip', ['-q', '-o', zip, '-d', dir], { timeout: 120_000, env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin' } });
  if (r.status !== 0) throw new Error(`unzip ${zip} failed`);
  const root = resolve(dir) + sep;
  for (const p of walk(dir)) if (!resolve(p).startsWith(root)) throw new Error(`archive escaped ${dir}`);
}

async function fetchPack(p: z.infer<typeof Pack>): Promise<void> {
  if (!ALLOWED_LICENCES.has(p.licence)) throw new Error(`${p.id}: licence ${p.licence} is not allowed`);
  const slug = p.id.replace(/^kenney-/, '');
  const zipPath = join(SOURCE_DIR, 'kenney', `${slug}.zip`);
  const dir = join(SOURCE_DIR, 'kenney', slug);
  mkdirSync(join(SOURCE_DIR, 'kenney'), { recursive: true });
  let data: Buffer | null = existsSync(zipPath) ? readFileSync(zipPath) : null;
  if (!data || hash('sha256', data) !== p.sha256) {
    console.log(`download ${p.id} (${(p.bytes / 1e6).toFixed(1)} MB)`);
    data = await download(p.url, MAX_ARCHIVE_BYTES);
    const got = hash('sha256', data);
    if (got !== p.sha256) throw new Error(`${p.id}: sha256 mismatch (got ${got})`);
    writeFileSync(zipPath, data);
  }
  if (!existsSync(join(dir, 'License.txt'))) extract(zipPath, dir);
  const licence = readFileSync(join(dir, 'License.txt'), 'utf8');
  if (!/Creative Commons Zero, CC0/.test(licence)) throw new Error(`${p.id}: License.txt does not state CC0`);
  console.log(`ok ${p.id}`);
}

const PhFile = z.object({ url: z.string().url(), md5: z.string().regex(/^[0-9a-f]{32}$/), size: z.number().int().positive() });
const PhGltf = z.object({ gltf: z.record(z.string(), z.object({ gltf: PhFile.extend({ include: z.record(z.string(), PhFile).optional() }) })) });
const PhHdri = z.object({ hdri: z.record(z.string(), z.object({ hdr: PhFile })) });
const PhInfo = z.object({ name: z.string(), authors: z.record(z.string(), z.string()), date_published: z.number().int(), categories: z.array(z.string()), tags: z.array(z.string()).optional() });

/** Provenance written next to the Poly Haven downloads (read by the build script). */
export interface PolyhavenRecord {
  id: string;
  type: 'model' | 'hdri';
  name: string;
  authors: string[];
  published: string;
  categories: string[];
  tags: string[];
  files: Array<{ path: string; url: string; md5: string }>;
}

async function savePh(file: z.infer<typeof PhFile>, path: string): Promise<void> {
  if (existsSync(path) && hash('md5', readFileSync(path)) === file.md5) return;
  const data = await download(file.url, MAX_FILE_BYTES);
  const got = hash('md5', data);
  if (got !== file.md5) throw new Error(`${file.url}: md5 mismatch (got ${got})`);
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, data);
}

function safeRelative(rel: string): string {
  if (rel.startsWith('/') || rel.split(/[\\/]/).includes('..')) throw new Error(`unsafe include path ${rel}`);
  return rel;
}

async function fetchPolyhaven(src: Sources['polyhaven']): Promise<void> {
  if (src.licence !== 'CC0-1.0') throw new Error('Poly Haven entries must be CC0-1.0');
  const records: PolyhavenRecord[] = [];
  for (const id of src.models) {
    const info = PhInfo.parse(await json(`${src.api}/info/${id}`));
    const files = PhGltf.parse(await json(`${src.api}/files/${id}`));
    const res = files.gltf[src.resolution];
    if (!res) throw new Error(`${id}: no ${src.resolution} glTF`);
    const dir = join(SOURCE_DIR, 'polyhaven', 'models', id);
    const list: PolyhavenRecord['files'] = [];
    const main = join(dir, `${id}.gltf`);
    await savePh(res.gltf, main);
    list.push({ path: `${id}.gltf`, url: res.gltf.url, md5: res.gltf.md5 });
    for (const [rel, f] of Object.entries(res.gltf.include ?? {})) {
      await savePh(f, join(dir, safeRelative(rel)));
      list.push({ path: rel, url: f.url, md5: f.md5 });
    }
    records.push({ id, type: 'model', name: info.name, authors: Object.keys(info.authors), published: new Date(info.date_published * 1000).toISOString().slice(0, 10), categories: info.categories, tags: info.tags ?? [], files: list });
    console.log(`ok polyhaven model ${id}`);
  }
  for (const id of src.hdris) {
    const info = PhInfo.parse(await json(`${src.api}/info/${id}`));
    const files = PhHdri.parse(await json(`${src.api}/files/${id}`));
    const f = files.hdri[src.resolution]?.hdr;
    if (!f) throw new Error(`${id}: no ${src.resolution} HDR`);
    const rel = `${id}_${src.resolution}.hdr`;
    await savePh(f, join(SOURCE_DIR, 'polyhaven', 'hdris', rel));
    records.push({ id, type: 'hdri', name: info.name, authors: Object.keys(info.authors), published: new Date(info.date_published * 1000).toISOString().slice(0, 10), categories: info.categories, tags: info.tags ?? [], files: [{ path: rel, url: f.url, md5: f.md5 }] });
    console.log(`ok polyhaven hdri ${id}`);
  }
  writeFileSync(join(SOURCE_DIR, 'polyhaven', 'provenance.json'), JSON.stringify(records, null, 2));
}

/**
 * ambientCG archives: the API publishes no checksum, so the first download
 * pins its SHA-256 into `assets/sources.json` and every later fetch must match.
 */
async function fetchAmbientcg(src: NonNullable<Sources['ambientcg']>): Promise<void> {
  let pinned = false;
  for (const m of src.materials) {
    const dir = join(SOURCE_DIR, 'ambientcg', m.id);
    const zipPath = join(SOURCE_DIR, 'ambientcg', `${m.id}_${src.resolution}.zip`);
    mkdirSync(join(SOURCE_DIR, 'ambientcg'), { recursive: true });
    let data: Buffer | null = existsSync(zipPath) ? readFileSync(zipPath) : null;
    if (!data || (m.sha256 && hash('sha256', data) !== m.sha256)) {
      console.log(`download ambientCG ${m.id}`);
      data = await download(`https://ambientcg.com/get?file=${m.id}_${src.resolution}.zip`, MAX_ARCHIVE_BYTES);
      writeFileSync(zipPath, data);
    }
    const got = hash('sha256', data);
    if (m.sha256 && got !== m.sha256) throw new Error(`${m.id}: sha256 mismatch (got ${got})`);
    if (!m.sha256) {
      m.sha256 = got;
      pinned = true;
    }
    if (!existsSync(dir)) extract(zipPath, dir);
    console.log(`ok ambientCG ${m.id} → ${m.finish}`);
  }
  if (pinned) {
    const path = join(ROOT, 'assets', 'sources.json');
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    raw['ambientcg'] = src;
    writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`);
    console.log('pinned new ambientCG checksums in assets/sources.json');
  }
}

async function main(): Promise<void> {
  const sources = readSources();
  mkdirSync(SOURCE_DIR, { recursive: true });
  // `--only=ambientcg`: just the photographed finish materials (small, no model packs).
  if (!process.argv.includes('--only=ambientcg')) {
    for (const p of sources.packs) await fetchPack(p);
    await fetchPolyhaven(sources.polyhaven);
  }
  if (sources.ambientcg) await fetchAmbientcg(sources.ambientcg);
  console.log(`sources ready in ${SOURCE_DIR}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
