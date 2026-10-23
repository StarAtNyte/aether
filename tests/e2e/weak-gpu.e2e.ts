/**
 * Opening a world on a weak machine: the viewport must show pixels, soon.
 *
 * Opens each world in headless Chromium on forced weak settings (WebGL2 only, 4 cores, 4 GB, CPU throttled, the
 * integrated GPU or the software rasteriser) and, at 5, 15, 30 and 60 s (or `--at=`), screenshots the viewport,
 * reads the canvas back and records console errors, page errors and the renderer's diagnostics. It fails if the
 * viewport is still uniformly dark/flat at the last sample, or the first frame took longer than `--first-frame`.
 *
 * Chromium only, closed in `finally`. Target: the local production build (default), or `--url=http://host:port`
 * (a running dev server: `vite --port N`; nothing here starts or stops it).
 *
 * Run: `npm run build && npm run e2e:weak -- [--worlds=highland-trail,casa-patio] [--throttle=4]
 * [--gpu=intel|software] [--at=5,15,30,60] [--url=…] [--first-frame=30] [--shots=dir] [--cores=4] [--mem=4]
 * [--browser=firefox] [--spoof-gpu] [--net=150:4000] [--delay=regex::ms] [--force-black] [--no-black] [--no-fail]`.
 * Without --url it also runs the watchdog check (the read-back comes back empty: the renderer must step down, say so
 * with a Safe mode switch, log why and offer diagnostics).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, firefox, type Page } from 'playwright';
import { decodePng, pixelStats } from './support/png';
import { FIREFOX_PREFS, SKIP_FIRST_RUN, findChrome, findFirefox, startServer } from './support/env';

const ARGS = process.argv.slice(2);
const arg = (name: string): string | undefined => ARGS.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const WORLDS = (arg('worlds') ?? 'highland-trail').split(',').filter(Boolean);
const THROTTLE = Number(arg('throttle') ?? 4);
const GPU = arg('gpu') ?? 'software';
const AT = (arg('at') ?? '5,15,30,60').split(',').map(Number);
const FIRST_FRAME_S = Number(arg('first-frame') ?? 45);
const SHOTS = arg('shots');
const CORES = Number(arg('cores') ?? 4);
const MEM = Number(arg('mem') ?? 4);
const URL_ARG = arg('url');
const FIREFOX = arg('browser') === 'firefox';
/** `--net=150:4000`: latency (ms) and downlink (kbit/s), a slow link to a tunnelled dev server. */
const NET = arg('net')?.split(':').map(Number);
/** `--spoof-gpu`: report an integrated Intel GPU instead of the software rasteriser (selects the real-GPU load path on software GL). */
const SPOOF = ARGS.includes('--spoof-gpu');
/** `--delay=regex:ms`: hold every matching request that long (a stalled asset, a worker script over a slow tunnel). */
const DELAY = arg('delay')?.split('::');
const NO_FAIL = ARGS.includes('--no-fail');

const t0 = performance.now();
const log = (line: string): void => void process.stdout.write(`[${((performance.now() - t0) / 1000).toFixed(1).padStart(6)}s] ${line}\n`);

const GPU_ARGS: Record<string, string[]> = {
  intel: ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'],
  software: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
};

interface Sample {
  at: number;
  mean: number;
  stdDev: number;
  colors: number;
}

async function sampleViewport(page: Page): Promise<Sample & { png: Buffer }> {
  const loc = page.locator('.viewport__host canvas').first();
  const box = await loc.boundingBox().catch(() => null);
  const png = box && box.width > 0 ? await page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: box.height }, timeout: 60_000 }) : await page.screenshot({ timeout: 60_000 });
  const s = pixelStats(decodePng(png));
  return { at: 0, mean: s.mean, stdDev: s.stdDev, colors: s.distinctColors, png };
}

async function runWorld(base: string, world: string): Promise<boolean> {
  const browser = FIREFOX
    ? await firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } })
    : await chromium.launch({ executablePath: findChrome(), args: [...(GPU_ARGS[GPU] ?? []), '--disable-gpu-vsync'] });
  const problems: string[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await context.addInitScript({ content: SKIP_FIRST_RUN });
    await context.addInitScript({ content: 'globalThis.__name = (f) => f;' });
    // WebGL2 only (no WebGPU), a weak machine.
    await context.addInitScript({
      content: `delete Navigator.prototype.gpu; try { delete navigator.gpu; } catch {}
        Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => ${CORES}, configurable: true });
        Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => ${MEM}, configurable: true });
        window.__firstPaintAt = 0;`,
    });
    const page = await context.newPage();
    if (THROTTLE > 1 && !FIREFOX) await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
    if (SPOOF) {
      await context.addInitScript({
        content: `{ const g = WebGL2RenderingContext.prototype.getParameter; WebGL2RenderingContext.prototype.getParameter = function (p) { if (p === 0x9246 || p === 0x1F01) return 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)'; if (p === 0x9245) return 'Google Inc. (Intel)'; return g.call(this, p); }; }`,
      });
    }
    if (NET && !FIREFOX) {
      const c = await context.newCDPSession(page);
      await c.send('Network.enable');
      await c.send('Network.emulateNetworkConditions', { offline: false, latency: NET[0] ?? 100, downloadThroughput: ((NET[1] ?? 4000) * 1000) / 8, uploadThroughput: ((NET[1] ?? 4000) * 1000) / 8 });
    }
    if (DELAY) {
      const re = new RegExp(DELAY[0] ?? '$^');
      const ms = Number(DELAY[1] ?? 30_000);
      await page.route(re, async (route) => {
        await new Promise((r) => setTimeout(r, ms));
        await route.continue().catch(() => undefined);
      });
    }
    const start = performance.now();
    const sec = (): string => ((performance.now() - start) / 1000).toFixed(1);
    const out: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning' || /aether|diagnos|watchdog|safe mode|tier|compile|link/i.test(m.text())) out.push(`${sec()}s [${m.type()}] ${m.text().slice(0, 300)}`);
    });
    page.on('pageerror', (e) => out.push(`${sec()}s [pageerror] ${e.message.slice(0, 300)}`));
    page.on('crash', () => out.push(`${sec()}s [CRASH]`));
    await page.goto(`${base}/?debug=1#/new/${world}`, { waitUntil: 'domcontentloaded' });
    let last: Sample | undefined;
    let firstFrame: number | undefined;
    for (const at of AT) {
      const wait = at * 1000 - (performance.now() - start);
      if (wait > 0) await page.waitForTimeout(wait);
      const s = await sampleViewport(page);
      s.at = at;
      last = s;
      const info = await page
        .evaluate(() => {
          const r = window.__aether?.simulation?.renderer as unknown as { renderTier?: string; autoRenderTier?: string; frames?: number; gpu?: { description: string }; stats?: () => { drawCalls: number; triangles: number } } | undefined;
          const st = window.__aether?.store.getState();
          return JSON.stringify({ tier: r?.renderTier, auto: r?.autoRenderTier, gpu: r?.gpu?.description?.slice(0, 50), loading: st?.loading ?? null, stats: r?.stats?.() });
        })
        .catch((e: unknown) => `evaluate failed: ${String(e).slice(0, 80)}`);
      log(`${world} ${GPU} ${THROTTLE}x @${at}s: mean ${s.mean.toFixed(1)} stddev ${s.stdDev.toFixed(1)} colours ${s.colors} ${info}`);
      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true });
        writeFileSync(join(SHOTS, `${world}-${GPU}-${THROTTLE}x-${at}s.png`), s.png);
      }
      if (firstFrame === undefined && s.stdDev >= 6 && s.colors >= 24) firstFrame = at;
    }
    for (const l of out.slice(0, 60)) log(`  console ${l}`);
    if (!last || last.stdDev < 6 || last.colors < 24) problems.push(`viewport still blank at ${last?.at}s (stddev ${last?.stdDev.toFixed(1)}, ${last?.colors} colours)`);
    else if (firstFrame !== undefined && firstFrame > FIRST_FRAME_S) problems.push(`first non-blank sample at ${firstFrame}s, bound ${FIRST_FRAME_S}s`);
    await context.close();
  } finally {
    await browser.close();
  }
  for (const p of problems) log(`  PROBLEM ${world}: ${p}`);
  return problems.length === 0;
}

/**
 * The watchdog itself: the read-back the watchdog takes of the drawn frame is made to come back empty (as a view that
 * drew nothing would: the canvas snapshot the sampler hands to its worker is replaced by an empty image), with short waits.
 * The renderer must step down, say so over the viewport with a Safe mode switch, log why, and offer diagnostics.
 */
async function runForcedBlack(base: string, world: string): Promise<boolean> {
  const browser = FIREFOX
    ? await firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } })
    : await chromium.launch({ executablePath: findChrome(), args: [...(GPU_ARGS[GPU] ?? []), '--disable-gpu-vsync'] });
  const problems: string[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await context.addInitScript({ content: SKIP_FIRST_RUN });
    await context.addInitScript({ content: 'globalThis.__name = (f) => f; delete Navigator.prototype.gpu; window.__aetherWatchdog = { firstFrameMs: 60000, stepFrameMs: 3000, sampleEveryMs: 300, darkSamples: 2 }; { const d = CanvasRenderingContext2D.prototype.drawImage; CanvasRenderingContext2D.prototype.drawImage = function (...a) { if (this.canvas.width === 16 && this.canvas.height === 16) return; return d.apply(this, a); }; } { const c = window.createImageBitmap.bind(window); window.createImageBitmap = (src, ...a) => (src instanceof HTMLCanvasElement ? c(new ImageData(16, 16)) : c(src, ...a)); }' });
    const page = await context.newPage();
    const logs: string[] = [];
    page.on('console', (m) => void logs.push(m.text()));
    await page.goto(`${base}/?debug=1#/new/${world}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__aether?.store.getState().loading === null && (window.__aether?.simulation?.renderer.frameCount ?? 0) > 3, null, { timeout: 120_000, polling: 250 });
    const before = await page.evaluate(() => (window.__aether?.simulation?.renderer.renderTier ?? '') as string);
    const alert = page.locator('[data-testid="graphics-alert"]');
    await alert.waitFor({ state: 'visible', timeout: 60_000 }).catch(() => problems.push('no graphics alert after the view went black'));
    if (await alert.isVisible()) {
      const said = await alert.locator('.vp-gfx__text').innerText();
      log(`alert: ${said.slice(0, 200)}`);
      if (!/black/.test(said)) problems.push(`the alert does not say the picture was black: ${said.slice(0, 80)}`);
      const safe = alert.getByLabel('Safe mode');
      if (!(await safe.isVisible())) problems.push('no Safe mode toggle');
      await safe.check();
      const mode = await page.evaluate(() => (window.__aether?.simulation?.renderer as unknown as { safeMode: boolean }).safeMode);
      if (!mode) problems.push('Safe mode toggle did not reach the renderer');
      await alert.getByRole('button', { name: 'Diagnostics', exact: true }).click();
      const text = await alert.locator('.vp-gfx__log').innerText();
      if (!/Aether graphics diagnostics/.test(text) || !/watchdog log/.test(text)) problems.push('diagnostics panel lacks the report or the watchdog log');
      log(`diagnostics ${text.split('\n').length} lines; tier before ${before}`);
      if (process.env['SHOW_DIAG']) log(text);
    }
    if (!logs.some((l) => /black-screen watchdog/.test(l))) problems.push('the reason was not logged to the console');
    await context.close();
  } finally {
    await browser.close();
  }
  for (const p of problems) log(`  PROBLEM forced-black ${world}: ${p}`);
  return problems.length === 0;
}

async function main(): Promise<void> {
  const server = URL_ARG ? { url: URL_ARG.replace(/\/+$/, ''), stop: async () => undefined } : await startServer(log);
  let ok = true;
  try {
    log(`target ${server.url}, gpu ${GPU}, throttle ${THROTTLE}x, ${CORES} cores, ${MEM} GB, worlds ${WORLDS.join(',')}`);
    const only = ARGS.includes('--force-black');
    if (!only) for (const w of WORLDS) ok = (await runWorld(server.url, w)) && ok;
    if (only || (!URL_ARG && !ARGS.includes('--no-black'))) ok = (await runForcedBlack(server.url, WORLDS[0] ?? 'highland-trail')) && ok;
  } finally {
    await server.stop();
  }
  log(ok ? 'WEAK GPU OK' : 'WEAK GPU FAILED');
  if (!ok && !NO_FAIL) process.exitCode = 1;
}

main().catch((e: unknown) => {
  log(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
