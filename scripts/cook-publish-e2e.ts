/**
 * End-to-end check of publishing a cooked world from the editor (docs/ARCHITECTURE-STREAMING.md, "Publishing from the
 * editor") against the real dataset, on this machine:
 *
 * 1. Serves a built studio on 127.0.0.1 with the deployment's own headers (vercel.json: the studio's and the player's
 *    policies) and the upload function (api/_lib/cook-upload.ts) on `/api/cook-upload`, writing under `users/_test/`
 *    with the local write token (never printed).
 * 2. In headless Chrome, opens a template in the editor, adds a world too large for a link (padding generators) with a
 *    generated part over 4 MB (a custom generator's rubble field), and publishes it from the Publish hub's state object
 *    (`studio.publish.publishCooked()`).
 * 3. Opens the short link (`/play#c=<anon>.<world>&m=<mode>`) on a fresh profile under the player's policy, the dataset's
 *    `users/<anon>/` read from `users/_test/<anon>/` (a request rewrite: the test's folder), and checks the world loaded
 *    cooked with no policy violations.
 *
 *   STATIC_DIR=<dist> GEN_GPU=intel npx tsx scripts/cook-publish-e2e.ts [--template=asteroid-field] [--pad=0] [--strip-colliders] [--start=play] [--shots=<dir>]
 *
 * - `--pad=0`: publish the template as it is (no padding generators, no rubble field): a building's publish with its baked light.
 * - The editor's main thread is watched through the publish (long tasks, `PerformanceObserver`); the ones while the light bakes
 *   are reported (the bake must stay off the main thread: none over 100 ms).
 * - `--strip-colliders`: every entity's physics is taken away before the publish (a world imported without colliders): the
 *   playability check must make it playable (its static meshes made solid in the published copy) or block the publish.
 *   `--start=<mode>` sets the world's start mode first.
 * - The player checks the package's baked light (the lightmap applied from the package) and, for `--strip-colliders` or
 *   `--start=play`, that the player stands on ground after three seconds of play. `--shots=<dir>`: pictures of fixed views in
 *   the published package and in the template's own cooked package (the Node cook's, from the dataset), and their difference.
 *
 * Then take it down: `npx tsx scripts/cook-takedown.ts users/_test/<anon>` (the id is printed). Run it in a capped scope.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { homedir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { handleCookUpload, RateLimiter } from '../api/_lib/cook-upload';
import { hubToken } from './lib/cook-upload';
import * as env from '../tests/e2e/support/env';

const args = process.argv.slice(2);
const flag = (k: string): string | undefined => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const DIST = resolve(process.env['STATIC_DIR'] ?? env.STUDIO_DIST);
const TEMPLATE = flag('template') ?? 'asteroid-field';
const PAD = flag('pad') !== '0';
const STRIP = args.includes('--strip-colliders');
const START = flag('start');
const SHOTS = flag('shots') ? resolve(flag('shots')!) : null;
/** `--expect-light`: the publish must ship baked light. `--ref=local`: the reference views from the locally installed cook (`cook=local`). */
const EXPECT_LIGHT = args.includes('--expect-light');
const REF_LOCAL = flag('ref') === 'local';
/** `--tier=<t>`: the players' tier (a fixed tier keeps the performance ladder from cutting the light volume on a slow headless GPU). */
const TIER = flag('tier');
/** `--budget=<n>`: the editor's worker budget (`__AETHER_WORKER_BUDGET`; default the page's, the cores but two). */
const BUDGET = flag('budget');
const ROOT = 'users/_test';
const REPO_BASE = 'https://huggingface.co/datasets/StarAtNyte1/aether-cooked/resolve/main/';
const T0 = Date.now();
const log = (s: string): void => void process.stdout.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${s}\n`);

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ktx2': 'image/ktx2', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.bin': 'application/octet-stream' };

/** The deployment's header rules (vercel.json), as anchored regular expressions (the `:param` rules are skipped). */
function headerRules(): Array<{ re: RegExp; headers: Array<{ key: string; value: string }> }> {
  const v = JSON.parse(readFileSync(join(env.REPO_ROOT, 'vercel.json'), 'utf8')) as { headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }> };
  return v.headers.filter((h) => !h.source.includes(':')).map((h) => ({ re: new RegExp(`^${h.source}$`), headers: h.headers }));
}

async function serve(token: string): Promise<{ url: string; close(): Promise<void> }> {
  const rules = headerRules();
  const limiter = new RateLimiter();
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const path = decodeURIComponent((req.url ?? '/').split('?')[0]!);
      if (path === '/api/cook-upload') {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
        headers.set('x-forwarded-for', '127.0.0.1');
        const r = await handleCookUpload(new Request(`http://127.0.0.1${req.url}`, { method: req.method ?? 'GET', headers, ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}) }), { token, limiter, root: ROOT });
        res.writeHead(r.status, Object.fromEntries(r.headers));
        res.end(Buffer.from(await r.arrayBuffer()));
        return;
      }
      for (const rule of rules) if (rule.re.test(path)) for (const h of rule.headers) res.setHeader(h.key, h.value);
      const rel = path === '/' ? 'index.html' : path === '/play' ? 'play.html' : path.slice(1);
      const file = resolve(DIST, rel);
      if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
        return;
      }
      res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream');
      res.writeHead(200);
      res.end(readFileSync(file));
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

/** Generators that pad the world past a link's 1.5 MB (random text compresses poorly), and the rubble field (over 4 MB). */
function additions(): { generators: Record<string, unknown>; entity: Record<string, unknown> } {
  const generators: Record<string, unknown> = {};
  for (let i = 0; i < 40; i++) {
    const id = `e2e-pad-${String(i).padStart(2, '0')}`;
    generators[id] = { id, description: 'padding', params: {}, source: `/* ${randomBytes(43_000).toString('base64')} */\nreturn api.build();` };
  }
  generators['e2e-rubble'] = {
    id: 'e2e-rubble',
    description: 'A field of tumbled stones (large output)',
    params: {},
    source: `const mat = { preset: 'stone', color: '#8a8580', roughness: 0.9 };
for (let i = 0; i < 14000; i++) {
  const s = 0.1 + api.rng() * 0.4;
  api.add(api.box(s, s * (0.5 + api.rng()), s).rotate(api.rng() * 360, api.rng() * 360, api.rng() * 360).translate(api.rng() * 80 - 40, api.rng() * 6, api.rng() * 80 - 40), mat);
}
return api.build();`,
  };
  const entity = { id: 'e2e-rubble', name: 'Rubble', transform: { position: [0, 0, 0] }, shape: { kind: 'procedural', generator: 'e2e-rubble', params: {}, seed: 1 } };
  return { generators, entity };
}

type Win = {
  __aether?: { history: { current: Record<string, unknown> }; simulation: { whenSynced(): Promise<void> } | null; store: { getState(): { loading: unknown; agentBusy: boolean } }; studio: { importText(t: string): Promise<string | null>; publish: { publishCooked(): Promise<void>; state: { getState(): { cooked: { status: string; label: string | null; ref: string | null; startMode: string } } } } } };
  __aetherCook?: { path: string; reason: string | null; ready: boolean };
  __aetherGenStats?: { hits: number; cooked: number; generated: number };
  __csp?: string[];
};

/** Fixed views of the building (a three-quarter view from outside, then the first tour stops), settled, at noon and at 18:30. */
const VIEWS: Array<{ name: string; position: [number, number, number]; target: [number, number, number] }> = [];
async function shots(page: import('playwright').Page, tag: string): Promise<void> {
  mkdirSync(SHOTS!, { recursive: true });
  const R = '(window.__aetherPlayer.simulation.renderer)';
  if (VIEWS.length === 0) {
    const vs = (await page.evaluate(`(() => { const s = ${R}.contentSphere; const v = ${R}.viewStops ? ${R}.viewStops() : []; return { s, v }; })()`)) as { s: { center: number[]; radius: number } | null; v: Array<{ position: number[]; target: number[] }> };
    const c = vs.s?.center ?? [0, 0, 0];
    const r = vs.s?.radius ?? 10;
    VIEWS.push({ name: 'outside', position: [c[0]! + r * 0.9, c[1]! + r * 0.55, c[2]! + r * 0.9], target: [c[0]!, c[1]!, c[2]!] });
    for (const [i, v] of vs.v.slice(0, 3).entries()) VIEWS.push({ name: `stop${i}`, position: v.position as [number, number, number], target: v.target as [number, number, number] });
  }
  for (const hour of [12, 18.5]) {
    await page.evaluate(`${R}.setEnvironmentOverride({ ...window.__aetherPlayer.simulation.syncedWorld.environment, timeOfDay: ${hour} })`).catch((e: unknown) => log(`no hour override: ${String(e).slice(0, 120)}`));
    for (const v of VIEWS) {
      await page.evaluate(`${R}.stopTour()`);
      const [px, py, pz] = v.position;
      const [tx, ty, tz] = v.target;
      await page.evaluate(`${R}.setCameraPose(${px}, ${py}, ${pz}, ${Math.atan2(px - tx, pz - tz)}, ${-Math.atan2(py - ty, Math.hypot(px - tx, pz - tz))})`);
      await page.waitForTimeout(2500);
      await page.locator('canvas').first().screenshot({ path: join(SHOTS!, `${v.name}-${hour}-${tag}.png`) });
    }
  }
  log(`${tag}: ${VIEWS.length * 2} shots in ${SHOTS}`);
}

/** Mean absolute difference per pixel of each pair of shots, decoded in the browser page `page`. */
async function compareShots(page: import('playwright').Page): Promise<void> {
  for (const v of VIEWS) {
    for (const hour of [12, 18.5]) {
      const a = readFileSync(join(SHOTS!, `${v.name}-${hour}-published.png`)).toString('base64');
      const b = readFileSync(join(SHOTS!, `${v.name}-${hour}-node-cook.png`)).toString('base64');
      // A string (a function would carry the transpiler's helpers, which the page does not have).
      const r = (await page.evaluate(`(async () => {
        const read = async (s) => { const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + s)).blob()); const c = new OffscreenCanvas(bmp.width, bmp.height); const g = c.getContext('2d'); g.drawImage(bmp, 0, 0); return g.getImageData(0, 0, bmp.width, bmp.height); };
        const x = await read('${a}'); const y = await read('${b}');
        if (x.width !== y.width || x.height !== y.height) return null;
        let d = 0, la = 0, lb = 0;
        for (let i = 0; i < x.data.length; i += 4) { for (let k = 0; k < 3; k++) d += Math.abs(x.data[i + k] - y.data[i + k]); la += x.data[i] + x.data[i + 1] + x.data[i + 2]; lb += y.data[i] + y.data[i + 1] + y.data[i + 2]; }
        const px = (x.data.length / 4) * 3;
        return { diff: d / px, a: la / px, b: lb / px };
      })()`)) as { diff: number; a: number; b: number } | null;
      if (r) log(`compare ${v.name} ${hour}: mean abs diff ${r.diff.toFixed(2)} / 255, mean brightness ${r.a.toFixed(1)} (published) vs ${r.b.toFixed(1)} (node cook)`);
    }
  }
}

async function main(): Promise<void> {
  if (!existsSync(join(DIST, 'index.html'))) throw new Error(`no studio build in ${DIST} (STATIC_DIR)`);
  const token = hubToken();
  const site = await serve(token);
  log(`serving ${DIST} on ${site.url}, uploads under ${ROOT}/`);
  mkdirSync(join(homedir(), '.cache/aether-e2e-tmp'), { recursive: true });
  const profiles: string[] = [];
  const profile = (): string => {
    const p = mkdtempSync(join(homedir(), '.cache/aether-e2e-tmp/publish-'));
    profiles.push(p);
    return p;
  };
  try {
    // --- Publish from the editor --------------------------------------------------------------------------------------
    const ed = await chromium.launchPersistentContext(profile(), { executablePath: env.findChrome(), args: [...env.CHROME_ARGS], headless: env.HEADLESS, viewport: { width: 1440, height: 900 } });
    let ref: string;
    let startMode: string;
    try {
      await ed.addInitScript({ content: env.SKIP_FIRST_RUN });
      if (BUDGET) await ed.addInitScript({ content: `globalThis.__AETHER_WORKER_BUDGET = ${Number(BUDGET)};` });
      // Long tasks of the editor's main thread, with the publish's labels over time (to find the bake's window).
      await ed.addInitScript({ content: "window.__long = []; window.__labels = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch {}" });
      const page = ed.pages()[0] ?? (await ed.newPage());
      page.on('pageerror', (e) => log(`editor pageerror ${e.message.slice(0, 160)}`));
      await page.goto(`${site.url}/?debug=1#/new/${TEMPLATE}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => {
        const a = (window as unknown as Win).__aether;
        const st = a?.store.getState();
        return !!a && a.simulation !== null && st?.loading === null && !st.agentBusy;
      }, null, { timeout: 180_000, polling: 250 });
      await page.evaluate(async () => (window as unknown as Win).__aether!.simulation!.whenSynced());
      log(`editor: ${TEMPLATE} open`);
      const add = PAD ? additions() : null;
      const err = await page.evaluate(async ([a, strip, start]) => {
        const w = (window as unknown as Win).__aether!;
        const cur = JSON.parse(JSON.stringify(w.history.current)) as { generators?: Record<string, unknown>; entities: Record<string, Record<string, unknown>>; startMode?: string };
        if (!a && !strip && !start) return null;
        if (a) {
          cur.generators = { ...(cur.generators ?? {}), ...a.generators };
          cur.entities[a.entity['id'] as string] = a.entity;
        }
        if (strip) for (const e of Object.values(cur.entities)) delete e['physics'];
        if (start) cur.startMode = start;
        const e = await w.studio.importText(JSON.stringify(cur));
        if (e) return e;
        await w.simulation!.whenSynced();
        return null;
      }, [add, STRIP, START ?? null] as const);
      if (err) throw new Error(`the world did not load: ${err}`);
      if (TIER) {
        // A fixed tier in the editor too (no performance ladder on a slow headless GPU): its light volume bakes as on a
        // computer that draws the building in time, before the publish.
        await page.evaluate(`window.__aether.simulation.renderer.setRenderTier('${TIER}')`);
        const ready = await page.waitForFunction(() => { const r = (window as unknown as { __aether: { simulation: { renderer: { hasBuildings: boolean; lightVolumeReady: boolean; lightVolumeBaking: boolean } } } }).__aether.simulation.renderer; return !r.hasBuildings || (r.lightVolumeReady && !r.lightVolumeBaking); }, null, { timeout: 300_000, polling: 1000 }).then(() => true, () => false);
        log(`editor: tier ${TIER}, light volume ${ready ? 'ready' : 'not ready'}`);
      }
      if (STRIP) {
        // Give the models time to load (their triangles are the colliders the check derives).
        await page.waitForTimeout(8000);
        log(`editor: colliders stripped from every entity${START ? `, start mode ${START}` : ''}`);
      }
      const worldJson = await page.evaluate(() => JSON.stringify((window as unknown as Win).__aether!.history.current));
      const { encodeShare, MAX_FRAGMENT_CHARS } = await import('../apps/studio/src/publish/share');
      const enc = await encodeShare(JSON.parse(worldJson));
      log(`editor: world ${(worldJson.length / 1e6).toFixed(2)} MB of JSON, its link ${(enc.chars / 1e6).toFixed(2)} MB (a link holds ${(MAX_FRAGMENT_CHARS / 1e6).toFixed(1)} MB): ${enc.fits ? 'fits a link' : 'too large for a link'}`);
      const t1 = Date.now();
      await page.evaluate(() => {
        const st = (window as unknown as Win).__aether!.studio.publish.state as unknown as { subscribe(f: (s: { cooked: { label: string | null } }) => void): void };
        st.subscribe((s) => void (window as unknown as { __labels: Array<[number, string]> }).__labels.push([performance.now(), s.cooked.label ?? '']));
        void (window as unknown as Win).__aether!.studio.publish.publishCooked();
      });
      let last = '';
      const done = await page.waitForFunction(
        (prev) => {
          const c = (window as unknown as Win).__aether!.studio.publish.state.getState().cooked;
          if (c.status === 'done' || c.status === 'failed') return c;
          (window as unknown as { __lastLabel?: string }).__lastLabel = c.label ?? prev;
          return false;
        },
        last,
        { timeout: 900_000, polling: 500 },
      );
      const c = (await done.jsonValue()) as { status: string; label: string | null; ref: string | null; startMode: string };
      last = c.label ?? '';
      log(`editor: ${c.status} in ${((Date.now() - t1) / 1000).toFixed(1)} s: ${last}`);
      const warnings = (await page.evaluate(() => (window as unknown as Win).__aether!.studio.publish.state.getState().cooked as { warnings?: string[] })).warnings ?? [];
      for (const w of warnings) log(`editor: check: ${w}`);
      // The main thread while the light baked (from the first "Baking light" label to "Light baked").
      const main = await page.evaluate(() => {
        const g = window as unknown as { __long: Array<[number, number]>; __labels: Array<[number, string]> };
        const from = g.__labels.find(([, l]) => /^Baking light|^Waiting for the light volume/.test(l))?.[0] ?? null;
        const to = g.__labels.find(([, l]) => /^Light baked|^No baked light/.test(l))?.[0] ?? null;
        const all = g.__long;
        const during = from !== null ? all.filter(([t]) => t >= from && t <= (to ?? Infinity)) : [];
        return { from, to, all: all.length, worstAll: Math.max(0, ...all.map(([, d]) => d)), during: during.length, worst: Math.max(0, ...during.map(([, d]) => d)), over100: during.filter(([, d]) => d > 100).map(([t, d]) => [Math.round(t), Math.round(d)]) };
      });
      if (main.from !== null) log(`editor: light bake ${main.to !== null ? ((main.to - main.from) / 1000).toFixed(1) : '?'} s on the page; long tasks during it ${main.during} (worst ${main.worst.toFixed(0)} ms, over 100 ms: ${JSON.stringify(main.over100)}); whole publish ${main.all} (worst ${main.worstAll.toFixed(0)} ms)`);
      if (main.over100.length > 0) log('editor: FAIL: a main-thread task over 100 ms during the bake');
      log(`editor: light volume ${JSON.stringify(await page.evaluate(() => { const r = (window as unknown as { __aether: { simulation: { renderer: { lightVolumeReady: boolean; lightVolumeBaking: boolean; lightVolumeStats: unknown; hasBuildings: boolean } } } }).__aether.simulation.renderer; return { buildings: r.hasBuildings, ready: r.lightVolumeReady, baking: r.lightVolumeBaking, stats: r.lightVolumeStats }; })).slice(0, 300)}`);
      if (c.status !== 'done' || !c.ref) {
        if (STRIP && /Not published: this world opens in play/.test(last)) {
          log('the publish was blocked with a clear message (no ground under the spawn): ok');
          return;
        }
        throw new Error(`publish failed: ${last}`);
      }
      ref = c.ref;
      startMode = c.startMode;
    } finally {
      await ed.close().catch(() => undefined);
    }
    const [anon, world] = ref.split('.') as [string, string];
    log(`published: ref ${ref} (take down: npx tsx scripts/cook-takedown.ts ${ROOT}/${anon})`);

    // --- What is on the dataset ---------------------------------------------------------------------------------------
    const tree = (await (await fetch(`https://huggingface.co/api/datasets/StarAtNyte1/aether-cooked/tree/main/${ROOT}/${anon}/${world}?recursive=true`)).json()) as Array<{ type: string; path: string; size: number; lfs?: { size: number } }>;
    const files = tree.filter((f) => f.type === 'file').map((f) => ({ path: f.path.slice(`${ROOT}/${anon}/${world}/`.length), size: f.lfs?.size ?? f.size }));
    const total = files.reduce((n, f) => n + f.size, 0);
    const largest = files.reduce((a, f) => (f.size > a.size ? f : a), { path: '', size: 0 });
    log(`dataset: ${files.length} files, ${(total / 1e6).toFixed(2)} MB; world file ${((files.find((f) => f.path.endsWith('world.json.gz'))?.size ?? 0) / 1e6).toFixed(2)} MB; largest ${largest.path} ${(largest.size / 1e6).toFixed(2)} MB`);

    // --- Open the short link under the player's policy ----------------------------------------------------------------
    const pl = await chromium.launchPersistentContext(profile(), { executablePath: env.findChrome(), args: [...env.CHROME_ARGS], headless: env.HEADLESS, viewport: { width: 1280, height: 720 } });
    try {
      await pl.addInitScript({ content: "window.__csp = []; addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));" });
      // The test's folder: the dataset's users/<anon>/ is read from users/_test/<anon>/.
      await pl.route(`${REPO_BASE}users/${anon}/**`, (route) => route.continue({ url: route.request().url().replace(`/resolve/main/users/${anon}/`, `/resolve/main/${ROOT}/${anon}/`) }));
      const page = pl.pages()[0] ?? (await pl.newPage());
      const consoleCsp: string[] = [];
      page.on('console', (m) => {
        if (/Content Security Policy/i.test(m.text())) consoleCsp.push(m.text().slice(0, 200));
      });
      page.on('pageerror', (e) => log(`player pageerror ${e.message.slice(0, 160)}`));
      // Shots compare with the template's walkthrough: the same entry (a game opens on its title card and a moving tour).
      const link = `${site.url}/play#c=${ref}&m=${SHOTS && !STRIP && START !== 'play' ? 'walkthrough' : startMode}${TIER ? `&tier=${TIER}` : ''}`;
      log(`player: ${link.replace(site.url, '')}`);
      const t2 = Date.now();
      await page.goto(link, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => (window as unknown as Win).__aetherCook?.ready === true, null, { timeout: 300_000, polling: 250 });
      const out = await page.evaluate(() => {
        const w = window as unknown as Win;
        return { cook: w.__aetherCook!, gen: w.__aetherGenStats ?? null, csp: w.__csp ?? [] };
      });
      log(`player: first picture in ${((Date.now() - t2) / 1000).toFixed(1)} s, path ${out.cook.path}${out.cook.reason ? ` (${out.cook.reason})` : ''}; geometry jobs: ${out.gen ? `${out.gen.cooked} from the package, ${out.gen.hits} cache hits, ${out.gen.generated} generated` : 'n/a'}`);
      const violations = [...out.csp, ...consoleCsp];
      log(`player: ${violations.length} policy violations${violations.length ? `: ${violations.slice(0, 5).join(' | ')}` : ''}`);
      if (out.cook.path !== 'cooked') throw new Error(`the short link did not load cooked: ${out.cook.reason}`);
      if (violations.length > 0) throw new Error('policy violations');
      const light = files.some((f) => f.path.includes('/light/'));
      log(`dataset: baked light ${light ? files.filter((f) => f.path.includes('/light/')).map((f) => `${f.path.split('/').pop()} ${(f.size / 1e6).toFixed(2)} MB`).join(', ') : 'none'}`);
      if (EXPECT_LIGHT && !light) throw new Error('the package has no baked light');
      if (light) {
        const R = '(window.__aetherPlayer.simulation.renderer)';
        // The short link's player follows the GPU budget: a fixed tier keeps a slow headless GPU's ladder from cutting the volume.
        if (TIER) await page.evaluate(`${R}.setRenderTier('${TIER}')`);
        const ok = await page.waitForFunction(() => (window as unknown as { __aetherPlayer?: { simulation?: { renderer: { lightmapStatus: { state: string } } } } }).__aetherPlayer?.simulation?.renderer.lightmapStatus.state === 'applied', null, { timeout: 180_000, polling: 500 }).then(() => true, () => false);
        const st = await page.evaluate(`({ status: ${R}.lightmapStatus, stats: ${R}.lightmapStats, bakes: ${R}.lightmapBakesStarted, key: ${R}.lightmapKeyInputs })`);
        log(`player: baked light ${ok ? 'applied' : 'NOT applied'}: ${JSON.stringify(st).slice(0, 500)}`);
        if (!ok) {
          log(`player: light volume ${JSON.stringify(await page.evaluate(`(() => { const r = ${R}; const v = r.lightVolume; return { ready: r.lightVolumeReady, baking: r.lightVolumeBaking, stats: r.lightVolumeStats, enabled: v.enabled, pending: v.pending, job: v.job, staticBase: v.staticBase, cuts: r.cuts, lowMemory: r.lowMemory, arch: r.archView.active, mode: window.__aetherPlayer.simulation.mode }; })()`)).slice(0, 900)}`);
          throw new Error('the package has baked light and the player did not apply it');
        }
        if (SHOTS) await shots(page, 'published');
      }
      if (STRIP || START === 'play') {
        // Play: the player must stand on ground after three seconds.
        const fell = await page.evaluate(async () => {
          const sim = (window as unknown as { __aetherPlayer: { simulation: { mode: string; play(): Promise<void>; playerPosition: number[] | null } } }).__aetherPlayer.simulation;
          if (sim.mode !== 'play') await sim.play();
          await new Promise((r) => setTimeout(r, 500));
          const a = sim.playerPosition ? [...sim.playerPosition] : null;
          await new Promise((r) => setTimeout(r, 3000));
          const b = sim.playerPosition ? [...sim.playerPosition] : null;
          return { mode: sim.mode, a, b };
        });
        log(`player: play ${JSON.stringify(fell)}`);
        if (!fell.b || !fell.a || fell.b[1]! < fell.a[1]! - 2) throw new Error('the player fell in the published world');
      }
    } finally {
      await pl.close().catch(() => undefined);
    }
    if (SHOTS) {
      // The template's own cooked package (the Node cook's, from the dataset), the same views.
      const ref = await chromium.launchPersistentContext(profile(), { executablePath: env.findChrome(), args: [...env.CHROME_ARGS], headless: env.HEADLESS, viewport: { width: 1280, height: 720 } });
      try {
        const page = ref.pages()[0] ?? (await ref.newPage());
        await page.goto(`${site.url}/play#t=${TEMPLATE}${REF_LOCAL ? '&cook=local' : ''}${TIER ? `&tier=${TIER}` : ''}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => (window as unknown as Win).__aetherCook?.ready === true, null, { timeout: 300_000, polling: 250 });
        const R = '(window.__aetherPlayer.simulation.renderer)';
        const cook = await page.evaluate(() => (window as unknown as Win).__aetherCook!);
        const ok = await page.waitForFunction(() => (window as unknown as { __aetherPlayer?: { simulation?: { renderer: { lightmapStatus: { state: string } } } } }).__aetherPlayer?.simulation?.renderer.lightmapStatus.state === 'applied', null, { timeout: 180_000, polling: 500 }).then(() => true, () => false);
        log(`node cook: path ${cook.path}${cook.reason ? ` (${cook.reason})` : ''}, baked light ${ok ? 'applied' : 'not applied'}: ${JSON.stringify(await page.evaluate(`${R}.lightmapStats`)).slice(0, 300)}`);
        await shots(page, 'node-cook');
        await compareShots(page);
      } finally {
        await ref.close().catch(() => undefined);
      }
    }
    log('ok');
  } finally {
    for (const p of profiles) rmSync(p, { recursive: true, force: true });
    await site.close();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
