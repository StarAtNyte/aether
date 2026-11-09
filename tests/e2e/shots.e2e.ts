/**
 * Fixed-camera render shots: opens flagship worlds at their cover cameras
 * and saves PNGs, for screenshot-driven look development and before/after
 * comparisons.
 *
 * Run: `npm run build && npm run shots -- --out=<dir>` with options
 *   --slug=a,b     only flagship slugs containing one of these
 *   --realtime     capture the interactive look (default: the final-render look)
 *   --gpu          Chromium on the real GPU through WebGL2 (fast local iteration)
 *   --firefox      Firefox (WebGL2) instead of Chromium
 *   --webgl2       force the WebGL2 backend in Chromium
 *   --size=WxH     capture size (default 1600x900)
 *   --preset=name  grade preset (neutral, golden, dusk, overcast, night)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, firefox, type Browser, type Page } from 'playwright';
import { SHOWCASE } from '../../apps/studio/src/showcase/manifest';
import { COVER_CAMERAS } from './support/showcase-cameras';
import { decodePng, pixelStats } from './support/png';
import { CHROME_ARGS, FIREFOX_PREFS, REPO_ROOT, SKIP_FIRST_RUN, findChrome, findFirefox, startServer } from './support/env';

const ARGS = process.argv.slice(2);
const arg = (name: string): string | undefined => ARGS.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const OUT = resolve(arg('out') ?? join(REPO_ROOT, 'docs/screenshots/photoreal'));
const FILTERS = (arg('slug') ?? '').split(',').filter(Boolean);
const REALTIME = ARGS.includes('--realtime');
const GPU = ARGS.includes('--gpu');
const FIREFOX = ARGS.includes('--firefox');
const WEBGL2 = ARGS.includes('--webgl2');
const PRESET = arg('preset');
const [W, H] = (arg('size') ?? '1600x900').split('x').map(Number) as [number, number];
const VIEWPORT = { width: 1440, height: 900 };
/** Chromium flags that expose the real GPU through ANGLE/Vulkan (WebGL2 only; headless has no WebGPU adapter). */
const GPU_ARGS = ['--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan', '--disable-vulkan-surface'];

const startedAt = performance.now();
function log(line: string): void {
  process.stdout.write(`[${((performance.now() - startedAt) / 1000).toFixed(1).padStart(6)}s] ${line}\n`);
}

async function capture(page: Page, url: string, slug: string): Promise<void> {
  await page.goto(`${url}/?debug=1#/new/${slug}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const a = window.__aether;
    if (!a || a.simulation === null) return false;
    const st = a.store.getState();
    const w = a.history.current;
    return st.loading === null && !st.agentBusy && (Object.keys(w.entities).length > 0 || w.voxel !== undefined);
  }, null, { timeout: 120_000, polling: 250 });
  await page.evaluate(async () => {
    await window.__aether?.simulation?.whenSynced();
  });
  await page.waitForFunction(() => window.__aether?.simulation?.renderer.animating === false, null, { timeout: 150_000, polling: 500 }).catch(() => log('  (still animating, continuing)'));
  const cam = COVER_CAMERAS[slug];
  if (cam?.arch) {
    await page.evaluate(([view, rt]) => window.__aether?.store.getState().setArch({ ...view, ...(rt ? {} : { quality: 'studio' as const }) }), [cam.arch, REALTIME] as const);
    await page.waitForTimeout(2000);
  }
  if (!REALTIME) await page.evaluate(() => window.__aether?.simulation?.renderer.setRenderQuality('studio'));
  if (PRESET) await page.evaluate((p) => (window.__aether?.simulation?.renderer as unknown as { setGradePreset?: (n: string) => void })?.setGradePreset?.(p), PRESET);
  if (cam) {
    await page.evaluate(([p, t, overGround]) => {
      const sim = window.__aether?.simulation;
      const g = overGround ? (sim?.voxel?.groundAt(t[0], t[2]) ?? 0) : 0;
      const dx = t[0] - p[0];
      const dy = t[1] - p[1];
      const dz = t[2] - p[2];
      sim?.renderer.setCameraPose(p[0], p[1] + g, p[2], Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
    }, [cam.pos, cam.target, cam.overGround === true] as const);
    await page.waitForTimeout(cam.overGround ? 10_000 : 2000);
  }
  if (!REALTIME) await page.waitForFunction(() => (window.__aether?.simulation?.renderer.refineProgress ?? 1) >= 0.98, null, { timeout: 90_000, polling: 400 }).catch(() => log('  (refinement unfinished)'));
  const t0 = performance.now();
  // The first capture of a freshly opened world can come back black (the capture target was drawn before the first
  // frame's pipelines finished compiling): draw a few frames and capture again until the picture has content.
  let png = Buffer.alloc(0);
  let stats = { mean: 0, stdDev: 0 };
  for (let attempt = 0; attempt < 4; attempt++) {
    const dataUrl = await page.evaluate(async ([w, h]) => (await window.__aether?.simulation?.renderer.screenshot({ width: w, height: h, mime: 'image/png' })) ?? null, [W, H] as const);
    if (!dataUrl?.startsWith('data:image/png;base64,')) throw new Error(`${slug}: capture failed`);
    png = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
    stats = pixelStats(decodePng(png));
    if (stats.mean >= 4) break;
    log(`  ${slug}: black capture (mean ${stats.mean.toFixed(1)}), retrying`);
    await page.waitForTimeout(1500);
  }
  writeFileSync(join(OUT, `${slug}.png`), png);
  log(`  ${slug}: mean ${stats.mean.toFixed(0)}, stddev ${stats.stdDev.toFixed(1)}, capture ${(performance.now() - t0).toFixed(0)} ms`);
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const server = await startServer(log);
  let browser: Browser | null = null;
  try {
    browser = FIREFOX
      ? await firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } })
      : await chromium.launch({ executablePath: findChrome(), args: GPU ? ['--enable-unsafe-webgpu', ...GPU_ARGS] : [...CHROME_ARGS] });
    for (const e of SHOWCASE.filter((x) => !x.film)) {
      if (e.origin !== 'flagship' || (FILTERS.length > 0 && !FILTERS.some((f) => e.slug.includes(f)))) continue;
      const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
      await context.addInitScript({ content: SKIP_FIRST_RUN });
      await context.addInitScript({ content: 'globalThis.__name = (f) => f;' });
      if (WEBGL2 || GPU) await context.addInitScript({ content: "delete Navigator.prototype.gpu;" });
      try {
        const page = await context.newPage();
        page.on('pageerror', (err) => log(`  pageerror: ${err.message}`));
        page.on('console', (m) => (m.type() === 'warning' || m.type() === 'error') && log(`  console.${m.type()}: ${m.text().slice(0, 240)}`));
        await capture(page, server.url, e.slug);
      } finally {
        await context.close();
      }
    }
    log('SHOTS DONE');
  } finally {
    await browser?.close();
    await server.stop();
  }
}

main().catch((err: unknown) => {
  log(`SHOTS FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
