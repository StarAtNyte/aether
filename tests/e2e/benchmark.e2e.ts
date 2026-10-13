/**
 * Benchmark scene in a real browser: builds the showcase world ("a canyon
 * with a million trees and ancient statues") with the offline planner and
 * measures it while the camera orbits.
 *
 * Reports per browser/backend: scene triangles vs drawn triangles, field
 * instances drawn, virtual-geometry instances, frame time percentiles over a
 * fixed camera orbit, main-thread long tasks, and a screenshot. With
 * `--classic` the same world is measured with fields and virtual geometry
 * off (`?engine=classic`), for an A/B comparison.
 *
 * One browser at a time; everything started here is stopped in `finally`.
 *
 * Run: `npm run build && npm run e2e:benchmark` (Chromium WebGPU, Chromium
 * WebGL2, then Firefox WebGL2). Flags: `--only=chromium-webgpu|chromium-webgl2|firefox`,
 * `--classic`, `--seconds=6`, `--out=<dir>` for the screenshots.
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, firefox, type Browser, type Page } from 'playwright';
import { decodePng, pixelStats } from './support/png';
import { CHROME_ARGS, FIREFOX_PREFS, REPO_ROOT, findChrome, findFirefox, startServer } from './support/env';

const PROMPT = 'a canyon with a million trees and ancient statues';
const VIEWPORT = { width: 1280, height: 800 };
const ARGS = process.argv.slice(2);
const arg = (name: string): string | undefined => ARGS.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const CLASSIC = ARGS.includes('--classic');
const SECONDS = Math.min(30, Math.max(2, Number(arg('seconds') ?? 6)));
const OUT_DIR = resolve(arg('out') ?? join(REPO_ROOT, 'docs/screenshots/benchmark'));
const ONLY = arg('only');
const BOOT_TIMEOUT_MS = 90_000;
const AGENT_TIMEOUT_MS = 240_000;

const startedAt = performance.now();
function log(line: string): void {
  process.stdout.write(`[${((performance.now() - startedAt) / 1000).toFixed(1).padStart(6)}s] ${line}\n`);
}

interface Target {
  name: string;
  launch(): Promise<Browser>;
  query: string;
}

const TARGETS: readonly Target[] = [
  { name: 'chromium-webgpu', launch: () => chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] }), query: '' },
  { name: 'chromium-webgl2', launch: () => chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] }), query: '' },
  { name: 'firefox', launch: () => firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } }), query: '' },
];

interface Probe {
  ready: boolean;
  fatal: string | null;
  busy: boolean;
  last: string | null;
  entities: number;
}

function probe(page: Page): Promise<Probe | null> {
  return page.evaluate((): Probe | null => {
    const a = window.__aether;
    if (!a) return null;
    const st = a.store.getState();
    let last: string | null = null;
    for (let i = st.chat.length - 1; i >= 0; i--) {
      const e = st.chat[i];
      if (e && e.role === 'assistant') {
        last = e.status;
        break;
      }
    }
    return { ready: a.simulation !== null && st.loading === null, fatal: st.fatal, busy: st.agentBusy, last, entities: Object.keys(a.history.current.entities).length };
  });
}

/** Last agent event types and the loading line (progress diagnostics). */
function progress(page: Page): Promise<string> {
  return page.evaluate(() => {
    const st = window.__aether?.store.getState();
    if (!st) return '?';
    const last = [...st.chat].reverse().find((e) => e.role === 'assistant');
    const events = last && last.role === 'assistant' ? last.events.slice(-3).map((e) => e.type).join(',') : '-';
    return `events [${events}] loading ${st.loading ?? '-'}`;
  });
}

async function waitFor(page: Page, what: string, timeoutMs: number, ok: (p: Probe) => boolean): Promise<Probe> {
  const deadline = performance.now() + timeoutMs;
  let nextReport = performance.now() + 15_000;
  while (performance.now() < deadline) {
    const p = await probe(page);
    if (p?.fatal) throw new Error(`renderer failed: ${p.fatal}`);
    if (p && ok(p)) return p;
    if (performance.now() > nextReport) {
      nextReport += 15_000;
      log(`    … waiting for ${what}: ${await progress(page).catch(() => 'page busy')}`);
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Result of one run. */
interface Result {
  target: string;
  backend: string;
  engine: 'scale' | 'classic';
  sceneTriangles: number;
  drawnTriangles: number;
  drawCalls: number;
  fieldInstances: number;
  fieldDrawn: number;
  virtualInstances: number;
  virtualDrawn: number;
  frames: number;
  p50: number;
  p90: number;
  p99: number;
  longTasks: number;
  longestTask: number;
  buildSeconds: number;
  screenshot: string;
}

async function run(target: Target, url: string): Promise<Result> {
  const browser = await target.launch();
  try {
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') log(`    console.${m.type()}: ${m.text().slice(0, 300)}`);
    });
    const params = new URLSearchParams({ debug: '1' });
    if (CLASSIC) params.set('engine', 'classic');
    // Chromium on WebGL2: hide WebGPU before any script runs (same as the main e2e suite).
    if (target.name === 'chromium-webgl2') {
      await context.addInitScript(() => {
        delete (Navigator.prototype as unknown as Record<string, unknown>)['gpu'];
      });
    }
    await page.goto(`${url}/?${params.toString()}#/new`, { waitUntil: 'domcontentloaded' });
    await waitFor(page, 'boot', BOOT_TIMEOUT_MS, (p) => p.ready && p.entities > 0);
    const backend = await page.evaluate(() => window.__aether?.simulation?.backend ?? '?');
    const t0 = performance.now();
    const input = page.getByLabel('Prompt', { exact: true });
    await input.fill(PROMPT);
    await input.press('Enter');
    await waitFor(page, 'the agent to start', 15_000, (p) => p.busy || p.last !== null);
    const done = await waitFor(page, 'the agent to finish', AGENT_TIMEOUT_MS, (p) => !p.busy && p.last !== 'streaming' && p.ready);
    if (done.last !== 'done') throw new Error(`agent turn ended with ${done.last}`);
    await page.evaluate(async () => {
      await window.__aether?.simulation?.whenSynced();
    });
    // Virtual geometry swaps in once the worker built each hierarchy.
    await page.waitForFunction(() => {
      const r = window.__aether?.simulation?.renderer;
      if (!r) return false;
      const s = r.stats();
      return (s.virtualInstances ?? 0) >= 30 || new URLSearchParams(location.search).get('engine') === 'classic';
    }, null, { timeout: 120_000 });
    await page.waitForFunction(() => window.__aether?.simulation?.renderer.cameraFlying === false, null, { timeout: 60_000 });
    const buildSeconds = (performance.now() - t0) / 1000;
    // Orbit the camera for SECONDS, recording frame times and long tasks in the page.
    const m = await page.evaluate(async (seconds: number) => {
      const sim = window.__aether?.simulation;
      if (!sim) throw new Error('no simulation');
      const r = sim.renderer;
      let longTasks = 0;
      let longest = 0;
      const obs = typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')
        ? new PerformanceObserver((l) => {
            for (const e of l.getEntries()) {
              longTasks++;
              longest = Math.max(longest, e.duration);
            }
          })
        : null;
      obs?.observe({ entryTypes: ['longtask'] });
      const frames: number[] = [];
      const start = performance.now();
      let last = start;
      const target = r.orbitTarget();
      await new Promise<void>((done) => {
        const step = (now: number): void => {
          frames.push(now - last);
          last = now;
          const t = (now - start) / 1000;
          const a = t * 0.35;
          // Low, sweeping orbit along the canyon: near statues, the floor and the forest horizon.
          r.frameSphere([target[0] + Math.sin(a) * 6, 2, target[2] + Math.cos(a) * 40], 30, [Math.sin(a), 0.35, Math.cos(a)], 0);
          if (t < seconds) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      });
      obs?.disconnect();
      const s = r.stats();
      frames.shift();
      const sorted = [...frames].sort((x, y) => x - y);
      const q = (p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
      return { frames: frames.length, p50: q(0.5), p90: q(0.9), p99: q(0.99), longTasks, longest, stats: s };
    }, SECONDS);
    await page.evaluate(() => window.__aether?.store.getState().updateSettings({ showPerf: true }));
    await page.addStyleTag({ content: '.nav-hint, .toasts, .toast, .tooltip { display: none !important; }' });
    await page.waitForTimeout(700);
    mkdirSync(OUT_DIR, { recursive: true });
    const file = join(OUT_DIR, `${target.name}${CLASSIC ? '-classic' : ''}.png`);
    const png = await page.locator('.viewport').screenshot({ path: file });
    const px = pixelStats(decodePng(png));
    if (px.stdDev < 6) throw new Error('blank canvas');
    if (errors.length > 0) throw new Error(`page errors: ${errors.join('; ')}`);
    await context.close();
    const s = m.stats;
    return {
      target: target.name,
      backend,
      engine: CLASSIC ? 'classic' : 'scale',
      sceneTriangles: s.sceneTriangles ?? 0,
      drawnTriangles: s.triangles,
      drawCalls: s.drawCalls,
      fieldInstances: s.fieldInstances ?? 0,
      fieldDrawn: s.fieldDrawn ?? 0,
      virtualInstances: s.virtualInstances ?? 0,
      virtualDrawn: s.virtualDrawnTriangles ?? 0,
      frames: m.frames,
      p50: m.p50,
      p90: m.p90,
      p99: m.p99,
      longTasks: m.longTasks,
      longestTask: m.longest,
      buildSeconds,
      screenshot: file,
    };
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  const server = await startServer(log);
  const results: Result[] = [];
  try {
    for (const t of TARGETS) {
      if (ONLY && t.name !== ONLY) continue;
      log(`${t.name}${CLASSIC ? ' (classic engine)' : ''}: building "${PROMPT}"`);
      const r = await run(t, server.url);
      results.push(r);
      const M = (n: number): string => `${(n / 1e6).toFixed(2)}M`;
      log(`  ${r.backend}: scene ${M(r.sceneTriangles)} tris, drawn ${M(r.drawnTriangles)} (${(r.sceneTriangles / Math.max(1, r.drawnTriangles)).toFixed(0)}x), ${r.drawCalls} draws; fields ${r.fieldDrawn}/${r.fieldInstances}; virtual ${r.virtualInstances} meshes ${M(r.virtualDrawn)} tris`);
      log(`  frame p50 ${r.p50.toFixed(1)} ms, p90 ${r.p90.toFixed(1)} ms, p99 ${r.p99.toFixed(1)} ms over ${r.frames} frames; ${r.longTasks} long tasks (max ${r.longestTask.toFixed(0)} ms); built in ${r.buildSeconds.toFixed(1)} s → ${r.screenshot}`);
    }
    process.stdout.write(`${JSON.stringify(results)}\n`);
    log('BENCHMARK DONE');
  } finally {
    await server.stop();
  }
}

main().catch((err: unknown) => {
  log(`BENCHMARK FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
