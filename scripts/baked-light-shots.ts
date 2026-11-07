/**
 * Baked-light pictures in the editor at four hours, from fixed poses, for two builds side by side.
 *
 *   STATIC_DIR=<dist> GEN_GPU=intel npx tsx scripts/baked-light-shots.ts --out=<dir> --views=<file> [--light=<url of a cooked light/ folder>] [--bake-each=high] [--samples=256] [--tier=high] [slug]
 *
 * - `--light=<url>`: a build with re-lightable bakes; the cooked package's light files (`<dist>/cooked/<slug>/<id>/light/`, as a
 *   path under the server) are the editor's bundled folder, and a request at the publish quality (high, 256 rays) loads them
 *   (no bake, when the key matches), once.
 * - `--bake-each=<quality>`: a build before them; the lightmap is baked again at every hour (the single-time bake) with
 *   `--samples` rays.
 * `--views=<file>`: `[{ name, position, target }]`. The hours are the daylight study's 06:30, 12:00, 18:30 and 22:00.
 * Run it in a capped scope (docs/PERFORMANCE.md, Measuring).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import * as env from '../tests/e2e/support/env';

const args = process.argv.slice(2);
const flag = (k: string): string | undefined => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const out = resolve(flag('out') ?? 'probe-out/baked-light-shots');
const slug = args.find((a) => !a.startsWith('--')) ?? 'casa-patio';
const light = flag('light');
const bakeEach = flag('bake-each');
const samples = Number(flag('samples') ?? 256);
const tier = flag('tier');
const views = JSON.parse(readFileSync(flag('views') ?? '', 'utf8')) as Array<{ name: string; position: number[]; target: number[] }>;
mkdirSync(out, { recursive: true });
const T0 = Date.now();
const log = (s: string): void => void process.stdout.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${s}\n`);

type R = Record<string, unknown> & {
  processingStage: string | null;
  lightVolumeBaking?: boolean;
  lightmapStatus: { state: string; message: string };
  lightmapStats: unknown;
  lightmapBakesStarted: number;
  setCameraPose(x: number, y: number, z: number, yaw: number, pitch: number): void;
  setRenderTier(t: string): void;
  bakeLight(q: string, s: number): void;
  previewBakedLight?(on: boolean): void;
  lightmap: { opts: { staticBase: string | null } };
};

async function settle(page: Page): Promise<void> {
  const t0 = Date.now();
  let quiet = Date.now();
  while (Date.now() - t0 < 120_000) {
    const busy = await page.evaluate(() => {
      const r = (window as unknown as { __aether: { simulation: { renderer: R } } }).__aether.simulation.renderer;
      return r.processingStage !== null || r.lightVolumeBaking === true || r.lightmapStatus.state === 'baking' || r.lightmapStatus.state === 'waiting';
    });
    if (busy) quiet = Date.now();
    if (Date.now() - quiet > 3000) return;
    await page.waitForTimeout(250);
  }
}

async function main(): Promise<void> {
  const server = await env.startServer(() => undefined);
  const prof = mkdtempSync(join(homedir(), '.cache/aether-e2e-tmp/bl-shots-'));
  const report: Record<string, unknown> = { slug, light: light ?? null, bakeEach: bakeEach ?? null };
  try {
    const ctx = await chromium.launchPersistentContext(prof, { executablePath: env.findChrome(), args: [...env.CHROME_ARGS], headless: env.HEADLESS, viewport: { width: 1600, height: 900 } });
    try {
      await ctx.addInitScript(env.SKIP_FIRST_RUN);
      await ctx.addInitScript({ content: 'globalThis.__name = (f) => f;' });
      if (process.env['GEN_GPU'] === 'intel') await ctx.addInitScript({ content: 'delete Navigator.prototype.gpu; try { delete navigator.gpu; } catch {}' });
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      page.on('pageerror', (e) => log(`pageerror ${e.message.slice(0, 160)}`));
      await page.goto(`${server.url}/?debug=1#/new/${slug}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => performance.getEntriesByName('aether:fully-loaded').length + performance.getEntriesByName('aether:load-timeout').length > 0, null, { timeout: 300_000, polling: 500 });
      await page.waitForFunction(() => !document.querySelector('.vp-loading'), null, { timeout: 60_000, polling: 250 }).catch(() => undefined);
      if (tier) await page.evaluate((t) => (window as unknown as { __aether: { simulation: { renderer: R } } }).__aether.simulation.renderer.setRenderTier(t), tier);
      await settle(page);
      if (light) {
        await page.evaluate((base) => {
          const r = (window as unknown as { __aether: { simulation: { renderer: R } } }).__aether.simulation.renderer;
          r.lightmap.opts.staticBase = `${location.origin}${base.endsWith('/') ? base : `${base}/`}`;
          // The publish bake's quality looks the package's file up by its key (no bake when it matches).
          r.bakeLight('high', 256);
        }, light);
        await page.waitForFunction(() => (window as unknown as { __aether: { simulation: { renderer: R } } }).__aether.simulation.renderer.lightmapStatus.state === 'applied', null, { timeout: 1_800_000, polling: 1000 });
      }
      await page.addStyleTag({ content: 'body * { visibility: hidden !important; } canvas { visibility: visible !important; }' });
      const shots: Record<string, unknown> = {};
      for (const [name, hour] of [['dawn', 6.5], ['noon', 12], ['sunset', 18.5], ['night', 22]] as const) {
        await page.evaluate((h) => (window as unknown as { __aether: { store: { getState(): { setArch(p: { sunHour: number }): void } } } }).__aether.store.getState().setArch({ sunHour: h }), hour);
        await settle(page);
        if (bakeEach) {
          await page.evaluate(([q, n]) => (window as unknown as { __aether: { simulation: { renderer: R } } }).__aether.simulation.renderer.bakeLight(q as string, n as number), [bakeEach, samples] as const);
          await page.waitForTimeout(1000);
          await page.waitForFunction(() => (window as unknown as { __aether: { simulation: { renderer: R } } }).__aether.simulation.renderer.lightmapStatus.state === 'applied', null, { timeout: 3_600_000, polling: 2000 });
        }
        for (const v of views) {
          await page.evaluate(([p, t]) => {
            const r = (window as unknown as { __aether: { simulation: { renderer: R } } }).__aether.simulation.renderer;
            r.setCameraPose(p[0]!, p[1]!, p[2]!, Math.atan2(p[0]! - t[0]!, p[2]! - t[2]!), -Math.atan2(p[1]! - t[1]!, Math.hypot(p[0]! - t[0]!, p[2]! - t[2]!)));
          }, [v.position, v.target] as const);
          await settle(page);
          // The eye adapts and the picture's temporal filters settle over a few seconds after a jump of the camera.
          await page.waitForTimeout(5000);
          await page.locator('canvas').first().screenshot({ path: join(out, `${v.name}-${name}.png`) });
        }
        shots[name] = await page.evaluate(() => {
          const r = (window as unknown as { __aether: { simulation: { renderer: R } } }).__aether.simulation.renderer;
          return { lightmap: r.lightmapStatus.state, bakes: r.lightmapBakesStarted, stats: r.lightmapStats };
        });
        log(`${name}: ${JSON.stringify(shots[name]).slice(0, 240)}`);
      }
      report['shots'] = shots;
    } finally {
      await ctx.close();
    }
  } finally {
    await server.stop();
    rmSync(prof, { recursive: true, force: true });
  }
  writeFileSync(join(out, 'shots.json'), JSON.stringify(report, null, 2));
  log(`wrote ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
