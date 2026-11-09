/**
 * Render-quality shots: opens flagship worlds from their saved worlds, flies to the cover camera, applies a
 * render quality tier and writes a PNG per world (plus the measured frame time) for side-by-side review.
 *
 * Run: `npm run build && npm run e2e:photoreal -- --out=<dir> [--firefox] [--tier=<tier>] [slug…]`
 * Tiers: low | medium | high | ultra | final (default: the world's own default quality).
 * One browser at a time (Chromium WebGPU via SwiftShader, or Firefox WebGL2).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, firefox, type Browser, type Page } from 'playwright';
import { SHOWCASE } from '../../apps/studio/src/showcase/manifest';
import { CHROME_ARGS, FIREFOX_PREFS, SKIP_FIRST_RUN, findChrome, findFirefox, startServer } from './support/env';
import { decodePng, pixelStats } from './support/png';
import { COVER_CAMERAS } from './support/showcase-cameras';
import { LABS } from './support/photoreal-labs';

const ARGS = process.argv.slice(2);
const OUT_ARG = ARGS.find((a) => a.startsWith('--out='));
const TIER_ARG = ARGS.find((a) => a.startsWith('--tier='));
const OUT_DIR = resolve(OUT_ARG ? OUT_ARG.slice('--out='.length) : 'photoreal-out');
const TIER = TIER_ARG ? TIER_ARG.slice('--tier='.length) : null;
const FIREFOX = ARGS.includes('--firefox');
/** `--pt=<samples>`: render the shot as a path-traced still with that many samples (size from `--ptsize=WxH`, default 960x540). */
const PT = ARGS.find((a) => a.startsWith('--pt='))?.slice(5) ?? null;
const PT_SIZE = (ARGS.find((a) => a.startsWith('--ptsize='))?.slice(9) ?? '960x540').split('x').map(Number) as [number, number];
/** `--lab=lights|materials|water`: replace the open world with a test world (see support/photoreal-labs.ts). */
const LAB = ARGS.find((a) => a.startsWith('--lab='))?.slice(6) ?? null;
/** `--cam=px,py,pz,tx,ty,tz`: shoot from this eye towards this target instead of the flagship's cover camera; `--arch=up|cutaway|down` sets the walls. */
const CAM = (ARGS.find((a) => a.startsWith("--cam="))?.slice(6) ?? "").split(",").map(Number) as number[];
const ARCH_WALLS = ARGS.find((a) => a.startsWith('--arch='))?.slice(7) ?? null;
/** `--name=<file>`: output file stem (default: the slug). */
const NAME = ARGS.find((a) => a.startsWith('--name='))?.slice(7) ?? null;
/** `--backend=webgpu|webgl2`: force the renderer backend (default: the studio's automatic policy). */
const BACKEND = ARGS.find((a) => a.startsWith('--backend='))?.slice(10) ?? null;
/** `--final`: render the shot as a Final render still (1920×1080, 2× supersampled) instead of a viewport capture. */
const FINAL = ARGS.includes('--final');
/** `--still`: like `--final` but the studio (photoreal) quality. */
const STILL = ARGS.includes('--still');
const OFF = (ARGS.find((a) => a.startsWith('--off='))?.slice(6) ?? '').split(',').filter(Boolean);
const ON = (ARGS.find((a) => a.startsWith('--on='))?.slice(5) ?? '').split(',').filter(Boolean);
const FILTERS = ARGS.filter((a) => !a.startsWith('--') && !/^-?[\d.,-]+$/.test(a));
const VIEWPORT = { width: 1600, height: 900 };
const TIMEOUT = 120_000;
const startedAt = performance.now();

function log(line: string): void {
  process.stdout.write(`[${((performance.now() - startedAt) / 1000).toFixed(1).padStart(6)}s] ${line}\n`);
}

async function open(page: Page, url: string, slug: string): Promise<void> {
  await page.goto(`${url}/?debug=1#/new/${slug}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => {
      const a = window.__aether;
      if (!a || a.simulation === null) return false;
      const st = a.store.getState();
      const w = a.history.current;
      return st.loading === null && !st.agentBusy && (Object.keys(w.entities).length > 0 || w.voxel !== undefined);
    },
    null,
    { timeout: TIMEOUT, polling: 250 },
  );
  await page.evaluate(async () => {
    await window.__aether?.simulation?.whenSynced();
  });
  await page.waitForFunction(() => window.__aether?.simulation?.renderer.animating === false, null, { timeout: 150_000, polling: 500 }).catch(() => log('  (still animating, continuing)'));
  await page.waitForTimeout(1200);
}

async function shoot(page: Page, url: string, slug: string): Promise<void> {
  page.on('console', (m) => {
    if (m.text().startsWith('still plan') || m.text().startsWith('path trace') || m.text().startsWith('DBG')) log(m.text());
    if ((ARGS.includes('--verbose') || /disabled|failed|error|lost/i.test(m.text())) && !/GPU stall|GL Driver/i.test(m.text())) {
      log(`  console ${m.type()}: ${m.text().slice(0, 240)}`);
      if (m.type() === 'error') void Promise.all(m.args().map((a) => a.evaluate((v: unknown) => (v instanceof Error ? `${v.name}: ${v.message}` : typeof v === 'object' ? JSON.stringify(v) : String(v))).catch(() => '?'))).then((parts) => log(`    args: ${parts.join(' | ').slice(0, 400)}`));
    }
  });
  await open(page, url, slug);
  // The shot is the whole canvas: side panels and overlays out of the way (the viewport keeps the capture's aspect).
  await page.evaluate(() => {
    const st = window.__aether?.store.getState();
    st?.updateSettings({ showPerf: false, showNavHint: false });
    st?.setPanel('left', false);
    st?.setPanel('right', false);
  });
  await page.addStyleTag({ content: '.nav-hint, .toasts, .toast, .tooltip, .vp-overlay, .arch-bar, .vp-bottom, .vp-gizmo, .vp-context, .proof-seal, .vp-labels { display: none !important; }' });
  await page.waitForTimeout(600);
  if (LAB) {
    const lab = LABS[LAB];
    if (!lab) throw new Error(`unknown lab "${LAB}"`);
    const err = await page.evaluate((patches) => (window.__aether ? (window.__aether.studio.commitUser(patches as never, 'Lab') ?? '') : 'no studio'), lab.patches);
    if (err !== '') throw new Error(`lab rejected: ${err}`);
    await page.evaluate(async () => {
      await window.__aether?.simulation?.whenSynced();
    });
    await page.waitForTimeout(1500);
    CAM.splice(0, CAM.length, ...lab.cam.pos, ...lab.cam.target);
  }
  const own = CAM.length === 6 && CAM.every(Number.isFinite) ? { pos: [CAM[0] as number, CAM[1] as number, CAM[2] as number] as const, target: [CAM[3] as number, CAM[4] as number, CAM[5] as number] as const, arch: ARCH_WALLS ? { walls: ARCH_WALLS as 'up' | 'cutaway' | 'down' } : undefined } : null;
  const cam = own ? { ...own, overGround: false } : COVER_CAMERAS[slug];
  if (cam?.arch) {
    await page.evaluate((view) => window.__aether?.store.getState().setArch(view), cam.arch);
    await page.waitForTimeout(2500);
  }
  if (TIER) {
    await page.evaluate((tier) => {
      const r = window.__aether?.simulation?.renderer as unknown as { setRenderTier?: (t: string) => void; setRenderQuality: (q: string) => void } | undefined;
      if (r?.setRenderTier) r.setRenderTier(tier);
      else r?.setRenderQuality(tier === 'low' || tier === 'medium' ? 'realtime' : 'studio');
    }, TIER);
  }
  if (OFF.length > 0 || ON.length > 0) {
    await page.evaluate(([off, on]) => {
      const r = window.__aether?.simulation?.renderer as unknown as { setEffects(o: Record<string, boolean>): void } | undefined;
      const o: Record<string, boolean> = {};
      for (const k of off as string[]) o[k] = false;
      for (const k of on as string[]) o[k] = true;
      r?.setEffects(o);
    }, [OFF, ON] as const);
  }
  if (cam) {
    await page.evaluate(([p, t, overGround]) => {
      const sim = window.__aether?.simulation;
      const g = overGround ? (sim?.voxel?.groundAt(t[0], t[2]) ?? 0) : 0;
      const dx = t[0] - p[0];
      const dy = t[1] - p[1];
      const dz = t[2] - p[2];
      // lookAt keeps the orbit target consistent with the view (stills read the pose back from it).
      sim?.renderer.lookAt([p[0], p[1] + g, p[2]], [t[0], t[1] + g, t[2]]);
      void dx;
      void dy;
      void dz;
    }, [cam.pos, cam.target, cam.overGround === true] as const);
    await page.waitForTimeout(cam.overGround ? 12_000 : 2500);
  }
  await page.waitForFunction(() => (window.__aether?.simulation?.renderer.refineProgress ?? 1) >= 0.98, null, { timeout: 120_000, polling: 500 }).catch(() => log('  (refinement unfinished)'));
  const fps = await page.evaluate(() => window.__aether?.store.getState().stats.fps ?? 0);
  const effects = await page.evaluate(() => {
    const r = window.__aether?.simulation?.renderer as unknown as { activeEffects?: Record<string, boolean>; renderTier?: string; failedEffectNames?: string[]; backend?: string } | undefined;
    return `${r?.backend ?? '?'} ${r?.renderTier ?? '?'} [${Object.entries(r?.activeEffects ?? {}).filter(([, v]) => v).map(([k]) => k).join(',')}] failed=[${(r?.failedEffectNames ?? []).join(',')}]`;
  });
  log(`  ${slug}: ${effects}`);
  const t0 = performance.now();
  const dataUrl = PT
    ? await page.evaluate(
        async ([samples, w, h]) => {
          const r = window.__aether?.simulation?.renderer;
          if (!r) return null;
          const pose = r.cameraPose();
          console.log(`path trace pose ${JSON.stringify(pose)}`);
          let lastPhase = '';
          const img = await r.pathTraceStill({
            width: w as number,
            height: h as number,
            samples: samples as number,
            pose,
            fStop: 5.6,
            onProgress: (done, total, phase) => {
              console.log(`path trace ${phase} ${done}/${total} t=${Math.round(performance.now())}`);
              lastPhase = phase;
            },
          });
          const c = new OffscreenCanvas(img.width, img.height);
          const ctx = c.getContext('2d');
          if (!ctx) return null;
          ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
          const blob = await c.convertToBlob({ type: 'image/png' });
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let bin = '';
          for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          return `data:image/png;base64,${btoa(bin)}`;
        },
        [Number(PT), PT_SIZE[0], PT_SIZE[1]] as const,
      )
    : FINAL || STILL
    ? await page.evaluate(async (final) => {
        const r = window.__aether?.simulation?.renderer;
        if (!r) return null;
        r.setRenderQuality(final ? 'final' : 'studio');
        await r.preparePost();
        const pose = r.cameraPose();
        const plan = r.planStill(1920, 1080, final ? 'final' : 'studio');
        console.log('still plan', JSON.stringify(plan), r.gpu.tier);
        const img = await r.renderStill({ width: 1920, height: 1080, pose, frames: plan.frames, tileSize: plan.tileSize, ...(plan.supersample > 1 ? { supersample: plan.supersample } : {}) });
        const c = new OffscreenCanvas(img.width, img.height);
        const ctx = c.getContext('2d');
        if (!ctx) return null;
        ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
        const blob = await c.convertToBlob({ type: 'image/png' });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return `data:image/png;base64,${btoa(bin)}`;
      }, FINAL)
    : await page.evaluate(async () => (await window.__aether?.simulation?.renderer.screenshot({ width: 1600, height: 900, mime: 'image/png' })) ?? null);
  if (FINAL || STILL || PT) log(`  ${slug}: still rendered in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  if (!dataUrl) throw new Error(`${slug}: capture failed`);
  const png = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
  writeFileSync(join(OUT_DIR, `${NAME ?? slug}.png`), png);
  const stats = pixelStats(decodePng(png));
  log(`  ${slug}: ${fps} fps, mean ${stats.mean.toFixed(0)}, stddev ${stats.stdDev.toFixed(1)}`);
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const server = await startServer(log);
  let browser: Browser | null = null;
  try {
    browser = FIREFOX ? await firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } }) : await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
    for (const entry of SHOWCASE.filter((x) => !x.film)) {
      if (entry.origin !== 'flagship' || (FILTERS.length > 0 && !FILTERS.some((f) => entry.slug.includes(f)))) continue;
      const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
      await context.addInitScript({ content: SKIP_FIRST_RUN });
      await context.addInitScript({ content: 'globalThis.__name = (f) => f;' });
      if (BACKEND) await context.addInitScript({ content: `try { localStorage.setItem('aether.studio.settings.v1', JSON.stringify({ backend: ${JSON.stringify(BACKEND)} })); } catch {}` });
      try {
        await shoot(await context.newPage(), server.url, entry.slug);
      } finally {
        await context.close();
      }
    }
    log('PHOTOREAL SHOTS DONE');
  } finally {
    await browser?.close();
    await server.stop();
  }
}

main().catch((e: unknown) => {
  log(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
