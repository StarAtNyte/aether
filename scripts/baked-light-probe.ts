/**
 * Baked light in the player: what a time-of-day drag costs a cooked world, and settled pictures of a fixed view at four hours.
 *
 *   STATIC_DIR=<dist with the package installed> GEN_GPU=intel npx tsx scripts/baked-light-probe.ts --out=<dir> [--drag] [--shots] [--cost] [--tier=low] [--cook=local|0] [--bake-each=high] [--samples=256] [slug]
 *
 * The page is the player (`play.html#t=<slug>&cook=local`): a viewer, so it loads the package's baked light and never bakes.
 * - `--drag`: the time of day dragged the way the editor's daylight study does (`setEnvironmentOverride(…, { live: true })`
 *   once a frame), slowly from 10:00 to 16:00 over 3 s, then fast across dawn, day, sunset and night and back (2.4 s), then
 *   released. Records program links (`linkProgram`), bakes started (lightmap and light volume), the lightmap's state, frame
 *   times and long tasks, during each drag and until the page settles after it.
 * - `--shots`: a fixed three-quarter view (as `daylight-drag-probe.ts`) and an eye-level view inside the building, settled at
 *   06:30, 12:00, 18:30 and 22:00 (the daylight study's skies for those hours).
 * - `--cost`: GPU time of frames drawn back to back at 12:00 and 22:00 from the fixed view and from inside (timer queries, the
 *   fastest of six bursts of 12 frames). `--bake-load=<quality>` (a build before re-lightable bakes) bakes once after the load,
 *   as that build's editor did, so the two builds are compared each with its baked light.
 * - `--bake-each=<quality>` (for a build before re-lightable bakes, `--cook=0`): bake the lightmap again at every hour of the
 *   shots (the old single-time bake) with `--samples` rays, so its pictures compare with a cooked world's.
 * `--fetch-ab`: the lightmap's sun-key reads in one page: as loaded at 12:00 against the sun and lamp weights at zero (their
 *   reads skipped), alternated twelve times, lower quartiles.
 * `--views=<file>` replaces the two views with explicit poses (`[{ name, position, target }]`).
 * Run it in a capped scope (docs/PERFORMANCE.md, Measuring).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import * as env from '../tests/e2e/support/env';

const args = process.argv.slice(2);
const flag = (k: string): string | undefined => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const out = resolve(flag('out') ?? 'probe-out/baked-light');
const slug = args.find((a) => !a.startsWith('--')) ?? 'casa-patio';
const cook = flag('cook') ?? 'local';
const tier = flag('tier');
const bakeEach = flag('bake-each');
const bakeLoad = flag('bake-load');
const samples = Number(flag('samples') ?? 256);
/** `--views=<file>`: the shots' poses, `[{ name, position, target }]` (the same file for two builds: the same pictures). */
const viewsFile = flag('views');
mkdirSync(out, { recursive: true });
const T0 = Date.now();
const log = (s: string): void => void process.stdout.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${s}\n`);

const INSTR = `(() => {
  const S = (globalThis.__probe = { links: 0, frames: [], long: [], recording: false, sources: [] });
  const P = WebGL2RenderingContext.prototype;
  const link = P.linkProgram;
  P.linkProgram = function (...a) {
    S.links++;
    try { const sh = this.getAttachedShaders(a[0]) || []; S.sources.push(sh.map((x) => this.getShaderSource(x)).join('\\n//----FRAGMENT----\\n')); } catch {}
    return link.apply(this, a);
  };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (S.recording) S.long.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: false }); } catch {}
  let last = 0;
  const frame = (t) => { if (S.recording && last) S.frames.push(t - last); last = t; requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
})();`;

const R = '(window.__aetherPlayer.simulation.renderer)';

/** Daylight study's sky for an hour (apps/studio/src/state/archUi.ts `skyForHour`). */
function skyFor(h: number): { sky: string; timeOfDay: number } {
  if (h < 5.8 || h >= 20.6) return { sky: 'night', timeOfDay: h };
  if (h < 8) return { sky: 'dawn', timeOfDay: h };
  if (h >= 17.2) return { sky: 'sunset', timeOfDay: h };
  return { sky: 'day', timeOfDay: h };
}

interface Counters {
  links: number;
  lightmapBakes: number;
  volumeBakes: number;
  lightmap: string;
}

const counters = (page: Page): Promise<Counters> =>
  page.evaluate((r) => {
    const ren = eval(r) as { lightmapBakesStarted: number; lightVolume: { bakesStarted?: number }; lightmapStatus: { state: string } };
    return { links: (globalThis as unknown as { __probe: { links: number } }).__probe.links, lightmapBakes: ren.lightmapBakesStarted, volumeBakes: ren.lightVolume.bakesStarted ?? -1, lightmap: ren.lightmapStatus.state };
  }, R);

/** Set the hour the way the daylight study does; `live` for one step of a drag. */
async function setHour(page: Page, h: number, live: boolean): Promise<void> {
  const s = skyFor(h);
  await page.evaluate(
    ([r, sky, t, lv]) => {
      const ren = eval(r as string) as { setEnvironmentOverride(e: unknown, o: { live: boolean }): void; sync: { world: { environment: Record<string, unknown> } } };
      const e = ren.sync.world.environment;
      ren.setEnvironmentOverride({ ...e, sky, timeOfDay: t, bloom: sky === 'night' ? Math.max(Number(e['bloom'] ?? 0), 0.9) : e['bloom'] }, { live: lv as boolean });
    },
    [R, s.sky, s.timeOfDay, live] as const,
  );
}

/** Drag through `path` (hours) over `ms`, one value a frame, then release. */
async function drag(page: Page, path: number[], ms: number): Promise<{ steps: number; frames: { p50: number; p95: number; max: number; n: number }; long: { n: number; max: number } }> {
  await page.evaluate(() => {
    const S = (globalThis as unknown as { __probe: { frames: number[]; long: number[]; recording: boolean } }).__probe;
    S.frames = [];
    S.long = [];
    S.recording = true;
  });
  const t0 = Date.now();
  let steps = 0;
  const legs = path.length - 1;
  while (Date.now() - t0 < ms) {
    const u = Math.min(1, (Date.now() - t0) / ms) * legs;
    const i = Math.min(legs - 1, Math.floor(u));
    await setHour(page, (path[i] ?? 0) + ((path[i + 1] ?? 0) - (path[i] ?? 0)) * (u - i), true);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    steps++;
  }
  await setHour(page, path[path.length - 1] ?? 12, false);
  return page.evaluate(() => {
    const S = (globalThis as unknown as { __probe: { frames: number[]; long: number[]; recording: boolean } }).__probe;
    S.recording = false;
    const f = [...S.frames].sort((a, b) => a - b);
    const q = (p: number): number => Math.round((f[Math.min(f.length - 1, Math.floor(f.length * p))] ?? 0) * 10) / 10;
    return { frames: { p50: q(0.5), p95: q(0.95), max: Math.round((f[f.length - 1] ?? 0) * 10) / 10, n: f.length }, long: { n: S.long.length, max: Math.max(0, ...S.long) } };
  }).then((r) => ({ steps, ...r }));
}

/** No processing stage, no bake and no long task for 3 s (at most 90 s). */
async function settle(page: Page): Promise<number> {
  const t0 = Date.now();
  let quiet = Date.now();
  while (Date.now() - t0 < 90_000) {
    const busy = await page.evaluate((r) => {
      const ren = eval(r) as { processingStage: string | null; lightVolumeBaking?: boolean; lightmapStatus: { state: string }; liveEnvironment?: boolean };
      return ren.processingStage !== null || ren.lightVolumeBaking === true || ren.lightmapStatus.state === 'baking' || ren.lightmapStatus.state === 'waiting' || ren.liveEnvironment === true;
    }, R);
    if (busy) quiet = Date.now();
    if (Date.now() - quiet > 3000) break;
    await page.waitForTimeout(250);
  }
  return Date.now() - t0;
}

async function fixedView(page: Page, which: 'outside' | 'inside'): Promise<void> {
  await page.evaluate(
    ([r, w]) => {
      const ren = eval(r as string) as { contentSphere: { center: number[]; radius: number } | null; setCameraPose(x: number, y: number, z: number, yaw: number, pitch: number): void; viewStops?(): Array<{ position: number[]; target: number[] }> };
      const c = ren.contentSphere?.center ?? [0, 0, 0];
      const [cx, cy, cz] = [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0];
      if (w === 'inside') {
        // The second tour stop (the first room at eye height), else the centre at eye height.
        const s = ren.viewStops?.()[1];
        const p = s?.position ?? [cx, cy + 1.6, cz];
        const t = s?.target ?? [cx + 1, cy + 1.5, cz];
        ren.setCameraPose(p[0]!, p[1]!, p[2]!, Math.atan2(p[0]! - t[0]!, p[2]! - t[2]!), -Math.atan2(p[1]! - t[1]!, Math.hypot(p[0]! - t[0]!, p[2]! - t[2]!)));
        return;
      }
      const d = Math.max(10, (ren.contentSphere?.radius ?? 15) * 1.3);
      const x = cx + d * 0.7, y = cy + d * 0.45, z = cz + d * 0.7;
      ren.setCameraPose(x, y, z, Math.atan2(x - cx, z - cz), -Math.atan2(y - cy, Math.hypot(x - cx, z - cz)));
    },
    [R, which] as const,
  );
}

/** Put the camera at `p` looking at `t`. */
async function posed(page: Page, p: number[], t: number[]): Promise<void> {
  await page.evaluate(
    ([r, a, b]) => {
      const ren = eval(r as string) as { setCameraPose(x: number, y: number, z: number, yaw: number, pitch: number): void };
      const [px, py, pz] = a as number[];
      const [tx, ty, tz] = b as number[];
      ren.setCameraPose(px!, py!, pz!, Math.atan2(px! - tx!, pz! - tz!), -Math.atan2(py! - ty!, Math.hypot(px! - tx!, pz! - tz!)));
    },
    [R, p, t] as const,
  );
}

async function gpuCost(page: Page): Promise<number> {
  return page.evaluate(async (r) => {
    const ren = eval(r) as { renderer: { backend: { gl: WebGL2RenderingContext } }; drawOnce(capture: boolean): void; advanceNodeFrame?(): void };
    const gl = ren.renderer.backend.gl;
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
    if (!ext) return -1;
    const best: number[] = [];
    for (let b = 0; b < 6; b++) {
      const q = gl.createQuery()!;
      ren.drawOnce(false);
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      for (let i = 0; i < 12; i++) {
        ren.advanceNodeFrame?.();
        ren.drawOnce(false);
      }
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      const t0 = performance.now();
      while (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) && performance.now() - t0 < 5000) await new Promise((res) => setTimeout(res, 5));
      best.push(Number(gl.getQueryParameter(q, gl.QUERY_RESULT)) / 1e6 / 12);
      gl.deleteQuery(q);
    }
    best.sort((a, b) => a - b);
    return Math.round((best[0] ?? -1) * 100) / 100;
  }, R);
}

async function main(): Promise<void> {
  const server = await env.startServer(() => undefined);
  const prof = mkdtempSync(join(homedir(), '.cache/aether-e2e-tmp/baked-light-'));
  const results: Record<string, unknown> = { slug, cook, gen: process.env['GEN_GPU'] ?? null };
  try {
    // The probe reads the renderer through string expressions: the page's script policy would refuse them.
    const ctx = await chromium.launchPersistentContext(prof, { executablePath: env.findChrome(), args: [...env.CHROME_ARGS], headless: env.HEADLESS, viewport: { width: 1600, height: 900 }, bypassCSP: true });
    try {
      await ctx.addInitScript({ content: 'globalThis.__name = (f) => f;' });
      if (process.env['GEN_GPU'] === 'intel') await ctx.addInitScript({ content: 'delete Navigator.prototype.gpu; try { delete navigator.gpu; } catch {}' });
      await ctx.addInitScript({ content: INSTR });
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      page.on('pageerror', (e) => log(`pageerror ${e.message.slice(0, 160)}`));
      await page.goto(`${server.url}/play.html#t=${slug}${cook === 'local' ? '&cook=local' : cook === '0' ? '&cook=0' : ''}${tier ? `&tier=${tier}` : ''}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction('window.__aetherPlayer?.simulation?.renderer?.processingStage === null', null, { timeout: 300_000, polling: 500 });
      log(`loaded; settled in ${await settle(page)} ms`);
      // The baked light comes up after the volume (the package's files, or nothing on an old package).
      await page.waitForFunction(`${R}.lightmapStatus.state === 'applied' || ${R}.lightmapStatus.state === 'idle' && !${R}.lightVolumeBaking`, null, { timeout: 180_000, polling: 500 }).catch(() => log('baked light not settled'));
      const loaded = await counters(page);
      const stats = await page.evaluate((r) => (eval(r) as { lightmapStats: unknown; lightVolume: { source?: string; lastBake?: unknown } }).lightmapStats, R);
      const vsrc = await page.evaluate((r) => (eval(r) as { lightVolume: { source?: string } }).lightVolume.source ?? null, R);
      results['loaded'] = { ...loaded, lightmapStats: stats, volumeSource: vsrc };
      log(`after load: ${JSON.stringify(loaded)}; volume from ${vsrc}; lightmap ${JSON.stringify(stats)}`);
      if (args.includes('--drag')) {
        // An idle stretch as long as the drags and their settling, for the links a still page makes on its own (the renderer
        // primes the programs a viewer has not drawn yet once the view rests).
        const i0 = await counters(page);
        await page.waitForTimeout(12_000);
        const i1 = await counters(page);
        results['idleLinks'] = i1.links - i0.links;
        log(`idle 12 s: links ${i1.links - i0.links}`);
        await page.evaluate(() => void (globalThis as unknown as { __probe: { sources: string[] } }).__probe.sources.splice(0));
        const c0 = await counters(page);
        const slow = await drag(page, [10, 16], 3000);
        const c1 = await counters(page);
        const slowSettle = await settle(page);
        const c2 = await counters(page);
        const fast = await drag(page, [5.2, 9, 16, 19, 22.8, 12, 5.2, 22.8], 2400);
        const c3 = await counters(page);
        const fastSettle = await settle(page);
        const c4 = await counters(page);
        const d = (a: Counters, b: Counters): Record<string, number | string> => ({ links: b.links - a.links, lightmapBakes: b.lightmapBakes - a.lightmapBakes, volumeBakes: b.volumeBakes - a.volumeBakes, lightmap: b.lightmap });
        results['drag'] = { slow: { ...slow, during: d(c0, c1), afterRelease: d(c1, c2), settleMs: slowSettle }, fast: { ...fast, during: d(c2, c3), afterRelease: d(c3, c4), settleMs: fastSettle } };
        const dragSources = await page.evaluate(() => (globalThis as unknown as { __probe: { sources: string[] } }).__probe.sources.splice(0));
        // The programs linked from the first drag until settled, for a look at what a link was.
        mkdirSync(join(out, 'drag-links'), { recursive: true });
        dragSources.forEach((src, i) => writeFileSync(join(out, 'drag-links', `${String(i).padStart(3, '0')}.glsl`), src));
        log(`slow drag: ${JSON.stringify(results['drag'] && (results['drag'] as { slow: unknown }).slow)}`);
        log(`fast drag: ${JSON.stringify(results['drag'] && (results['drag'] as { fast: unknown }).fast)}`);
      }
      if (bakeLoad) {
        // A build before re-lightable bakes: one bake of the loaded hour, as its editor's automatic bake made.
        await page.evaluate(([r, q, n]) => (eval(r as string) as { bakeLight(q: string, s: number): void }).bakeLight(q as string, n as number), [R, bakeLoad, samples] as const);
        await page.waitForFunction(`${R}.lightmapStatus.state === 'applied'`, null, { timeout: 3_600_000, polling: 2000 });
        log(`baked at load: ${JSON.stringify(await page.evaluate((r) => (eval(r) as { lightmapStats: unknown }).lightmapStats, R))}`);
      }
      if (args.includes('--cost')) {
        const cost: Record<string, number> = {};
        for (const view of ['outside', 'inside'] as const) {
          await fixedView(page, view);
          for (const h of [12, 22]) {
            await setHour(page, h, false);
            await settle(page);
            await page.waitForTimeout(1000);
            cost[`${view} ${h}`] = await gpuCost(page);
          }
        }
        results['cost'] = cost;
        log(`frame cost (GPU ms per frame, fastest of six bursts): ${JSON.stringify(cost)}`);
      }
      if (args.includes('--fetch-ab')) {
        // The lightmap's extra reads in one page, A against B alternated (another page on the GPU makes single bursts noisy):
        // A as loaded at 12:00 (sky layers, chroma, two sun keys: five reads), B with the sun and lamp weights at zero (the
        // uniform branches skip their reads: two reads). Lower quartile of 12 bursts each, from inside the building.
        await setHour(page, 12, false);
        await settle(page);
        await fixedView(page, 'inside');
        await page.waitForTimeout(2000);
        const set = (full: boolean): Promise<void> =>
          page.evaluate(([r, f]) => {
            const ren = eval(r as string) as { lightVolume: { light: { relight(l: unknown): void; lmSun: { set(...v: number[]): void }; lmLamp: { set(...v: number[]): void }; lmKeyA: { x: number }; lmKeyB: { x: number } } }; liveLighting(): unknown };
            const l = ren.lightVolume.light;
            l.relight(ren.liveLighting());
            if (!f) {
              l.lmSun.set(0, 0, 0, 0);
              l.lmLamp.set(0, 0, 0, 0);
              l.lmKeyA.x = 0;
              l.lmKeyB.x = 0;
            }
          }, [R, full] as const);
        const a: number[] = [];
        const b: number[] = [];
        for (let k = 0; k < 12; k++) {
          await set(true);
          a.push(await gpuCost(page));
          await set(false);
          b.push(await gpuCost(page));
        }
        await set(true);
        const q = (xs: number[]): number => [...xs].sort((x, y) => x - y)[Math.floor(xs.length * 0.25)] ?? 0;
        results['fetchAb'] = { five: q(a), two: q(b), ratio: Math.round((q(a) / q(b)) * 1000) / 1000, a, b };
        log(`lightmap reads A/B at 12:00 inside (GPU ms, lower quartile): five reads ${q(a)}, two reads ${q(b)}, ratio ${(q(a) / q(b)).toFixed(3)}`);
      }
      if (args.includes('--shots')) {
        await page.addStyleTag({ content: 'body * { visibility: hidden !important; } canvas { visibility: visible !important; }' });
        const shots: Record<string, unknown> = {};
        for (const [name, hour] of [['dawn', 6.5], ['noon', 12], ['sunset', 18.5], ['night', 22]] as const) {
          await setHour(page, hour, false);
          if (bakeEach) {
            await page.evaluate(([r, q, s]) => (eval(r as string) as { bakeLight(q: string, s: number): void }).bakeLight(q as string, s as number), [R, bakeEach, samples] as const);
            await page.waitForFunction(`${R}.lightmapStatus.state === 'applied'`, null, { timeout: 3_600_000, polling: 2000 });
          }
          const poses: Array<{ name: string; position: number[]; target: number[] } | 'outside' | 'inside'> = viewsFile ? JSON.parse(readFileSync(viewsFile, 'utf8')) : ['outside', 'inside'];
          for (const view of poses) {
            // Posed twice around a wait: the player's camera rig takes a pose over a few frames.
            for (let k = 0; k < 2; k++) {
              if (typeof view === 'string') await fixedView(page, view);
              else await posed(page, view.position, view.target);
              await page.waitForTimeout(1500);
            }
            await settle(page);
            await page.waitForTimeout(1500);
            await page.locator('canvas').first().screenshot({ path: join(out, `shot-${typeof view === 'string' ? view : view.name}-${name}.png`) });
          }
          shots[name] = await counters(page);
          log(`shot ${name}: ${JSON.stringify(shots[name])}`);
        }
        results['shots'] = shots;
      }
    } finally {
      await ctx.close();
    }
  } finally {
    await server.stop();
    rmSync(prof, { recursive: true, force: true });
  }
  writeFileSync(join(out, 'baked-light.json'), JSON.stringify(results, null, 2));
  log(`wrote ${join(out, 'baked-light.json')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
