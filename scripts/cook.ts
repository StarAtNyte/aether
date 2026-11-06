/**
 * Cook a template: load it headless in the real renderer (the player page, `#t=<slug>&cook=record`), once per render tier,
 * and serialize what a viewer would otherwise make on its first visit into a cooked package (packages/render/src/cook/
 * format.ts; docs/ARCHITECTURE-STREAMING.md, "Cooked package format"):
 *
 * - every generated output, in the geometry cache's encoding, packed per grid cell nearest the opening first;
 * - the program set of each tier, as gpu/program-cache.ts records it (the exact vertex and fragment sources);
 * - the opening view and the start mode;
 * - a manifest of cells, bounds, byte sizes and the files.
 *
 *   STATIC_DIR=<dist> GEN_GPU=intel npx tsx scripts/cook.ts [--out=cooked] [--tiers=low,medium,high,ultra] [--profile=game|walkthrough|showcase|vr] [--install=<dist>] <slug> [<slug> …]
 *
 * The package is keyed by the IR hash and the build's geometry code version (`__AETHER_GEN_VERSION__`): cook with the
 * dist that will serve it. `--install` copies the package into a dist's `cooked/` folder (open it there with `play.html#t=<slug>&cook=local`;
 * scripts/cook-upload.ts pushes it to the hosted dataset). Output goes to `cooked/` at
 * the repository root (git-ignored). Run it in a capped scope (docs/PERFORMANCE.md, Measuring).
 */
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { brotliCompressSync, constants as zc, gzipSync } from 'node:zlib';
import { chromium, type BrowserContext, type Page } from 'playwright';
import type { WorldDoc } from '@aether/core';
import { outputBytes } from '@aether/procgen';
import { decodeEntry } from '../packages/render/src/geometry/ddc-codec';
import { DDC_CACHE_NAME } from '../packages/render/src/geometry/ddc';
import { COOK_FORMAT, COOK_PROFILES, cookPackageId, programSetLines, type CookManifest, type CookProfile, type StartMode } from '../packages/render/src/cook/format';
import { cookManifest, packGeometry, profileForStartMode, programSetBody } from '../packages/render/src/cook/pack';
import type { RenderTier } from '../packages/render/src/gpu/finishing';
import { sourceHash } from '../packages/render/src/gpu/program-cache';
import { TEMPLATE_PUBLISH } from '../apps/studio/src/showcase/publish';
import * as env from '../tests/e2e/support/env';

const args = process.argv.slice(2);
const flag = (k: string): string | undefined => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const OUT = resolve(flag('out') ?? join(env.REPO_ROOT, 'cooked'));
const TIERS = (flag('tiers') ?? 'low,medium,high,ultra').split(',').filter((t): t is RenderTier => ['low', 'medium', 'high', 'ultra'].includes(t));
const PROFILE = flag('profile') as CookProfile | undefined;
const INSTALL = flag('install');
const slugs = args.filter((a) => !a.startsWith('--'));
if (slugs.length === 0) throw new Error('usage: scripts/cook.ts [--out=…] [--tiers=…] [--install=<dist>] <slug> …');
if (PROFILE && !COOK_PROFILES.includes(PROFILE)) throw new Error(`--profile must be one of ${COOK_PROFILES.join(', ')}`);
const T0 = Date.now();
const log = (s: string): void => void process.stdout.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${s}\n`);

interface Recorded {
  irHash: string;
  genVersion: string;
  world: WorldDoc;
  startMode: StartMode;
  opening: CookManifest['opening'];
}

type Win = {
  __aetherCook?: { path: string; reason: string | null; startMode: StartMode | null; ready: boolean; record?: { irHash: string; genVersion: string; world: WorldDoc } };
  __aetherPlayer?: { phase: string; start(): void; simulation: { renderer: Record<string, unknown> } | null };
};

async function launch(profileDir: string): Promise<BrowserContext> {
  const ctx = await chromium.launchPersistentContext(profileDir, { executablePath: env.findChrome(), args: [...env.CHROME_ARGS], headless: env.HEADLESS, viewport: { width: 1600, height: 900 } });
  await ctx.addInitScript({ content: 'globalThis.__name = (f) => f; globalThis.__AETHER_COOK_RECORD = true;' });
  if (process.env['GEN_GPU'] === 'intel') await ctx.addInitScript({ content: 'delete Navigator.prototype.gpu; try { delete navigator.gpu; } catch {}' });
  return ctx;
}

/** Entries in the page's geometry cache. */
function ddcCount(page: Page): Promise<number> {
  return page.evaluate(async (name) => (await (await caches.open(name)).keys()).length, DDC_CACHE_NAME);
}

/** Wait until the lanes' cache writes have drained (the entry count holds for 3 s). */
async function drainWrites(page: Page): Promise<number> {
  let last = -1;
  let since = Date.now();
  for (;;) {
    const n = await ddcCount(page);
    if (n !== last) {
      last = n;
      since = Date.now();
    } else if (Date.now() - since > 3000) return n;
    await page.waitForTimeout(500);
  }
}

/** One recording session on `tier`: load, orbit, play (games), save the program set. */
async function session(server: env.TestServer, profileDir: string, slug: string, tier: RenderTier | 'auto', last: boolean, sink: (key: string, body: Buffer) => void): Promise<{ rec: Recorded; tier: RenderTier; boot: Array<[string, string]>; bootSources: Record<string, string>; programs: { sets: Record<string, { entries: Array<{ v: string; f: string; uses: number; last: number }> } | null>; sources: Record<string, string> } | null }> {
  const ctx = await launch(profileDir);
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    page.on('pageerror', (e) => log(`pageerror ${e.message.slice(0, 160)}`));
    await page.route('**/__cook/put/*', async (route) => {
      const key = route.request().url().split('/').pop() ?? '';
      const body = route.request().postDataBuffer();
      if (/^[0-9a-f]{64}$/.test(key) && body) sink(key, body);
      await route.fulfill({ status: 204, body: '' });
    });
    await page.goto(`${server.url}/play.html#t=${slug}&cook=record${tier === 'auto' ? '' : `&tier=${tier}`}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => (window as unknown as Win).__aetherCook?.ready === true, null, { timeout: 300_000, polling: 250 });
    const r = (): string => '(window.__aetherPlayer.simulation.renderer)';
    await page.waitForFunction(`${r()}.processingStage === null`, null, { timeout: 120_000, polling: 250 }).catch(() => log('renderer still busy'));
    const info = await page.evaluate(() => {
      const w = window as unknown as Win;
      const h = w.__aetherCook!;
      const ren = w.__aetherPlayer!.simulation!.renderer as unknown as { openingPose(): { position: [number, number, number]; target: [number, number, number]; fov?: number } | null; renderTier: string };
      const pose = ren.openingPose();
      return { record: h.record!, startMode: h.startMode, path: h.path, tier: ren.renderTier, opening: pose ? { position: pose.position, target: pose.target, ...(pose.fov !== undefined ? { fov: pose.fov } : {}) } : null };
    });
    if (!info.record) throw new Error('the page did not expose the recording (is this a build with the cook route?)');
    log(`${slug} ${tier}: loaded (${info.path}, tier in effect ${info.tier}, start ${info.startMode})`);
    // The programs of the load itself (before any orbit or play), in the order it used them, all of them (the stored set is
    // capped and later sessions would push them out): a viewer on this tier links these first.
    const bootSources: Record<string, string> = {};
    const boot = (
      await page.evaluate(async (t) => {
        const pc = ((window as unknown as Win).__aetherPlayer!.simulation!.renderer as unknown as { programCache?: { save(): Promise<void>; sessionPairs(t: string): Array<[string, string]> } }).programCache;
        await pc?.save();
        return pc?.sessionPairs(t) ?? [];
      }, info.tier)
    ).map(([v, f]) => {
      const hv = sourceHash(v), hf = sourceHash(f);
      bootSources[hv] = v;
      bootSources[hf] = f;
      return [hv, hf] as [string, string];
    });
    // An orbit around the opening view: what a viewer meets in the first seconds.
    await page.evaluate(async () => {
      const ren = (window as unknown as Win).__aetherPlayer!.simulation!.renderer as unknown as { camera: { position: { x: number; y: number; z: number } }; contentSphere?: { center?: { x: number; z: number } }; setCameraPose(x: number, y: number, z: number, yaw: number, pitch: number): void };
      const cx = ren.contentSphere?.center?.x ?? 0, cz = ren.contentSphere?.center?.z ?? 0;
      const p0 = { ...ren.camera.position };
      const rad = Math.max(8, Math.hypot(p0.x - cx, p0.z - cz));
      const a0 = Math.atan2(p0.x - cx, p0.z - cz);
      const t0 = performance.now();
      while (performance.now() - t0 < 6000) {
        const a = a0 + ((performance.now() - t0) / 6000) * Math.PI * 2;
        const x = cx + Math.sin(a) * rad, z = cz + Math.cos(a) * rad;
        ren.setCameraPose(x, p0.y, z, Math.atan2(x - cx, z - cz), -0.15);
        await new Promise((res) => requestAnimationFrame(res));
      }
    });
    if (info.startMode === 'play') {
      // Play: the player's person, the HUD's and the session's programs.
      await page.evaluate(() => (window as unknown as Win).__aetherPlayer!.start());
      await page.waitForFunction(() => (window as unknown as Win).__aetherPlayer?.phase === 'playing', null, { timeout: 60_000, polling: 250 }).catch(() => log('play did not start'));
      await page.waitForTimeout(8000);
    }
    await page.waitForTimeout(2000);
    await page.evaluate(async () => {
      const pc = ((window as unknown as Win).__aetherPlayer!.simulation!.renderer as unknown as { programCache?: { save(): Promise<void> } }).programCache;
      await pc?.save();
    });
    const entries = await drainWrites(page);
    log(`${slug} ${tier}: ${entries} geometry entries cached`);
    let programs = null;
    if (last) {
      // Read back on a page without the world (a large world's page and its reads together exceed the memory cap).
      await page.goto(`${server.url}/play.html#none`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      programs = await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((res, rej) => {
          const q = indexedDB.open('aether-programs');
          q.onsuccess = () => res(q.result);
          q.onerror = () => rej(q.error);
        });
        const get = <T>(store: string, key?: IDBValidKey): Promise<T> =>
          new Promise((res, rej) => {
            const q = key === undefined ? db.transaction(store).objectStore(store).getAll() : db.transaction(store).objectStore(store).get(key);
            q.onsuccess = () => res(q.result as T);
            q.onerror = () => rej(q.error);
          });
        const sets: Record<string, unknown> = {};
        for (const t of ['low', 'medium', 'high', 'ultra']) sets[t] = (await get('sets', t)) ?? null;
        const keys = await new Promise<IDBValidKey[]>((res, rej) => {
          const q = db.transaction('sources').objectStore('sources').getAllKeys();
          q.onsuccess = () => res(q.result);
          q.onerror = () => rej(q.error);
        });
        const sources: Record<string, string> = {};
        for (const k of keys) sources[String(k)] = ((await get<{ code: string }>('sources', k)) ?? { code: '' }).code;
        return { sets, sources };
      }) as { sets: Record<string, { entries: Array<{ v: string; f: string; uses: number; last: number }> } | null>; sources: Record<string, string> };
      // The geometry: every cache entry, posted to the route above one at a time.
      const sent = await page.evaluate(async (name) => {
        const c = await caches.open(name);
        let n = 0;
        for (const req of await c.keys()) {
          const res = await c.match(req);
          if (!res) continue;
          const key = new URL(req.url).pathname.split('/').pop() ?? '';
          await fetch(`/__cook/put/${key}`, { method: 'POST', body: await res.arrayBuffer() });
          n++;
        }
        return n;
      }, DDC_CACHE_NAME);
      log(`${slug}: ${sent} geometry entries read`);
    }
    return { rec: { irHash: info.record.irHash, genVersion: info.record.genVersion, world: info.record.world, startMode: (info.startMode ?? 'orbit') as StartMode, opening: info.opening }, tier: info.tier as RenderTier, boot, bootSources, programs };
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

function dirBytes(dir: string): { files: number; bytes: number; gzip: number; brotli: number; largest: number } {
  const out = { files: 0, bytes: 0, gzip: 0, brotli: 0, largest: 0 };
  const walk = (d: string): void => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else {
        const b = readFileSync(p);
        out.files++;
        out.bytes += b.length;
        out.largest = Math.max(out.largest, b.length);
        out.gzip += gzipSync(b, { level: 6 }).length;
        out.brotli += brotliCompressSync(b, { params: { [zc.BROTLI_PARAM_QUALITY]: 5, [zc.BROTLI_PARAM_SIZE_HINT]: b.length } }).length;
      }
    }
  };
  walk(dir);
  return out;
}

const MB = (n: number): string => `${(n / 1024 / 1024).toFixed(1)} MB`;

async function cook(server: env.TestServer, slug: string): Promise<void> {
  mkdirSync(join(homedir(), '.cache/aether-e2e-tmp'), { recursive: true });
  const prof = mkdtempSync(join(homedir(), '.cache/aether-e2e-tmp/cook-'));
  // Entries go to disk as they arrive (a large world's geometry is hundreds of MB).
  const blobDir = mkdtempSync(join(homedir(), '.cache/aether-e2e-tmp/cook-blobs-'));
  const blobs = new Map<string, number>();
  let rec: Recorded | null = null;
  let programs: Awaited<ReturnType<typeof session>>['programs'] = null;
  const boots = new Map<RenderTier, { pairs: Array<[string, string]>; sources: Record<string, string> }>();
  try {
    // First on the automatic tier, as a viewer of this machine's class starts: its boot set is then exact for that tier.
    // Then each tier forced (the boot sets of the others come from those sessions).
    const plan: Array<RenderTier | 'auto'> = ['auto', ...TIERS];
    for (let i = 0; i < plan.length; i++) {
      const r = await session(server, prof, slug, plan[i] as RenderTier | 'auto', i === plan.length - 1, (k, b) => {
        writeFileSync(join(blobDir, k), b);
        blobs.set(k, b.length);
      });
      if (rec && (rec.irHash !== r.rec.irHash || rec.genVersion !== r.rec.genVersion)) throw new Error('the world or the build changed between sessions');
      rec ??= r.rec;
      programs = r.programs ?? programs;
      if (!boots.has(r.tier)) boots.set(r.tier, { pairs: r.boot, sources: r.bootSources });
    }
  } finally {
    rmSync(prof, { recursive: true, force: true });
  }
  try {
    if (!rec || !programs) throw new Error('nothing recorded');
    await pack(slug, rec, programs, boots, blobs, blobDir);
  } finally {
    rmSync(blobDir, { recursive: true, force: true });
  }
}

async function pack(slug: string, rec: Recorded, programs: NonNullable<Awaited<ReturnType<typeof session>>['programs']>, boots: ReadonlyMap<RenderTier, { pairs: Array<[string, string]>; sources: Record<string, string> }>, blobs: ReadonlyMap<string, number>, blobDir: string): Promise<void> {
  const id = await cookPackageId(rec.irHash, rec.genVersion);
  const root = join(OUT, slug);
  rmSync(root, { recursive: true, force: true });
  const dir = join(root, id);
  mkdirSync(join(dir, 'packs'), { recursive: true });
  mkdirSync(join(dir, 'programs'), { recursive: true });

  // Geometry: packs per cell, nearest the opening first (cook/pack.ts, shared with the editor's publish).
  const geometry = await packGeometry(rec, {
    keys: blobs.keys(),
    read: async (hex) => readFileSync(join(blobDir, hex)),
    decode: async (body) => outputBytes(await decodeEntry(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer)),
    writePack: (file, parts) => writeFileSync(join(dir, file), Buffer.concat(parts)),
  });
  const { cells, packs, entries } = geometry;

  const programFiles: CookManifest['programs'] = {};
  // What the sets would weigh as format 2 JSON (reported against the files written).
  let programJson = 0;
  for (const tier of TIERS) {
    const set = programs.sets[tier];
    const recorded = boots.get(tier);
    if ((!set || set.entries.length === 0) && !recorded) continue;
    // The load's own programs first, in the order it used them (a viewer links them eagerly: the first session on this
    // tier's, the automatic one where it settled here), then the rest of the stored set (orbit, play), most recent first.
    const rest = [...(set?.entries ?? [])].sort((p, q) => q.last - p.last || q.uses - p.uses).map((e) => [e.v, e.f] as [string, string]);
    const body = programSetBody(tier, recorded ?? null, { pairs: rest, sources: programs.sources });
    if (!body) continue;
    // Each distinct line of GLSL once, sources as runs of lines, gzipped (format 3; static hosts serve .bin as is).
    const file = `programs/${tier}.bin`;
    const bytes = gzipSync(JSON.stringify(programSetLines(body)), { level: 9 });
    writeFileSync(join(dir, file), bytes);
    programFiles[tier] = { file, bytes: bytes.byteLength, programs: body.pairs.length };
    programJson += Buffer.byteLength(JSON.stringify({ format: COOK_FORMAT, ...body }));
  }

  // --profile, else the template's row in showcase/publish.ts, else from the start mode.
  const manifest = await cookManifest(rec, PROFILE ?? TEMPLATE_PUBLISH[slug]?.profile ?? profileForStartMode(rec.startMode), geometry, programFiles);
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest));
  const geometryBytes = packs.reduce((s, p) => s + p.bytes, 0);
  const sizes = dirBytes(root);
  const summary = {
    slug,
    id,
    irHash: rec.irHash,
    genVersion: rec.genVersion,
    entries: Object.keys(entries).length,
    unplaced: geometry.stats.unplaced,
    malformed: geometry.stats.malformed,
    cells: cells.length,
    packs: packs.length,
    geometryBytes,
    /** The arrays the entries decode to (what format 1 stored, give or take headers and padding). */
    geometryDecodedBytes: geometry.stats.decodedBytes,
    sharedEntries: geometry.stats.shared,
    sharedEntryBytes: geometry.stats.sharedBytes,
    programs: Object.fromEntries(Object.entries(programFiles).map(([t, f]) => [t, { programs: f!.programs, bytes: f!.bytes }])),
    /** The program sets as plain JSON (format 2), against the files written. */
    programJsonBytes: programJson,
    manifestBytes: statSync(join(root, 'manifest.json')).size,
    total: sizes,
  };
  writeFileSync(join(root, 'cook-report.json'), JSON.stringify(summary, null, 1));
  log(`${slug}: ${summary.entries} entries (${summary.unplaced} unplaced) in ${cells.length} cells, ${packs.length} packs, geometry ${MB(geometryBytes)} (decoded ${MB(geometry.stats.decodedBytes)}, ${geometry.stats.shared} identical entries stored once, ${MB(geometry.stats.sharedBytes)}); ` + `programs ${Object.entries(programFiles).map(([t, f]) => `${t} ${f!.programs}`).join(', ')} (${MB(Object.values(programFiles).reduce((n, f) => n + f!.bytes, 0))}, as JSON ${MB(programJson)}); ` + `total ${sizes.files} files ${MB(sizes.bytes)} (gzip ${MB(sizes.gzip)}, brotli ${MB(sizes.brotli)}), largest file ${MB(sizes.largest)}`);
  if (INSTALL) {
    const dest = join(resolve(INSTALL), 'cooked', slug);
    rmSync(dest, { recursive: true, force: true });
    cpSync(root, dest, { recursive: true, filter: (src) => !src.endsWith('cook-report.json') });
    log(`${slug}: installed in ${dest}`);
  }
}

async function main(): Promise<void> {
  const server = await env.startServer(() => undefined);
  try {
    for (const slug of slugs) await cook(server, slug);
  } finally {
    await server.stop().catch(() => undefined);
  }
}
main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
