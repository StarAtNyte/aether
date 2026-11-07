/**
 * Cook a template: load it headless in the real renderer (the player page, `#t=<slug>&cook=record`), once per render tier,
 * and serialize what a viewer would otherwise make on its first visit into a cooked package (packages/render/src/cook/
 * format.ts; docs/ARCHITECTURE-STREAMING.md, "Cooked package format"):
 *
 * - every generated output, in the geometry cache's encoding, packed per grid cell nearest the opening first;
 * - the program set of each tier, as gpu/program-cache.ts records it (the exact vertex and fragment sources);
 * - the opening view and the start mode;
 * - a building's baked light (re-lightable lightmap and light volume, `environment/relight.ts`), baked here at publish
 *   quality so a viewer never bakes: `<id>/light/<key>.lmap`, `<key>.lvol` and their `index.json`, manifest `lightmap`;
 * - the HLOD proxies of a world that streams (`streaming/hlod.ts`): per streamed cell one merged, simplified mesh baked from
 *   the full detail on screen, `<id>/hlod/proxies.bin`, manifest `hlod`;
 * - a manifest of cells, bounds, byte sizes and the files.
 *
 *   STATIC_DIR=<dist> GEN_GPU=intel npx tsx scripts/cook.ts [--out=cooked] [--tiers=low,medium,high,ultra] [--profile=game|walkthrough|showcase|vr] [--install=<dist>] [--bake=high|medium|low|off] [--samples=256] [--blender=<path>|off] [--cpu-bake=<threads>|off] <slug> [<slug> …]
 *
 * `--bake` (default: the world's `environment.lightBake` quality, else high; `off` ships no baked light) and `--samples` (rays
 * per texel, default 256) set the publish bake. Only worlds with buildings bake; the bake runs in the last recording session.
 * The lightmap is baked outside the page when it can be (scripts/blender-bake.ts, the same file format): by Cycles on the GPU
 * (`--blender=<path>`, default the local Blender when it exists, `--blender=off` skips it), else by the CPU baker on several
 * threads (`--cpu-bake=<threads>`, `--cpu-bake=off` skips it), else (both off or failed) in the page's lightmap worker.
 *
 * The package is keyed by the IR hash and the build's geometry code version (`__AETHER_GEN_VERSION__`): cook with the
 * dist that will serve it. `--install` copies the package into a dist's `cooked/` folder (open it there with `play.html#t=<slug>&cook=local`;
 * scripts/cook-upload.ts pushes it to the hosted dataset). Output goes to `cooked/` at
 * the repository root (git-ignored). Run it in a capped scope (docs/PERFORMANCE.md, Measuring).
 */
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { brotliCompressSync, constants as zc, gzipSync } from 'node:zlib';
import { chromium, type BrowserContext, type Page } from 'playwright';
import type { WorldDoc } from '@aether/core';
import { outputBytes } from '@aether/procgen';
import { decodeEntry } from '../packages/render/src/geometry/ddc-codec';
import { geometryFingerprint } from '../packages/render/src/geometry/fingerprint';
import { DDC_CACHE_NAME } from '../packages/render/src/geometry/ddc';
import { COOK_FORMAT, COOK_PROFILES, cookPackageId, programSetLines, type CookManifest, type CookProfile, type StartMode } from '../packages/render/src/cook/format';
import { cookManifest, packGeometry, profileForStartMode, programSetBody } from '../packages/render/src/cook/pack';
import { BAKED_LIGHT_VERSION } from '../packages/render/src/environment/relight';
import { HLOD_FILE, HLOD_VERSION } from '../packages/render/src/streaming/hlod';
import type { RenderTier } from '../packages/render/src/gpu/finishing';
import { sourceHash } from '../packages/render/src/gpu/program-cache';
import { TEMPLATE_PUBLISH } from '../apps/studio/src/showcase/publish';
import * as env from '../tests/e2e/support/env';
import { DEFAULT_BLENDER } from './blender-bake';

const args = process.argv.slice(2);
const flag = (k: string): string | undefined => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const OUT = resolve(flag('out') ?? join(env.REPO_ROOT, 'cooked'));
const TIERS = (flag('tiers') ?? 'low,medium,high,ultra').split(',').filter((t): t is RenderTier => ['low', 'medium', 'high', 'ultra'].includes(t));
const PROFILE = flag('profile') as CookProfile | undefined;
const INSTALL = flag('install');
const BAKE = flag('bake') as 'high' | 'medium' | 'low' | 'off' | undefined;
if (BAKE && !['high', 'medium', 'low', 'off'].includes(BAKE)) throw new Error('--bake must be high, medium, low or off');
const SAMPLES = Math.max(8, Math.min(1024, Number(flag('samples') ?? 256) || 256));
/** Cycles for the publish bake (scripts/blender-bake.ts): `--blender=<path>`, else the default Blender when it exists; `off` skips it. */
const BLENDER = flag('blender') === 'off' ? null : flag('blender') ?? (existsSync(DEFAULT_BLENDER) ? DEFAULT_BLENDER : null);
/** Threads of the CPU bake outside the page (`--cpu-bake=<threads>`, default scripts/blender-bake.ts `defaultThreads`; `off` skips it). */
const CPU_BAKE = flag('cpu-bake') === 'off' ? null : flag('cpu-bake') ?? '';
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
  views?: CookManifest['views'];
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

/** The baked light of a cook: the lightmap and light volume files by key, and what the bake cost. */
interface BakedLight {
  files: Map<string, Buffer>;
  lightmap: string;
  volume: string;
  stats: Record<string, unknown>;
}

/**
 * The lightmap baked outside the page (scripts/blender-bake.ts): the page's bake job goes out, Cycles bakes it on the GPU (when
 * Blender is there and a GPU has room), else the CPU baker on several threads, and the `.lmap` comes back into the page as if
 * the page had baked it. The key of the file applied and what baked it, or null (nothing applied: the page bakes it itself).
 */
async function bakeOutside(page: Page, slug: string, quality: string): Promise<{ key: string; baker: string } | null> {
  if (!BLENDER && CPU_BAKE === null) return null;
  let job: Buffer | null = null;
  await page.route('**/__cook/bake-job', async (route) => {
    job = route.request().postDataBuffer();
    await route.fulfill({ status: 204, body: '' });
  });
  const dir = mkdtempSync(join(tmpdir(), 'aether-cook-bake-'));
  try {
    // The job in the page, serialised as scripts/blender-bake.ts `encodeJob` reads it (the page cannot import it).
    const key = await page.evaluate(async ([q, s]) => {
      const ren = (window as unknown as Win).__aetherPlayer!.simulation!.renderer as unknown as { lightBakeJob(q: string, s: number): Promise<{ key: string; request: unknown; triCounts: number[] } | null> };
      const j = await ren.lightBakeJob(q as string, s as number);
      if (!j) return null;
      const blobs: Array<{ bytes: Uint8Array; o: number }> = [];
      let size = 0;
      const walk = (v: unknown): unknown => {
        if (ArrayBuffer.isView(v)) {
          const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
          blobs.push({ bytes, o: size });
          const ref = { $ta: v.constructor.name, o: size, n: (v as unknown as { length: number }).length };
          size += Math.ceil(bytes.length / 8) * 8;
          return ref;
        }
        if (Array.isArray(v)) return v.map(walk);
        if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
        return v;
      };
      const head = new TextEncoder().encode(JSON.stringify(walk({ key: j.key, quality: q, triCounts: j.triCounts, request: j.request })));
      const start = Math.ceil((8 + head.length) / 8) * 8;
      const out = new Uint8Array(start + size);
      const dv = new DataView(out.buffer);
      dv.setUint32(0, 0x4a4c4541, true);
      dv.setUint32(4, head.length, true);
      out.set(head, 8);
      for (const b of blobs) out.set(b.bytes, start + b.o);
      await fetch('/__cook/bake-job', { method: 'POST', body: out.buffer });
      return j.key;
    }, [quality, SAMPLES] as const);
    await page.unroute('**/__cook/bake-job');
    if (!key || !job) {
      log(`${slug}: no bake job from the page: it bakes the light itself`);
      return null;
    }
    const jobPath = join(dir, 'job.lbjob');
    writeFileSync(jobPath, job);
    log(`${slug}: bake job ${key} (${MB((job as Buffer).length)})`);
    let baker = '';
    const run = (extra: string[]): Promise<boolean> =>
      new Promise((ok) => {
        const tsx = fileURLToPath(import.meta.resolve('tsx'));
        const args = ['--user', '--scope', '--quiet', '-p', 'MemoryMax=12G', 'nice', '-n', '10', process.execPath, '--import', pathToFileURL(tsx).href, join(env.REPO_ROOT, 'scripts', 'blender-bake.ts'), `--job=${jobPath}`, `--out=${dir}`, ...extra];
        const p = spawn('systemd-run', args, { stdio: ['ignore', 'pipe', 'pipe'] });
        p.stdout.on('data', (b: Buffer) =>
          b.toString().split('\n').filter((l) => l.startsWith('RESULT ')).forEach((l) => {
            log(`${slug}: ${l.slice(7, 400)}`);
            baker = String((JSON.parse(l.slice(7)) as { device?: unknown }).device ?? '');
          }));
        p.stderr.on('data', (b: Buffer) => b.toString().split('\n').filter((l) => l.startsWith('[blender-bake]') || l.startsWith('[bake-light]')).forEach((l) => log(`${slug}: ${l.trim().slice(0, 300)}`)));
        p.on('error', (e) => {
          log(`${slug}: ${e.message}`);
          ok(false);
        });
        p.on('close', (code) => ok(code === 0 && existsSync(join(dir, `${key}.lmap`))));
      });
    // Cycles on the GPU only: on this machine Cycles on the CPU is slower than the CPU baker's threads.
    let done = BLENDER ? await run([`--blender=${BLENDER}`, '--device=GPU']) : false;
    if (BLENDER && !done) log(`${slug}: the Cycles bake failed (or no GPU had room)${CPU_BAKE !== null ? ': the CPU bake on threads' : ''}`);
    if (!done && CPU_BAKE !== null) {
      done = await run([CPU_BAKE ? `--cpu=${CPU_BAKE}` : '--cpu']);
      if (!done) log(`${slug}: the threaded CPU bake failed`);
    }
    if (!done) return null;
    const lmap = readFileSync(join(dir, `${key}.lmap`));
    await page.route('**/__cook/bake-file', (route) => route.fulfill({ status: 200, body: lmap, contentType: 'application/octet-stream' }));
    const applied = await page.evaluate(async () => {
      const ren = (window as unknown as Win).__aetherPlayer!.simulation!.renderer as unknown as { applyLightmapFile(b: Uint8Array): Promise<boolean> };
      const bytes = new Uint8Array(await (await fetch('/__cook/bake-file')).arrayBuffer());
      return ren.applyLightmapFile(bytes);
    });
    await page.unroute('**/__cook/bake-file');
    if (!applied) {
      log(`${slug}: the page did not take the baked file (another building or keys?): it bakes the light itself`);
      return null;
    }
    return { key, baker };
  } catch (e) {
    log(`${slug}: bake outside the page failed (${e instanceof Error ? e.message : String(e)}): it bakes the light itself`);
    return null;
  } finally {
    await page.unroute('**/__cook/bake-job').catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Bake the building's re-lightable light (outside the page, {@link bakeOutside}, else in the page's lightmap worker; the volume
 * is the page's own) and read the files back. Null when the world has no building or the bake does not finish.
 */
async function bakeLight(page: Page, slug: string, world: WorldDoc, sink: Map<string, Buffer>): Promise<BakedLight | null> {
  const want = world.environment.lightBake?.quality;
  const quality = BAKE ?? (want && want !== 'off' ? want : want === 'off' ? 'off' : 'high');
  if (quality === 'off' || !Object.values(world.entities).some((e) => e.arch !== undefined)) return null;
  // The volume first (the lightmap's later bounces come from it).
  // A function, not a string: the page's script policy forbids evaluating strings.
  const volOk = await page
    .waitForFunction(() => {
      const v = ((window as unknown as Win).__aetherPlayer?.simulation?.renderer as unknown as { lightVolume?: { ready: boolean; baking: boolean } } | undefined)?.lightVolume;
      return v !== undefined && v.ready && !v.baking;
    }, null, { timeout: 600_000, polling: 1000 })
    .then(() => true, () => false);
  if (!volOk) {
    log(`${slug}: no light volume came up: no baked light`);
    return null;
  }
  const t0 = Date.now();
  const outside = await bakeOutside(page, slug, quality);
  if (!outside) await page.evaluate(([q, s]) => ((window as unknown as Win).__aetherPlayer!.simulation!.renderer as unknown as { bakeLight(q: string, s: number, force: boolean): void }).bakeLight(q as string, s as number, true), [quality, SAMPLES] as const);
  let lastLog = 0;
  for (;;) {
    const st = await page.evaluate(() => ((window as unknown as Win).__aetherPlayer!.simulation!.renderer as unknown as { lightmapStatus: { state: string; progress: number; message: string } }).lightmapStatus);
    if (st.state === 'applied') break;
    if (st.state === 'failed' || st.state === 'cancelled' || (st.state === 'idle' && Date.now() - t0 > 30_000)) {
      log(`${slug}: light bake ${st.state} (${st.message}): no baked light`);
      return null;
    }
    if (Date.now() - lastLog > 30_000) {
      lastLog = Date.now();
      log(`${slug}: baking light (${quality}, ${SAMPLES} rays) ${Math.round(st.progress * 100)} %`);
    }
    if (Date.now() - t0 > 3_600_000) {
      log(`${slug}: light bake did not finish in an hour: no baked light`);
      return null;
    }
    await page.waitForTimeout(2000);
  }
  const ms = Date.now() - t0;
  // The files go out through the route below (they are megabytes; a page evaluation's result is not the place).
  const info = await page.evaluate(async () => {
    const ren = (window as unknown as Win).__aetherPlayer!.simulation!.renderer as unknown as { lightmapAsset: Uint8Array | null; lightmapStats: Record<string, unknown> | null; lightVolumeAsset(): Promise<{ key: string; bytes: Uint8Array } | null> };
    const lm = ren.lightmapAsset;
    const stats = ren.lightmapStats;
    const vol = await ren.lightVolumeAsset();
    if (!lm || !stats || !vol) return null;
    const key = String(stats['key']);
    await fetch(`/__cook/light/${key}.lmap`, { method: 'POST', body: lm.slice().buffer });
    await fetch(`/__cook/light/${vol.key}.lvol`, { method: 'POST', body: vol.bytes.slice().buffer });
    return { lightmap: key, volume: vol.key, stats };
  });
  if (!info || !sink.has(`${info.lightmap}.lmap`) || !sink.has(`${info.volume}.lvol`)) {
    log(`${slug}: the baked light could not be read back: no baked light`);
    return null;
  }
  const files = new Map([[`${info.lightmap}.lmap`, sink.get(`${info.lightmap}.lmap`)!], [`${info.volume}.lvol`, sink.get(`${info.volume}.lvol`)!]]);
  log(`${slug}: baked light in ${(ms / 1000).toFixed(0)} s: lightmap ${MB(files.get(`${info.lightmap}.lmap`)!.length)}, volume ${MB(files.get(`${info.volume}.lvol`)!.length)} (${JSON.stringify(info.stats)})`);
  if (outside && outside.key !== info.lightmap) log(`${slug}: the lightmap on screen is ${info.lightmap}, not the one baked outside (${outside.key})`);
  return { files, lightmap: info.lightmap, volume: info.volume, stats: { ...info.stats, quality, samples: SAMPLES, bakeWallMs: ms, baker: outside?.baker ?? 'page' } };
}

/** The HLOD proxies of a cook: the file and its manifest cells. */
interface BakedHlod {
  bytes: Buffer;
  cells: Array<{ cell: string; bounds: [number, number, number, number, number, number]; triangles: number }>;
}

/** Bake the proxies of the world on screen (the renderer's `bakeHlodFile`) and read the file back. Null when it does not stream. */
async function bakeHlod(page: Page, slug: string): Promise<BakedHlod | null> {
  let body: Buffer | null = null;
  await page.route('**/__cook/hlod', async (route) => {
    body = route.request().postDataBuffer();
    await route.fulfill({ status: 204, body: '' });
  });
  try {
    const t0 = Date.now();
    const info = await page.evaluate(async () => {
      const ren = (window as unknown as Win).__aetherPlayer!.simulation!.renderer as unknown as { bakeHlodFile(): Promise<{ bytes: Uint8Array; cells: BakedHlod['cells']; stats: Array<Record<string, number | string>> } | null> };
      const r = await ren.bakeHlodFile();
      if (!r) return null;
      await fetch('/__cook/hlod', { method: 'POST', body: r.bytes.slice().buffer });
      return { cells: r.cells, stats: r.stats };
    });
    if (!info || !body) {
      log(`${slug}: no HLOD proxies (the world does not stream)`);
      return null;
    }
    const tris = info.cells.reduce((n, c) => n + c.triangles, 0);
    const source = info.stats.reduce((n, c) => n + Number(c['source'] ?? 0), 0);
    log(`${slug}: HLOD proxies of ${info.cells.length} cells in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${tris} triangles from ${source} (${MB((body as Buffer).length)})`);
    for (const st of info.stats) log(`  ${JSON.stringify(st)}`);
    return { bytes: body, cells: info.cells };
  } catch (e) {
    log(`${slug}: HLOD bake failed (${e instanceof Error ? e.message : String(e)}): no proxies`);
    return null;
  } finally {
    await page.unroute('**/__cook/hlod').catch(() => undefined);
  }
}

/** One recording session on `tier`: load, orbit, play (games), save the program set; the last one also bakes the light and the proxies. */
async function session(server: env.TestServer, profileDir: string, slug: string, tier: RenderTier | 'auto', last: boolean, sink: (key: string, body: Buffer) => void): Promise<{ rec: Recorded; tier: RenderTier; boot: Array<[string, string]>; bootSources: Record<string, string>; programs: { sets: Record<string, { entries: Array<{ v: string; f: string; uses: number; last: number }> } | null>; sources: Record<string, string> } | null; light: BakedLight | null; hlod: BakedHlod | null }> {
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
    const lightFiles = new Map<string, Buffer>();
    await page.route('**/__cook/light/*', async (route) => {
      const name = route.request().url().split('/').pop() ?? '';
      const body = route.request().postDataBuffer();
      if (/^l[mv]\d+-[0-9a-f]{32}\.(lmap|lvol)$/.test(name) && body) lightFiles.set(name, body);
      await route.fulfill({ status: 204, body: '' });
    });
    await page.goto(`${server.url}/play.html#t=${slug}&cook=record${tier === 'auto' ? '' : `&tier=${tier}`}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => (window as unknown as Win).__aetherCook?.ready === true, null, { timeout: 300_000, polling: 250 });
    const r = (): string => '(window.__aetherPlayer.simulation.renderer)';
    await page.waitForFunction(`${r()}.processingStage === null`, null, { timeout: 120_000, polling: 250 }).catch(() => log('renderer still busy'));
    const info = await page.evaluate(() => {
      const w = window as unknown as Win;
      const h = w.__aetherCook!;
      const ren = w.__aetherPlayer!.simulation!.renderer as unknown as { openingPose(): { position: [number, number, number]; target: [number, number, number]; fov?: number } | null; viewStops?(): Array<{ position: [number, number, number]; target: [number, number, number]; fov?: number; name?: string }>; renderTier: string };
      const pose = ren.openingPose();
      // Tour stops (the player's tour bar): the IR's own travel with it; otherwise the renderer's, stored so the player does not search again.
      const views = h.record?.world.views ? undefined : ren.viewStops?.().map((v) => ({ position: v.position, target: v.target, ...(v.fov !== undefined ? { fov: v.fov } : {}), ...(v.name !== undefined ? { name: v.name } : {}) }));
      return { record: h.record!, startMode: h.startMode, path: h.path, tier: ren.renderTier, opening: pose ? { position: pose.position, target: pose.target, ...(pose.fov !== undefined ? { fov: pose.fov } : {}) } : null, views };
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
    // The proxies of the far field, once (the last session), from the full detail on screen.
    const hlod = last ? await bakeHlod(page, slug) : null;
    // The publish bake, once (the last session): what a viewer's lightmap and light volume are loaded from.
    const light = last ? await bakeLight(page, slug, info.record.world, lightFiles) : null;
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
    return { rec: { irHash: info.record.irHash, genVersion: info.record.genVersion, world: info.record.world, startMode: (info.startMode ?? 'orbit') as StartMode, opening: info.opening, ...(info.views && info.views.length > 0 ? { views: info.views } : {}) }, tier: info.tier as RenderTier, boot, bootSources, programs, light, hlod };
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
  let light: BakedLight | null = null;
  let hlod: BakedHlod | null = null;
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
      light = r.light ?? light;
      hlod = r.hlod ?? hlod;
      if (!boots.has(r.tier)) boots.set(r.tier, { pairs: r.boot, sources: r.bootSources });
    }
  } finally {
    rmSync(prof, { recursive: true, force: true });
  }
  try {
    if (!rec || !programs) throw new Error('nothing recorded');
    await pack(slug, rec, programs, boots, blobs, blobDir, light, hlod);
  } finally {
    rmSync(blobDir, { recursive: true, force: true });
  }
}

async function pack(slug: string, rec: Recorded, programs: NonNullable<Awaited<ReturnType<typeof session>>['programs']>, boots: ReadonlyMap<RenderTier, { pairs: Array<[string, string]>; sources: Record<string, string> }>, blobs: ReadonlyMap<string, number>, blobDir: string, light: BakedLight | null, hlod: BakedHlod | null): Promise<void> {
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
    // The decoded output's size, and its geometry fingerprint for the player's spot check (geometry/fingerprint.ts).
    decode: async (body) => {
      const out = await decodeEntry(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer);
      return { bytes: outputBytes(out), fingerprint: geometryFingerprint(out) };
    },
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

  // Baked light: the files by key and their index (lightmap-controller and light-volume-controller `staticBase`).
  let lightBytes = 0;
  if (light) {
    mkdirSync(join(dir, 'light'), { recursive: true });
    for (const [name, body] of light.files) {
      writeFileSync(join(dir, 'light', name), body);
      lightBytes += body.length;
    }
    writeFileSync(join(dir, 'light', 'index.json'), JSON.stringify({ keys: [light.lightmap], volumes: [light.volume] }));
  }
  // --profile, else the template's row in showcase/publish.ts, else from the start mode.
  // HLOD proxies (streaming/hlod.ts).
  if (hlod) {
    mkdirSync(join(dir, 'hlod'), { recursive: true });
    writeFileSync(join(dir, HLOD_FILE), hlod.bytes);
  }
  const manifest: CookManifest = {
    ...(await cookManifest(rec, PROFILE ?? TEMPLATE_PUBLISH[slug]?.profile ?? profileForStartMode(rec.startMode), geometry, programFiles, undefined, light ? { base: 'light/', version: BAKED_LIGHT_VERSION } : null)),
    ...(hlod ? { hlod: { file: HLOD_FILE, bytes: hlod.bytes.length, version: HLOD_VERSION, cells: hlod.cells } } : {}),
  };
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
    /** The HLOD proxies: cells, triangles and file size. */
    hlod: hlod ? { cells: hlod.cells.length, triangles: hlod.cells.reduce((n, c) => n + c.triangles, 0), bytes: hlod.bytes.length } : null,
    /** The baked light (lightmap and volume files) and what its bake cost. */
    light: light ? { bytes: lightBytes, files: Object.fromEntries([...light.files].map(([n, b]) => [n, b.length])), ...light.stats } : null,
    manifestBytes: statSync(join(root, 'manifest.json')).size,
    total: sizes,
  };
  writeFileSync(join(root, 'cook-report.json'), JSON.stringify(summary, null, 1));
  log(`${slug}: ${summary.entries} entries (${summary.unplaced} unplaced) in ${cells.length} cells, ${packs.length} packs, geometry ${MB(geometryBytes)} (decoded ${MB(geometry.stats.decodedBytes)}, ${geometry.stats.shared} identical entries stored once, ${MB(geometry.stats.sharedBytes)}); ` + `programs ${Object.entries(programFiles).map(([t, f]) => `${t} ${f!.programs}`).join(', ')} (${MB(Object.values(programFiles).reduce((n, f) => n + f!.bytes, 0))}, as JSON ${MB(programJson)}); ` + `${light ? `baked light ${MB(lightBytes)}; ` : ''}total ${sizes.files} files ${MB(sizes.bytes)} (gzip ${MB(sizes.gzip)}, brotli ${MB(sizes.brotli)}), largest file ${MB(sizes.largest)}`);
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
