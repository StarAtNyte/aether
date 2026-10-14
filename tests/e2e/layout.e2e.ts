/**
 * Layout regression test: renders the home page and the editor at desktop,
 * laptop, tablet and phone sizes (portrait and landscape) in Chromium and
 * then Firefox (one browser at a time), and fails on any layout violation:
 *
 *  - the document scrolls (anything wider/taller than the viewport);
 *  - a visible element extends past the viewport without being clipped by a
 *    scroll container;
 *  - a control or text is cut off by a non-scrolling `overflow: hidden`
 *    ancestor (clipped content);
 *  - text overflows its box without an ellipsis;
 *  - the top bar zones overlap or overflow;
 *  - viewport overlays (camera presets, performance HUD, checks button,
 *    agent status, play HUD, tool dock, navigation hint, axis gizmo)
 *    overlap each other.
 *
 * States checked per size: home (grid), projects (list), editor (agent with
 * a finished conversation, performance HUD on), editor (assets + an object
 * selected), editor in play mode. Phone sizes use a touch context; there
 * the bottom sheet is also checked half open.
 *
 * Run: `npm run build && npm run e2e:layout` (`-- --chromium` or
 * `-- --firefox` for one browser).
 */
import { chromium, firefox, type Browser, type BrowserContext, type Page } from 'playwright';
import { CHROME_ARGS, FIREFOX_PREFS, findChrome, findFirefox, startServer, SKIP_FIRST_RUN } from './support/env';

/** Sizes from the layout requirements, plus landscape phone. */
const DESKTOP_SIZES: ReadonlyArray<[number, number]> = [
  [1440, 900],
  [1366, 650],
  [1280, 720],
  [1024, 700],
  [900, 700],
  [768, 1024],
];
const PHONE_SIZES: ReadonlyArray<[number, number]> = [
  [390, 844],
  [844, 390],
];

const ARGS = process.argv.slice(2);
const BROWSERS = ARGS.includes('--firefox') ? ['firefox'] : ARGS.includes('--chromium') ? ['chromium'] : ['chromium', 'firefox'];
const BOOT_TIMEOUT_MS = 90_000;
const AGENT_TIMEOUT_MS = 150_000;
const SETTLE_MS = 450;

const startedAt = performance.now();
function log(line: string): void {
  process.stdout.write(`[${((performance.now() - startedAt) / 1000).toFixed(1).padStart(6)}s] ${line}\n`);
}

/** One layout violation. */
interface Violation {
  kind: string;
  where: string;
  detail: string;
}

/**
 * In-page checker (serialized into the page). Returns violations. Elements
 * inside `[data-layout-ignore]` (labels layer, canvas) and invisible
 * elements are skipped.
 */
function checkLayout(): Violation[] {
  const out: Violation[] = [];
  const doc = document.documentElement;
  const vw = doc.clientWidth;
  const vh = doc.clientHeight;
  const EPS = 1.5;

  const path = (el: Element): string => {
    const parts: string[] = [];
    let e: Element | null = el;
    for (let i = 0; e && i < 4; i++, e = e.parentElement) {
      const cls = typeof e.className === 'string' && e.className.trim() ? `.${e.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
      const label = e.getAttribute('aria-label');
      parts.unshift(`${e.tagName.toLowerCase()}${cls}${label ? `[${label.slice(0, 24)}]` : ''}`);
    }
    return parts.join(' > ');
  };

  const visible = (el: Element): boolean => {
    if (el.closest('[data-layout-ignore]')) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    for (let e: Element | null = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse' || Number(cs.opacity) === 0) return false;
      if (e.hasAttribute('inert') || e.getAttribute('aria-hidden') === 'true' && e.classList.contains('drawer')) return false;
    }
    return true;
  };

  if (doc.scrollWidth > vw + EPS || doc.scrollHeight > vh + EPS) out.push({ kind: 'document-scroll', where: 'html', detail: `${doc.scrollWidth}×${doc.scrollHeight} > ${vw}×${vh}` });
  if (document.body.scrollWidth > vw + EPS) out.push({ kind: 'document-scroll', where: 'body', detail: `${document.body.scrollWidth} > ${vw}` });

  const all = [...document.querySelectorAll('body *')];
  for (const el of all) {
    if (el instanceof SVGElement && !(el instanceof SVGSVGElement)) continue;
    if (el.tagName === 'OPTION' || el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'BR') continue;
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    // Walk ancestors: find the nearest clipping ancestor and whether it scrolls.
    let clipped = false;
    let scrollClip = false;
    let hiddenClipRect: DOMRect | null = null;
    for (let a = el.parentElement; a; a = a.parentElement) {
      // The document itself never counts as a clip: content cut by html/body is content past the viewport.
      if (a === document.body || a === doc) break;
      const cs = getComputedStyle(a);
      const ox = cs.overflowX;
      const oy = cs.overflowY;
      if (ox === 'visible' && oy === 'visible') continue;
      const ar = a.getBoundingClientRect();
      const scrolls = ox === 'auto' || ox === 'scroll' || oy === 'auto' || oy === 'scroll';
      if (scrolls) {
        scrollClip = true;
        clipped = true;
        break;
      }
      if (!hiddenClipRect) hiddenClipRect = ar;
      clipped = true;
    }
    const outside = r.left < -EPS || r.top < -EPS || r.right > vw + EPS || r.bottom > vh + EPS;
    if (outside && !scrollClip) {
      const insideClip = hiddenClipRect && hiddenClipRect.left >= -EPS && hiddenClipRect.top >= -EPS && hiddenClipRect.right <= vw + EPS && hiddenClipRect.bottom <= vh + EPS;
      if (!clipped || !insideClip) out.push({ kind: 'offscreen', where: path(el), detail: `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}×${Math.round(r.height)} in ${vw}×${vh}` });
    }
    // Anything cut by a non-scrolling clip ancestor (controls are reported as such).
    if (hiddenClipRect && !scrollClip) {
      const interactive = el.matches('button, a[href], input, select, textarea, [role="tab"], [role="switch"], kbd');
      const CUT = interactive ? EPS : 2.5;
      const cut = r.left < hiddenClipRect.left - CUT || r.right > hiddenClipRect.right + CUT || r.top < hiddenClipRect.top - CUT || r.bottom > hiddenClipRect.bottom + CUT;
      // Media cropped by their frame (object-fit) is intentional.
      const media = el.matches('img, canvas, video') || el.closest('.thumb, .tile__art');
      if (cut && !media && !el.closest('[data-clip-ok]')) out.push({ kind: interactive ? 'clipped-control' : 'clipped', where: path(el), detail: `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}×${Math.round(r.height)} clip ${Math.round(hiddenClipRect.left)},${Math.round(hiddenClipRect.top)} ${Math.round(hiddenClipRect.width)}×${Math.round(hiddenClipRect.height)}` });
    }
    // Text overflow without ellipsis (leaf text holders only).
    if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && el.tagName !== 'SELECT') {
      let hasText = false;
      for (const n of el.childNodes) if (n.nodeType === 3 && (n.textContent ?? '').trim() !== '') hasText = true;
      if (hasText && el instanceof HTMLElement && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
        const cs = getComputedStyle(el);
        const scrolls = cs.overflowX === 'auto' || cs.overflowX === 'scroll';
        if (!scrolls && cs.textOverflow !== 'ellipsis' && cs.display !== 'inline') out.push({ kind: 'text-overflow', where: path(el), detail: `"${(el.textContent ?? '').trim().slice(0, 40)}" ${el.scrollWidth} > ${el.clientWidth}` });
      }
    }
  }

  // Top bar zones never overlap.
  const zones = [...document.querySelectorAll('.topbar__zone')].filter(visible).map((z) => ({ z, r: z.getBoundingClientRect() }));
  for (let i = 0; i < zones.length; i++) {
    const a = zones[i];
    if (!a) continue;
    if (a.z instanceof HTMLElement && a.z.scrollWidth > a.z.clientWidth + 1) out.push({ kind: 'topbar-overflow', where: path(a.z), detail: `${a.z.scrollWidth} > ${a.z.clientWidth}` });
    for (let j = i + 1; j < zones.length; j++) {
      const b = zones[j];
      if (!b) continue;
      if (a.r.left < b.r.right - EPS && b.r.left < a.r.right - EPS && a.r.top < b.r.bottom - EPS && b.r.top < a.r.bottom - EPS) out.push({ kind: 'topbar-overlap', where: `${path(a.z)} × ${path(b.z)}`, detail: '' });
    }
  }

  // Viewport overlays never overlap each other.
  const groups: Array<[string, string]> = [
    ['camera/perf', '.vp-overlay--tl > *'],
    ['checks/display', '.vp-overlay--tr > *'],
    ['status', '.vp-status'],
    ['play-hud', '.play-hud'],
    ['dock', '.dock'],
    ['nav-hint', '.nav-hint'],
    ['gizmo', '.vp-gizmo__btn'],
    ['play-hint', '.play-hint'],
    ['touch', '.touch__stick, .touch__btn'],
  ];
  const boxes: Array<{ g: string; el: Element; r: DOMRect }> = [];
  for (const [g, sel] of groups) for (const el of document.querySelectorAll(sel)) if (visible(el)) boxes.push({ g, el, r: el.getBoundingClientRect() });
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (!a || !b || a.g === b.g) continue;
      if (a.r.left < b.r.right - EPS && b.r.left < a.r.right - EPS && a.r.top < b.r.bottom - EPS && b.r.top < a.r.bottom - EPS) out.push({ kind: 'overlay-overlap', where: `${a.g} × ${b.g}`, detail: `${path(a.el)} / ${path(b.el)}` });
    }
  }
  // Overlays stay inside the viewport frame.
  const vp = document.querySelector('.viewport');
  if (vp && visible(vp)) {
    const fr = vp.getBoundingClientRect();
    for (const b of boxes) {
      if (b.r.left < fr.left - EPS || b.r.right > fr.right + EPS || b.r.top < fr.top - EPS || b.r.bottom > fr.bottom + EPS) out.push({ kind: 'overlay-outside', where: b.g, detail: path(b.el) });
    }
  }
  return out;
}

async function check(page: Page, label: string, failures: string[]): Promise<void> {
  await page.waitForTimeout(SETTLE_MS);
  // Let every finite transition/animation finish (software GPUs slow the first frames down).
  await page
    .waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity), null, { timeout: 8000, polling: 100 })
    .catch(() => undefined);
  const v = await page.evaluate(checkLayout);
  if (v.length === 0) {
    log(`  ok   ${label}`);
    return;
  }
  log(`  FAIL ${label}: ${v.length} violation(s)`);
  for (const x of v.slice(0, 12)) {
    const line = `${label} · ${x.kind} · ${x.where} · ${x.detail}`;
    failures.push(line);
    log(`       ${x.kind}: ${x.where} ${x.detail}`);
  }
}

async function waitEditor(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const a = window.__aether;
    return !!a && a.simulation !== null && a.store.getState().loading === null;
  }, null, { timeout: BOOT_TIMEOUT_MS });
}

async function waitAgentIdle(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const st = window.__aether?.store.getState();
    const last = st?.chat[st.chat.length - 1];
    return !!st && !st.agentBusy && last?.role === 'assistant' && last.status !== 'streaming';
  }, null, { timeout: AGENT_TIMEOUT_MS, polling: 250 });
}

/** Build a project once (coin island: a game with a HUD) and return its editor URL. */
async function prepareProject(page: Page, base: string): Promise<string> {
  await page.goto(`${base}/?debug=1#/new/coin-island`);
  await waitEditor(page);
  await waitAgentIdle(page);
  await page.waitForTimeout(1500);
  return page.url();
}

async function editorStates(page: Page, size: string, phone: boolean, failures: string[]): Promise<void> {
  // Agent view with a finished conversation, performance HUD on, nav hint visible.
  await page.evaluate(() => {
    const st = window.__aether?.store.getState();
    st?.select([]);
    st?.updateSettings({ showPerf: true, showNavHint: true, showLabels: true });
    st?.showLeftView('agent');
  });
  await check(page, `${size} editor/agent`, failures);
  // Assets + an object selected (inspector object sections).
  await page.evaluate((isPhone) => {
    const a = window.__aether;
    if (!a) return;
    const ids = Object.keys(a.history.current.entities);
    a.studio.pick(ids.find((i) => a.history.current.entities[i]?.shape.kind === 'procedural') ?? ids[0] ?? null);
    a.store.getState().showLeftView('assets');
    if (!isPhone) a.store.getState().showInspector();
  }, phone);
  await check(page, `${size} editor/assets+selection`, failures);
  if (phone) {
    // Bottom sheet half open on the inspector tab.
    await page.locator('.sheet__tab', { hasText: 'Inspect' }).click();
    await check(page, `${size} editor/sheet-inspector`, failures);
    await page.locator('.sheet__tab', { hasText: 'Agent' }).click();
  }
  // Play mode (HUD, play hint or touch controls).
  await page.evaluate(() => window.__aether?.studio.togglePlay());
  await page.waitForFunction(() => window.__aether?.store.getState().mode === 'play', null, { timeout: 30_000 });
  await page.waitForTimeout(800);
  await check(page, `${size} editor/play`, failures);
  await page.evaluate(() => window.__aether?.studio.togglePlay());
  await page.waitForFunction(() => window.__aether?.store.getState().mode === 'edit' && !window.__aether.store.getState().modeBusy, null, { timeout: 30_000 });
  await page.evaluate(() => {
    const st = window.__aether?.store.getState();
    st?.select([]);
    st?.updateSettings({ showPerf: false, showLabels: false });
  });
}

async function homeStates(page: Page, base: string, size: string, failures: string[]): Promise<void> {
  await page.goto(`${base}/?debug=1#/`);
  await page.waitForSelector('.card--project', { timeout: 20_000 });
  await check(page, `${size} home`, failures);
  await page.goto(`${base}/?debug=1#/projects`);
  await page.waitForSelector('.card--project, .project-row', { timeout: 20_000 });
  const list = page.getByRole('radio', { name: 'List view' });
  if (await list.isVisible()) await list.click();
  await check(page, `${size} projects/list`, failures);
  const grid = page.getByRole('radio', { name: 'Grid view' });
  if (await grid.isVisible()) await grid.click();
  await page.goto(`${base}/?debug=1#/docs`);
  await check(page, `${size} docs`, failures);
}

async function runBrowser(name: string, base: string, failures: string[]): Promise<void> {
  let browser: Browser | null = null;
  try {
    browser = name === 'firefox' ? await firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } }) : await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
    log(`${name}: launched`);
    const errors: string[] = [];
    const watch = (ctx: BrowserContext): void => {
      // tsx/esbuild wraps nested named functions in a `__name` helper; give the page a no-op one.
      void ctx.addInitScript('globalThis.__name = (f) => f;');
    };

    // Desktop and tablet sizes: one page, resized in place.
    const desk = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await desk.addInitScript({ content: SKIP_FIRST_RUN });
    watch(desk);
    const page = await desk.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    const editorUrl = await prepareProject(page, base);
    for (const [w, h] of DESKTOP_SIZES) {
      await page.setViewportSize({ width: w, height: h });
      const size = `${name} ${w}×${h}`;
      await homeStates(page, base, size, failures);
      await page.goto(editorUrl);
      await waitEditor(page);
      await editorStates(page, size, false, failures);
    }
    // Storage is per context: hand the project to the touch context through an export.
    const exported = await page.evaluate(() => {
      const a = window.__aether;
      return a ? JSON.stringify({ format: 'aether-world', version: 1, world: a.history.current }) : '';
    });
    await desk.close();

    // Phones: touch context (coarse pointer).
    for (const [w, h] of PHONE_SIZES) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, ...(name === 'chromium' ? { isMobile: true } : {}) });
      await ctx.addInitScript({ content: SKIP_FIRST_RUN });
      watch(ctx);
      const p = await ctx.newPage();
      p.on('pageerror', (e) => errors.push(e.message));
      await p.goto(`${base}/?debug=1#/new`);
      await waitEditor(p);
      const err = await p.evaluate(async (text) => (window.__aether ? await window.__aether.studio.importText(text) : 'no studio'), exported);
      if (err) throw new Error(`import failed: ${err}`);
      await p.waitForTimeout(1500);
      const size = `${name} ${w}×${h} touch`;
      await editorStates(p, size, w < 768, failures);
      await p.evaluate(() => window.__aether?.studio.flush());
      await homeStates(p, base, size, failures);
      await ctx.close();
    }
    if (errors.length > 0) failures.push(...errors.map((e) => `${name} page error: ${e}`));
  } finally {
    await browser?.close();
  }
}

const server = await startServer((l) => (l.includes('"level":"error"') ? log(l) : undefined));
const failures: string[] = [];
try {
  for (const name of BROWSERS) await runBrowser(name, server.url, failures);
} finally {
  await server.stop();
}
if (failures.length > 0) {
  log(`FAILED with ${failures.length} violation(s)`);
  process.exitCode = 1;
} else {
  log('layout OK');
}
