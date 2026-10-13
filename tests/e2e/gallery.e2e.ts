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
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { DEFAULT_PROMPTS } from '../../scripts/smoke-prompts';
import { decodePng, pixelStats } from './support/png';
import { CHROME_ARGS, REPO_ROOT, findChrome, startServer } from './support/env';

const VIEWPORT = { width: 1440, height: 900 };
const OUT_DIR = join(REPO_ROOT, 'docs/screenshots/gallery');
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
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${url}/?debug=1`, { waitUntil: 'domcontentloaded' });
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
    await page.addStyleTag({ content: '.viewport__hint, .toasts, .toast { display: none !important; }' });
    const file = join(OUT_DIR, `${slug}.png`);
    const png = await page.locator('.viewport').screenshot({ path: file });
    const stats = pixelStats(decodePng(png));
    if (stats.stdDev < MIN_CANVAS_STDDEV) throw new Error(`"${slug}" rendered a blank canvas`);
    if (errors.length > 0) throw new Error(`page errors: ${errors.join('; ')}`);
    log(`  ${slug}: ${done.entities} entities, mean ${stats.mean.toFixed(0)}, stddev ${stats.stdDev.toFixed(1)} → docs/screenshots/gallery/${slug}.png`);
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  const filters = process.argv.slice(2).map((f) => f.toLowerCase());
  const prompts = DEFAULT_PROMPTS.filter((p) => filters.length === 0 || filters.some((f) => gallerySlug(p).includes(f)));
  if (prompts.length === 0) throw new Error(`no prompt matches ${filters.join(', ')}`);
  mkdirSync(OUT_DIR, { recursive: true });
  const server = await startServer(log);
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
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
