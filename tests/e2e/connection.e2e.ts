/**
 * AI connection end-to-end check that costs nothing: the REAL bridge HTTP
 * handler (pairing, bearer tokens, Origin allowlist, CORS + Private Network
 * Access preflight, size limits, queue, cache, response validation) runs
 * in-process with a scripted text backend instead of the Codex / Claude Code
 * CLIs, so no subscription quota is spent.
 *
 *   npm run build && npm run e2e:connection
 *
 * Runs in Chromium, then Firefox (one browser at a time), against the
 * production server in offline mode:
 *
 * 1. Pairing with the printed code in Settings → AI connection; badges show
 *    Codex ready and Claude Code not signed in; the token is kept in
 *    sessionStorage only. A whole turn then runs through the bridge using
 *    emulated tool calls (strict `input_json` form, as Codex sends them),
 *    the world is verified and the vision critic is consulted. The browser
 *    really sent a CORS preflight from the studio origin.
 * 2. Deep link pairing (token scrubbed from the address bar) while no CLI is
 *    signed in: the composer shows the connection as unavailable and the turn
 *    is built by the offline planner with a visible notice.
 * 3. Failures mid-session: a subscription rate limit, then the bridge
 *    stopping. Each turn still finishes with the offline planner and a
 *    notice that says what to do; after the outage the status badge shows
 *    the bridge offline. No blank world, no stuck spinner.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, firefox, type Browser, type Page } from 'playwright';
import { PROMPT_EXAMPLES, type BridgeBackendStatus, type TextBackend, type TextCompletionRequest, type TextCompletionResult } from '@aether/agent';
import { BridgeError } from '../../apps/bridge/src/errors';
import { Pairing } from '../../apps/bridge/src/pairing';
import { createBridgeHandler } from '../../apps/bridge/src/server';
import { CHROME_ARGS, FIREFOX_PREFS, findChrome, findFirefox, startServer, type TestServer, SKIP_FIRST_RUN } from './support/env';

const TURN_TIMEOUT_MS = 120_000;

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
// Fake bridge: the real handler, scripted backends, a request log.
// ---------------------------------------------------------------------------

type FakeMode = 'ok' | 'rate_limited';

interface FakeBridge {
  url: string;
  pairing: Pairing;
  calls: Array<{ backend: string; role: string; model?: string; effort?: string; images: number }>;
  requests: Array<{ method: string; path: string; origin: string | undefined; pna: boolean }>;
  set(opts: { loggedIn?: boolean; mode?: FakeMode }): void;
  close(): Promise<void>;
}

/** Scripted reply: patches on the first planner call of a run, then finish; a fixed verdict for the critic. */
function scripted(backend: string, strict: boolean, state: { mode: FakeMode }, calls: FakeBridge['calls']): TextBackend {
  const example = PROMPT_EXAMPLES[0];
  if (!example) throw new Error('no prompt example');
  return {
    name: backend,
    strictSchema: strict,
    async complete(req: TextCompletionRequest): Promise<TextCompletionResult> {
      calls.push({ backend, role: req.role, ...(req.model ? { model: req.model } : {}), ...(req.effort ? { effort: req.effort } : {}), images: req.images.length });
      if (state.mode === 'rate_limited') throw new BridgeError('rate_limited', `${backend} reports that your subscription's usage limit is reached. Try again later.`, { retryAfterSec: 60 });
      if (req.role === 'critic') {
        const verdict = { scores: { composition: 8, materials: 8, lighting: 8, scale: 9, detail: 7, coherence: 9 }, summary: 'Scripted critic: a tidy, readable scene.' };
        return { text: JSON.stringify({ final_message: JSON.stringify(verdict) }) };
      }
      const call = req.prompt.includes('<tool_result')
        ? { name: 'finish', input: { message: 'Built a domino run that rings a bell.' } }
        : { name: 'apply_patches', input: { patches: example.patches, message: example.message } };
      const tc = strict ? { name: call.name, input_json: JSON.stringify(call.input) } : { name: call.name, input: call.input };
      return { text: JSON.stringify({ thoughts: 'Scripted plan.', tool_calls: [tc], final_message: '' }), usage: { inputTokens: req.prompt.length, outputTokens: 40 } };
    },
  };
}

async function startFakeBridge(studioOrigin: string): Promise<FakeBridge> {
  const calls: FakeBridge['calls'] = [];
  const requests: FakeBridge['requests'] = [];
  const state = { mode: 'ok' as FakeMode, loggedIn: true };
  const pairing = new Pairing();
  let port = 0;
  const models = (id: 'codex' | 'claude-code'): BridgeBackendStatus['models'] =>
    id === 'codex' ? [{ id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol', efforts: ['low', 'medium', 'high'], vision: true }] : [{ id: 'haiku', label: 'Haiku (fastest)', efforts: ['low', 'medium', 'high'], vision: true }];
  const handler = createBridgeHandler({
    config: { origins: [studioOrigin], maxBodyBytes: 16 * 1024 * 1024, maxWaiting: 4 },
    port: () => port,
    pairing,
    backends: { codex: scripted('Codex', true, state, calls), 'claude-code': scripted('Claude Code', false, state, calls) },
    status: async () => [
      { id: 'codex', label: 'Codex', installed: true, loggedIn: state.loggedIn, detail: state.loggedIn ? 'Logged in using ChatGPT' : 'Not logged in — run "codex login"', models: models('codex'), defaultModel: 'gpt-6.1-sol' },
      { id: 'claude-code', label: 'Claude Code', installed: true, loggedIn: false, detail: 'Not logged in — run "claude" once and sign in', models: models('claude-code'), defaultModel: 'haiku' },
    ],
  });
  const server: Server = createServer((req, res) => {
    requests.push({ method: req.method ?? '', path: (req.url ?? '').split('?')[0] ?? '', origin: typeof req.headers.origin === 'string' ? req.headers.origin : undefined, pna: req.headers['access-control-request-private-network'] === 'true' });
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    pairing,
    calls,
    requests,
    set: (o) => {
      if (o.loggedIn !== undefined) state.loggedIn = o.loggedIn;
      if (o.mode !== undefined) state.mode = o.mode;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
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
      events: events.map((e) => (e.type === 'verify' ? `verify(${e.passed ? 'pass' : 'fail'})` : e.type === 'notice' || e.type === 'error' ? `${e.type}(${e.text.slice(0, 200)})` : e.type === 'quality' ? `quality(${e.score},${e.source})` : e.type)),
      via: done && done.type === 'done' ? (done.via ?? null) : null,
      head: a.history.head,
      entities: Object.keys(a.history.current.entities).length,
    };
  });
}

async function picker(page: Page): Promise<{ kind: string | null; status: string | null; bridge: string | null; label: string }> {
  const el = page.getByTestId('model-picker');
  return { kind: await el.getAttribute('data-ai-kind'), status: await el.getAttribute('data-ai-status'), bridge: await el.getAttribute('data-bridge-state'), label: (await el.innerText()).trim() };
}

async function openEditor(browser: Browser, url: string, prefs: Record<string, unknown>): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript({ content: SKIP_FIRST_RUN });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log(`  [pageerror] ${e.message}`));
  await page.addInitScript((p) => {
    try {
      localStorage.setItem('aether.ai.prefs.v1', JSON.stringify(p));
    } catch {
      /* storage blocked: the assertions below will fail */
    }
  }, prefs);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await waitFor('the editor', 90_000, async () => {
    const s = await turnState(page);
    return s && s.entities > 0 ? s : null;
  });
  return { page, close: () => ctx.close() };
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
  // No named helper functions inside evaluate: the TS loader would inject a `__name` call the page lacks.
  return page.evaluate(() => {
    const out = { session: '', local: '' };
    for (let i = 0; i < sessionStorage.length; i++) out.session += `${sessionStorage.key(i) ?? ''}=${sessionStorage.getItem(sessionStorage.key(i) ?? '') ?? ''}\n`;
    for (let i = 0; i < localStorage.length; i++) out.local += `${localStorage.key(i) ?? ''}=${localStorage.getItem(localStorage.key(i) ?? '') ?? ''}\n`;
    return out;
  });
}

const PREFS = { mode: 'bridge', backend: 'codex', codexModel: 'gpt-6.1-sol', claudeModel: 'haiku', effort: 'low', refine: 1 };

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

async function pairedTurn(browser: Browser, server: TestServer, bridge: FakeBridge): Promise<number> {
  bridge.set({ loggedIn: true, mode: 'ok' });
  const { page, close } = await openEditor(browser, `${server.url}/?debug=1#/new`, PREFS);
  try {
    check((await picker(page)).status === 'unavailable', 'an unpaired bridge was reported as usable');
    await page.evaluate(() => window.__aether?.store.getState().openSettings('ai'));
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Bridge address').fill(bridge.url);
    await dialog.getByLabel('Pairing code').fill(bridge.pairing.currentCode);
    await dialog.getByRole('button', { name: 'Pair', exact: true }).click();
    await dialog.locator('.backend-list__row', { hasText: 'Codex' }).getByText('Ready').waitFor({ timeout: 15_000 });
    await dialog.locator('.backend-list__row', { hasText: 'Claude Code' }).getByText('Not signed in').waitFor({ timeout: 5_000 });
    await page.keyboard.press('Escape');
    await waitFor('the composer to show the bridge as ready', 10_000, async () => {
      const p = await picker(page);
      return p.kind === 'bridge' && p.status === 'ready' && p.label.includes('gpt-6.1-sol') ? p : null;
    });

    const { session, local } = await storageSnapshot(page);
    const token = /"token":"([A-Za-z0-9_-]{43})"/.exec(session)?.[1];
    check(token, 'the pairing token is not in sessionStorage');
    check(!local.includes(token), 'the pairing token leaked into localStorage');

    const t0 = performance.now();
    const turn = await sendPrompt(page, 'a domino run that knocks over a bell');
    const ms = Math.round(performance.now() - t0);
    log(`    paired turn: ${turn.status} in ${ms} ms via ${turn.via ?? '?'} — ${turn.events.join(' | ')}`);
    check(turn.status === 'done', `the bridged turn ended with ${turn.status}`);
    check(turn.via?.startsWith('Codex'), `the turn was not served by the bridge (via ${turn.via})`);
    check(!turn.events.some((e) => e.startsWith('notice(')), 'the bridged turn showed a fallback notice');
    check(turn.events.some((e) => e.startsWith('verify(')), 'the bridged turn did not verify the world');
    check(turn.events.some((e) => /^quality\(\d+,(blend|critic)\)$/.test(e)), 'the vision critic was not used for the quality review');
    const planner = bridge.calls.filter((c) => c.role === 'planner');
    const critic = bridge.calls.filter((c) => c.role === 'critic');
    check(planner.length >= 2 && planner.every((c) => c.backend === 'Codex' && c.model === 'gpt-6.1-sol' && c.effort === 'low'), `unexpected planner calls ${JSON.stringify(planner)}`);
    check(critic.length >= 1 && (critic[0]?.images ?? 0) >= 1, 'the critic did not receive rendered views');
    const pre = bridge.requests.filter((r) => r.method === 'OPTIONS' && r.path === '/v1/complete');
    check(pre.length > 0 && pre.every((r) => r.origin === server.url), 'the browser did not send a CORS preflight from the studio origin');
    log(`    preflights: ${pre.length} (private-network header ${pre.some((r) => r.pna) ? 'sent' : 'not sent by this browser'})`);
    return ms;
  } finally {
    await close();
  }
}

async function notSignedIn(browser: Browser, server: TestServer, bridge: FakeBridge): Promise<void> {
  bridge.set({ loggedIn: false, mode: 'ok' });
  const before = bridge.calls.length;
  const token = bridge.pairing.issue();
  const { page, close } = await openEditor(browser, `${server.url}/?debug=1&bridge=${encodeURIComponent(bridge.url)}#/new&aether-bridge=${token}`, PREFS);
  try {
    check(!(await page.evaluate(() => location.href)).includes('aether-bridge='), 'the pairing token stayed in the address bar');
    check(!(await page.evaluate(() => location.search.includes('bridge='))), 'the bridge address stayed in the address bar');
    await waitFor('the composer to show "not signed in"', 15_000, async () => {
      const p = await picker(page);
      return p.bridge === 'not_logged_in' && p.status === 'unavailable' ? p : null;
    });
    const turn = await sendPrompt(page, 'a cozy forest camp with a campfire');
    log(`    not signed in: ${turn.status} via ${turn.via ?? '?'} — ${turn.events.filter((e) => e.startsWith('notice(')).join(' | ')}`);
    check(turn.status === 'done' && turn.via === 'Offline planner', `expected the offline planner, got ${turn.via}`);
    check(turn.events.some((e) => e.startsWith('notice(') && /not signed in/i.test(e)), 'no "not signed in" notice');
    check(bridge.calls.length === before, 'the bridge was called although no backend is signed in');
  } finally {
    await close();
  }
}

async function failuresMidSession(browser: Browser, server: TestServer, bridge: FakeBridge): Promise<void> {
  bridge.set({ loggedIn: true, mode: 'ok' });
  const token = bridge.pairing.issue();
  const { page, close } = await openEditor(browser, `${server.url}/?debug=1&bridge=${encodeURIComponent(bridge.url)}#/new&aether-bridge=${token}`, PREFS);
  try {
    await waitFor('the bridge to be ready', 15_000, async () => ((await picker(page)).status === 'ready' ? true : null));
    bridge.set({ mode: 'rate_limited' });
    const limited = await sendPrompt(page, 'an asteroid field in space');
    log(`    rate limited: ${limited.status} via ${limited.via ?? '?'}`);
    check(limited.status === 'done' && limited.via === 'Offline planner', `rate limit: expected the offline planner, got ${limited.via}`);
    check(limited.events.some((e) => e.startsWith('notice(') && /usage limit/i.test(e)), 'no usage-limit notice');
    check(limited.entities > 0, 'the rate-limited turn left an empty world');

    await bridge.close();
    // Still believed ready: the next send discovers the outage, falls back, and the badge follows.
    const offline = await sendPrompt(page, 'a bowling alley with ten pins');
    log(`    bridge stopped: ${offline.status} via ${offline.via ?? '?'}`);
    check(offline.status === 'done' && offline.via === 'Offline planner', `bridge stopped: expected the offline planner, got ${offline.via}`);
    check(offline.events.some((e) => e.startsWith('notice(') && /npm run bridge/.test(e)), 'no "start the bridge" notice');
    await waitFor('the badge to show the bridge offline', 15_000, async () => {
      const p = await picker(page);
      return p.bridge === 'offline' && p.status === 'unavailable' ? p : null;
    });
  } finally {
    await close();
  }
}

async function runBrowser(name: string, launch: () => Promise<Browser>, server: TestServer): Promise<number> {
  log(`\n${name}`);
  const bridge = await startFakeBridge(server.url);
  let browser: Browser | null = null;
  try {
    browser = await launch();
    const ms = await pairedTurn(browser, server, bridge);
    log('  ✓ pairing code, badges, session-only token, bridged turn with critic, CORS preflight');
    await notSignedIn(browser, server, bridge);
    log('  ✓ deep link scrubbed, not signed in → offline planner with notice');
    await failuresMidSession(browser, server, bridge);
    log('  ✓ rate limit and bridge outage → offline planner, badge shows offline');
    return ms;
  } finally {
    await browser?.close().catch(() => undefined);
    await bridge.close().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  let server: TestServer | null = null;
  try {
    server = await startServer((l) => log(l));
    const chromiumMs = await runBrowser('Chromium', () => chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] }), server);
    const firefoxMs = await runBrowser('Firefox', () => firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } }), server);
    log(`\nconnection e2e passed (bridged turn: Chromium ${chromiumMs} ms, Firefox ${firefoxMs} ms)`);
  } finally {
    await server?.stop().catch(() => undefined);
  }
}

main().catch((e: unknown) => {
  console.error(`connection e2e FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
