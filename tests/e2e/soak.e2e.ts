/**
 * Soak run of a heavy session in ONE browser at a time (Chromium, then
 * Firefox), on the production build with the offline planner:
 *
 *  1. block world: prompt a survival world, play, and travel with W held for
 *     `--walk-s` seconds (default 300; flying, turning every few seconds, so
 *     terrain keeps streaming in and out). Sampled every 30 s: JS heap
 *     (Chromium), tab memory (PSS of the content process), loaded / drawn
 *     chunks and three.js geometry / texture counts;
 *  2. architecture: prompt a villa, hold the studio (photoreal) render for
 *     15 s, back to realtime;
 *  3. a million-instance scatter ("a canyon with a million trees …") with a
 *     camera orbit.
 *
 * For every phase it reports frame time p50 / p95 / p99 (requestAnimationFrame
 * deltas), main-thread long tasks over 50 ms (Chromium's long-task API; frame
 * gaps elsewhere) and the memory samples, and it FAILS when memory grows
 * without bound: chunk counts beyond the view-distance ring, GPU objects
 * creeping up across the walk, or heap / tab growth beyond the noise budget
 * between the first and last walk samples. Frame times are reported, not
 * asserted (software rasterizer on a shared CPU).
 *
 * Run: `npm run build && npm run e2e:soak` (`-- --only=chromium|firefox`,
 * `-- --walk-s=60` for a short run, `-- --phases=arch,scatter` to pick phases).
 */
import { chromium, firefox, type Browser, type Page } from 'playwright';
import { CHROME_ARGS, FIREFOX_PREFS, findChrome, findFirefox, startServer, SKIP_FIRST_RUN } from './support/env';
import { sampleBrowserMemory } from './support/procmem';

const ARGS = process.argv.slice(2);
const arg = (name: string): string | undefined => ARGS.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const ONLY = arg('only');
/** `--phases=walk,arch,scatter` (default all). */
const PHASES = new Set((arg('phases') ?? 'walk,arch,scatter').split(','));
const WALK_S = Math.min(900, Math.max(30, Number(arg('walk-s') ?? 300) || 300));
const VIEWPORT = { width: 1280, height: 800 };
const BOOT_MS = 90_000;
const AGENT_MS = 180_000;
/** Heap growth allowed between the first and the last walk sample (MB): GC timing, caches warming. */
const HEAP_GROWTH_MB = 60;
/** Tab (content process) growth allowed over the walk (MB). */
const TAB_GROWTH_MB = 200;

const startedAt = performance.now();
function log(line: string): void {
  process.stdout.write(`[${((performance.now() - startedAt) / 1000).toFixed(1).padStart(6)}s] ${line}\n`);
}

class SoakFailure extends Error {
  override name = 'SoakFailure';
}

function check(cond: unknown, message: string): asserts cond {
  if (!cond) throw new SoakFailure(message);
}

async function waitFor<T>(page: Page, what: string, timeoutMs: number, probe: () => Promise<T | null | undefined | false>, intervalMs = 250): Promise<T> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const v = await probe();
    if (v !== null && v !== undefined && v !== false) return v;
    await page.waitForTimeout(intervalMs);
  }
  throw new SoakFailure(`timed out after ${timeoutMs} ms waiting for ${what}`);
}

/** Records rAF deltas and long tasks from a mark the test sets (`__soakMark`). */
const FRAME_PROBE = `
(() => {
  const w = window;
  w.__soakFrames = [];
  w.__soakLong = [];
  w.__soakMark = 0;
  try {
    new PerformanceObserver((list) => { for (const e of list.getEntries()) w.__soakLong.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true });
  } catch {}
  let last = performance.now();
  const tick = (t) => {
    if (w.__soakMark > 0 && t >= w.__soakMark && w.__soakFrames.length < 200000) w.__soakFrames.push(t - last);
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();`;

interface FrameReport {
  frames: number;
  p50: number;
  p95: number;
  p99: number;
  longTasks: number;
  longestTask: number;
  longTaskApi: boolean;
  gapsOver50: number;
}

async function markFrames(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __soakMark: number; __soakFrames: number[] };
    w.__soakFrames = [];
    w.__soakMark = performance.now();
  });
}

async function frameReport(page: Page): Promise<FrameReport> {
  return page.evaluate(() => {
    const w = window as unknown as { __soakMark: number; __soakFrames: number[]; __soakLong: Array<[number, number]> };
    const f = [...w.__soakFrames].sort((a, b) => a - b);
    const q = (p: number): number => (f.length === 0 ? 0 : Math.round((f[Math.min(f.length - 1, Math.floor(p * f.length))] as number) * 10) / 10);
    const long = w.__soakLong.filter((e) => e[0] >= w.__soakMark).map((e) => e[1]);
    let api = false;
    try {
      api = PerformanceObserver.supportedEntryTypes.includes('longtask');
    } catch {
      api = false;
    }
    const out = { frames: f.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), longTasks: long.length, longestTask: Math.round(Math.max(0, ...long)), longTaskApi: api, gapsOver50: f.filter((d) => d > 50).length };
    w.__soakMark = 0;
    return out;
  });
}

function fmt(r: FrameReport): string {
  return `${r.frames} frames, p50 ${r.p50} ms, p95 ${r.p95} ms, p99 ${r.p99} ms; ${r.longTaskApi ? `${r.longTasks} long tasks (longest ${r.longestTask} ms)` : 'no long-task API'}; ${r.gapsOver50} frames > 50 ms`;
}

interface Sample {
  t: number;
  heapMB: number | null;
  tabMb: number;
  loaded: number;
  drawn: number;
  geometries: number;
  textures: number;
}

async function sample(page: Page, t: number): Promise<Sample> {
  const page_ = await page.evaluate(() => {
    (window as unknown as { gc?: () => void }).gc?.();
    const a = window.__aether;
    const rep = a?.studio.memoryReport();
    const c = a?.simulation?.voxel?.counts ?? { loaded: 0, drawn: 0 };
    return { heapMB: rep?.heapMB ?? null, loaded: c.loaded, drawn: c.drawn, geometries: rep?.renderer?.geometries ?? -1, textures: rep?.renderer?.textures ?? -1 };
  });
  return { t, tabMb: Math.round(sampleBrowserMemory().tabMb), ...page_ };
}

async function boot(page: Page, url: string): Promise<void> {
  await page.goto(`${url}/?debug=1#/new`, { waitUntil: 'domcontentloaded' });
  await waitFor(page, 'the studio to boot', BOOT_MS, () =>
    page.evaluate(() => {
      const a = window.__aether;
      const st = a?.store.getState();
      if (st?.fatal) return `fatal: ${st.fatal}`;
      return a && a.simulation !== null && st?.loading === null ? true : null;
    }),
  );
}

async function prompt(page: Page, text: string, done: () => Promise<boolean>): Promise<number> {
  const t0 = performance.now();
  const input = page.getByLabel('Prompt', { exact: true });
  await input.fill(text);
  await input.press('Enter');
  await waitFor(page, `the agent turn "${text}"`, AGENT_MS, async () => (await done()) || null);
  await page.evaluate(async () => window.__aether?.simulation?.whenSynced());
  return performance.now() - t0;
}

async function voxelWalk(page: Page, label: string): Promise<void> {
  await prompt(page, 'a minecraft-like survival world', () => page.evaluate(() => !window.__aether?.store.getState().agentBusy && !!window.__aether?.history.current.voxel));
  const view = await waitFor(page, 'terrain streaming to settle', 120_000, () =>
    page.evaluate(() => {
      const v = window.__aether?.simulation?.voxel;
      const s = v?.active ? v.status() : null;
      return s && s.settled && s.meshed > 0 && !s.compiling ? s.view : null;
    }),
  );
  await page.evaluate(() => void window.__aether?.studio.togglePlay());
  await waitFor(page, 'the voxel game to start', 60_000, () => page.evaluate(() => (window.__aether?.store.getState().voxelHud?.loading === null ? true : null)));
  await page.getByRole('button', { name: /Click to play/ }).click({ timeout: 10_000 }).catch(() => undefined);
  await page.evaluate(() => {
    const g = window.__aether?.simulation?.voxel?.game?.game;
    if (!g) return;
    g.player.flying = true;
    g.player.body.y = Math.max(g.player.body.y, 90);
  });
  await page.keyboard.down('KeyW');
  await markFrames(page);
  const samples: Sample[] = [];
  const t0 = performance.now();
  let nextSample = 0;
  let turn = 0;
  let peakLoaded = 0;
  let peakDrawn = 0;
  try {
    while ((performance.now() - t0) / 1000 < WALK_S) {
      const t = (performance.now() - t0) / 1000;
      if (t >= nextSample) {
        const s = await sample(page, Math.round(t));
        samples.push(s);
        log(`[${label}] walk t=${s.t}s heap ${s.heapMB ?? '–'} MB, tab ${s.tabMb} MB, chunks loaded ${s.loaded} / drawn ${s.drawn}, geometries ${s.geometries}, textures ${s.textures}`);
        nextSample += 30;
      }
      // Turn a little every 4 s so the path curves through fresh terrain, and keep the player airborne.
      await page.evaluate((k) => {
        const play = window.__aether?.simulation?.voxel?.game;
        if (!play) return;
        play.input.setLook(play.input.yawRad + (k % 2 === 0 ? 0.5 : -0.35), -0.1);
        const g = play.game;
        g.player.flying = true;
        if (g.player.body.y < 80) g.player.body.y = 90;
      }, turn++);
      const c = await page.evaluate(() => window.__aether?.simulation?.voxel?.counts ?? { loaded: 0, drawn: 0 });
      peakLoaded = Math.max(peakLoaded, c.loaded);
      peakDrawn = Math.max(peakDrawn, c.drawn);
      await page.waitForTimeout(4000);
    }
  } finally {
    await page.keyboard.up('KeyW');
  }
  const frames = await frameReport(page);
  const travelled = await page.evaluate(() => {
    const b = window.__aether?.simulation?.voxel?.game?.game.player.body;
    return b ? Math.round(Math.hypot(b.x, b.z)) : -1;
  });
  samples.push(await sample(page, Math.round((performance.now() - t0) / 1000)));
  log(`[${label}] voxel walk ${WALK_S} s (${travelled} blocks from spawn): ${fmt(frames)}; peak chunks loaded ${peakLoaded}, drawn ${peakDrawn} (view ${view})`);
  check(peakLoaded <= (2 * (view + 2) + 1) ** 2, `[${label}] loaded chunks unbounded: ${peakLoaded}`);
  check(peakDrawn <= (2 * view + 1) ** 2, `[${label}] drawn chunk meshes unbounded: ${peakDrawn}`);
  // Growth from the first steady sample (after the first 30 s of streaming) to the end.
  const first = samples[Math.min(1, samples.length - 1)] as Sample;
  const last = samples[samples.length - 1] as Sample;
  if (first.heapMB !== null && last.heapMB !== null) check(last.heapMB - first.heapMB <= HEAP_GROWTH_MB, `[${label}] JS heap grew ${first.heapMB} → ${last.heapMB} MB over the walk`);
  check(last.tabMb - first.tabMb <= TAB_GROWTH_MB, `[${label}] tab memory grew ${first.tabMb} → ${last.tabMb} MB over the walk`);
  const geo = samples.slice(1).map((s) => s.geometries);
  check(Math.max(...geo) - Math.min(...geo) <= 64 + peakDrawn, `[${label}] geometries crept over the walk: ${geo.join(', ')}`);
  const tex = samples.slice(1).map((s) => s.textures);
  check(Math.max(...tex) - Math.min(...tex) <= 8, `[${label}] textures crept over the walk: ${tex.join(', ')}`);
  await page.evaluate(() => void window.__aether?.studio.togglePlay());
  await waitFor(page, 'edit mode', 30_000, () => page.evaluate(() => (window.__aether?.store.getState().mode === 'edit' ? true : null)));
}

async function archRender(page: Page, label: string): Promise<void> {
  await page.goto(`${page.url().split('#')[0]}#/new`);
  await waitFor(page, 'a fresh project', BOOT_MS, () => page.evaluate(() => (window.__aether?.simulation && window.__aether.store.getState().loading === null ? true : null)));
  const ms = await prompt(page, 'a two-storey villa with a pool', () => page.evaluate(() => !window.__aether?.store.getState().agentBusy && window.__aether?.store.getState().arch.building !== null));
  const studioOn = async (): Promise<string> => {
    await page.evaluate(() => window.__aether?.store.getState().setArch({ quality: 'studio' }));
    return waitFor(page, 'the studio render', 30_000, () =>
      page.evaluate(() => {
        const st = window.__aether?.store.getState();
        if (st && !st.arch.studioAvailable) return 'unavailable';
        const r = window.__aether?.simulation?.renderer;
        return r && r.renderQuality === 'studio' && r.refineProgress > 0 ? 'ok' : null;
      }),
    );
  };
  const studioOff = async (): Promise<void> => {
    await page.evaluate(() => window.__aether?.store.getState().setArch({ quality: 'realtime' }));
    await waitFor(page, 'realtime render', 15_000, () => page.evaluate(() => window.__aether?.simulation?.renderer.renderQuality === 'realtime'));
  };
  // The studio pipeline releases its targets a few frames after it is switched off (later on a
  // loaded machine): read the texture count once two samples a second apart agree (<= 15 s).
  const settled = async (t: number): Promise<Sample> => {
    let prev = await sample(page, t);
    for (let i = 0; i < 15; i++) {
      await page.evaluate(() => window.__aether?.simulation?.renderer.requestRender());
      await page.waitForTimeout(1000);
      const next = await sample(page, t);
      if (next.textures === prev.textures && next.geometries === prev.geometries) return next;
      prev = next;
    }
    return prev;
  };
  // Warm-up: the first studio frame creates the pipeline's long-lived resources once.
  await studioOn();
  await studioOff();
  const before = await settled(0);
  await markFrames(page);
  const studio = await studioOn();
  await page.waitForTimeout(15_000);
  const frames = await frameReport(page);
  const during = await sample(page, 15);
  await studioOff();
  // Two more quick on/off cycles: nothing may accumulate per use.
  for (let i = 0; i < 2; i++) {
    await studioOn();
    await studioOff();
  }
  const after = await settled(18);
  log(`[${label}] villa built in ${Math.round(ms)} ms; studio render (${studio}) 15 s: ${fmt(frames)}; heap ${before.heapMB ?? '–'} → ${during.heapMB ?? '–'} → ${after.heapMB ?? '–'} MB, tab ${before.tabMb} → ${during.tabMb} → ${after.tabMb} MB, textures ${before.textures} → ${during.textures} → ${after.textures}`);
  check(after.textures <= before.textures + 2, `[${label}] studio render left textures behind: ${before.textures} → ${after.textures}`);
}

async function scatter(page: Page, label: string): Promise<void> {
  await page.goto(`${page.url().split('#')[0]}#/new`);
  await waitFor(page, 'a fresh project', BOOT_MS, () => page.evaluate(() => (window.__aether?.simulation && window.__aether.store.getState().loading === null ? true : null)));
  const ms = await prompt(page, 'a canyon with a million trees and ancient statues', () => page.evaluate(() => !window.__aether?.store.getState().agentBusy && Object.keys(window.__aether?.history.current.entities ?? {}).length > 0));
  await page.waitForTimeout(2000);
  const before = await sample(page, 0);
  await markFrames(page);
  // Orbit for 12 s.
  for (let i = 0; i < 24; i++) {
    await page.evaluate((k) => {
      const r = window.__aether?.simulation?.renderer;
      const a = (k / 24) * Math.PI * 2;
      r?.setCameraPose(Math.sin(a) * 140, 60, Math.cos(a) * 140, a, -0.35);
    }, i);
    await page.waitForTimeout(500);
  }
  const frames = await frameReport(page);
  const after = await sample(page, 12);
  const instances = await page.evaluate(() => window.__aether?.simulation?.renderer.stats().fieldInstances ?? -1);
  log(`[${label}] million scatter built in ${Math.round(ms)} ms (${instances >= 0 ? `${instances} field instances` : 'field stats n/a'}); orbit 12 s: ${fmt(frames)}; heap ${before.heapMB ?? '–'} → ${after.heapMB ?? '–'} MB, tab ${before.tabMb} → ${after.tabMb} MB, geometries ${before.geometries} → ${after.geometries}`);
}

async function run(browser: Browser, url: string, label: string): Promise<void> {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await context.addInitScript({ content: SKIP_FIRST_RUN });
  await context.addInitScript({ content: 'globalThis.__name = (f) => f;' });
  await context.addInitScript({ content: FRAME_PROBE });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  try {
    await boot(page, url);
    log(`[${label}] booted on ${await page.evaluate(() => window.__aether?.simulation?.backend ?? '?')}`);
    if (PHASES.has('walk')) await voxelWalk(page, label);
    if (PHASES.has('arch')) await archRender(page, label);
    if (PHASES.has('scatter')) await scatter(page, label);
    check(errors.length === 0, `[${label}] page errors: ${errors.slice(0, 3).join(' | ')}`);
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  const server = await startServer((l) => void l);
  try {
    const targets: Array<[string, () => Promise<Browser>]> = [
      ['chromium', () => chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS, '--js-flags=--expose-gc'] })],
      ['firefox', () => firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } })],
    ];
    for (const [label, launch] of targets) {
      if (ONLY && ONLY !== label) continue;
      let browser: Browser | null = null;
      try {
        browser = await launch();
        await run(browser, server.url, label);
      } finally {
        await browser?.close();
      }
    }
    log('soak: done');
  } finally {
    await server.stop();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
