/**
 * Replay proofs end to end, in Chromium then Firefox, against the built
 * studio served in mock mode:
 *
 *  1. Node seals a bundled game; its share link opens in the browser, whose
 *     own re-simulation reproduces the Node outcome ("Verified playable").
 *     That is the cross-platform determinism check: Node -> Chromium and
 *     Node -> Firefox must agree on outcome, simulated time and motion
 *     fingerprint (mm-quantised), or the badge would not turn green;
 *  2. forged links fail clearly: an edited claim (tampered), a forged claim
 *     re-hashed (replay diverged), a world edited after sealing and a proof
 *     of another engine version (out of date);
 *  3. the studio seals what it publishes: the share link and the game zip
 *     carry a proof, the extracted build shows the badge and re-checks it,
 *     and Node verifies the proof the BROWSER sealed (browser -> Node), also
 *     through the `aether-verify` CLI (exit status, tampering);
 *  4. the wording never claims more than a replay check;
 *  5. an engine matrix that needs no WebGL: the verifier bundled for the
 *     browser re-seals pinned worlds inside the page, and the proofs must be
 *     byte-identical to Node's (same hashes, same outcome, same motion
 *     fingerprint) in every engine.
 *
 * Without WebGL (a headless Firefox on a machine with no software GL) the
 * player/studio flows cannot start; set AETHER_E2E_SKIP_NO_GL=1 to run only
 * the engine matrix there. CI has WebGL and runs everything.
 *
 * Run: `npm run build && npm run e2e:proof` (`-- --chromium` / `-- --firefox`).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { build } from 'esbuild';
import { chromium, firefox, type Browser, type Page } from 'playwright';
import { validateWorld, type WorldDoc } from '../../packages/core/src/index';
import { readZip } from '../../packages/assets/src/zip';
import { checkProof, claimHash, createProof, proofBodyHash, type Proof } from '../../packages/verifier/src/index';
import { decodeShare, encodeShare, shareUrl } from '../../apps/studio/src/publish/share';
import { pinnedWorlds } from '../../packages/verifier/test/fixtures';
import { CHROME_ARGS, FIREFOX_PREFS, REPO_ROOT, findChrome, findFirefox, SKIP_FIRST_RUN, startServer } from './support/env';

const ARGS = process.argv.slice(2);
const BROWSERS = ARGS.includes('--firefox') ? ['firefox'] : ARGS.includes('--chromium') ? ['chromium'] : ['chromium', 'firefox'];
const BOOT_MS = 120_000;
const CHECK_MS = 120_000;
const BENIGN_CONSOLE: readonly RegExp[] = [/GL Driver Message/i, /GPU stall due to ReadPixels/i, /valid external Instance reference no longer exists/i, /^WebGL warning:/i];

const startedAt = performance.now();
function log(line: string): void {
  process.stdout.write(`[${((performance.now() - startedAt) / 1000).toFixed(1).padStart(6)}s] ${line}\n`);
}

function check(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

function watch(page: Page, errors: string[], label: string): void {
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (!BENIGN_CONSOLE.some((re) => re.test(text))) errors.push(`[${label}] console.error: ${text.slice(0, 300)}`);
  });
  page.on('pageerror', (e) => errors.push(`[${label}] pageerror: ${e.message.slice(0, 300)}`));
  page.on('response', (r) => {
    if (r.status() === 404) errors.push(`[${label}] 404: ${r.url()}`);
  });
}

function template(slug: string): WorldDoc {
  const raw = JSON.parse(readFileSync(join(REPO_ROOT, `apps/studio/public/templates/worlds/${slug}.json`), 'utf8')) as { world: unknown };
  const v = validateWorld(raw.world);
  if (!v.ok) throw new Error(`${slug}: invalid template`);
  return v.world;
}

const rehash = (p: Proof): Proof => {
  const { signature: _s, ...rest } = p;
  return { ...rest, hash: proofBodyHash(rest) };
};

/** Serve a directory like a plain static host (no special headers, like itch.io). */
async function staticHost(dir: string): Promise<{ url: string; close(): Promise<void> }> {
  const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
  const root = normalize(dir + sep);
  const server: Server = createServer((req, res) => {
    let path = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(dir, path));
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
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

/** Open a player page, click "Check it yourself" and return the final badge state and text. */
async function checkInPlayer(browser: Browser, url: string, errors: string[], label: string): Promise<{ state: string; status: string | null; detail: string }> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  watch(page, errors, label);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('pl-title').waitFor({ timeout: BOOT_MS });
    const badge = page.getByTestId('proof-badge');
    await badge.waitFor({ timeout: 10_000 });
    const before = await badge.getAttribute('data-state');
    check(before === 'sealed' || before === 'none', `badge starts as '${before}' (it must not claim verification before a check)`);
    await page.getByTestId('proof-check').click();
    await page.waitForFunction(() => {
      const s = document.querySelector('[data-testid="proof-badge"]')?.getAttribute('data-state');
      return s !== undefined && s !== 'sealed' && s !== 'checking' && s !== 'none';
    }, null, { timeout: CHECK_MS, polling: 250 });
    const state = (await badge.getAttribute('data-state')) ?? '';
    const status = await page.evaluate(() => window.__aetherProof?.status ?? null);
    const detail = (await page.getByTestId('proof-detail').textContent()) ?? '';
    return { state, status, detail };
  } finally {
    await ctx.close();
  }
}

async function linkFor(world: WorldDoc, proof: Proof | object, base: string): Promise<string> {
  const enc = await encodeShare(world, { title: 'Proof test' }, proof);
  check(enc.sealed, 'the proof did not fit into the link');
  return shareUrl(`${base}/play`, enc.value);
}

async function playerChecks(browser: Browser, name: string, base: string, errors: string[]): Promise<void> {
  const world = template('domino-run');
  const proof = await createProof(world);
  check((await checkProof(proof, world)).playable, 'Node cannot verify its own proof');

  // 1. Node-sealed -> verified in this browser (cross-platform determinism).
  const ok = await checkInPlayer(browser, await linkFor(world, proof, base), errors, `${name}/player`);
  check(ok.state === 'verified' && ok.status === 'verified', `the browser replay did not reproduce the Node outcome: ${ok.state}/${ok.status} ${ok.detail}`);
  check(/not a formal proof/i.test(ok.detail), `verified wording lacks the disclaimer: ${ok.detail}`);
  log(`  [${name}] Node-sealed proof re-verified in the browser: ${ok.detail.slice(0, 110)}`);

  // 2. Forged links.
  const edited = JSON.parse(JSON.stringify(proof)) as Proof;
  edited.claim.tests[0]!.message = 'everything is fine';
  const t1 = await checkInPlayer(browser, await linkFor(world, edited, base), errors, `${name}/tamper`);
  check(t1.state === 'failed' && t1.status === 'tampered', `edited claim: ${t1.state}/${t1.status}`);
  check(/changed after it was sealed/i.test(t1.detail), `tamper wording: ${t1.detail}`);

  const forged = JSON.parse(JSON.stringify(proof)) as Proof;
  forged.claim.simulatedSeconds = forged.claim.simulatedSeconds + 1;
  forged.claim.hash = claimHash(forged.claim);
  const t2 = await checkInPlayer(browser, await linkFor(world, rehash(forged), base), errors, `${name}/forged`);
  check(t2.state === 'failed' && t2.status === 'replay-diverged', `forged+rehashed claim: ${t2.state}/${t2.status}`);

  const other = JSON.parse(JSON.stringify(world)) as WorldDoc;
  other.name = `${other.name} (edited)`;
  const t3 = await checkInPlayer(browser, await linkFor(other, proof, base), errors, `${name}/edited-world`);
  check(t3.state === 'mismatch' && t3.status === 'world-mismatch', `world edited after sealing: ${t3.state}/${t3.status}`);

  const old = JSON.parse(JSON.stringify(proof)) as Proof;
  old.engine.replay = 'aether-replay/0';
  const t4 = await checkInPlayer(browser, await linkFor(world, rehash(old), base), errors, `${name}/old-engine`);
  check(t4.state === 'mismatch' && t4.status === 'engine-mismatch', `other engine version: ${t4.state}/${t4.status}`);
  check(/different version of the engine/i.test(t4.detail), `version wording: ${t4.detail}`);
  log(`  [${name}] forged claim, re-hashed claim, edited world and old engine all fail with a clear message`);
}

async function studioFlow(browser: Browser, name: string, base: string, errors: string[]): Promise<void> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript({ content: SKIP_FIRST_RUN });
  const page = await ctx.newPage();
  watch(page, errors, `${name}/studio`);
  let dir = '';
  try {
    await page.goto(`${base}/?debug=1#/new/coin-island`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => {
        const a = window.__aether;
        const st = a?.store.getState();
        return !!a && a.simulation !== null && st?.loading === null && !st.agentBusy;
      },
      null,
      { timeout: BOOT_MS, polling: 250 },
    );
    await page.evaluate(async () => window.__aether?.simulation?.whenSynced());
    await page.getByTestId('topbar-publish').click();
    await page.getByTestId('publish-hub').waitFor({ timeout: 15_000 });

    // Share link: sealed in the browser, verified here in Node.
    await page.getByTestId('publish-target-share').click();
    await page.waitForFunction(() => (document.querySelector<HTMLInputElement>('[data-testid="publish-share-link"]')?.value ?? '').includes('#w='), null, { timeout: CHECK_MS });
    const link = await page.getByTestId('publish-share-link').inputValue();
    const dec = await decodeShare(link.slice(link.indexOf('#w=') + 3));
    check(dec.ok, 'the share link does not decode');
    if (!dec.ok) return;
    check(dec.payload.proof !== undefined, 'the share link carries no proof');
    const linkCheck = await checkProof(dec.payload.proof, dec.payload.world);
    check(linkCheck.status === 'verified' && linkCheck.signature?.valid === true, `Node cannot verify the browser's link proof: ${linkCheck.status} ${linkCheck.differences.join('; ')}`);
    log(`  [${name}] share link sealed in the browser (signed), verified in Node`);
    const viaLink = await checkInPlayer(browser, link, errors, `${name}/own-link`);
    check(viaLink.state === 'verified', `the browser cannot re-verify its own link: ${viaLink.state}/${viaLink.status}`);

    // Game zip.
    await page.getByTestId('publish-target-game').click();
    const zipDl = page.waitForEvent('download', { timeout: CHECK_MS * 2 });
    await page.getByTestId('publish-game-download').click();
    const path = await (await zipDl).path();
    check(path, 'no zip downloaded');
    const zip = new Uint8Array(readFileSync(path));
    const r = await readZip(zip);
    check(r.ok, 'the zip does not read');
    if (!r.ok) return;
    check(r.entries.some((e) => e.name === 'proof.json'), 'the build lacks proof.json');
    dir = mkdtempSync(join(tmpdir(), 'aether-proof-'));
    for (const e of r.entries) {
      const file = join(dir, e.name);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, e.data);
    }
    const index = readFileSync(join(dir, 'index.html'), 'utf8');
    check(/<meta name="aether:proof" content="sha256:[0-9a-f]{64}"/.test(index), 'index.html lacks the proof meta tag');

    // The CLI verifies the browser-sealed build: exit 0, then 1 after tampering.
    const cli = (file: string): { code: number | null; out: string } => {
      const res = spawnSync(process.execPath, [join(REPO_ROOT, 'packages/verifier/bin/aether-verify.mjs'), file], { encoding: 'utf8', timeout: 120_000 });
      return { code: res.status, out: `${res.stdout}${res.stderr}` };
    };
    const good = cli(join(dir, 'game.json'));
    check(good.code === 0 && /VERIFIED/.test(good.out), `aether-verify rejected the browser's proof (exit ${good.code}): ${good.out.slice(0, 400)}`);
    const proofText = readFileSync(join(dir, 'proof.json'), 'utf8');
    const badProof = JSON.parse(proofText) as Proof;
    badProof.claim.simulatedSeconds += 1;
    writeFileSync(join(dir, 'proof-bad.json'), JSON.stringify(badProof));
    const bad = spawnSync(process.execPath, [join(REPO_ROOT, 'packages/verifier/bin/aether-verify.mjs'), join(dir, 'proof-bad.json'), '--world', join(dir, 'game.json')], { encoding: 'utf8', timeout: 120_000 });
    check(bad.status === 1 && /tampered/.test(bad.stdout), `aether-verify did not flag the tampered proof (exit ${bad.status}): ${bad.stdout.slice(0, 300)}`);
    log(`  [${name}] aether-verify: browser-sealed build exits 0; tampered proof exits 1`);

    // The extracted build shows the badge and re-checks it locally.
    const host = await staticHost(dir);
    try {
      const built = await checkInPlayer(browser, `${host.url}/index.html`, errors, `${name}/game`);
      check(built.state === 'verified' && built.status === 'verified', `the published build did not verify: ${built.state}/${built.status} ${built.detail}`);
      log(`  [${name}] published build: sealed badge -> one click -> Verified playable`);
    } finally {
      await host.close();
    }
  } finally {
    await ctx.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

/** The verifier bundled for browsers (IIFE `AetherVerifier`), built with esbuild from the same sources the CLI uses. */
async function bundleVerifier(): Promise<string> {
  const out = await build({
    entryPoints: [join(REPO_ROOT, 'packages/verifier/src/index.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'AetherVerifier',
    platform: 'browser',
    target: 'es2022',
    logLevel: 'silent',
  });
  const file = out.outputFiles[0];
  if (!file) throw new Error('esbuild produced nothing');
  return file.text;
}

declare global {
  interface Window {
    AetherVerifier: typeof import('../../packages/verifier/src/index');
  }
}

/** Seal the pinned worlds in this engine and compare with Node, byte for byte; then verify Node's proofs here. */
async function engineMatrix(browser: Browser, name: string, bundle: string, errors: string[]): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'aether-engine-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><title>engine</title><link rel="icon" href="data:,"><script src="verifier.js"></script>');
  writeFileSync(join(dir, 'verifier.js'), bundle);
  const host = await staticHost(dir);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  watch(page, errors, `${name}/engine`);
  try {
    await page.goto(`${host.url}/index.html`, { waitUntil: 'load' });
    const worlds = pinnedWorlds();
    for (const [slug, world] of Object.entries(worlds)) {
      const nodeProof = await createProof(world, { now: 1 });
      const json = JSON.parse(JSON.stringify(world)) as unknown;
      const here = await page.evaluate(
        async ({ w, p }) => {
          const V = window.AetherVerifier;
          const sealed = await V.createProof(w as never, { now: 1 });
          const checked = await V.checkProof(p, w);
          return { sealed: JSON.stringify(sealed), status: checked.status, playable: checked.playable };
        },
        { w: json, p: JSON.parse(JSON.stringify(nodeProof)) as unknown },
      );
      check(here.status === 'verified' && here.playable, `${name}: Node's proof for '${slug}' does not verify here (${here.status})`);
      check(here.sealed === JSON.stringify(nodeProof), `${name}: '${slug}' sealed here differs from Node's proof`);
    }
    log(`  [${name}] engine matrix: ${Object.keys(worlds).length} worlds sealed here are byte-identical to Node's, and Node's proofs verify here`);
  } finally {
    await ctx.close();
    await host.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

async function hasWebGl(browser: Browser): Promise<boolean> {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    return await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));
  } finally {
    await ctx.close();
  }
}

async function runBrowser(name: string, base: string, bundle: string): Promise<void> {
  let browser: Browser | null = null;
  const errors: string[] = [];
  try {
    browser = name === 'firefox' ? await firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } }) : await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
    log(name);
    await engineMatrix(browser, name, bundle, errors);
    if (!(await hasWebGl(browser))) {
      check(process.env['AETHER_E2E_SKIP_NO_GL'] === '1', `${name} has no WebGL here, so the player cannot start (set AETHER_E2E_SKIP_NO_GL=1 to run the engine matrix only)`);
      log(`  [${name}] SKIPPED the player and studio flows: no WebGL in this environment`);
      check(errors.length === 0, `console/page errors:\n  ${errors.join('\n  ')}`);
      return;
    }
    await playerChecks(browser, name, base, errors);
    await studioFlow(browser, name, base, errors);
    check(errors.length === 0, `console/page errors:\n  ${errors.join('\n  ')}`);
    log(`${name} passed`);
  } finally {
    await browser?.close();
  }
}

async function main(): Promise<void> {
  const bundle = await bundleVerifier();
  log(`verifier bundle: ${Math.round(bundle.length / 1024)} KB`);
  const server = await startServer(log);
  try {
    for (const name of BROWSERS) await runBrowser(name, server.url, bundle);
    log('proof e2e passed');
  } finally {
    await server.stop();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
