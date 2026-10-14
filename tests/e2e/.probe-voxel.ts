import { chromium } from 'playwright';
import { CHROME_ARGS, findChrome, startServer, SKIP_FIRST_RUN } from './support/env';
const log = (s: string) => console.log(s);
const server = await startServer(log);
const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript({ content: SKIP_FIRST_RUN });
  await ctx.addInitScript({ content: 'globalThis.__name = (f) => f; window.__lt=[]; try{new PerformanceObserver(l=>{for(const e of l.getEntries()) window.__lt.push([Math.round(e.startTime),Math.round(e.duration)])}).observe({type:"longtask",buffered:true})}catch{}' });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type()==='warning') log('console: ' + m.text().slice(0, 300)); });
  await page.goto(`${server.url}/?debug=1#/new`);
  for (let i = 0; i < 300; i++) { if (await page.evaluate(() => !!window.__aether?.simulation && window.__aether.store.getState().loading === null)) break; await page.waitForTimeout(200); }
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
  const mark = await page.evaluate(() => performance.now());
  await cdp.send('Profiler.start');
  const input = page.getByLabel('Prompt', { exact: true });
  await input.fill(process.argv[2] ?? 'a minecraft-like survival world');
  await input.press('Enter');
  for (let i = 0; i < 600; i++) {
    const s = await page.evaluate(() => { const v = window.__aether?.simulation?.voxel; const st = window.__aether?.store.getState(); return v?.active && !st?.agentBusy ? v.status() : null; });
    if (s?.settled && s.meshed > 0) { log(JSON.stringify(s)); break; }
    await page.waitForTimeout(250);
  }
  const { profile } = await cdp.send('Profiler.stop');
  const lt = await page.evaluate((m) => (window as any).__lt.filter((e: number[]) => e[0] >= m), mark);
  log('long tasks (start rel, dur): ' + JSON.stringify(lt.map((e: number[]) => [e[0] - Math.round(mark), e[1]])));
  // self time per function
  const self = new Map<string, number>();
  const byId = new Map(profile.nodes.map((n: any) => [n.id, n]));
  const dt = profile.timeDeltas as number[];
  const counts = new Map<number, number>();
  profile.samples.forEach((id: number, i: number) => counts.set(id, (counts.get(id) ?? 0) + (dt[i] ?? 0)));
  for (const [id, us] of counts) { const n: any = byId.get(id); const f = n.callFrame; const k = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber}`; self.set(k, (self.get(k) ?? 0) + us); }
  [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).forEach(([k, us]) => log(`${(us / 1000).toFixed(0).padStart(7)} ms  ${k}`));
} finally { await browser.close(); await server.stop(); }
