/**
 * Home-page shots at desktop and phone widths, device scale 1 and 2, light and dark, and the bytes of the images the
 * page fetches (the first paint's, then after scrolling). For before/after comparison of the card thumbnails.
 *
 *   STATIC_DIR=<dist> npx tsx scripts/showcase/home-shots.ts --out=<dir> --tag=<before|after>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { CHROME_ARGS, findChrome, startServer } from '../../tests/e2e/support/env';

const arg = (n: string): string | undefined => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const out = arg('out') ?? 'home-shots';
const tag = arg('tag') ?? 'x';

async function main(): Promise<void> {
  mkdirSync(out, { recursive: true });
  const server = await startServer((s) => process.stdout.write(`${s}\n`));
  const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
  const report: Record<string, unknown> = {};
  try {
    for (const [vw, vh, label] of [[1440, 900, 'desktop'], [390, 844, 'phone']] as const) {
      for (const dsf of [1, 2]) {
        for (const theme of ['light', 'dark'] as const) {
          const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dsf, colorScheme: theme });
          await ctx.addInitScript({ content: `try { localStorage.setItem('aether.onboarding.v1', JSON.stringify({ choice: 'offline', at: 1 })); localStorage.setItem('aether.tour.v1', JSON.stringify({ done: true, at: 1 })); localStorage.setItem('aether.theme', '${theme}'); } catch {}` });
          const page = await ctx.newPage();
          const imgs: Array<{ url: string; bytes: number; phase: string }> = [];
          let phase = 'first';
          page.on('response', async (r) => {
            const u = r.url();
            if (!/\.(webp|jpg|jpeg|png|avif)(\?|$)/.test(u)) return;
            const b = await r.body().catch(() => null);
            imgs.push({ url: u.replace(/^https?:\/\/[^/]+/, ''), bytes: b?.length ?? 0, phase });
          });
          await page.goto(`${server.url}/`, { waitUntil: 'networkidle' });
          await page.waitForSelector('.card--template', { timeout: 90_000 });
          await page.waitForLoadState('networkidle');
          await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
          await page.waitForTimeout(1500);
          const key = `${label}-x${dsf}-${theme}`;
          await page.screenshot({ path: join(out, `${tag}-${key}-top.png`) });
          const eager = imgs.filter((i) => i.phase === 'first');
          phase = 'scroll';
          for (let y = 0; y < 3200; y += vh * 0.8) {
            await page.mouse.wheel(0, vh * 0.8);
            await page.waitForTimeout(450);
            await page.screenshot({ path: join(out, `${tag}-${key}-s${Math.round(y / (vh * 0.8))}.png`) });
          }
          report[key] = { eagerCount: eager.length, eagerBytes: eager.reduce((a, i) => a + i.bytes, 0), allBytes: imgs.reduce((a, i) => a + i.bytes, 0), images: imgs };
          await ctx.close();
        }
      }
    }
  } finally {
    await browser.close();
    await server.stop();
  }
  writeFileSync(join(out, `${tag}-report.json`), JSON.stringify(report, null, 1));
}
void main();
