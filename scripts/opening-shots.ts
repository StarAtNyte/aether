/**
 * Open bundled templates the way a visitor does (`#/new/<slug>`) and save the first settled frame: the view a world
 * opens on, with the camera pose and the time the load gate took.
 *   STATIC_DIR=/tmp/open-dist GEN_GPU=intel npx tsx scripts/opening-shots.ts --out=<dir> [--overview] <slug> [<slug> ...]
 * --overview also saves the zoomed-out overview (key O) after the opening frame.
 * --poses=<file.json> also renders given poses ({ "<slug>": [{ "name"?, "position", "target", "fov"? }] }).
 * --rank=N also renders the N best computed opening views (`rankOpening`) and prints their poses, to choose an authored one.
 */
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { CHROME_ARGS, SKIP_FIRST_RUN, findChrome, startServer } from '../tests/e2e/support/env';

const args = process.argv.slice(2);
const out = resolve(args.find((a) => a.startsWith('--out='))?.slice(6) ?? 'probe-out/opening-shots');
const overview = args.includes('--overview');
const rank = Number(args.find((a) => a.startsWith('--rank='))?.slice(7) ?? 0);
const posesFile = args.find((a) => a.startsWith('--poses='))?.slice(8);
const poses = posesFile ? (JSON.parse(readFileSync(resolve(posesFile), 'utf8')) as Record<string, Array<{ name?: string; position: number[]; target: number[]; fov?: number }>>) : {};
const slugs = args.filter((a) => !a.startsWith('--'));
await mkdir(out, { recursive: true });
const log = (l: string): void => void process.stdout.write(`${l}\n`);
const server = await startServer(log);
try {
  for (const slug of slugs) {
    const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS], headless: true });
    try {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      await ctx.addInitScript(SKIP_FIRST_RUN);
      await ctx.addInitScript({ content: 'globalThis.__name = (f) => f;' });
      await ctx.addInitScript({ content: 'globalThis.__aetherWatchdog = { firstFrameMs: 900000, stepFrameMs: 900000, giveUpMs: 900000 };' });
      await ctx.addInitScript({ content: `try { const k = 'aether.studio.settings.v1'; const s = JSON.parse(localStorage.getItem(k) || '{}'); s.showPerf = false; s.showNavHint = false; localStorage.setItem(k, JSON.stringify(s)); } catch {}` });
      if (process.env['GEN_GPU'] === 'intel') await ctx.addInitScript({ content: 'delete Navigator.prototype.gpu; try { delete navigator.gpu; } catch {}' });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => log(`  pageerror: ${e.message.slice(0, 200)}`));
      const t0 = Date.now();
      await page.goto(`${server.url}/?debug=1#/new/${slug}`, { waitUntil: 'domcontentloaded' });
      // The load gate (whenFullyLoaded) is over when the load screen goes.
      await page.waitForFunction(() => {
        const a = window.__aether;
        return !!a && a.simulation !== null && a.store.getState().loading === null && Object.keys(a.studio.history.current.entities).length > 0;
      }, null, { timeout: 300_000, polling: 250 });
      const loadMs = Date.now() - t0;
      await page.evaluate(() => {
        const st = window.__aether?.store.getState();
        st?.setPanel('left', false);
        st?.setPanel('right', false);
      });
      // A game that opens on its title card: the editor's view is the one behind "Back to editor".
      const back = page.getByRole('button', { name: 'Back to editor' });
      if (await page.evaluate(() => window.__aether?.store.getState().mode === 'play')) await back.click({ timeout: 20_000 }).catch(() => log('  (no "Back to editor" button)'));
      await page.waitForFunction(() => window.__aether?.store.getState().mode === 'edit', null, { timeout: 30_000 }).catch(() => log('  (still in play mode)'));
      // Settled: no tier change being applied (the view holds its last complete picture meanwhile) and no flight.
      await page.waitForFunction(() => {
        const a = window.__aether;
        const st = a?.store.getState() as { qualityApplying?: string | null } | undefined;
        return !st?.qualityApplying && a?.simulation?.renderer.cameraFlying === false;
      }, null, { timeout: 90_000, polling: 250 }).catch(() => log('  (not settled)'));
      // Closing the panels resized the view: wait for fresh frames, not the picture held from before.
      const f0 = await page.evaluate(() => window.__aether?.simulation?.renderer.frameCount ?? 0);
      await page.waitForFunction((f) => (window.__aether?.simulation?.renderer.frameCount ?? 0) > f + 20, f0, { timeout: 90_000, polling: 250 }).catch(() => log('  (few frames drawn)'));
      await page.waitForTimeout(1500);
      const canvas = page.locator('.viewport__host canvas').first();
      const shot = async (name: string): Promise<void> => {
        const box = await canvas.boundingBox();
        const png = await page.screenshot(box ? { clip: box } : {});
        await writeFile(join(out, `${slug}-${name}.png`), png);
      };
      const pose = await page.evaluate(() => window.__aether?.simulation?.renderer.cameraPose());
      await shot('opening');
      log(`${slug}: load ${(loadMs / 1000).toFixed(1)} s, eye ${pose?.pos.map((v) => v.toFixed(1)).join(', ')}, target ${pose?.target.map((v) => v.toFixed(1)).join(', ')}`);
      if (rank > 0) {
        type R = { rankOpening(n: number, s: Record<string, number>): Array<{ position: number[]; target: number[]; score: number }>; lookAt(p: number[], t: number[]): void };
        const res = await page.evaluate((n) => {
          const r = window.__aether?.simulation?.renderer as unknown as R;
          const stats = { tried: 0, notGround: 0, steep: 0, cramped: 0, noAim: 0, kept: 0 };
          const t = performance.now();
          const views = r.rankOpening(n, stats);
          return { views, stats, ms: performance.now() - t };
        }, rank);
        log(`  rank: ${res.ms.toFixed(0)} ms, ${JSON.stringify(res.stats)}`);
        for (const [i, v] of res.views.entries()) {
          await page.evaluate((x) => (window.__aether?.simulation?.renderer as unknown as R).lookAt(x.position, x.target), v);
          await page.waitForTimeout(2500);
          await shot(`rank${i}`);
          log(`  rank${i} score ${v.score.toFixed(2)} {"position":[${v.position.map((q) => q.toFixed(2)).join(',')}],"target":[${v.target.map((q) => q.toFixed(2)).join(',')}]}`);
        }
      }
      for (const [i, v] of (poses[slug] ?? []).entries()) {
        const f1 = await page.evaluate((x) => {
          const r = window.__aether?.simulation?.renderer as unknown as { lookAt(p: number[], t: number[], f?: number): void; frameCount: number };
          r.lookAt(x.position, x.target, x.fov);
          return r.frameCount;
        }, v);
        await page.waitForFunction((f) => (window.__aether?.simulation?.renderer.frameCount ?? 0) > f + 8, f1, { timeout: 60_000, polling: 250 }).catch(() => undefined);
        await page.waitForTimeout(1500);
        await shot(`pose${i}-${v.name ?? ''}`);
      }
      if (overview) {
        await page.keyboard.press('o');
        // A headless page draws a few frames a second: wait for the flight to land.
        await page.waitForTimeout(500);
        await page.waitForFunction(() => window.__aether?.simulation?.renderer.cameraFlying === false, null, { timeout: 90_000, polling: 250 }).catch(() => log('  (overview flight still running)'));
        await page.waitForTimeout(1500);
        await shot('overview');
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
  }
} finally {
  await server.stop();
}
process.exit(0);
