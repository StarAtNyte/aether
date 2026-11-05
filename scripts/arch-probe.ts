/**
 * Streaming-architecture probe of one world (docs/ARCHITECTURE-STREAMING.md, section 1.1): load marks, main-thread long
 * tasks before and after the first picture (with long-animation-frame script attribution), the slowest single GL calls,
 * worker busy time, memory, and frame pacing over a 20 s orbit at the opening view's height.
 *
 *   STATIC_DIR=/tmp/s1-dist GEN_GPU=intel npx tsx scripts/arch-probe.ts --out=<dir> [--visits=2] [--orbit=20] [--profile] <slug>
 *
 * Run it in a capped scope, one browser at a time (see docs/PERFORMANCE.md, "Memory-safe runs"). `--visits=2` opens the world
 * twice on one persistent profile: the second visit has the geometry cache and the GPU program cache warm. `--profile` writes a
 * V8 CPU profile of the load and of the orbit next to the result.
 *
 * The first picture is `aether:first-picture` when the renderer marks one, else the moment the load screen leaves.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { CHROME_ARGS, findChrome, HEADLESS, SKIP_FIRST_RUN, startServer } from '../tests/e2e/support/env';

const args = process.argv.slice(2);
const flag = (k: string): string | undefined => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const slug = args.find((a) => !a.startsWith('--'));
if (!slug) throw new Error('usage: arch-probe.ts --out=<dir> [--visits=N] [--orbit=S] [--scale=S] [--profile] [--eval=<file>] <slug>');
const out = resolve(flag('out') ?? `probe-out/arch-${slug}`);
const visits = Math.max(1, Number(flag('visits') ?? 1));
const orbitS = Math.max(0, Number(flag('orbit') ?? 20));
const profile = args.includes('--profile');
/** `--scale=S`: hold the resolution scale at S during the orbit (adaptive resolution off), for A/B runs at equal pixels. */
const fixedScale = flag('scale') ? Number(flag('scale')) : null;
mkdirSync(out, { recursive: true });

const T0 = Date.now();
const log = (s: string): void => void process.stdout.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${s}\n`);

// Memory of the whole capped scope (browser, server, this script).
let cgDir: string | null = null;
try {
  cgDir = `/sys/fs/cgroup${readFileSync('/proc/self/cgroup', 'utf8').trim().split(':').pop()}`;
} catch {
  cgDir = null;
}
let cgPeak = 0;
const cgTimer = setInterval(() => {
  if (!cgDir) return;
  try {
    cgPeak = Math.max(cgPeak, Number(readFileSync(`${cgDir}/memory.current`, 'utf8')));
  } catch {
    // not in a cgroup v2 scope
  }
}, 250);

/** Page instrumentation, installed before any app code. */
const INSTR = `(() => {
  const S = (globalThis.__probe = { gl: {}, glSlow: [], heapMax: 0, loaf: [], lt: [], workers: [], fc: { draw: 0, prog: 0, ubo: 0, bsd: 0, uni: 0 } });
  const FC = S.fc;
  const add = (k, ms, bytes) => { if (k === 'useProgram') FC.prog++; else if (k === 'bufferSubData') FC.bsd++; const e = S.gl[k] || (S.gl[k] = { n: 0, ms: 0, bytes: 0, max: 0 }); e.n++; e.ms += ms; e.bytes += bytes || 0; if (ms > e.max) e.max = ms; if (ms > 16) S.glSlow.push({ t: Math.round(performance.now()), k, ms: Math.round(ms), bytes: bytes || 0 }); };
  const P = WebGL2RenderingContext.prototype;
  const wrap = (name, size) => { const f = P[name]; if (!f) return; P[name] = function (...a) { const t = performance.now(); const r = f.apply(this, a); add(name, performance.now() - t, size ? size(a) : 0); return r; }; };
  const tb = (a) => { for (const x of a) if (x && typeof x === 'object' && 'byteLength' in x) return x.byteLength; for (const x of a) if (x && typeof x === 'object' && 'width' in x && 'height' in x) return x.width * x.height * 4; return 0; };
  for (const n of ['compileShader','linkProgram','getProgramParameter','getShaderParameter','useProgram','readPixels','clientWaitSync','getBufferSubData','finish','generateMipmap']) wrap(n);
  // Per-frame counters (no timing): draws, uniform-buffer writes, plain uniform calls.
  const count = (name, k) => { const f = P[name]; if (!f) return; P[name] = function (...a) { FC[k]++; return f.apply(this, a); }; };
  for (const n of ['drawElements','drawArrays','drawElementsInstanced','drawArraysInstanced','drawRangeElements']) count(n, 'draw');
  for (const n of Object.getOwnPropertyNames(P)) if (/^uniform(Matrix)?[1-4]/.test(n)) count(n, 'uni');
  const bsd0 = P.bufferSubData; P.bufferSubData = function (...a) { if (a[0] === 0x8A11) FC.ubo++; return bsd0.apply(this, a); };
  const ext0 = P.getExtension; P.getExtension = function (n) { const e = ext0.call(this, n); if (e && n === 'WEBGL_multi_draw' && !e.__probe) { e.__probe = true; for (const k of Object.keys(Object.getPrototypeOf(e))) if (typeof e[k] === 'function' && /^multiDraw/.test(k)) { const f = e[k]; e[k] = function (...a) { FC.draw++; return f.apply(this, a); }; } } return e; };
  for (const n of ['bufferData','bufferSubData']) wrap(n, (a) => { const d = n === 'bufferSubData' ? a[2] : a[1]; return d && typeof d === 'object' && 'byteLength' in d ? d.byteLength : (typeof d === 'number' ? d : 0); });
  for (const n of ['texImage2D','texImage3D','texSubImage2D','texSubImage3D','compressedTexImage2D','compressedTexSubImage2D','compressedTexImage3D','compressedTexSubImage3D','texStorage2D','texStorage3D']) wrap(n, tb);
  const W0 = globalThis.Worker;
  if (W0) globalThis.Worker = class extends W0 { constructor(u, o) { super(u, o); const rec = { name: (o && o.name) || String(u).split('/').pop().split('?')[0], sent: 0, recv: 0, inflight: 0, busy: 0, since: 0 }; S.workers.push(rec); const post = this.postMessage.bind(this); this.postMessage = (...a) => { rec.sent++; if (rec.inflight++ === 0) rec.since = performance.now(); return post(...a); }; this.addEventListener('message', () => { rec.recv++; if (rec.inflight > 0 && --rec.inflight === 0) rec.busy += performance.now() - rec.since; }); } };
  setInterval(() => { const m = performance.memory; if (m && m.usedJSHeapSize > S.heapMax) S.heapMax = m.usedJSHeapSize; }, 200);
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) S.loaf.push({ t: e.startTime, d: e.duration, scripts: e.scripts.map((s) => ({ u: s.sourceURL, f: s.sourceFunctionName, c: s.sourceCharPosition, i: s.invoker, d: s.duration })) }); }).observe({ type: 'long-animation-frame', buffered: true }); } catch (e) {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) S.lt.push({ t: e.startTime, d: e.duration }); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
  const mo = new MutationObserver(() => { const el = document.querySelector('.vp-loading'); if (el && !S.sawScreen) S.sawScreen = true; if (S.sawScreen && !el && !S.screenGone) { S.screenGone = true; performance.mark('probe:screen-gone'); } });
  addEventListener('DOMContentLoaded', () => mo.observe(document.body, { childList: true, subtree: true }));
})();`;

/** Page function: hook three's per-object draw for one frame and count what is drawn, by kind and pass. */
const DRAW_BREAKDOWN = `(async () => {
  const r = window.__aether?.simulation?.renderer;
  const three = r.renderer;
  const nodes = r.sync?.nodes;
  const orig = three._renderObjectDirect;
  const rows = new Map();
  const mats = new Set();
  const kindOf = (o) => {
    if (o.name === 'aether:merged') return 'merged';
    if (o.name && o.name.startsWith('aether:cell')) return o.name.split('#')[0];
    if (o.isBatchedMesh) return 'batchedMesh';
    let id = null;
    for (let p = o; p; p = p.parent) if (typeof p.userData?.aetherId === 'string') { id = p.userData.aetherId; break; }
    if (!id) { let path = []; for (let p = o; p && path.length < 3; p = p.parent) path.push(p.name || p.type); return 'env:' + path.join('<'); }
    const n = nodes?.get(id);
    if (!n) return 'ent:?';
    const e = n.entity;
    const why = [];
    if (n.virtual.length) why.push('virtual');
    if (n.field) why.push('field');
    if (o.isInstancedMesh) why.push('instanced:' + o.count);
    if (e.behaviors.length) why.push('beh:' + e.behaviors.map((b) => b.type).join('+'));
    if (e.physics && e.physics.body !== 'static') why.push('body:' + e.physics.body);
    if (e.arch) why.push('arch');
    if (n.bindings.length > 32) why.push('parts>32');
    const m = o.material;
    if (m && m.transparent) why.push('transparent');
    if (m && m.alphaTest > 0) why.push('alphaTest');
    if (m && Object.keys(m).some((k) => k.endsWith('Node') && m[k] != null)) why.push('nodes');
    return 'ent:' + e.shape.kind + (e.shape.kind === 'procedural' ? ':' + (e.shape.generator || '') : '') + (why.length ? ' [' + why.join(',') + ']' : '');
  };
  // A material's signature without its colours: materials that differ only in colour could share one draw (vertex colours).
  const sigMat = new Map();
  const sigCell = new Set();
  const sigOf = (m) => {
    const parts = [m.type, m.side, m.transparent, m.alphaTest, m.vertexColors, m.flatShading, m.roughness, m.metalness, m.opacity, m.depthWrite];
    for (const k of Object.keys(m).sort()) {
      const v = m[k];
      if (v && v.isTexture) parts.push(k + ':' + (v.source?.uuid ?? v.uuid));
      else if (k.endsWith('Node') && v) parts.push(k + ':' + (v.uuid ?? v.id ?? '?'));
    }
    return parts.join('|');
  };
  let on = false;
  let first = null;
  // Uniform-buffer writes of the counted frame by size, with a call stack of the first few of each size.
  const ubo = new Map();
  const GL = WebGL2RenderingContext.prototype;
  const bsd = GL.bufferSubData;
  GL.bufferSubData = function (...a) {
    if (on && a[0] === 0x8A11 && document.timeline.currentTime === first) {
      const n = a[2] && a[2].byteLength !== undefined ? (a[4] ? a[4] * a[2].BYTES_PER_ELEMENT : a[2].byteLength - (a[3] || 0) * (a[2].BYTES_PER_ELEMENT || 1)) : -1;
      const e = ubo.get(n) || { n: 0, stacks: [] };
      e.n++;
      if (e.stacks.length < 2) e.stacks.push(String(new Error().stack).split(String.fromCharCode(10)).slice(2, 9).map((l) => l.trim().split('/assets/').pop()).join(' < '));
      ubo.set(n, e);
    }
    return bsd.apply(this, a);
  };
  three._renderObjectDirect = function (object, material, scene, camera, ...rest) {
    // One animation frame only (rAF callbacks of one frame share the timeline time).
    const f = document.timeline.currentTime;
    if (on && first === null) first = f;
    if (on && f === first) {
      const pass = camera === r.camera ? 'view' : (camera.isOrthographicCamera ? 'shadow' : 'other');
      const k = pass + ' ' + kindOf(object);
      const row = rows.get(k) || { n: 0, tris: 0, mats: new Set(), cells: new Set() };
      row.n++;
      row.mats.add(material.id);
      const e = object.matrixWorld.elements;
      // What one draw per (64 m cell, material) would leave.
      row.cells.add(Math.floor(e[12] / 64) + ',' + Math.floor(e[14] / 64) + ',' + material.id);
      const g = object.geometry; row.tris += Math.round((g.index ? g.index.count : (g.attributes.position?.count || 0)) / 3) * (object.isInstancedMesh ? object.count : 1);
      rows.set(k, row);
      mats.add(pass + material.id);
      if (pass === 'view') { sigMat.set(material.id, sigOf(material)); const e2 = object.matrixWorld.elements; sigCell.add(Math.floor(e2[12] / 64) + ',' + Math.floor(e2[14] / 64) + ',' + sigOf(material)); }
    }
    return orig.call(this, object, material, scene, camera, ...rest);
  };
  try {
    r.needsDraw = true;
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    // Count one full frame.
    rows.clear(); mats.clear(); sigMat.clear(); sigCell.clear();
    on = true;
    r.needsDraw = true;
    await new Promise((res) => requestAnimationFrame(res));
    await new Promise((res) => requestAnimationFrame(res));
  } finally { on = false; three._renderObjectDirect = orig; GL.bufferSubData = bsd; }
  const list = [...rows].map(([k, v]) => ({ k, n: v.n, tris: v.tris, mats: v.mats.size, cellMats: v.cells.size })).sort((a, b) => b.n - a.n);
  const totals = {};
  for (const x of list) { const p = x.k.split(' ')[0]; totals[p] = (totals[p] || 0) + x.n; }
  totals.materials = mats.size;
  totals.viewSignatures = new Set(sigMat.values()).size;
  totals.viewCellSignatures = sigCell.size;
  rows.clear(); mats.clear();
  return { totals, top: list.slice(0, 60), ubo: [...ubo].sort((x, y) => y[1].n - x[1].n).slice(0, 8).map(([size, e]) => ({ size, n: e.n, stacks: e.stacks })) };
})()`;

interface Visit {
  visit: number;
  [k: string]: unknown;
}

const server = await startServer(log);
const dir = mkdtempSync(join(homedir(), '.cache/aether-e2e-tmp/arch-probe-'));
const results: Visit[] = [];
try {
  for (let v = 0; v < visits; v++) {
    cgPeak = 0;
    const ctx = await chromium.launchPersistentContext(dir, {
      executablePath: findChrome(),
      args: [...CHROME_ARGS, '--enable-precise-memory-info', '--enable-blink-features=LongAnimationFrameTiming'],
      headless: HEADLESS,
      viewport: { width: 1600, height: 900 },
    });
    try {
      await ctx.addInitScript(SKIP_FIRST_RUN);
      await ctx.addInitScript({ content: 'globalThis.__name = (f) => f;' });
      if (process.env['GEN_GPU'] === 'intel') await ctx.addInitScript({ content: 'delete Navigator.prototype.gpu; try { delete navigator.gpu; } catch {}' });
      await ctx.addInitScript({ content: INSTR });
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      page.on('pageerror', (e) => log(`pageerror ${e.message.slice(0, 200)}`));
      const cdp = profile ? await ctx.newCDPSession(page) : null;
      if (cdp) {
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
        await cdp.send('Profiler.start');
      }
      const tNav = Date.now();
      await page.goto(`${server.url}/?debug=1#/new/${slug}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => performance.getEntriesByName('aether:fully-loaded').length + performance.getEntriesByName('aether:load-timeout').length > 0, null, { timeout: 300_000, polling: 500 });
      await page.waitForFunction(() => !document.querySelector('.vp-loading'), null, { timeout: 30_000, polling: 100 }).catch(() => log('load screen still up'));
      // Settle: what runs after the load screen leaves (late preparation, merges) is part of the gate.
      await page.waitForTimeout(5000);
      log(`visit ${v}: loaded in ${((Date.now() - tNav) / 1000).toFixed(1)} s`);
      if (cdp) writeFileSync(join(out, `load.v${v}.cpuprofile`), JSON.stringify((await cdp.send('Profiler.stop')).profile));
      const load = await page.evaluate(() => {
        const P = (globalThis as unknown as { __probe: any }).__probe;
        const mark = (n: string): number | null => {
          const e = performance.getEntriesByName(n)[0];
          return e ? Math.round(e.startTime) : null;
        };
        const first = mark('aether:first-picture') ?? mark('probe:screen-gone') ?? mark('aether:fully-loaded') ?? 0;
        const lt = P.lt as Array<{ t: number; d: number }>;
        const sum = (a: Array<{ d: number }>): number => Math.round(a.reduce((s, x) => s + x.d, 0));
        const before = lt.filter((x) => x.t < first);
        const after = lt.filter((x) => x.t >= first);
        const attribute = (t: number, d: number): string[] => {
          const f = (P.loaf as Array<{ t: number; d: number; scripts: Array<{ u: string; f: string; c: number; i: string; d: number }> }>).find((x) => x.t <= t + 1 && x.t + x.d >= t + d - 1);
          return f ? f.scripts.filter((s) => s.d > 5).map((s) => `${String(s.u).split('/').pop()}:${s.c}:${s.f || s.i}:${Math.round(s.d)}`) : [];
        };
        const r = (window as any).__aether?.simulation?.renderer;
        let stats: unknown = null;
        let programs = -1;
        try {
          stats = r.stats();
          programs = r.renderer.info.memory.programs ?? -1;
        } catch {
          // older builds
        }
        const marks = performance.getEntriesByType('mark').filter((m) => /^(aether|probe):/.test(m.name)).map((m) => [m.name, Math.round(m.startTime)]);
        return {
          marks,
          firstPicture: first,
          longBefore: { n: before.length, sum: sum(before), max: Math.round(Math.max(0, ...before.map((x) => x.d))) },
          longAfter: { n: after.length, sum: sum(after), max: Math.round(Math.max(0, ...after.map((x) => x.d))), tasks: after.map((x) => ({ t: Math.round(x.t), d: Math.round(x.d), s: attribute(x.t, x.d) })) },
          gl: Object.fromEntries(Object.entries(P.gl as Record<string, { n: number; ms: number; bytes: number; max: number }>).map(([k, e]) => [k, { n: e.n, ms: Math.round(e.ms), mb: Math.round(e.bytes / 1048576), max: Math.round(e.max) }])),
          glSlowAfter: (P.glSlow as Array<{ t: number }>).filter((x) => x.t >= first),
          glSlowBefore: (P.glSlow as Array<{ t: number }>).filter((x) => x.t < first).length,
          workers: (P.workers as Array<{ name: string; sent: number; busy: number }>).map((w) => ({ name: w.name, sent: w.sent, busy: Math.round(w.busy) })),
          heapMaxMB: Math.round(P.heapMax / 1048576),
          programs,
          tier: r?.renderTier ?? null,
          stats,
          gen: (globalThis as any).__aetherGenStats ?? null,
          slicedUploads: r?.slicedUploadStats ?? null,
        };
      });
      const rec: Visit = { visit: v, loadWallS: (Date.now() - tNav) / 1000, ...load, cgPeakLoadMB: Math.round(cgPeak / 1048576) };
      log(`first picture ${load.firstPicture} ms; long tasks after it ${JSON.stringify({ n: load.longAfter.n, max: load.longAfter.max })}; heap ${load.heapMaxMB} MB; cgroup ${rec['cgPeakLoadMB']} MB`);

      // --eval=<file>: a page expression to evaluate after the load (diagnostics); its value goes into the result.
      const evalFile = flag('eval');
      if (evalFile) {
        rec['eval'] = await page.evaluate(readFileSync(evalFile, 'utf8')).catch((e) => String(e));
        log(`eval ${JSON.stringify(rec['eval']).slice(0, 3000)}`);
      }
      // What one frame draws, by kind (which objects are not batched, and why).
      rec['drawBreakdown'] = await page.evaluate(DRAW_BREAKDOWN).catch((e) => String(e));
      log(`draw breakdown ${JSON.stringify((rec['drawBreakdown'] as { totals?: unknown })?.totals ?? rec['drawBreakdown'])}`);
      if (orbitS > 0) {
        await page.evaluate(() => {
          const P = (globalThis as unknown as { __probe: any }).__probe;
          P.loaf.length = 0;
          P.lt.length = 0;
          P.glSlow.length = 0;
        });
        if (cdp) await cdp.send('Profiler.start');
        const orbit = await page.evaluate(async ([seconds, fixed]) => {
          const r = (window as any).__aether?.simulation?.renderer;
          const sun0 = r.sunMapDraws ?? 0;
          const cam = r.camera;
          const s = r.contentSphere;
          const cx = s?.center?.x ?? s?.center?.[0] ?? 0;
          const cz = s?.center?.z ?? s?.center?.[2] ?? 0;
          const p0 = cam.position.clone();
          const rad = Math.max(8, Math.hypot(p0.x - cx, p0.z - cz));
          const a0 = Math.atan2(p0.x - cx, p0.z - cz);
          const pitch = Math.asin(Math.max(-1, Math.min(1, cam.getWorldDirection(cam.position.clone()).y)));
          const dts: number[] = [];
          const P0 = (globalThis as unknown as { __probe: any }).__probe;
          const per: Array<[number, number, number, number, number, number]> = [];
          const poses: number[][] = [];
          const ms = seconds * 1000;
          const t0 = performance.now();
          let last = t0;
          const hold = (): void => {
            if (fixed === null || !r.adaptive) return;
            r.adaptive.enabled = false;
            if (r.adaptive.scale !== fixed) { r.adaptive.scale = fixed; r.resize(r.cssWidth, r.cssHeight); }
          };
          while (performance.now() - t0 < ms) {
            hold();
            const a = a0 + ((performance.now() - t0) / ms) * Math.PI * 2;
            const x = cx + Math.sin(a) * rad;
            const z = cz + Math.cos(a) * rad;
            r.setCameraPose(x, p0.y, z, Math.atan2(x - cx, z - cz), pitch);
            poses.push([x, p0.y, z, Math.atan2(x - cx, z - cz), pitch]);
            const now: number = await new Promise((res) => requestAnimationFrame((ts) => res(ts)));
            dts.push(now - last);
            last = now;
            const fc = P0.fc;
            per.push([fc.draw, fc.prog, fc.ubo, fc.bsd, fc.uni, r.adaptive?.scale ?? -1]);
            fc.draw = fc.prog = fc.ubo = fc.bsd = fc.uni = 0;
          }
          const P = (globalThis as unknown as { __probe: any }).__probe;
          const slowFrames = (P.loaf as Array<{ t: number; d: number; scripts: Array<{ u: string; f: string; c: number; i: string; d: number }> }>).filter((x) => x.d > 40).map((x) => ({ d: Math.round(x.d), s: x.scripts.filter((y) => y.d > 3).map((y) => `${String(y.u).split('/').pop()}:${y.c}:${y.f || y.i}:${Math.round(y.d)}`) }));
          return { poses: poses.slice(1), slowFrames, sunRedraws: (r.sunMapDraws ?? 0) - sun0, sunReasons: r.sunMapReasons ?? null, casterDraws: r.sunCasterDraws ?? null, batches: { ...(r.sync?.batchStats?.() ?? {}), ...(r.sync?.cellBatchStats?.() ?? {}) }, per: per.slice(1), dts: dts.slice(1), lt: (P.lt as Array<{ d: number }>).map((x) => Math.round(x.d)), glSlow: P.glSlow };
        }, [orbitS, fixedScale] as const);
        if (cdp) writeFileSync(join(out, `orbit.v${v}.cpuprofile`), JSON.stringify((await cdp.send('Profiler.stop')).profile));
        const d = [...orbit.dts].sort((a, b) => a - b);
        const q = (p: number): number => Math.round((d[Math.min(d.length - 1, Math.floor(d.length * p))] ?? 0) * 10) / 10;
        // Per drawn frame (frames with no draw are skipped: the renderer idles when nothing changed).
        const drawn = orbit.per.filter((x) => x[0] > 0);
        const med = (i: number): number => { const a = drawn.map((x) => x[i]!).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)]! : 0; };
        const p95 = (i: number): number => { const a = drawn.map((x) => x[i]!).sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * 0.95))]! : 0; };
        // Calls of slow frames (over 33 ms) against fast ones (17 ms or less); counts are read at the frame's next callback.
        const pick = (slow: boolean): number[] => { const a = orbit.per.filter((_, i) => (slow ? orbit.dts[i]! > 33.4 : orbit.dts[i]! <= 17.5)).map((x) => x[0]!).sort((x, y) => x - y); return [a.length, a[Math.floor(a.length / 2)] ?? 0]; };
        const scales = orbit.per.map((x) => x[5]!).filter((x) => x > 0);
        const calls = { resolutionScale: scales.length ? Math.round((scales.reduce((a, b) => a + b, 0) / scales.length) * 100) / 100 : null, slowFramesDraws: pick(true), fastFramesDraws: pick(false), drawnFrames: drawn.length, draws: [med(0), p95(0)], useProgram: [med(1), p95(1)], uboWrites: [med(2), p95(2)], bufferSubData: [med(3), p95(3)], uniformCalls: [med(4), p95(4)] };
        log(`per frame (median, p95) ${JSON.stringify(calls)}`);
        // The heading that drew the most: what it draws, by kind.
        let worst = 0;
        for (let i = 1; i < orbit.per.length; i++) if (orbit.per[i]![0]! > orbit.per[worst]![0]!) worst = i;
        const pose = orbit.poses[Math.max(0, worst - 1)];
        if (pose) {
          await page.evaluate((p) => (window as any).__aether.simulation.renderer.setCameraPose(...p), pose);
          await page.waitForTimeout(1500);
          rec['drawBreakdownWorst'] = await page.evaluate(DRAW_BREAKDOWN).catch((e) => String(e));
          log(`draw breakdown at the heaviest heading (${orbit.per[worst]![0]} draws) ${JSON.stringify((rec['drawBreakdownWorst'] as { totals?: unknown })?.totals ?? rec['drawBreakdownWorst'])}`);
        }
        log(`sun map redraws ${orbit.sunRedraws}, last caster draws ${orbit.casterDraws}, batches ${JSON.stringify(orbit.batches)}`);
        rec['orbit'] = { calls, sunRedraws: orbit.sunRedraws, sunReasons: orbit.sunReasons, casterDraws: orbit.casterDraws, batches: orbit.batches, frames: d.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: q(1), over33: d.filter((x) => x > 33.4).length, over50: d.filter((x) => x > 50).length, longTasks: orbit.lt, glSlow: orbit.glSlow,
          // Per frame: interval (ms), then draws, useProgram and uniform-buffer writes counted at that callback.
          slowFrames: orbit.slowFrames,
          series: orbit.dts.map((t, i) => [Math.round(t * 10) / 10, orbit.per[i]?.[0] ?? 0, orbit.per[i]?.[1] ?? 0, orbit.per[i]?.[2] ?? 0]) };
        log(`orbit ${JSON.stringify({ p50: q(0.5), p95: q(0.95), p99: q(0.99), max: q(1), over33: d.filter((x) => x > 33.4).length, longTasks: orbit.lt.length })}`);
      }
      rec['cgPeakMB'] = Math.round(cgPeak / 1048576);
      results.push(rec);
    } finally {
      await ctx.close().catch(() => undefined);
    }
  }
} finally {
  clearInterval(cgTimer);
  writeFileSync(join(out, `${slug}.json`), JSON.stringify(results, null, 1));
  await server.stop().catch(() => undefined);
  rmSync(dir, { recursive: true, force: true });
}
log(`wrote ${join(out, `${slug}.json`)}`);
process.exit(0);
