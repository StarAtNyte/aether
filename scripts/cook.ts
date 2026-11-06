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
 * dist that will serve it. `--install` copies the package into a dist's `cooked/` folder. Output goes to `cooked/` at
 * the repository root (git-ignored). Run it in a capped scope (docs/PERFORMANCE.md, Measuring).
 */
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { brotliCompressSync, constants as zc, gzipSync } from 'node:zlib';
import { chromium, type BrowserContext, type Page } from 'playwright';
import type { Entity, ProceduralShape, WorldDoc } from '@aether/core';
import { outputBytes, proceduralOutputKey } from '@aether/procgen';
import { decodeEntry } from '../packages/render/src/geometry/ddc-codec';
import { DDC_CACHE_NAME } from '../packages/render/src/geometry/ddc';
import { assignCell, cellBounds, partitionFor, PERSISTENT_CELL, type CellPartition } from '../packages/render/src/streaming/cell-grid';
import { COOK_FORMAT, COOK_PROFILES, cookPackageId, PACK_TARGET_BYTES, type CookCell, type CookedProgramSet, type CookFile, type CookManifest, type CookProfile, type StartMode } from '../packages/render/src/cook/format';
import type { RenderTier } from '../packages/render/src/gpu/finishing';
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
async function session(server: env.TestServer, profileDir: string, slug: string, tier: RenderTier | 'auto', last: boolean, sink: (key: string, body: Buffer) => void): Promise<{ rec: Recorded; tier: RenderTier; boot: string[]; programs: { sets: Record<string, { entries: Array<{ v: string; f: string; uses: number; last: number }> } | null>; sources: Record<string, string> } | null }> {
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
    // The programs of the load itself (before any orbit or play): a viewer links these first.
    const boot = await page.evaluate(async (t) => {
      const pc = ((window as unknown as Win).__aetherPlayer!.simulation!.renderer as unknown as { programCache?: { save(): Promise<void> } }).programCache;
      await pc?.save();
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const q = indexedDB.open('aether-programs');
        q.onsuccess = () => res(q.result);
        q.onerror = () => rej(q.error);
      });
      const set = await new Promise<{ entries: Array<{ v: string; f: string; last: number }> } | undefined>((res, rej) => {
        const q = db.transaction('sets').objectStore('sets').get(t);
        q.onsuccess = () => res(q.result as never);
        q.onerror = () => rej(q.error);
      });
      db.close();
      const top = Math.max(0, ...(set?.entries ?? []).map((e) => e.last));
      return (set?.entries ?? []).filter((e) => e.last === top).map((e) => `${e.v}:${e.f}`);
    }, info.tier);
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
    return { rec: { irHash: info.record.irHash, genVersion: info.record.genVersion, world: info.record.world, startMode: (info.startMode ?? 'orbit') as StartMode, opening: info.opening }, tier: info.tier as RenderTier, boot, programs };
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** World XZ of an entity: its position plus its parents' (rotation and scale of parents ignored: placement only). */
function worldXZ(world: WorldDoc, id: string): [number, number] | null {
  let x = 0, z = 0;
  let e: Entity | undefined = world.entities[id];
  for (let depth = 0; e && depth < 64; depth++) {
    const p = e.transform.position;
    x += Number(p[0]);
    z += Number(p[2]);
    e = e.parent ? world.entities[e.parent] : undefined;
  }
  return Number.isFinite(x) && Number.isFinite(z) ? [x, z] : null;
}

function partitionOf(world: WorldDoc): CellPartition | null {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const e of Object.values(world.entities)) {
    if (!e || e.template || e.parent) continue;
    const x = Number(e.transform.position[0]), z = Number(e.transform.position[2]);
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  return maxX >= minX ? partitionFor([minX, minZ], [maxX, maxZ]) : null;
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
  const boots = new Map<RenderTier, ReadonlySet<string>>();
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
      if (!boots.has(r.tier)) boots.set(r.tier, new Set(r.boot));
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

async function pack(slug: string, rec: Recorded, programs: NonNullable<Awaited<ReturnType<typeof session>>['programs']>, boots: ReadonlyMap<RenderTier, ReadonlySet<string>>, blobs: ReadonlyMap<string, number>, blobDir: string): Promise<void> {
  const world = rec.world;

  // Each output to the cell of the nearest entity that uses it (to the opening view); unplaced ones are persistent.
  const grid = partitionOf(world);
  const eye = rec.opening ? [rec.opening.position[0], rec.opening.position[2]] : [0, 0];
  const placed = new Map<string, { cell: string; d: number; x: number; z: number }>();
  for (const [id, e] of Object.entries(world.entities)) {
    if (!e || e.shape.kind !== 'procedural') continue;
    const hex = sha256(`gen\u0000${rec.genVersion}\u0000${proceduralOutputKey(e.shape as ProceduralShape, world)}`);
    if (!blobs.has(hex)) continue;
    const xz = e.template ? null : worldXZ(world, id);
    const cell = xz && grid ? assignCell(grid, xz[0], xz[1], 0) : PERSISTENT_CELL;
    const d = xz ? Math.hypot(xz[0] - (eye[0] as number), xz[1] - (eye[1] as number)) : -1;
    const prev = placed.get(hex);
    if (!prev || (prev.cell === PERSISTENT_CELL && cell !== PERSISTENT_CELL) || (cell !== PERSISTENT_CELL && d < prev.d)) placed.set(hex, { cell, d, x: xz?.[0] ?? 0, z: xz?.[1] ?? 0 });
  }
  const byCell = new Map<string, Array<{ hex: string; d: number; x: number; z: number }>>();
  for (const hex of blobs.keys()) {
    const p = placed.get(hex) ?? { cell: PERSISTENT_CELL, d: -1, x: 0, z: 0 };
    let list = byCell.get(p.cell);
    if (!list) byCell.set(p.cell, (list = []));
    list.push({ hex, d: p.d, x: p.x, z: p.z });
  }
  const cellDist = (key: string): number => {
    if (key === PERSISTENT_CELL || !grid) return -1;
    const b = cellBounds(grid, key);
    return Math.hypot((b[0] + b[2]) / 2 - (eye[0] as number), (b[1] + b[3]) / 2 - (eye[1] as number));
  };
  const cellKeys = [...byCell.keys()].sort((a, b) => cellDist(a) - cellDist(b));

  const id = await cookPackageId(rec.irHash, rec.genVersion);
  const root = join(OUT, slug);
  rmSync(root, { recursive: true, force: true });
  const dir = join(root, id);
  mkdirSync(join(dir, 'packs'), { recursive: true });
  mkdirSync(join(dir, 'programs'), { recursive: true });

  const packs: CookFile[] = [];
  const cells: CookCell[] = [];
  const entries: CookManifest['entries'] = {};
  let bad = 0;
  // Identical entries (outputs of different keys with the same bytes) are stored once: later keys point at the first copy.
  const stored = new Map<string, [number, number, number]>();
  let shared = 0;
  let sharedBytes = 0;
  let decodedBytes = 0;
  for (const key of cellKeys) {
    const list = (byCell.get(key) ?? []).sort((a, b) => a.d - b.d);
    const cellIndex = cells.length;
    const cell: CookCell = { key, bounds: null, entries: 0, bytes: 0, packs: [] };
    let chunk: Buffer[] = [];
    let size = 0;
    const flush = (): void => {
      if (size === 0) return;
      const file = `packs/${String(packs.length).padStart(4, '0')}.bin`;
      writeFileSync(join(dir, file), Buffer.concat(chunk));
      cell.packs.push(packs.length);
      packs.push({ file, bytes: size });
      chunk = [];
      size = 0;
    };
    for (const it of list) {
      const body = readFileSync(join(blobDir, it.hex));
      try {
        const ab = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
        decodedBytes += outputBytes(await decodeEntry(ab));
      } catch {
        bad++;
        continue;
      }
      const content = createHash('sha256').update(body).digest('hex');
      const first = stored.get(content);
      if (first) {
        entries[it.hex] = [first[0], first[1], first[2], cellIndex];
        shared++;
        sharedBytes += body.length;
        continue;
      }
      if (size > 0 && size + body.length > PACK_TARGET_BYTES) flush();
      const pad = (8 - (body.length % 8)) % 8;
      entries[it.hex] = [packs.length, size, body.length, cellIndex];
      stored.set(content, [packs.length, size, body.length]);
      chunk.push(body);
      if (pad) chunk.push(Buffer.alloc(pad));
      size += body.length + pad;
      cell.entries++;
      cell.bytes += body.length;
      if (key !== PERSISTENT_CELL && it.d >= 0) {
        const b = cell.bounds ?? [it.x, it.z, it.x, it.z];
        cell.bounds = [Math.min(b[0], it.x), Math.min(b[1], it.z), Math.max(b[2], it.x), Math.max(b[3], it.z)];
      }
    }
    flush();
    if (cell.entries > 0) cells.push(cell);
  }

  const programFiles: CookManifest['programs'] = {};
  for (const tier of TIERS) {
    const set = programs.sets[tier];
    if (!set || set.entries.length === 0) continue;
    // The load's own programs first (a viewer links them eagerly), then the rest, each most recent first.
    const boot = boots.get(tier) ?? new Set<string>();
    const inBoot = (e: { v: string; f: string }): number => (boot.has(`${e.v}:${e.f}`) ? 0 : 1);
    const ordered = [...set.entries].sort((p, q) => inBoot(p) - inBoot(q) || q.last - p.last || q.uses - p.uses);
    const sources: Record<string, string> = {};
    const pairs: Array<[string, string]> = [];
    for (const e of ordered) {
      const v = programs.sources[e.v], f = programs.sources[e.f];
      if (v === undefined || f === undefined) continue;
      sources[e.v] = v;
      sources[e.f] = f;
      pairs.push([e.v, e.f]);
    }
    const file = `programs/${tier}.json`;
    const body: CookedProgramSet = { format: COOK_FORMAT, tier, boot: pairs.filter(([v, f]) => boot.has(`${v}:${f}`)).length, pairs, sources };
    const text = JSON.stringify(body);
    writeFileSync(join(dir, file), text);
    programFiles[tier] = { file, bytes: Buffer.byteLength(text), programs: pairs.length };
  }

  const startMode = rec.startMode;
  const manifest: CookManifest = {
    format: COOK_FORMAT,
    irHash: rec.irHash,
    genVersion: rec.genVersion,
    dir: `${id}/`,
    cookedAt: new Date().toISOString(),
    world: { id: world.id, name: world.name, entities: Object.keys(world.entities).length },
    opening: rec.opening,
    startMode,
    profile: PROFILE ?? (startMode === 'play' ? 'game' : startMode === 'walkthrough' ? 'walkthrough' : 'showcase'),
    partition: grid ? { cellSize: grid.cellSize, origin: [grid.origin[0], grid.origin[1]] } : null,
    cells,
    packs,
    entries,
    programs: programFiles,
    lightmap: null,
  };
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest));
  const geometry = packs.reduce((s, p) => s + p.bytes, 0);
  const sizes = dirBytes(root);
  const summary = {
    slug,
    id,
    irHash: rec.irHash,
    genVersion: rec.genVersion,
    entries: Object.keys(entries).length,
    unplaced: byCell.get(PERSISTENT_CELL)?.length ?? 0,
    malformed: bad,
    cells: cells.length,
    packs: packs.length,
    geometryBytes: geometry,
    /** The arrays the entries decode to (what format 1 stored, give or take headers and padding). */
    geometryDecodedBytes: decodedBytes,
    sharedEntries: shared,
    sharedEntryBytes: sharedBytes,
    programs: Object.fromEntries(Object.entries(programFiles).map(([t, f]) => [t, { programs: f!.programs, bytes: f!.bytes }])),
    manifestBytes: statSync(join(root, 'manifest.json')).size,
    total: sizes,
  };
  writeFileSync(join(root, 'cook-report.json'), JSON.stringify(summary, null, 1));
  log(`${slug}: ${summary.entries} entries (${summary.unplaced} unplaced) in ${cells.length} cells, ${packs.length} packs, geometry ${MB(geometry)} (decoded ${MB(decodedBytes)}, ${shared} identical entries stored once, ${MB(sharedBytes)}); ` + `programs ${Object.entries(programFiles).map(([t, f]) => `${t} ${f!.programs}`).join(', ')}; ` + `total ${sizes.files} files ${MB(sizes.bytes)} (gzip ${MB(sizes.gzip)}, brotli ${MB(sizes.brotli)}), largest file ${MB(sizes.largest)}`);
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
