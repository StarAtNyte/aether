/**
 * Frame cost of the finishing chain: per render tier and per effect, in a real browser.
 *
 * For each target (Chromium on WebGPU, Chromium on WebGL2, Firefox on WebGL2) and flagship world, the
 * camera orbits slowly (every frame is dirty) with the frame rate uncapped, and the frame interval of the
 * render loop is recorded for each tier and for the ultra tier minus one effect at a time. The cost of an effect is the median
 * frame time of ultra minus the median without it. Prints a Markdown table.
 *
 * One browser at a time, closed in `finally`. `AETHER_E2E_GPU=1` uses the machine's GPU in Chromium
 * (default: a software rasteriser, where numbers are only relative). Firefox runs on its own GL.
 *
 * Run: `npm run build && npm run e2e:render-bench -- [--only=chromium-webgpu|chromium-webgl2|firefox]
 * [--worlds=skyline-penthouse,four-seasons-garden] [--frames=24] [--size=2560x1440]`
 */
import { chromium, firefox, type Browser, type Page } from 'playwright';
import { CHROME_ARGS, FIREFOX_PREFS, SKIP_FIRST_RUN, findChrome, findFirefox, startServer } from './support/env';
import { COVER_CAMERAS } from './support/showcase-cameras';

const ARGS = process.argv.slice(2);
const arg = (name: string): string | undefined => ARGS.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const ONLY = arg('only');
const WORLDS = (arg('worlds') ?? 'skyline-penthouse,four-seasons-garden').split(',').filter(Boolean);
const FRAMES = Math.max(4, Math.min(120, Number(arg('frames') ?? 24)));
const [W, H] = (arg('size') ?? '2560x1440').split('x').map(Number) as [number, number];
const EFFECTS = ['ao', 'taa', 'contact', 'ssr', 'shafts', 'halation', 'aberration', 'grain'] as const;
const TIMEOUT = 150_000;
const startedAt = performance.now();

function log(line: string): void {
  process.stdout.write(`[${((performance.now() - startedAt) / 1000).toFixed(1).padStart(6)}s] ${line}\n`);
}

interface Target {
  name: string;
  launch(): Promise<Browser>;
  hideWebGPU: boolean;
}

/** No vsync and no frame-rate cap: a GPU-bound loop then runs at the GPU's own pace. */
const UNCAPPED = ['--disable-gpu-vsync', '--disable-frame-rate-limit'];

const TARGETS: readonly Target[] = [
  { name: 'chromium-webgpu', launch: () => chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS, ...UNCAPPED] }), hideWebGPU: false },
  { name: 'chromium-webgl2', launch: () => chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS, ...UNCAPPED] }), hideWebGPU: true },
  { name: 'firefox', launch: () => firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } }), hideWebGPU: false },
];

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
  await page.waitForFunction(() => window.__aether?.simulation?.renderer.animating === false, null, { timeout: TIMEOUT, polling: 500 }).catch(() => undefined);
  await page.evaluate(() => {
    const st = window.__aether?.store.getState();
    st?.setPanel('left', false);
    st?.setPanel('right', false);
    st?.updateSettings({ showNavHint: false });
  });
  await page.waitForTimeout(600);
}

interface Row {
  label: string;
  median: number;
  p90: number;
  effects: string;
}

async function measure(page: Page, pose: readonly number[], tier: string, off: readonly string[], quality: 'realtime' | 'studio' | 'final', skyDetail?: boolean): Promise<Row & { failed: string }> {
  return page.evaluate(
    async ([t, offList, q, frames, p, sky]) => {
      const r = window.__aether?.simulation?.renderer as unknown as {
        setRenderTier(t: string): void;
        setRenderQuality(q: string): string;
        setEffects(o: Record<string, boolean>): void;
        setAdaptiveResolution(on: boolean): void;
        requestRender(): void;
        setCameraPose(x: number, y: number, z: number, yaw: number, pitch: number): void;
        intendedEffects: string[];
        failedEffectNames: string[];
      };
      const overrides: Record<string, boolean> = {};
      for (const k of offList as string[]) overrides[k] = false;
      r.setAdaptiveResolution(false);
      r.setRenderQuality(q as string);
      r.setRenderTier(t as string);
      r.setEffects(overrides);
      // Sky detail (cirrus veil and sun rays) follows the tier unless a row forces it.
      if (typeof sky === 'boolean') (r as unknown as { env: { sky: { setDetail(on: boolean): void } } }).env.sky.setDetail(sky);
      const pose = p as number[];
      let yaw = pose[3] as number;
      const times: number[] = [];
      const warm = 14;
      // A slow orbit keeps every frame dirty (the viewport draws on demand) and exercises the temporal passes.
      await new Promise<void>((done) => {
        let n = 0;
        let last = performance.now();
        const step = (now: number): void => {
          times.push(now - last);
          last = now;
          yaw += 0.002;
          r.setCameraPose(pose[0] as number, pose[1] as number, pose[2] as number, yaw, pose[4] as number);
          r.requestRender();
          if (++n < (frames as number) + warm) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      });
      const sorted = times.slice(warm).sort((x, y) => x - y);
      const at = (f: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * f))] as number;
      return { label: '', median: at(0.5), p90: at(0.9), effects: r.intendedEffects.join('+') || '-', failed: r.failedEffectNames.join(',') };
    },
    [tier, [...off], quality, FRAMES, [...pose], skyDetail] as const,
  );
}

function fmt(n: number): string {
  return n.toFixed(2).padStart(7);
}

async function runTarget(target: Target, url: string): Promise<void> {
  const browser = await target.launch();
  try {
    for (const slug of WORLDS) {
      const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
      await context.addInitScript({ content: SKIP_FIRST_RUN });
      await context.addInitScript({ content: 'globalThis.__name = (f) => f;' });
      if (target.hideWebGPU) {
        await context.addInitScript(() => {
          delete (Navigator.prototype as unknown as Record<string, unknown>)['gpu'];
        });
      }
      try {
        const page = await context.newPage();
        await open(page, url, slug);
        const cam = COVER_CAMERAS[slug];
        let pose: number[] = [0, 2, 10, 0, 0];
        if (cam?.arch) await page.evaluate((view) => window.__aether?.store.getState().setArch(view), cam.arch);
        if (cam) {
          await page.evaluate(([p, t]) => {
            const dx = t[0] - p[0];
            const dy = t[1] - p[1];
            const dz = t[2] - p[2];
            window.__aether?.simulation?.renderer.setCameraPose(p[0], p[1], p[2], Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
          }, [cam.pos, cam.target] as const);
          const dx = cam.target[0] - cam.pos[0];
          const dy = cam.target[1] - cam.pos[1];
          const dz = cam.target[2] - cam.pos[2];
          pose = [cam.pos[0], cam.pos[1], cam.pos[2], Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))];
        }
        await page.waitForTimeout(1500);
        const info = await page.evaluate(() => {
          const r = window.__aether?.simulation?.renderer;
          const s = r?.stats();
          return `${window.__aether?.simulation?.backend ?? '?'} on ${(r?.gpu.description ?? '?').slice(0, 56)} (${r?.gpu.tier ?? '?'}); ${s?.drawCalls ?? 0} draw calls, ${(s?.triangles ?? 0).toLocaleString()} triangles`;
        });
        log(`${target.name} · ${slug}: ${info}`);
        const ladder: Array<{ label: string; tier: string; off: string[]; quality: 'realtime' | 'studio' | 'final' }> = [
          { label: 'low (direct)', tier: 'low', off: [], quality: 'realtime' },
          { label: 'medium', tier: 'medium', off: [], quality: 'realtime' },
          { label: 'high', tier: 'high', off: [], quality: 'realtime' },
          { label: 'ultra', tier: 'ultra', off: [], quality: 'realtime' },
          { label: 'final (stills)', tier: 'ultra', off: [], quality: 'final' },
        ];
        const rows: Array<Row & { failed: string }> = [];
        for (const l of ladder) {
          const r = await measure(page, pose, l.tier, l.off, l.quality);
          rows.push({ ...r, label: l.label });
        }
        const ultra = rows.find((r) => r.label === 'ultra');
        log('| tier | median ms | p90 ms | effects |');
        log('|---|---:|---:|---|');
        for (const r of rows) log(`| ${r.label} | ${fmt(r.median)} | ${fmt(r.p90)} | ${r.effects}${r.failed ? ` (failed: ${r.failed})` : ''} |`);
        log('| effect (ultra minus…) | median ms | cost ms |');
        log('|---|---:|---:|');
        for (const e of EFFECTS) {
          const r = await measure(page, pose, 'ultra', [e], 'realtime');
          log(`| ${e} | ${fmt(r.median)} | ${fmt((ultra?.median ?? 0) - r.median)} |`);
        }
        // The sky layers of this stage (cirrus veil, sun rays): the medium tier with them forced off and on.
        const skyOff = await measure(page, pose, 'medium', [], 'realtime', false);
        const skyOn = await measure(page, pose, 'medium', [], 'realtime', true);
        log(`| sky detail (medium, off / on) | ${fmt(skyOff.median)} / ${fmt(skyOn.median)} | ${fmt(skyOn.median - skyOff.median)} |`);
        const bare = await measure(page, pose, 'ultra', [...EFFECTS], 'realtime');
        log(`| (composite only) | ${fmt(bare.median)} | ${fmt((ultra?.median ?? 0) - bare.median)} (all seven) |`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  const server = await startServer(log);
  try {
    for (const t of TARGETS) {
      if (ONLY && t.name !== ONLY) continue;
      await runTarget(t, server.url);
    }
    log('RENDER BENCH DONE');
  } finally {
    await server.stop();
  }
}

main().catch((e: unknown) => {
  log(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
