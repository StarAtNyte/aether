/**
 * First-picture and program probe of the streaming plan (docs/ARCHITECTURE-STREAMING.md, stage 2): first picture,
 * programs, links and program switches per frame of one world, on a cold and then a warm GPU program cache (two launches
 * on one persistent profile: the second has Chrome's program disk cache warm, as a returning visitor does). The load
 * probe of every stage is scripts/arch-probe.ts.
 *
 *   STATIC_DIR=/tmp/s2-dist GEN_GPU=intel npx tsx scripts/first-picture-probe.ts --out=<dir> [--runs=cold,warm] [--shots] [world]
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
 * With `--shots` the last run also writes screenshots of the page at the first picture and once settled (hero shots:
 * scripts/hero-shots.ts).
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
const slug = args.find((a) => !a.startsWith('--')) ?? 'kestrel-outpost';
mkdirSync(out, { recursive: true });
const T0 = Date.now();
const log = (s: string): void => void process.stdout.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${s}\n`);

/** Page instrumentation: GL program calls, link latency, the first picture. */
const INSTR = `(() => {
  const S = (globalThis.__probe = { gl: {}, links: [], firstPicture: -1, progAtFirst: -1, linksAtFirst: -1 });
  S.bigCalls = [];
  const add = (k, ms) => { const e = S.gl[k] || (S.gl[k] = { n: 0, ms: 0, max: 0 }); e.n++; e.ms += ms; if (ms > e.max) e.max = ms; if (ms > 15 && S.firstPicture < 0) S.bigCalls.push([Math.round(performance.now()), k, Math.round(ms)]); };
  const P = WebGL2RenderingContext.prototype;
  const wrap = (name, after) => { const f = P[name]; if (!f) return; P[name] = function (...a) { const t = performance.now(); const r = f.apply(this, a); add(name, performance.now() - t); if (after) after(a, r, t); return r; }; };
  const pending = new Map();
  wrap('linkProgram', (a, r, t) => pending.set(a[0], t));
  // 0x91B1 COMPLETION_STATUS_KHR, 0x8B82 LINK_STATUS: the first query that sees the link done ends its latency.
  wrap('getProgramParameter', (a, r) => { if ((a[1] === 0x91B1 || a[1] === 0x8B82) && r === true && pending.has(a[0])) { const t = pending.get(a[0]); pending.delete(a[0]); S.links.push({ at: Math.round(t), ms: Math.round(performance.now() - t) }); } });
  for (const n of ['compileShader', 'useProgram', 'drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D', 'texStorage2D', 'bufferData', 'bufferSubData', 'readPixels', 'clientWaitSync', 'generateMipmap', 'getUniformLocation', 'getUniformBlockIndex', 'uniformBlockBinding']) wrap(n);
  const programs = () => { try { return window.__aether.simulation.renderer.renderer.info.memory.programs; } catch { return -1; } };
  const mo = new MutationObserver(() => {
    const el = document.querySelector('.vp-loading');
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
    try { s = [r.processingStage, r.frameCount > 0 ? 'drawn' : 'none', 'links ' + r.programs.pending, 'prep ' + r.preparation.pending, r.animating ? 'animating' : '', r.lightVolumeBaking ? 'baking' : ''].join(' '); } catch (e) { s = 'n/a'; }
    const last = S.states[S.states.length - 1];
    if (!last || last[1] !== s) S.states.push([Math.round(performance.now()), s]);
    if (S.firstPicture > 0) clearInterval(sample);
  }, 100);
  // Long animation frames until the first picture (the load screen lifts after a few smooth ones).
  S.slowFrames = [];
  let lastFrame = 0;
  const frame = (t) => { if (lastFrame && t - lastFrame > 40) S.slowFrames.push([Math.round(lastFrame), Math.round(t - lastFrame)]); lastFrame = t; if (S.firstPicture < 0) requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
})();`;

/** GPU-process main-thread tasks over 50 ms, before and after the first picture (trace events in µs). */
function gpuTasks(tracePath: string): { before: { n: number; ms: number; max: number }; after: { n: number; ms: number; max: number } } | null {
  try {
    const raw = JSON.parse(readFileSync(tracePath, 'utf8')) as { traceEvents?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
    const ev = Array.isArray(raw) ? raw : (raw.traceEvents ?? []);
    const gpu = ev.find((e) => e['ph'] === 'M' && e['name'] === 'thread_name' && (e['args'] as { name?: string })?.name === 'CrGpuMain');
    const first = ev.find((e) => e['name'] === 'probe:first-picture');
    if (!gpu) return null;
    const cut = typeof first?.['ts'] === 'number' ? (first['ts'] as number) : Infinity;
    const tasks = ev.filter((e) => e['pid'] === gpu['pid'] && e['tid'] === gpu['tid'] && e['ph'] === 'X' && typeof e['dur'] === 'number').sort((a, b) => (a['ts'] as number) - (b['ts'] as number));
    const sum = { before: { n: 0, ms: 0, max: 0 }, after: { n: 0, ms: 0, max: 0 } };
    let end = 0;
    for (const t of tasks) {
      const ts = t['ts'] as number, dur = t['dur'] as number;
      if (ts < end) continue; // nested
      end = ts + dur;
      if (dur < 50_000) continue;
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
        await ctx.addInitScript({ content: INSTR });
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
        await page.goto(`${server.url}/?debug=1#/new/${slug}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => (globalThis as unknown as { __probe: { firstPicture: number } }).__probe.firstPicture > 0, null, { timeout: 240_000, polling: 100 });
        if (profiling) writeFileSync(join(out, `${run}.cpuprofile`), JSON.stringify((await cdp.send('Profiler.stop')).profile));
        if (wantShots && run === runs[runs.length - 1]) await page.screenshot({ path: join(out, `${run}-first-picture.png`) });
        await page.waitForFunction(() => performance.getEntriesByName('aether:fully-loaded').length + performance.getEntriesByName('aether:load-timeout').length > 0, null, { timeout: 240_000, polling: 250 });
        await page.waitForFunction(() => !document.querySelector('.vp-loading'), null, { timeout: 30_000, polling: 100 }).catch(() => log('load screen still up'));
        // Settle: whatever streams in behind the first picture finishes (bounded), so the orbit measures the steady state.
        await page.waitForFunction(() => (window as unknown as { __aether: { simulation: { renderer: { processingStage: string | null } } } }).__aether.simulation.renderer.processingStage === null, null, { timeout: 60_000, polling: 250 }).catch(() => log('renderer still busy'));
        if (wantShots && run === runs[runs.length - 1]) await page.screenshot({ path: join(out, `${run}-settled.png`) });
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
            compileShaderCalls: P.gl['compileShader']?.n ?? 0,
            glProgramMainMs: Math.round((P.gl['linkProgram']?.ms ?? 0) + (P.gl['compileShader']?.ms ?? 0) + (P.gl['getProgramParameter']?.ms ?? 0)),
            linkLatency: { beforeFirst: { n: before.length, sumMs: sum(before), maxMs: Math.max(0, ...before.map((l) => l.ms)) }, afterFirst: { n: after.length, sumMs: sum(after), maxMs: Math.max(0, ...after.map((l) => l.ms)) } },
            slowLinks: (r['slowProgramLinks'] as unknown[] | undefined)?.length ?? null,
            prewarm: (r['prewarmStats'] as unknown) ?? null,
          };
        });
        log(`${run}: first picture ${(load.firstPictureMs / 1000).toFixed(1)} s, fully loaded ${((load.marks['aether:fully-loaded'] ?? -1) / 1000).toFixed(1)} s, programs ${load.programsAtFirst} -> ${load.programs}, links ${load.linkCalls} (${load.linksAfterFirst} after the first picture)`);
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
          const t0 = performance.now();
          let last = t0;
          while (performance.now() - t0 < 8000) {
            const a = a0 + ((performance.now() - t0) / 8000) * Math.PI * 2;
            const x = cx + Math.sin(a) * rad, z = cz + Math.cos(a) * rad;
            r.setCameraPose(x, p0.y, z, Math.atan2(x - cx, z - cz), pitch);
            const ts = await new Promise<number>((res) => requestAnimationFrame(res));
            dts.push(ts - last);
            last = ts;
          }
          dts.shift();
          const frames = dts.length;
          const s = [...dts].sort((a, b) => a - b);
          const q = (p: number): number => Math.round((s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0) * 10) / 10;
          return { frames, p50: q(0.5), p95: q(0.95), max: q(1), useProgramPerFrame: Math.round((n('useProgram') - u0) / frames), drawsPerFrame: Math.round((draws() - d0) / frames), linksDuringOrbit: n('linkProgram') - l0, programsAdded: r.renderer.info.memory.programs - prog0 };
        });
        log(`${run}: orbit p50 ${orbit.p50} p95 ${orbit.p95} max ${orbit.max}, useProgram/frame ${orbit.useProgramPerFrame}, draws/frame ${orbit.drawsPerFrame}, links ${orbit.linksDuringOrbit}`);
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
        if (gpuMain) log(`${run}: GPU-process tasks > 50 ms before the first picture ${gpuMain.before.n} (${gpuMain.before.ms} ms, longest ${gpuMain.before.max}), after ${gpuMain.after.n} (${gpuMain.after.ms} ms, longest ${gpuMain.after.max})`);
        results[run] = { ...load, orbit, gpuMain };
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
