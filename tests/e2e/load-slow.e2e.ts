/**
 * Load time of a production build on a slow phone: Slow 4G (1.6 Mbps down, 150 ms RTT) and a 4x CPU slowdown, set
 * through CDP. Serves a build directory from a small static server that brotli-compresses like the host does
 * (hashed assets immutable), then measures from a cold HTTP cache and again warm:
 *   - the home page, first visit (first-run screen) and returning visit: requests, transferred bytes, FCP, LCP,
 *     total blocking time (long tasks after FCP) and time to interactive (first button; last long task end);
 *   - opening a bundled example: time until the world is synced (the first frame follows).
 * Prints Markdown rows. Chromium only; numbers are relative (software GPU unless AETHER_E2E_GPU=1).
 *
 * Run: `AETHER_OUTDIR=/tmp/x npm run build && npm run e2e:load-slow -- --dist=/tmp/x [--example=casa-patio] [--cpu=4] [--label=after]`
 */
import { createServer, type Server } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { brotliCompressSync, constants } from 'node:zlib';
import { extname, join, resolve } from 'node:path';
import { chromium, type CDPSession } from 'playwright';
import { CHROME_ARGS, SKIP_FIRST_RUN, findChrome } from './support/env';

const ARGS = process.argv.slice(2);
const arg = (n: string): string | undefined => ARGS.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const DIST = resolve(arg('dist') ?? 'apps/studio/dist');
const EXAMPLE = arg('example') ?? 'casa-patio';
const CPU = Number(arg('cpu') ?? 4);
const LABEL = arg('label') ?? 'build';
const NET = { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 };
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json', '.glb': 'model/gltf-binary', '.txt': 'text/plain' };
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.wasm', '.svg', '.webmanifest', '.txt']);
const brCache = new Map<string, Buffer>();

function serve(): Promise<{ url: string; server: Server }> {
  const server = createServer((req, res) => {
    let p = decodeURIComponent((req.url ?? '/').split(/[?#]/)[0]!);
    if (p === '/') p = '/index.html';
    else if (p === '/play') p = '/play.html';
    let file = join(DIST, p);
    if (!file.startsWith(DIST) || !existsSync(file) || !statSync(file).isFile()) {
      if (existsSync(`${file}.html`)) file = `${file}.html`;
      else { res.writeHead(404).end('not found'); return; }
    }
    const ext = extname(file);
    const headers: Record<string, string> = { 'content-type': MIME[ext] ?? 'application/octet-stream', 'cache-control': /^\/(assets|fonts)\//.test(p) ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate' };
    let body: Buffer = readFileSync(file);
    if (COMPRESSIBLE.has(ext) && /\bbr\b/.test(String(req.headers['accept-encoding']))) {
      let c = brCache.get(file);
      if (!c) { c = brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } }); brCache.set(file, c); }
      body = c;
      headers['content-encoding'] = 'br';
    }
    headers['content-length'] = String(body.length);
    res.writeHead(200, headers).end(body);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, server })));
}

const INIT = `
  window.__m = { fcp: 0, lcp: 0, longs: [] };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__m.fcp = e.startTime; }).observe({ type: 'paint', buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__m.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__m.longs.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch {}
`;

interface Row { label: string; req: number; kb: number; jsKb: number; fcp: number; lcp: number; tbt: number; tti: number; extra: string }
const kb = (n: number): number => Math.round(n / 1024);

async function measure(cdp: CDPSession, run: () => Promise<number | null>, page: import('playwright').Page, world: boolean): Promise<Omit<Row, 'label'>> {
  const reqs = new Map<string, { type: string; bytes: number }>();
  const types = new Map<string, string>();
  cdp.on('Network.responseReceived', (e) => types.set(e.requestId, e.type));
  cdp.on('Network.loadingFinished', (e) => reqs.set(e.requestId, { type: types.get(e.requestId) ?? '', bytes: e.encodedDataLength }));
  const start = performance.now();
  const interactiveAt = await run();
  const wall = performance.now() - start;
  await page.waitForTimeout(2500);
  const m = await page.evaluate(() => (window as unknown as { __m: { fcp: number; lcp: number; longs: Array<[number, number]> } }).__m);
  const tbt = m.longs.filter(([s]) => s >= m.fcp).reduce((a, [, d]) => a + Math.max(0, d - 50), 0);
  const lastLong = m.longs.reduce((a, [s, d]) => Math.max(a, s + d), 0);
  const all = [...reqs.values()];
  return { req: all.length, kb: kb(all.reduce((a, r) => a + r.bytes, 0)), jsKb: kb(all.filter((r) => r.type === 'Script').reduce((a, r) => a + r.bytes, 0)), fcp: Math.round(m.fcp), lcp: Math.round(m.lcp), tbt: Math.round(tbt), tti: Math.round(world ? (interactiveAt ?? wall) : Math.max(interactiveAt ?? wall, lastLong)), extra: '' };
}

async function main(): Promise<void> {
  const { url, server } = await serve();
  const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
  const rows: Row[] = [];
  try {
    const scenarios: Array<{ label: string; skipFirstRun: boolean; path: string; warm: boolean; world: boolean; idleThenOpen?: boolean }> = [
      { label: 'home, first visit', skipFirstRun: false, path: '/?debug=1', warm: false, world: false },
      { label: 'home, returning', skipFirstRun: true, path: '/?debug=1', warm: false, world: false },
      { label: 'home, returning (warm cache)', skipFirstRun: true, path: '/?debug=1', warm: true, world: false },
      { label: `open ${EXAMPLE} (cold)`, skipFirstRun: true, path: `/?debug=1#/new/${EXAMPLE}`, warm: false, world: true },
      { label: `open ${EXAMPLE} 20 s after the home page (cold, background fetch done)`, skipFirstRun: true, path: '/?debug=1', warm: false, world: true, idleThenOpen: true },
      { label: `open ${EXAMPLE} (warm cache)`, skipFirstRun: true, path: `/?debug=1#/new/${EXAMPLE}`, warm: true, world: true },
    ];
    for (const sc of scenarios) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
      if (sc.skipFirstRun) await context.addInitScript({ content: SKIP_FIRST_RUN });
      await context.addInitScript({ content: INIT });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.clearBrowserCache');
      if (sc.warm) {
        // Prime the HTTP cache (and the origin's storage) with an unthrottled visit, then reload throttled.
        await page.goto(url + sc.path, { waitUntil: 'load' });
        if (sc.world) await waitWorld(page);
        else await page.waitForSelector('button');
        await page.waitForTimeout(1500);
        await page.goto('about:blank');
      }
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
      await cdp.send('Network.emulateNetworkConditions', { offline: false, ...NET });
      const r = await measure(cdp, async () => {
        const t0 = performance.now();
        await page.goto(url + sc.path, { waitUntil: 'commit' });
        if (sc.idleThenOpen) {
          await page.waitForSelector('button', { timeout: 120_000 });
          await page.waitForTimeout(20_000);
          const t1 = performance.now();
          await page.evaluate((h) => { location.hash = h; }, `#/new/${EXAMPLE}`);
          await waitWorld(page);
          return performance.now() - t1;
        }
        if (sc.world) { await waitWorld(page); return performance.now() - t0; }
        await page.waitForSelector('button', { timeout: 120_000 });
        return performance.now() - t0;
      }, page, sc.world);
      rows.push({ label: sc.label, ...r });
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`\n| ${LABEL} (Slow 4G, ${CPU}x CPU) | requests | transferred | of which JS | FCP | LCP | TBT | interactive (home) / world synced (open) |\n|---|---|---|---|---|---|---|---|`);
  for (const r of rows) console.log(`| ${r.label} | ${r.req} | ${r.kb} kB | ${r.jsKb} kB | ${r.fcp} ms | ${r.lcp} ms | ${r.tbt} ms | ${r.tti} ms |`);
}

async function waitWorld(page: import('playwright').Page): Promise<void> {
  await page.waitForFunction(() => {
    const a = (window as unknown as { __aether?: { simulation: unknown; store: { getState(): { loading: unknown; agentBusy: boolean } }; history: { current: { entities: Record<string, unknown>; voxel?: unknown } } } }).__aether;
    if (!a || a.simulation === null) return false;
    const st = a.store.getState(), w = a.history.current;
    return st.loading === null && !st.agentBusy && (Object.keys(w.entities).length > 0 || w.voxel !== undefined);
  }, null, { timeout: 300_000, polling: 100 });
  await page.evaluate(async () => { await (window as unknown as { __aether?: { simulation?: { whenSynced(): Promise<void> } } }).__aether?.simulation?.whenSynced(); });
}

main().catch((e) => { console.error(e); process.exit(1); });
