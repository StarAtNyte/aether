/**
 * Daylight drag probe: drag the time-of-day sliders the way a person does and measure what the page pays for it.
 *
 *   STATIC_DIR=<dist> GEN_GPU=intel npx tsx scripts/daylight-drag-probe.ts --out=<dir> [--sliders=arch,inspector] [--shots] [--profile] [--tier=high] [--cost] [world]
 *
 * Per slider (the architecture bar's daylight study, the inspector's scene time) it records, for an idle window, a slow
 * 3 s drag and a fast drag across the sky presets (dawn, day, sunset, night) and back:
 * - frame times (requestAnimationFrame intervals: p50, p95, max);
 * - main-thread tasks over 50 ms (long tasks: count, sum, longest) and long animation frames with their scripts;
 * - program links (`linkProgram`) and programs held by three;
 * - undo entries the drag left in the history;
 * - how long the page takes to settle after the drag (the renderer's processing stage clear, no long task for 1 s).
 * `--shots` writes settled pictures of a fixed three-quarter view (interface hidden) at 06:30 (dawn), 12:00, 18:30 (sunset) and
 * 22:00 (night), after the drags (`--sliders=` with nothing: the shots alone).
 * `--profile` writes a CPU profile of each fast drag (`<slider>-fast.cpuprofile`).
 * `--tier=` sets the render tier after the load (low, medium, high, ultra) and waits for it to settle.
 * `--cost` measures the frame cost at 12:00, 22:00 and 12:00 again before the drags, from the fixed three-quarter view:
 * bursts of frames drawn back to back, each a new node frame, timed on the GPU (a timer query; the fastest burst's
 * median is the one to compare when another page shares the GPU) and to a pixel read back.
 * `--lamp-ab` measures what the lamps switched off in daylight would cost if they were shaded: at 12:00, bursts of
 * frames with the lamps at zero (A) and at an invisible 1e-6 (B: same programs, every lamp term evaluated), alternated
 * ten times; the median of the ten B/A ratios (bursts side by side share whatever else is on the GPU).
 * `--set-ab` measures what the lamps' place in the light set costs in daylight: at 12:00, the lamp slots in the scene
 * (lamps at zero) against the slots taken out (the light set without lamps), twelve times each, ready after every
 * switch; the lower quartile of each side (another page on the GPU makes some bursts slow).
 * Each slider's result also records the lamps after the drag (lit, shown, slot count) and the lamps lit during it.
 * Run it in a capped scope, one browser at a time (see docs/PERFORMANCE.md, Measuring).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import * as env from '../tests/e2e/support/env';

const args = process.argv.slice(2);
const flag = (k: string): string | undefined => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const out = resolve(flag('out') ?? 'probe-out/daylight-drag');
const sliders = (flag('sliders') ?? 'arch,inspector').split(',').filter((x) => x !== '');
const wantShots = args.includes('--shots');
const wantProfile = args.includes('--profile');
const wantCost = args.includes('--cost');
const wantLampAb = args.includes('--lamp-ab');
const wantSetAb = args.includes('--set-ab');
const tierFlag = flag('tier');
const slug = args.find((a) => !a.startsWith('--')) ?? 'casa-patio';
mkdirSync(out, { recursive: true });
const T0 = Date.now();
const log = (s: string): void => void process.stdout.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${s}\n`);

/** Page instrumentation: program links, long tasks, long animation frames, frame intervals. */
const INSTR = `(() => {
  const S = (globalThis.__drag = { links: 0, linkMs: 0, long: [], loaf: [], frames: [], recording: false, all: true });
  const P = WebGL2RenderingContext.prototype;
  const link = P.linkProgram;
  S.sources = [];
  S.linkAt = [];
  P.linkProgram = function (...a) {
    const t = performance.now();
    if (S.recording || S.all) { try { const sh = this.getAttachedShaders(a[0]) || []; S.sources.push(sh.map((x) => this.getShaderSource(x)).join('\\n//----FRAGMENT----\\n')); } catch {} }
    const r = link.apply(this, a); S.links++; S.linkMs += performance.now() - t; S.linkAt.push(t); return r;
  };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (S.recording) S.long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: false }); } catch {}
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (!S.recording || e.duration < 50) continue;
        const scripts = (e.scripts || []).map((s) => [Math.round(s.duration), s.invokerType + ' ' + (s.invoker || '') + ' ' + (s.sourceFunctionName || '') + ' ' + String(s.sourceURL || '').split('/').pop() + ':' + s.sourceCharPosition]).sort((a, b) => b[0] - a[0]).slice(0, 4);
        S.loaf.push({ at: Math.round(e.startTime), ms: Math.round(e.duration), block: Math.round(e.blockingDuration || 0), render: Math.round(e.renderStart ? e.startTime + e.duration - e.renderStart : 0), scripts });
      }
    }).observe({ type: 'long-animation-frame', buffered: false });
  } catch {}
  let last = 0;
  S.lampsLit = 0;
  const frame = (t) => {
    if (S.recording && last) S.frames.push(t - last);
    last = t;
    if (S.recording) { try { const r = globalThis.__aether.simulation.renderer; const n = r.sync.lights.filter((l) => l.visible && l.intensity > 0).length; if (n > S.lampsLit) S.lampsLit = n; } catch {} }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
})();`;

interface Window {
  label: string;
  frames: number;
  p50: number;
  p95: number;
  max: number;
  longTasks: { n: number; sumMs: number; maxMs: number; over100: number };
  loaf: Array<{ at: number; ms: number; block: number; render: number; scripts: Array<[number, string]> }>;
  links: number;
  linkMs: number;
  programs: number;
  lampsLitMax: number;
  events: number;
  ms: number;
}

async function begin(page: Page): Promise<void> {
  await page.evaluate(() => {
    const S = (globalThis as unknown as { __drag: { recording: boolean; long: unknown[]; loaf: unknown[]; frames: number[]; links: number; linkMs: number; links0?: number; linkMs0?: number } }).__drag;
    S.long = [];
    S.loaf = [];
    S.frames = [];
    S.links0 = S.links;
    S.linkMs0 = S.linkMs;
    (S as unknown as { lampsLit: number }).lampsLit = 0;
    S.recording = true;
  });
}

async function end(page: Page, label: string, events: number, ms: number): Promise<Window> {
  const w = await page.evaluate(() => {
    const S = (globalThis as unknown as { __drag: { recording: boolean; long: Array<[number, number]>; loaf: Window['loaf']; frames: number[]; links: number; linkMs: number; links0: number; linkMs0: number } }).__drag;
    S.recording = false;
    const r = (window as unknown as { __aether: { simulation: { renderer: { renderer: { info: { memory: { programs: number } } } } } } }).__aether.simulation.renderer;
    const f = [...S.frames].sort((a, b) => a - b);
    const q = (p: number): number => Math.round((f[Math.min(f.length - 1, Math.floor(f.length * p))] ?? 0) * 10) / 10;
    return {
      frames: f.length,
      p50: q(0.5),
      p95: q(0.95),
      max: Math.round((f[f.length - 1] ?? 0) * 10) / 10,
      longTasks: { n: S.long.length, sumMs: S.long.reduce((s, x) => s + x[1], 0), maxMs: Math.max(0, ...S.long.map((x) => x[1])), over100: S.long.filter((x) => x[1] > 100).length },
      loaf: S.loaf.slice(0, 12),
      links: S.links - S.links0,
      linkMs: Math.round(S.linkMs - S.linkMs0),
      programs: r.renderer.info.memory.programs,
      lampsLitMax: (S as unknown as { lampsLit: number }).lampsLit,
    };
  });
  const res = { label, ...w, events, ms };
  log(`${label}: ${events} events in ${ms} ms, frames ${w.frames} p50 ${w.p50} p95 ${w.p95} max ${w.max} ms, long tasks ${w.longTasks.n} (sum ${w.longTasks.sumMs}, max ${w.longTasks.maxMs}, >100 ms ${w.longTasks.over100}), links ${w.links} (${w.linkMs} ms), programs ${w.programs}, most lamps lit ${w.lampsLitMax}`);
  return res;
}

/** Hold the pointer on the slider's thumb and move it through `path` (fractions of the track) over `ms`, one move per step. */
async function drag(page: Page, selector: string, path: number[], ms: number): Promise<number> {
  if (selector === '.arch-pop__range' && !(await page.locator(selector).isVisible().catch(() => false))) await page.locator('button[aria-label="Daylight study"]').click();
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`${selector}: not visible`);
  const y = box.y + box.height / 2;
  const at = (f: number): number => box.x + 8 + (box.width - 16) * f;
  await page.mouse.move(at(path[0] ?? 0), y);
  await page.mouse.down();
  const t0 = Date.now();
  let events = 0;
  const legs = path.length - 1;
  while (Date.now() - t0 < ms) {
    const u = Math.min(1, (Date.now() - t0) / ms) * legs;
    const i = Math.min(legs - 1, Math.floor(u));
    const f = (path[i] ?? 0) + ((path[i + 1] ?? 0) - (path[i] ?? 0)) * (u - i);
    await page.mouse.move(at(f), y);
    events++;
  }
  await page.mouse.move(at(path[path.length - 1] ?? 0), y);
  await page.mouse.up();
  const state = await page.evaluate(() => {
    const a = (window as unknown as { __aether: { store: { getState(): { arch: { sunHour: number | null } } }; history: { current: { environment: { timeOfDay?: number | null; sky: string } } } } }).__aether;
    return `sunHour ${a.store.getState().arch.sunHour}, document ${a.history.current.environment.sky} ${a.history.current.environment.timeOfDay}`;
  });
  log(`after drag: ${state}`);
  return events;
}

/**
 * Wait until the page settles (no processing stage, no bake, no long task for 3 s; at most 60 s). Returns how long it
 * took, and the frames over 50 ms meanwhile with what the renderer was doing just before each (stage, links, bakes).
 */
async function settle(page: Page): Promise<{ ms: number; stalls: string[] }> {
  const t0 = Date.now();
  const stalls = await page.evaluate(async () => {
    const S = (globalThis as unknown as { __drag: { recording: boolean; long: Array<[number, number]>; linkAt: number[] } }).__drag;
    const r = (window as unknown as { __aether: { simulation: { renderer: { processingStage: string | null; lightVolumeBaking?: boolean; lightmapStatus?: { state: string }; liveEnvironment?: boolean } } } }).__aether.simulation.renderer;
    const what = (): string => `${r.processingStage ?? '-'}${r.lightVolumeBaking ? ' volume-bake' : ''}${r.lightmapStatus?.state === 'baking' ? ' lightmap-bake' : ''}${r.liveEnvironment ? ' live' : ''}`;
    S.long = [];
    S.recording = true;
    const out: string[] = [];
    let state = what();
    let last = performance.now();
    let on = true;
    const start = performance.now();
    const frame = (t: number): void => {
      if (t - last > 50) out.push(`+${Math.round(last - start)} ${Math.round(t - last)} ms (${state}; ${S.linkAt.filter((x) => x >= last - 1000 && x <= t).length} links in the second before)`);
      last = t;
      if (on) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    let quietSince = performance.now();
    let seen = 0;
    while (performance.now() - start < 60_000) {
      await new Promise((res) => setTimeout(res, 100));
      state = what();
      if (S.long.length !== seen || state !== '-') {
        seen = S.long.length;
        quietSince = performance.now();
      }
      if (performance.now() - quietSince > 3000) break;
    }
    on = false;
    S.recording = false;
    return out;
  });
  return { ms: Date.now() - t0 - 3000, stalls };
}

/** The building's lamps now: lights shown (point and spot, lit or not), lit (intensity above 0), lamp slots. */
const lampState = (page: Page): Promise<{ shown: number; lit: number; slots: number; slotsLit: number; scale: number; kinds: Record<string, number> }> =>
  page.evaluate(() => {
    const r = (window as unknown as { __aether: { simulation: { renderer: { sync: { lights: Array<{ visible: boolean; intensity: number; type: string; castShadow: boolean }>; lampScale: number }; lampSlots: { size: number; light: { lit: Array<{ intensity: number }> } | null } } } } }).__aether.simulation.renderer;
    const ls = r.sync.lights;
    const kinds: Record<string, number> = {};
    for (const l of ls) kinds[`${l.type}${l.castShadow ? '+shadow' : ''}${l.visible ? '' : ' hidden'}`] = (kinds[`${l.type}${l.castShadow ? '+shadow' : ''}${l.visible ? '' : ' hidden'}`] ?? 0) + 1;
    return { kinds, shown: ls.filter((l) => l.visible).length, lit: ls.filter((l) => l.visible && l.intensity > 0).length, slots: r.lampSlots.size, slotsLit: (r.lampSlots.light?.lit ?? []).filter((l) => l.intensity > 0).length, scale: Math.round(r.sync.lampScale * 1000) / 1000 };
  });

/** Point the camera at the fixed three-quarter view of the content (the shots and the frame cost use it). */
async function fixedView(page: Page): Promise<void> {
  await page.evaluate(() => {
    const r = (window as unknown as { __aether: { simulation: { renderer: { contentSphere: { center: number[]; radius: number } | null; setCameraPose(x: number, y: number, z: number, yaw: number, pitch: number): void } } } }).__aether.simulation.renderer;
    const c = r.contentSphere?.center ?? [0, 0, 0];
    const d = Math.max(10, (r.contentSphere?.radius ?? 15) * 1.3);
    const [cx, cy, cz] = [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0];
    const x = cx + d * 0.7, y = cy + d * 0.45, z = cz + d * 0.7;
    r.setCameraPose(x, y, z, Math.atan2(x - cx, z - cz), -Math.atan2(y - cy, Math.hypot(x - cx, z - cz)));
  });
}

/**
 * Frame cost at `hour`: six bursts of 12 frames drawn back to back (after one to warm up), each a new node frame (the
 * scene drawn again, not only composited): the GPU time of each (a timer query), the median of the fastest burst, and
 * the wall time to a pixel read back.
 */
async function frameCost(page: Page, hour: number): Promise<{ hour: number; gpuBest: number; gpuP50: number; gpuP90: number; wallP50: number; lamps: Awaited<ReturnType<typeof lampState>> }> {
  await page.evaluate((h) => (window as unknown as { __aether: { store: { getState(): { setArch(p: { sunHour: number }): void } } } }).__aether.store.getState().setArch({ sunHour: h }), hour);
  await settle(page);
  await page.waitForTimeout(1000);
  const m = await page.evaluate(async () => {
    const r = (window as unknown as { __aether: { simulation: { renderer: { renderer: { backend: { gl: WebGL2RenderingContext } }; drawOnce(capture: boolean): void; advanceNodeFrame(): void } } } }).__aether.simulation.renderer;
    const gl = r.renderer.backend.gl;
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
    const px = new Uint8Array(4);
    const wall: number[] = [];
    const gpu: number[] = [];
    const bursts: number[] = [];
    // Six bursts of 12 frames, half a second apart: another page on the same GPU shows as slow bursts, and the
    // fastest burst's median is the frame's own cost.
    for (let b = 0; b < 7; b++) {
      const queries: WebGLQuery[] = [];
      for (let i = 0; i < 12; i++) {
        const q = ext && b > 0 ? gl.createQuery() : null;
        const t0 = performance.now();
        if (q && ext) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
        r.advanceNodeFrame();
        r.drawOnce(false);
        if (q && ext) {
          gl.endQuery(ext.TIME_ELAPSED_EXT);
          queries.push(q);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        if (b > 0) wall.push(performance.now() - t0);
      }
      const mine: number[] = [];
      for (const q of queries) {
        for (let k = 0; k < 100 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); k++) await new Promise((res) => setTimeout(res, 10));
        if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) && ext && !gl.getParameter(ext.GPU_DISJOINT_EXT)) mine.push((gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6);
        gl.deleteQuery(q);
      }
      gpu.push(...mine);
      mine.sort((x, y) => x - y);
      if (mine.length > 0) bursts.push(mine[Math.floor(mine.length / 2)] ?? 0);
      await new Promise((res) => setTimeout(res, 500));
    }
    return { wall: wall.sort((a, b) => a - b), gpu: gpu.sort((a, b) => a - b), best: bursts.length ? Math.min(...bursts) : 0 };
  });
  const q = (xs: number[], p: number): number => Math.round((xs[Math.min(xs.length - 1, Math.floor(xs.length * p))] ?? 0) * 100) / 100;
  const res = { hour, gpuBest: Math.round(m.best * 100) / 100, gpuP50: q(m.gpu, 0.5), gpuP90: q(m.gpu, 0.9), wallP50: q(m.wall, 0.5), lamps: await lampState(page) };
  log(`frame cost at ${hour} h: GPU fastest burst ${res.gpuBest} ms, p50 ${res.gpuP50} ms, p90 ${res.gpuP90} ms (${m.gpu.length} samples); wall p50 ${res.wallP50} ms; lamps ${JSON.stringify(res.lamps)}`);
  return res;
}

/** A/B at 12:00: lamps at zero against lamps at 1e-6 (see `--lamp-ab`). */
async function lampAb(page: Page): Promise<{ zero: number; tiny: number; ratio: number; pairs: Array<[number, number]> }> {
  await page.evaluate(() => (window as unknown as { __aether: { store: { getState(): { setArch(p: { sunHour: number }): void } } } }).__aether.store.getState().setArch({ sunHour: 12 }));
  await settle(page);
  const pairs = await page.evaluate(async () => {
    const r = (window as unknown as { __aether: { simulation: { renderer: { renderer: { backend: { gl: WebGL2RenderingContext } }; drawOnce(capture: boolean): void; advanceNodeFrame(): void; sync: { lights: Array<{ visible: boolean; intensity: number }> } } } } }).__aether.simulation.renderer;
    const gl = r.renderer.backend.gl;
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
    if (!ext) return [];
    const lamps = r.sync.lights.filter((l) => l.visible && l.intensity === 0);
    const px = new Uint8Array(4);
    const burst = async (v: number): Promise<number> => {
      for (const l of lamps) l.intensity = v;
      const queries: WebGLQuery[] = [];
      for (let i = 0; i < 9; i++) {
        const q = i >= 1 ? gl.createQuery() : null;
        if (q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
        r.advanceNodeFrame();
        r.drawOnce(false);
        if (q) {
          gl.endQuery(ext.TIME_ELAPSED_EXT);
          queries.push(q);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      }
      const t: number[] = [];
      for (const q of queries) {
        for (let k = 0; k < 100 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); k++) await new Promise((res) => setTimeout(res, 10));
        if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) && !gl.getParameter(ext.GPU_DISJOINT_EXT)) t.push((gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6);
        gl.deleteQuery(q);
      }
      t.sort((a, b) => a - b);
      return t[Math.floor(t.length / 2)] ?? 0;
    };
    await burst(1e-6);
    await burst(0);
    const out: Array<[number, number]> = [];
    for (let k = 0; k < 10; k++) {
      const a = await burst(0);
      const b = await burst(1e-6);
      out.push([a, b]);
    }
    for (const l of lamps) l.intensity = 0;
    return out;
  });
  const med = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  const r2 = (x: number): number => Math.round(x * 100) / 100;
  const res = { zero: r2(med(pairs.map((p) => p[0]))), tiny: r2(med(pairs.map((p) => p[1]))), ratio: Math.round(med(pairs.map((p) => p[1] / p[0])) * 1000) / 1000, pairs: pairs.map(([a, b]) => [r2(a), r2(b)] as [number, number]) };
  log(`lamp A/B at 12 h: lamps at zero ${res.zero} ms, lamps shaded ${res.tiny} ms, ratio ${res.ratio}; pairs ${JSON.stringify(res.pairs)}`);
  return res;
}

/** Median GPU time of 8 frames drawn back to back (after one to warm up), each a new node frame, and the draws of the last. */
const gpuBurst = (page: Page): Promise<{ ms: number; draws: number }> =>
  page.evaluate(async () => {
    const r = (window as unknown as { __aether: { simulation: { renderer: { renderer: { backend: { gl: WebGL2RenderingContext }; info: { render: { drawCalls: number } } }; drawOnce(capture: boolean): void; advanceNodeFrame(): void } } } }).__aether.simulation.renderer;
    const gl = r.renderer.backend.gl;
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
    if (!ext) return { ms: 0, draws: 0 };
    const px = new Uint8Array(4);
    const queries: WebGLQuery[] = [];
    let draws = 0;
    for (let i = 0; i < 9; i++) {
      const q = i >= 1 ? gl.createQuery() : null;
      if (q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      r.advanceNodeFrame();
      r.drawOnce(false);
      draws = r.renderer.info.render.drawCalls;
      if (q) {
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        queries.push(q);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }
    const t: number[] = [];
    for (const q of queries) {
      for (let k = 0; k < 100 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); k++) await new Promise((res) => setTimeout(res, 10));
      if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) && !gl.getParameter(ext.GPU_DISJOINT_EXT)) t.push((gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6);
      gl.deleteQuery(q);
    }
    t.sort((a, b) => a - b);
    return { ms: t[Math.floor(t.length / 2)] ?? 0, draws };
  });

/** A/B at 12:00: lamp slots in the light set (at zero) against no slots (see `--set-ab`). */
async function setAb(page: Page): Promise<{ inSet: number; outOfSet: number; ratio: number; pairs: Array<[number, number]> }> {
  await page.evaluate(() => (window as unknown as { __aether: { store: { getState(): { setArch(p: { sunHour: number }): void } } } }).__aether.store.getState().setArch({ sunHour: 12 }));
  await settle(page);
  const show = (on: boolean): Promise<void> =>
    page.evaluate((v) => {
      const r = (window as unknown as { __aether: { simulation: { renderer: { lampSlots: { group: { visible: boolean } }; needsDraw: boolean } } } }).__aether.simulation.renderer;
      r.lampSlots.group.visible = v;
      r.needsDraw = true;
    }, on);
  /**
   * Draw until the frame has `draws` draws (every object's program for the light set just switched to is ready; until
   * then three skips the objects still compiling), at most 15 s.
   */
  const ready = async (draws: number): Promise<number> => {
    const t0 = Date.now();
    let b = await gpuBurst(page);
    while (b.draws < draws && Date.now() - t0 < 15_000) {
      await page.waitForTimeout(200);
      b = await gpuBurst(page);
    }
    return b.draws;
  };
  // Both sides draw the same objects once every program is ready: wait for the larger count on each side (three skips
  // an object whose program is still compiling, which makes a side look cheaper than it is).
  await show(false);
  await settle(page);
  await show(true);
  await settle(page);
  const full = Math.max((await gpuBurst(page)).draws, await ready(0));
  const pairs: Array<[number, number]> = [];
  const draws: Array<[number, number]> = [];
  for (let k = 0; k < 12; k++) {
    await show(true);
    const da = await ready(full);
    const a = await gpuBurst(page);
    await show(false);
    const db = await ready(full);
    const b = await gpuBurst(page);
    pairs.push([a.ms, b.ms]);
    draws.push([Math.min(da, a.draws), Math.min(db, b.draws)]);
  }
  log(`light set A/B: draws per pair ${JSON.stringify(draws)} (target ${full})`);
  await show(true);
  const q = (xs: number[], p: number): number => [...xs].sort((x, y) => x - y)[Math.floor(xs.length * p)] ?? 0;
  const r2 = (x: number): number => Math.round(x * 100) / 100;
  // Another page on the GPU makes some bursts slow: the lower quartile of each side is the comparison that holds.
  const res = { inSet: r2(q(pairs.map((p) => p[0]), 0.25)), outOfSet: r2(q(pairs.map((p) => p[1]), 0.25)), ratio: 0, pairs: pairs.map(([a, b]) => [r2(a), r2(b)] as [number, number]) };
  res.ratio = Math.round((res.inSet / res.outOfSet) * 1000) / 1000;
  log(`light set A/B at 12 h (lower quartiles): lamps in the set at zero ${res.inSet} ms, no lamps in the set ${res.outOfSet} ms, ratio ${res.ratio}; pairs ${JSON.stringify(res.pairs)}`);
  return res;
}

const undoCount = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as { __aether: { history: { entries(): unknown[] } } }).__aether.history.entries().length);

async function main(): Promise<void> {
  const server = await env.startServer(() => undefined);
  const prof = mkdtempSync(join(homedir(), '.cache/aether-e2e-tmp/drag-'));
  const results: Record<string, unknown> = { slug, gen: process.env['GEN_GPU'] ?? null };
  try {
    const ctx = await chromium.launchPersistentContext(prof, { executablePath: env.findChrome(), args: [...env.CHROME_ARGS], headless: env.HEADLESS, viewport: { width: 1600, height: 900 } });
    try {
      await ctx.addInitScript(env.SKIP_FIRST_RUN);
      await ctx.addInitScript({ content: 'globalThis.__name = (f) => f;' });
      if (process.env['GEN_GPU'] === 'intel') await ctx.addInitScript({ content: 'delete Navigator.prototype.gpu; try { delete navigator.gpu; } catch {}' });
      await ctx.addInitScript({ content: INSTR });
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      page.on('pageerror', (e) => log(`pageerror ${e.message.slice(0, 160)}`));
      const cdp = await ctx.newCDPSession(page);
      await page.goto(`${server.url}/?debug=1#/new/${slug}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => performance.getEntriesByName('aether:fully-loaded').length + performance.getEntriesByName('aether:load-timeout').length > 0, null, { timeout: 240_000, polling: 250 });
      await page.waitForFunction(() => !document.querySelector('.vp-loading'), null, { timeout: 30_000, polling: 100 }).catch(() => log('load screen still up'));
      log(`loaded; settling`);
      log(`settled in ${(await settle(page)).ms} ms`);
      {
        const loadSources = await page.evaluate(() => { const S = (globalThis as unknown as { __drag: { sources: string[]; all: boolean } }).__drag; S.all = false; return S.sources.splice(0); });
        mkdirSync(join(out, 'load-links'), { recursive: true });
        loadSources.forEach((src, i) => writeFileSync(join(out, 'load-links', `${String(i).padStart(3, '0')}.glsl`), src));
      }
      if (tierFlag) {
        await page.evaluate((t) => (window as unknown as { __aether: { simulation: { renderer: { setRenderTier(x: string): void } } } }).__aether.simulation.renderer.setRenderTier(t), tierFlag);
        log(`tier ${tierFlag}; settled in ${(await settle(page)).ms} ms`);
        await page.evaluate(() => void (globalThis as unknown as { __drag: { sources: string[] } }).__drag.sources.splice(0));
      }
      const r = await page.evaluate(() => (window as unknown as { __aether: { simulation: { renderer: Record<string, unknown> } } }).__aether.simulation.renderer['renderTier']);
      results['tier'] = r;
      results['lampsLoaded'] = await lampState(page);
      if (wantCost) {
        await fixedView(page);
        results['cost'] = [await frameCost(page, 12), await frameCost(page, 22), await frameCost(page, 12)];
      }
      if (wantLampAb) {
        await fixedView(page);
        results['lampAb'] = await lampAb(page);
      }
      if (wantSetAb) {
        await fixedView(page);
        results['setAb'] = await setAb(page);
      }


      for (const which of sliders) {
        const sel = which === 'arch' ? '.arch-pop__range' : '.slider-field input[aria-label="Time of day"]';
        if (which === 'arch') {
          if (!(await page.locator(sel).isVisible().catch(() => false))) await page.locator('button[aria-label="Daylight study"]').click();
        } else {
          await page.keyboard.press('Escape');
          await page.evaluate(() => (window as unknown as { __aether: { store: { getState(): { select?: (ids: string[]) => void; setSelection?: (ids: string[]) => void } } } }).__aether.store.getState().select?.([]));
        }
        await page.locator(sel).first().waitFor({ state: 'visible', timeout: 10_000 });
        // Track: arch 5..23 h, inspector 0..24 h. Slow: 10 h to 16 h (day). Fast: across every preset and back, twice.
        const toF = (h: number): number => (which === 'arch' ? (h - 5) / 18 : h / 24);
        const before = await undoCount(page);
        await begin(page);
        await page.waitForTimeout(3000);
        const idle = await end(page, `${which} idle`, 0, 3000);
        await begin(page);
        let t = Date.now();
        let n = await drag(page, sel, [toF(10), toF(16)], 3000);
        const slow = await end(page, `${which} slow drag`, n, Date.now() - t);
        const slowSettle = await settle(page);
        log(`${which} slow drag settled ${slowSettle.ms} ms after release; frames over 50 ms: ${slowSettle.stalls.join(', ') || 'none'}`);
        const afterSlow = await undoCount(page);
        if (wantProfile) {
          await cdp.send('Profiler.enable');
          await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
          await cdp.send('Profiler.start');
        }
        await begin(page);
        t = Date.now();
        n = await drag(page, sel, [toF(5.2), toF(9), toF(16), toF(19), toF(22.8), toF(12), toF(5.2), toF(22.8)], 2400);
        const fast = await end(page, `${which} fast drag`, n, Date.now() - t);
        const fastSettle = await settle(page);
        if (wantProfile) writeFileSync(join(out, `${which}-fast.cpuprofile`), JSON.stringify((await cdp.send('Profiler.stop')).profile));
        log(`${which} fast drag settled ${fastSettle.ms} ms after release; frames over 50 ms: ${fastSettle.stalls.join(', ') || 'none'}`);
        const afterFast = await undoCount(page);
        const settledLinks = await page.evaluate(() => { const S = (globalThis as unknown as { __drag: { links: number; links0: number } }).__drag; return S.links - S.links0; });
        const lamps = await lampState(page);
        log(`${which}: links from the fast drag's start to settled ${settledLinks}; lamps ${JSON.stringify(lamps)}`);
        results[which] = { idle, slow, slowSettle, fast, fastSettle, settledLinks, lamps, undo: { slow: afterSlow - before, fast: afterFast - afterSlow } };
        const sources = await page.evaluate(() => (globalThis as unknown as { __drag: { sources: string[] } }).__drag.sources.splice(0));
        mkdirSync(join(out, `${which}-links`), { recursive: true });
        sources.forEach((src, i) => writeFileSync(join(out, `${which}-links`, `${String(i).padStart(3, '0')}.glsl`), src));
        log(`${which} undo entries: slow ${afterSlow - before}, fast ${afterFast - afterSlow}`);
      }

      if (wantShots) {
        await page.locator('.arch-pop__range').isVisible().then((v) => (v ? page.keyboard.press('Escape') : undefined)).catch(() => undefined);
        // A fixed three-quarter view of the content from above (the drags may have moved the camera), interface hidden.
        await page.addStyleTag({ content: 'body * { visibility: hidden !important; } canvas { visibility: visible !important; }' });
        await fixedView(page);
        for (const [name, hour] of [['dawn', 6.5], ['noon', 12], ['sunset', 18.5], ['night', 22]] as const) {
          await page.evaluate((h) => (window as unknown as { __aether: { store: { getState(): { setArch(p: { sunHour: number }): void } } } }).__aether.store.getState().setArch({ sunHour: h }), hour);
          await settle(page);
          await page.waitForTimeout(1500);
          const canvas = page.locator('canvas').first();
          await canvas.screenshot({ path: join(out, `shot-${name}.png`) });
          const links = await page.evaluate(() => (globalThis as unknown as { __drag: { links: number } }).__drag.links);
          log(`shot ${name} (program links so far ${links}; lamps ${JSON.stringify(await lampState(page))})`);
        }
      }
    } finally {
      await ctx.close();
    }
  } finally {
    await server.stop();
    rmSync(prof, { recursive: true, force: true });
  }
  writeFileSync(join(out, 'drag.json'), JSON.stringify(results, null, 2));
  log(`wrote ${join(out, 'drag.json')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
