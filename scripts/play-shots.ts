/**
 * Play-camera stills: opens bundled worlds, presses Play, walks a short key script and saves page screenshots, so camera
 * behaviour (a chase camera against a wall, first-person near a corner) can be judged by eye.
 *
 * Run: `npm run build && npx tsx scripts/play-shots.ts --slug=medieval-village,kart-canyon --out=<dir> [--gpu] [--keys=w:1500,s:2500,a:600]`
 * `--keys` is a list of `key:milliseconds` held in turn; a still is saved after each (`<slug>-<n>-<key>.png`).
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { CHROME_ARGS, SKIP_FIRST_RUN, findChrome, startServer } from '../tests/e2e/support/env';

const ARGS = process.argv.slice(2);
const arg = (n: string): string | undefined => ARGS.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const SLUGS = (arg('slug') ?? 'medieval-village').split(',').filter(Boolean);
const OUT = resolve(arg('out') ?? '/tmp/aether-play-shots');
const KEYS = (arg('keys') ?? 'w:1500,s:3500,a:900,w:1200').split(',').map((k) => {
  const [key, ms] = k.split(':');
  return { key: key as string, ms: Number(ms ?? 1000) };
});
const GPU_ARGS = ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan', '--disable-vulkan-surface'];

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const server = await startServer((l) => process.stdout.write(`${l}\n`));
  const browser = await chromium.launch({ executablePath: findChrome(), args: ARGS.includes('--gpu') ? GPU_ARGS : [...CHROME_ARGS] });
  try {
    for (const slug of SLUGS) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
      await context.addInitScript({ content: SKIP_FIRST_RUN });
      await context.addInitScript({ content: 'globalThis.__name = (f) => f;' });
      if (ARGS.includes('--gpu')) await context.addInitScript({ content: 'delete Navigator.prototype.gpu;' });
      const page = await context.newPage();
      page.on('pageerror', (e) => process.stdout.write(`pageerror: ${e.message}\n`));
      await page.goto(`${server.url}/?debug=1#/new/${slug}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => {
        const a = window.__aether;
        return !!a && a.simulation !== null && a.store.getState().loading === null && !a.store.getState().agentBusy && Object.keys(a.history.current.entities).length > 0;
      }, null, { timeout: 120_000, polling: 250 });
      await page.waitForTimeout(2500);
      await page.locator('button.play-btn').first().click();
      await page.waitForFunction(() => window.__aether?.store.getState().mode === 'play', null, { timeout: 60_000 });
      await page.waitForTimeout(2500);
      await page.getByRole('button', { name: /^Start/ }).first().click({ timeout: 3000 }).catch(() => undefined);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: join(OUT, `${slug}-0-start.png`) });
      let n = 1;
      for (const { key, ms } of KEYS) {
        await page.keyboard.down(key);
        await page.waitForTimeout(ms);
        await page.keyboard.up(key);
        await page.waitForTimeout(500);
        await page.screenshot({ path: join(OUT, `${slug}-${n++}-${key}.png`) });
      }
      process.stdout.write(`${slug}: ${n} stills\n`);
      await context.close();
    }
  } finally {
    await browser.close();
    await server.stop();
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
});
