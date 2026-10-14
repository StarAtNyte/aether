/**
 * Visual gallery: renders every smoke prompt in a real (headless) Chromium
 * and saves one PNG per world to `docs/screenshots/gallery/`.
 *
 * One browser is launched for the whole run (WebGPU through SwiftShader, the
 * same flags as the e2e suite). Each prompt gets a fresh browser context, so
 * it starts from the starter world exactly like a first-time visitor, types
 * the prompt into the chat, waits for the agent turn and the camera framing
 * to settle, and captures the viewport. The run fails when a world does not
 * build or the canvas comes out blank.
 *
 * Run: `npm run build && npm run gallery` — or `npm run gallery -- lakeside`
 * to render only the prompts whose slug contains one of the arguments.
 * `npm run gallery -- --skies` instead renders the starter world under each
 * of the seven sky presets (`sky-<preset>.png`) to compare them side by side.
 * `--firefox` renders with Firefox (WebGL2) instead of Chromium, and
 * `--out=<dir>` writes the PNGs elsewhere (e.g. a scratch folder for a
 * Firefox/Chromium parity check).
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, firefox, type Browser, type Page } from 'playwright';
import { DEFAULT_PROMPTS } from '../../scripts/smoke-prompts';
import { decodePng, pixelStats } from './support/png';
import { CHROME_ARGS, FIREFOX_PREFS, REPO_ROOT, findChrome, findFirefox, startServer, SKIP_FIRST_RUN } from './support/env';

const VIEWPORT = { width: 1440, height: 900 };
const ARGS = process.argv.slice(2);
const OUT_ARG = ARGS.find((a) => a.startsWith('--out='));
const OUT_DIR = OUT_ARG ? resolve(OUT_ARG.slice('--out='.length)) : join(REPO_ROOT, 'docs/screenshots/gallery');
const USE_FIREFOX = ARGS.includes('--firefox');
const BOOT_TIMEOUT_MS = 60_000;
const AGENT_TIMEOUT_MS = 120_000;
/** Time for the camera fly-to and streamed generator content to settle. */
const SETTLE_MS = 2_500;
const MIN_CANVAS_STDDEV = 6;

const startedAt = performance.now();
function log(line: string): void {
  process.stdout.write(`[${((performance.now() - startedAt) / 1000).toFixed(1).padStart(6)}s] ${line}\n`);
}

/** File-name slug of a prompt ("A cozy lakeside camp…" → "a-cozy-lakeside-camp"). */
function gallerySlug(prompt: string): string {
  return prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .slice(0, 6)
    .join('-');
}

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

async function waitFor(page: Page, what: string, timeoutMs: number, ok: (p: Probe) => boolean): Promise<Probe> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const p = await probe(page);
    if (p?.fatal) throw new Error(`renderer failed: ${p.fatal}`);
    if (p && ok(p)) return p;
    await page.waitForTimeout(250);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function renderPrompt(browser: Browser, url: string, prompt: string): Promise<void> {
  const slug = gallerySlug(prompt);
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await context.addInitScript({ content: SKIP_FIRST_RUN });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${url}/?debug=1#/new`, { waitUntil: 'domcontentloaded' });
    await waitFor(page, 'boot', BOOT_TIMEOUT_MS, (p) => p.ready && p.entities > 0);
    const input = page.getByLabel('Prompt', { exact: true });
    await input.fill(prompt);
    await input.press('Enter');
    await waitFor(page, 'the agent to start', 10_000, (p) => p.busy || p.last !== null);
    const done = await waitFor(page, `the agent to finish "${slug}"`, AGENT_TIMEOUT_MS, (p) => !p.busy && p.last !== 'streaming' && p.ready);
    if (done.last !== 'done') throw new Error(`agent turn ended with ${done.last}`);
    await page.evaluate(async () => {
      await window.__aether?.simulation?.whenSynced();
    });
    await page.waitForTimeout(SETTLE_MS);
    // Slow software GPUs advance the camera flight in clamped steps: wait until it landed.
    await page.waitForFunction(() => window.__aether?.simulation?.renderer.cameraFlying === false, null, { timeout: 60_000 });
    await page.waitForTimeout(500);
    const fps = await page.evaluate(() => window.__aether?.store.getState().stats.fps ?? 0);
    const look = await page.evaluate(() => {
      const r = window.__aether?.simulation?.renderer;
      return { fog: r?.fogState?.density ?? 0, radius: r?.contentSphere?.radius ?? 0 };
    });
    await page.evaluate(() => window.__aether?.store.getState().updateSettings({ showPerf: false }));
    await page.addStyleTag({ content: '.nav-hint, .toasts, .toast, .tooltip { display: none !important; }' });
    await page.waitForTimeout(300);
    const file = join(OUT_DIR, `${slug}.png`);
    const png = await page.locator('.viewport').screenshot({ path: file });
    const stats = pixelStats(decodePng(png));
    if (stats.stdDev < MIN_CANVAS_STDDEV) throw new Error(`"${slug}" rendered a blank canvas`);
    if (errors.length > 0) throw new Error(`page errors: ${errors.join('; ')}`);
    log(`  ${slug}: ${done.entities} entities, ${await page.evaluate(() => window.__aether?.simulation?.backend ?? '?')}, ${fps} fps, fog ${look.fog.toFixed(4)} @ r ${look.radius.toFixed(1)}, mean ${stats.mean.toFixed(0)}, stddev ${stats.stdDev.toFixed(1)} → ${file}`);
  } finally {
    await context.close();
  }
}

/** Sky presets with the hour each is shown at (the preset defaults). */
const SKIES: ReadonlyArray<readonly [string, number]> = [
  ['day', 13],
  ['dawn', 6.4],
  ['sunset', 17.7],
  ['night', 23],
  ['overcast', 12],
  ['space', 10],
  ['studio', 11],
];

/** Render the starter world once per sky preset (one context, environment edits only). */
async function renderSkies(browser: Browser, url: string): Promise<void> {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await context.addInitScript({ content: SKIP_FIRST_RUN });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${url}/?debug=1#/new`, { waitUntil: 'domcontentloaded' });
    await waitFor(page, 'boot', BOOT_TIMEOUT_MS, (p) => p.ready && p.entities > 0);
    await page.waitForFunction(() => window.__aether?.simulation?.renderer.cameraFlying === false, null, { timeout: 60_000 });
    await page.evaluate(() => window.__aether?.store.getState().updateSettings({ showPerf: false }));
    await page.addStyleTag({ content: '.nav-hint, .toasts, .toast, .tooltip { display: none !important; }' });
    for (const [sky, hour] of SKIES) {
      await page.evaluate(
        ([preset, timeOfDay]) => {
          window.__aether?.studio.commitUser([{ op: 'setEnvironment', set: { sky: preset, timeOfDay } }], `Sky ${preset}`);
        },
        [sky, hour] as const,
      );
      await page.evaluate(async () => {
        await window.__aether?.simulation?.whenSynced();
      });
      await page.waitForTimeout(900);
      const file = join(OUT_DIR, `sky-${sky}.png`);
      const png = await page.locator('.viewport').screenshot({ path: file });
      const stats = pixelStats(decodePng(png));
      if (stats.stdDev < MIN_CANVAS_STDDEV) throw new Error(`sky ${sky} rendered a blank canvas`);
      log(`  sky-${sky}: mean ${stats.mean.toFixed(0)}, stddev ${stats.stdDev.toFixed(1)} → ${file}`);
    }
    if (errors.length > 0) throw new Error(`page errors: ${errors.join('; ')}`);
  } finally {
    await context.close();
  }
}

/** The one browser of the run: Chromium (WebGPU via SwiftShader) or, with `--firefox`, Firefox (WebGL2). */
function launchBrowser(): Promise<Browser> {
  if (USE_FIREFOX) return firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } });
  return chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
}

async function main(): Promise<void> {
  const args = ARGS.filter((a) => a !== '--firefox' && !a.startsWith('--out='));
  if (args.includes('--skies')) {
    mkdirSync(OUT_DIR, { recursive: true });
    const server = await startServer(log);
    let browser: Browser | null = null;
    try {
      browser = await launchBrowser();
      log(`rendering ${SKIES.length} sky presets`);
      await renderSkies(browser, server.url);
      log('GALLERY DONE');
    } finally {
      await browser?.close();
      await server.stop();
    }
    return;
  }
  const filters = args.map((f) => f.toLowerCase());
  const prompts = DEFAULT_PROMPTS.filter((p) => filters.length === 0 || filters.some((f) => gallerySlug(p).includes(f)));
  if (prompts.length === 0) throw new Error(`no prompt matches ${filters.join(', ')}`);
  mkdirSync(OUT_DIR, { recursive: true });
  const server = await startServer(log);
  let browser: Browser | null = null;
  try {
    browser = await launchBrowser();
    log(`rendering ${prompts.length} prompts`);
    for (const p of prompts) await renderPrompt(browser, server.url, p);
    log('GALLERY DONE');
  } finally {
    await browser?.close();
    await server.stop();
  }
}

main().catch((err: unknown) => {
  log(`GALLERY FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
