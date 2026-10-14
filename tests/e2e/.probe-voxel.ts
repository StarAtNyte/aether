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
  let tFirst = 0;
  for (let i = 0; i < 2400 && !tFirst; i++) { tFirst = await page.evaluate(() => { const v = (window as any).__aether?.simulation?.voxel; const st = (window as any).__aether?.store.getState(); if (!v?.active || st?.agentBusy) return 0; const s = v.status(); return s.meshed > 0 && !s.compiling ? performance.now() : 0; }); if (!tFirst) await page.waitForTimeout(50); }
  log('first chunk at ' + Math.round(tFirst - mark));
  for (let i = 0; i < 600; i++) {
    const s = await page.evaluate(() => { const v = window.__aether?.simulation?.voxel; const st = window.__aether?.store.getState(); return v?.active && !st?.agentBusy ? v.status() : null; });
    if (s?.settled && s.meshed > 0) { log(JSON.stringify(s)); break; }
    await page.waitForTimeout(250);
  }
  const { profile } = await cdp.send('Profiler.stop');
  const lt = await page.evaluate((m) => (window as any).__lt.filter((e: number[]) => e[0] >= m), tFirst);
  log('long tasks (start rel, dur): ' + JSON.stringify(lt.map((e: number[]) => [e[0] - Math.round(mark), e[1]])));
  // self time per function
  const self = new Map<string, number>();
  const byId = new Map(profile.nodes.map((n: any) => [n.id, n]));
  const dt = profile.timeDeltas as number[];
  const counts = new Map<number, number>();
  profile.samples.forEach((id: number, i: number) => counts.set(id, (counts.get(id) ?? 0) + (dt[i] ?? 0)));
  for (const [id, us] of counts) { const n: any = byId.get(id); const f = n.callFrame; const k = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber}`; self.set(k, (self.get(k) ?? 0) + us); }
  // Attribute samples in each long task window (profile start ≈ mark).
  let t = 0; const win = new Map<number, Map<string, number>>();
  profile.samples.forEach((id: number, i: number) => { t += dt[i] ?? 0; const ms = t / 1000; const w = lt.findIndex((e: number[]) => ms >= e[0] - mark - 20 && ms <= e[0] - mark + e[1] + 20); if (w < 0) return; const n: any = byId.get(id); let stack = ''; let cur: any = n; let d = 0; const par = new Map<number, any>(); for (const nn of profile.nodes as any[]) for (const c of nn.children ?? []) par.set(c, nn);
    while (cur && d < 60) { const f = cur.callFrame; const file = f.url.split('/').pop(); if (d === 0 || (f.functionName && !/^(react|three|vendor)/.test(file))) { if (stack.split('<').length < 6) stack += `${f.functionName || '?'}@${file}:${f.lineNumber}` + '<'; } cur = par.get(cur.id); d++; }
    const m = win.get(w) ?? new Map(); m.set(stack, (m.get(stack) ?? 0) + (dt[i] ?? 0)); win.set(w, m); });
  for (const [w, m] of win) { log(`-- window ${w} ${JSON.stringify(lt[w])}`); [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([k, us]) => log(`   ${(us / 1000).toFixed(0)} ms ${k}`)); }
  [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).forEach(([k, us]) => log(`${(us / 1000).toFixed(0).padStart(7)} ms  ${k}`));
} finally { await browser.close(); await server.stop(); }
