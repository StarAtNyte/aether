/**
 * Main-thread blocking per user flow: long tasks (>50 ms), long animation frames with script attribution, rAF gaps and
 * input delay (a synthetic key press every 100 ms), plus a CDP CPU profile attributed to each long task.
 *
 * Flows: open each showcase world (cold page), enter Walk / Play, apply a chat edit, run Verify, export (.aether.json,
 * .glb, share link), window resize. A photo-to-room result is the opening of a `photo-*` world.
 *
 * Chromium only. Software GL unless `GEN_GPU=intel` / `AETHER_E2E_GPU=1` (the CPU numbers are comparable either way).
 * Prints a Markdown ranking and writes JSON with `--out=file.json`.
 *
 * Run: `npm run build && npx tsx tests/e2e/longtask.e2e.ts [--worlds=a,b] [--flows=open,play,edit,verify,export,resize] [--out=f.json] [--size=1280x720]`
 */
import { writeFileSync } from 'node:fs';
import { chromium, type CDPSession, type Page } from 'playwright';
import { CHROME_ARGS, SKIP_FIRST_RUN, findChrome, startServer } from './support/env';

const ARGS = process.argv.slice(2);
const arg = (name: string): string | undefined => ARGS.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const WORLDS = (arg('worlds') ?? 'highland-trail,lantern-isles,chain-reaction,blockfall,kart-canyon,neon-rain-city,kyoto-temple,painterly-meadow,four-seasons-garden,orbital-lab,sakura-river,casa-patio,skyline-penthouse,dusk-lake-house,hollow-gate,photo-hotel-bedroom,photo-twin-room,photo-vaulted-bedroom').split(',').filter(Boolean);
const FLOWS = (arg('flows') ?? 'open,play,edit,verify,export,resize').split(',');
/** Worlds that also run the follow-up flows (play, edit, verify, export, resize). */
const DEEP = (arg('deep') ?? 'highland-trail,casa-patio,skyline-penthouse').split(',');
const [W, H] = (arg('size') ?? '1280x720').split('x').map(Number) as [number, number];
const OUT = arg('out');
const TIMEOUT = 240_000;
const t0 = performance.now();
const log = (line: string): void => void process.stdout.write(`[${((performance.now() - t0) / 1000).toFixed(1).padStart(6)}s] ${line}\n`);

interface Task {
  start: number;
  dur: number;
  fn?: string;
  scripts?: string;
}
interface FlowResult {
  flow: string;
  world: string;
  wallMs: number;
  tasks: Task[];
  totalBlockedMs: number;
  worstMs: number;
  gapMaxMs: number;
  inputDelayMaxMs: number;
  inputDelayP95Ms: number;
}

/** Plain JS (the page forbids eval of strings; this goes through addInitScript). */
const PROBE = `(() => {
  const s = { tasks: [], loaf: [], gaps: [], inputs: [] };
  const types = PerformanceObserver.supportedEntryTypes || [];
  try { if (types.includes('longtask')) new PerformanceObserver((l) => { for (const e of l.getEntries()) s.tasks.push({ start: e.startTime, dur: e.duration }); }).observe({ type: 'longtask' }); } catch (e) {}
  try { if (types.includes('long-animation-frame')) new PerformanceObserver((l) => { for (const e of l.getEntries()) s.loaf.push({ start: e.startTime, dur: e.duration, blocking: e.blockingDuration || 0, scripts: (e.scripts || []).map((x) => ({ inv: String(x.invoker || ''), fn: String(x.sourceFunctionName || ''), url: String(x.sourceURL || '').split('/').pop(), dur: x.duration })) }); }).observe({ type: 'long-animation-frame' }); } catch (e) {}
  try { if (types.includes('event')) new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'keydown' || e.name === 'pointerdown' || e.name === 'click') s.inputs.push({ start: e.startTime, delay: e.processingStart - e.startTime, dur: e.duration }); }).observe({ type: 'event', durationThreshold: 16 }); } catch (e) {}
  let last = performance.now();
  const tick = (now) => { if (now - last > 50) s.gaps.push({ start: last, dur: now - last }); last = now; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  window.__ltProbe = { reset() { s.tasks = []; s.loaf = []; s.gaps = []; s.inputs = []; last = performance.now(); }, read() { return JSON.parse(JSON.stringify(s)); }, now() { return performance.now(); } };
})();`;

interface Prof {
  startTime: number;
  nodes: Array<{ id: number; callFrame: { functionName: string; url: string; lineNumber: number }; children?: number[] }>;
  samples: number[];
  timeDeltas: number[];
}

/** For each long task: the functions with most self time inside the task, and the top inclusive functions. */
function attribute(prof: Prof, pageStart: number, tasks: Task[]): void {
  const byId = new Map(prof.nodes.map((n) => [n.id, n]));
  const parent = new Map<number, number>();
  for (const n of prof.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const label = (id: number): string => {
    const n = byId.get(id);
    if (!n) return '?';
    return `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop() ?? ''}:${n.callFrame.lineNumber}`;
  };
  const times: number[] = [];
  let acc = 0;
  for (const d of prof.timeDeltas) {
    acc += d;
    times.push(pageStart + acc / 1000);
  }
  for (const t of tasks) {
    const self = new Map<string, number>();
    const incl = new Map<string, number>();
    for (let i = 0; i < times.length; i++) {
      const ts = times[i] as number;
      if (ts < t.start || ts > t.start + t.dur) continue;
      const w = (prof.timeDeltas[i + 1] ?? prof.timeDeltas[i] ?? 0) / 1000;
      const id = prof.samples[i] as number;
      const l = label(id);
      self.set(l, (self.get(l) ?? 0) + w);
      const seen = new Set<string>();
      for (let p: number | undefined = id; p !== undefined; p = parent.get(p)) {
        const pl = label(p);
        if (/^\((root|program|idle)\)/.test(pl) || seen.has(pl)) continue;
        seen.add(pl);
        incl.set(pl, (incl.get(pl) ?? 0) + w);
      }
    }
    const top = (m: Map<string, number>, k: number): string =>
      [...m]
        .sort((a, b) => b[1] - a[1])
        .slice(0, k)
        .map(([n, v]) => `${v.toFixed(0)}ms ${n}`)
        .join(' | ');
    t.fn = `self: ${top(self, 3)}  incl: ${top(incl, t.dur > 1000 ? 30 : 6)}`;
  }
}

async function waitOpen(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const a = window.__aether;
      if (!a || a.simulation === null) return false;
      const st = a.store.getState();
      const w = a.history.current;
      return st.loading === null && !st.agentBusy && (Object.keys(w.entities).length > 0 || w.voxel !== undefined);
    },
    null,
    { timeout: TIMEOUT, polling: 100 },
  );
  await page.evaluate(async () => window.__aether?.simulation?.whenSynced());
}

interface Probe {
  tasks: Array<{ start: number; dur: number }>;
  loaf: Array<{ start: number; dur: number; blocking: number; scripts: Array<{ inv: string; fn: string; url: string; dur: number }> }>;
  gaps: Array<{ start: number; dur: number }>;
  inputs: Array<{ start: number; delay: number; dur: number }>;
}

/** Run `fn` as a measured flow: probe reset, CPU profile, a key press every 100 ms. */
async function measure(page: Page, cdp: CDPSession, world: string, flow: string, fn: () => Promise<void>, results: FlowResult[], keepProbe = false): Promise<void> {
  if (!keepProbe) await page.evaluate(() => window.__ltProbe?.reset());
  await cdp.send('Profiler.start');
  const pageStart = await page.evaluate(() => window.__ltProbe?.now() ?? 0);
  const t = performance.now();
  let running = true;
  const keys = (async (): Promise<void> => {
    while (running) {
      await page.keyboard.press('Shift').catch(() => undefined);
      await new Promise((r) => setTimeout(r, 100));
    }
  })();
  try {
    await fn();
  } finally {
    running = false;
    await keys;
  }
  const wallMs = performance.now() - t;
  await page.waitForTimeout(300);
  const { profile } = (await cdp.send('Profiler.stop')) as { profile: Prof };
  const p = await page.evaluate(() => window.__ltProbe?.read() as unknown as Probe);
  const tasks: Task[] = p.tasks.map((x) => ({ start: x.start, dur: x.dur }));
  for (const task of tasks) {
    const l = p.loaf.find((f) => f.start <= task.start + task.dur && task.start <= f.start + f.dur);
    if (l) task.scripts = l.scripts.filter((s) => s.dur > 10).map((s) => `${s.dur.toFixed(0)}ms ${s.inv}${s.fn ? ` ${s.fn}` : ''} ${s.url}`).join(' | ');
  }
  attribute(profile, pageStart, tasks);
  const delays = p.inputs.map((i) => i.delay).sort((a, b) => a - b);
  const r: FlowResult = {
    flow,
    world,
    wallMs,
    tasks,
    totalBlockedMs: tasks.reduce((s, x) => s + Math.max(0, x.dur - 50), 0),
    worstMs: tasks.reduce((m, x) => Math.max(m, x.dur), 0),
    gapMaxMs: p.gaps.reduce((m, x) => Math.max(m, x.dur), 0),
    inputDelayMaxMs: delays[delays.length - 1] ?? 0,
    inputDelayP95Ms: delays[Math.floor(delays.length * 0.95)] ?? 0,
  };
  results.push(r);
  log(`${world} ${flow}: wall ${wallMs.toFixed(0)}ms, ${tasks.length} long tasks, blocked ${r.totalBlockedMs.toFixed(0)}ms, worst ${r.worstMs.toFixed(0)}ms, rAF gap ${r.gapMaxMs.toFixed(0)}ms, input delay max ${r.inputDelayMaxMs.toFixed(0)}ms`);
  for (const task of [...tasks].sort((a, b) => b.dur - a.dur).slice(0, 3)) log(`    ${task.dur.toFixed(0)}ms ${task.scripts ?? ''} :: ${task.fn ?? ''}`);
}

declare global {
  interface Window {
    __ltProbe?: { reset(): void; read(): unknown; now(): number };
  }
}

async function main(): Promise<void> {
  const server = await startServer(log);
  const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS, '--enable-precise-memory-info'] });
  const results: FlowResult[] = [];
  try {
    for (const slug of WORLDS) {
      const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
      await context.addInitScript({ content: SKIP_FIRST_RUN });
      await context.addInitScript({ content: 'globalThis.__name = (f) => f;' });
      await context.addInitScript({ content: PROBE });
      try {
        const page = await context.newPage();
        page.on('dialog', (d) => void d.dismiss().catch(() => undefined));
        const cdp = await context.newCDPSession(page);
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
        await page.goto(`${server.url}/?debug=1#/new/${slug}`, { waitUntil: 'commit' });
        if (FLOWS.includes('open')) {
          // The probe is installed before the first script: no reset, the open flow starts with the page.
          await measure(page, cdp, slug, 'open', () => waitOpen(page), results, true);
        } else await waitOpen(page);
        await page.waitForFunction(() => window.__aether?.simulation?.renderer.animating === false, null, { timeout: 60_000, polling: 250 }).catch(() => undefined);
        if (!DEEP.includes(slug)) continue;
        if (FLOWS.includes('resize')) {
          await measure(page, cdp, slug, 'resize', async () => {
            await page.setViewportSize({ width: 1000, height: 640 });
            await page.waitForTimeout(800);
            await page.setViewportSize({ width: W, height: H });
            await page.waitForTimeout(800);
          }, results);
        }
        if (FLOWS.includes('edit')) {
          await measure(page, cdp, slug, 'chat-edit', async () => {
            await page.evaluate(() => void window.__aether?.studio.send('add a tall pine tree and a small lamp next to it'));
            await page.waitForFunction(() => !window.__aether?.store.getState().agentBusy, null, { timeout: TIMEOUT, polling: 100 });
            await page.evaluate(async () => window.__aether?.simulation?.whenSynced());
          }, results);
        }
        if (FLOWS.includes('verify')) {
          await measure(page, cdp, slug, 'verify', async () => {
            await page.evaluate(() => void window.__aether?.studio.runVerify());
            await page.waitForFunction(() => window.__aether?.store.getState().verify.status !== 'running', null, { timeout: TIMEOUT, polling: 100 });
          }, results);
        }
        if (FLOWS.includes('export')) {
          await measure(page, cdp, slug, 'export-json', async () => {
            const d = page.waitForEvent('download', { timeout: 60_000 }).catch(() => null);
            await page.evaluate(() => window.__aether?.studio.exportToFile());
            await d;
          }, results);
          await measure(page, cdp, slug, 'export-glb', async () => {
            const d = page.waitForEvent('download', { timeout: 120_000 }).catch(() => null);
            await page.evaluate(async () => window.__aether?.studio.exportGltf());
            await d;
          }, results);
          await measure(page, cdp, slug, 'share', async () => void (await page.evaluate(async () => window.__aether?.studio.share().catch(() => null))), results);
        }
        if (FLOWS.includes('play')) {
          await measure(page, cdp, slug, 'play', async () => {
            await page.evaluate(async () => window.__aether?.studio.togglePlay());
            await page.waitForTimeout(3000);
          }, results);
          await measure(page, cdp, slug, 'stop', async () => {
            await page.evaluate(async () => window.__aether?.studio.togglePlay());
            await page.waitForTimeout(500);
          }, results);
        }
      } catch (e) {
        log(`${slug}: FAILED ${e instanceof Error ? e.message.slice(0, 300) : String(e)}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await server.stop();
  }
  const rank = (key: 'totalBlockedMs' | 'worstMs'): FlowResult[] => [...results].sort((a, b) => b[key] - a[key]);
  log('## Ranking by total blocked ms (sum of long-task time over 50 ms)');
  for (const r of rank('totalBlockedMs').slice(0, 25)) log(`| ${r.world} | ${r.flow} | blocked ${r.totalBlockedMs.toFixed(0)} | worst ${r.worstMs.toFixed(0)} | tasks ${r.tasks.length} | input max ${r.inputDelayMaxMs.toFixed(0)} |`);
  log('## Ranking by worst single task');
  for (const r of rank('worstMs').slice(0, 15)) log(`| ${r.world} | ${r.flow} | worst ${r.worstMs.toFixed(0)} | ${[...r.tasks].sort((a, b) => b.dur - a.dur)[0]?.fn?.slice(0, 160) ?? ''} |`);
  if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 1));
  log('LONGTASK DONE');
}

main().catch((e: unknown) => {
  log(`FAILED: ${e instanceof Error ? e.stack : String(e)}`);
  process.exitCode = 1;
});
