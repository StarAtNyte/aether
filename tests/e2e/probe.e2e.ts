/**
 * Art-direction probe: render an arbitrary world JSON file (envelope or bare
 * WorldDoc) from a given camera and save a PNG — for looking at one detail
 * without baking a template.
 *
 * Run: `npx tsx tests/e2e/probe.e2e.ts <world.json> <out.png> [x,y,z] [tx,ty,tz] [--firefox]`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium, firefox, type Browser } from 'playwright';
import { validateWorld } from '@aether/core';
import { CHROME_ARGS, FIREFOX_PREFS, SKIP_FIRST_RUN, findChrome, findFirefox, startServer } from './support/env';

const [worldFile, outFile, posArg, targetArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const USE_FIREFOX = process.argv.includes('--firefox');

function vec(s: string | undefined): [number, number, number] | null {
  if (!s) return null;
  const v = s.split(',').map(Number);
  return v.length === 3 && v.every(Number.isFinite) ? [v[0] as number, v[1] as number, v[2] as number] : null;
}

async function main(): Promise<void> {
  if (!worldFile || !outFile) throw new Error('usage: probe.e2e.ts <world.json> <out.png> [x,y,z] [tx,ty,tz]');
  const raw = JSON.parse(readFileSync(worldFile, 'utf8')) as { world?: unknown };
  const parsed = validateWorld(raw.world ?? raw);
  if (!parsed.ok) throw new Error(`invalid world: ${parsed.issues.slice(0, 3).map((i) => `${i.path}: ${i.message}`).join('; ')}`);
  const world = parsed.world;
  const server = await startServer((l) => void l);
  let browser: Browser | null = null;
  try {
    browser = USE_FIREFOX ? await firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } }) : await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await context.addInitScript({ content: SKIP_FIRST_RUN });
    const page = await context.newPage();
    page.on('pageerror', (e) => console.error('pageerror', e.message));
    await page.goto(`${server.url}/?debug=1#/new`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const a = window.__aether;
      return !!a && !!a.simulation && a.store?.getState().loading === null && Object.keys(a.history?.current?.entities ?? {}).length > 0;
    }, null, { timeout: 120_000 });
    const payload: unknown = JSON.parse(JSON.stringify(world));
    await page.evaluate((w) => window.__aether?.studio.replaceWorld(w as never, 'probe'), payload);
    await page.evaluate(async () => {
      await window.__aether?.simulation?.whenSynced();
    });
    await page.waitForTimeout(3000);
    const pos = vec(posArg);
    const target = vec(targetArg);
    if (pos && target) {
      await page.evaluate(([p, t]) => {
        const dx = t[0] - p[0];
        const dy = t[1] - p[1];
        const dz = t[2] - p[2];
        window.__aether?.simulation?.renderer.setCameraPose(p[0], p[1], p[2], Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
      }, [pos, target] as const);
      await page.waitForTimeout(2500);
    }
    const url = await page.evaluate(async () => (await window.__aether?.simulation?.renderer.screenshot({ width: 1280, height: 720, mime: 'image/png' })) ?? '');
    writeFileSync(outFile, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    console.log(`wrote ${outFile}`);
    await context.close();
  } finally {
    await browser?.close();
    await server.stop();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
