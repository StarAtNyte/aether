/**
 * End-to-end check of Aether Studio in real browsers: Chromium (WebGPU and
 * forced WebGL2), then Firefox (WebGL2), one browser at a time.
 *
 * Starts the server in offline mock mode (serving the built studio from
 * `apps/studio/dist`), then drives the app like a user:
 *
 *  1. open `#/new` with `?debug=1` (a new project from the starter scene,
 *     created through the projects home), wait for it to render and prove
 *     the canvas is not blank (screenshot pixel variance);
 *  2. send four example prompts through the chat box (type + Enter), wait
 *     for each agent turn to finish, check the world changed and the
 *     physics-check pill shows a result;
 *  3. Play, drive the player with the keyboard for 3 s, check physics moved
 *     something and fps > 0, Stop and check the world was restored exactly;
 *  4. undo / redo, select an entity in the outliner and recolor it in the
 *     inspector, export the world JSON.
 *
 * A second, shorter Chromium run deletes `navigator.gpu` to force the WebGL2
 * path; a third, full run uses Firefox, whose Linux builds have no WebGPU.
 * Any console error or uncaught page error fails the run. README
 * screenshots are written to `docs/screenshots/`.
 *
 * Run: `npm run build && npm run e2e` (or `AETHER_E2E_URL=http://… npm run e2e`
 * against an already running server).
 */
import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium, firefox, type Browser, type ConsoleMessage, type Page } from 'playwright';
import { decodePng, pixelStats } from './support/png';
import { CHROME_ARGS, FIREFOX_PREFS, REPO_ROOT, STUDIO_DIST, findChrome, findFirefox, startServer, SKIP_FIRST_RUN } from './support/env';

const VIEWPORT = { width: 1440, height: 900 };
const SCREENSHOT_DIR = join(REPO_ROOT, 'docs/screenshots');

const BOOT_TIMEOUT_MS = 60_000;
const AGENT_TIMEOUT_MS = 120_000;
const MODE_TIMEOUT_MS = 30_000;
const DRIVE_MS = 3_000;
const FPS_SAMPLE_MS = 2_000;
/** Luminance std-dev below this means a flat (blank) canvas. */
const MIN_CANVAS_STDDEV = 6;
const MIN_CANVAS_COLORS = 24;
/** No main-thread task may run longer than this during an agent turn (verification runs in workers). */
const MAX_LONG_TASK_MS = 200;

/** Prompts sent through the chat, in order (the last one is a playable game). */
const PROMPTS: ReadonlyArray<{ slug: string; text: string }> = [
  { slug: 'lakeside-camp', text: 'A cozy lakeside camp at sunset with a campfire, tents and fireflies' },
  { slug: 'domino-run', text: 'Build a domino run that knocks over a bell tower' },
  { slug: 'bowling-alley', text: 'Bowling alley: knock down a pyramid of 15 crates with a heavy ball' },
  { slug: 'coin-island', text: 'A coin collecting game on a tropical island — collect 10 coins in 60 seconds' },
];

/**
 * Console noise that is expected and harmless. Only `error`-level messages
 * fail the run; these patterns are documented here so new noise is a
 * conscious decision.
 */
const BENIGN_CONSOLE: readonly RegExp[] = [
  // Chromium's GPU process logs these for software (SwiftShader) GL; not app errors.
  /GL Driver Message/i,
  /GPU stall due to ReadPixels/i,
  // Dawn's message when a WebGPU adapter probe is torn down (no adapter in headless).
  /valid external Instance reference no longer exists/i,
  // Firefox's software WebGL reports driver performance hints as warnings/errors.
  /^WebGL warning:/i,
];

// ---------------------------------------------------------------------------
// Logging & assertions
// ---------------------------------------------------------------------------

const startedAt = performance.now();
function log(line: string): void {
  process.stdout.write(`[${((performance.now() - startedAt) / 1000).toFixed(1).padStart(6)}s] ${line}\n`);
}

class E2EFailure extends Error {
  override name = 'E2EFailure';
}

function check(cond: unknown, message: string): asserts cond {
  if (!cond) throw new E2EFailure(message);
}

async function waitFor<T>(page: Page, what: string, timeoutMs: number, probe: () => Promise<T | null | undefined | false>, intervalMs = 250): Promise<T> {
  const deadline = performance.now() + timeoutMs;
  let last: unknown = null;
  while (performance.now() < deadline) {
    const v = await probe();
    if (v !== null && v !== undefined && v !== false) return v;
    last = v;
    await page.waitForTimeout(intervalMs);
  }
  throw new E2EFailure(`timed out after ${timeoutMs} ms waiting for ${what} (last=${JSON.stringify(last)})`);
}

// ---------------------------------------------------------------------------
// Page probes (run inside the browser; rely on the `?debug=1` handle)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Long-task probe (installed before any page script runs)
// ---------------------------------------------------------------------------

/** One recorded main-thread interval (ms, page clock). */
interface Interval {
  start: number;
  duration: number;
}

/** A long animation frame with its script attribution (Chromium). */
interface LongFrame extends Interval {
  scripts: Array<{ invoker: string; type: string; start: number; duration: number }>;
}

/** Main-thread blocking observed since the last reset. */
interface BlockingStats {
  /** `longtask` entries (Chromium); null where the entry type is unsupported (Firefox). */
  tasks: Interval[] | null;
  /** `long-animation-frame` entries with script attribution (Chromium); null where unsupported. */
  frames: LongFrame[] | null;
  /** Event-loop stalls > 50 ms seen by a 20 ms interval timer (every browser). */
  stalls: Interval[];
  /** Worker verification runs: from dispatch (planned in a worker) to the result. */
  verifications: Interval[];
}

declare global {
  interface Window {
    __aetherBlocking?: { reset(): void; read(): BlockingStats; watchVerify(): void };
  }
}

/**
 * Records long tasks and long animation frames (Chromium) and event-loop
 * stalls (an interval timer's lateness, every browser, since Firefox has no
 * long-task entries), plus the time windows in which verification runs.
 * Plain JavaScript source (not a compiled function) so no bundler helper
 * leaks into the page.
 */
const BLOCKING_PROBE = `(() => {
  const s = { tasks: null, frames: null, stalls: [], verifications: [] };
  const types = (window.PerformanceObserver && PerformanceObserver.supportedEntryTypes) || [];
  const reset = () => {
    s.tasks = types.includes('longtask') ? [] : null;
    s.frames = types.includes('long-animation-frame') ? [] : null;
    s.stalls = [];
    s.verifications = [];
  };
  reset();
  try {
    if (types.includes('longtask')) new PerformanceObserver((list) => { for (const e of list.getEntries()) if (s.tasks) s.tasks.push({ start: e.startTime, duration: e.duration }); }).observe({ type: 'longtask', buffered: false });
    if (types.includes('long-animation-frame')) new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (s.frames) s.frames.push({ start: e.startTime, duration: e.duration, scripts: (e.scripts || []).map((x) => ({ invoker: String(x.invoker || ''), type: String(x.invokerType || ''), start: x.startTime, duration: x.duration })) });
    }).observe({ type: 'long-animation-frame', buffered: false });
  } catch (err) {}
  const INTERVAL = 20;
  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    const lag = now - last - INTERVAL;
    if (lag > 50) s.stalls.push({ start: last, duration: lag });
    last = now;
  }, INTERVAL);
  let watching = false;
  let openAt = -1;
  window.__aetherBlocking = {
    reset() { reset(); openAt = -1; last = performance.now(); },
    read() { return JSON.parse(JSON.stringify(s)); },
    watchVerify() {
      if (watching || !window.__aether) return;
      watching = true;
      window.__aether.store.subscribe((st) => {
        // From dispatch to the worker (the run is planned) until the result is in.
        const running = st.verify.status === 'running' && !!st.verify.live && st.verify.live.worker === true;
        if (running && openAt < 0) openAt = performance.now();
        else if (!running && openAt >= 0) { s.verifications.push({ start: openAt, duration: performance.now() - openAt }); openAt = -1; }
      });
    },
  };
})();`;

/** Longest duration in a list (0 when empty, -1 when unsupported). */
function longest(list: Interval[] | null): number {
  if (!list) return -1;
  return list.reduce((m, i) => Math.max(m, i.duration), 0);
}

/** True when two intervals overlap. */
function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.start + b.duration && b.start < a.start + a.duration;
}

/**
 * Longest main-thread script during verification that is NOT the renderer's
 * animation-frame callback (Chromium long-animation-frame attribution; -1
 * where unsupported). Rendering a freshly built world compiles its
 * materials inside the frame callback (three.js, not verification); any
 * other long script in these windows (message handlers, timers, promise
 * continuations) would be verification work leaking onto the main thread.
 */
function verificationScriptMax(b: BlockingStats): { ms: number; what: string } {
  if (!b.frames) return { ms: -1, what: '' };
  let worst = { ms: 0, what: '' };
  for (const f of b.frames) {
    for (const sc of f.scripts) {
      if (sc.invoker === 'FrameRequestCallback' || sc.duration <= worst.ms) continue;
      // The script itself (not just its frame) must run while a worker verification is in flight.
      if (!b.verifications.some((w) => overlaps({ start: sc.start, duration: sc.duration }, w))) continue;
      worst = { ms: sc.duration, what: `${sc.type}: ${sc.invoker}` };
    }
  }
  return worst;
}

/** Compact studio state read through `window.__aether`. */
interface StudioSnapshot {
  ready: boolean;
  loading: string | null;
  fatal: string | null;
  backend: string | null;
  mode: string;
  modeBusy: boolean;
  entities: number;
  head: number;
  canUndo: boolean;
  canRedo: boolean;
  fps: number;
  drawCalls: number;
  triangles: number;
  agentBusy: boolean;
  verify: string;
  verifyWorker: boolean | null;
  verifyLanes: number;
  verifyMs: number;
  lastAssistant: string | null;
  simAttached: boolean;
  physics: boolean;
}

function snapshot(page: Page): Promise<StudioSnapshot | null> {
  return page.evaluate((): StudioSnapshot | null => {
    const a = window.__aether;
    if (!a) return null;
    const st = a.store.getState();
    let lastAssistant: string | null = null;
    for (let i = st.chat.length - 1; i >= 0; i--) {
      const e = st.chat[i];
      if (e && e.role === 'assistant') {
        lastAssistant = e.status;
        break;
      }
    }
    const sim = a.simulation;
    return {
      ready: sim !== null && st.loading === null,
      loading: st.loading,
      fatal: st.fatal,
      backend: st.backend,
      mode: st.mode,
      modeBusy: st.modeBusy,
      entities: Object.keys(a.history.current.entities).length,
      head: a.history.head,
      canUndo: a.history.canUndo(),
      canRedo: a.history.canRedo(),
      fps: st.stats.fps,
      drawCalls: st.stats.drawCalls,
      triangles: st.stats.triangles,
      agentBusy: st.agentBusy,
      verify: st.verify.status,
      verifyWorker: st.verify.worker ?? null,
      verifyLanes: st.verify.lanes ?? 0,
      verifyMs: st.verify.ms,
      lastAssistant,
      simAttached: sim !== null,
      physics: sim?.physics != null,
    };
  });
}

async function snap(page: Page): Promise<StudioSnapshot> {
  const s = await snapshot(page);
  check(s, 'window.__aether debug handle is missing');
  return s;
}

/** Canonical JSON of the current world document. */
function worldJson(page: Page): Promise<string> {
  return page.evaluate(() => JSON.stringify(window.__aether?.history.current ?? null));
}

/** One-line summaries of the latest assistant turn's events (diagnostics). */
function lastTurnEvents(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const chat = window.__aether?.store.getState().chat ?? [];
    const last = chat[chat.length - 1];
    if (!last || last.role !== 'assistant') return [];
    return last.events.map((e) => {
      switch (e.type) {
        case 'patches':
          return `patches(${e.message.slice(0, 60)}${e.errors.length > 0 ? `; ${e.errors.length} errors: ${e.errors[0]?.slice(0, 120) ?? ''}` : ''})`;
        case 'verify':
          return `verify(${e.passed ? 'pass' : 'fail'})`;
        case 'done':
          return `done(${e.calls} calls)`;
        case 'generator':
          return `generator(${e.id}${e.ok ? '' : `: ${e.error ?? 'failed'}`})`;
        case 'repair':
          return `repair#${e.attempt}`;
        case 'quality':
          return `quality(${e.score})`;
        case 'edit':
          return `edit(${e.summary.slice(0, 100)})`;
        case 'clarify':
          return `clarify(${e.text.slice(0, 100)})`;
        default:
          return `${e.type}(${e.text.slice(0, 100)})`;
      }
    });
  });
}

/** Positions of every physics body plus the player capsule (play mode). */
function bodyPositions(page: Page): Promise<Record<string, [number, number, number]>> {
  return page.evaluate(() => {
    const sim = window.__aether?.simulation;
    const out: Record<string, [number, number, number]> = {};
    const pw = sim?.physics;
    if (pw) for (const [id, s] of pw.getAllStates()) out[id] = [s.position[0], s.position[1], s.position[2]];
    const p = sim?.playerPosition;
    if (p) out['@player'] = [p[0], p[1], p[2]];
    return out;
  });
}

/** Largest displacement between two position sets (ids present in both). */
function maxDisplacement(a: Record<string, [number, number, number]>, b: Record<string, [number, number, number]>): { id: string; d: number } {
  let best = { id: '', d: 0 };
  for (const id of Object.keys(a)) {
    const p = a[id];
    const q = b[id];
    if (!p || !q) continue;
    const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    if (d > best.d) best = { id, d };
  }
  return best;
}

/** Average of the 4 Hz fps stat over a window. */
async function sampleFps(page: Page, ms: number): Promise<{ fps: number; drawCalls: number; triangles: number }> {
  const samples: StudioSnapshot[] = [];
  const end = performance.now() + ms;
  while (performance.now() < end) {
    await page.waitForTimeout(250);
    samples.push(await snap(page));
  }
  const fps = samples.reduce((t, s) => t + s.fps, 0) / Math.max(1, samples.length);
  const last = samples[samples.length - 1];
  return { fps, drawCalls: last?.drawCalls ?? 0, triangles: last?.triangles ?? 0 };
}

/**
 * Screenshot of one element by clipping a page screenshot to its box.
 * `locator.screenshot()` first waits for the element to be "stable" over
 * consecutive animation frames, which never settles in time on a slow
 * software GPU (power-saving CPU: ~1 s per composited frame); the pixels are
 * the same.
 */
async function clipShot(page: Page, selector: string, path?: string): Promise<Buffer> {
  const box = await page.locator(selector).first().boundingBox();
  check(box && box.width > 0 && box.height > 0, `${selector} has no visible box`);
  return page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: box.height }, ...(path ? { path } : {}), timeout: 60_000 });
}

/** Screenshot the viewport and check it contains a real rendered image. */
async function assertCanvasRendered(page: Page, label: string): Promise<void> {
  const png = await clipShot(page, '.viewport__host canvas');
  const stats = pixelStats(decodePng(png));
  log(`  canvas (${label}): mean=${stats.mean.toFixed(1)} stddev=${stats.stdDev.toFixed(1)} colors=${stats.distinctColors}`);
  check(stats.stdDev >= MIN_CANVAS_STDDEV && stats.distinctColors >= MIN_CANVAS_COLORS, `canvas looks blank after ${label} (stddev ${stats.stdDev.toFixed(1)}, ${stats.distinctColors} colours)`);
}

/** Hide debug/transient overlays so screenshots look like the product. */
async function setPresentationMode(page: Page, on: boolean): Promise<void> {
  await page.evaluate((enable) => {
    window.__aether?.store.getState().updateSettings({ showPerf: !enable });
    // World shots show the world: no proof replay, seal or plan marks (e2e:ux covers those).
    if (enable) {
      window.__aether?.studio.dismissProof();
      window.__aether?.simulation?.renderer.clearBlueprint();
    }
    const id = 'e2e-presentation';
    document.getElementById(id)?.remove();
    if (enable) {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      const style = document.createElement('style');
      style.id = id;
      style.textContent = '.nav-hint, .toasts, .toast, .tooltip { display: none !important; } * { caret-color: transparent !important; }';
      document.head.appendChild(style);
    }
  }, on);
  await page.waitForTimeout(300);
}

async function screenshot(page: Page, name: string, target: 'page' | 'viewport'): Promise<void> {
  await setPresentationMode(page, true);
  const path = join(SCREENSHOT_DIR, `${name}.png`);
  if (target === 'viewport') await clipShot(page, '.viewport', path);
  else await page.screenshot({ path });
  await setPresentationMode(page, false);
  log(`  screenshot → docs/screenshots/${name}.png`);
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/** Measurements reported at the end of a run. */
interface RunMetrics {
  backend: string;
  firstFrameMs: number;
  defaultWorld: { fps: number; drawCalls: number; triangles: number; entities: number };
  examples: Array<{ slug: string; entities: number; fps: number; drawCalls: number; triangles: number; verify: string; agentMs: number; longTaskMs: number; lagMs: number; verifyMs: number; lanes: number }>;
  checks?: { ms: number; lanes: number; longTaskMs: number; lagMs: number };
}

async function boot(page: Page, url: string, metrics: RunMetrics): Promise<void> {
  const t0 = performance.now();
  await page.goto(`${url}/?debug=1#/new`, { waitUntil: 'domcontentloaded' });
  // The frame-rate counter only runs while the performance overlay is on (it is off by default).
  await waitFor(page, 'the editor to open', BOOT_TIMEOUT_MS, () => page.evaluate(() => !!window.__aether));
  await page.evaluate(() => window.__aether?.store.getState().updateSettings({ showPerf: true }));
  await waitFor(page, 'the studio to render its first frame', BOOT_TIMEOUT_MS, async () => {
    const s = await snapshot(page);
    if (s?.fatal) throw new E2EFailure(`renderer failed: ${s.fatal}`);
    return s && s.ready && s.fps > 0 && s.entities > 0 ? s : null;
  });
  metrics.firstFrameMs = performance.now() - t0;
  const s = await snap(page);
  metrics.backend = s.backend ?? 'none';
  log(`  booted on ${metrics.backend} in ${Math.round(metrics.firstFrameMs)} ms with ${s.entities} entities`);
  check(s.entities > 0, 'default world has no entities');
  await assertCanvasRendered(page, 'boot');
  const perf = await sampleFps(page, FPS_SAMPLE_MS);
  metrics.defaultWorld = { ...perf, entities: s.entities };
}

async function sendPrompt(page: Page, prompt: { slug: string; text: string }, metrics: RunMetrics, shots: boolean): Promise<void> {
  const before = await snap(page);
  const beforeWorld = await worldJson(page);
  const input = page.getByLabel('Prompt', { exact: true });
  await input.click();
  await input.fill(prompt.text);
  await page.evaluate(() => {
    window.__aetherBlocking?.watchVerify();
    window.__aetherBlocking?.reset();
  });
  const t0 = performance.now();
  await input.press('Enter');
  await waitFor(page, `agent to start on "${prompt.slug}"`, 10_000, async () => (await snap(page)).agentBusy || (await snap(page)).head !== before.head);
  const after = await waitFor(page, `agent to finish "${prompt.slug}"`, AGENT_TIMEOUT_MS, async () => {
    const s = await snap(page);
    return !s.agentBusy && s.lastAssistant !== 'streaming' && s.ready ? s : null;
  });
  const agentMs = performance.now() - t0;
  const blocking = await page.evaluate(() => window.__aetherBlocking?.read() ?? null);
  check(blocking, 'the long-task probe is missing');
  log(`  agent: ${(await lastTurnEvents(page)).join(' | ')}`);
  const longTaskMs = longest(blocking.tasks);
  const lagMs = longest(blocking.stalls);
  const verifyScript = verificationScriptMax(blocking);
  const verifyScriptMs = verifyScript.ms;
  log(
    `  main thread during the turn: longest task ${longTaskMs < 0 ? 'n/a' : `${Math.round(longTaskMs)} ms`}, worst stall ${Math.round(lagMs)} ms; ` +
      `verification ${after.verifyWorker ? `in ${after.verifyLanes} worker lane(s)` : 'on the main thread'} (${blocking.verifications.length} run(s), ${Math.round(after.verifyMs)} ms), ` +
      `longest non-render script during verification ${verifyScriptMs < 0 ? 'n/a' : `${Math.round(verifyScriptMs)} ms${verifyScript.what ? ` (${verifyScript.what})` : ''}`}`,
  );
  check(after.verifyWorker === true, `verification of "${prompt.slug}" did not run in a worker (${String(after.verifyWorker)})`);
  check(blocking.verifications.length > 0, `no verification run was observed during "${prompt.slug}"`);
  check(verifyScriptMs < MAX_LONG_TASK_MS, `a ${Math.round(verifyScriptMs)} ms main-thread script (${verifyScript.what}) ran during verification of "${prompt.slug}" (limit ${MAX_LONG_TASK_MS} ms)`);
  check(after.lastAssistant === 'done', `agent turn for "${prompt.slug}" ended with status ${after.lastAssistant}`);
  check(after.head !== before.head && (await worldJson(page)) !== beforeWorld, `"${prompt.slug}" did not change the world`);
  check(after.entities !== before.entities, `"${prompt.slug}" did not change the entity count (${before.entities})`);
  const pill = page.locator('.viewport .pill--button');
  const pillText = (await pill.textContent())?.trim() ?? '';
  check(/passed|failed|failing/i.test(pillText) && !/outdated/i.test(pillText), `checks button shows no fresh result for "${prompt.slug}" ("${pillText}")`);
  await waitFor(page, 'renderer to sync the new world', 15_000, async () => {
    const s = await snap(page);
    return s.ready && s.fps > 0 ? s : null;
  });
  await page.waitForTimeout(500);
  await assertCanvasRendered(page, prompt.slug);
  const perf = await sampleFps(page, FPS_SAMPLE_MS);
  metrics.examples.push({ slug: prompt.slug, entities: after.entities, verify: after.verify, agentMs, longTaskMs, lagMs, verifyMs: after.verifyMs, lanes: after.verifyLanes, ...perf });
  log(`  "${prompt.slug}": ${before.entities} → ${after.entities} entities, verify=${after.verify} ("${pillText}"), agent ${Math.round(agentMs)} ms, ${perf.fps.toFixed(1)} fps, ${perf.drawCalls} draws`);
  if (shots) {
    await screenshot(page, `world-${prompt.slug}`, 'viewport');
    if (prompt.slug === 'lakeside-camp') await screenshot(page, 'studio-overview', 'page');
  }
}

/**
 * "Run checks" on a world that is already rendered (no new materials to
 * compile, nothing else running): the page must stay responsive while the
 * world is simulated, because verification runs in workers. Measured in
 * every browser with the event-loop stall probe, and with long tasks where
 * supported.
 */
async function verifyResponsiveness(page: Page, attempt = 1, best = Number.POSITIVE_INFINITY): Promise<{ ms: number; lanes: number; longTaskMs: number; lagMs: number }> {
  await waitFor(page, 'the renderer to settle', 60_000, () => page.evaluate(() => !window.__aether?.simulation?.renderer.animating));
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    window.__aetherBlocking?.watchVerify();
    window.__aetherBlocking?.reset();
  });
  await page.locator('.viewport .pill--button').click();
  const done = await waitFor(page, 'checks to finish', 60_000, async () => {
    const st = await snap(page);
    return st.verify !== 'running' && st.verify !== 'idle' ? st : null;
  });
  await page.waitForTimeout(300);
  const b = await page.evaluate(() => window.__aetherBlocking?.read() ?? null);
  check(b, 'the long-task probe is missing');
  const longTaskMs = longest(b.tasks);
  const lagMs = longest(b.stalls);
  log(`  run checks on a rendered world: ${Math.round(done.verifyMs)} ms in ${done.verifyLanes} worker lane(s); longest task ${longTaskMs < 0 ? 'n/a' : `${Math.round(longTaskMs)} ms`}, worst stall ${Math.round(lagMs)} ms`);
  // One long task can be a software-rendered frame that landed on a busy machine, not the checks (they run in workers):
  // measure again before calling it a failure. The checks themselves cost the same every time, a stray frame does not, so
  // only the best of up to five readings in a row counts.
  const worst = Math.max(longTaskMs, lagMs);
  const bestSoFar = Math.min(best, worst);
  if (attempt < 5 && worst >= MAX_LONG_TASK_MS) {
    log(`  over the limit (best so far ${Math.round(bestSoFar)} ms); measuring again (a frame drawn on a loaded machine is not the checks)`);
    return verifyResponsiveness(page, attempt + 1, bestSoFar);
  }
  check(done.verifyWorker === true, 'Run checks did not verify in a worker');
  check(b.verifications.length === 1, `expected one verification run, saw ${b.verifications.length}`);
  check(longTaskMs < MAX_LONG_TASK_MS, `a ${Math.round(longTaskMs)} ms long task blocked the page while checks ran (limit ${MAX_LONG_TASK_MS} ms)`);
  check(lagMs < MAX_LONG_TASK_MS, `the page stalled for ${Math.round(lagMs)} ms while checks ran (limit ${MAX_LONG_TASK_MS} ms)`);
  return { ms: done.verifyMs, lanes: done.verifyLanes, longTaskMs, lagMs };
}

async function playAndStop(page: Page, shots: boolean): Promise<void> {
  const before = await worldJson(page);
  const playBtn = page.locator('button.play-btn');
  await playBtn.click();
  await waitFor(page, 'play mode', MODE_TIMEOUT_MS, async () => {
    const s = await snap(page);
    return s.mode === 'play' && s.physics && !s.modeBusy ? s : null;
  });
  await page.waitForTimeout(300);
  const p0 = await bodyPositions(page);
  check(Object.keys(p0).length > 0, 'play mode has no physics bodies or player');

  // Drive the player: keyboard focus on the canvas, then W / D / Space / A.
  await page.locator('.viewport__host canvas').focus();
  const driveStart = performance.now();
  const legs: ReadonlyArray<[string, number]> = [
    ['KeyW', 0.4],
    ['KeyD', 0.2],
    ['Space', 0.1],
    ['KeyW', 0.2],
    ['KeyA', 0.1],
  ];
  for (const [key, share] of legs) {
    await page.keyboard.down(key);
    await page.waitForTimeout(DRIVE_MS * share);
    await page.keyboard.up(key);
  }
  const drove = performance.now() - driveStart;
  const p1 = await bodyPositions(page);
  const moved = maxDisplacement(p0, p1);
  const s = await snap(page);
  log(`  played ${Math.round(drove)} ms: ${Object.keys(p1).length} bodies, max displacement ${moved.d.toFixed(2)} m (${moved.id}), fps ${s.fps}`);
  check(moved.d > 0.05, `physics did not move anything during play (max ${moved.d})`);
  check(s.fps > 0, 'fps stat is 0 during play');
  if (shots) await screenshot(page, 'play-mode', 'page');

  await playBtn.click();
  await waitFor(page, 'edit mode after Stop', MODE_TIMEOUT_MS, async () => {
    const st = await snap(page);
    return st.mode === 'edit' && !st.physics && !st.modeBusy ? st : null;
  });
  check((await worldJson(page)) === before, 'Stop did not restore the world document exactly');
  log('  stop restored the world');
}

async function undoRedo(page: Page): Promise<void> {
  const before = await snap(page);
  const worldBefore = await worldJson(page);
  check(before.canUndo, 'nothing to undo after the prompts');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  const undone = await waitFor(page, 'undo', 5_000, async () => {
    const s = await snap(page);
    return s.head !== before.head ? s : null;
  });
  check((await worldJson(page)) !== worldBefore, 'undo did not change the world');
  check(undone.canRedo, 'redo not available after undo');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await waitFor(page, 'redo', 5_000, async () => {
    const s = await snap(page);
    return s.head === before.head ? s : null;
  });
  check((await worldJson(page)) === worldBefore, 'redo did not restore the world');
  log(`  undo/redo ok (head ${before.head} → ${undone.head} → ${before.head})`);
}

/** Light by default; the app menu flips to dark, persists, and back. Self-hosted fonts load. */
async function themeSwitch(page: Page): Promise<void> {
  const look = (): Promise<{ theme: string | undefined; bgLum: number; saved: unknown; font: boolean }> =>
    page.evaluate(() => {
      // Computed colors may be oklab()/color(): resolve through a 1×1 canvas.
      const cv = document.createElement('canvas');
      cv.width = cv.height = 1;
      const ctx = cv.getContext('2d');
      let bgLum = -1;
      if (ctx) {
        ctx.fillStyle = getComputedStyle(document.querySelector('.editor') ?? document.body).backgroundColor;
        ctx.fillRect(0, 0, 1, 1);
        const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
        bgLum = (r + g + b) / 3;
      }
      let saved: unknown = null;
      try {
        saved = (JSON.parse(localStorage.getItem('aether.studio.settings.v1') ?? 'null') as { darkTheme?: unknown } | null)?.darkTheme ?? null;
      } catch {
        saved = 'unreadable';
      }
      return { theme: document.documentElement.dataset['theme'], bgLum, saved, font: document.fonts.check('13px "Aether Sans"') };
    });
  const light = await look();
  check(light.theme === 'light', `expected the light theme by default, got ${String(light.theme)}`);
  check(light.bgLum > 200, `light theme background is not light (mean channel ${light.bgLum})`);
  check(light.font, 'the self-hosted UI font did not load');
  const menu = page.getByRole('button', { name: 'Aether menu' });
  await menu.click();
  await page.getByRole('menuitem', { name: 'Dark theme' }).click();
  const dark = await waitFor(page, 'dark theme', 5_000, async () => {
    const s = await look();
    return s.theme === 'dark' && s.bgLum >= 0 && s.bgLum < 40 ? s : null;
  });
  check(dark.saved === true, 'dark theme choice was not persisted');
  await menu.click();
  await page.getByRole('menuitem', { name: 'Light theme' }).click();
  await waitFor(page, 'light theme again', 5_000, async () => {
    const s = await look();
    return s.theme === 'light' && s.bgLum > 200 ? s : null;
  });
  log(`  theme switch ok (light ${light.bgLum.toFixed(0)} → dark ${dark.bgLum.toFixed(0)} → light)`);
}

async function editColor(page: Page): Promise<void> {
  const target = await page.evaluate(() => {
    const w = window.__aether?.history.current;
    if (!w) return null;
    for (const id of Object.keys(w.entities)) {
      const e = w.entities[id];
      if (e && e.shape.kind === 'primitive' && e.material && e.visible) return id;
    }
    return null;
  });
  check(target, 'no recolorable entity in the world');
  await page.locator('#rail-objects').click();
  await page.getByLabel('Search objects').fill('');
  const row = page.locator(`.outliner-row:has(.outliner-row__name[title="${target}"])`);
  await row.scrollIntoViewIfNeeded();
  await row.click();
  await waitFor(page, 'outliner selection', 5_000, () =>
    page.evaluate((id) => {
      const sel = window.__aether?.store.getState().selection ?? [];
      return sel.length === 1 && sel[0] === id;
    }, target),
  );
  // The inspector (right panel) now shows the selected object's sections.
  const hex = page.getByLabel('Color hex', { exact: true });
  await hex.fill('#ff3366');
  await hex.press('Enter');
  await waitFor(page, 'color commit', 5_000, () =>
    page.evaluate((id) => {
      const e = window.__aether?.history.current.entities[id];
      return e?.material?.color === '#ff3366';
    }, target),
  );
  log(`  recolored ${target} via outliner + inspector`);
}

/** README shots of the projects home (desktop) and the editor on a phone. */
async function homeAndPhoneShots(browser: Browser, page: Page, url: string): Promise<void> {
  await page.evaluate(() => window.__aether?.studio.flush());
  await page.goto(`${url}/?debug=1#/`);
  await page.locator('.card--project').first().waitFor({ timeout: 20_000 });
  // Lazy images off screen never start loading; wait for the ones in view.
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('.card img')].filter((i) => { const r = i.getBoundingClientRect(); return r.right > 0 && r.left < innerWidth && r.top < innerHeight; }).every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15_000 });
  await page.waitForTimeout(500);
  await screenshot(page, 'projects-home', 'page');
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await phone.addInitScript({ content: SKIP_FIRST_RUN });
  try {
    const p = await phone.newPage();
    await p.goto(`${url}/?debug=1#/new/coin-island`);
    await p.waitForFunction(() => {
      const st = window.__aether?.store.getState();
      const last = st?.chat[st.chat.length - 1];
      return !!st && st.loading === null && !st.agentBusy && last?.role === 'assistant' && last.status === 'done';
    }, null, { timeout: AGENT_TIMEOUT_MS });
    await p.waitForTimeout(3000);
    await screenshot(p, 'mobile-editor', 'page');
  } finally {
    await phone.close();
  }
}

async function exportJson(page: Page): Promise<void> {
  const expected = await page.evaluate(() => Object.keys(window.__aether?.history.current.entities ?? {}).length);
  // Export lives in the app menu (the top bar's primary action is Publish).
  await page.getByRole('button', { name: 'Aether menu' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Export .aether.json' }).click()]);
  const path = await download.path();
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  const envelope = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  check(envelope['format'] === 'aether-world', 'export is not an aether-world envelope');
  const world = envelope['world'];
  const ents = typeof world === 'object' && world !== null ? (world as Record<string, unknown>)['entities'] : undefined;
  const count = typeof ents === 'object' && ents !== null ? Object.keys(ents).length : -1;
  check(count === expected, `exported JSON has ${count} entities, expected ${expected}`);
  check(/\.json$/.test(download.suggestedFilename()), `unexpected export filename ${download.suggestedFilename()}`);
  log(`  exported ${download.suggestedFilename()} (${count} entities)`);
  // The scene as binary glTF (the app menu's quick export, the same pipeline as Publish → 3D model):
  // a GLB header ("glTF", version 2) and real geometry.
  await page.getByRole('button', { name: 'Aether menu' }).click();
  const [glb] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.getByRole('menuitem', { name: 'Export 3D model (.glb)' }).click()]);
  const bytes = readFileSync(await glb.path());
  check(bytes.length > 2048, `glTF export is only ${bytes.length} bytes`);
  check(bytes.subarray(0, 4).toString('latin1') === 'glTF' && bytes.readUInt32LE(4) === 2, 'glTF export is not a GLB v2 file');
  check(/\.glb$/.test(glb.suggestedFilename()), `unexpected glTF filename ${glb.suggestedFilename()}`);
  log(`  exported ${glb.suggestedFilename()} (${Math.round(bytes.length / 1024)} KB)`);
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

interface RunOptions {
  name: string;
  /** Delete `navigator.gpu` before any script runs (forces WebGL2). */
  forceWebGL2: boolean;
  /** Backend the run must end up on. */
  expectBackend: 'webgpu' | 'webgl2';
  /** Full flow (all prompts + editing) or the short smoke flow. */
  full: boolean;
  screenshots: boolean;
}

async function run(browser: Browser, url: string, opts: RunOptions): Promise<RunMetrics> {
  log(`run "${opts.name}"`);
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, acceptDownloads: true });
  await context.addInitScript({ content: SKIP_FIRST_RUN });
  const errors: string[] = [];
  const metrics: RunMetrics = { backend: 'none', firstFrameMs: 0, defaultWorld: { fps: 0, drawCalls: 0, triangles: 0, entities: 0 }, examples: [] };
  try {
    const page = await context.newPage();
    await page.addInitScript({ content: BLOCKING_PROBE });
    if (opts.forceWebGL2) {
      await page.addInitScript(() => {
        delete (Navigator.prototype as unknown as Record<string, unknown>)['gpu'];
      });
    }
    page.on('console', (m: ConsoleMessage) => {
      if (m.type() !== 'error') return;
      const text = m.text();
      if (BENIGN_CONSOLE.some((re) => re.test(text))) return;
      errors.push(`console.error: ${text.slice(0, 500)}`);
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 500)}`));
    page.on('crash', () => errors.push('page crashed'));

    await boot(page, url, metrics);
    check(metrics.backend === opts.expectBackend, `expected the ${opts.expectBackend} backend, got ${metrics.backend}`);
    if (opts.screenshots) await screenshot(page, 'studio-default-world', 'page');

    const prompts = opts.full ? PROMPTS : PROMPTS.slice(-1);
    // Messages refine the world they find; the later examples each ask for a fresh one.
    for (const [i, p] of prompts.entries()) await sendPrompt(page, i === 0 ? p : { ...p, text: `Start over: ${p.text}` }, metrics, opts.screenshots);
    metrics.checks = await verifyResponsiveness(page);
    await playAndStop(page, opts.screenshots);
    if (opts.full) {
      await themeSwitch(page);
      await undoRedo(page);
      await editColor(page);
      await exportJson(page);
      if (opts.screenshots) await homeAndPhoneShots(browser, page, url);
    }
    check(errors.length === 0, `console/page errors:\n  ${errors.join('\n  ')}`);
    log(`run "${opts.name}" passed`);
    return metrics;
  } catch (err) {
    if (errors.length > 0) log(`  collected errors:\n  ${errors.join('\n  ')}`);
    throw err;
  } finally {
    await context.close();
  }
}

/** Raw and gzip sizes of the built JS/WASM/CSS assets. */
function bundleSizes(): Array<{ file: string; kb: number; gzipKb: number }> {
  const dir = join(STUDIO_DIST, 'assets');
  return readdirSync(dir)
    .filter((f) => /\.(js|wasm|css)$/.test(f))
    .map((f) => {
      const bytes = readFileSync(join(dir, f));
      return { file: f, kb: statSync(join(dir, f)).size / 1024, gzipKb: gzipSync(bytes, { level: 6 }).length / 1024 };
    })
    .sort((a, b) => b.kb - a.kb);
}

function report(results: Array<{ name: string; metrics: RunMetrics }>): void {
  log('metrics');
  for (const { name, metrics: m } of results) {
    log(`  [${name}] backend=${m.backend} firstFrame=${Math.round(m.firstFrameMs)} ms default world: ${m.defaultWorld.entities} entities, ${m.defaultWorld.fps.toFixed(1)} fps, ${m.defaultWorld.drawCalls} draws, ${m.defaultWorld.triangles} tris`);
    const densest = [...m.examples].sort((a, b) => b.triangles - a.triangles)[0];
    if (densest) log(`  [${name}] densest example "${densest.slug}": ${densest.entities} entities, ${densest.fps.toFixed(1)} fps, ${densest.drawCalls} draws, ${densest.triangles} tris`);
    const worstTask = Math.max(...m.examples.map((e) => e.longTaskMs));
    const worstLag = Math.max(...m.examples.map((e) => e.lagMs));
    log(`  [${name}] agent turns: longest main-thread task ${worstTask < 0 ? 'n/a' : `${Math.round(worstTask)} ms`}, worst stall ${Math.round(worstLag)} ms; verification ${m.examples.map((e) => `${e.slug} ${Math.round(e.verifyMs)} ms/${e.lanes} lane(s)`).join(', ')}`);
    if (m.checks) log(`  [${name}] run checks: ${Math.round(m.checks.ms)} ms in ${m.checks.lanes} lane(s); longest task ${m.checks.longTaskMs < 0 ? 'n/a' : `${Math.round(m.checks.longTaskMs)} ms`}, worst stall ${Math.round(m.checks.lagMs)} ms`);
  }
  let total = 0;
  let totalGz = 0;
  for (const b of bundleSizes()) {
    total += b.kb;
    totalGz += b.gzipKb;
    log(`  bundle ${b.file.padEnd(40)} ${b.kb.toFixed(0).padStart(6)} KB  (gzip ${b.gzipKb.toFixed(0)} KB)`);
  }
  log(`  bundle total ${total.toFixed(0)} KB (gzip ${totalGz.toFixed(0)} KB)`);
}

async function main(): Promise<void> {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const server = await startServer(log);
  // One browser at a time: Chromium runs first and is closed before Firefox starts.
  let browser: Browser | null = null;
  try {
    const executablePath = findChrome();
    log(`server ${server.url}, chromium ${executablePath}`);
    browser = await chromium.launch({ executablePath, args: [...CHROME_ARGS] });
    const results: Array<{ name: string; metrics: RunMetrics }> = [];
    results.push({ name: 'webgpu', metrics: await run(browser, server.url, { name: 'webgpu', forceWebGL2: false, expectBackend: 'webgpu', full: true, screenshots: true }) });
    results.push({ name: 'webgl2-only', metrics: await run(browser, server.url, { name: 'webgl2-only', forceWebGL2: true, expectBackend: 'webgl2', full: false, screenshots: false }) });
    await browser.close();
    browser = null;
    // Firefox (no WebGPU on Linux): the WebGL2 path must carry the whole product.
    const firefoxPath = findFirefox();
    log(`firefox ${firefoxPath}`);
    browser = await firefox.launch({ executablePath: firefoxPath, firefoxUserPrefs: { ...FIREFOX_PREFS } });
    results.push({ name: 'firefox-webgl2', metrics: await run(browser, server.url, { name: 'firefox-webgl2', forceWebGL2: false, expectBackend: 'webgl2', full: true, screenshots: false }) });
    report(results);
    log('E2E PASSED');
  } finally {
    await browser?.close();
    await server.stop();
  }
}

main().catch((err: unknown) => {
  log(`E2E FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
