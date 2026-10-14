import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { CHROME_ARGS, findChrome, startServer, SKIP_FIRST_RUN } from './support/env';
const log = (s: string) => console.log(s);
const server = await startServer(log);
const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS, ...(process.env.GL ? [] : [])] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript({ content: SKIP_FIRST_RUN });
  if (process.env.GL) await ctx.addInitScript({ content: 'try { delete Navigator.prototype.gpu; } catch {}' });
  const page = await ctx.newPage();
  await page.goto(`${server.url}/?debug=1#/new`);
  for (let i = 0; i < 300; i++) { if (await page.evaluate(() => !!(window as any).__aether?.simulation && (window as any).__aether.store.getState().loading === null)) break; await page.waitForTimeout(200); }
  await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8.execute', 'blink', 'gpu', 'disabled-by-default-v8.cpu_profiler'] });
  const input = page.getByLabel('Prompt', { exact: true });
  await input.fill(process.argv[2] ?? 'a minecraft-like survival world');
  await input.press('Enter');
  for (let i = 0; i < 600; i++) {
    const s = await page.evaluate(() => { const v = (window as any).__aether?.simulation?.voxel; const st = (window as any).__aether?.store.getState(); return v?.active && !st?.agentBusy ? v.status() : null; });
    if (s?.settled && s.meshed > 0) { log(JSON.stringify(s)); break; }
    await page.waitForTimeout(250);
  }
  const buf = await browser.stopTracing();
  const trace = JSON.parse(buf.toString());
  const ev = (trace.traceEvents as any[]);
  const main = ev.filter((e) => e.name === 'RunTask' && e.dur > 50000);
  // threads
  const names = new Map<string, string>(); for (const e of ev) if (e.name === 'thread_name') names.set(`${e.pid}:${e.tid}`, e.args.name);
  for (const t of main) {
    const th = names.get(`${t.pid}:${t.tid}`);
    if (th !== 'CrRendererMain') continue;
    const kids = ev.filter((e) => e.pid === t.pid && e.tid === t.tid && e.ts >= t.ts && e.ts + (e.dur ?? 0) <= t.ts + t.dur && e !== t && (e.dur ?? 0) > 5000);
    log(`RunTask ${(t.dur / 1000).toFixed(0)} ms: ` + kids.slice(0, 14).map((k) => `${k.name}${k.args?.data?.functionName ? '(' + k.args.data.functionName + ')' : ''}${k.args?.data?.url ? '[' + String(k.args.data.url).split('/').pop() + ':' + k.args.data.lineNumber + ']' : ''} ${(k.dur / 1000).toFixed(0)}`).join(' | '));
  }
} finally { await browser.close(); await server.stop(); }
