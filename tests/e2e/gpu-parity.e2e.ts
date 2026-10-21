/**
 * WebGPU against WebGL2, side by side, in one browser: each world is opened twice (backend forced by the saved
 * setting), put in the same configuration (render tier, effect toggles, water tier), captured through the renderer's own
 * screenshot, and compared. A report line carries the backend that really ran (asserted), the effects that failed, the
 * graphics errors the page logged, the water state, the frame cost and how far the two images are apart. Side-by-side
 * PNGs go to the output directory. Not a pass/fail suite on its own pixels (the drivers differ in noise), but it fails
 * when a backend is not the one asked for, when WebGPU drops an effect that WebGL2 keeps, or when WebGPU logs errors.
 *
 *   AETHER_E2E_GPU=1 npx tsx tests/e2e/gpu-parity.e2e.ts <outDir> [--worlds=a,b] [--configs=name,name] [--size=1280x720]
 *
 * Configs: base (auto tier), low, medium, high, ultra, ao, gi, ssr, shafts, taa, water-standard, water-high, and
 * sun-medium, sun-high, sun-ultra (the sun's cascades, soft filter and contact shadows planned as on a hardware GPU, so
 * their shaders run on SwiftShader too).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { CHROME_ARGS, SKIP_FIRST_RUN, findChrome, startServer } from './support/env';
import { COVER_CAMERAS } from './support/showcase-cameras';
import { decodePng, type RgbaImage } from './support/png';
import { encodePng, imageDiff, sideBySide } from './support/png-encode';

const ARGS = process.argv.slice(2);
const outDir = ARGS.find((a) => !a.startsWith('--'));
if (!outDir) throw new Error('usage: gpu-parity <outDir> [--worlds=a,b] [--configs=a,b]');
const arg = (name: string): string | undefined => ARGS.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const WORLDS = (arg('worlds') ?? 'highland-trail,sakura-river').split(',').filter(Boolean);
const CONFIGS = (arg('configs') ?? 'base,high,ultra').split(',').filter(Boolean);
const [W, H] = (arg('size') ?? '1280x720').split('x').map(Number) as [number, number];
const log = (l: string): void => void process.stdout.write(`${l}\n`);

interface Config {
  tier: 'auto' | 'low' | 'medium' | 'high' | 'ultra';
  effects?: Record<string, boolean>;
  water?: 'standard' | 'high';
  /** Plan the sun's shadows as on a hardware GPU (cascades and the soft filter, also on a software rasteriser). */
  sun?: boolean;
}
const CONFIG: Readonly<Record<string, Config>> = {
  base: { tier: 'auto' },
  low: { tier: 'low' },
  medium: { tier: 'medium' },
  high: { tier: 'high' },
  ultra: { tier: 'ultra' },
  'sun-medium': { tier: 'medium', sun: true },
  'sun-high': { tier: 'high', sun: true },
  'sun-ultra': { tier: 'ultra', sun: true },
  ao: { tier: 'medium', effects: { ao: true } },
  gi: { tier: 'medium', effects: { gi: true } },
  ssr: { tier: 'medium', effects: { ssr: true } },
  shafts: { tier: 'medium', effects: { shafts: true } },
  taa: { tier: 'medium', effects: { taa: true } },
  'water-standard': { tier: 'low', water: 'standard' },
  'water-high': { tier: 'low', water: 'high' },
};

interface Run {
  backend: string;
  reason: string;
  failed: string[];
  errors: string[];
  water: unknown;
  gpu: string;
  frameMs: number;
  /** The sun's shadow maps: planned, drawn, and the filter. */
  sun: { cascades: number; maps: number; filter: string };
  png: Buffer;
}

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
  await page.evaluate(async () => void (await window.__aether?.simulation?.whenSynced()));
  await page.waitForFunction(() => window.__aether?.simulation?.renderer.animating === false, null, { timeout: 120_000, polling: 500 }).catch(() => log('  (still animating)'));
}

async function run(context: BrowserContext, url: string, slug: string, config: Config, wanted: 'webgpu' | 'webgl2'): Promise<Run> {
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 160)}`));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' || (m.type() === 'warning' && /webgpu|validation|invalid|sampler|binding/i.test(t))) errors.push(`${m.type()}: ${t.slice(0, 200)}`);
  });
  try {
    await open(page, url, slug);
    const cam = COVER_CAMERAS[slug];
    await page.evaluate(
      ([c, cm]) => {
        const r = window.__aether?.simulation?.renderer;
        if (!r) return;
        r.setRenderTier(c.tier);
        r.setEffects(c.effects ?? {});
        if (cm) {
          const dx = cm.target[0]! - cm.pos[0]!;
          const dy = cm.target[1]! - cm.pos[1]!;
          const dz = cm.target[2]! - cm.pos[2]!;
          r.setCameraPose(cm.pos[0]!, cm.pos[1]!, cm.pos[2]!, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
        }
      },
      [config, cam ?? null] as const,
    );
    await page.waitForTimeout(3500);
    await page.waitForFunction(() => (window.__aether?.simulation?.renderer.refineProgress ?? 1) >= 0.98, null, { timeout: 40_000, polling: 500 }).catch(() => undefined);
    const info = await page.evaluate(
      async ([w, h]) => {
        const sim = window.__aether?.simulation;
        const r = sim?.renderer;
        if (!sim || !r) return null;
        // Frame cost: the loop uncapped for 30 dirty frames.
        r.setAdaptiveResolution(false);
        const times: number[] = [];
        await new Promise<void>((done) => {
          let n = 0;
          let last = performance.now();
          const step = (now: number): void => {
            times.push(now - last);
            last = now;
            r.requestRender();
            if (++n < 40) requestAnimationFrame(step);
            else done();
          };
          requestAnimationFrame(step);
        });
        const sorted = times.slice(10).sort((a, b) => a - b);
        const shot = await r.screenshot({ width: w as number, height: h as number, mime: 'image/png' });
        return {
          backend: sim.backend,
          reason: r.gpu.report.reason,
          failed: [...r.failedEffectNames],
          water: r.waterDebug(),
          gpu: r.gpu.description,
          frameMs: sorted[Math.floor(sorted.length / 2)] ?? 0,
          sun: { cascades: r.sunShadowInfo.cascades, filter: r.sunShadowInfo.filter, maps: r.sunShadowInfo.boxes.filter((b) => b.hasMap).length },
          shot,
        };
      },
      [W, H] as const,
    );
    if (!info) throw new Error('no simulation');
    if (info.backend !== wanted) throw new Error(`asked for ${wanted} but ${info.backend} ran (${info.reason})`);
    return { backend: info.backend, reason: info.reason, failed: info.failed, errors, water: info.water, gpu: info.gpu, frameMs: info.frameMs, sun: info.sun, png: Buffer.from(info.shot.slice('data:image/png;base64,'.length), 'base64') };
  } finally {
    await page.close();
  }
}

async function main(): Promise<void> {
  mkdirSync(outDir!, { recursive: true });
  const server = await startServer(log);
  const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS, '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
  let bad = 0;
  try {
    log('| world | config | water | webgpu ms | webgl2 ms | mean diff | >24 share | luma gpu/gl | failed (gpu / gl) | gpu errors |');
    log('|---|---|---|---:|---:|---:|---:|---|---|---|');
    for (const slug of WORLDS) {
      for (const name of CONFIGS) {
        const config = CONFIG[name];
        if (!config) throw new Error(`unknown config ${name}`);
        const contexts = {} as Record<'webgpu' | 'webgl2', BrowserContext>;
        for (const be of ['webgpu', 'webgl2'] as const) {
          const c = await browser.newContext({ viewport: { width: W, height: H } });
          await c.addInitScript(SKIP_FIRST_RUN);
          await c.addInitScript({ content: 'globalThis.__name = (f) => f;' });
          await c.addInitScript(`try { localStorage.setItem('aether.studio.settings.v1', JSON.stringify({ backend: '${be}' })); } catch {}`);
          if (config.water) await c.addInitScript(`globalThis.__WATER_TIER = '${config.water}';`);
          if (config.sun) await c.addInitScript('globalThis.__SUN_SHADOWS_ON_SOFTWARE = true;');
          contexts[be] = c;
        }
        let gpu: Run;
        let gl: Run;
        try {
          gpu = await run(contexts.webgpu, server.url, slug, config, 'webgpu');
          gl = await run(contexts.webgl2, server.url, slug, config, 'webgl2');
        } catch (e) {
          bad++;
          for (const c of Object.values(contexts)) await c.close();
          log(`| ${slug} | ${name} | | | | | | | FAILED: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)} | |`);
          continue;
        }
        for (const c of Object.values(contexts)) await c.close();
        const a: RgbaImage = decodePng(gpu.png);
        const b: RgbaImage = decodePng(gl.png);
        const d = imageDiff(a, b);
        writeFileSync(join(outDir!, `${slug}-${name}-webgpu.png`), gpu.png);
        writeFileSync(join(outDir!, `${slug}-${name}-webgl2.png`), gl.png);
        writeFileSync(join(outDir!, `${slug}-${name}-pair.png`), encodePng(sideBySide(a, b)));
        const w = gpu.water as { tier: string };
        const dropped = gpu.failed.filter((f) => !gl.failed.includes(f));
        if (dropped.length > 0 || gpu.errors.length > 0) bad++;
        // The sun configs must really run the cascades (every map drawn) on both backends.
        for (const [be, res] of [['webgpu', gpu], ['webgl2', gl]] as const) {
          log(`  ${slug} ${name} ${be}: sun ${res.sun.cascades} maps (${res.sun.maps} drawn), ${res.sun.filter}`);
          if (config.sun && (res.sun.cascades < 2 || res.sun.maps !== res.sun.cascades)) bad++;
        }
        log(
          `| ${slug} | ${name} | ${w.tier} | ${gpu.frameMs.toFixed(1)} | ${gl.frameMs.toFixed(1)} | ${d.mean.toFixed(2)} | ${(d.share * 100).toFixed(1)}% | ${d.meanLumaA.toFixed(0)}/${d.meanLumaB.toFixed(0)} | ${gpu.failed.join(',') || '-'} / ${gl.failed.join(',') || '-'} | ${gpu.errors.length}${gpu.errors[0] ? ` ${gpu.errors[0]}` : ''} |`,
        );
      }
    }
  } finally {
    await browser.close();
    await server.stop();
  }
  if (bad > 0) {
    log(`${bad} configuration(s) diverge`);
    process.exitCode = 1;
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
