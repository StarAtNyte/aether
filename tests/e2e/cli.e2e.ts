/**
 * End-to-end check of the one-command local app, as a user runs it:
 *
 *  1. `aether start` (temp state folder, free port, fake `codex` / `claude`
 *     CLIs first on PATH, so no real account or quota is ever touched)
 *     detaches the server and prints the local link; running it again just
 *     prints the link; `aether status --json` reports it.
 *  2. In Chromium, then Firefox (one browser at a time): open the printed
 *     link, see the first-run "Connect your AI" screen (local variant), get a
 *     device sign-in code through the real server + fake Codex CLI, cancel,
 *     choose "Continue offline", check the "Sign in" chip and that a reload
 *     does not nag, then generate a world with the offline planner.
 *  3. Chromium again: the device sign-in completes, the screen shows the
 *     account and the CLI's models; `aether login` / `doctor` / `logout`.
 *  4. `aether stop`: the server process is gone and status says so.
 *
 * The server's DNS-rebinding defence and session cookie are checked on the
 * way. Run: `npm run build && npm run e2e:cli`.
 */
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { chromium, firefox, type Browser, type Page } from 'playwright';
import { CHROME_ARGS, FIREFOX_PREFS, REPO_ROOT, STUDIO_DIST, findChrome, findFirefox } from './support/env';

const CLI = join(REPO_ROOT, 'apps/cli/bin/aether.mjs');
const TURN_TIMEOUT_MS = 120_000;
const startedAt = performance.now();

function log(line: string): void {
  process.stdout.write(`[${((performance.now() - startedAt) / 1000).toFixed(1).padStart(6)}s] ${line}\n`);
}

class E2EFailure extends Error {
  override name = 'E2EFailure';
}

function check(cond: unknown, message: string): asserts cond {
  if (!cond) throw new E2EFailure(message);
}

async function waitFor<T>(what: string, timeoutMs: number, probe: () => Promise<T | null | undefined | false>, intervalMs = 250): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown = null;
  while (Date.now() < deadline) {
    const v = await probe();
    if (v !== null && v !== undefined && v !== false) return v;
    last = v;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new E2EFailure(`timed out after ${timeoutMs} ms waiting for ${what} (last=${JSON.stringify(last)})`);
}

/**
 * A fake `codex`. Signed out until a device sign-in completes: by default the
 * device sign-in prints a link + code and waits (so it can be cancelled);
 * once the test creates \`<bin>/../complete\` it signs in after a moment
 * (marker file in CODEX_HOME), exactly like the real CLI finishing.
 */
const FAKE_CODEX = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const a = process.argv.slice(2).join(' ');
const home = process.env.CODEX_HOME || '';
const marker = path.join(home, 'fake-auth');
const signedIn = () => home !== '' && fs.existsSync(marker);
if (a === 'login status') {
  if (signedIn()) { process.stdout.write('Logged in using ChatGPT\\n'); process.exit(0); }
  process.stdout.write('Not logged in\\n'); process.exit(1);
}
if (a === 'login --device-auth' || a === 'login') {
  process.stdout.write('Follow these steps to sign in with ChatGPT using device code authorization:\\n');
  process.stdout.write('1. Open this link in your browser and sign in to your account\\n   https://auth.openai.com/codex/device\\n');
  process.stdout.write('2. Enter this one-time code (expires in 15 minutes)\\n   FAKE-12345\\n');
  if (fs.existsSync(path.join(__dirname, '..', 'complete'))) {
    setTimeout(() => { fs.mkdirSync(home, { recursive: true }); fs.writeFileSync(marker, 'ok'); process.stdout.write('Successfully logged in\\n'); process.exit(0); }, 5000);
  } else setTimeout(() => process.exit(1), 60000);
  process.on('SIGTERM', () => process.exit(143));
} else if (a === 'logout') { try { fs.rmSync(marker); } catch {} process.stdout.write('Successfully logged out\\n'); process.exit(0); }
else if (a === 'mcp list --json') { process.stdout.write('[]'); }
else if (a === 'debug models') {
  const m = (slug, name) => ({ slug, display_name: name, visibility: 'list', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }], input_modalities: ['text'] });
  process.stdout.write(JSON.stringify({ models: [m('fake-model-a', 'Fake Model A'), m('fake-model-b', 'Fake Model B')] }));
}
else { process.stderr.write('fake codex: unsupported ' + a + '\\n'); process.exit(2); }
`;

/** A fake `claude`: installed, never signed in. */
const FAKE_CLAUDE = `#!/usr/bin/env node
const a = process.argv.slice(2).join(' ');
if (a === 'auth status --json') { process.stdout.write('{"loggedIn":false}'); process.exit(1); }
process.exit(2);
`;

/** Ask the OS for a free port on 127.0.0.1. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      srv.close(() => (port > 0 ? resolve(port) : reject(new Error('no free port'))));
    });
  });
}

/** Run the CLI to completion. */
function aether(args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.once('exit', (code) => resolve({ code: code ?? 1, out, err }));
  });
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

interface Turn {
  busy: boolean;
  status: string | null;
  head: number;
  entities: number;
}

function turnState(page: Page): Promise<Turn | null> {
  return page.evaluate((): Turn | null => {
    const a = window.__aether;
    if (!a) return null;
    const st = a.store.getState();
    const last = st.chat[st.chat.length - 1];
    return { busy: st.agentBusy, status: last && last.role === 'assistant' ? last.status : null, head: a.history.head, entities: Object.keys(a.history.current.entities).length };
  });
}

/** Benign console noise of software GPU paths (same list as the studio e2e). */
const BENIGN = [/GL Driver Message/i, /GPU stall due to ReadPixels/i, /valid external Instance reference no longer exists/i, /^WebGL warning:/i];

async function browserRun(name: 'chromium' | 'firefox', browser: Browser, link: string, port: number): Promise<void> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const errors: string[] = [];
  try {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !BENIGN.some((re) => re.test(m.text()))) errors.push(`console: ${m.text().slice(0, 300)}`);
    });

    // 1. The printed link opens the studio with the local first-run screen.
    await page.goto(link, { waitUntil: 'domcontentloaded' });
    const screen = page.getByTestId('first-run');
    await screen.waitFor({ state: 'visible', timeout: 60_000 });
    check((await screen.getAttribute('data-variant')) === 'local', `${name}: expected the local first-run screen, got ${await screen.getAttribute('data-variant')}`);
    check(await page.getByTestId('first-run-codex').isVisible(), `${name}: no "Sign in with ChatGPT (Codex)" option`);
    check((await page.getByTestId('first-run-claude').count()) === 0, `${name}: Claude Code offered although it is not signed in`);
    check((await page.getByTestId('first-run-byok').count()) === 0, `${name}: the local screen offers the hosted API-key option`);

    // 2. Device sign-in through the real local server and the fake Codex CLI.
    const startLogin = page.getByTestId('first-run-login-start');
    await startLogin.waitFor({ state: 'visible', timeout: 40_000 });
    await startLogin.click();
    const code = page.getByTestId('first-run-device-code');
    await waitFor(`${name}: the one-time code`, 20_000, async () => (await code.count()) > 0 && (await code.innerText()) === 'FAKE-12345');
    const href = await page.locator('.first-run__steps a').getAttribute('href');
    check(href === 'https://auth.openai.com/codex/device', `${name}: the sign-in link is ${href}`);
    check((await page.locator('.first-run__steps a').getAttribute('rel'))?.includes('noopener'), `${name}: the sign-in link lacks rel=noopener`);
    await page.getByTestId('first-run-login').getByRole('button', { name: 'Cancel' }).click();
    await waitFor(`${name}: the cancelled sign-in`, 15_000, async () => page.getByTestId('first-run-login-start').isVisible());
    await page.screenshot({ path: join(REPO_ROOT, 'docs/screenshots', `first-run-local-${name}.png`) }).catch(() => undefined);

    // 3. Continue offline: the screen closes, the quiet chip appears, a reload does not nag.
    await page.getByTestId('first-run-offline').click();
    await screen.waitFor({ state: 'detached', timeout: 10_000 });
    await page.getByTestId('signin-chip').waitFor({ state: 'visible', timeout: 10_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId('signin-chip').waitFor({ state: 'visible', timeout: 30_000 });
    check((await page.getByTestId('first-run').count()) === 0, `${name}: the first-run screen came back after a reload`);

    // 4. Generate a world offline.
    await page.goto(`${link}/?debug=1#/new`, { waitUntil: 'domcontentloaded' });
    const before = await waitFor(`${name}: the editor`, 90_000, async () => {
      const s = await turnState(page);
      return s && s.entities > 0 ? s : null;
    });
    const input = page.getByLabel('Prompt', { exact: true });
    await input.click();
    await input.fill('Build a domino run that knocks over a bell tower');
    await input.press('Enter');
    const after = await waitFor(`${name}: the agent turn`, TURN_TIMEOUT_MS, async () => {
      const s = await turnState(page);
      return s && !s.busy && s.status !== null && s.status !== 'streaming' && s.head !== before.head ? s : null;
    });
    check(after.status === 'done', `${name}: the turn ended with ${after.status}`);
    check(after.entities > 5, `${name}: the world has only ${after.entities} entities`);

    // The session cookie is HttpOnly (invisible to page script) and local AI answered the studio.
    check(!(await page.evaluate(() => document.cookie)).includes('aether_session'), `${name}: the session cookie is readable by script`);
    const local = await page.evaluate(async (p) => (await fetch(`http://127.0.0.1:${p}/api/local/status`)).status, port);
    check(local === 200, `${name}: the studio's own local AI request answered ${local}`);
    check(errors.length === 0, `${name}: page errors:\n  ${errors.join('\n  ')}`);
    log(`${name}: first-run screen, device code, offline choice and an offline world all OK`);
  } finally {
    await ctx.close();
  }
}

/**
 * The sign-in completes: a fresh visitor starts the device sign-in, the fake
 * CLI finishes it, and the screen switches by itself to the signed-in account
 * with the CLI's model list; choosing a model closes it, no "Sign in" chip.
 */
async function signedInRun(browser: Browser, link: string): Promise<void> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const errors: string[] = [];
  try {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    await page.goto(link, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('first-run').waitFor({ state: 'visible', timeout: 60_000 });
    const startLogin = page.getByTestId('first-run-login-start');
    await startLogin.waitFor({ state: 'visible', timeout: 40_000 });
    await startLogin.click();
    await page.getByTestId('first-run-device-code').waitFor({ state: 'visible', timeout: 20_000 });
    const signedIn = page.getByTestId('first-run-signed-in');
    await signedIn.waitFor({ state: 'visible', timeout: 30_000 });
    const account = await signedIn.innerText();
    check(/Signed in/.test(account) && /ChatGPT/.test(account), `the signed-in panel shows "${account.replace(/\s+/g, ' ')}"`);
    const select = page.getByLabel('Codex model');
    const options = await select.locator('option').allInnerTexts();
    check(options.join('|') === 'Fake Model A|Fake Model B', `the model picker lists ${options.join(', ')}`);
    await select.selectOption('fake-model-b');
    await page.getByTestId('first-run-done').click();
    await page.getByTestId('first-run').waitFor({ state: 'detached', timeout: 10_000 });
    const prefs = await page.evaluate(() => localStorage.getItem('aether.ai.prefs.v1') ?? JSON.stringify(Object.fromEntries(Object.entries(localStorage))));
    check(prefs.includes('fake-model-b'), `the chosen model was not remembered: ${prefs.slice(0, 300)}`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    check((await page.getByTestId('first-run').count()) === 0, 'the first-run screen came back after signing in');
    check((await page.getByTestId('signin-chip').count()) === 0, 'the "Sign in" chip shows although signed in');
    check(errors.length === 0, `page errors:\n  ${errors.join('\n  ')}`);
    log('chromium: device sign-in completed by itself, account + model picker shown, choice remembered');
  } finally {
    await ctx.close();
  }
}

async function main(): Promise<void> {
  check(existsSync(join(STUDIO_DIST, 'index.html')), 'apps/studio/dist is missing: run `npm run build` first');
  const root = mkdtempSync(join(tmpdir(), 'aether-cli-e2e-'));
  const stateDir = join(root, 'state');
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  for (const [name, body] of [
    ['codex', FAKE_CODEX],
    ['claude', FAKE_CLAUDE],
  ] as const) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
  const port = await freePort();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // Fakes first; node's own folder for the shebangs; nothing else that could hold a real CLI.
    PATH: [bin, dirname(process.execPath), '/usr/bin', '/bin'].join(delimiter),
    CODEX_HOME: join(root, 'codex-home'),
    CLAUDE_CONFIG_DIR: join(root, 'claude-home'),
    AETHER_STATE_DIR: stateDir,
    AETHER_PROVIDER: 'mock',
    ANTHROPIC_API_KEY: '',
    OPENAI_API_KEY: '',
  };
  let pid = 0;
  try {
    // 1. Start (detached), start again, status.
    const started = await aether(['start', '--no-build', '--port', String(port)], env);
    check(started.code === 0, `aether start failed (${started.code}):\n${started.out}\n${started.err}`);
    const link = /Aether is running: (http:\/\/\S+)/.exec(started.out)?.[1];
    check(link === `http://127.0.0.1:${port}`, `unexpected link in:\n${started.out}`);
    check(/Codex is not signed in/.test(started.out), `start did not report the Codex sign-in state:\n${started.out}`);
    log(`aether start → ${link}`);
    const again = await aether(['start', '--no-build'], env);
    check(again.code === 0 && again.out.includes(`Aether is already running: ${link}`), `second start did not just print the link:\n${again.out}${again.err}`);
    const status = await aether(['status', '--json'], env);
    const st = JSON.parse(status.out) as { state: string; pid: number; url: string };
    check(st.state === 'running' && st.url === link && st.pid > 0, `unexpected status ${status.out}`);
    pid = st.pid;
    check(pidAlive(pid), 'the recorded pid is not alive');

    // DNS rebinding: a foreign Host header is refused on every route.
    // (node:http, because fetch always sends the real Host.)
    const rebind = await new Promise<number>((resolve) => {
      const req = httpRequest({ host: '127.0.0.1', port, path: '/', headers: { host: `rebind.example:${port}` } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.once('error', () => resolve(0));
      req.end();
    });
    check(rebind === 421, `a foreign Host got ${rebind}`);

    // 2. Browsers, one at a time.
    const chrome = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS], headless: true });
    try {
      await browserRun('chromium', chrome, link, port);
    } finally {
      await chrome.close();
    }
    const fox = await firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS }, headless: true });
    try {
      await browserRun('firefox', fox, link, port);
    } finally {
      await fox.close();
    }

    // 3. The sign-in completes (fake CLI finishes it); the CLI then sees the login too.
    writeFileSync(join(root, 'complete'), '1');
    const chrome2 = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS], headless: true });
    try {
      await signedInRun(chrome2, link);
    } finally {
      await chrome2.close();
    }
    const login = await aether(['login'], env);
    check(login.code === 0 && /already signed in/.test(login.out), `aether login did not detect the login:\n${login.out}${login.err}`);
    const doctor = await aether(['doctor', '--json'], env);
    const checks = JSON.parse(doctor.out) as Array<{ name: string; status: string }>;
    check(checks.some((c) => /codex/i.test(c.name) && c.status === 'ok'), `doctor does not report Codex signed in: ${doctor.out}`);
    const logout = await aether(['logout'], env);
    check(logout.code === 0 && /Signed out/.test(logout.out), `aether logout failed:\n${logout.out}${logout.err}`);
    log('aether login (already signed in), doctor and logout OK');

    // 4. Stop.
    const stopped = await aether(['stop'], env);
    check(stopped.code === 0 && stopped.out.includes('Aether stopped.'), `aether stop failed:\n${stopped.out}${stopped.err}`);
    await waitFor('the server process to exit', 10_000, async () => !pidAlive(pid));
    const after = await aether(['status'], env);
    check(after.code === 3 && after.out.includes('not running'), `status after stop: ${after.out}`);
    const gone = await fetch(`${link}/api/health`).then(() => false, () => true);
    check(gone, 'the port still answers after stop');
    log('aether stop → the process is gone');
  } finally {
    if (pid > 0 && pidAlive(pid)) {
      await aether(['stop', '--force'], env);
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        /* gone */
      }
    }
    rmSync(root, { recursive: true, force: true });
  }
}

main().then(
  () => {
    log('CLI e2e passed');
    process.exit(0);
  },
  (e: unknown) => {
    log(`CLI e2e FAILED: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  },
);
