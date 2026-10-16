/**
 * Eye-level and exterior stills of architecture worlds, for look development:
 * opens a bundled project (`--slug`) or builds a prompt (`--prompt`), applies an
 * optional wall edit script, and renders each camera of a JSON file with the
 * final-render look.
 *
 * Run: `npm run build && npx tsx tests/e2e/archshots.e2e.ts --slug=skyline-penthouse --cams=cams.json --out=<dir> [--gpu] [--realtime] [--size=WxH] [--fov=deg] [--hour=17.5]`
 * `--hide=a,b` hides entities whose id starts with a prefix; `--set=id~path~value,…` overrides a property.
 * `cams.json`: `[{ "name": "living", "pos": [x, y, z], "target": [x, y, z], "walls": "up"|"cutaway"|"down" }]`
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, firefox, type Browser, type Page } from 'playwright';
import { decodePng, pixelStats } from './support/png';
import { CHROME_ARGS, FIREFOX_PREFS, SKIP_FIRST_RUN, findChrome, findFirefox, startServer } from './support/env';

const ARGS = process.argv.slice(2);
const arg = (name: string): string | undefined => ARGS.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const OUT = resolve(arg('out') ?? '/tmp/aether-archshots');
const WORLD = arg('world');
/** A `--world` file takes the place of the bundled `apartment` template in the (disposable) build output. */
const SLUG = WORLD ? 'apartment' : arg('slug');
const PROMPT = arg('prompt');
const CAMS = JSON.parse(readFileSync(resolve(arg('cams') ?? 'cams.json'), 'utf8')) as Array<{ name: string; pos?: [number, number, number]; target?: [number, number, number]; walls?: 'up' | 'cutaway' | 'down'; fov?: number; js?: string; hour?: number }>;
const REALTIME = ARGS.includes('--realtime');
const GPU = ARGS.includes('--gpu');
const FIREFOX = ARGS.includes('--firefox');
const [W, H] = (arg('size') ?? '1600x900').split('x').map(Number) as [number, number];
const HOUR = arg('hour');
const PRESET = arg('preset');
/** `--fx=ao:0,shafts:0`: force post effects on (1) or off (0) while debugging a look. */
const FX = (arg('fx') ?? '').split(',').filter(Boolean).map((p) => p.split(':') as [string, string]);
/** `--sunshadow=0`: switch the sun's shadow map off (isolates shadow artefacts). */
const SUNSHADOW = arg('sunshadow');
const GPU_ARGS = ['--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan', '--disable-vulkan-surface'];

const startedAt = performance.now();
function log(line: string): void {
  process.stdout.write(`[${((performance.now() - startedAt) / 1000).toFixed(1).padStart(6)}s] ${line}\n`);
}

async function open(page: Page, url: string): Promise<void> {
  if (SLUG) await page.goto(`${url}/?debug=1#/new/${SLUG}`, { waitUntil: 'domcontentloaded' });
  else {
    await page.goto(`${url}/?debug=1#/new`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__aether?.simulation !== null && window.__aether?.store.getState().loading === null, null, { timeout: 90_000 });
    const input = page.getByLabel('Prompt', { exact: true });
    await input.fill(PROMPT ?? 'a modern two-bedroom apartment');
    await input.press('Enter');
  }
  await page.waitForFunction(() => {
    const a = window.__aether;
    if (!a || a.simulation === null) return false;
    const st = a.store.getState();
    return st.loading === null && !st.agentBusy && Object.keys(a.history.current.entities).length > 0;
  }, null, { timeout: 150_000, polling: 250 });
  await page.evaluate(async () => {
    await window.__aether?.simulation?.whenSynced();
    window.__aether?.studio.playtest.cancel();
    window.__aether?.studio.playtest.stopReplay();
  });
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  if (WORLD) {
    // `--world=<file>`: a bare world document (or an exported envelope) served as a template for this run.
    const raw = JSON.parse(readFileSync(resolve(WORLD), 'utf8')) as { world?: unknown };
    const dir = resolve(import.meta.dirname, '../../apps/studio/dist/templates/worlds');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'apartment.json'), JSON.stringify(raw.world ? raw : { format: 'aether-world', version: 1, world: raw }));
  }
  const server = await startServer(log);
  let browser: Browser | null = null;
  try {
    browser = FIREFOX
      ? await firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } })
      : await chromium.launch({ executablePath: findChrome(), args: GPU ? ['--enable-unsafe-webgpu', ...GPU_ARGS] : [...CHROME_ARGS] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await context.addInitScript({ content: SKIP_FIRST_RUN });
    await context.addInitScript({ content: 'globalThis.__name = (f) => f;' });
    if (GPU) await context.addInitScript({ content: 'delete Navigator.prototype.gpu;' });
    const page = await context.newPage();
    page.on('pageerror', (err) => log(`  pageerror: ${err.message}`));
    await open(page, server.url);
    if (HOUR) {
      const hour = Number(HOUR);
      await page.evaluate((h) => {
        const env = window.__aether!.history.current.environment;
        window.__aether!.simulation!.renderer.setEnvironmentOverride({ ...env, timeOfDay: h, sky: h > 19 || h < 5 ? 'night' : env.sky });
      }, hour);
    }
    if (PRESET) await page.evaluate((p) => (window.__aether?.simulation?.renderer as unknown as { setGradePreset?: (n: string) => void })?.setGradePreset?.(p), PRESET);
    if (FX.length > 0) await page.evaluate((fx) => window.__aether?.simulation?.renderer.setEffects(Object.fromEntries(fx.map(([k, v]) => [k, v === '1']))), FX);
    if (SUNSHADOW !== undefined) await page.evaluate((on) => { (window.__aether!.simulation!.renderer as unknown as { env: { sun: { castShadow: boolean } } }).env.sun.castShadow = on; }, SUNSHADOW === '1');
    const hide = (arg('hide') ?? '').split(',').filter(Boolean);
    if (hide.length > 0) await page.evaluate((prefixes) => Object.keys(window.__aether!.history.current.entities).filter((id) => prefixes.some((p) => id.startsWith(p))).forEach((id) => window.__aether?.simulation?.renderer.setEntityProperty(id, 'visible', false)), hide);
    for (const cam of CAMS) {
      if (cam.hour !== undefined) {
        await page.evaluate((h) => {
          const env = window.__aether!.history.current.environment;
          window.__aether!.simulation!.renderer.setEnvironmentOverride({ ...env, timeOfDay: h, sky: h > 19 || h < 5 ? 'night' : env.sky });
        }, cam.hour);
      }
      /** Per-camera look-development hook: `js` runs in the page with `renderer` in scope. */
      if (cam.js) {
        const res = await page.evaluate(([code]) => String(new Function('renderer', code)(window.__aether!.simulation!.renderer) ?? ''), [cam.js] as const);
        if (res) log(`  js(${cam.name}): ${res}`);
      }
      await page.evaluate(([walls, rt]) => window.__aether?.store.getState().setArch({ walls, ...(rt ? {} : { quality: 'studio' as const }) }), [cam.walls ?? 'up', REALTIME] as const);
      if (!REALTIME) await page.evaluate(() => window.__aether?.simulation?.renderer.setRenderQuality('studio'));
      if (cam.pos && cam.target) await page.evaluate(([p, t, fov]) => {
        const sim = window.__aether?.simulation;
        const dx = t[0] - p[0];
        const dy = t[1] - p[1];
        const dz = t[2] - p[2];
        sim?.renderer.setCameraPose(p[0], p[1], p[2], Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
        if (fov) (sim?.renderer.camera as unknown as { fov: number; updateProjectionMatrix(): void }).fov = fov;
        (sim?.renderer.camera as unknown as { updateProjectionMatrix(): void }).updateProjectionMatrix();
      }, [cam.pos, cam.target, cam.fov ?? Number(arg('fov') ?? 0)] as const);
      await page.waitForTimeout(1500);
      if (!REALTIME) await page.waitForFunction(() => (window.__aether?.simulation?.renderer.refineProgress ?? 1) >= 0.98, null, { timeout: 120_000, polling: 400 }).catch(() => log('  (refinement unfinished)'));
      const dataUrl = await page.evaluate(async ([w, h]) => (await window.__aether?.simulation?.renderer.screenshot({ width: w, height: h, mime: 'image/png' })) ?? null, [W, H] as const);
      if (!dataUrl?.startsWith('data:image/png;base64,')) throw new Error(`${cam.name}: capture failed`);
      const png = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
      const stats = pixelStats(decodePng(png));
      writeFileSync(join(OUT, `${cam.name}.png`), png);
      log(`  ${cam.name}: mean ${stats.mean.toFixed(0)}, stddev ${stats.stdDev.toFixed(1)}`);
    }
    await context.close();
    log('ARCHSHOTS DONE');
  } finally {
    await browser?.close();
    await server.stop();
  }
}

main().catch((err: unknown) => {
  log(`ARCHSHOTS FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
