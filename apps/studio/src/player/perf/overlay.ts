/**
 * The `?perf=1` diagnostic of the player: a small live panel (GPU, tier and why, texture cap, ladder, resolution scale,
 * frame times, the long frames with their likely cause, upgrade and program counters) and a "Copy report" button that puts
 * the same facts, the last 50 long frames and the renderer's own diagnostics on the clipboard as plain text.
 *
 * Loaded by `main.tsx` only when the flag is in the URL (a dynamic import: no cost to the normal bundles). Causes come from
 * the span hooks of @aether/core perf-probe (a model swap, a texture upload, a program link, the lip-sync decode, the
 * voice clip, the product card, the draw and the frame's own work): a frame over 50 ms is attributed to the spans that
 * ended inside it; with none, to a long main-thread task the page saw, else to "unknown" (the GPU or the compositor).
 */
import { setPerfSink, type PerfSink } from '@aether/core/perf-probe';

const LONG_MS = 50;
const WINDOW_MS = 10_000;
const KEEP_LONG = 50;
const SHOWN_LONG = 20;
const SERIES_MAX = 40_000;
/** Spans that are the frame's ordinary work: a cause only when nothing else explains it. */
const BASE = new Set(['draw', 'frame']);

interface Span { kind: string; t0: number; t1: number; self: number; detail: string | undefined }
interface LongFrame { at: number; wall: string; dt: number; cause: string; parts: string }
interface RendererView {
  perfSnapshot?: () => {
    gpu: string; tier: string; tierReason: string | null; textureCap: number; ladder: number; scale: number;
    upgrades: { done: number; total: number; inFlight: number; waiting: number; held: boolean };
    programs: number; textures: number; compression: string; pixelRatio: number; drawingBuffer: [number, number];
  };
  attachProbe?: () => void;
  diagnostics?: () => string;
}

const fmt = (n: number, d = 1): string => (Number.isFinite(n) ? n.toFixed(d) : '-');
const clock = (ms: number): string => `${fmt(ms / 1000, 2)}s`;

/** The GPU's own renderer string, read once from a throw-away context. */
function rendererString(): string {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') ?? c.getContext('webgl');
    if (!gl) return 'no WebGL';
    const e = gl.getExtension('WEBGL_debug_renderer_info');
    const s = e ? `${String(gl.getParameter(e.UNMASKED_RENDERER_WEBGL))}` : 'hidden by the browser';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return s;
  } catch {
    return 'unknown';
  }
}

export function installPerfOverlay(): void {
  if (typeof document === 'undefined' || (window as { __aetherPerf?: unknown }).__aetherPerf) return;
  const spans: Span[] = [];
  const jobs = new Map<string, number>();
  const swaps: number[] = [];
  const longTasks: Array<{ t0: number; t1: number }> = [];
  const long: LongFrame[] = [];
  const series: Array<[number, number]> = [];
  const marks: Array<{ at: number; label: string }> = [];
  /** The engine's state twice a second (resolution scale, ladder, upgrades), for reading a run afterwards. */
  const samples: Array<Record<string, number | string>> = [];
  const sink: PerfSink = {
    span(kind, t0, t1, self, detail) {
      spans.push({ kind, t0, t1, self, detail });
      if (spans.length > 4000) spans.splice(0, 2000);
      if (kind === 'swap') swaps.push(t1);
      if (self >= 4 && typeof performance.measure === 'function') {
        try {
          performance.measure(`aether:${kind}${detail ? ` ${detail}` : ''}`, { start: t0, end: t1 });
        } catch {
          // The user timing buffer is a convenience.
        }
      }
    },
    job(kind, delta) {
      jobs.set(kind, Math.max(0, (jobs.get(kind) ?? 0) + delta));
    },
  };
  setPerfSink(sink);
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) longTasks.push({ t0: e.startTime, t1: e.startTime + e.duration });
      if (longTasks.length > 400) longTasks.splice(0, 200);
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    // Not supported (Firefox, Safari): long frames without a hooked cause are "unknown".
  }

  const gpuString = rendererString();
  const start = performance.now();
  const wallStart = Date.now() - start;
  const view = (): RendererView | null => {
    const r = (window as { __aetherPlayer?: { simulation?: { renderer?: RendererView } | null } }).__aetherPlayer?.simulation?.renderer;
    return r ?? null;
  };

  // --- the frame loop ---
  const window10: Array<{ t: number; dt: number }> = [];
  let prev = performance.now();
  let spark: HTMLCanvasElement | null = null;
  const sparkVals: number[] = [];

  const attribute = (a: number, b: number, dt: number): { cause: string; parts: string } => {
    const by = new Map<string, { ms: number; detail: Set<string> }>();
    for (let i = spans.length - 1; i >= 0; i--) {
      const s = spans[i]!;
      if (s.t1 < a) {
        if (spans[i]!.t1 < a - 2000) break;
        continue;
      }
      if (s.t1 > b || s.self < 0.5) continue;
      const e = by.get(s.kind) ?? { ms: 0, detail: new Set<string>() };
      e.ms += s.self;
      if (s.detail && e.detail.size < 3) e.detail.add(s.detail);
      by.set(s.kind, e);
    }
    const parts = [...by.entries()].sort((x, y) => y[1].ms - x[1].ms).map(([k, v]) => `${k} ${fmt(v.ms, 0)}ms${v.detail.size ? ` (${[...v.detail].join(', ')})` : ''}`).join(', ');
    let other = 0;
    let top = '';
    let topMs = 0;
    for (const [k, v] of by) {
      if (BASE.has(k)) continue;
      other += v.ms;
      if (v.ms > topMs) { topMs = v.ms; top = k; }
    }
    if (other >= 12 || other >= dt * 0.15) return { cause: top, parts };
    const base = (by.get('draw')?.ms ?? 0) + (by.get('frame')?.ms ?? 0);
    if (base >= dt * 0.6) return { cause: (by.get('draw')?.ms ?? 0) >= (by.get('frame')?.ms ?? 0) ? 'draw (the scene itself)' : 'frame update (JS)', parts };
    const task = longTasks.filter((t) => t.t1 >= a && t.t0 <= b).reduce((m, t) => Math.max(m, t.t1 - t.t0), 0);
    const jobsNow = [...jobs].filter(([, n]) => n > 0).map(([k, n]) => `${k}x${n}`).join(' ');
    if (task >= 40) return { cause: `unknown (a ${fmt(task, 0)} ms task outside the hooks${jobsNow ? `; in flight: ${jobsNow}` : ''})`, parts };
    return { cause: `unknown (no long task: GPU or compositor wait${jobsNow ? `; in flight: ${jobsNow}` : ''})`, parts };
  };

  const loop = (): void => {
    const t = performance.now();
    const dt = t - prev;
    const a = prev;
    prev = t;
    if (dt < 1000) {
      window10.push({ t, dt });
      while (window10.length > 0 && window10[0]!.t < t - WINDOW_MS) window10.shift();
      if (series.length < SERIES_MAX) series.push([Math.round((t - start) * 10) / 10, Math.round(dt * 10) / 10]);
      sparkVals.push(dt);
      if (sparkVals.length > 150) sparkVals.shift();
    }
    // A hidden tab pauses rAF: gaps of seconds are not frames.
    if (dt > LONG_MS && dt < 5000 && !document.hidden) {
      const { cause, parts } = attribute(a, t, dt);
      long.push({ at: t - start, wall: new Date(wallStart + t).toISOString().slice(11, 23), dt, cause, parts });
      if (long.length > 400) long.splice(0, 200);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // --- numbers ---
  const frameStats = (): { fps: number; avg: number; p95: number; max: number; n: number } => {
    const d = window10.map((w) => w.dt).sort((x, y) => x - y);
    const n = d.length;
    if (n === 0) return { fps: 0, avg: 0, p95: 0, max: 0, n: 0 };
    const avg = d.reduce((s, v) => s + v, 0) / n;
    return { fps: 1000 / avg, avg, p95: d[Math.min(n - 1, Math.floor(n * 0.95))]!, max: d[n - 1]!, n };
  };
  const heap = (): string => {
    const m = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
    return m ? `${fmt(m.usedJSHeapSize / 1048576, 0)} MB of ${fmt(m.jsHeapSizeLimit / 1048576, 0)} MB` : 'not available';
  };
  const nav = navigator as Navigator & { deviceMemory?: number };
  const lines = (): string[] => {
    const r = view();
    const snap = r?.perfSnapshot?.();
    const f = frameStats();
    const t = performance.now();
    while (swaps.length > 0 && swaps[0]! < t - WINDOW_MS) swaps.shift();
    const out: string[] = [];
    out.push(`GPU (browser): ${gpuString}`);
    if (snap) {
      out.push(`GPU (engine): ${snap.gpu}`);
      out.push(`tier: ${snap.tier}${snap.tierReason ? `, because ${snap.tierReason}` : ''}`);
      out.push(`texture cap: ${snap.textureCap > 0 ? `${snap.textureCap} px (image maps; KTX2 files are not capped, see PERFORMANCE.md)` : 'none'}; compression: ${snap.compression}`);
      out.push(`ladder level: ${snap.ladder}; resolution scale: ${fmt(snap.scale, 2)}; pixel ratio ${fmt(snap.pixelRatio, 2)}; buffer ${snap.drawingBuffer.join('x')}`);
    } else out.push('engine: not started yet');
    out.push(`frames (10 s): ${fmt(f.fps, 1)} fps; avg ${fmt(f.avg)} ms; p95 ${fmt(f.p95)} ms; max ${fmt(f.max)} ms; n=${f.n}`);
    if (snap) {
      const u = snap.upgrades;
      out.push(`model upgrades: ${u.done} of ${u.total} done; ${u.inFlight} in flight; ${u.waiting} waiting${u.held ? '; held' : ''}; swaps in 10 s: ${swaps.length}`);
      out.push(`programs compiling: ${snap.programs}; textures on GPU: ${snap.textures}`);
    }
    const j = [...jobs].filter(([, n]) => n > 0).map(([k, n]) => `${k} x${n}`).join(', ');
    out.push(`jobs in flight: ${j || 'none'}`);
    out.push(`JS heap: ${heap()}; cores: ${nav.hardwareConcurrency ?? '?'}; memory: ${nav.deviceMemory ?? '?'} GB`);
    return out;
  };
  const longText = (n: number): string[] => long.slice(-n).reverse().map((l) => `${l.wall} +${clock(l.at)} ${fmt(l.dt, 0)} ms  ${l.cause}${l.parts ? `  [${l.parts}]` : ''}`);
  const report = (): string => {
    const r = view();
    const out = ['Aether perf report', `time: ${new Date().toISOString()}`, `page: ${location.href.replace(/[?#].*$/, '')}${location.hash}`, `userAgent: ${navigator.userAgent}`, `screen: ${screen.width}x${screen.height} @${fmt(devicePixelRatio, 2)}`, ...lines(), '', `long frames over ${LONG_MS} ms (newest first, up to ${KEEP_LONG}; total ${long.length}):`, ...longText(KEEP_LONG)];
    const byKind = new Map<string, { n: number; ms: number }>();
    for (const l of long) {
      const k = l.cause.replace(/ \(.*$/, '');
      const e = byKind.get(k) ?? { n: 0, ms: 0 };
      e.n++;
      e.ms += l.dt;
      byKind.set(k, e);
    }
    out.push('', 'long frames by cause: ' + ([...byKind].sort((x, y) => y[1].ms - x[1].ms).map(([k, v]) => `${k} x${v.n} (${fmt(v.ms, 0)} ms)`).join('; ') || 'none'));
    try {
      const d = r?.diagnostics?.();
      if (d) out.push('', d);
    } catch {
      // The renderer's own report is a bonus.
    }
    return out.join('\n');
  };

  // --- the panel ---
  const box = document.createElement('div');
  box.setAttribute('data-testid', 'perf-overlay');
  box.style.cssText = 'position:fixed;left:6px;top:6px;z-index:2147483000;max-width:min(560px,94vw);padding:6px 8px;border-radius:6px;background:rgba(10,12,10,.82);color:#e9eadf;font:11px/1.35 ui-monospace,Menlo,Consolas,monospace;pointer-events:none;white-space:pre-wrap;word-break:break-word';
  const body = document.createElement('div');
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;gap:6px;margin-bottom:4px;pointer-events:auto';
  const button = (label: string, on: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = 'font:inherit;padding:1px 7px;border-radius:4px;border:1px solid #8a8f78;background:#2a2d24;color:#e9eadf;cursor:pointer';
    b.addEventListener('click', on);
    return b;
  };
  const status = document.createElement('span');
  status.style.cssText = 'align-self:center;opacity:.8';
  let collapsed = false;
  const copy = button('Copy report', () => {
    const text = report();
    const done = (ok: boolean): void => {
      status.textContent = ok ? `copied ${text.length} chars` : 'copy failed; the report is in the console';
      if (!ok) console.log(text);
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => done(true), () => fallback(text, done));
    else fallback(text, done);
  });
  const hide = button('Hide', () => {
    collapsed = !collapsed;
    body.hidden = collapsed;
    hide.textContent = collapsed ? 'Show' : 'Hide';
  });
  bar.append(copy, hide, status);
  spark = document.createElement('canvas');
  spark.width = 300;
  spark.height = 30;
  spark.style.cssText = 'display:block;width:300px;height:30px;margin-top:3px';
  body.append(document.createElement('pre'), spark, document.createElement('pre'));
  const [pre1, , pre2] = body.children as unknown as [HTMLPreElement, HTMLCanvasElement, HTMLPreElement];
  for (const p of [pre1, pre2]) p.style.cssText = 'margin:0;font:inherit;white-space:pre-wrap';
  box.append(bar, body);
  document.body.append(box);

  const draw = (): void => {
    const ctx = spark?.getContext('2d');
    if (!ctx || !spark) return;
    ctx.clearRect(0, 0, spark.width, spark.height);
    const w = spark.width / 150;
    for (let i = 0; i < sparkVals.length; i++) {
      const v = sparkVals[i]!;
      const h = Math.min(spark.height, (v / 100) * spark.height);
      ctx.fillStyle = v > 100 ? '#e0644f' : v > LONG_MS ? '#e0b44f' : '#8fbf6a';
      ctx.fillRect(i * w, spark.height - h, Math.max(1, w - 0.5), h);
    }
  };
  setInterval(() => {
    const rv = view();
    rv?.attachProbe?.();
    const sn = rv?.perfSnapshot?.();
    if (sn && samples.length < 20_000) samples.push({ t: Math.round(performance.now() - start), scale: Math.round(sn.scale * 100) / 100, ladder: sn.ladder, tier: sn.tier, done: sn.upgrades.done, total: sn.upgrades.total, inFlight: sn.upgrades.inFlight, held: sn.upgrades.held ? 1 : 0, programs: sn.programs });
    if (collapsed) return;
    pre1.textContent = lines().join('\n');
    pre2.textContent = `long frames (>${LONG_MS} ms, newest first):\n${longText(SHOWN_LONG).join('\n') || 'none yet'}`;
    draw();
  }, 500);

  (window as unknown as { __aetherPerf: unknown }).__aetherPerf = {
    report,
    series,
    long,
    spans,
    marks,
    samples,
    mark: (label: string) => marks.push({ at: performance.now() - start, label }),
    now: () => performance.now() - start,
    frameStats,
    snapshot: () => view()?.perfSnapshot?.() ?? null,
  };
}

/** `execCommand('copy')` for pages where the async clipboard is refused (an insecure origin, a missing permission). */
function fallback(text: string, done: (ok: boolean) => void): void {
  try {
    const t = document.createElement('textarea');
    t.value = text;
    t.style.cssText = 'position:fixed;left:-9999px';
    document.body.append(t);
    t.select();
    const ok = document.execCommand('copy');
    t.remove();
    done(ok);
  } catch {
    done(false);
  }
}
