/**
 * A heavy generated world must draw its first frame in bounded time with bounded JS heap.
 *
 * Opens a world JSON (`--world=file`, default: a synthetic heavy world: 150 art pieces with distinct
 * textures, 400 instances and 30 lights) through the studio, then samples once per 500 ms: drawn frames,
 * pending programs / render preparation / batch preparation, JS heap, long tasks, GPU object counts.
 * Fails when the first frame takes longer than `--max-first` seconds (default 20), the heap peaks above
 * `--max-heap` MB (default 900) or ends more than `--max-growth` MB above its first-frame level (default 300).
 * The backend is WebGL2 unless `--backend=` says otherwise (the integrated GPU, or software GL without one).
 *
 * Run: `npm run build && [GEN_GPU=intel] npx tsx tests/e2e/heavy-open.e2e.ts [--world=f.json] [--max-first=20] [--max-heap=900] [--shot=f.png] [--out=f.json] [--run=60]`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright';
import { validateWorld } from '@aether/core';
import { CHROME_ARGS, SKIP_FIRST_RUN, findChrome, startServer } from './support/env';
import { heavyWorld } from './support/heavy-world';

const ARGS = process.argv.slice(2);
const arg = (name: string): string | undefined => ARGS.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const WORLD = arg('world');
const MAX_FIRST = Number(arg('max-first') ?? 20);
/** Peak JS heap (MB) allowed, and growth of the heap from the first frame to the end of the run. */
const MAX_HEAP = Number(arg('max-heap') ?? 900);
const MAX_GROWTH = Number(arg('max-growth') ?? 300);
const SHOT = arg('shot');
const RUN = Number(arg('run') ?? 45);
const OUT = arg('out');
const t0 = performance.now();
const log = (line: string): void => void process.stdout.write(`[${((performance.now() - t0) / 1000).toFixed(1).padStart(6)}s] ${line}\n`);


const GL_TRACE = `(() => {
  const g = { links: 0, linkMs: 0, compiles: 0, compileMs: 0, maxSrc: 0, srcTotal: 0, done: 0, firstLink: 0, lastDone: 0, linkTimes: [], tex: 0, texMs: 0, texBytes: 0, buf: 0, bufBytes: 0, status: 0 };
  window.__gl = g;
  const P = WebGL2RenderingContext.prototype;
  const wrap = (name, fn) => { const o = P[name]; P[name] = function (...a) { const t = performance.now(); const r = o.apply(this, a); fn(a, performance.now() - t, r, this); return r; }; };
  const started = new WeakMap();
  wrap('shaderSource', (a) => { if (a[1].length > g.maxSrc) { g.maxSrc = a[1].length; window.__big = a[1]; } g.srcTotal += a[1].length; });
  wrap('compileShader', (a, ms) => { g.compiles++; g.compileMs += ms; });
  wrap('linkProgram', (a, ms) => { g.links++; g.linkMs += ms; if (!g.firstLink) g.firstLink = performance.now(); started.set(a[0], performance.now()); });
  const gp = P.getProgramParameter;
  P.getProgramParameter = function (prog, pname) { const r = gp.call(this, prog, pname); if (pname === 0x91B1) { if (r === true && started.has(prog)) { const d = performance.now() - started.get(prog); started.delete(prog); g.done++; g.lastDone = performance.now(); g.linkTimes.push(Math.round(d)); } } return r; };
  wrap('texImage2D', (a, ms) => { g.tex++; g.texMs += ms; });
  wrap('texStorage2D', (a, ms) => { g.tex++; g.texMs += ms; });
  wrap('bufferData', (a, ms) => { g.buf++; g.bufBytes += a[1] && a[1].byteLength || 0; });
})();`;

interface Sample { t: number; frames: number; programs: number; prep: number; batch: number; heapMB: number; longTasks: number; longMs: number; textures: number; geometries: number; calls: number; warming: boolean; grow: boolean; safe: boolean; pf: number; skip: boolean; busy: number; pd: string }

async function sample(page: Page): Promise<Sample | null> {
  return page.evaluate(() => {
    const a = window.__aether as unknown as { simulation?: { renderer?: Record<string, unknown> & { frameCount: number; renderer: { info: { memory: { textures: number; geometries: number }; render: { drawCalls?: number; frameCalls?: number } } } } } } | undefined;
    const r = a?.simulation?.renderer;
    if (!r) return null;
    const w = window as unknown as { __lt?: { n: number; ms: number } };
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const info = (r['renderer'] as { info: { memory: { textures: number; geometries: number }; render: { drawCalls?: number; frameCalls?: number } } }).info;
    return {
      t: performance.now(), frames: r.frameCount,
      programs: (r['programs'] as { pending: number }).pending, prep: (r['preparation'] as { pending: number }).pending,
      batch: (r['sync'] as { batchPreparationPending: number }).batchPreparationPending,
      heapMB: (mem?.usedJSHeapSize ?? 0) / 1048576, longTasks: w.__lt?.n ?? 0, longMs: w.__lt?.ms ?? 0,
      textures: info.memory.textures, geometries: info.memory.geometries, calls: info.render.drawCalls ?? info.render.frameCalls ?? 0,
      warming: r['warming'] === true, grow: (r['grow'] as { active: boolean }).active, safe: r['safe'] === true, pf: Number(r['progressiveFrames']), skip: (r['presentation'] as { skipped: boolean }).skipped, busy: Number(r['busySince']), pd: JSON.stringify((globalThis as { __pd?: unknown }).__pd) + ' now ' + Math.round(performance.now()),
    };
  });
}

async function main(): Promise<void> {
  const raw = WORLD ? (JSON.parse(readFileSync(WORLD, 'utf8')) as { world?: unknown }) : null;
  const parsed = validateWorld(raw ? (raw.world ?? raw) : heavyWorld());
  if (!parsed.ok) throw new Error(`invalid world: ${parsed.issues.slice(0, 3).map((i) => `${i.path}: ${i.message}`).join('; ')}`);
  const payload: unknown = JSON.parse(JSON.stringify(parsed.world));
  const server = await startServer((l) => void l);
  const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
  let failed = '';
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    await context.addInitScript({ content: SKIP_FIRST_RUN });
    await context.addInitScript({ content: `window.__lt = { n: 0, ms: 0 }; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__lt.n++; window.__lt.ms += e.duration; } }).observe({ type: 'longtask', buffered: true }); } catch {}` });
    const backend = arg('backend') ?? 'webgl2';
    if (backend) await context.addInitScript({ content: `try { localStorage.setItem('aether.studio.settings.v1', JSON.stringify({ backend: ${JSON.stringify(backend)} })); } catch {}` });
    if (ARGS.includes('--gltrace')) await context.addInitScript({ content: GL_TRACE });
    const page = await context.newPage();
    page.on('pageerror', (e) => log(`pageerror ${e.message}`));
    page.on('console', (m) => { const x = m.text(); if (/watchdog|safe mode|no frame|skipp|performance:|preparation|link/i.test(x)) log(`console ${x.slice(0, /graphics diagnostics/.test(x) ? 6000 : 200)}`); });
    await page.goto(`${server.url}/?debug=1#/new`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const a = window.__aether;
      return !!a && !!a.simulation && a.store?.getState().loading === null && Object.keys(a.history?.current?.entities ?? {}).length > 0;
    }, null, { timeout: 120_000 });
    const base = (await sample(page))?.frames ?? 0;
    const open = performance.now();
    await page.evaluate((w) => { void window.__aether?.studio.replaceWorld(w as never, 'heavy'); }, payload);
    const eye = arg('eye');
    if (eye) { const [x, y, z] = eye.split(',').map(Number) as [number, number, number]; await page.evaluate(([px, py, pz]) => { window.__aether?.simulation?.renderer.setCameraPose(px, py, pz, 0, 0); }, [x, y, z] as const); }
    log(`world replaced (${Object.keys((payload as { entities: object }).entities).length} entities)`);
    const rows: Sample[] = [];
    let first = -1, heap0 = 0, peak = 0;
    for (let i = 0; i < RUN * 2; i++) {
      await page.waitForTimeout(500);
      const s = await sample(page).catch(() => null);
      if (!s) continue;
      rows.push(s);
      peak = Math.max(peak, s.heapMB);
      if (first < 0 && s.frames > base) { first = (performance.now() - open) / 1000; heap0 = s.heapMB; log(`FIRST FRAME after ${first.toFixed(1)} s`); }
      if (i % 4 === 0) log(`frames ${s.frames} programs ${s.programs} prep ${s.prep} batch ${s.batch} heap ${s.heapMB.toFixed(0)} MB long ${s.longTasks}/${s.longMs.toFixed(0)} ms tex ${s.textures} geo ${s.geometries} calls ${s.calls} warm ${String(s.warming)} grow ${String(s.grow)} safe ${String(s.safe)} pf ${s.pf} skip ${String(s.skip)} ${s.pd}`);
    }
    const last = rows.at(-1);
    const diag = await page.evaluate(() => { const r = window.__aether?.simulation?.renderer as unknown as { diagnostics?: () => string } | undefined; try { return r?.diagnostics?.() ?? ''; } catch { return ''; } });
    if (ARGS.includes('--gltrace')) log(`gl ${JSON.stringify(await page.evaluate(() => (window as unknown as { __gl: unknown }).__gl))}`);
    if (ARGS.includes('--gltrace')) { const big = await page.evaluate(() => (window as unknown as { __big?: string }).__big ?? ''); writeFileSync('/tmp/claude-1000/bigshader.glsl', big); }
    log(`diagnostics: ${diag.slice(0, 600)}`);
    const st = await page.evaluate(() => { const r = window.__aether?.simulation?.renderer as unknown as { stats(): Record<string, number> } | undefined; try { return r?.stats() ?? {}; } catch { return {}; } });
    log(`stats fps ${Number(st['fps']).toFixed(1)} frameMs ${Number(st['frameMs']).toFixed(1)} gpuMs ${String(st['gpuMs'])} drawCalls ${String(st['drawCalls'])} triangles ${String(st['triangles'])} textures ${String(st['textures'])}`);
    log(`summary first=${first.toFixed(1)}s heap0=${heap0.toFixed(0)}MB peak=${peak.toFixed(0)}MB end=${(last?.heapMB ?? 0).toFixed(0)}MB longTasks=${last?.longTasks}/${(last?.longMs ?? 0).toFixed(0)}ms`);
    if (OUT) writeFileSync(OUT, JSON.stringify({ first, heap0, peak, rows }, null, 1));
    if (first < 0) failed = 'no frame was ever drawn';
    else if (first > MAX_FIRST) failed = `first frame took ${first.toFixed(1)} s (> ${MAX_FIRST})`;
    else if (peak > MAX_HEAP) failed = `heap peaked at ${peak.toFixed(0)} MB (> ${MAX_HEAP})`;
    else if ((last?.heapMB ?? 0) - heap0 > MAX_GROWTH) failed = `heap grew ${((last?.heapMB ?? 0) - heap0).toFixed(0)} MB (> ${MAX_GROWTH})`;
    if (SHOT) {
      const url = await page.evaluate(async () => (await window.__aether?.simulation?.renderer.screenshot({ width: 1280, height: 720, mime: 'image/png' })) ?? '');
      writeFileSync(SHOT, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    }
    await context.close();
  } finally {
    await browser.close();
    await server.stop();
  }
  if (failed) { log(`FAIL ${failed}`); process.exitCode = 1; } else log('PASS');
}

main().catch((err: unknown) => { console.error(err); process.exitCode = 1; });
