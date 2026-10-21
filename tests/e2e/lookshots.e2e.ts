/**
 * Look shots: screenshots of bundled worlds for art-direction rounds (not a pass/fail suite).
 *
 *   npx tsx tests/e2e/lookshots.e2e.ts <outDir> <slug[:cover|:play|:x,y,z>x,y,z]>…
 *
 * `slug` or `slug:cover` uses the flagship cover camera, `slug:play` presses Play, runs forward for a
 * moment and captures the third-person view, `slug:px,py,pz>tx,ty,tz` is an explicit camera,
 * `slug:editor` is the page as the editor opens it (own framing, no camera change), `slug:env-<sky>-<hour>` re-lights the flagship's cover view (for example `highland-trail:env-night-23`). Set
 * `AETHER_E2E_GPU=1` to use the real GPU, `GEN_GPU=intel` the integrated one (WebGL2 over ANGLE/GL-EGL). Everything
 * started here is stopped in a `finally`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, firefox, type Browser, type Page } from 'playwright';
import { CHROME_ARGS, FIREFOX_PREFS, SKIP_FIRST_RUN, findChrome, findFirefox, startServer } from './support/env';
import { COVER_CAMERAS } from './support/showcase-cameras';

const [outDir, ...specs] = process.argv.slice(2);
if (!outDir || specs.length === 0) throw new Error('usage: lookshots <outDir> <slug[:cover|:play|:cam]>…');

const log = (l: string): void => void process.stdout.write(`${l}\n`);
const W = Number(process.env['SHOT_W'] ?? 1600);
const H = Number(process.env['SHOT_H'] ?? 900);
/** `GEN_GPU=intel`: WebGL2 over ANGLE/GL-EGL on the integrated GPU (holds its context headless). */
const INTEL_ARGS: readonly string[] = ['--enable-unsafe-webgpu', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'];

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
  // A building's light volume bakes once it has settled: stills wait for the finished light.
  await page.waitForFunction(() => window.__aether?.simulation?.renderer.lightVolumeBaking !== true && window.__aether?.simulation?.renderer.foliagePending !== true, null, { timeout: 60_000, polling: 250 }).catch(() => undefined);
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
  // `SHOT_BROWSER=firefox` runs the shots in Firefox on WebGL2.
  const browser: Browser =
    process.env['SHOT_BROWSER'] === 'firefox'
      ? await firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } })
      : await chromium.launch({ executablePath: findChrome(), args: process.env['GEN_GPU'] === 'intel' ? [...INTEL_ARGS] : [...CHROME_ARGS], headless: process.env['SHOT_HEADED'] !== '1' });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.addInitScript(SKIP_FIRST_RUN);
    // `SHOT_WEBGL2=1`: hide WebGPU so the studio takes its WebGL2 backend (what Firefox and most laptops run).
    if (process.env['SHOT_WEBGL2'] === '1') await ctx.addInitScript('delete Navigator.prototype.gpu;');
    // `SHOT_BACKEND=webgpu|webgl2`: choose the renderer backend through the studio setting (default: the studio's own policy).
    if (process.env['SHOT_BACKEND']) await ctx.addInitScript(`try { localStorage.setItem('aether.studio.settings.v1', JSON.stringify({ backend: ${JSON.stringify(process.env['SHOT_BACKEND'])} })); } catch {}`);
    if (process.env['SHOT_WATER']) await ctx.addInitScript(`globalThis.__WATER_TIER = '${process.env['SHOT_WATER']}';`);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => log(`  pageerror: ${e.message.slice(0, 200)}`));
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning' || process.env['SHOT_VERBOSE'] === '1') log(`  console.${m.type()}: ${m.text().slice(0, 200)}`);
    });
    for (const spec of specs) {
      // `slug:px,py,pz@tx,ty,tz=name` (`@` works wherever `>` is awkward in a shell; `=name` names the file).
      const [slug = '', modeRaw = 'cover'] = spec.split(':');
      const [modeNamed = 'cover', label] = modeRaw.split('=');
      const mode = modeNamed.replace('@', '>');
      log(`${spec}`);
      await open(page, server.url, slug);
      log(`  backend: ${(await page.evaluate(() => document.body.innerText.match(/WebGPU|WebGL2/)?.[0] ?? 'unknown'))}`);
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
      } else if (mode === 'editor') {
        // The editor as a person first sees it: the studio's own framing, the whole page.
        await page.waitForTimeout(2500);
        await page.screenshot({ path: join(outDir!, `${slug}-editor.png`) });
        log(`  wrote ${join(outDir!, `${slug}-editor.png`)}`);
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
        // One or more explicit cameras on the same loaded world: `px,py,pz>tx,ty,tz[#label]` joined by `|`.
        const cams = spec.slice(slug.length + 1).split('=')[0]!.split('|');
        for (const [n, camSpec] of cams.entries()) {
          const [pose = '', tag = cams.length > 1 ? String(n + 1) : ''] = camSpec.split('#');
          const name = label && cams.length === 1 ? label : tag ? `cam-${tag}` : 'cam';
          const [a = '', b = ''] = pose.split('>');
          await setCam(page, a.split(',').map(Number), b.split(',').map(Number));
          await page.waitForTimeout(Number(process.env['SHOT_SETTLE'] ?? 2500));
          await shoot(page, join(outDir!, `${slug}-${name}.png`));
        }
      } else {
        const cam = COVER_CAMERAS[slug];
        if (cam) {
          if (cam.arch) await page.evaluate((v) => window.__aether?.store.getState().setArch({ ...v, quality: 'studio' }), cam.arch);
          // Block worlds: heights are relative to the terrain under the target.
          const g = cam.overGround ? await page.evaluate(([x, z]) => window.__aether?.simulation?.voxel?.groundAt(x as number, z as number) ?? 0, [cam.target[0], cam.target[2]] as const) : 0;
          await setCam(page, [cam.pos[0], cam.pos[1] + g, cam.pos[2]], [cam.target[0], cam.target[1] + g, cam.target[2]]);
          await page.waitForTimeout(cam.overGround ? 10_000 : 2500);
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
