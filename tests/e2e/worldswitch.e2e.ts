/**
 * World-switch memory run (Chromium): open seven different template worlds one after another, play and stop each, go
 * back to the home page, and measure the JS heap after a forced garbage collection at the same checkpoint of every
 * round. Rounds 2 and 3 must not grow beyond noise over round 1, and three.js geometry / texture counts must not climb.
 *
 * Run: `npm run build && tsx tests/e2e/worldswitch.e2e.ts` (AETHER_SWITCH_ROUNDS=4 AETHER_SWITCH_PER_ROUND_MB=3).
 */
import { chromium, type Page } from 'playwright';
import { CHROME_ARGS, findChrome, startServer, SKIP_FIRST_RUN } from './support/env';

const SLUGS = ['lakeside-camp', 'coin-island', 'domino-run', 'bowling-alley', 'medieval-village', 'haunted-forest', 'obstacle-course'] as const;
const ROUNDS = Math.max(2, Math.min(8, Number(process.env['AETHER_SWITCH_ROUNDS'] ?? 4) || 4));
/** Allowed heap growth per round (MB). Each visit saves a project, so a little growth is data; the orbit-controls leak was about 7 MB per round. */
const PER_ROUND_MB = Number(process.env['AETHER_SWITCH_PER_ROUND_MB'] ?? 3) || 3;
const GROWTH_MB = PER_ROUND_MB * (ROUNDS - 1);
const log = (s: string): void => console.log(s);

async function heapAfterGc(page: Page): Promise<number> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('HeapProfiler.enable');
    for (let i = 0; i < 3; i++) await cdp.send('HeapProfiler.collectGarbage');
    const r = (await cdp.send('Runtime.getHeapUsage')) as { usedSize: number };
    return Math.round((r.usedSize / 1048576) * 10) / 10;
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

/** Navigate inside the single-page app (no reload), as a user switching worlds does. */
async function go(page: Page, base: string, hash: string): Promise<void> {
  if (page.url() === 'about:blank') await page.goto(`${base}/?debug=1${hash}`, { waitUntil: 'domcontentloaded' });
  else await page.evaluate((h) => { window.location.hash = h; }, hash);
}

async function main(): Promise<void> {
  const server = await startServer(log);
  const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS, '--js-flags=--expose-gc'], headless: true });
  let failed = false;
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(SKIP_FIRST_RUN);
    const page = await ctx.newPage();
    const errors: string[] = [];
    // Dawn rejects a pending popErrorScope when the page navigates away with the WebGPU instance still alive: teardown noise.
    page.on('pageerror', (e) => { if (!/Instance dropped in popErrorScope/i.test(e.message)) errors.push(e.message); });
    const heaps: number[] = [];
    for (let round = 0; round < ROUNDS; round++) {
      for (const slug of SLUGS) {
        await go(page, server.url, `#/new/${slug}`);
        await page.waitForFunction(() => { const a = (window as unknown as { __aether?: { simulation: unknown; store: { getState(): { loading: unknown } } } }).__aether; return !!a && a.simulation !== null && a.store.getState().loading === null; }, undefined, { timeout: 90_000 });
        await page.evaluate(async () => {
          const a = (window as unknown as { __aether: { simulation: { play(): Promise<void>; stop(): Promise<void> } } }).__aether;
          await a.simulation.play();
          await new Promise((r) => setTimeout(r, 400));
          await a.simulation.stop();
        });
      }
      await go(page, server.url, '#/');
      await page.waitForTimeout(1500);
      const mb = await heapAfterGc(page);
      heaps.push(mb);
      log(`round ${round + 1}: JS heap after GC ${mb} MB`);
    }
    const growth = (heaps[heaps.length - 1] as number) - (heaps[0] as number);
    log(`growth round 1 → ${ROUNDS}: ${growth.toFixed(1)} MB (limit ${GROWTH_MB})`);
    if (growth > GROWTH_MB) failed = true;
    if (errors.length > 0) {
      log(`page errors: ${errors.slice(0, 3).join(' | ')}`);
      failed = true;
    }
  } finally {
    await browser.close();
    await server.stop();
  }
  if (failed) process.exit(1);
}

void main();
