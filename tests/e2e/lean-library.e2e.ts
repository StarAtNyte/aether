/**
 * Lean library build in Chromium: the studio served from a lean `dist` (set `STATIC_DIR`, built with
 * `AETHER_LIB_CDN=<url>`), a stand-in CDN serving `assets/lib`, and three worlds:
 *   - a showcase world (apartment): every model comes from the shipped subset, nothing from the CDN;
 *   - the same world's forest-camp plus a model the build does not ship (beaver): the model comes from the CDN;
 *   - the CDN down: the world still opens and the studio reports no crash (the model is missing, not the app).
 *
 *   AETHER_LIB_CDN=http://127.0.0.1:8099/lib/ AETHER_OUTDIR=... npm run build -w @aether/studio
 *   STATIC_DIR=... CDN_URL=http://127.0.0.1:8099/lib/ npx tsx tests/e2e/lean-library.e2e.ts
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize } from 'node:path';
import { chromium, type Page } from 'playwright';
import { CHROME_ARGS, REPO_ROOT, SKIP_FIRST_RUN, findChrome } from './support/env';

const DIST = process.env['STATIC_DIR'] ?? '';
const CDN = process.env['CDN_URL'] ?? 'http://127.0.0.1:8099/lib/';
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
function check(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}
const log = (l: string): void => void process.stdout.write(`${l}\n`);

async function host(): Promise<{ url: string; close(): void }> {
  const s = createServer((req, res) => {
    const p = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
    let f = normalize(join(DIST, p));
    if (!f.startsWith(DIST)) return void res.writeHead(400).end();
    if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
    if (!existsSync(f)) return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' }).end(readFileSync(f));
  });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, close: () => void s.close() };
}

async function open(page: Page, url: string, slug: string, wait = Number(process.env['WAIT_MS'] ?? 25_000)): Promise<{ local: string[]; cdn: string[]; failed: string[]; errors: string[] }> {
  const local: string[] = [];
  const cdn: string[] = [];
  const failed: string[] = [];
  const errors: string[] = [];
  page.on('requestfailed', (r) => { failed.push(r.url()); if (process.env['DEBUG_REQ']) log('FAILED ' + r.url()); });
  if (process.env['DEBUG_REQ']) page.on('request', (r) => { if (/worlds|beaver|lib\//.test(r.url())) log('REQ ' + r.url()); });
  if (process.env['DEBUG_REQ']) page.on('console', (m) => { if (/beaver|reject|asset|model/i.test(m.text())) log('CONSOLE ' + m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${url}/#/new/${slug}`);
  await page.waitForTimeout(wait);
  const seen = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /\.(glb|hdr)$/.test(n)));
  if (process.env['DEBUG_REQ']) log('PERF ' + JSON.stringify(seen.filter((n) => !n.includes('/c/'))));
  for (const n of seen) {
    if (n.startsWith(CDN)) cdn.push(n.slice(CDN.length));
    else if (n.startsWith(`${url}/assets/lib/`)) local.push(n.slice(url.length));
  }
  return { local: [...new Set(local)], cdn: [...new Set(cdn)], failed, errors };
}

async function main(): Promise<void> {
  check(DIST && existsSync(join(DIST, 'assets/lib/remote.json')), 'set STATIC_DIR to a lean build (assets/lib/remote.json)');
  const h = await host();
  const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS], headless: true });
  try {
    // 1. A showcase world: no CDN traffic for models.
    {
      const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
      await page.addInitScript(SKIP_FIRST_RUN);
      const r = await open(page, h.url, 'apartment');
      log(`apartment: ${r.local.length} local model/sky files, ${r.cdn.length} from the CDN, ${r.errors.length} page errors`);
      check(r.local.length > 0, 'apartment loaded no local library models');
      check(r.cdn.length === 0, `apartment fetched from the CDN: ${r.cdn.join(', ')}`);
      check(r.errors.length === 0, `page errors: ${r.errors.join(' | ')}`);
      await page.screenshot({ path: join(process.env['SHOT_DIR'] ?? '/tmp', 'lean-apartment.png') });
    }
    // 2. A world naming a model the build does not ship: it comes from the CDN.
    // The village with every sheep swapped for a model the build does not ship.
    const world = JSON.parse(readFileSync(join(REPO_ROOT, 'apps/studio/public/templates/worlds/medieval-village.json'), 'utf8')) as { world: { entities: Record<string, { shape: { kind: string; id?: string }; arch?: unknown }> } };
    const shipped = new Set((JSON.parse(readFileSync(join(DIST, 'assets/lib/remote.json'), 'utf8')) as { shipped: string[] }).shipped);
    const catalog = JSON.parse(readFileSync(join(REPO_ROOT, 'assets/catalog.json'), 'utf8')) as { entries: Array<{ id: string; kind: string; file?: string; lods: unknown[] }> };
    const remoteOnly = catalog.entries.find((e) => e.kind === 'model' && e.file && e.lods.length === 0 && ![...shipped].some((p) => /^[mki]\//.test(p) && p.includes(`/${e.id}.`)));
    check(remoteOnly, 'every model is shipped');
    log(`remote-only model: ${remoteOnly.id}`);
    let swapped = 0;
    for (const e of Object.values(world.world.entities)) if (e.shape.kind === 'asset' && /^sheep/.test(e.shape.id ?? '')) ((e.shape.id = remoteOnly.id), delete e.arch, swapped++);
    check(swapped > 0, 'no sheep in the village to swap');
    for (const down of [false, true]) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      await page.addInitScript(SKIP_FIRST_RUN);
      await page.route('**/templates/worlds/medieval-village.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(world) }));
      if (down) await page.route(`${CDN}**`, (route) => route.abort());
      const r = await open(page, h.url, 'medieval-village');
      await page.screenshot({ path: join(process.env['SHOT_DIR'] ?? '/tmp', `lean-village-${down ? 'down' : 'up'}.png`) });
      log(`village + remote-only model (CDN ${down ? 'down' : 'up'}): CDN ${JSON.stringify(r.cdn)}, failed ${r.failed.length}, page errors ${r.errors.length}`);
      check(r.cdn.some((p) => p.includes(`/${remoteOnly.id}.`)), `${remoteOnly.id} was not requested from the CDN`);
      check(r.errors.length === 0, `page errors: ${r.errors.join(' | ')}`);
      if (!down) check(r.failed.filter((u) => !u.includes('/api/')).length === 0, `failed requests: ${r.failed.join(', ')}`);
      await ctx.close();
    }
    log('lean library e2e: ok');
  } finally {
    await browser.close();
    h.close();
  }
}

main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
