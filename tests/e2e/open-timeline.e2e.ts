/**
 * Timeline of opening a bundled example world on a slow phone (Slow 4G, 4x CPU through CDP), cold and warm:
 * which request class finishes when, the loading text the person reads, and the milestones of the picture
 *   poster          the card thumbnail paints behind the skeleton (something real on screen)
 *   editor code     the editor route's JS has run (the skeleton or the viewport is mounted)
 *   world           the world JSON is parsed and the project exists
 *   renderer        the simulation exists (shaders for the first frame are linking)
 *   first frame     the renderer has drawn a frame and the loading overlay is gone
 *   lit frame       the baked light is applied (a lightmap file or the light volume)
 *   full quality    the last texture / model / lightmap response of the open has arrived and the network is quiet
 * Prints a Markdown table per scenario. Chromium only; software GL, so only before/after comparisons matter.
 *
 * Run: `AETHER_OUTDIR=/tmp/x npm run build && npx tsx tests/e2e/open-timeline.e2e.ts --dist=/tmp/x [--example=casa-patio] [--cpu=4] [--label=after] [--warm=1]`
 */
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { CHROME_ARGS, SKIP_FIRST_RUN, findChrome } from './support/env';
import { SLOW_4G, serveDist } from './support/slow-server';

const ARGS = process.argv.slice(2);
const arg = (n: string): string | undefined => ARGS.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const DIST = resolve(arg('dist') ?? 'apps/studio/dist');
const EXAMPLE = arg('example') ?? 'casa-patio';
const CPU = Number(arg('cpu') ?? 4);
const LABEL = arg('label') ?? 'build';
const WARM = (arg('warm') ?? '1') !== '0';
const LIST = arg('list') !== undefined;
/** `--block=regex`: abort matching requests (isolates what the first frame waits for). */
const BLOCK = arg('block');

/** Request classes by URL. Order matters: the first match wins. */
const CLASSES: Array<[string, RegExp]> = [
  ['poster', /\/templates\/[a-z0-9-]+\.webp/],
  ['lightmap', /\.lmap(\?|$)/],
  ['world json', /\/templates\/[a-z0-9-]+\.json/],
  ['texture', /\.(ktx2|webp|png|jpe?g|basis)(\?|$)|\/textures?\//],
  ['model', /\.glb(\?|$)|\/lib\/.*\.(gltf|bin)/],
  ['wasm', /\.wasm/],
  ['js', /\.js(\?|$)/],
];

const PROBE = `(() => {
  const t = { marks: {}, loading: [], lm: [], perf: [] };
  window.__tl = t;
  const mark = (k) => { if (!(k in t.marks)) t.marks[k] = Math.round(performance.now()); };
  let lastLoading = '\\u0000', lastLm = '';
  const tick = () => {
    requestAnimationFrame(tick);
    if (document.querySelector('.editor--skeleton')) mark('skeleton');
    if (document.querySelector('.editor:not(.editor--skeleton)')) mark('editor');
    const a = window.__aether;
    if (!a) return;
    const st = a.store.getState();
    if (st.loading !== lastLoading) { lastLoading = st.loading; t.loading.push([Math.round(performance.now()), st.loading]); }
    const lm = st.lightmap ? st.lightmap.state : '';
    if (lm !== lastLm) { lastLm = lm; t.lm.push([Math.round(performance.now()), lm]); }
    if (Object.keys(a.history.current.entities).length > 0) mark('world');
    const sim = a.simulation;
    if (sim) {
      mark('renderer');
      if (sim.renderer.frameCount > 0) mark('drawn');
      if (sim.renderer.frameCount > 0 && st.loading === null) mark('first');
      if (st.loading === null && lm === 'applied') mark('lit');
    }
  };
  requestAnimationFrame(tick);
})();`;

interface Req { url: string; cls: string; start: number; end: number; bytes: number }

async function scenario(browser: import('playwright').Browser, base: string, warm: boolean): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await context.addInitScript({ content: SKIP_FIRST_RUN });
  await context.addInitScript({ content: PROBE });
  if (BLOCK) await context.route(new RegExp(BLOCK), (r) => r.abort());
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.clearBrowserCache');
  const path = `/?debug=1#/new/${EXAMPLE}`;
  if (warm) {
    await page.goto(base + path, { waitUntil: 'load' });
    await page.waitForFunction(() => (window as unknown as { __tl: { marks: Record<string, number> } }).__tl.marks['first'] !== undefined, null, { timeout: 300_000 });
    await page.waitForTimeout(3000);
    await page.goto('about:blank');
  }
  const reqs = new Map<string, Req>();
  const t0 = { v: 0 };
  cdp.on('Network.requestWillBeSent', (e) => {
    if (reqs.size === 0 || t0.v === 0) t0.v = e.timestamp;
    reqs.set(e.requestId, { url: e.request.url, cls: CLASSES.find(([, re]) => re.test(e.request.url))?.[0] ?? 'other', start: (e.timestamp - t0.v) * 1000, end: 0, bytes: 0 });
  });
  cdp.on('Network.loadingFinished', (e) => {
    const r = reqs.get(e.requestId);
    if (r) { r.end = (e.timestamp - t0.v) * 1000; r.bytes = e.encodedDataLength; }
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, ...SLOW_4G });
  const nav = performance.now();
  await page.goto(base + path, { waitUntil: 'commit' });
  const sample = (): Promise<{ perf: Array<[string, number]>; marks: Record<string, number>; loading: Array<[number, string | null]>; lm: Array<[number, string]> }> => page.evaluate(() => (window as unknown as { __tl: never }).__tl);
  await page.waitForFunction(() => (window as unknown as { __tl: { marks: Record<string, number> } }).__tl.marks['first'] !== undefined, null, { timeout: 300_000, polling: 100 });
  const firstWall = performance.now() - nav;
  // Full quality: no asset response for 3 s.
  let quietSince = performance.now();
  let seen = 0;
  for (;;) {
    await page.waitForTimeout(500);
    const n = [...reqs.values()].filter((r) => r.end > 0).length;
    if (n !== seen) { seen = n; quietSince = performance.now(); }
    if (performance.now() - quietSince > 3000 || performance.now() - nav > 240_000) break;
  }
  await page.evaluate(() => { const t = (window as unknown as { __tl: { perf: Array<[string, number]> } }).__tl; t.perf = performance.getEntriesByType('mark').filter((m) => m.name.startsWith('aether:')).map((m) => [m.name.slice(7), Math.round(m.startTime)] as [string, number]); });
  const tl = await sample();
  const all = [...reqs.values()].filter((r) => r.end > 0);
  const navOffset = (await page.evaluate(() => performance.timeOrigin)) ;
  void navOffset;
  console.log(`\n### ${LABEL}: open ${EXAMPLE}, ${warm ? 'warm cache' : 'cold'} (Slow 4G, ${CPU}x CPU); first frame at ${Math.round(firstWall)} ms wall`);
  console.log('\n| request class | count | transferred | first start | last end |\n|---|---|---|---|---|');
  for (const cls of [...new Set(all.map((r) => r.cls))]) {
    const rs = all.filter((r) => r.cls === cls);
    console.log(`| ${cls} | ${rs.length} | ${Math.round(rs.reduce((a, r) => a + r.bytes, 0) / 1024)} kB | ${Math.round(Math.min(...rs.map((r) => r.start)))} ms | ${Math.round(Math.max(...rs.map((r) => r.end)))} ms |`);
  }
  const heavy = (c: string): number => Math.max(0, ...all.filter((r) => r.cls === c).map((r) => r.end));
  const lastAsset = Math.max(heavy('texture'), heavy('model'), heavy('lightmap'));
  const lastEditorJs = Math.max(0, ...all.filter((r) => r.cls === 'js').map((r) => r.end));
  const m = tl.marks;
  console.log('\n| milestone | ms after navigation |\n|---|---|');
  const row = (k: string, v: number | undefined): void => void console.log(`| ${k} | ${v === undefined ? 'n/a' : Math.round(v)} |`);
  row('poster (thumbnail response)', Math.min(Infinity, ...all.filter((r) => r.cls === 'poster').map((r) => r.end)) || undefined);
  row('skeleton painted', m['skeleton']);
  row('last JS chunk arrived', lastEditorJs);
  row('editor mounted', m['editor']);
  row('world JSON arrived', heavy('world json') || undefined);
  row('world in the store', m['world']);
  row('renderer created', m['renderer']);
  row('first frame drawn', m['drawn']);
  row('first frame, overlay gone (first visible frame)', m['first']);
  row('baked light applied (lit frame)', m['lit']);
  row('last texture / model / lightmap response (full quality)', lastAsset || undefined);
  if (LIST) for (const r of [...all].sort((a, b) => a.start - b.start)) console.log(`req ${Math.round(r.start)}-${Math.round(r.end)} ${r.cls} ${Math.round(r.bytes / 1024)}kB ${r.url.replace(/^https?:\/\/[^/]+/, '')}`);
  console.log('engine marks: ' + tl.perf.map(([k, v]) => `${k}@${v}`).join(' '));
  console.log('\nloading text: ' + tl.loading.map(([t, s]) => `${Math.round(t)}:${s ?? 'done'}`).join(' > '));
  console.log('lightmap: ' + (tl.lm.map(([t, s]) => `${Math.round(t)}:${s || '-'}`).join(' > ') || 'none'));
  await context.close();
}

async function main(): Promise<void> {
  const { url, server } = await serveDist(DIST);
  const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
  try {
    await scenario(browser, url, false);
    if (WARM) await scenario(browser, url, true);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
