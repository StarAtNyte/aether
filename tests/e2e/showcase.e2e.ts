/**
 * Bundled default projects, end to end, against the built studio:
 *
 * Default (verify) — Chromium, then Firefox (one browser at a time):
 *  1. the projects home shows every featured template in the "Start from a
 *     template" row, and the Templates page lists featured + more worlds,
 *     every thumbnail decoding;
 *  2. each featured template opens from its saved world (no agent run): the
 *     world is the baked one, the chat starts with the original prompt and
 *     the project gets the template's thumbnail;
 *  3. Play shows the title card, Start runs the game for a few seconds (a
 *     scripted walk forward), no page errors, then Stop;
 *  4. (Chromium) every other shown template opens from its saved world too.
 *
 * `--capture [slug…]` — Chromium only: renders each flagship from its saved
 * world at 1600×900 from its cover camera and writes the cover
 * (`docs/screenshots/showcase/<slug>.webp`) and the card thumbnail
 * (`apps/studio/public/templates/<slug>.webp`, 640×360, ≤ 30 KB).
 * `--gallery` instead cuts the thumbnails of gallery entries from their
 * screenshots (no browser).
 *
 * Run: `npm run build && npm run e2e:showcase` (`-- --chromium` / `-- --firefox`).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, firefox, type Browser, type Page } from 'playwright';
import { SHOWCASE, type ShowcaseEntry } from '../../apps/studio/src/showcase/manifest';
import { FEATURED_TEMPLATES, MORE_TEMPLATES, TEMPLATES } from '../../apps/studio/src/lib/examples';
import { CHROME_ARGS, FIREFOX_PREFS, REPO_ROOT, SKIP_FIRST_RUN, findChrome, findFirefox, startServer } from './support/env';
import { decodePng, pixelStats } from './support/png';
import { COVER_CAMERAS } from './support/showcase-cameras';

const ARGS = process.argv.slice(2);
const CAPTURE = ARGS.includes('--capture');
const GALLERY = ARGS.includes('--gallery');
const FILTERS = ARGS.filter((a) => !a.startsWith('--'));
const BROWSERS = ARGS.includes('--firefox') ? ['firefox'] : ARGS.includes('--chromium') || CAPTURE ? ['chromium'] : ['chromium', 'firefox'];
const VIEWPORT = { width: 1440, height: 900 };
const TIMEOUT = 120_000;
const THUMB_BUDGET = 30 * 1024;
const COVER_BUDGET = 160 * 1024;
const PUBLIC = join(REPO_ROOT, 'apps/studio/public/templates');
const COVERS = join(REPO_ROOT, 'docs/screenshots/showcase');
const GALLERY_DIR = join(REPO_ROOT, 'docs/screenshots/gallery');
const BENIGN_CONSOLE: readonly RegExp[] = [/GL Driver Message/i, /GPU stall due to ReadPixels/i, /valid external Instance reference no longer exists/i, /^WebGL warning:/i];

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

function wanted(slug: string): boolean {
  return FILTERS.length === 0 || FILTERS.some((f) => slug.includes(f));
}

// ---------------------------------------------------------------------------
// Image helpers (cwebp, argument arrays only)
// ---------------------------------------------------------------------------

/** Width and height of a PNG (IHDR). */
function pngSize(buf: Buffer): { w: number; h: number } {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/**
 * Encode `png` to WebP at `w`×`h` (centre-cropped to that aspect first),
 * lowering quality until the file fits `budget`.
 */
function toWebp(png: string, out: string, w: number, h: number, budget: number): number {
  const { w: sw, h: sh } = pngSize(readFileSync(png));
  const aspect = w / h;
  let cw = sw;
  let ch = Math.round(sw / aspect);
  if (ch > sh) {
    ch = sh;
    cw = Math.round(sh * aspect);
  }
  const cx = Math.floor((sw - cw) / 2);
  const cy = Math.floor((sh - ch) / 2);
  for (const q of [82, 74, 66, 58, 50, 42]) {
    execFileSync(process.env['AETHER_CWEBP'] ?? 'cwebp', ['-quiet', '-q', String(q), '-m', '6', '-sharp_yuv', '-crop', String(cx), String(cy), String(cw), String(ch), '-resize', String(w), String(h), png, '-o', out], { timeout: 60_000 });
    const size = statSync(out).size;
    if (size <= budget) return size;
  }
  throw new E2EFailure(`${out} does not fit ${budget} B`);
}

/** Thumbnails of gallery entries, cut from their screenshots. */
function galleryThumbs(): void {
  mkdirSync(PUBLIC, { recursive: true });
  for (const e of SHOWCASE) {
    if (e.origin !== 'gallery' || !e.shot || !wanted(e.slug)) continue;
    const size = toWebp(join(GALLERY_DIR, e.shot), join(PUBLIC, `${e.slug}.webp`), 640, 360, THUMB_BUDGET);
    log(`  ${e.slug}: ${(size / 1024).toFixed(1)} KB from ${e.shot}`);
  }
}

// ---------------------------------------------------------------------------
// Studio helpers
// ---------------------------------------------------------------------------

/** Open `#/new/<slug>` and wait until the editor shows the saved world. */
async function openTemplate(page: Page, url: string, slug: string): Promise<{ entities: number; voxel: boolean; chat: string[] }> {
  await page.goto(`${url}/?debug=1#/new/${slug}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const a = window.__aether;
    if (!a || a.simulation === null) return false;
    const st = a.store.getState();
    const w = a.history.current;
    return st.loading === null && !st.agentBusy && (Object.keys(w.entities).length > 0 || w.voxel !== undefined);
  }, null, { timeout: TIMEOUT, polling: 250 });
  return page.evaluate(() => {
    const a = window.__aether;
    const st = a?.store.getState();
    const w = a?.history.current;
    return {
      entities: w ? Object.keys(w.entities).length : 0,
      voxel: w?.voxel !== undefined,
      chat: (st?.chat ?? []).map((c) => (c.role === 'user' ? c.text : c.status)),
    };
  });
}

/** Wait for streamed content, the grow-in and the camera flight to settle. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await window.__aether?.simulation?.whenSynced();
  });
  // The grow-in and the camera flight advance per drawn frame, and a software GPU draws a big
  // world slowly: wait (bounded) until nothing animates any more.
  await page
    .waitForFunction(() => window.__aether?.simulation?.renderer.animating === false, null, { timeout: 150_000, polling: 500 })
    .catch(() => log('  (still animating after 150 s, continuing)'));
  await page.waitForTimeout(1500);
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

async function captureFlagship(page: Page, url: string, entry: ShowcaseEntry, scratch: string): Promise<void> {
  const opened = await openTemplate(page, url, entry.slug);
  await settle(page);
  const cam = COVER_CAMERAS[entry.slug];
  if (cam?.arch) {
    // Through the studio's architecture state (what the Architecture bar sets), in studio quality.
    await page.evaluate((view) => window.__aether?.store.getState().setArch({ ...view, quality: 'studio' }), cam.arch);
    await page.waitForTimeout(2500);
  }
  if (cam) {
    await page.evaluate(([p0, t0, overGround]) => {
      const sim = window.__aether?.simulation;
      const g = overGround ? (sim?.voxel?.groundAt(t0[0], t0[2]) ?? 0) : 0;
      const p = [p0[0], p0[1] + g, p0[2]];
      const t = [t0[0], t0[1] + g, t0[2]];
      const dx = (t[0] as number) - (p[0] as number);
      const dy = (t[1] as number) - (p[1] as number);
      const dz = (t[2] as number) - (p[2] as number);
      const yaw = Math.atan2(-dx, -dz);
      const pitch = Math.atan2(dy, Math.hypot(dx, dz));
      sim?.renderer.setCameraPose(p[0] as number, p[1] as number, p[2] as number, yaw, pitch);
    }, [cam.pos, cam.target, cam.overGround === true] as const);
    // Block terrain streams in around the new view: give it time.
    await page.waitForTimeout(cam.overGround ? 12_000 : 2500);
  }
  // Studio quality refines the still over a few seconds (bounded).
  await page.waitForFunction(() => (window.__aether?.simulation?.renderer.refineProgress ?? 1) >= 0.98, null, { timeout: 60_000, polling: 500 }).catch(() => log('  (refinement unfinished, continuing)'));
  const dataUrl = await page.evaluate(async () => (await window.__aether?.simulation?.renderer.screenshot({ width: 1600, height: 900, mime: 'image/png' })) ?? null);
  if (!dataUrl || !dataUrl.startsWith('data:image/png;base64,')) throw new E2EFailure(`${entry.slug}: capture failed`);
  const png = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
  const stats = pixelStats(decodePng(png));
  const file = join(scratch, `${entry.slug}.png`);
  writeFileSync(file, png);
  if (process.env['SHOWCASE_KEEP']) writeFileSync(join(process.env['SHOWCASE_KEEP'], `${entry.slug}.png`), png);
  check(stats.stdDev > 8, `${entry.slug}: blank capture (stddev ${stats.stdDev.toFixed(1)})`);
  const cover = toWebp(file, join(COVERS, `${entry.slug}.webp`), 1600, 900, COVER_BUDGET);
  const thumb = toWebp(file, join(PUBLIC, `${entry.slug}.webp`), 640, 360, THUMB_BUDGET);
  log(`  ${entry.slug}: ${opened.entities} entities, cover ${(cover / 1024).toFixed(0)} KB, thumb ${(thumb / 1024).toFixed(1)} KB, mean ${stats.mean.toFixed(0)}`);
}

async function runCapture(): Promise<void> {
  mkdirSync(COVERS, { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), 'aether-showcase-'));
  const server = await startServer(log);
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
    for (const entry of SHOWCASE) {
      if (entry.origin !== 'flagship' || !wanted(entry.slug)) continue;
      const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
      await context.addInitScript({ content: SKIP_FIRST_RUN });
      try {
        const page = await context.newPage();
        await captureFlagship(page, server.url, entry, scratch);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser?.close();
    await server.stop();
    rmSync(scratch, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

async function verifyIn(name: string, browser: Browser, url: string): Promise<void> {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await context.addInitScript({ content: SKIP_FIRST_RUN });
  const errors: string[] = [];
  try {
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !BENIGN_CONSOLE.some((re) => re.test(m.text()))) errors.push(`console: ${m.text().slice(0, 200)}`);
    });

    // 1. Home row and Templates page.
    await page.goto(`${url}/#/`, { waitUntil: 'domcontentloaded' });
    const row = page.locator('.template-row .card--template');
    await row.first().waitFor({ timeout: TIMEOUT });
    check((await row.count()) === FEATURED_TEMPLATES.length, `${name}: home row has ${await row.count()} cards, expected ${FEATURED_TEMPLATES.length}`);
    await page.goto(`${url}/#/templates`, { waitUntil: 'domcontentloaded' });
    const grid = page.locator('.template-grid .card--template');
    await grid.first().waitFor({ timeout: TIMEOUT });
    check((await grid.count()) === TEMPLATES.length, `${name}: Templates page has ${await grid.count()} cards, expected ${TEMPLATES.length}`);
    // Every thumbnail decodes (scroll the lazy ones into view first).
    for (let i = 0; i < (await grid.count()); i++) await grid.nth(i).scrollIntoViewIfNeeded();
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('.template-grid img')].every((img) => img.complete && img.naturalWidth > 0), null, { timeout: 30_000 });
    log(`  ${name}: home row ${FEATURED_TEMPLATES.length}, Templates page ${TEMPLATES.length} (${MORE_TEMPLATES.length} more), thumbnails decode`);

    // 2–3. Each featured template: saved world, chat, thumbnail, title card, play.
    for (const t of FEATURED_TEMPLATES) {
      if (!wanted(t.slug)) continue;
      const baked = JSON.parse(readFileSync(join(PUBLIC, 'worlds', `${t.slug}.json`), 'utf8')) as { world: { entities: Record<string, unknown>; voxel?: unknown } };
      const opened = await openTemplate(page, url, t.slug);
      check(opened.entities === Object.keys(baked.world.entities).length, `${name}/${t.slug}: ${opened.entities} entities, saved world has ${Object.keys(baked.world.entities).length}`);
      check(opened.chat[0] === t.prompt, `${name}/${t.slug}: chat does not start with the original prompt`);
      const hasIntro = await page.evaluate(() => window.__aether?.history.current.intro !== undefined);
      await settle(page);
      await page.evaluate(() => void window.__aether?.studio.togglePlay());
      await page.waitForFunction(() => window.__aether?.store.getState().mode === 'play', null, { timeout: TIMEOUT });
      if (hasIntro) {
        const card = page.locator('.title-card');
        await card.waitFor({ timeout: 20_000 });
        check((await card.locator('.title-card__title').textContent())?.length, `${name}/${t.slug}: title card has no title`);
        // A slow software GPU keeps the entrance animation "unstable" for Playwright: dispatch the click.
        await card.locator('.title-card__start').dispatchEvent('click');
        await card.waitFor({ state: 'detached', timeout: 10_000 });
      }
      // A short scripted run: hold W, then jump.
      await page.keyboard.down('w');
      await page.waitForTimeout(1500);
      await page.keyboard.up('w');
      await page.keyboard.press('Space');
      await page.waitForTimeout(800);
      const game = await page.evaluate(() => {
        const st = window.__aether?.store.getState();
        return { mode: st?.mode, time: st?.game.time ?? 0, status: st?.game.status };
      });
      check(game.mode === 'play', `${name}/${t.slug}: left play mode unexpectedly`);
      await page.evaluate(() => void window.__aether?.studio.togglePlay());
      await page.waitForFunction(() => window.__aether?.store.getState().mode === 'edit', null, { timeout: TIMEOUT });
      log(`  ${name}/${t.slug}: ${opened.entities} entities${opened.voxel ? ' + voxel terrain' : ''}, ${hasIntro ? 'title card → ' : ''}played (${game.status})`);
    }

    // 4. Every other shown template opens from its saved world (Chromium only: Firefox's software GL is slow).
    if (name === 'chromium') {
      for (const t of MORE_TEMPLATES) {
        if (!wanted(t.slug)) continue;
        const opened = await openTemplate(page, url, t.slug);
        check(opened.entities > 0 || opened.voxel, `${name}/${t.slug}: empty world`);
        check(opened.chat[0] === t.prompt, `${name}/${t.slug}: chat does not start with the original prompt`);
      }
      log(`  ${name}: ${MORE_TEMPLATES.length} more worlds open from their saved files`);
    }

    // The projects list now holds the created projects, each with the template thumbnail.
    await page.goto(`${url}/#/projects`, { waitUntil: 'domcontentloaded' });
    await page.locator('.card--project').first().waitFor({ timeout: TIMEOUT });
    const withThumb = await page.evaluate(() => [...document.querySelectorAll('.card--project img')].length);
    check(withThumb > 0, `${name}: projects have no thumbnails`);
    check(errors.length === 0, `${name}: ${errors.slice(0, 5).join(' | ')}`);
  } finally {
    await context.close();
  }
}

async function runVerify(): Promise<void> {
  const server = await startServer(log);
  try {
    for (const name of BROWSERS) {
      log(`${name}…`);
      const browser = name === 'firefox' ? await firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } }) : await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
      try {
        await verifyIn(name, browser, server.url);
      } finally {
        await browser.close();
      }
    }
  } finally {
    await server.stop();
  }
}

async function main(): Promise<void> {
  if (GALLERY) galleryThumbs();
  else if (CAPTURE) await runCapture();
  else await runVerify();
  log('done');
}

main().catch((err: unknown) => {
  console.error(err instanceof E2EFailure ? `FAIL: ${err.message}` : err);
  process.exitCode = 1;
});
