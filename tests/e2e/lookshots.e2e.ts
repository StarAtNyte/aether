/**
 * Look shots: screenshots of bundled worlds for art-direction rounds (not a pass/fail suite).
 *
 *   npx tsx tests/e2e/lookshots.e2e.ts <outDir> <slug[:cover|:play|:x,y,z>x,y,z]>…
 *
 * `slug` or `slug:cover` uses the flagship cover camera, `slug:play` presses Play, runs forward for a
 * moment and captures the third-person view, `slug:px,py,pz>tx,ty,tz` is an explicit camera,
 * `slug:env-<sky>-<hour>` re-lights the flagship's cover view (for example `highland-trail:env-night-23`). Set
 * `AETHER_E2E_GPU=1` to use the real GPU. Everything started here is stopped in a `finally`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { CHROME_ARGS, SKIP_FIRST_RUN, findChrome, startServer } from './support/env';
import { COVER_CAMERAS } from './support/showcase-cameras';

const [outDir, ...specs] = process.argv.slice(2);
if (!outDir || specs.length === 0) throw new Error('usage: lookshots <outDir> <slug[:cover|:play|:cam]>…');

const log = (l: string): void => void process.stdout.write(`${l}\n`);
const W = Number(process.env['SHOT_W'] ?? 1600);
const H = Number(process.env['SHOT_H'] ?? 900);

async function open(page: Page, url: string, slug: string): Promise<void> {
  await page.goto(`${url}/?debug=1#/new/${slug}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => {
      const a = window.__aether;
      if (!a || a.simulation === null) return false;
      const st = a.store.getState();
      return st.loading === null && !st.agentBusy && (Object.keys(a.history.current.entities).length > 0 || a.history.current.voxel !== undefined);
    },
    null,
    { timeout: 150_000, polling: 250 },
  );
  await page.evaluate(async () => {
    await window.__aether?.simulation?.whenSynced();
  });
  await page.waitForFunction(() => window.__aether?.simulation?.renderer.animating === false, null, { timeout: 120_000, polling: 500 }).catch(() => log('  (still animating)'));
  await page.waitForTimeout(1500);
}

async function shoot(page: Page, file: string): Promise<void> {
  // `SHOT_JS_AFTER`: a snippet run just before the capture, after the camera is set (it may move the camera itself).
  if (process.env['SHOT_JS_AFTER']) {
    await page.evaluate(process.env['SHOT_JS_AFTER']);
    await page.waitForTimeout(2500);
  }
  await page.waitForFunction(() => (window.__aether?.simulation?.renderer.refineProgress ?? 1) >= 0.98, null, { timeout: 40_000, polling: 500 }).catch(() => undefined);
  const data = await page.evaluate(async ([w, h]) => (await window.__aether?.simulation?.renderer.screenshot({ width: w as number, height: h as number, mime: 'image/png' })) ?? null, [W, H]);
  if (!data) throw new Error('capture failed');
  writeFileSync(file, Buffer.from(data.slice('data:image/png;base64,'.length), 'base64'));
  log(`  wrote ${file}`);
  if (process.env['SHOT_DEBUG']) log(`  water ${JSON.stringify(await page.evaluate(() => window.__aether?.simulation?.renderer.waterDebug()))}`);
}

function setCam(page: Page, pos: readonly number[], target: readonly number[]): Promise<void> {
  return page.evaluate(
    ([p, t]) => {
      const dx = t[0]! - p[0]!;
      const dy = t[1]! - p[1]!;
      const dz = t[2]! - p[2]!;
      window.__aether?.simulation?.renderer.setCameraPose(p[0]!, p[1]!, p[2]!, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
    },
    [pos, target] as const,
  );
}

async function main(): Promise<void> {
  mkdirSync(outDir!, { recursive: true });
  const server = await startServer(log);
  const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS], headless: process.env['SHOT_HEADED'] !== '1' });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.addInitScript(SKIP_FIRST_RUN);
    if (process.env['SHOT_WATER']) await ctx.addInitScript(`globalThis.__WATER_TIER = '${process.env['SHOT_WATER']}';`);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => log(`  pageerror: ${e.message.slice(0, 200)}`));
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') log(`  console.${m.type()}: ${m.text().slice(0, 200)}`);
    });
    for (const spec of specs) {
      const [slug = '', mode = 'cover'] = spec.split(':');
      log(`${spec}`);
      await open(page, server.url, slug);
      if (process.env['SHOT_JS']) await page.evaluate(process.env['SHOT_JS']);
      if (mode === 'play') {
        await page.evaluate(() => void window.__aether?.studio.togglePlay());
        await page.waitForFunction(() => window.__aether?.store.getState().mode === 'play', null, { timeout: 60_000 });
        const card = page.locator('.title-card');
        if (await card.count()) await card.locator('.title-card__start').dispatchEvent('click').catch(() => undefined);
        await page.waitForTimeout(1500);
        await page.keyboard.down('w');
        await page.waitForTimeout(Number(process.env['SHOT_RUN_MS'] ?? 2500));
        await page.keyboard.up('w');
        await page.waitForTimeout(600);
        await shoot(page, join(outDir!, `${slug}-play.png`));
      } else if (mode.startsWith('env-')) {
        const [, sky = 'day', hour = '12'] = mode.split('-');
        await page.evaluate(
          ([s, h]) => {
            const a = window.__aether;
            if (!a?.simulation) return;
            const cur = a.history.current.environment;
            a.simulation.renderer.setEnvironmentOverride({ ...cur, sky: s as typeof cur.sky, timeOfDay: Number(h) });
          },
          [sky, hour] as const,
        );
        const cam = COVER_CAMERAS[slug];
        const custom = process.env['SHOT_CAM'];
        if (custom?.includes('>')) {
          const [a = '', b = ''] = custom.split('>');
          await setCam(page, a.split(',').map(Number), b.split(',').map(Number));
        } else if (cam) await setCam(page, cam.pos, cam.target);
        await page.waitForTimeout(2500);
        await shoot(page, join(outDir!, `${slug}-${sky}-${hour}${custom ? '-up' : ''}.png`));
      } else if (mode.includes('>')) {
        const [a = '', b = ''] = mode.split('>');
        await setCam(page, a.split(',').map(Number), b.split(',').map(Number));
        await page.waitForTimeout(2500);
        await shoot(page, join(outDir!, `${slug}-cam.png`));
      } else {
        const cam = COVER_CAMERAS[slug];
        if (cam) {
          if (cam.arch) await page.evaluate((v) => window.__aether?.store.getState().setArch({ ...v, quality: 'studio' }), cam.arch);
          await setCam(page, cam.pos, cam.target);
          await page.waitForTimeout(2500);
        }
        await shoot(page, join(outDir!, `${slug}-cover.png`));
      }
    }
  } finally {
    await browser.close();
    await server.stop();
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
