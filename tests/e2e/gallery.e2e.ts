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
 * `npm run gallery -- --arch` renders every architecture prompt as an
 * archviz set (`arch-<slug>-<view>.png`): the studio-render overview, a
 * close room shot, night with the lamps on, the floor plan, and for
 * multi-storey buildings the exploded and section views.
 * `--firefox` renders with Firefox (WebGL2) instead of Chromium, and
 * `--out=<dir>` writes the PNGs elsewhere (e.g. a scratch folder for a
 * Firefox/Chromium parity check).
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, firefox, type Browser, type Page } from 'playwright';
import { ARCH_PROMPTS, DEFAULT_PROMPTS } from '../../scripts/smoke-prompts';
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

/** Wait until the studio render has refined the still (or `timeoutMs` passed). */
async function refined(page: Page, timeoutMs = 40_000): Promise<number> {
  const deadline = performance.now() + timeoutMs;
  let p = 0;
  // Let the change register first (the refinement restarts on the next drawn frame).
  await page.waitForTimeout(600);
  while (performance.now() < deadline) {
    p = await page.evaluate(() => window.__aether?.simulation?.renderer.refineProgress ?? 1);
    const flying = await page.evaluate(() => window.__aether?.simulation?.renderer.animating === true);
    if (p >= 0.98 && !flying) break;
    await page.waitForTimeout(400);
  }
  return p;
}

async function archShot(page: Page, slug: string, view: string, full = false): Promise<void> {
  const file = join(OUT_DIR, `arch-${slug}-${view}.png`);
  const png = full ? await page.screenshot({ path: file }) : await page.locator('.viewport').screenshot({ path: file });
  const stats = pixelStats(decodePng(png));
  if (stats.stdDev < MIN_CANVAS_STDDEV) throw new Error(`arch ${slug} ${view}: blank canvas`);
  log(`  arch-${slug}-${view}: mean ${stats.mean.toFixed(0)}, stddev ${stats.stdDev.toFixed(1)} → ${file}`);
}

/** Render one architecture prompt as an archviz set (see the module docs). */
async function renderArch(browser: Browser, url: string, prompt: string): Promise<void> {
  const slug = gallerySlug(prompt);
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await context.addInitScript({ content: SKIP_FIRST_RUN });
  await context.addInitScript({ content: 'globalThis.__name = (f) => f;' });
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
      const a = window.__aether;
      a?.store.getState().updateSettings({ showPerf: false, showNavHint: false });
      a?.store.getState().setPanel('left', false);
      a?.store.getState().setPanel('right', false);
      await a?.simulation?.whenSynced();
    });
    await page.addStyleTag({ content: '.nav-hint, .toasts, .toast, .tooltip, .vp-overlay, .arch-bar, .vp-bottom, .vp-gizmo, .vp-context { display: none !important; }' });
    await page.waitForTimeout(800);
    await page.evaluate(() => window.__aether?.studio.viewPreset('reset'));
    await page.waitForFunction(() => window.__aether?.simulation?.renderer.cameraFlying === false, null, { timeout: 60_000 });
    const levels = await page.evaluate(() => window.__aether?.store.getState().arch.levels.length ?? 0);
    // 1. Overview in studio quality.
    await page.evaluate(() => window.__aether?.store.getState().setArch({ quality: 'studio' }));
    log(`  ${slug}: overview refined ${(await refined(page)).toFixed(2)}`);
    await archShot(page, slug, 'overview');
    // 2. A close shot of the main room, through the cutaway.
    const room = await page.evaluate(() => {
      const a = window.__aether!;
      const w = a.history.current;
      const rank = (k: string | undefined): number => (k === 'living' ? 5 : k === 'cafe' || k === 'open-office' ? 4 : k === 'kitchen' ? 2 : k === 'terrace' ? -9 : 1);
      const rooms = Object.values(w.entities)
        .filter((e) => e.arch?.role === 'room')
        .map((e) => ({ id: e.id, kind: e.arch?.kind, level: (e.parent ? w.entities[e.parent]?.arch?.level : 0) ?? 0, b: a.simulation?.entityBounds(e.id) ?? null }));
      const scored = rooms.filter((r) => r.b).map((r) => ({ ...r, area: (r.b!.max[0] - r.b!.min[0]) * (r.b!.max[2] - r.b!.min[2]) }));
      scored.sort((p, q) => rank(q.kind) - rank(p.kind) || q.area - p.area);
      const best = scored[0];
      if (!best?.b) return null;
      const c: [number, number, number] = [(best.b.min[0] + best.b.max[0]) / 2, best.b.max[1] + 1.1, (best.b.min[2] + best.b.max[2]) / 2];
      const r = Math.max(2.4, Math.hypot(best.b.max[0] - best.b.min[0], best.b.max[2] - best.b.min[2]) * 0.42);
      // Look in from the room's outside wall (lowered by the cutaway), turned a little for a three-quarter view.
      const building = Object.values(w.entities).find((e) => e.arch?.role === 'building');
      const bb = building ? a.simulation?.entityBounds(building.id) : null;
      let dx = 0.6;
      let dz = 0.8;
      if (bb) {
        const ox = c[0] - (bb.min[0] + bb.max[0]) / 2;
        const oz = c[2] - (bb.min[2] + bb.max[2]) / 2;
        const len = Math.hypot(ox, oz);
        if (len > 0.5) {
          const turn = 0.45;
          dx = (ox * Math.cos(turn) - oz * Math.sin(turn)) / len;
          dz = (ox * Math.sin(turn) + oz * Math.cos(turn)) / len;
        }
      }
      return { c, r, level: best.level, dir: [dx * r * 1.3, r * 1.15, dz * r * 1.3] as [number, number, number] };
    });
    if (room) {
      await page.evaluate(({ c, r, level, multi, dir }) => {
        // Multi-storey buildings: show only the room's storey, so the floor above does not block the shot.
        window.__aether?.store.getState().setArch({ walls: 'cutaway', levelMode: multi ? 'solo' : 'stacked', level });
        window.__aether?.simulation?.renderer.frameSphere(c, r, dir, 0);
      }, { ...room, multi: levels > 1 });
      log(`  ${slug}: room refined ${(await refined(page)).toFixed(2)}`);
      await archShot(page, slug, 'room');
    }
    // 3. Night: lamps on.
    await page.evaluate(() => {
      window.__aether?.store.getState().setArch({ sunHour: 21.5, levelMode: 'stacked' });
      window.__aether?.studio.viewPreset('reset');
    });
    await page.waitForFunction(() => window.__aether?.simulation?.renderer.cameraFlying === false, null, { timeout: 60_000 });
    log(`  ${slug}: night refined ${(await refined(page)).toFixed(2)}`);
    await archShot(page, slug, 'night');
    await page.evaluate(() => window.__aether?.store.getState().setArch({ sunHour: null }));
    // 4. Multi-storey: exploded and section.
    if (levels > 1) {
      await page.evaluate(() => window.__aether?.store.getState().setArch({ walls: 'up', levelMode: 'exploded' }));
      await page.waitForTimeout(1500);
      log(`  ${slug}: exploded refined ${(await refined(page)).toFixed(2)}`);
      await archShot(page, slug, 'exploded');
      await page.evaluate(() => window.__aether?.store.getState().setArch({ levelMode: 'stacked', section: 4.4 }));
      log(`  ${slug}: section refined ${(await refined(page)).toFixed(2)}`);
      await archShot(page, slug, 'section');
      await page.evaluate(() => window.__aether?.store.getState().setArch({ section: null }));
    }
    // 5. Floor plan (with the building bar, as the user sees it).
    await page.evaluate(() => window.__aether?.store.getState().setArch({ quality: 'realtime', plan: true, level: 0 }));
    await page.waitForTimeout(1200);
    await archShot(page, slug, 'plan');
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
  if (args.includes('--arch')) {
    const filters = args.filter((a) => a !== '--arch').map((f) => f.toLowerCase());
    const prompts = ARCH_PROMPTS.filter((p) => filters.length === 0 || filters.some((f) => gallerySlug(p).includes(f)));
    mkdirSync(OUT_DIR, { recursive: true });
    const server = await startServer(log);
    let browser: Browser | null = null;
    try {
      browser = await launchBrowser();
      log(`rendering ${prompts.length} architecture sets`);
      for (const p of prompts) await renderArch(browser, server.url, p);
      log('GALLERY DONE');
    } finally {
      await browser?.close();
      await server.stop();
    }
    return;
  }
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
