/**
 * UX end to end, in Chromium then Firefox (one browser at a time), against
 * the built studio served by the server in mock mode:
 *
 *  1. keyboard: from the home page, Tab reaches the hero prompt with a
 *     visible focus ring; "?" opens the shortcuts overlay, Esc closes it;
 *     typing a prompt + Enter creates a project and the agent builds it;
 *  2. the proof: after the turn the "Proved" seal appears and the ghost
 *     replay of the verification run plays in the viewport;
 *  3. command palette: Ctrl+K, search runs an action; free text becomes
 *     "Ask the agent: …" and runs a turn;
 *  4. sharing round trip: Share → the link opens read-only (world name,
 *     entities, Play / Stop), Remix copies it into a new editable project;
 *  5. onboarding: a first editor visit shows the 3-step tour (Next, Back,
 *     Esc), remembered after a reload;
 *  6. phone (390×844, touch): hero, editor prompt in the sheet, Play with
 *     the touch stick, the shared-world viewer — no horizontal scrolling.
 *
 * Any console error or uncaught page error fails the run.
 *
 * Run: `npm run build && npm run e2e:ux` (`-- --chromium` / `-- --firefox`).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, firefox, type Browser, type BrowserContext, type Page } from 'playwright';
import { CHROME_ARGS, FIREFOX_PREFS, REPO_ROOT, findChrome, findFirefox, startServer, SKIP_FIRST_RUN } from './support/env';

const ARGS = process.argv.slice(2);
const BROWSERS = ARGS.includes('--firefox') ? ['firefox'] : ARGS.includes('--chromium') ? ['chromium'] : ['chromium', 'firefox'];
const TIMEOUT = 150_000;
const BENIGN_CONSOLE: readonly RegExp[] = [/GL Driver Message/i, /GPU stall due to ReadPixels/i, /valid external Instance reference no longer exists/i, /^WebGL warning:/i];
/** First-run AI screen answered, tour not seen (the tour suite step needs it). */
const FIRST_RUN_ONLY = "try { if (!localStorage.getItem('aether.onboarding.v1')) localStorage.setItem('aether.onboarding.v1', JSON.stringify({ choice: 'offline', at: 1 })); } catch {}";

/**
 * README screenshots are written by the Firefox run when it is part of the run (its software WebGL2 path
 * animates far faster headless than SwiftShader WebGPU, so the replay is caught mid-motion), otherwise by
 * the first browser; `--no-screenshots` skips them.
 */
const SCREENSHOT_DIR = join(REPO_ROOT, 'docs/screenshots');
const SHOT_BROWSER = BROWSERS.includes('firefox') ? 'firefox' : BROWSERS[0];
let shotsTaken = ARGS.includes('--no-screenshots');

/** Save a README screenshot of the page (tooltips and caret hidden). */
async function readmeShot(page: Page, name: string): Promise<void> {
  if (shotsTaken) return;
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.addStyleTag({ content: '.tooltip { display: none !important; } * { caret-color: transparent !important; }' });
  await page.screenshot({ path: join(SCREENSHOT_DIR, `${name}.png`) });
  log(`  screenshot → docs/screenshots/${name}.png`);
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

function watch(page: Page, errors: string[]): void {
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (!BENIGN_CONSOLE.some((re) => re.test(text))) errors.push(`console.error: ${text.slice(0, 300)}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 300)}`));
}

/** Wait until the editor rendered and no agent turn is running. */
async function waitIdle(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const a = window.__aether;
    if (!a || a.simulation === null) return false;
    const st = a.store.getState();
    const last = st.chat[st.chat.length - 1];
    return st.loading === null && !st.agentBusy && (last === undefined || (last.role === 'assistant' && last.status !== 'streaming'));
  }, null, { timeout: TIMEOUT, polling: 250 });
}

async function entityCount(page: Page): Promise<number> {
  return page.evaluate(() => Object.keys(window.__aether?.history.current.entities ?? {}).length);
}

/** No horizontal page scroll. */
async function noHorizontalScroll(page: Page, where: string): Promise<void> {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(over <= 1, `${where}: the page scrolls horizontally by ${over}px`);
}

/** The focused element shows a focus indicator (outline or box-shadow ring). */
async function focusVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    let el: Element | null = document.activeElement;
    // A field inside a styled container (the hero bar) shows the ring on the container.
    for (let i = 0; el && i < 3; i++, el = el.parentElement) {
      const s = getComputedStyle(el);
      const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
      if (outline || (s.boxShadow && s.boxShadow !== 'none')) return true;
    }
    return false;
  });
}

// ---------------------------------------------------------------------------
// 1–3: keyboard, proof, palette
// ---------------------------------------------------------------------------

async function keyboardFlow(page: Page, base: string): Promise<void> {
  await page.goto(`${base}/?debug=1#/`, { waitUntil: 'domcontentloaded' });
  await page.locator('#hero-prompt').waitFor({ timeout: 30_000 });
  // Tab from the top of the page reaches the hero prompt, with a visible focus ring.
  await page.locator('body').click({ position: { x: 5, y: 600 } });
  let reached = false;
  for (let i = 0; i < 40 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => document.activeElement?.id === 'hero-prompt');
  }
  check(reached, 'Tab never reached the hero prompt');
  check(await focusVisible(page), 'the focused hero prompt shows no focus ring');
  // "?" outside a text field opens the shortcuts overlay; Esc closes it.
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Slash');
  const keys = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await keys.waitFor({ timeout: 5_000 });
  check(await keys.getByText('Command palette').isVisible(), 'shortcuts overlay lists no shortcuts');
  await page.keyboard.press('Escape');
  await keys.waitFor({ state: 'hidden', timeout: 5_000 });
  // Prompt from the hero: a new project, the agent builds it.
  await page.locator('#hero-prompt').focus();
  await page.keyboard.type('A domino run that knocks over a bell tower');
  await page.keyboard.press('Enter');
  await page.waitForURL(/#\/p\/[a-z0-9]+/, { timeout: 30_000 });
  await page.waitForFunction(() => (window.__aether?.store.getState().chat.length ?? 0) > 0, null, { timeout: 60_000 });
  await waitIdle(page);
  check((await entityCount(page)) > 10, 'the hero prompt did not build a world');
  log('  keyboard: Tab → hero prompt (focus ring), ? overlay, Enter builds a world');
}

async function proofFlow(page: Page): Promise<void> {
  // The seal lands after the turn; the ghost replay of the verification run plays.
  const seal = page.locator('.proof-seal');
  await seal.waitFor({ timeout: 30_000 });
  const title = (await seal.locator('.proof-seal__title').textContent()) ?? '';
  check(/Proved|Not proved/.test(title), `unexpected seal title "${title}"`);
  const passed = await page.evaluate(() => window.__aether?.store.getState().proofSeal?.passed === true);
  check(passed === (title === 'Proved'), 'seal title disagrees with the verification result');
  const replay = await page.evaluate(() => window.__aether?.store.getState().proofSeal?.replay === true);
  check(replay, 'a domino run moves, but the seal offers no replay');
  {
    await page.waitForFunction(() => window.__aether?.simulation?.renderer.proofActive === true, null, { timeout: 30_000, polling: 100 });
    // Let the ghosts get going (and the plan marks fade) before the README shot.
    if (!shotsTaken) {
      await page.waitForTimeout(2500);
      await readmeShot(page, 'proof-replay');
    }
    // Play mode clears the replay and the seal.
    await page.locator('button.play-btn').first().click();
    await page.waitForFunction(() => window.__aether?.store.getState().mode === 'play', null, { timeout: 30_000 });
    check(!(await page.evaluate(() => window.__aether?.simulation?.renderer.proofActive)), 'the proof replay kept running in play mode');
    check((await seal.count()) === 0, 'the seal stayed up in play mode');
    // Full-window play: the side panels step aside.
    const immersive = await page.evaluate(() => document.querySelector('.editor')?.getAttribute('data-immersive'));
    check(immersive === 'true', 'play mode is not full-window');
    check((await page.locator('.editor__left').count()) === 0 || !(await page.locator('.editor__left').isVisible()), 'left panel visible in full-window play');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__aether?.store.getState().mode === 'edit', null, { timeout: 30_000 });
    // GPU resources stay flat over 20 replay start / stop cycles (ghosts, trails, their materials).
    const gpu = (): Promise<{ geometries: number; textures: number; cached: number; materials: number } | null> =>
      page.evaluate(() => {
        const m = window.__aether?.simulation?.renderer.memoryStats();
        return m ? { geometries: m.geometries, textures: m.textures, cached: m.cachedGeometries, materials: m.materials } : null;
      });
    await page.evaluate(() => window.__aether?.studio.dismissProof());
    await page.waitForTimeout(500);
    const before = await gpu();
    for (let i = 0; i < 20; i++) {
      await page.evaluate(async () => {
        const sim = window.__aether?.simulation;
        await window.__aether?.studio.presentProof();
        // Let it draw (ghost meshes and trails reach the GPU), then tear it down.
        await new Promise((r) => setTimeout(r, 150));
        window.__aether?.studio.dismissProof();
        sim?.renderer.clearBlueprint();
      });
    }
    await page.waitForTimeout(800);
    const after = await gpu();
    check(before && after, 'renderer memory stats unavailable');
    check(after.cached === before.cached && after.materials === before.materials && after.textures === before.textures, `GPU caches grew over 20 replays: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    check(after.geometries <= before.geometries + 1, `GPU geometries grew over 20 replays: ${before.geometries} → ${after.geometries}`);
    log(`  proof: 20 replay cycles, GPU geometries ${before.geometries} → ${after.geometries}, textures ${before.textures} → ${after.textures}, materials ${before.materials} → ${after.materials}`);
  }
  log(`  proof: seal "${title}"${replay ? ', ghost replay played, cleared by Play (full-window)' : ''}`);
}

/** Open the palette and wait until its search field has focus (it is focused on the next frame). */
async function openPalette(page: Page): Promise<ReturnType<Page['getByRole']>> {
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.waitFor({ timeout: 5_000 });
  await page.waitForFunction(() => document.activeElement?.classList.contains('palette__input') === true, null, { timeout: 5_000 });
  return palette;
}

async function paletteFlow(page: Page): Promise<void> {
  const palette = await openPalette(page);
  await page.locator('.palette__input').fill('show colliders');
  await page.keyboard.press('Enter');
  await palette.waitFor({ state: 'hidden', timeout: 5_000 });
  check(await page.evaluate(() => window.__aether?.store.getState().settings.showColliders === true), 'palette action did not run');
  await page.evaluate(() => window.__aether?.store.getState().updateSettings({ showColliders: false }));
  // Free text becomes a prompt.
  await openPalette(page);
  await page.locator('.palette__input').fill('Make it snow');
  // A sentence: "Ask the agent" is the first (active) result, so Enter sends it.
  const ask = palette.getByRole('option', { name: /Ask the agent: “Make it snow”/ });
  await ask.waitFor({ timeout: 10_000 });
  check((await ask.getAttribute('aria-selected')) === 'true', '"Ask the agent" is not the active result for a sentence');
  const before = await page.evaluate(() => window.__aether?.store.getState().chat.length ?? 0);
  await page.keyboard.press('Enter');
  await page.waitForFunction((n) => (window.__aether?.store.getState().chat.length ?? 0) > n, before, { timeout: 30_000 });
  await waitIdle(page);
  const weather = await page.evaluate(() => window.__aether?.history.current.environment.weather);
  check(weather === 'snow', `palette prompt did not reach the agent (weather ${String(weather)})`);
  log('  palette: action by search, free text → agent turn (snow)');
}

// ---------------------------------------------------------------------------
// 4: sharing round trip
// ---------------------------------------------------------------------------

async function shareFlow(page: Page, ctx: BrowserContext, errors: string[]): Promise<void> {
  const name = await page.evaluate(() => window.__aether?.history.current.name ?? '');
  const count = await entityCount(page);
  // The Share button copies a link (the toast confirms); the debug handle returns the same link.
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await page.locator('.toast', { hasText: /link/i }).first().waitFor({ timeout: 15_000 });
  const link = await page.evaluate(() => window.__aether?.studio.share());
  check(typeof link === 'string' && /#\/view\/z1\.[A-Za-z0-9_-]+$/.test(link), `unexpected share link ${String(link).slice(0, 80)}`);
  log(`  share: link of ${link.length} chars (world in the URL fragment)`);
  const viewer = await ctx.newPage();
  watch(viewer, errors);
  try {
    await viewer.goto(link.replace('#/view/', '?debug=1#/view/'), { waitUntil: 'domcontentloaded' });
    await viewer.locator('.viewer-bar').waitFor({ timeout: 60_000 });
    check((await viewer.locator('.viewer-bar__name').textContent()) === name, 'viewer shows another world name');
    check(await viewer.getByText('Shared · read only').isVisible(), 'viewer has no read-only badge');
    await viewer.waitForFunction(() => window.__aether?.simulation !== null && window.__aether?.store.getState().loading === null, null, { timeout: TIMEOUT });
    check((await entityCount(viewer)) === count, 'viewer world differs from the shared one');
    check((await viewer.locator('.dock, .vp-context').count()) === 0, 'viewer shows editing tools');
    await viewer.waitForFunction(() => window.__aether?.simulation?.renderer.animating === false, null, { timeout: 60_000, polling: 250 }).catch(() => undefined);
    await readmeShot(viewer, 'shared-viewer');
    await viewer.locator('button.play-btn').click();
    await viewer.waitForFunction(() => window.__aether?.store.getState().mode === 'play', null, { timeout: 30_000 });
    await viewer.waitForTimeout(1000);
    await viewer.locator('button.play-btn').click();
    await viewer.waitForFunction(() => window.__aether?.store.getState().mode === 'edit', null, { timeout: 30_000 });
    await viewer.getByRole('button', { name: 'Remix' }).click();
    await viewer.waitForURL(/#\/p\/[a-z0-9]+/, { timeout: 30_000 });
    await viewer.waitForFunction(() => window.__aether?.simulation !== null && window.__aether?.store.getState().loading === null, null, { timeout: TIMEOUT });
    check((await entityCount(viewer)) === count, 'the remix differs from the shared world');
    // The editor (with its prompt) replaces the viewer.
    await viewer.locator('#prompt-input').waitFor({ timeout: 30_000 });
    check((await viewer.locator('.viewer-bar').count()) === 0, 'the remix did not leave the viewer');
    log('  share: viewer (read-only, play/stop) → Remix opens an editable copy');
  } finally {
    await viewer.close();
  }
}

// ---------------------------------------------------------------------------
// 5: onboarding tour
// ---------------------------------------------------------------------------

async function tourFlow(browser: Browser, base: string, errors: string[]): Promise<void> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    await ctx.addInitScript({ content: FIRST_RUN_ONLY });
    const page = await ctx.newPage();
    watch(page, errors);
    await page.goto(`${base}/?debug=1#/new`, { waitUntil: 'domcontentloaded' });
    const tour = page.getByTestId('tour');
    await tour.waitFor({ timeout: 90_000 });
    check((await tour.textContent())?.includes('Step 1 of 3'), 'tour does not start at step 1');
    check(await page.locator('.tour-ring').isVisible(), 'tour step 1 has no highlight');
    await page.waitForTimeout(600);
    await readmeShot(page, 'tour');
    await tour.getByRole('button', { name: 'Next' }).click();
    await page.getByText('Step 2 of 3').waitFor({ timeout: 5_000 });
    await page.keyboard.press('ArrowRight');
    await page.getByText('Step 3 of 3').waitFor({ timeout: 5_000 });
    await tour.getByRole('button', { name: 'Back' }).click();
    await page.getByText('Step 2 of 3').waitFor({ timeout: 5_000 });
    await page.keyboard.press('Escape');
    await tour.waitFor({ state: 'hidden', timeout: 5_000 });
    check(await page.evaluate(() => localStorage.getItem('aether.tour.v1') !== null), 'tour not remembered');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitIdle(page);
    await page.waitForTimeout(3000);
    check((await tour.count()) === 0, 'tour shown again after dismissal');
    log('  tour: 3 steps, Next / → / Back / Esc, remembered after reload');
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// 6: phone
// ---------------------------------------------------------------------------

async function phoneFlow(browser: Browser, name: string, base: string, errors: string[]): Promise<void> {
  // Firefox has no isMobile emulation; touch + size still exercise the phone layout.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, ...(name === 'firefox' ? {} : { isMobile: true, deviceScaleFactor: 2 }) });
  try {
    await ctx.addInitScript({ content: SKIP_FIRST_RUN });
    const page = await ctx.newPage();
    watch(page, errors);
    await page.goto(`${base}/?debug=1#/`, { waitUntil: 'domcontentloaded' });
    await page.locator('#hero-prompt').waitFor({ timeout: 30_000 });
    await noHorizontalScroll(page, 'phone home');
    const hero = await page.locator('.hero-bar').boundingBox();
    check(hero && hero.y < 400 && hero.width > 300, 'phone: hero prompt is not front and centre');
    await page.goto(`${base}/?debug=1#/new/coin-island`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/#\/p\//, { timeout: 30_000 });
    await page.waitForFunction(() => (window.__aether?.store.getState().chat.length ?? 0) > 0, null, { timeout: 60_000 });
    await waitIdle(page);
    await noHorizontalScroll(page, 'phone editor');
    check(await page.getByLabel('Prompt', { exact: true }).isVisible(), 'phone: prompt not visible');
    await page.locator('button.play-btn').first().tap();
    await page.waitForFunction(() => window.__aether?.store.getState().mode === 'play', null, { timeout: 30_000 });
    await page.locator('.touch__stick').first().waitFor({ timeout: 10_000 });
    await noHorizontalScroll(page, 'phone play');
    await page.locator('button.play-btn').first().tap();
    await page.waitForFunction(() => window.__aether?.store.getState().mode === 'edit', null, { timeout: 30_000 });
    // The shared-world viewer on a phone.
    const link = await page.evaluate(() => window.__aether?.studio.share());
    check(typeof link === 'string', 'phone: no share link');
    await page.goto(link.replace('#/view/', '?debug=1#/view/'), { waitUntil: 'domcontentloaded' });
    await page.locator('.viewer-bar').waitFor({ timeout: 60_000 });
    await noHorizontalScroll(page, 'phone viewer');
    const remix = await page.getByRole('button', { name: 'Remix' }).boundingBox();
    check(remix && remix.x + remix.width <= 390 + 0.5, 'phone viewer: Remix is off screen');
    log('  phone: hero, editor prompt, play with touch stick, viewer — no horizontal scroll');
  } finally {
    await ctx.close();
  }
}

async function runBrowser(name: string, base: string): Promise<void> {
  if (name !== SHOT_BROWSER) shotsTaken = true;
  else shotsTaken = ARGS.includes('--no-screenshots');
  let browser: Browser | null = null;
  let ctx: BrowserContext | null = null;
  const errors: string[] = [];
  try {
    browser = name === 'firefox' ? await firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } }) : await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
    log(name);
    ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    if (name === 'chromium') await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
    await ctx.addInitScript({ content: SKIP_FIRST_RUN });
    const page = await ctx.newPage();
    watch(page, errors);
    await keyboardFlow(page, base);
    await proofFlow(page);
    await paletteFlow(page);
    await shareFlow(page, ctx, errors);
    await ctx.close();
    ctx = null;
    await tourFlow(browser, base, errors);
    await phoneFlow(browser, name, base, errors);
    check(errors.length === 0, `console/page errors:\n  ${errors.join('\n  ')}`);
    log(`${name} passed`);
  } finally {
    await ctx?.close().catch(() => undefined);
    await browser?.close();
  }
}

const server = await startServer((l) => (l.includes('"level":"error"') ? log(l) : undefined));
try {
  for (const name of BROWSERS) await runBrowser(name, server.url);
  log('UX E2E PASSED');
} catch (err) {
  log(`UX E2E FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await server.stop();
}
