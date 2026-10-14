/**
 * Hosted (static) build end to end: the studio served exactly as the static
 * host serves it (files from apps/studio/dist with the headers and rewrites
 * of vercel.json, **no `/api`**), in Chromium and then Firefox, one browser at
 * a time. Nothing here spends real quota: the provider API is answered by a
 * scripted route and the bridge is the real handler with scripted backends.
 *
 *   npm run build && npm run e2e:hosted
 *
 * 1. Bring your own key: a key entered in Settings → AI connection is kept in
 *    sessionStorage only, a whole turn (planner + vision critic) is served by
 *    the provider's API straight from the browser (CSP allows it, CORS
 *    preflight passes), the key never reaches this origin, the composer shows
 *    the key connection, and the usage counter moves.
 * 2. The local bridge stays available on the hosted build: the first-run
 *    screen leads with "Use your own Codex / ChatGPT login" (pair, device
 *    code through the bridge, model pick), and Settings pairing shows Codex
 *    ready.
 * 3. Offline: with no key and no bridge a prompt still builds a world.
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, sep } from 'node:path';
import { chromium, firefox, type Browser, type Page, type Route } from 'playwright';
import { PROMPT_EXAMPLES, type BridgeBackendStatus, type LoginState, type TextBackend } from '@aether/agent';
import type { LoginManager } from '../../apps/bridge/src/auth';
import { Pairing } from '../../apps/bridge/src/pairing';
import { createBridgeHandler } from '../../apps/bridge/src/server';
import { CHROME_ARGS, FIREFOX_PREFS, REPO_ROOT, STUDIO_DIST, findChrome, findFirefox } from './support/env';

const TURN_TIMEOUT_MS = 120_000;
const KEY = 'sk-e2e-0123456789abcdefghijklmnopqrstuv';

function log(line: string): void {
  process.stdout.write(`${line}\n`);
}

function check(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

async function waitFor<T>(what: string, timeoutMs: number, probe: () => Promise<T | null | false>): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await probe();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

// ---------------------------------------------------------------------------
// Static host: dist + vercel.json headers and rewrites, no /api.
// ---------------------------------------------------------------------------

interface HeaderRule {
  source: RegExp;
  headers: Array<{ key: string; value: string }>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

interface StaticHost {
  url: string;
  /** Requests that reached this origin (path + headers + body), to prove the key never came here. */
  seen: string[];
  close(): Promise<void>;
}

async function startStaticHost(): Promise<StaticHost> {
  if (!existsSync(join(STUDIO_DIST, 'index.html'))) throw new Error('apps/studio/dist is missing — run `npm run build` first.');
  const vercel = JSON.parse(readFileSync(join(REPO_ROOT, 'vercel.json'), 'utf8')) as { headers: Array<{ source: string; headers: HeaderRule['headers'] }>; rewrites: Array<{ source: string; destination: string }> };
  const rules: HeaderRule[] = vercel.headers.map((h) => ({ source: new RegExp(`^${h.source}$`), headers: h.headers }));
  const rewrites = vercel.rewrites.map((r) => ({ source: new RegExp(`^${r.source}$`), destination: r.destination }));
  const seen: string[] = [];
  const root = normalize(STUDIO_DIST + sep);
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const path = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
      seen.push(`${req.method} ${req.url ?? ''} ${JSON.stringify(req.headers)} ${Buffer.concat(chunks).toString('utf8').slice(0, 100_000)}`);
      for (const r of rules) if (r.source.test(path)) for (const h of r.headers) res.setHeader(h.key, h.value);
      let file = normalize(join(STUDIO_DIST, path));
      if (!file.startsWith(root) && file !== normalize(STUDIO_DIST)) {
        res.writeHead(400).end();
        return;
      }
      const isFile = existsSync(file) && statSync(file).isFile();
      if (!isFile) {
        const rw = rewrites.find((r) => r.source.test(path));
        if (!rw) {
          res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
          return;
        }
        file = join(STUDIO_DIST, rw.destination);
      }
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(readFileSync(file));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://localhost:${port}`,
    seen,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

// ---------------------------------------------------------------------------
// Scripted provider API (OpenAI Responses) and bridge.
// ---------------------------------------------------------------------------

interface ProviderLog {
  calls: Array<{ auth: string | undefined; model: string | undefined; critic: boolean; images: number }>;
  preflights: number;
  /** Model list requests (Settings loads the provider's own list once a key is set). */
  lists: number;
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, GET, OPTIONS' };

async function routeOpenAI(page: Page, logp: ProviderLog): Promise<void> {
  const example = PROMPT_EXAMPLES[0];
  if (!example) throw new Error('no prompt example');
  await page.route('https://api.openai.com/**', async (route: Route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') {
      logp.preflights++;
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    if (req.method() === 'GET' && new URL(req.url()).pathname === '/v1/models') {
      logp.lists++;
      await route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ data: [{ id: 'gpt-6.1-sol' }, { id: 'gpt-6-luna' }, { id: 'gpt-6-tts' }] }) });
      return;
    }
    const body = JSON.parse(req.postData() ?? '{}') as { model?: string; instructions?: string; input?: unknown[]; tools?: unknown[] };
    const text = JSON.stringify(body.input ?? []);
    const critic = !body.tools || body.tools.length === 0;
    logp.calls.push({ auth: (await req.allHeaders())['authorization'], model: body.model, critic, images: (text.match(/input_image/g) ?? []).length });
    let output: unknown[];
    if (critic) {
      const verdict = { scores: { composition: 8, materials: 8, lighting: 8, scale: 9, detail: 7, coherence: 9 }, summary: 'Scripted critic.' };
      output = [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(verdict) }] }];
    } else if (text.includes('function_call_output')) {
      output = [{ type: 'function_call', call_id: 'c2', name: 'finish', arguments: JSON.stringify({ message: 'Built it.' }) }];
    } else {
      output = [{ type: 'function_call', call_id: 'c1', name: 'apply_patches', arguments: JSON.stringify({ patches: example.patches, message: example.message }) }];
    }
    await route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ model: body.model, output, usage: { input_tokens: 1200, output_tokens: 80 } }) });
  });
}

interface FakeBridge {
  url: string;
  pairing: Pairing;
  /** Sign-in starts seen by the scripted login (device-code flow). */
  logins: number;
  close(): Promise<void>;
}

/**
 * The real bridge handler with scripted backends. `codexSignedIn: false`
 * starts with Codex signed out and scripts a device-code sign-in that
 * completes on the second status poll (no CLI runs, no quota is used).
 */
async function startFakeBridge(studioOrigin: string, opts: { codexSignedIn?: boolean; claudeSignedIn?: boolean } = {}): Promise<FakeBridge> {
  const idle: TextBackend = { name: 'scripted', strictSchema: false, complete: async () => ({ text: JSON.stringify({ final_message: 'ok' }) }) };
  const pairing = new Pairing();
  let port = 0;
  let codexIn = opts.codexSignedIn ?? true;
  let login: LoginState | null = null;
  let polls = 0;
  const fake: FakeBridge = { url: '', pairing, logins: 0, close: async () => undefined };
  const scriptedLogin = {
    status: (): LoginState | null => {
      if (login?.running && ++polls >= 2) {
        codexIn = true;
        login = { ...login, running: false, finished: { ok: true, message: 'Signed in.' } };
      }
      return login;
    },
    start: (backend: LoginState['backend']): LoginState => {
      fake.logins++;
      polls = 0;
      login = { backend, running: true, url: 'https://auth.openai.com/codex/device', code: 'WXYZ-12345', output: '', startedAt: Date.now() };
      return login;
    },
    cancel: (): void => {
      if (login?.running) login = { ...login, running: false, finished: { ok: false, message: 'Cancelled.' } };
    },
    logout: async (): Promise<{ ok: boolean; message: string }> => ({ ok: true, message: 'Signed out.' }),
  };
  const models: BridgeBackendStatus['models'] = [{ id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol', efforts: ['low'], vision: true }];
  const handler = createBridgeHandler({
    config: { origins: [studioOrigin], maxBodyBytes: 1024 * 1024, maxWaiting: 2 },
    port: () => port,
    pairing,
    backends: { codex: idle, 'claude-code': idle },
    login: scriptedLogin as unknown as LoginManager,
    status: async () => [
      { id: 'codex', label: 'Codex', installed: true, loggedIn: codexIn, detail: codexIn ? 'Logged in using ChatGPT' : 'Not logged in', models: codexIn ? models : [], ...(codexIn ? { defaultModel: 'gpt-6.1-sol' } : {}) },
      opts.claudeSignedIn
        ? { id: 'claude-code', label: 'Claude Code', installed: true, loggedIn: true, detail: 'Logged in', models: [{ id: 'sonnet', label: 'Sonnet', efforts: ['low'], vision: true }], defaultModel: 'sonnet' }
        : { id: 'claude-code', label: 'Claude Code', installed: false, loggedIn: false, detail: 'not found', models: [] },
    ],
  });
  const server = createServer((req, res) => handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  fake.url = `http://127.0.0.1:${port}`;
  fake.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return fake;
}

// ---------------------------------------------------------------------------
// Studio helpers
// ---------------------------------------------------------------------------

interface TurnState {
  busy: boolean;
  status: string | null;
  events: string[];
  via: string | null;
  head: number;
  entities: number;
}

function turnState(page: Page): Promise<TurnState | null> {
  return page.evaluate((): TurnState | null => {
    const a = window.__aether;
    if (!a) return null;
    const st = a.store.getState();
    const last = st.chat[st.chat.length - 1];
    const events = last && last.role === 'assistant' ? last.events : [];
    const done = events.find((e) => e.type === 'done');
    return {
      busy: st.agentBusy,
      status: last && last.role === 'assistant' ? last.status : null,
      events: events.map((e) => (e.type === 'notice' || e.type === 'error' ? `${e.type}(${e.text.slice(0, 200)})` : e.type === 'quality' ? `quality(${e.score},${e.source})` : e.type)),
      via: done && done.type === 'done' ? (done.via ?? null) : null,
      head: a.history.head,
      entities: Object.keys(a.history.current.entities).length,
    };
  });
}

async function picker(page: Page): Promise<{ kind: string | null; status: string | null; label: string }> {
  const el = page.getByTestId('model-picker');
  return { kind: await el.getAttribute('data-ai-kind'), status: await el.getAttribute('data-ai-status'), label: (await el.innerText()).trim() };
}

/** Local-storage entries that skip the first-run sign-in screen (the choice is remembered once made). */
const FIRST_RUN_DISMISSED: Readonly<Record<string, string>> = { 'aether.onboarding.v1': JSON.stringify({ choice: 'offline', at: 1 }) };

async function openEditor(browser: Browser, url: string, prefs: Record<string, unknown> | null, before?: (page: Page) => Promise<void>): Promise<{ page: Page; close: () => Promise<void>; cspViolations: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const cspViolations: string[] = [];
  page.on('pageerror', (e) => log(`  [pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (/Content[- ]Security[- ]Policy/i.test(m.text())) cspViolations.push(m.text().slice(0, 300));
  });
  await page.addInitScript(
    ([p, extra]) => {
      try {
        // null: a first visit (no preferences, first-run screen not dismissed).
        if (p !== null) {
          localStorage.setItem('aether.ai.prefs.v1', JSON.stringify(p));
          for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v);
        }
      } catch {
        /* storage blocked: the assertions below will fail */
      }
    },
    [prefs, FIRST_RUN_DISMISSED] as const,
  );
  if (before) await before(page);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await waitFor('the editor', 90_000, async () => {
    const s = await turnState(page);
    return s && s.entities > 0 ? s : null;
  });
  return { page, close: () => ctx.close(), cspViolations };
}

async function sendPrompt(page: Page, prompt: string): Promise<TurnState> {
  const before = (await turnState(page)) as TurnState;
  const input = page.getByLabel('Prompt', { exact: true });
  await input.click();
  await input.fill(prompt);
  await input.press('Enter');
  return waitFor(`the turn "${prompt}"`, TURN_TIMEOUT_MS, async () => {
    const s = await turnState(page);
    return s && !s.busy && s.status !== null && s.status !== 'streaming' && s.head !== before.head ? s : null;
  });
}

async function storageSnapshot(page: Page): Promise<{ session: string; local: string }> {
  return page.evaluate(() => {
    const out = { session: '', local: '' };
    for (let i = 0; i < sessionStorage.length; i++) out.session += `${sessionStorage.key(i) ?? ''}=${sessionStorage.getItem(sessionStorage.key(i) ?? '') ?? ''}\n`;
    for (let i = 0; i < localStorage.length; i++) out.local += `${localStorage.key(i) ?? ''}=${localStorage.getItem(localStorage.key(i) ?? '') ?? ''}\n`;
    return out;
  });
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

async function ownKeyTurn(browser: Browser, host: StaticHost): Promise<number> {
  const providerLog: ProviderLog = { calls: [], preflights: 0, lists: 0 };
  const { page, close, cspViolations } = await openEditor(browser, `${host.url}/?debug=1#/new`, { mode: 'byok', byokProvider: 'openai', refine: 1 }, (p) => routeOpenAI(p, providerLog));
  try {
    check((await picker(page)).status === 'unavailable', 'a key connection was reported usable before a key was set');
    await page.evaluate(() => window.__aether?.store.getState().openSettings('ai'));
    const dialog = page.getByRole('dialog');
    const setup = dialog.getByTestId('byok-setup');
    await setup.getByLabel('Key provider').selectOption('openai');
    await setup.getByLabel('OpenAI API key').fill(KEY);
    await setup.getByRole('button', { name: 'Use key', exact: true }).click();
    await setup.getByText('Key set for this tab').waitFor({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await waitFor('the composer to show the key connection as ready', 10_000, async () => {
      const p = await picker(page);
      return p.kind === 'byok' && p.status === 'ready' ? p : null;
    });

    const { session, local } = await storageSnapshot(page);
    check(session.includes(KEY), 'the key is not in sessionStorage');
    check(!local.includes(KEY), 'the key leaked into localStorage without "remember on this device"');

    const t0 = performance.now();
    const turn = await sendPrompt(page, 'a domino run that knocks over a bell');
    const ms = Math.round(performance.now() - t0);
    log(`    own-key turn: ${turn.status} in ${ms} ms via ${turn.via ?? '?'} — ${turn.events.join(' | ')}`);
    check(turn.status === 'done', `the key turn ended with ${turn.status}`);
    check(!turn.events.some((e) => e.startsWith('notice(')), 'the key turn fell back to the offline planner');
    check(turn.events.some((e) => e === 'verify'), 'the key turn did not verify the world');
    const planner = providerLog.calls.filter((c) => !c.critic);
    check(planner.length >= 2 && planner.every((c) => c.auth === `Bearer ${KEY}`), `unexpected provider calls ${JSON.stringify(providerLog.calls.map((c) => ({ ...c, auth: c.auth ? 'set' : 'none' })))}`);
    check(planner.every((c) => c.model === 'gpt-6.1-sol'), 'the default OpenAI model was not used');
    check(cspViolations.length === 0, `CSP blocked something: ${cspViolations.join(' | ')}`);
    check(!host.seen.some((l) => l.includes(KEY)), 'the key reached the studio origin');
    check(!host.seen.some((l) => / \/api\//.test(l) && !l.startsWith('GET /api/health')), 'the hosted studio called an /api route other than the health probe');
    log(`    provider calls: ${providerLog.calls.length} (${providerLog.calls.filter((c) => c.critic).length} critic), model lists: ${providerLog.lists}, CORS preflights: ${providerLog.preflights}`);
    check(providerLog.lists >= 1, 'Settings did not load the provider model list with the key');

    await page.evaluate(() => window.__aether?.store.getState().openSettings('ai'));
    const usage = await page.getByRole('dialog').getByTestId('byok-usage').innerText();
    check(new RegExp(`This session: ${providerLog.calls.length} / \\d+ calls`).test(usage), `usage counter shows "${usage}"`);
    await page.getByRole('dialog').getByTestId('byok-setup').getByRole('button', { name: 'Forget key' }).click();
    check(!(await storageSnapshot(page)).session.includes(KEY), '"Forget key" left the key in sessionStorage');
    return ms;
  } finally {
    await close();
  }
}

async function firstRunKey(browser: Browser, host: StaticHost): Promise<void> {
  const providerLog: ProviderLog = { calls: [], preflights: 0, lists: 0 };
  const { page, close } = await openEditor(browser, `${host.url}/?debug=1#/new`, null, (p) => routeOpenAI(p, providerLog));
  try {
    const screen = page.getByTestId('first-run');
    await screen.waitFor({ timeout: 15_000 });
    check(await screen.getByTestId('first-run-local').isVisible(), 'the hosted first-run screen hides the "run locally / bridge" option');
    check((await screen.getByTestId('first-run-codex').count()) === 0, 'the hosted first-run screen offers a Codex sign-in it cannot run');
    await screen.getByTestId('first-run-byok').click();
    await screen.getByTestId('first-run-provider').selectOption('openai');
    await screen.getByTestId('first-run-key').fill(KEY);
    await screen.getByTestId('first-run-key-submit').click();
    await screen.waitFor({ state: 'detached', timeout: 10_000 });
    await waitFor('the composer to use the key', 10_000, async () => {
      const p = await picker(page);
      return p.kind === 'byok' && p.status === 'ready' ? p : null;
    });
    const turn = await sendPrompt(page, 'a bowling alley with ten pins');
    check(turn.status === 'done' && !turn.events.some((e) => e.startsWith('notice(')), `first-run key turn: ${turn.status} ${turn.events.join(' | ')}`);
    check(providerLog.calls.some((c) => c.auth === `Bearer ${KEY}`), 'the first-run key was not used for the provider call');
    // The choice is remembered: a reload does not show the screen again.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitFor('the editor after reload', 60_000, async () => ((await turnState(page))?.entities ?? 0) > 0);
    await page.waitForTimeout(3000);
    check((await page.getByTestId('first-run').count()) === 0, 'the first-run screen came back after a choice was made');
  } finally {
    await close();
  }
}

/**
 * The hosted first-run screen leads with the user's own Codex / ChatGPT
 * login through the local bridge: pair from the screen, get a device code,
 * finish signing in, pick the model, and the composer uses the bridge.
 */
async function firstRunBridge(browser: Browser, host: StaticHost): Promise<void> {
  const bridge = await startFakeBridge(host.url, { codexSignedIn: false, claudeSignedIn: true });
  const { page, close } = await openEditor(browser, `${host.url}/?debug=1#/new`, null);
  try {
    const screen = page.getByTestId('first-run');
    await screen.waitFor({ timeout: 15_000 });
    check((await screen.getAttribute('data-variant')) === 'hosted', 'expected the hosted first-run variant');
    // Order: own Codex login first, then the API key, then offline.
    const order = await screen.locator('.first-run__option').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    check(order.join(',') === 'first-run-local,first-run-byok,first-run-offline', `hosted first-run order: ${order.join(',')}`);
    await screen.getByTestId('first-run-local').click();
    const command = await screen.locator('.cmd__text').first().innerText();
    check(command.includes('npx aether start --origin') && command.includes(host.url), `install command lacks this origin: ${command}`);
    await screen.locator('.first-run__more summary').click();
    await screen.getByTestId('first-run-bridge-url').fill(bridge.url);
    await screen.getByTestId('first-run-pair-code').fill(bridge.pairing.currentCode);
    await screen.getByTestId('first-run-pair').click();
    await screen.getByTestId('first-run-bridge-paired').waitFor({ timeout: 15_000 });
    // Codex is signed out on that computer: the device-code sign-in runs through the bridge.
    await screen.getByTestId('first-run-login-start').click();
    const code = await screen.getByTestId('first-run-device-code').innerText({ timeout: 10_000 });
    check(code === 'WXYZ-12345' && bridge.logins === 1, `device code via the bridge: ${code} (${bridge.logins} starts)`);
    await screen.getByTestId('first-run-signed-in').waitFor({ timeout: 20_000 });
    check(await screen.getByTestId('first-run-bridge-claude').isVisible(), 'a signed-in Claude Code is not offered on the paired computer');
    await screen.getByTestId('first-run-done').click();
    await screen.waitFor({ state: 'detached', timeout: 10_000 });
    await waitFor('the composer to use the bridge', 15_000, async () => {
      const p = await picker(page);
      return p.kind === 'bridge' && p.status === 'ready' ? p : null;
    });
    const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem('aether.ai.prefs.v1') ?? '{}') as Record<string, unknown>);
    check(prefs['mode'] === 'bridge' && prefs['backend'] === 'codex' && prefs['codexModel'] === 'gpt-6.1-sol', `prefs after the bridge choice: ${JSON.stringify(prefs)}`);
  } finally {
    await close();
    await bridge.close();
  }
}

async function bridgeOnHosted(browser: Browser, host: StaticHost): Promise<void> {
  const bridge = await startFakeBridge(host.url);
  const { page, close } = await openEditor(browser, `${host.url}/?debug=1#/new`, { mode: 'bridge', backend: 'codex', effort: 'low' });
  try {
    await page.evaluate(() => window.__aether?.store.getState().openSettings('ai'));
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Bridge address').fill(bridge.url);
    await dialog.getByLabel('Pairing code').fill(bridge.pairing.currentCode);
    await dialog.getByRole('button', { name: 'Pair', exact: true }).click();
    await dialog.locator('.backend-list__row', { hasText: 'Codex' }).getByText('Ready').waitFor({ timeout: 15_000 });
    await page.keyboard.press('Escape');
    await waitFor('the composer to show the bridge as ready', 10_000, async () => {
      const p = await picker(page);
      return p.kind === 'bridge' && p.status === 'ready' ? p : null;
    });
  } finally {
    await close();
    await bridge.close();
  }
}

async function offlineTurn(browser: Browser, host: StaticHost): Promise<void> {
  const { page, close } = await openEditor(browser, `${host.url}/?debug=1#/new`, { mode: 'auto' });
  try {
    const p = await picker(page);
    check(p.kind === 'offline' && p.status === 'ready', `auto mode on a static build resolved to ${p.kind}/${p.status}`);
    const turn = await sendPrompt(page, 'a cozy forest camp with a campfire');
    check(turn.status === 'done' && turn.via === 'Offline planner' && turn.entities > 0, `offline turn: ${turn.status} via ${turn.via}`);
  } finally {
    await close();
  }
}

async function runBrowser(name: string, launch: () => Promise<Browser>, host: StaticHost): Promise<number> {
  log(`\n${name}`);
  let browser: Browser | null = null;
  try {
    browser = await launch();
    const ms = await ownKeyTurn(browser, host);
    log('  ✓ own key: session-only storage, direct provider calls, CSP + CORS, key never sent to this origin, usage counter, forget');
    await firstRunKey(browser, host);
    log('  ✓ first-run screen (hosted variant): key path builds a world, choice remembered');
    await firstRunBridge(browser, host);
    log('  ✓ first-run screen (hosted variant): own Codex login via the bridge (pair, device code, model) leads');
    await bridgeOnHosted(browser, host);
    log('  ✓ local bridge pairing available on the hosted build');
    await offlineTurn(browser, host);
    log('  ✓ offline planner builds a world with no /api');
    return ms;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const host = await startStaticHost();
  try {
    const health = await fetch(`${host.url}/api/health`);
    check(health.status === 404, 'the static host must not serve /api');
    const chromiumMs = await runBrowser('Chromium', () => chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] }), host);
    const firefoxMs = await runBrowser('Firefox', () => firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } }), host);
    log(`\nhosted e2e passed (own-key turn: Chromium ${chromiumMs} ms, Firefox ${firefoxMs} ms)`);
  } finally {
    await host.close();
  }
}

main().catch((e: unknown) => {
  console.error(`hosted e2e FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
