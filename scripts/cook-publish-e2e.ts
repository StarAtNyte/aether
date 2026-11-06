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
 *   STATIC_DIR=<dist> GEN_GPU=intel npx tsx scripts/cook-publish-e2e.ts [--template=asteroid-field]
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
      const add = additions();
      const err = await page.evaluate(async (a) => {
        const w = (window as unknown as Win).__aether!;
        const cur = JSON.parse(JSON.stringify(w.history.current)) as { generators?: Record<string, unknown>; entities: Record<string, unknown> };
        cur.generators = { ...(cur.generators ?? {}), ...a.generators };
        cur.entities[a.entity.id as string] = a.entity;
        const e = await w.studio.importText(JSON.stringify(cur));
        if (e) return e;
        await w.simulation!.whenSynced();
        return null;
      }, add);
      if (err) throw new Error(`the world did not load: ${err}`);
      const worldJson = await page.evaluate(() => JSON.stringify((window as unknown as Win).__aether!.history.current));
      const { encodeShare, MAX_FRAGMENT_CHARS } = await import('../apps/studio/src/publish/share');
      const enc = await encodeShare(JSON.parse(worldJson));
      log(`editor: world ${(worldJson.length / 1e6).toFixed(2)} MB of JSON, its link ${(enc.chars / 1e6).toFixed(2)} MB (a link holds ${(MAX_FRAGMENT_CHARS / 1e6).toFixed(1)} MB): ${enc.fits ? 'fits a link' : 'too large for a link'}`);
      const t1 = Date.now();
      await page.evaluate(() => void (window as unknown as Win).__aether!.studio.publish.publishCooked());
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
      if (c.status !== 'done' || !c.ref) throw new Error(`publish failed: ${last}`);
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
      const link = `${site.url}/play#c=${ref}&m=${startMode}`;
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
    } finally {
      await pl.close().catch(() => undefined);
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
