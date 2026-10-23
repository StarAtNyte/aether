/**
 * Frame cost of the DEFAULT view (studio render, automatic tier) on the bundled showcase rooms, and of the
 * pieces it is made of. Chromium on the integrated GPU (`GEN_GPU=intel`, WebGL2 over ANGLE) is the target; with
 * software GL the numbers are relative only.
 *
 * Per room: the default state after the page settles (quality, tier, effects, shadow maps, draw calls,
 * triangles, programs, texture MB, baked light), then the median and p90 frame interval of a slow orbit
 * (no vsync, every frame dirty) for the default and for configurations that take one piece out.
 * `--stills` also saves a PNG of the default view and of the full chain after it rested.
 *
 * Run: `npm run build && GEN_GPU=intel npx tsx tests/e2e/default-perf.e2e.ts [--worlds=a,b] [--frames=40] [--size=1920x1080] [--rows=default,realtime,...] [--stills=dir]`
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { CHROME_ARGS, SKIP_FIRST_RUN, findChrome, startServer } from './support/env';
import { COVER_CAMERAS } from './support/showcase-cameras';

const ARGS = process.argv.slice(2);
const arg = (name: string): string | undefined => ARGS.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const WORLDS = (arg('worlds') ?? 'photo-hotel-bedroom,photo-twin-room,photo-vaulted-bedroom,skyline-penthouse,casa-patio').split(',').filter(Boolean);
const FRAMES = Math.max(8, Math.min(200, Number(arg('frames') ?? 40)));
const [W, H] = (arg('size') ?? '1920x1080').split('x').map(Number) as [number, number];
const ROWS = arg('rows')?.split(',');
const STILLS = arg('stills');
const WEAK = arg('weak') !== undefined;
const VSYNC = arg('vsync') !== undefined;
const PROFILE = arg('profile') !== undefined;
const TIMEOUT = 150_000;
const t0 = performance.now();
const log = (line: string): void => void process.stdout.write(`[${((performance.now() - t0) / 1000).toFixed(1).padStart(6)}s] ${line}\n`);

interface Cfg {
  id: string;
  quality?: 'realtime' | 'studio';
  tier?: string;
  off?: string[];
  /** Keep the automatic tier and the governor (the real default). */
  auto?: boolean;
  /** Code run in the page with `r` (the renderer) before the measurement. */
  js?: string;
  /** Code run after the measurement to undo `js`. */
  after?: string;
}

const BASE = { quality: 'realtime' as const, tier: 'low' };
/** Named page hooks (the page's CSP forbids evaluating strings): `js` runs before the measurement, `after` undoes it. */
const EXTRA: Cfg[] = [
  { id: 'low-no-sunshadow', ...BASE, js: 'shadow-off', after: 'shadow-on' },
  { id: 'low-no-lightmap', ...BASE, js: 'lm-off', after: 'lm-on' },
  { id: 'low-half-res', ...BASE, js: 'half', after: 'full' },
  { id: 'low-quarter-res', ...BASE, js: 'quarter', after: 'full' },
  { id: 'low-no-shadow-no-lm', ...BASE, js: 'shadow-lm-off', after: 'shadow-lm-on' },
  { id: 'low-vol-off', ...BASE, js: 'vol-off', after: 'vol-on' },
  { id: 'low-all-light-off', ...BASE, js: 'all-off', after: 'all-on' },
  { id: 'low-plain', ...BASE, js: 'plain', after: 'plain-off' },
  { id: 'low-all-off-plain', ...BASE, js: 'all-off-plain', after: 'all-on-plain-off' },
  { id: 'low-no-env', ...BASE, js: 'no-env', after: 'env-on' },
  { id: 'low-std-override', ...BASE, js: 'std', after: 'std-off' },
  { id: 'low-std-override-noshadow', ...BASE, js: 'std-noshadow', after: 'std-off' },
  { id: 'low-ground-hidden', ...BASE, js: 'ground-hide', after: 'ground-show' },
  { id: 'low-ground-simple', ...BASE, js: 'ground-simple', after: 'ground-restore' },
  { id: 'medium-lean', quality: 'realtime', tier: 'medium', js: 'lean', after: 'lean-off' },
  { id: 'low-lean', ...BASE, js: 'lean', after: 'lean-off' },
  { id: 'gs-base', ...BASE, js: 'ground-simple', after: 'ground-restore' },
  { id: 'gs-noshadow', ...BASE, js: 'ground-simple+shadow-off', after: 'ground-restore+shadow-on' },
  { id: 'gs-noenv', ...BASE, js: 'ground-simple+no-env', after: 'ground-restore+env-on' },
  { id: 'gs-nolm', ...BASE, js: 'ground-simple+lm-off', after: 'ground-restore+lm-on' },
  { id: 'gs-novol', ...BASE, js: 'ground-simple+vol-off', after: 'ground-restore+vol-on' },
  { id: 'gs-alloff', ...BASE, js: 'ground-simple+all-off', after: 'ground-restore+all-on' },
  { id: 'gs-alloff-noenv', ...BASE, js: 'ground-simple+all-off+no-env', after: 'ground-restore+all-on+env-on' },
  { id: 'default-no-hdri', auto: true, js: 'no-hdri' },
  { id: 'default-no-skydetail', auto: true, js: 'no-sky' },
  { id: 'default-no-hdri-no-sky', auto: true, js: 'no-hdri-sky' },
];
const STUDIO_PIECES = ['ao', 'taa', 'contact', 'ssr', 'shafts', 'halation', 'aberration', 'grain'];
const CONFIGS: Cfg[] = [
  ...EXTRA,
  { id: 'default', auto: true },
  { id: 'realtime-auto', quality: 'realtime', auto: true },
  { id: 'realtime-low', quality: 'realtime', tier: 'low' },
  { id: 'realtime-medium', quality: 'realtime', tier: 'medium' },
  { id: 'realtime-high', quality: 'realtime', tier: 'high' },
  { id: 'studio', quality: 'studio', tier: 'ultra' },
  ...STUDIO_PIECES.map((p) => ({ id: `studio-no-${p}`, quality: 'studio' as const, tier: 'ultra', off: [p] })),
  { id: 'realtime-ultra', quality: 'realtime', tier: 'ultra' },
  ...STUDIO_PIECES.map((p) => ({ id: `only-${p}`, quality: 'studio' as const, tier: 'ultra', off: STUDIO_PIECES.filter((q) => q !== p) })),
  ...['ssr', 'shafts', 'halation', 'aberration'].map((p) => ({ id: `high+${p}`, quality: 'studio' as const, tier: 'ultra', off: ['ssr', 'shafts', 'halation', 'aberration'].filter((q) => q !== p) })),
  { id: 'high+ssr+shafts', quality: 'studio', tier: 'ultra', off: ['halation', 'aberration'] },
  { id: 'high+halation+aberration', quality: 'studio', tier: 'ultra', off: ['ssr', 'shafts'] },
  { id: 'studio-composite-only', quality: 'studio', tier: 'ultra', off: STUDIO_PIECES },
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
  await page.evaluate(() => {
    const st = window.__aether?.store.getState();
    st?.setPanel('left', false);
    st?.setPanel('right', false);
    st?.updateSettings({ showNavHint: false });
  });
  // The bundled lightmap is applied after the first frames.
  await page.waitForFunction(() => (window.__aether?.simulation?.renderer as unknown as { lightmapStatus: { state: string } }).lightmapStatus.state !== 'baking', null, { timeout: 60_000, polling: 500 }).catch(() => undefined);
  await page.waitForTimeout(4000);
}

type R = {
  setRenderTier(t: string): void;
  setRenderQuality(q: string): string;
  setEffects(o: Record<string, boolean>): void;
  setAdaptiveResolution(on: boolean): void;
  requestRender(): void;
  setCameraPose(x: number, y: number, z: number, yaw: number, pitch: number): void;
  stats(): Record<string, number>;
  memoryStats(): Record<string, unknown>;
  sunShadowInfo: { cascades: number; filter: string; mapSizes: number[] };
  intendedEffects: string[];
  renderQuality: string;
  renderTier: string;
  lightmapStatus: { state: string };
  lightmapStats: { source?: string; texels?: number } | null;
  frameCount: number;
  renderer: { getContext?: () => WebGL2RenderingContext; info: { programs?: unknown[]; memory: Record<string, number> }; domElement: HTMLCanvasElement };
};

async function lights(page: Page): Promise<string> {
  return page.evaluate(() => {
    const r = window.__aether?.simulation?.renderer as unknown as { scene: { traverse(f: (o: Record<string, unknown>) => void): void } };
    const out: string[] = [];
    r.scene.traverse((o) => {
      if (o['isLight'] === true) out.push(`${String(o['type'])}${o['castShadow'] ? '+shadow' : ''}${o['visible'] === false ? '(hidden)' : ''}${typeof o['intensity'] === 'number' ? '@' + (o['intensity'] as number).toFixed(1) : ''}`);
    });
    const counts = new Map<string, number>();
    for (const l of out) counts.set(l, (counts.get(l) ?? 0) + 1);
    return [...counts.entries()].map(([k, v]) => `${k}x${v}`).join(' ');
  });
}

async function describe(page: Page): Promise<string> {
  return page.evaluate(() => {
    const r = window.__aether?.simulation?.renderer as unknown as R;
    const s = r.stats();
    const m = r.memoryStats() as Record<string, number | string>;
    const sh = r.sunShadowInfo;
    return `quality=${r.renderQuality} tier=${r.renderTier} fx=[${r.intendedEffects.join('+')}] level=${s['performanceLevel']} scale=${s['resolutionScale']} | draws=${s['drawCalls']} tris=${s['triangles']} sceneTris=${s['sceneTriangles']} programs=${r.renderer.info.programs?.length ?? '?'} | shadow cascades=${sh.cascades} maps=${sh.mapSizes.join('/')} filter=${sh.filter} | textures=${m['textures']} (${m['texturesMB']} MB) buf=${(m['drawingBuffer'] as unknown as number[]).join('x')} | lightmap=${r.lightmapStatus.state}${r.lightmapStats ? ` ${r.lightmapStats.source}` : ''}`;
  });
}

async function measure(page: Page, pose: readonly number[], cfg: Cfg): Promise<{ median: number; p90: number; cpu: number; state: string }> {
  return page.evaluate(
    async ([c, frames, p]) => {
      const cfg = c as Cfg;
      const r = window.__aether?.simulation?.renderer as unknown as R;
      const hook = async (rr: R, name: string): Promise<void> => {
        const x = rr as unknown as {
          env: { sun: { castShadow: boolean }; setAutoHdri(on: boolean): void; sky: { setDetail(on: boolean): void } };
          lightmap: { setEnabled(on: boolean): void };
          adaptive: { scale: number };
          governor: { level: number };
          applyPerformance(): void;
          plainMaterials(on: boolean): void;
          scene: { environment: unknown; background: unknown; __env?: unknown; overrideMaterial: unknown; traverse(f: (o: { material?: { constructor: new (o: object) => unknown } }) => void): void };
          resize(w: number, h: number): void;
          cssWidth: number;
          cssHeight: number;
        };
        const scale = (k: number): void => {
          x.adaptive.scale = k;
          x.resize(x.cssWidth, x.cssHeight);
        };
        if (name === 'shadow-off' || name === 'shadow-lm-off') x.env.sun.castShadow = false;
        if (name === 'shadow-on' || name === 'shadow-lm-on') x.env.sun.castShadow = true;
        if (name === 'lm-off' || name === 'shadow-lm-off') x.lightmap.setEnabled(false);
        if (name === 'lm-on' || name === 'shadow-lm-on') x.lightmap.setEnabled(true);
        if (name === 'half') scale(0.5);
        if (name === 'quarter') scale(0.25);
        if (name === 'full') scale(1);
        if (name === 'no-hdri' || name === 'no-hdri-sky') x.env.setAutoHdri(false);
        if (name === 'no-sky' || name === 'no-hdri-sky') x.env.sky.setDetail(false);
        if (name === 'vol-off' || name === 'all-off' || name === 'all-off-plain') {
          x.governor.level = 1;
          x.applyPerformance();
        }
        if (name === 'vol-on' || name === 'all-on' || name === 'all-on-plain-off') {
          x.governor.level = 0;
          x.applyPerformance();
        }
        if (name === 'all-off' || name === 'all-off-plain') {
          x.env.sun.castShadow = false;
          x.lightmap.setEnabled(false);
        }
        if (name === 'all-on' || name === 'all-on-plain-off') {
          x.env.sun.castShadow = true;
          x.lightmap.setEnabled(true);
        }
        if (name === 'lean') (x as unknown as { forceLean: boolean | null }).forceLean = true;
        if (name === 'lean-off') (x as unknown as { forceLean: boolean | null }).forceLean = null;
        if (name === 'plain' || name === 'all-off-plain') x.plainMaterials(true);
        if (name === 'plain-off' || name === 'all-on-plain-off') x.plainMaterials(false);
        if (name === 'no-env') {
          x.scene.__env = x.scene.environment;
          x.scene.environment = null;
        }
        if (name === 'env-on') x.scene.environment = x.scene.__env ?? null;
        if (name === 'std' || name === 'std-noshadow') {
          let ctor: (new (o: object) => unknown) | null = null;
          x.scene.traverse((o) => {
            if (!ctor && o.material && o.material.constructor.name.includes('Standard')) ctor = o.material.constructor;
          });
          if (ctor) x.scene.overrideMaterial = new (ctor as new (o: object) => unknown)({ color: 0xb4b8c0, roughness: 0.8 });
          if (name === 'std-noshadow') x.env.sun.castShadow = false;
        }
        if (name === 'ground-hide' || name === 'ground-show' || name === 'ground-simple' || name === 'ground-restore') {
          x.scene.traverse((o) => {
            const m = o as unknown as { name: string; visible: boolean; material: unknown; __mat?: unknown };
            if (m.name !== 'aether:ground' && m.name !== 'aether:ground-skirt') return;
            if (name === 'ground-hide') m.visible = false;
            if (name === 'ground-show') m.visible = true;
            if (name === 'ground-simple') {
              m.__mat = m.material;
              const old = m.material as { constructor: new (o: object) => unknown };
              m.material = new old.constructor({ color: 0x556b2f, roughness: 0.9 });
            }
            if (name === 'ground-restore' && m.__mat) m.material = m.__mat;
          });
        }
        if (name === 'std-off') {
          x.scene.overrideMaterial = null;
          x.env.sun.castShadow = true;
        }
        r.requestRender();
        await new Promise((res) => setTimeout(res, 1500));
      };
      if (!cfg.auto) {
        r.setAdaptiveResolution(false);
        r.setRenderQuality(cfg.quality ?? 'realtime');
        r.setRenderTier(cfg.tier ?? 'ultra');
        const o: Record<string, boolean> = {};
        for (const k of cfg.off ?? []) o[k] = false;
        r.setEffects(o);
      } else if (cfg.quality) r.setRenderQuality(cfg.quality);
      if (cfg.js) for (const j of cfg.js.split('+')) await hook(r, j);
      const pose = p as number[];
      let yaw = pose[3] as number;
      const run = (n: number, record: number[] | null): Promise<void> =>
        new Promise<void>((done) => {
          let i = 0;
          let last = performance.now();
          const step = (now: number): void => {
            record?.push(now - last);
            last = now;
            yaw += 0.002;
            r.setCameraPose(pose[0] as number, pose[1] as number, pose[2] as number, yaw, pose[4] as number);
            r.requestRender();
            if (++i < n) requestAnimationFrame(step);
            else done();
          };
          requestAnimationFrame(step);
        });
      // Let pipelines and shaders build, then settle.
      await run(20, null);
      for (let w = 0; w < 120; w++) {
        const want = r.intendedEffects.length > 0;
        const has = (r as unknown as { post?: unknown }).post != null;
        if (!want || has) break;
        await new Promise((res) => setTimeout(res, 500));
      }
      await new Promise((res) => setTimeout(res, 1500));
      await new Promise((res) => setTimeout(res, 2500));
      await run(150, null);
      const be = (r.renderer as unknown as { backend?: { gl?: WebGL2RenderingContext } }).backend;
      const gl = be?.gl ?? r.renderer.getContext?.();
      // GPU time per drawn frame from timer queries wrapped around the whole draw (nothing nested; skipped when the extension is missing).
      const tq = gl ? (gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null) : null;
      const rr = r as unknown as { draw: (...a: unknown[]) => void; __origDraw?: (...a: unknown[]) => void; __q: Array<{ q: WebGLQuery; rest: boolean }>; atRest?: boolean };
      if (gl && tq && !rr.__origDraw) {
        rr.__origDraw = rr.draw;
        rr.__q = [];
        rr.draw = function (this: unknown, ...a: unknown[]): void {
          const q = gl.createQuery();
          const rest = rr.atRest === true;
          gl.beginQuery(tq.TIME_ELAPSED_EXT, q);
          try {
            rr.__origDraw!.apply(this, a);
          } finally {
            gl.endQuery(tq.TIME_ELAPSED_EXT);
            rr.__q.push({ q, rest });
          }
        };
      }
      const gpuBlocks: string[] = [];
      const rafMed: number[] = [];
      let moveScale = 0;
      // Three blocks; the smallest is reported (the iGPU is shared with other jobs on this machine).
      let best = Number.POSITIVE_INFINITY;
      let bestP90 = 0;
      const blocks: number[] = [];
      for (let blk = 0; blk < 3; blk++) {
        gl?.finish();
        if (rr.__q) rr.__q = [];
        const fc0 = r.frameCount;
        const t0 = performance.now();
        const times: number[] = [];
        await run(frames as number, times);
        gl?.finish();
        const wall = performance.now() - t0;
        const perFrame = wall / Math.max(1, r.frameCount - fc0);
        blocks.push(perFrame);
        moveScale = r.stats()['resolutionScale'] as number;
        if (gl && tq && rr.__q.length > 0) {
          const mine = rr.__q;
          rr.__q = [];
          for (let w = 0; w < 60; w++) {
            if (gl.getQueryParameter(mine[mine.length - 1]!.q, gl.QUERY_RESULT_AVAILABLE)) break;
            await new Promise((res) => setTimeout(res, 50));
          }
          const sum: { move: [number, number]; rest: [number, number] } = { move: [0, 0], rest: [0, 0] };
          for (const { q, rest } of mine) {
            if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
              const t = sum[rest ? 'rest' : 'move'];
              t[0] += (gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6;
              t[1]++;
            }
            gl.deleteQuery(q);
          }
          gpuBlocks.push(`${sum.move[1] ? (sum.move[0] / sum.move[1]).toFixed(1) : '-'}x${sum.move[1]}+${sum.rest[1] ? (sum.rest[0] / sum.rest[1]).toFixed(1) : '-'}x${sum.rest[1]}`);
        }
        const sorted = times.slice(2).sort((x, y) => x - y);
        rafMed.push(sorted[Math.floor(sorted.length / 2)] as number);
        if (perFrame < best) {
          best = perFrame;
          bestP90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] as number;
        }
      }
      (window as unknown as { __dbg: string }).__dbg = `rafMed=${rafMed.map((v) => v.toFixed(1)).join('/')} scaleInMotion=${moveScale} gpu(move x n+rest x n)=${gpuBlocks.join(' | ')} blocks=${blocks.map((b) => b.toFixed(0)).join('/')}`;
      if (cfg.after) for (const j of cfg.after.split('+')) await hook(r, j);
      const s = r.stats();
      return { median: best, p90: bestP90, cpu: s['frameMs'] as number, state: `${(window as unknown as { __dbg: string }).__dbg} ad=${String((r as unknown as { adaptive: { enabled: boolean; smoothedFps: number } }).adaptive.enabled)}/${String((r as unknown as { atRest: boolean }).atRest)}/${(r as unknown as { adaptive: { smoothedFps: number } }).adaptive.smoothedFps.toFixed(0)} post=${(r as unknown as { post?: { key: string } | null }).post?.key ?? 'none'} maps=${r.sunShadowInfo.mapSizes.join('/')} ${r.renderQuality}/${r.renderTier} fx=${r.intendedEffects.length} lvl=${s['performanceLevel']} scale=${s['resolutionScale']} draws=${s['drawCalls']}` };
    },
    [cfg, FRAMES, [...pose]] as const,
  );
}

/** GPU ms per frame with each top-level scene child hidden in turn (its share of the frame). */
async function bisect(page: Page, pose: readonly number[]): Promise<string[]> {
  return page.evaluate(async (p) => {
    const r = window.__aether?.simulation?.renderer as unknown as R & {
      scene: { children: Array<{ name: string; type: string; visible: boolean; children: unknown[] }> };
      draw: (...a: unknown[]) => void;
      __origDraw?: (...a: unknown[]) => void;
      __q: Array<{ q: WebGLQuery; rest: boolean }>;
    };
    const gl = (r.renderer as unknown as { backend: { gl: WebGL2RenderingContext } }).backend.gl;
    const tq = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number };
    if (!r.__origDraw) {
      r.__origDraw = r.draw;
      r.__q = [];
      r.draw = function (this: unknown, ...a: unknown[]): void {
        const q = gl.createQuery();
        gl.beginQuery(tq.TIME_ELAPSED_EXT, q);
        try {
          r.__origDraw!.apply(this, a);
        } finally {
          gl.endQuery(tq.TIME_ELAPSED_EXT);
          r.__q.push({ q, rest: false });
        }
      };
    }
    let yaw = p[3] as number;
    const frames = async (n: number): Promise<void> => {
      for (let i = 0; i < n; i++) {
        await new Promise<void>((res) => requestAnimationFrame(() => res()));
        yaw += 0.002;
        r.setCameraPose(p[0] as number, p[1] as number, p[2] as number, yaw, p[4] as number);
        r.requestRender();
      }
    };
    const gpu = async (): Promise<number> => {
      await frames(8);
      r.__q = [];
      await frames(16);
      const mine = r.__q;
      r.__q = [];
      for (let w = 0; w < 60 && !gl.getQueryParameter(mine[mine.length - 1]!.q, gl.QUERY_RESULT_AVAILABLE); w++) await new Promise((res) => setTimeout(res, 50));
      let ns = 0;
      let n = 0;
      for (const { q } of mine) {
        if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
          ns += gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
          n++;
        }
        gl.deleteQuery(q);
      }
      return ns / 1e6 / Math.max(1, n);
    };
    const out: string[] = [];
    const base = await gpu();
    out.push(`all visible: ${base.toFixed(1)} ms`);
    for (const c of r.scene.children) {
      if (!c.visible) continue;
      c.visible = false;
      const t = await gpu();
      c.visible = true;
      out.push(`without ${c.type} "${c.name}" (${c.children.length} children): ${t.toFixed(1)} ms (${(base - t).toFixed(1)} saved)`);
      if (c.name === 'aether:environment') {
        for (const k of c.children as Array<{ name: string; type: string; visible: boolean; material?: { type?: string; transparent?: boolean }; geometry?: { type?: string } }>) {
          if (!k.visible) continue;
          k.visible = false;
          const t2 = await gpu();
          k.visible = true;
          out.push(`   - without ${k.type} "${k.name}" ${k.geometry?.type ?? ''} ${k.material?.type ?? ''}${k.material?.transparent ? ' transparent' : ''}: ${t2.toFixed(1)} ms (${(base - t2).toFixed(1)} saved)`);
        }
      }
    }
    return out;
  }, pose);
}

async function main(): Promise<void> {
  const server = await startServer(log);
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ executablePath: findChrome(), args: VSYNC ? [...CHROME_ARGS] : [...CHROME_ARGS, '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
    const rows: string[] = [];
    for (const slug of WORLDS) {
      const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
      await context.addInitScript({ content: SKIP_FIRST_RUN });
      await context.addInitScript({ content: 'globalThis.__name = (f) => f;' });
      if (WEAK) {
        await context.addInitScript(() => {
          Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 2 });
          Object.defineProperty(navigator, 'deviceMemory', { get: () => 2 });
        });
      }
      if (process.env['GEN_GPU'] === 'intel' && process.env['AETHER_WEBGPU'] !== '1') {
        await context.addInitScript(() => {
          delete (Navigator.prototype as unknown as Record<string, unknown>)['gpu'];
        });
      }
      try {
        const page = await context.newPage();
        await open(page, server.url, slug);
        const cam = COVER_CAMERAS[slug];
        // Default camera: the world's own start; the pose read back so the orbit starts there.
        let pose: number[] = await page.evaluate(() => {
          const r = window.__aether?.simulation?.renderer as unknown as { cameraPose(): { pos: number[]; target: number[] } };
          const c = r.cameraPose();
          const dx = c.target[0]! - c.pos[0]!;
          const dy = c.target[1]! - c.pos[1]!;
          const dz = c.target[2]! - c.pos[2]!;
          return [c.pos[0]!, c.pos[1]!, c.pos[2]!, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))];
        });
        if (cam) {
          if (cam.arch) await page.evaluate((view) => window.__aether?.store.getState().setArch(view), cam.arch);
          const dx = cam.target[0] - cam.pos[0];
          const dy = cam.target[1] - cam.pos[1];
          const dz = cam.target[2] - cam.pos[2];
          pose = [cam.pos[0], cam.pos[1], cam.pos[2], Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))];
        }
        await page.waitForTimeout(1500);
        log(`${slug}: ${await describe(page)}`);
        log(`${slug}: lights ${await lights(page)}`);
        if (arg('bisect') !== undefined) {
          await page.evaluate(() => (window.__aether?.simulation?.renderer as unknown as R).setRenderTier('low'));
          await page.waitForTimeout(3000);
          for (const line of await bisect(page, pose)) log(`${slug}: ${line}`);
        }
        for (const cfg of CONFIGS) {
          if (ROWS && !ROWS.includes(cfg.id)) continue;
          let cdp: import('playwright').CDPSession | null = null;
          if (PROFILE) {
            cdp = await page.context().newCDPSession(page);
            await cdp.send('Profiler.enable');
            await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
          }
          if (cdp) await measure(page, pose, { ...cfg, id: 'warm' });
          if (cdp) await cdp.send('Profiler.start');
          const m = await measure(page, pose, cfg);
          if (cdp) {
            const { profile } = (await cdp.send('Profiler.stop')) as { profile: { nodes: Array<{ id: number; callFrame: { functionName: string; url: string; lineNumber: number }; children?: number[] }>; samples: number[]; timeDeltas: number[] } };
            const self = new Map<number, number>();
            profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));
            const byName = new Map<string, number>();
            for (const n of profile.nodes) {
              const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`;
              byName.set(k, (byName.get(k) ?? 0) + (self.get(n.id) ?? 0));
            }
            const top = [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18);
            for (const [k, v] of top) log(`   prof ${(v / 1000).toFixed(0).padStart(6)} ms  ${k}`);
            await cdp.detach();
          }
          const line = `| ${slug} | ${cfg.id} | ${m.median.toFixed(1)} | ${m.p90.toFixed(1)} | ${m.cpu.toFixed(1)} | ${m.state} |`;
          rows.push(line);
          log(line);
          if (cfg.id === 'default') log(`${slug}: after default run: ${await describe(page)}`);
        }
        if (STILLS) {
          mkdirSync(STILLS, { recursive: true });
          for (const [name, q] of [['default', null], ['realtime', 'realtime'], ['studio', 'studio']] as const) {
            await page.evaluate((qq) => {
              const r = window.__aether?.simulation?.renderer as unknown as R;
              if (qq) {
                r.setRenderQuality(qq);
                r.setRenderTier('auto');
                r.setEffects({});
              }
              r.requestRender();
            }, q);
            await page.waitForTimeout(6000);
            log(`${slug} still ${name}: ${await describe(page)}`);
            const png = await page.screenshot();
            writeFileSync(join(STILLS, `${slug}-${name}.png`), png);
          }
        }
      } finally {
        await context.close();
      }
    }
    log('| world | config | ms/frame (GPU incl.) | p90 rAF ms | cpu ms | state |');
    for (const r of rows) log(r);
    log('DEFAULT PERF DONE');
  } finally {
    await browser?.close();
    await server.stop();
  }
}

main().catch((e: unknown) => {
  log(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
