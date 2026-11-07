/**
 * First-picture and program probe of the streaming plan (docs/ARCHITECTURE-STREAMING.md, stage 2): first picture,
 * programs, links and program switches per frame of one world, on a cold and then a warm GPU program cache (two launches
 * on one persistent profile: the second has Chrome's program disk cache warm, as a returning visitor does). The load
 * probe of every stage is scripts/arch-probe.ts.
 *
 *   STATIC_DIR=/tmp/s2-dist GEN_GPU=intel npx tsx scripts/first-picture-probe.ts --out=<dir> [--runs=cold,warm] [--shots] [--dead] [world]
 *
 * Per run it reports, from navigation:
 * - the marks of the load (`aether:*`), and the first picture: the moment the load screen starts to leave;
 * - programs (three's `info.memory.programs`) at the first picture and after the load, and those created after the first
 *   picture;
 * - program links: count, main-thread time of the GL program calls, and the latency of each link from `linkProgram` to the
 *   first query that sees it complete (summed and the longest);
 * - GPU-process tasks over 50 ms (from a trace), before and after the first picture;
 * - an 8 s orbit after the load: frame times, `useProgram` and draws per frame.
 * With `--profile` the last run writes a CPU profile of its load (navigation to the first picture).
 * With `--links` each run writes `<run>-links.json`: every link's source pair (sourceHash form), when it was submitted, its
 * latency and its first `useProgram`.
 * With `--dead` each run writes `<run>-dead.json` (programs linked during the load and not drawn with afterwards, each with
 * how it differs from the nearest program in use) and `<run>-late.json` (programs linked after the load).
 * `PROBE_EVAL=<file>` evaluates a script in the page once the load settled and logs its result.
 * With `--shots` the last run also writes screenshots of the page at the first picture and once settled (hero shots:
 * scripts/hero-shots.ts).
 * With `--player` it opens the world in the standalone player (`play.html#t=<slug>`), from its cooked package when the
 * dist has one (`cooked/<slug>/`, scripts/cook.ts, read with `cook=local`); `--live` adds `cook=0`, the player's live path. Each run then reports
 * the path taken and the generator runs (`generated`, `posted` and `fallbacks` of the generation pool; `cooked` hits).
 * With `--drop` the ladder takes one step down after the load, the way the governor steps (a step that would change
 * nothing is skipped: on a medium tier without the light volume or cascades, the first step is the low cap). It reports
 * what the step cost in the 6 s after it (the view moves from 4 s before it): links, long tasks of the page, GPU-process
 * tasks, the tier transition.
 * With `--tris` the orbit also reports triangles and draws per frame by pass (render target size) and the meshes that draw
 * the most, at the full resolution and the ladder's start (adaptive resolution off and the ladder held from there on). The orbit reports triangles per frame and the GPU time of the frame (the renderer's timer query samples).
 * Run it in a capped scope, one browser at a time (see docs/PERFORMANCE.md, Measuring).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, createWriteStream, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import * as env from '../tests/e2e/support/env';

const args = process.argv.slice(2);
const flag = (k: string): string | undefined => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const out = resolve(flag('out') ?? 'probe-out/first-picture');
const runs = (flag('runs') ?? 'cold,warm').split(',');
const wantShots = args.includes('--shots');
/** `--profile`: a CPU profile of the last run's load (navigation to the first picture), `<run>.cpuprofile`. */
const wantProfile = args.includes('--profile');
/** `--dead`: report the programs linked during the load that are not drawn with afterwards, and how each differs from the nearest one in use. */
const wantDead = args.includes('--dead');
/** `--links`: each run writes `<run>-links.json`, every program link (source hashes, time, latency, first use). */
const wantLinks = args.includes('--links');
/** `--drop`: force the ladder's tier drop after the load and report what it cost. */
const wantDrop = args.includes('--drop');
/** `--tier=<tier>` (with `--player`): start on that render tier, chosen (no ladder): two builds then compare at one tier. */
const tierChoice = flag('tier');
/** `--tris`: triangles per frame by pass and by mesh during the orbit. */
const wantTris = args.includes('--tris');
const slug = args.find((a) => !a.startsWith('--')) ?? 'kestrel-outpost';
/** `--player`: the standalone player on the template (cooked when the dist has the package); `--live`: its live path. */
const player = args.includes('--player');
const live = args.includes('--live');
/** `--title=<s>`: before the orbit, leave the page's own camera alone for that long (a game's title: the overview flight, then its tour). */
const titleMs = Math.max(0, Number(args.find((a) => a.startsWith('--title='))?.slice(8) ?? 0) * 1000);
mkdirSync(out, { recursive: true });
const T0 = Date.now();
const log = (s: string): void => void process.stdout.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${s}\n`);

/** Page instrumentation: GL program calls, link latency, the first picture. */
// Memory of the whole capped scope (browser, server, this script), sampled each 250 ms; reset per run.
let cgDir: string | null = null;
try {
  cgDir = `/sys/fs/cgroup${readFileSync('/proc/self/cgroup', 'utf8').trim().split(':').pop()}`;
} catch {
  cgDir = null;
}
let cgPeak = 0;
setInterval(() => {
  if (!cgDir) return;
  try {
    cgPeak = Math.max(cgPeak, Number(readFileSync(`${cgDir}/memory.current`, 'utf8')));
  } catch {
    // not in a cgroup v2 scope
  }
}, 250).unref();

const INSTR = `(() => {
  const S = (globalThis.__probe = { gl: {}, links: [], firstPicture: -1, progAtFirst: -1, linksAtFirst: -1, heapMax: 0 });
  setInterval(() => { const m = performance.memory; if (m && m.usedJSHeapSize > S.heapMax) S.heapMax = m.usedJSHeapSize; }, 200);
  S.bigCalls = [];
  const add = (k, ms) => { const e = S.gl[k] || (S.gl[k] = { n: 0, ms: 0, max: 0 }); e.n++; e.ms += ms; if (ms > e.max) e.max = ms; if (ms > 15 && S.firstPicture < 0) S.bigCalls.push([Math.round(performance.now()), k, Math.round(ms)]); };
  const P = WebGL2RenderingContext.prototype;
  const wrap = (name, after) => { const f = P[name]; if (!f) return; P[name] = function (...a) { const t = performance.now(); const r = f.apply(this, a); add(name, performance.now() - t); if (after) after(a, r, t); return r; }; };
  const pending = new Map();
  wrap('linkProgram', (a, r, t) => {
    pending.set(a[0], t);
    // --dead: keep each linked program's sources, to tell which links the load threw away.
    if (globalThis.__probeDead) { try { const sh = this0().getAttachedShaders(a[0]) || []; const src = sh.map((x) => this0().getShaderSource(x) || ''); S.linked.push({ p: a[0], at: Math.round(t), src, used: false, deleted: false }); } catch {} }
    // --links: each link's source pair (sourceHash form of gpu/program-cache.ts), to compare what two loads linked.
    if (globalThis.__probeLinks) { try { const g = this0(); const sh = g.getAttachedShaders(a[0]) || []; let v = '', f = ''; for (const x of sh) { const src = g.getShaderSource(x) || ''; if (g.getShaderParameter(x, 0x8B4F) === 0x8B31) v = hashSrc(src); else f = hashSrc(src); } S.linkPairs.push({ p: a[0], at: Math.round(t), v, f, used: false, ms: -1 }); } catch {} }
  });
  S.linkPairs = [];
  const hashSrc = (s) => { let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193); b = Math.imul(b ^ c, 0x01000197); } return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0') + s.length.toString(16); };
  if (globalThis.__probeLinks) { const up0 = P.useProgram; P.useProgram = function (p) { if (p) { const e = S.linkPairs.find((x) => x.p === p); if (e && !e.used) e.used = Math.round(performance.now()); } return up0.call(this, p); }; }
  let ctx0 = null;
  const this0 = () => ctx0;
  S.linked = [];
  { const f = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (k, ...o) { const c = f.call(this, k, ...o); if (k === 'webgl2' && c && !ctx0) ctx0 = c; return c; }; }
  if (globalThis.__probeDead) {
    const up = P.useProgram, del = P.deleteProgram;
    P.useProgram = function (p) { if (S.trackUse && p) { const e = S.linked.find((x) => x.p === p); if (e) e.used = true; } return up.call(this, p); };
    P.deleteProgram = function (p) { const e = S.linked.find((x) => x.p === p); if (e) e.deleted = Math.round(performance.now()); return del.call(this, p); };
  }
  // 0x91B1 COMPLETION_STATUS_KHR, 0x8B82 LINK_STATUS: the first query that sees the link done ends its latency.
  wrap('getProgramParameter', (a, r) => { if ((a[1] === 0x91B1 || a[1] === 0x8B82) && r === true && pending.has(a[0])) { const t = pending.get(a[0]); pending.delete(a[0]); S.links.push({ at: Math.round(t), ms: Math.round(performance.now() - t) }); const e = S.linkPairs.find((x) => x.p === a[0]); if (e && e.ms < 0) e.ms = Math.round(performance.now() - t); } });
  for (const n of ['compileShader', 'useProgram', 'drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D', 'texStorage2D', 'bufferData', 'bufferSubData', 'readPixels', 'clientWaitSync', 'generateMipmap', 'getUniformLocation', 'getUniformBlockIndex', 'uniformBlockBinding']) wrap(n);
  const programs = () => { try { return window.__aether.simulation.renderer.renderer.info.memory.programs; } catch { return -1; } };
  const mo = new MutationObserver(() => {
    const el = document.querySelector('.vp-loading, .pl-loading');
    if (el && !S.sawScreen) S.sawScreen = true;
    if (S.sawScreen && S.firstPicture < 0 && (!el || el.classList.contains('is-leaving'))) {
      S.firstPicture = performance.now();
      S.progAtFirst = programs();
      S.linksAtFirst = (S.gl.linkProgram || { n: 0 }).n;
      performance.mark('probe:first-picture');
    }
  });
  addEventListener('DOMContentLoaded', () => mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] }));
  // What the renderer waits on until the first picture, every 100 ms (changes only): stage, frames drawn, links, preparation.
  S.states = [];
  const sample = setInterval(() => {
    const r = window.__aether && window.__aether.simulation && window.__aether.simulation.renderer;
    if (!r) return;
    let s;
    let lights = '';
    if (globalThis.__probeDead) try { const ls = []; r.scene.traverseVisible((o) => { if (o.isLight) ls.push(o.type + (o.castShadow ? '*' : '') + (o.name ? ':' + o.name : '')); }); lights = ls.join(','); } catch {}
    try { s = [lights, r.processingStage, r.frameCount > 0 ? 'drawn' : 'none', 'links ' + r.programs.pending, 'prep ' + r.preparation.pending, r.animating ? 'animating' : '', r.lightVolumeBaking ? 'baking' : ''].join(' '); } catch (e) { s = 'n/a'; }
    const last = S.states[S.states.length - 1];
    if (!last || last[1] !== s) S.states.push([Math.round(performance.now()), s]);
    if (S.firstPicture > 0) clearInterval(sample);
  }, 100);
  // When play starts (the simulation's mode turns to play): links in the first seconds of play are reported.
  S.playAt = -1;
  const playWatch = setInterval(() => { try { if (window.__aether.simulation.mode === 'play') { S.playAt = performance.now(); clearInterval(playWatch); } } catch {} }, 50);
  // Long animation frames until the first picture (the load screen lifts after a few smooth ones).
  S.slowFrames = [];
  let lastFrame = 0;
  const frame = (t) => { if (lastFrame && t - lastFrame > 40) S.slowFrames.push([Math.round(lastFrame), Math.round(t - lastFrame)]); lastFrame = t; if (S.firstPicture < 0) requestAnimationFrame(frame); };
  // The first 6 s after the first picture (with --drop: after the forced step), frame by frame: interval, and what the
  // frame sent (GL calls by kind, scale).
  S.after = [];
  S.afterFrom = -1;
  const kinds = { tex: ['texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D', 'texStorage2D'], mip: ['generateMipmap'], buf: ['bufferData', 'bufferSubData'], draw: ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced'], link: ['linkProgram'] };
  const snap = () => { const o = {}; for (const k in kinds) { let n = 0, ms = 0; for (const g of kinds[k]) { const e = S.gl[g]; if (e) { n += e.n; ms += e.ms; } } o[k] = n; o[k + 'Ms'] = ms; } return o; };
  let prevSnap = null, prevT = 0;
  const after = (t) => {
    if (S.firstPicture < 0) { requestAnimationFrame(after); return; }
    const c = snap();
    if (prevSnap) {
      let r = null;
      try { r = window.__aether.simulation.renderer; } catch {}
      const row = { t: Math.round(t - (S.afterFrom > 0 ? S.afterFrom : S.firstPicture)), dt: Math.round(t - prevT) };
      for (const k in kinds) { row[k] = c[k] - prevSnap[k]; const ms = c[k + 'Ms'] - prevSnap[k + 'Ms']; if (ms >= 1) row[k + 'Ms'] = Math.round(ms); }
      try { const st = r.stats(); row.scale = Math.round(st.resolutionScale * 100) / 100; row.tex = row.tex; row.textures = st.textures; } catch {}
      try { row.busy = r.processingStage; row.tris = r.stats().triangles; } catch {}
      S.after.push(row);
    }
    prevSnap = c; prevT = t;
    if (t - (S.afterFrom > 0 ? S.afterFrom : S.firstPicture) < 6000) requestAnimationFrame(after);
  };
  S.recordAfter = () => { S.after = []; S.afterFrom = performance.now(); prevSnap = null; requestAnimationFrame(after); };
  requestAnimationFrame(after);
  // Quality changes (the performance ladder's level, the tier in effect), every 250 ms: each rebuilds the lit materials.
  S.quality = [];
  setInterval(() => {
    let q = null;
    try { const r = window.__aether.simulation.renderer; q = 'tier ' + r.renderTier + ' ladder ' + r.stats().performanceLevel; } catch {}
    const last = S.quality[S.quality.length - 1];
    if (q && (!last || last[1] !== q)) S.quality.push([Math.round(performance.now() - Math.max(0, S.firstPicture)), q, S.firstPicture > 0]);
  }, 250);
  requestAnimationFrame(frame);
  // Long tasks of the page (--drop reports those after the forced step).
  S.longtasks = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) S.longtasks.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); } catch {}
})();`;

/** GPU-process main-thread tasks over 50 ms, before and after the first picture (trace events in µs). */
function gpuTasks(tracePath: string): { before: { n: number; ms: number; max: number }; after: { n: number; ms: number; max: number }; drop: { n: number; ms: number; max: number; over100: number } } | null {
  try {
    const raw = JSON.parse(readFileSync(tracePath, 'utf8')) as { traceEvents?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
    const ev = Array.isArray(raw) ? raw : (raw.traceEvents ?? []);
    const gpu = ev.find((e) => e['ph'] === 'M' && e['name'] === 'thread_name' && (e['args'] as { name?: string })?.name === 'CrGpuMain');
    const first = ev.find((e) => e['name'] === 'probe:first-picture');
    if (!gpu) return null;
    const cut = typeof first?.['ts'] === 'number' ? (first['ts'] as number) : Infinity;
    const dropMark = ev.find((e) => e['name'] === 'probe:drop');
    const dropCut = typeof dropMark?.['ts'] === 'number' ? (dropMark['ts'] as number) : Infinity;
    const tasks = ev.filter((e) => e['pid'] === gpu['pid'] && e['tid'] === gpu['tid'] && e['ph'] === 'X' && typeof e['dur'] === 'number').sort((a, b) => (a['ts'] as number) - (b['ts'] as number));
    const sum = { before: { n: 0, ms: 0, max: 0 }, after: { n: 0, ms: 0, max: 0 }, drop: { n: 0, ms: 0, max: 0, over100: 0 } };
    let end = 0;
    for (const t of tasks) {
      const ts = t['ts'] as number, dur = t['dur'] as number;
      if (ts < end) continue; // nested
      end = ts + dur;
      if (dur < 50_000) continue;
      if (ts >= dropCut) {
        sum.drop.n++;
        sum.drop.ms += Math.round(dur / 1000);
        sum.drop.max = Math.max(sum.drop.max, Math.round(dur / 1000));
        if (dur > 100_000) sum.drop.over100++;
      }
      const s = ts >= cut ? sum.after : sum.before;
      s.n++;
      s.ms += Math.round(dur / 1000);
      s.max = Math.max(s.max, Math.round(dur / 1000));
    }
    return sum;
  } catch (e) {
    log(`trace parse failed: ${(e as Error).message}`);
    return null;
  }
}

async function main(): Promise<void> {
  const server = await env.startServer(() => undefined);
  const prof = mkdtempSync(join(homedir(), '.cache/aether-e2e-tmp/arch-'));
  const results: Record<string, unknown> = { slug, gen: process.env['GEN_GPU'] ?? null };
  try {
    for (const run of runs) {
      const ctx = await chromium.launchPersistentContext(prof, { executablePath: env.findChrome(), args: [...env.CHROME_ARGS, '--enable-precise-memory-info'], headless: env.HEADLESS, viewport: { width: 1600, height: 900 } });
      try {
        await ctx.addInitScript(env.SKIP_FIRST_RUN);
        await ctx.addInitScript({ content: 'globalThis.__name = (f) => f;' });
        if (process.env['GEN_GPU'] === 'intel') await ctx.addInitScript({ content: 'delete Navigator.prototype.gpu; try { delete navigator.gpu; } catch {}' });
        if (wantDead) await ctx.addInitScript({ content: 'globalThis.__probeDead = true;' });
        if (wantLinks) await ctx.addInitScript({ content: 'globalThis.__probeLinks = true;' });
        // `PROBE_INIT=<js>`: switches set before the page starts (`globalThis.__AETHER_… = …`).
        if (process.env['PROBE_INIT']) await ctx.addInitScript({ content: process.env['PROBE_INIT'] });
        // The player's handle under the studio's name, so the rest of the probe reads either.
        if (player) await ctx.addInitScript({ content: "Object.defineProperty(window, '__aether', { configurable: true, get() { return window.__aetherPlayer; } });" });
        await ctx.addInitScript({ content: INSTR });
        cgPeak = 0;
        const page = ctx.pages()[0] ?? (await ctx.newPage());
        page.on('pageerror', (e) => log(`pageerror ${e.message.slice(0, 160)}`));
        const cdp = await ctx.newCDPSession(page);
        await cdp.send('Tracing.start', { transferMode: 'ReturnAsStream', traceConfig: { includedCategories: process.env['TRACE_CATEGORIES']?.split(',') ?? ['toplevel', 'blink.user_timing'], excludedCategories: ['*'] } } as never);
        const profiling = wantProfile && run === runs[runs.length - 1];
        if (profiling) {
          await cdp.send('Profiler.enable');
          await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
          await cdp.send('Profiler.start');
        }
        await page.goto(player ? `${server.url}/play.html#t=${slug}${live ? '&cook=0' : '&cook=local'}${tierChoice ? `&tier=${tierChoice}` : ''}` : `${server.url}/?debug=1#/new/${slug}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => (globalThis as unknown as { __probe: { firstPicture: number } }).__probe.firstPicture > 0, null, { timeout: 240_000, polling: 100 });
        if (profiling) writeFileSync(join(out, `${run}.cpuprofile`), JSON.stringify((await cdp.send('Profiler.stop')).profile));
        if (wantShots && run === runs[runs.length - 1]) await page.screenshot({ path: join(out, `${run}-first-picture.png`) });
        await page.waitForFunction(() => performance.getEntriesByName('aether:fully-loaded').length + performance.getEntriesByName('aether:load-timeout').length > 0, null, { timeout: 240_000, polling: 250 });
        await page.waitForFunction(() => !document.querySelector('.vp-loading, .pl-loading'), null, { timeout: 30_000, polling: 100 }).catch(() => log('load screen still up'));
        // Settle: whatever streams in behind the first picture finishes (bounded), so the orbit measures the steady state.
        await page.waitForFunction(() => (window as unknown as { __aether: { simulation: { renderer: { processingStage: string | null } } } }).__aether.simulation.renderer.processingStage === null, null, { timeout: 60_000, polling: 250 }).catch(() => log('renderer still busy'));
        if (wantShots && run === runs[runs.length - 1]) await page.screenshot({ path: join(out, `${run}-settled.png`) });
        if (wantShots && player && run === runs[runs.length - 1]) {
          // Hero shots of the player at fixed poses (the title's attract tour moves the camera): the opening view, and two
          // views a third of a turn round the content, without the title card.
          await page.addStyleTag({ content: 'body * { visibility: hidden !important; } canvas { visibility: visible !important; }' });
          for (let k = 0; k < 3; k++) {
            await page.evaluate(async (turn) => {
              const sim = (window as unknown as { __aetherPlayer: { simulation: { openWorld(o: { duration: number }): Promise<void>; renderer: { stopTour(): void; camera: { position: { x: number; y: number; z: number } }; contentSphere?: { center?: { x: number; z: number } }; setCameraPose(x: number, y: number, z: number, yaw: number, pitch: number): void } } } }).__aetherPlayer.simulation;
              sim.renderer.stopTour();
              await sim.openWorld({ duration: 0 });
              if (turn === 0) return;
              const r = sim.renderer;
              const cx = r.contentSphere?.center?.x ?? 0, cz = r.contentSphere?.center?.z ?? 0;
              const p = r.camera.position;
              const rad = Math.max(8, Math.hypot(p.x - cx, p.z - cz));
              const a = Math.atan2(p.x - cx, p.z - cz) + (turn * 2 * Math.PI) / 3;
              const x = cx + Math.sin(a) * rad, z = cz + Math.cos(a) * rad;
              r.setCameraPose(x, p.y, z, Math.atan2(x - cx, z - cz), -0.2);
            }, k);
            await page.waitForTimeout(4000);
            await page.screenshot({ path: join(out, `hero-${k}.png`) });
          }
        }
        if (process.env['PROBE_EVAL']) log(`${run}: eval ${JSON.stringify(await page.evaluate(readFileSync(process.env['PROBE_EVAL'], 'utf8')))}`);
        // From here on, a program drawn with counts as in use (--dead).
        await page.evaluate(() => void Object.assign((globalThis as unknown as { __probe: { trackUse: boolean; trackFrom: number } }).__probe, { trackUse: true, trackFrom: performance.now() }));
        const load = await page.evaluate(() => {
          const P = (globalThis as unknown as { __probe: { gl: Record<string, { n: number; ms: number; max: number }>; links: Array<{ at: number; ms: number }>; firstPicture: number; progAtFirst: number; linksAtFirst: number; states: Array<[number, string]>; slowFrames: Array<[number, number]>; bigCalls: Array<[number, string, number]> } }).__probe;
          const r = (window as unknown as { __aether: { simulation: { renderer: Record<string, unknown> & { renderer: { info: { memory: { programs: number } } } } } } }).__aether.simulation.renderer;
          // Every mark in order (some repeat: a later sync marks `sync-done` again); `marks` keeps the first of each.
          const all = performance.getEntriesByType('mark').filter((m) => /^(aether|probe):/.test(m.name)).map((m) => [m.name, Math.round(m.startTime)] as const);
          const marks: Record<string, number> = {};
          for (const [k, t] of all) if (!(k in marks)) marks[k] = t;
          const links = P.links;
          const sum = (xs: Array<{ ms: number }>): number => xs.reduce((s, x) => s + x.ms, 0);
          const before = links.filter((l) => l.at < P.firstPicture);
          const after = links.filter((l) => l.at >= P.firstPicture);
          return {
            firstPictureMs: Math.round(P.firstPicture),
            heapMaxMB: Math.round((P as unknown as { heapMax: number }).heapMax / 1048576),
            marks,
            timeline: all.map(([k, t]) => `${t} ${k}`),
            states: P.states.map(([t, s]) => `${t} ${s}`),
            slowFrames: P.slowFrames.map(([t, d]) => `${t}+${d}`).join(' '),
            bigCalls: P.bigCalls.map(([t, k, ms]) => `${t} ${k} ${ms}`).join(', '),
            tier: r['renderTier'],
            programsAtFirst: P.progAtFirst,
            programs: r.renderer.info.memory.programs,
            linkCalls: P.gl['linkProgram']?.n ?? 0,
            linksAfterFirst: (P.gl['linkProgram']?.n ?? 0) - P.linksAtFirst,
            playAtMs: Math.round((P as unknown as { playAt: number }).playAt),
            compileShaderCalls: P.gl['compileShader']?.n ?? 0,
            glProgramMainMs: Math.round((P.gl['linkProgram']?.ms ?? 0) + (P.gl['compileShader']?.ms ?? 0) + (P.gl['getProgramParameter']?.ms ?? 0)),
            linkLatency: { beforeFirst: { n: before.length, sumMs: sum(before), maxMs: Math.max(0, ...before.map((l) => l.ms)) }, afterFirst: { n: after.length, sumMs: sum(after), maxMs: Math.max(0, ...after.map((l) => l.ms)) } },
            slowLinks: (r['slowProgramLinks'] as unknown[] | undefined)?.length ?? null,
            prewarm: (r['prewarmStats'] as unknown) ?? null,
            firstUse: (r['firstUseStats'] as unknown) ?? null,
            gen: (globalThis as unknown as { __aetherGenStats?: { hits: number; cooked?: number; generated: number; posted: number; fallbacks: number } }).__aetherGenStats ?? null,
            cook: (() => {
              const c = (window as unknown as { __aetherCook?: { path: string; reason: string | null } }).__aetherCook;
              return c ? { path: c.path, reason: c.reason } : null;
            })(),
          };
        });
        if (load.gen) log(`${run}: ${load.cook ? `${load.cook.path}${load.cook.reason ? ` (${load.cook.reason})` : ''}, ` : ''}generator runs ${load.gen.generated + load.gen.posted + load.gen.fallbacks} (generated ${load.gen.generated}, posted ${load.gen.posted}, fallbacks ${load.gen.fallbacks}), cache hits ${load.gen.hits} (cooked ${load.gen.cooked ?? 0})`);
        log(`${run}: first picture ${(load.firstPictureMs / 1000).toFixed(1)} s, fully loaded ${((load.marks['aether:fully-loaded'] ?? -1) / 1000).toFixed(1)} s, programs ${load.programsAtFirst} -> ${load.programs}, links ${load.linkCalls} (${load.linksAfterFirst} after the first picture)`);
        if (titleMs > 0) {
          const linksNow = (): Promise<number> => page.evaluate(() => (globalThis as unknown as { __probe: { gl: Record<string, { n: number }> } }).__probe.gl['linkProgram']?.n ?? 0);
          const l0 = await linksNow();
          await page.waitForTimeout(titleMs);
          log(`${run}: title ${titleMs / 1000} s, links ${(await linksNow()) - l0}`);
        }
        let drop: Record<string, unknown> | null = null;
        if (wantDrop) {
          type Gov = { governor: { level: number; lastMove: number }; applyPerformance(): void; renderTier: string };
          const step = (level: number): Promise<string> =>
            page.evaluate((lv) => {
              const t = performance.now();
              const r = (window as unknown as { __aether: { simulation: { renderer: Gov } } }).__aether.simulation.renderer;
              performance.mark('probe:drop');
              (globalThis as unknown as { __probe: { recordAfter(): void } }).__probe.recordAfter();
              r.governor.level = lv;
              r.governor.lastMove = 1;
              r.applyPerformance();
              return `${r.renderTier} (the step took ${Math.round(performance.now() - t)} ms)`;
            }, level);
          const counts = (): Promise<{ links: number; linkMs: number; at: number }> =>
            page.evaluate(() => {
              const P = (globalThis as unknown as { __probe: { gl: Record<string, { n: number; ms: number }> } }).__probe;
              return { links: P.gl['linkProgram']?.n ?? 0, linkMs: (P.gl['linkProgram']?.ms ?? 0) + (P.gl['compileShader']?.ms ?? 0) + (P.gl['getProgramParameter']?.ms ?? 0), at: performance.now() };
            });
          // A moving view, as when the ladder steps: 4 s of it before the step (adaptive resolution settles on the motion's
          // frame rate first: its own resizes are not the step's), and 6 s after.
          const move = (ms: number): Promise<void> => page.evaluate(async (ms) => {
            const r = (window as unknown as { __aether: { simulation: { renderer: { camera: { position: { x: number; y: number; z: number }; rotation: { y: number } }; setCameraPose(x: number, y: number, z: number, yaw: number, pitch: number): void } } } }).__aether.simulation.renderer;
            const t0 = performance.now();
            const p = { x: r.camera.position.x, y: r.camera.position.y, z: r.camera.position.z };
            const yaw = r.camera.rotation.y;
            while (performance.now() - t0 < ms) {
              const k = (performance.now() - t0) / 6000;
              r.setCameraPose(p.x + Math.sin(k * 6.28) * 0.5, p.y, p.z, yaw, -0.1);
              await new Promise((res) => requestAnimationFrame(res));
            }
          }, ms);
          // The governor holds still meanwhile (a step of its own on a busy machine would be measured as the forced one).
          await page.evaluate(() => (window as unknown as { __aether: { simulation: { renderer: { holdQuality(on: boolean): void } } } }).__aether.simulation.renderer.holdQuality(true));
          await move(4000);
          const c0 = await counts();
          const tier = await step(1);
          await move(6000);
          const c1 = await counts();
          drop = await page.evaluate(({ at, links, linkMs }) => {
            const P = (globalThis as unknown as { __probe: { longtasks: Array<[number, number]> } }).__probe;
            const r = (window as unknown as { __aether: { simulation: { renderer: { renderTier: string; qualityTransition: unknown; stats(): { performanceLevel: number } } } } }).__aether.simulation.renderer;
            const lt = P.longtasks.filter(([t]) => t >= at);
            return { tier: r.renderTier, level: r.stats().performanceLevel, links, linkMs: Math.round(linkMs), longTasks: lt.map(([t, d]) => `${Math.round(t - at)}+${d}`).join(' '), longestTask: Math.max(0, ...lt.map(([, d]) => d)), transition: r.qualityTransition };
          }, { at: c0.at, links: c1.links - c0.links, linkMs: c1.linkMs - c0.linkMs });
          log(`${run}: drop: one step -> tier ${tier}; 6 s after: ${JSON.stringify(drop)}`);
        }
        if (wantTris) {
          await page.evaluate(() => {
            const r = (window as unknown as { __aether: { simulation: { renderer: { renderer: { info: { update(o: unknown, c: number, i: number): void }; getRenderTarget(): { width: number; height: number } | null } } } } }).__aether.simulation.renderer;
            const info = r.renderer.info;
            const T = ((globalThis as unknown as { __tris: unknown }).__tris = { passes: {} as Record<string, { tris: number; draws: number }>, meshes: {} as Record<string, number>, shadowMeshes: {} as Record<string, number> });
            const orig = info.update.bind(info);
            type O = { name?: string; type?: string; parent?: O; isMesh?: boolean; isInstancedMesh?: boolean; isBatchedMesh?: boolean };
            const label = (o: O): string => {
              const parts: string[] = [];
              let p: O | undefined = o;
              for (let k = 0; p && k < 4; k++, p = p.parent) if (p.name) parts.push(p.name);
              return `${o.isBatchedMesh ? 'B:' : o.isInstancedMesh ? 'I:' : ''}${parts.join('<') || o.type}`.slice(0, 90);
            };
            info.update = (o: unknown, count: number, inst: number) => {
              orig(o, count, inst);
              const m = o as O;
              if (!m.isMesh) return;
              const rt = r.renderer.getRenderTarget();
              const pass = rt ? `${rt.width}x${rt.height}` : 'canvas';
              const e = T.passes[pass] ?? (T.passes[pass] = { tris: 0, draws: 0 });
              const t = (inst * count) / 3;
              e.tris += t;
              e.draws++;
              const bag = rt && rt.width === rt.height ? T.shadowMeshes : T.meshes;
              const k = label(m);
              bag[k] = (bag[k] ?? 0) + t;
            };
          });
        }
        let openingTris: unknown = null;
        if (wantTris) {
          // The opening view, still, at the full resolution (adaptive resolution off for the rest of the run: the level of
          // detail follows the drawn height, so counts compare only at one): 60 frames with the cached sun map (frame
          // invalidation only), then 10 that redraw it.
          openingTris = await page.evaluate(async () => {
            const r = (window as unknown as { __aether: { simulation: { renderer: { frameInvalidation: { change(): void }; needsDraw: boolean; stats(): { triangles: number; drawCalls: number }; gpuCost?: { seconds: number }; setAdaptiveResolution(on: boolean): void; holdQuality(on: boolean): void } } } }).__aether.simulation.renderer;
            r.setAdaptiveResolution(false);
            // The ladder goes back to its start and holds still: a step taken on a busy machine would compare two tiers.
            const g = r as unknown as { governor: { level: number; lastMove: number }; applyPerformance(): void; processingStage: string | null };
            if (g.governor.level > 0) {
              g.governor.level = 0;
              g.governor.lastMove = -1;
              g.applyPerformance();
            }
            r.holdQuality(true);
            const t0 = performance.now();
            for (let i = 0; i < 30 || (g.processingStage !== null && performance.now() - t0 < 30_000); i++) {
              r.frameInvalidation.change();
              await new Promise((res) => requestAnimationFrame(res));
            }
            type B = { passes: Record<string, { tris: number; draws: number }>; meshes: Record<string, number>; shadowMeshes: Record<string, number> };
            const T = (globalThis as unknown as { __tris: B }).__tris;
            const run = async (frames: number, sun: boolean): Promise<Record<string, unknown>> => {
              T.passes = {};
              T.meshes = {};
              T.shadowMeshes = {};
              let tris = 0, gpu = 0, gpuN = 0;
              for (let i = 0; i < frames; i++) {
                if (sun) r.needsDraw = true;
                else r.frameInvalidation.change();
                await new Promise((res) => requestAnimationFrame(res));
                tris += r.stats().triangles;
                const g = r.gpuCost?.seconds ?? 0;
                if (g > 0) {
                  gpu += g;
                  gpuN++;
                }
              }
              const top = (b: Record<string, number>): Array<[string, number]> => Object.entries(b).sort((x, y) => y[1] - x[1]).slice(0, 25).map(([k, v]) => [k, Math.round(v / frames)]);
              const passes: Record<string, { tris: number; draws: number }> = {};
              for (const [k, v] of Object.entries(T.passes)) if (v.tris / frames >= 100) passes[k] = { tris: Math.round(v.tris / frames), draws: Math.round(v.draws / frames) };
              return { trisPerFrame: Math.round(tris / frames), gpuMs: gpuN > 0 ? Math.round((gpu / gpuN) * 10000) / 10 : null, passes, meshes: top(T.meshes), shadowMeshes: top(T.shadowMeshes) };
            };
            const cached = await run(60, false);
            const sun = await run(10, true);
            T.passes = {};
            T.meshes = {};
            T.shadowMeshes = {};
            return { cached, sun };
          });
          writeFileSync(join(out, `${run}-opening-tris.json`), JSON.stringify(openingTris, null, 1));
          const o = openingTris as { cached: { trisPerFrame: number; gpuMs: number | null }; sun: { trisPerFrame: number; gpuMs: number | null } };
          log(`${run}: opening view triangles/frame ${o.cached.trisPerFrame} (GPU ms ${o.cached.gpuMs ?? 'n/a'}), with the sun map redrawn ${o.sun.trisPerFrame} (GPU ms ${o.sun.gpuMs ?? 'n/a'})`);
        }
        // Orbit 8 s around the opening view: frame times, programs switched and draws per frame.
        const orbit = await page.evaluate(async () => {
          const P = (globalThis as unknown as { __probe: { gl: Record<string, { n: number }> } }).__probe;
          const r = (window as unknown as { __aether: { simulation: { renderer: { camera: { position: { x: number; y: number; z: number; clone(): unknown }; getWorldDirection(v: unknown): { y: number } }; contentSphere?: { center?: { x: number; z: number } }; setCameraPose(x: number, y: number, z: number, yaw: number, pitch: number): void; renderer: { info: { memory: { programs: number } } } } } } }).__aether.simulation.renderer;
          const cam = r.camera;
          const cx = r.contentSphere?.center?.x ?? 0, cz = r.contentSphere?.center?.z ?? 0;
          const p0 = { x: cam.position.x, y: cam.position.y, z: cam.position.z };
          const rad = Math.max(8, Math.hypot(p0.x - cx, p0.z - cz));
          const a0 = Math.atan2(p0.x - cx, p0.z - cz);
          const pitch = Math.asin(Math.max(-1, Math.min(1, cam.getWorldDirection(cam.position.clone()).y)));
          const n = (k: string): number => P.gl[k]?.n ?? 0;
          const draws = (): number => n('drawArrays') + n('drawElements') + n('drawArraysInstanced') + n('drawElementsInstanced');
          const u0 = n('useProgram'), d0 = draws(), l0 = n('linkProgram'), prog0 = r.renderer.info.memory.programs;
          const dts: number[] = [];
          let triSum = 0, gpuSum = 0, gpuN = 0;
          const rs = r as unknown as { stats(): { triangles: number }; gpuCost?: { seconds: number }; sunMapDraws?: number; sunMapReasons?: Record<string, number> };
          const sun0 = rs.sunMapDraws ?? 0;
          const why0 = { ...(rs.sunMapReasons ?? {}) };
          const t0 = performance.now();
          let last = t0;
          while (performance.now() - t0 < 8000) {
            const a = a0 + ((performance.now() - t0) / 8000) * Math.PI * 2;
            const x = cx + Math.sin(a) * rad, z = cz + Math.cos(a) * rad;
            r.setCameraPose(x, p0.y, z, Math.atan2(x - cx, z - cz), pitch);
            const ts = await new Promise<number>((res) => requestAnimationFrame(res));
            dts.push(ts - last);
            last = ts;
            triSum += rs.stats().triangles;
            const g = rs.gpuCost?.seconds ?? 0;
            if (g > 0) {
              gpuSum += g;
              gpuN++;
            }
          }
          dts.shift();
          // What the renderer was busy with when the orbit ended (a bake or links behind the orbit make its frames slow).
          const rr = r as unknown as { processingStage: string | null; lightVolumeBaking: boolean; programs: { pending: number }; preparation: { pending: number } };
          const busy = `${rr.processingStage ?? '-'} baking ${String(rr.lightVolumeBaking)} links ${rr.programs.pending} prep ${rr.preparation.pending}`;
          const frames = dts.length;
          const s = [...dts].sort((a, b) => a - b);
          const q = (p: number): number => Math.round((s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0) * 10) / 10;
          const why: Record<string, number> = {};
          for (const [k, v] of Object.entries(rs.sunMapReasons ?? {})) if (v - (why0[k] ?? 0) > 0) why[k] = v - (why0[k] ?? 0);
          return { sunMapDraws: (rs.sunMapDraws ?? 0) - sun0, sunMapWhy: why, trisPerFrame: Math.round(triSum / Math.max(1, dts.length + 1)), gpuMs: gpuN > 0 ? Math.round((gpuSum / gpuN) * 10000) / 10 : null, frames, p50: q(0.5), p95: q(0.95), max: q(1), useProgramPerFrame: Math.round((n('useProgram') - u0) / frames), drawsPerFrame: Math.round((draws() - d0) / frames), linksDuringOrbit: n('linkProgram') - l0, busy, programsAdded: r.renderer.info.memory.programs - prog0 };
        });
        log(`${run}: quality ${(await page.evaluate(() => (globalThis as unknown as { __probe: { quality: Array<[number, string, boolean]> } }).__probe.quality)).map(([t, q, after]) => `${after ? '+' : ''}${(t / 1000).toFixed(1)} s ${q}`).join(', ')}`);
        // The frames of the first 6 s after the first picture (interval, GL calls by kind, scale).
        writeFileSync(join(out, `${run}-after.json`), JSON.stringify(await page.evaluate(() => (globalThis as unknown as { __probe: { after: unknown[] } }).__probe.after)));
        // Links submitted in the first 10 s of play (and after the first picture), whatever happened in them (orbit included).
        await page.waitForFunction(() => { const P = (globalThis as unknown as { __probe: { playAt: number } }).__probe; return P.playAt < 0 || performance.now() - P.playAt >= 10_000; }, null, { timeout: 15_000, polling: 250 }).catch(() => undefined);
        const playLinks = await page.evaluate(() => {
          const P = (globalThis as unknown as { __probe: { playAt: number; firstPicture: number; links: Array<{ at: number }>; gl: Record<string, { n: number }> } }).__probe;
          if (P.playAt < 0) return null;
          const from = Math.max(P.playAt, P.firstPicture);
          return { playAt: Math.round(P.playAt), firstPicture: Math.round(P.firstPicture), links: P.links.filter((l) => l.at >= from && l.at < P.playAt + 10_000).length, elapsed: Math.round(performance.now() - P.playAt) };
        });
        if (playLinks) log(`${run}: play started at ${(playLinks.playAt / 1000).toFixed(1)} s, links in its first 10 s (after the first picture) ${playLinks.links}${playLinks.elapsed < 10_000 ? ` (only ${playLinks.elapsed} ms of play so far)` : ''}`);
        log(`${run}: orbit p50 ${orbit.p50} p95 ${orbit.p95} max ${orbit.max}, useProgram/frame ${orbit.useProgramPerFrame}, draws/frame ${orbit.drawsPerFrame}, links ${orbit.linksDuringOrbit}, triangles/frame ${orbit.trisPerFrame}, GPU ms ${orbit.gpuMs ?? 'n/a'}, sun map drawn ${orbit.sunMapDraws} times ${JSON.stringify(orbit.sunMapWhy)}`);
        let tris: unknown = null;
        if (wantTris) {
          tris = await page.evaluate((frames) => {
            const T = (globalThis as unknown as { __tris: { passes: Record<string, { tris: number; draws: number }>; meshes: Record<string, number>; shadowMeshes: Record<string, number> } }).__tris;
            const top = (b: Record<string, number>): Array<[string, number]> => Object.entries(b).sort((a, c) => c[1] - a[1]).slice(0, 25).map(([k, v]) => [k, Math.round(v / frames)]);
            const passes: Record<string, { tris: number; draws: number }> = {};
            for (const [k, v] of Object.entries(T.passes)) passes[k] = { tris: Math.round(v.tris / frames), draws: Math.round(v.draws / frames) };
            return { passes, meshes: top(T.meshes), shadowMeshes: top(T.shadowMeshes) };
          }, orbit.frames + 1);
          writeFileSync(join(out, `${run}-tris.json`), JSON.stringify(tris, null, 1));
          log(`${run}: triangles per frame by pass ${JSON.stringify((tris as { passes: unknown }).passes)}`);
        }
        if (wantLinks) {
          const links = await page.evaluate(() => {
            const P = (globalThis as unknown as { __probe: { firstPicture: number; linkPairs: Array<{ at: number; v: string; f: string; used: number | false; ms: number }> } }).__probe;
            return { firstPicture: Math.round(P.firstPicture), links: P.linkPairs.map((l) => ({ at: l.at, v: l.v, f: l.f, used: l.used, ms: l.ms })) };
          });
          writeFileSync(join(out, `${run}-links.json`), JSON.stringify(links));
        }
        if (wantDead) {
          // The view rests after the orbit: the rest phase draws again.
          await page.waitForTimeout(4000);
          const dead = await page.evaluate(() => {
            const P = (globalThis as unknown as { __probe: { firstPicture: number; linked: Array<{ at: number; src: string[]; used: boolean; deleted: number | false }> } }).__probe;
            const live = P.linked.filter((l) => l.used);
            // Node names are numbered in the order they are built: compare with the numbers taken out.
            const lines = (l: { src: string[] }): Set<string> => new Set(l.src.join('\n').split('\n').map((x) => x.trim().replace(/\b(nodeUniform|nodeVarying|VERTEX_nodeVar|nodeVar|NodeBuffer_|nodeBuffer|nodeTexture|nodeAttribute|nodeVarying)\d+/g, '$1#')).filter(Boolean));
            const liveLines = live.map(lines);
            return P.linked.filter((l) => !l.used).map((l) => {
              const mine = lines(l);
              let best = -1, bestD = Infinity;
              liveLines.forEach((o, i) => { let d = 0; for (const x of mine) if (!o.has(x)) d++; for (const x of o) if (!mine.has(x)) d++; if (d < bestD) { bestD = d; best = i; } });
              const o = best >= 0 ? liveLines[best]! : new Set<string>();
              return { at: l.at, beforeFirst: l.at < P.firstPicture, deleted: l.deleted, chars: l.src.join('').length, head: (l.src[1] ?? '').split('\n').find((x) => /^\/\/|name|define/.test(x))?.slice(0, 80) ?? '', diff: bestD, onlyDead: [...mine].filter((x) => !o.has(x)).slice(0, 30), onlyLive: [...o].filter((x) => !mine.has(x)).slice(0, 30), liveAt: best >= 0 ? live[best]!.at : -1, src: l.src, liveSrc: best >= 0 ? live[best]!.src : [] };
            });
          });
          // The programs linked once the load was over (the orbit's): their fragment sources' first lines that tell them apart.
          const late = await page.evaluate(() => {
            const P = (globalThis as unknown as { __probe: { trackFrom: number; linked: Array<{ at: number; src: string[] }> } }).__probe;
            return P.linked.filter((l) => l.at >= P.trackFrom).map((l) => ({ at: l.at, chars: l.src.join('').length, src: l.src }));
          });
          writeFileSync(join(out, `${run}-late.json`), JSON.stringify(late, null, 1));
          // Skinned meshes (people): where they hang and whether they are shown (programs met only once one shows).
          const skinned = await page.evaluate(() => {
            const r = (window as unknown as { __aether: { simulation: { renderer: { scene: { traverse(f: (o: { isSkinnedMesh?: boolean; name: string; visible: boolean; parent: unknown; layers: { mask: number }; frustumCulled: boolean }) => void): void } } } } }).__aether.simulation.renderer;
            const out: string[] = [];
            r.scene.traverse((o) => {
              if (!o.isSkinnedMesh) return;
              const path: string[] = [];
              let shown = true;
              for (let p = o as unknown as { name: string; visible: boolean; parent: unknown; type?: string } | null; p; p = p.parent as typeof p) {
                path.push(`${p.name || p.type}${p.visible ? '' : '(hidden)'}`);
                if (!p.visible) shown = false;
              }
              out.push(`${shown ? 'shown' : 'hidden'} layers ${o.layers.mask} ${path.reverse().join(' / ')}`);
            });
            return out;
          });
          log(`${run}: skinned meshes:\n  ${skinned.slice(0, 20).join('\n  ')}`);
          writeFileSync(join(out, `${run}-dead.json`), JSON.stringify(dead, null, 1));
          log(`${run}: ${dead.length} links not drawn with after the load (${dead.filter((d) => d.beforeFirst).length} before the first picture, ${dead.filter((d) => d.deleted !== false).length} deleted)`);
        }
        const done = new Promise<string>((res) => cdp.once('Tracing.tracingComplete', (e: { stream?: string }) => res(e.stream ?? '')));
        await cdp.send('Tracing.end');
        const handle = await done;
        const tracePath = join(out, `${run}-trace.json`);
        const ws = createWriteStream(tracePath);
        for (;;) {
          const chunk = (await cdp.send('IO.read', { handle, size: 4 << 20 } as never)) as { data: string; eof: boolean; base64Encoded?: boolean };
          ws.write(chunk.base64Encoded ? Buffer.from(chunk.data, 'base64') : chunk.data);
          if (chunk.eof) break;
        }
        await new Promise<void>((r) => ws.end(r));
        await cdp.send('IO.close', { handle } as never);
        const gpuMain = gpuTasks(tracePath);
        if (process.env['KEEP_TRACE'] !== '1') rmSync(tracePath, { force: true });
        if (gpuMain) log(`${run}: GPU-process tasks > 50 ms before the first picture ${gpuMain.before.n} (${gpuMain.before.ms} ms, longest ${gpuMain.before.max}), after ${gpuMain.after.n} (${gpuMain.after.ms} ms, longest ${gpuMain.after.max})${wantDrop ? `, after the drop ${gpuMain.drop.n} (${gpuMain.drop.over100} over 100 ms, longest ${gpuMain.drop.max})` : ''}`);
        const cgPeakMB = Math.round(cgPeak / 1048576);
        log(`${run}: JS heap peak ${load.heapMaxMB} MB, scope peak ${cgPeakMB} MB`);
        results[run] = { ...load, orbit, playLinks, gpuMain, cgPeakMB, drop, tris, openingTris };
      } finally {
        await ctx.close().catch(() => undefined);
      }
    }
  } finally {
    writeFileSync(join(out, 'result.json'), JSON.stringify(results, null, 1));
    await server.stop().catch(() => undefined);
    rmSync(prof, { recursive: true, force: true });
  }
}
main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
