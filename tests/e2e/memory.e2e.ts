/**
 * Memory regression run of the built studio in Chromium (WebGPU) and then
 * Firefox (WebGL2), one browser at a time. It asserts the studio's memory
 * budgets and that nothing grows with use:
 *
 *  1. boot on the starter world, stay idle (default 35 s; set
 *     `AETHER_MEM_IDLE_S=120` for a 2-minute soak) and check that an idle
 *     editor stops drawing frames even though the world has animated weather;
 *  2. budgets on the starter world: JS heap < 250 MB (Chromium reports it,
 *     after a forced GC) and tab process < 800 MB (PSS, both browsers);
 *  3. warm up (4 agent runs + 4 play/stop), reload the starter world and take
 *     a baseline; then 20 agent runs + 20 play/stop cycles, reload the
 *     starter world again and compare: three.js geometry/texture counts must
 *     be identical, history and chat stay within their caps, and heap / tab
 *     memory must not grow beyond noise;
 *  4. low-memory mode turns on automatically when the device reports ≤ 4 GB
 *     (`navigator.deviceMemory` is stubbed) and is visible in the top bar;
 *  5. a lost WebGL context (WEBGL_lose_context) is recovered with a fresh
 *     renderer that draws again.
 *
 * Process memory is the proportional set size of the browser's processes
 * (`/proc/<pid>/smaps_rollup`), sampled from the test. Any console error
 * fails the run.
 *
 * Run: `npm run build && npm run e2e:memory`.
 */
import { chromium, firefox, type Browser, type BrowserContext, type ConsoleMessage, type Page } from 'playwright';
import { decodePng, pixelStats } from './support/png';
import { CHROME_ARGS, FIREFOX_PREFS, findChrome, findFirefox, startServer } from './support/env';
import { sampleBrowserMemory } from './support/procmem';

const VIEWPORT = { width: 1440, height: 900 };
const BOOT_TIMEOUT_MS = 90_000;
const AGENT_TIMEOUT_MS = 120_000;
const IDLE_S = clampInt(process.env['AETHER_MEM_IDLE_S'], 35, 33, 600);
const CYCLES = clampInt(process.env['AETHER_MEM_CYCLES'], 20, 1, 100);
const WARMUP = 4;

/** Budgets (MB). */
const HEAP_BUDGET_MB = 250;
const TAB_BUDGET_MB = 800;
/** Allowed growth between the warm baseline and the end of the cycles (MB): GC timing noise, not leaks. */
const HEAP_GROWTH_MB = 40;
const TAB_GROWTH_MB = 160;

const PROMPTS: readonly string[] = [
  'A cozy lakeside camp at sunset with a campfire, tents and fireflies',
  'Build a domino run that knocks over a bell tower',
  'Bowling alley: knock down a pyramid of 15 crates with a heavy ball',
  'A coin collecting game on a tropical island — collect 10 coins in 60 seconds',
];

const BENIGN_CONSOLE: readonly RegExp[] = [/GL Driver Message/i, /GPU stall due to ReadPixels/i, /valid external Instance reference no longer exists/i, /^WebGL warning:/i, /WebGL context was lost/i];

function clampInt(raw: string | undefined, def: number, min: number, max: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : def;
}

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

async function waitFor<T>(page: Page, what: string, timeoutMs: number, probe: () => Promise<T | null | undefined | false>): Promise<T> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const v = await probe();
    if (v !== null && v !== undefined && v !== false) return v;
    await page.waitForTimeout(250);
  }
  throw new E2EFailure(`timed out after ${timeoutMs} ms waiting for ${what}`);
}

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

interface PageMemory {
  ready: boolean;
  fatal: string | null;
  backend: string | null;
  heapMB: number | null;
  geometries: number;
  textures: number;
  cachedGeometries: number;
  materials: number;
  frames: number;
  historyEntries: number;
  historyLimit: number;
  chatEntries: number;
  lowMemory: boolean;
  lowMemoryReason: string | null;
  epoch: number;
  pixelRatio: number;
  post: boolean;
  shadowMapSize: number;
  estimatedGpuMB: number;
  gpuTier: string;
}

function pageMemory(page: Page): Promise<PageMemory | null> {
  return page.evaluate((): PageMemory | null => {
    const a = window.__aether;
    if (!a) return null;
    (window as unknown as { gc?: () => void }).gc?.();
    const st = a.store.getState();
    const rep = a.studio.memoryReport();
    const r = rep.renderer;
    return {
      ready: a.simulation !== null && st.loading === null,
      fatal: st.fatal,
      backend: st.backend,
      heapMB: rep.heapMB,
      geometries: r?.geometries ?? -1,
      textures: r?.textures ?? -1,
      cachedGeometries: r?.cachedGeometries ?? -1,
      materials: r?.materials ?? -1,
      frames: a.simulation?.renderer.frameCount ?? -1,
      historyEntries: rep.historyEntries,
      historyLimit: rep.historyLimit,
      chatEntries: rep.chatEntries,
      lowMemory: rep.memory.lowMemory,
      lowMemoryReason: rep.memory.reason,
      epoch: rep.rendererEpoch,
      pixelRatio: r?.pixelRatio ?? 0,
      post: r?.post ?? false,
      shadowMapSize: r?.shadowMapSize ?? 0,
      estimatedGpuMB: r?.estimatedGpuMB ?? 0,
      gpuTier: r?.gpuTier ?? 'none',
    };
  });
}

async function mem(page: Page): Promise<PageMemory> {
  const m = await pageMemory(page);
  check(m, 'window.__aether debug handle is missing');
  return m;
}

/** Process + page memory; the minimum of a few samples (filters out GC timing). */
async function settledSample(page: Page, samples = 3): Promise<{ tabMb: number; totalMb: number; heapMB: number | null }> {
  let tabMb = Number.POSITIVE_INFINITY;
  let totalMb = Number.POSITIVE_INFINITY;
  let heapMB: number | null = null;
  for (let i = 0; i < samples; i++) {
    await page.waitForTimeout(1500);
    const p = sampleBrowserMemory();
    const m = await mem(page);
    tabMb = Math.min(tabMb, p.tabMb);
    totalMb = Math.min(totalMb, p.totalMb);
    if (m.heapMB !== null) heapMB = heapMB === null ? m.heapMB : Math.min(heapMB, m.heapMB);
  }
  return { tabMb, totalMb, heapMB };
}

async function waitReady(page: Page, what: string): Promise<PageMemory> {
  return waitFor(page, what, BOOT_TIMEOUT_MS, async () => {
    const m = await pageMemory(page);
    if (m?.fatal) throw new E2EFailure(`renderer failed: ${m.fatal}`);
    return m && m.ready ? m : null;
  });
}

async function assertCanvasRendered(page: Page, label: string): Promise<void> {
  const png = await page.locator('.viewport__host canvas').screenshot();
  const stats = pixelStats(decodePng(png));
  check(stats.stdDev >= 6 && stats.distinctColors >= 24, `canvas looks blank after ${label} (stddev ${stats.stdDev.toFixed(1)}, ${stats.distinctColors} colours)`);
}

async function agentRun(page: Page, prompt: string): Promise<void> {
  const ok = await page.evaluate(async (text) => {
    const a = window.__aether;
    if (!a) return 'no handle';
    await a.studio.send(text);
    const chat = a.store.getState().chat;
    const last = chat[chat.length - 1];
    return last && last.role === 'assistant' ? last.status : 'no reply';
  }, prompt);
  check(ok === 'done', `agent turn for "${prompt.slice(0, 40)}" ended with ${ok}`);
}

async function playStop(page: Page): Promise<void> {
  await page.evaluate(() => window.__aether?.studio.togglePlay());
  await waitFor(page, 'play mode', 30_000, () => page.evaluate(() => window.__aether?.store.getState().mode === 'play' && !window.__aether.store.getState().modeBusy));
  await page.waitForTimeout(700);
  await page.evaluate(() => window.__aether?.studio.togglePlay());
  await waitFor(page, 'edit mode', 30_000, () => page.evaluate(() => window.__aether?.store.getState().mode === 'edit' && !window.__aether.store.getState().modeBusy));
}

/** Wait until `n` more frames were drawn (software GPUs in CI draw only a few frames per second). */
async function drawFrames(page: Page, n: number): Promise<void> {
  const f0 = (await mem(page)).frames;
  await waitFor(page, `${n} frames`, 60_000, async () => {
    await page.evaluate(() => window.__aether?.simulation?.renderer.requestRender());
    return (await mem(page)).frames >= f0 + n ? true : null;
  });
}

async function loadStarter(page: Page): Promise<PageMemory> {
  await page.evaluate(() => window.__aether?.studio.resetToStarter());
  await page.evaluate(() => window.__aether?.simulation?.whenSynced());
  // Let the camera flight and grow-in finish, then draw a few frames so everything visible is uploaded.
  await page.waitForTimeout(2500);
  await drawFrames(page, 3);
  return mem(page);
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

interface Report {
  name: string;
  backend: string;
  gpuTier: string;
  idle: { tabMb: number; totalMb: number; heapMB: number | null; estimatedGpuMB: number; idleFrames: number };
  warm: { tabMb: number; heapMB: number | null; geometries: number; textures: number };
  end: { tabMb: number; heapMB: number | null; geometries: number; textures: number; historyEntries: number; chatEntries: number };

  lowMemory: { reason: string | null; pixelRatio: number; post: boolean; shadowMapSize: number; estimatedGpuMB: number };
  recovered: boolean;
}

async function newPage(browser: Browser, errors: string[], init?: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await context.newPage();
  if (init) await page.addInitScript({ content: init });
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (!BENIGN_CONSOLE.some((re) => re.test(text))) errors.push(`console.error: ${text.slice(0, 400)}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 400)}`));
  page.on('crash', () => errors.push('page crashed'));
  return { context, page };
}

/** Lose the viewport's WebGL context and wait for the studio to bring up a new renderer. */
async function loseAndRecover(page: Page): Promise<void> {
  const before = await mem(page);
  const lost = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.viewport__host canvas');
    const gl = canvas?.getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_lose_context');
    if (!ext) return false;
    ext.loseContext();
    return true;
  });
  check(lost, 'WEBGL_lose_context unavailable');
  const after = await waitFor(page, 'renderer recovery', BOOT_TIMEOUT_MS, async () => {
    const m = await pageMemory(page);
    if (m?.fatal) throw new E2EFailure(`recovery failed: ${m.fatal}`);
    return m && m.ready && m.epoch > before.epoch ? m : null;
  });
  const f0 = after.frames;
  await page.evaluate(() => window.__aether?.simulation?.renderer.requestRender());
  await waitFor(page, 'frames after recovery', 15_000, async () => ((await mem(page)).frames > f0 ? true : null));
  await assertCanvasRendered(page, 'context-loss recovery');
  check(after.lowMemory, 'a lost context should turn automatic low-memory mode on');
  log(`  context loss recovered: epoch ${before.epoch} → ${after.epoch}, backend ${after.backend}, low memory "${after.lowMemoryReason ?? ''}"`);
}

async function run(browser: Browser, url: string, name: string, expectBackend: string, webglLossTest: boolean): Promise<Report> {
  log(`run "${name}"`);
  const errors: string[] = [];
  const { context, page } = await newPage(browser, errors);
  try {
    await page.goto(`${url}/?debug=1#/new`, { waitUntil: 'domcontentloaded' });
    const booted = await waitReady(page, 'first frame');
    check(booted.backend === expectBackend, `expected ${expectBackend}, got ${booted.backend}`);
    check(!booted.lowMemory, 'low-memory mode should be off on this machine');
    await assertCanvasRendered(page, 'boot');

    // 1. Idle soak. The starter world has animated fireflies: frames must stop once the editor is idle.
    log(`  idle ${IDLE_S} s on the starter world…`);
    await page.waitForTimeout((IDLE_S - 3) * 1000);
    const f0 = (await mem(page)).frames;
    await page.waitForTimeout(3000);
    const idleFrames = (await mem(page)).frames - f0;
    check(idleFrames <= 3, `an idle editor kept drawing (${idleFrames} frames in 3 s)`);
    const idle = await settledSample(page);
    const idleMem = await mem(page);
    log(`  idle: tab ${idle.tabMb.toFixed(0)} MB, browser ${idle.totalMb.toFixed(0)} MB, heap ${idle.heapMB ?? 'n/a'} MB, est. GPU ${idleMem.estimatedGpuMB} MB, ${idleFrames} frames in 3 s`);
    if (idle.heapMB !== null) check(idle.heapMB < HEAP_BUDGET_MB, `JS heap ${idle.heapMB} MB exceeds ${HEAP_BUDGET_MB} MB`);
    check(idle.tabMb > 0 && idle.tabMb < TAB_BUDGET_MB, `tab process ${idle.tabMb.toFixed(0)} MB exceeds ${TAB_BUDGET_MB} MB`);

    // 2. Warm-up, then the baseline on a freshly loaded starter world.
    for (let i = 0; i < WARMUP; i++) {
      await agentRun(page, PROMPTS[i % PROMPTS.length] as string);
      await playStop(page);
    }
    const warmMem = await loadStarter(page);
    const warm = await settledSample(page);
    log(`  warm baseline: tab ${warm.tabMb.toFixed(0)} MB, heap ${warm.heapMB ?? 'n/a'} MB, ${warmMem.geometries} GPU geometries (${warmMem.cachedGeometries} cached), ${warmMem.textures} textures, ${warmMem.materials} materials`);

    // 3. Cycles.
    for (let i = 0; i < CYCLES; i++) {
      await agentRun(page, PROMPTS[i % PROMPTS.length] as string);
      await playStop(page);
      if ((i + 1) % 5 === 0) {
        const p = sampleBrowserMemory();
        const m = await mem(page);
        log(`  cycle ${i + 1}/${CYCLES}: tab ${p.tabMb.toFixed(0)} MB, browser ${p.totalMb.toFixed(0)} MB, heap ${m.heapMB ?? 'n/a'} MB, history ${m.historyEntries}/${m.historyLimit}, chat ${m.chatEntries}`);
        check(p.tabMb < TAB_BUDGET_MB, `tab process ${p.tabMb.toFixed(0)} MB exceeds ${TAB_BUDGET_MB} MB during cycles`);
      }
    }
    const endMem = await loadStarter(page);
    // More samples at the end: Firefox collects garbage lazily (no forced GC from a page).
    const end = await settledSample(page, 6);
    log(`  end: tab ${end.tabMb.toFixed(0)} MB, heap ${end.heapMB ?? 'n/a'} MB, ${endMem.geometries} GPU geometries (${endMem.cachedGeometries} cached), ${endMem.textures} textures, ${endMem.materials} materials, history ${endMem.historyEntries}, chat ${endMem.chatEntries}`);
    // Same world, same resources: the reference-counted caches must be back to exactly the baseline.
    check(endMem.cachedGeometries === warmMem.cachedGeometries, `cached geometries leaked: ${warmMem.cachedGeometries} → ${endMem.cachedGeometries}`);
    check(endMem.materials === warmMem.materials, `materials leaked: ${warmMem.materials} → ${endMem.materials}`);
    check(endMem.textures === warmMem.textures, `textures leaked: ${warmMem.textures} → ${endMem.textures}`);
    // three counts a geometry once it was drawn, so the camera path adds a little noise; growth means a leak.
    check(endMem.geometries <= warmMem.geometries + 4, `GPU geometries leaked: ${warmMem.geometries} → ${endMem.geometries}`);
    check(endMem.historyEntries <= endMem.historyLimit + 1, `history holds ${endMem.historyEntries} entries (limit ${endMem.historyLimit})`);
    check(endMem.chatEntries <= 120, `chat holds ${endMem.chatEntries} entries`);
    if (end.heapMB !== null && warm.heapMB !== null) {
      check(end.heapMB < HEAP_BUDGET_MB, `JS heap ${end.heapMB} MB exceeds ${HEAP_BUDGET_MB} MB`);
      check(end.heapMB - warm.heapMB <= HEAP_GROWTH_MB, `JS heap grew ${warm.heapMB} → ${end.heapMB} MB over ${CYCLES} cycles`);
    }
    check(end.tabMb < TAB_BUDGET_MB, `tab process ${end.tabMb.toFixed(0)} MB exceeds ${TAB_BUDGET_MB} MB`);
    check(end.tabMb - warm.tabMb <= TAB_GROWTH_MB, `tab process grew ${warm.tabMb.toFixed(0)} → ${end.tabMb.toFixed(0)} MB over ${CYCLES} cycles`);

    // 4. Context-loss recovery (WebGL2 runs).
    let recovered = false;
    if (webglLossTest) {
      await loseAndRecover(page);
      recovered = true;
    }
    check(errors.length === 0, `console/page errors:\n  ${errors.join('\n  ')}`);
    await context.close();

    // 5. Automatic low-memory mode on a small device.
    const low = await lowMemoryRun(browser, url);
    log(`run "${name}" passed`);
    return {
      name,
      backend: booted.backend ?? 'none',
      gpuTier: booted.gpuTier,
      idle: { tabMb: idle.tabMb, totalMb: idle.totalMb, heapMB: idle.heapMB, estimatedGpuMB: idleMem.estimatedGpuMB, idleFrames },
      warm: { tabMb: warm.tabMb, heapMB: warm.heapMB, geometries: warmMem.geometries, textures: warmMem.textures },
      end: { tabMb: end.tabMb, heapMB: end.heapMB, geometries: endMem.geometries, textures: endMem.textures, historyEntries: endMem.historyEntries, chatEntries: endMem.chatEntries },
      lowMemory: low,
      recovered,
    };
  } catch (err) {
    if (errors.length > 0) log(`  collected errors:\n  ${errors.join('\n  ')}`);
    throw err;
  } finally {
    await context.close().catch(() => undefined);
  }
}

/** Boot with `navigator.deviceMemory = 2`: low-memory mode must turn on by itself and be visible. */
async function lowMemoryRun(browser: Browser, url: string): Promise<Report['lowMemory']> {
  const errors: string[] = [];
  const stub = `Object.defineProperty(Navigator.prototype, 'deviceMemory', { configurable: true, get: () => 2 });`;
  const { context, page } = await newPage(browser, errors, stub);
  try {
    await page.goto(`${url}/?debug=1#/new`, { waitUntil: 'domcontentloaded' });
    const m = await waitReady(page, 'first frame (low memory)');
    check(m.lowMemory, 'low-memory mode did not turn on for a 2 GB device');
    check(m.historyLimit <= 40, `low-memory history limit is ${m.historyLimit}`);
    check(m.pixelRatio <= 1 && !m.post && m.shadowMapSize <= 1024, `low-memory budget not applied (ratio ${m.pixelRatio}, post ${m.post}, shadow ${m.shadowMapSize})`);
    check(await page.getByRole('button', { name: 'Low memory' }).isVisible(), 'the Low memory badge is not visible');
    await assertCanvasRendered(page, 'low-memory boot');
    check(errors.length === 0, `console/page errors (low memory):\n  ${errors.join('\n  ')}`);
    log(`  low memory: "${m.lowMemoryReason ?? ''}", ratio ${m.pixelRatio}, post ${m.post}, shadow ${m.shadowMapSize}, est. GPU ${m.estimatedGpuMB} MB`);
    return { reason: m.lowMemoryReason, pixelRatio: m.pixelRatio, post: m.post, shadowMapSize: m.shadowMapSize, estimatedGpuMB: m.estimatedGpuMB };
  } finally {
    await context.close();
  }
}

/** Chromium with the renderer forced to WebGL2 through the setting: the context-loss recovery path. */
async function chromiumWebglRecovery(browser: Browser, url: string): Promise<void> {
  log('run "chromium-webgl2-recovery"');
  const errors: string[] = [];
  const init = `try { localStorage.setItem('aether.studio.settings.v1', JSON.stringify({ backend: 'webgl2' })); } catch {}`;
  const { context, page } = await newPage(browser, errors, init);
  try {
    await page.goto(`${url}/?debug=1#/new`, { waitUntil: 'domcontentloaded' });
    const m = await waitReady(page, 'first frame (forced WebGL2)');
    check(m.backend === 'webgl2', `the backend setting did not force WebGL2 (got ${m.backend})`);
    await loseAndRecover(page);
    check(errors.length === 0, `console/page errors:\n  ${errors.join('\n  ')}`);
    log('run "chromium-webgl2-recovery" passed');
  } finally {
    await context.close();
  }
}

function report(results: Report[]): void {
  log('memory report');
  for (const r of results) {
    log(`  [${r.name}] ${r.backend}, ${r.gpuTier} GPU`);
    log(`    idle starter: tab ${r.idle.tabMb.toFixed(0)} MB, browser ${r.idle.totalMb.toFixed(0)} MB, heap ${r.idle.heapMB ?? 'n/a'} MB, est. GPU buffers ${r.idle.estimatedGpuMB} MB, ${r.idle.idleFrames} idle frames / 3 s`);
    log(`    ${CYCLES} cycles: tab ${r.warm.tabMb.toFixed(0)} → ${r.end.tabMb.toFixed(0)} MB, heap ${r.warm.heapMB ?? 'n/a'} → ${r.end.heapMB ?? 'n/a'} MB, geometries ${r.warm.geometries} → ${r.end.geometries}, textures ${r.warm.textures} → ${r.end.textures}`);
    log(`    low memory: ratio ${r.lowMemory.pixelRatio}, post ${r.lowMemory.post}, shadow ${r.lowMemory.shadowMapSize}, est. GPU buffers ${r.lowMemory.estimatedGpuMB} MB${r.recovered ? '; context loss recovered' : ''}`);
  }
}

async function main(): Promise<void> {
  const server = await startServer(log);
  let browser: Browser | null = null;
  const results: Report[] = [];
  try {
    browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS, '--js-flags=--expose-gc'] });
    results.push(await run(browser, server.url, 'chromium-webgpu', 'webgpu', false));
    await chromiumWebglRecovery(browser, server.url);
    await browser.close();
    browser = null;
    browser = await firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } });
    results.push(await run(browser, server.url, 'firefox-webgl2', 'webgl2', true));
    report(results);
    log('MEMORY E2E PASSED');
  } finally {
    await browser?.close();
    await server.stop();
  }
}

main().catch((err: unknown) => {
  log(`MEMORY E2E FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
