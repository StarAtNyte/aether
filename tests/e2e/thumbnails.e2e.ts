/**
 * Thumbnail renderer: produces the small WebP images the studio ships in
 * `apps/studio/public/`:
 *
 *  - `templates/<slug>.webp` (640×360, ≤ 30 KB): each built-in template is
 *    created through the real "new from template" route, built by the
 *    offline planner, framed by the editor and captured from the renderer;
 *  - `palette/<id>.webp` (192×192, ≤ 12 KB): every asset with geometry is
 *    placed alone in a neutral studio scene and captured close up.
 *
 * One Chromium (WebGPU through SwiftShader, as in the e2e suite) for the
 * whole run. Fails when a capture is missing, blank or over budget.
 *
 * Run: `npm run build && npm run thumbnails` — `-- --templates` or
 * `-- --palette` renders only one set; extra arguments filter by slug/id.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { TEMPLATES } from '../../apps/studio/src/lib/examples';
import { PALETTE_ITEMS } from '../../apps/studio/src/lib/palette';
import { CHROME_ARGS, REPO_ROOT, findChrome, startServer } from './support/env';

const PUBLIC = join(REPO_ROOT, 'apps/studio/public');
const ARGS = process.argv.slice(2);
const ONLY_TEMPLATES = ARGS.includes('--templates');
const ONLY_PALETTE = ARGS.includes('--palette');
const FILTERS = ARGS.filter((a) => !a.startsWith('--'));
const TEMPLATE_BUDGET = 30 * 1024;
const PALETTE_BUDGET = 12 * 1024;
/** The default desktop editor (same framing visitors see). */
const VIEWPORT = { width: 1440, height: 900 };

const startedAt = performance.now();
function log(line: string): void {
  process.stdout.write(`[${((performance.now() - startedAt) / 1000).toFixed(1).padStart(6)}s] ${line}\n`);
}

function wanted(id: string): boolean {
  return FILTERS.length === 0 || FILTERS.some((f) => id.includes(f));
}

function decodeWebp(dataUrl: string): Buffer {
  const m = /^data:image\/webp;base64,(.+)$/.exec(dataUrl);
  if (!m?.[1]) throw new Error(`capture is not WebP: ${dataUrl.slice(0, 40)}`);
  return Buffer.from(m[1], 'base64');
}

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const a = window.__aether;
    return !!a && a.simulation !== null && a.store.getState().loading === null;
  }, null, { timeout: 90_000 });
}

/** Capture the viewport at `w`×`h`, lowering the size until the WebP fits the budget. */
async function capture(page: Page, w: number, h: number, budget: number): Promise<Buffer> {
  for (const scale of [1, 0.9, 0.8]) {
    const url = await page.evaluate(async ([cw, ch]) => (await window.__aether?.simulation?.thumbnail(cw, ch)) ?? null, [Math.round(w * scale), Math.round(h * scale)] as const);
    if (!url) throw new Error('thumbnail capture returned nothing');
    const buf = decodeWebp(url);
    if (buf.length <= budget) return buf;
    log(`  ${buf.length} B over budget at ${Math.round(w * scale)}×${Math.round(h * scale)}, retrying smaller`);
  }
  throw new Error('thumbnail does not fit its budget');
}

async function renderTemplates(page: Page, url: string): Promise<void> {
  mkdirSync(join(PUBLIC, 'templates'), { recursive: true });
  for (const t of TEMPLATES) {
    if (!wanted(t.slug)) continue;
    await page.goto(`${url}/?debug=1#/new/${t.slug}`);
    await waitReady(page);
    await page.waitForFunction(() => {
      const st = window.__aether?.store.getState();
      const last = st?.chat[st.chat.length - 1];
      return !!st && !st.agentBusy && last?.role === 'assistant' && last.status !== 'streaming';
    }, null, { timeout: 180_000, polling: 250 });
    await page.evaluate(() => window.__aether?.store.getState().select([]));
    const info = await page.evaluate(() => {
      const a = window.__aether;
      const st = a?.store.getState();
      return { n: Object.keys(a?.history.current.entities ?? {}).length, low: st?.memory, size: [innerWidth, innerHeight], stats: st?.stats };
    });
    log(`  ${JSON.stringify(info)}`);
    // Camera flight and streamed generator content settle.
    await page.waitForTimeout(3000);
    if (process.env['THUMB_DEBUG']) await page.screenshot({ path: `${process.env['THUMB_DEBUG']}/page-${t.slug}.png` });
    const buf = await capture(page, 640, 360, TEMPLATE_BUDGET);
    writeFileSync(join(PUBLIC, 'templates', `${t.slug}.webp`), buf);
    log(`template ${t.slug}: ${(buf.length / 1024).toFixed(1)} KB`);
  }
}

/** Neutral studio scene for asset previews. */
const STUDIO_WORLD = {
  format: 'aether-world',
  version: 1,
  world: {
    name: 'Asset studio',
    environment: { sky: 'studio', weather: 'clear', ground: { material: { preset: 'plastic', color: '#9ea3ad', roughness: 0.95 }, size: 60 }, bloom: 0.25, sunIntensity: 2.8, ambientIntensity: 0.8 },
    player: { mode: 'orbit' },
  },
};

async function renderPalette(page: Page, url: string): Promise<void> {
  mkdirSync(join(PUBLIC, 'palette'), { recursive: true });
  await page.goto(`${url}/?debug=1#/new`);
  await waitReady(page);
  const err = await page.evaluate(async (text) => {
    const a = window.__aether;
    return a ? await a.studio.importText(text) : 'no studio';
  }, JSON.stringify(STUDIO_WORLD));
  if (err) throw new Error(`studio world rejected: ${err}`);
  await page.waitForTimeout(1500);
  for (const item of PALETTE_ITEMS) {
    if (!wanted(item.id) || item.entity.shape === undefined) continue;
    const id = await page.evaluate((pid) => window.__aether?.studio.addFromPalette(pid) ?? null, item.id);
    if (!id) throw new Error(`could not place ${item.id}`);
    await page.evaluate(async (eid) => {
      const a = window.__aether;
      const sim = a?.simulation;
      if (!a || !sim) return;
      a.store.getState().select([]);
      await sim.whenSynced();
      // Frame the object's own bounds with some air around it (three-quarter view).
      const b = sim.renderer.entityBounds(eid);
      if (!b) {
        a.studio.focus(eid);
        return;
      }
      const c: [number, number, number] = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
      const radius = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2;
      sim.renderer.frameSphere(c, radius * 1.15, [1, 0.8, 1.35], 0);
    }, id);
    await page.waitForTimeout(1800);
    const buf = await capture(page, 192, 192, PALETTE_BUDGET);
    writeFileSync(join(PUBLIC, 'palette', `${item.id}.webp`), buf);
    log(`asset ${item.id}: ${(buf.length / 1024).toFixed(1)} KB`);
    await page.evaluate(() => window.__aether?.studio.undo());
    await page.waitForTimeout(200);
  }
}

const server = await startServer((l) => (l.includes('"level":"error"') ? log(l) : undefined));
let browser: Browser | null = null;
try {
  browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, colorScheme: 'light' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log(`PAGE ERROR ${e.message}`));
  if (!ONLY_PALETTE) await renderTemplates(page, server.url);
  if (!ONLY_TEMPLATES) await renderPalette(page, server.url);
  log('done');
} finally {
  await browser?.close();
  await server.stop();
}
