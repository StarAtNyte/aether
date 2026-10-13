/**
 * Local AI end-to-end check that costs nothing: the studio talks to
 * `/api/local/*` exactly as it does on a developer's machine, but the routes
 * are answered by Playwright with scripted replies (no CLI runs, no quota).
 *
 *   npm run build && npm run e2e:local
 *
 * Runs in Chromium, then Firefox (one browser at a time):
 *
 * 1. Automatic mode picks "Codex on this computer" first; the deep-build
 *    toggle is shown. A turn whose planner requests a new asset runs a deep
 *    build: the job is queued with the project's budget, its progress streams
 *    into the chat over server-sent events, the returned generator is
 *    validated and placed, every quick call carries the project's session
 *    key, and the chat's last line names the model that answered.
 * 2. Settings → AI connection: "Sign in with ChatGPT" starts the CLI's
 *    device sign-in and shows its one-time code; Cancel stops it.
 */
import { chromium, firefox, type Browser, type Page, type Route } from 'playwright';
import { GENERATOR_EXAMPLES } from '@aether/procgen';
import { CHROME_ARGS, FIREFOX_PREFS, findChrome, findFirefox, startServer, type TestServer } from './support/env';

const TURN_TIMEOUT_MS = 120_000;
const JOB_ID = '7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a';
const LANTERN = { ...(GENERATOR_EXAMPLES[0]?.def ?? (() => { throw new Error('no example'); })()), id: 'garden-lantern' };

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

const backend = (id: 'codex' | 'claude-code', loggedIn: boolean) => ({
  id,
  label: id === 'codex' ? 'Codex' : 'Claude Code',
  installed: true,
  loggedIn,
  detail: loggedIn ? 'Logged in using ChatGPT' : 'Not logged in',
  ...(loggedIn ? { account: id === 'codex' ? 'ChatGPT' : 'you@example.com · Max' } : {}),
  models: id === 'codex' ? [{ id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol', efforts: ['low', 'medium', 'high'], vision: true }] : [{ id: 'sonnet', label: 'Sonnet', vision: true }],
  defaultModel: id === 'codex' ? 'gpt-6.1-sol' : 'sonnet',
  busy: 0,
});

interface LocalFake {
  codexSignedIn: boolean;
  completes: Array<{ role: string; backend: string; model?: string; session?: string }>;
  jobs: unknown[];
  logins: string[];
}

const json = (route: Route, body: unknown, status = 200): Promise<void> => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const job = (status: string, events: number, result?: unknown) => ({
  id: JOB_ID,
  kind: 'asset',
  backend: 'codex',
  accountId: 'default',
  model: 'gpt-6.1-sol',
  effort: 'low',
  spec: { id: 'garden-lantern', description: 'a stone garden lantern' },
  budget: { turns: 3, minutes: 9 },
  status,
  createdAt: Date.now(),
  events,
  ...(result ? { result } : {}),
});

/** Answer /api/health and /api/local/* for one page. */
async function installLocalAi(page: Page, fake: LocalFake): Promise<void> {
  await page.route('**/api/health', async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as Record<string, unknown>;
    await json(route, { ...body, local: true });
  });
  await page.route('**/api/local/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path === '/api/local/status') {
      return json(route, { ok: true, name: 'aether-local', version: '1', backends: [backend('codex', fake.codexSignedIn), backend('claude-code', false)], account: null, jobs: 0, login: null });
    }
    if (path === '/api/local/complete') {
      const body = req.postDataJSON() as { backend: string; model?: string; request: { role: string; session?: string; messages: Array<{ content: unknown }> } };
      fake.completes.push({ role: body.request.role, backend: body.backend, ...(body.model ? { model: body.model } : {}), ...(body.request.session ? { session: body.request.session } : {}) });
      const planner = fake.completes.filter((c) => c.role === 'planner').length;
      const use = (name: string, input: unknown) => ({ content: [{ type: 'tool_use', id: `t${planner}`, name, input }], stopReason: 'tool_use', usage: { inputTokens: 1200, outputTokens: 80 }, model: 'gpt-6.1-sol' });
      if (planner === 1) return json(route, use('request_asset', { id: 'garden-lantern', description: 'a stone garden lantern with a glowing chamber', params_hint: 'height, lit' }));
      if (planner === 2) {
        return json(route, use('apply_patches', { message: 'Place the lantern', patches: [{ op: 'add', entity: { id: 'lantern', name: 'Lantern', transform: { position: [0, 0, 0] }, shape: { kind: 'procedural', generator: 'garden-lantern', params: {} }, physics: { body: 'static' } } }] }));
      }
      return json(route, use('finish', { message: 'Placed a garden lantern.' }));
    }
    if (path === '/api/local/jobs' && req.method() === 'POST') {
      fake.jobs.push(req.postDataJSON());
      return json(route, job('queued', 1));
    }
    if (path === `/api/local/jobs/${JOB_ID}/events`) {
      const ev = (seq: number, phase: string, message: string): string => `id: ${seq}\nevent: progress\ndata: ${JSON.stringify({ seq, at: seq, phase, message })}\n\n`;
      const end = job('done', 5, { def: LANTERN, turns: 2, checkerPassed: true, usage: { inputTokens: 5000, outputTokens: 900 }, model: 'gpt-6.1-sol' });
      const body = ev(1, 'queued', 'Queued') + ev(2, 'turn', 'Starting the coding agent…') + ev(3, 'write', 'Writing generator.json…') + ev(4, 'check', 'Checks passed') + ev(5, 'done', 'Finished') + `event: end\ndata: ${JSON.stringify(end)}\n\n`;
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body });
    }
    if (path === `/api/local/jobs/${JOB_ID}`) return json(route, job('done', 5));
    if (path === '/api/local/login' && req.method() === 'POST') {
      fake.logins.push((req.postDataJSON() as { backend: string }).backend);
      return json(route, { backend: 'codex', running: true, url: 'https://auth.openai.com/codex/device', code: 'ABCD-12345', output: '', startedAt: 1 });
    }
    if (path === '/api/local/login') return json(route, { login: { backend: 'codex', running: true, url: 'https://auth.openai.com/codex/device', code: 'ABCD-12345', output: '', startedAt: 1 } });
    if (path === '/api/local/login/cancel') return json(route, { login: { backend: 'codex', running: false, output: '', startedAt: 1, finished: { ok: false, message: 'Sign-in cancelled.' } } });
    if (path === '/api/local/accounts') return json(route, { items: [{ id: 'default', label: 'This computer', active: true, signedIn: fake.codexSignedIn, detail: 'Logged in using ChatGPT' }], activeId: 'default', jobs: 0 });
    return json(route, { error: { code: 'not_found', message: 'Unknown endpoint.' } }, 404);
  });
}

interface TurnState {
  busy: boolean;
  status: string | null;
  events: string[];
  models: string[];
  via: string | null;
  head: number;
  generators: string[];
  entities: number;
  projectId: string | null;
}

function turnState(page: Page): Promise<TurnState | null> {
  return page.evaluate((): TurnState | null => {
    const a = window.__aether;
    if (!a) return null;
    const st = a.store.getState();
    const last = st.chat[st.chat.length - 1];
    const events = last && last.role === 'assistant' ? last.events : [];
    const done = events.find((e) => e.type === 'done');
    const hash = /#\/p\/([a-z0-9]+)/.exec(location.hash);
    return {
      busy: st.agentBusy,
      status: last && last.role === 'assistant' ? last.status : null,
      events: events.map((e) => (e.type === 'status' ? `status(${e.text.slice(0, 120)})` : e.type === 'generator' ? `generator(${e.id},${e.ok ? 'ok' : `bad:${(e.error ?? '').slice(0, 200)}`})` : e.type === 'notice' || e.type === 'error' ? `${e.type}(${e.text.slice(0, 200)})` : e.type)),
      models: done && done.type === 'done' ? (done.models ?? []) : [],
      via: done && done.type === 'done' ? (done.via ?? null) : null,
      head: a.history.head,
      generators: Object.keys(a.history.current.generators),
      entities: Object.keys(a.history.current.entities).length,
      projectId: hash?.[1] ?? null,
    };
  });
}

async function openEditor(browser: Browser, url: string, prefs: Record<string, unknown>, fake: LocalFake): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log(`  [pageerror] ${e.message}`));
  await installLocalAi(page, fake);
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

async function deepBuildTurn(browser: Browser, server: TestServer): Promise<number> {
  const fake: LocalFake = { codexSignedIn: true, completes: [], jobs: [], logins: [] };
  const { page, close } = await openEditor(browser, `${server.url}/?debug=1#/new`, { mode: 'auto', effort: 'low', refine: 0, deep: true, deepTurns: 3 }, fake);
  try {
    const picker = page.getByTestId('model-picker');
    await waitFor('local AI in the model picker', 20_000, async () => (await picker.getAttribute('data-ai-kind')) === 'local' && (await picker.getAttribute('data-ai-status')) === 'ready');
    check(/Codex on this computer/.test(await picker.innerText()), `the picker label is "${await picker.innerText()}"`);
    check(await page.getByTestId('deep-build').isVisible(), 'the deep-build toggle is not shown');
    const before = (await turnState(page)) as TurnState;
    // Progress lines are live (dropped from the transcript when the turn ends): record every one as it arrives.
    await page.evaluate(() => {
      const a = window.__aether;
      if (!a) return;
      const seen: string[] = [];
      (window as unknown as { __progress: string[] }).__progress = seen;
      a.store.subscribe((st) => {
        const last = st.chat[st.chat.length - 1];
        if (!last || last.role !== 'assistant') return;
        for (const e of last.events) if (e.type === 'status' && !seen.includes(e.text)) seen.push(e.text);
      });
    });
    const t0 = Date.now();
    const input = page.getByLabel('Prompt', { exact: true });
    await input.click();
    await input.fill('a stone garden lantern in a moss garden');
    await input.press('Enter');
    const s = await waitFor('the deep-build turn', TURN_TIMEOUT_MS, async () => {
      const st = await turnState(page);
      return st && !st.busy && st.status !== null && st.status !== 'streaming' && st.head !== before.head ? st : null;
    });
    const progress = await page.evaluate(() => (window as unknown as { __progress?: string[] }).__progress ?? []);
    const ms = Date.now() - t0;
    check(s.status === 'done', `the turn ended with ${s.status}: ${s.events.join(' | ')}`);
    check(s.via?.includes('Codex on this computer'), `the turn was served by ${s.via}`);
    check(fake.jobs.length === 1, `expected one deep build, got ${fake.jobs.length}`);
    const jobReq = fake.jobs[0] as { kind: string; backend: string; model?: string; spec: { id: string }; budget: { turns: number; minutes: number } };
    check(jobReq.kind === 'asset' && jobReq.backend === 'codex' && jobReq.model === 'gpt-6.1-sol' && jobReq.spec.id === 'garden-lantern', `unexpected job ${JSON.stringify(jobReq)}`);
    check(jobReq.budget.turns === 3, `the budget was not the project's (${JSON.stringify(jobReq.budget)})`);
    for (const line of ['Deep build of "garden-lantern" (up to 3 rounds, 9 min)…', 'Starting the coding agent…', 'Writing generator.json…', 'Checks passed']) {
      check(progress.includes(line), `deep-build progress "${line}" missing: ${progress.join(' | ')}`);
    }
    check(s.events.some((e) => /^notice\(Deep build: 2 rounds, checks passed/.test(e)), `no deep-build summary in the transcript: ${s.events.join(' | ')}`);
    check(s.events.includes('generator(garden-lantern,ok)'), `the built generator was not accepted: ${s.events.join(' | ')}`);
    check(s.generators.includes('garden-lantern'), 'the generator is not in the world');
    check(!fake.completes.some((c) => c.role === 'coder'), 'the single-shot coder was called although the deep build succeeded');
    const planner = fake.completes.filter((c) => c.role === 'planner');
    check(planner.length >= 3 && planner.every((c) => c.backend === 'codex' && c.model === 'gpt-6.1-sol'), `unexpected planner calls ${JSON.stringify(planner)}`);
    check(s.projectId && planner.every((c) => c.session === `p-${s.projectId}`), `the session key was not sent: ${JSON.stringify(planner.map((c) => c.session))}`);
    check(s.models.includes('gpt-6.1-sol'), `the done line does not name the model (${JSON.stringify(s.models)})`);
    const doneText = await page.locator('.ev--done').last().innerText();
    check(/answered by gpt-6\.1-sol/.test(doneText) && /tokens/.test(doneText), `the done line reads "${doneText}"`);
    return ms;
  } finally {
    await close();
  }
}

async function signIn(browser: Browser, server: TestServer): Promise<void> {
  const fake: LocalFake = { codexSignedIn: false, completes: [], jobs: [], logins: [] };
  const { page, close } = await openEditor(browser, `${server.url}/?debug=1#/new`, { mode: 'local', refine: 0 }, fake);
  try {
    await waitFor('the Connect Codex card', 20_000, async () => page.getByTestId('connect-codex').isVisible());
    await page.evaluate(() => window.__aether?.store.getState().openSettings('ai'));
    const button = page.getByTestId('local-signin-codex');
    await button.waitFor({ state: 'visible', timeout: 20_000 });
    check((await button.innerText()).includes('Sign in with ChatGPT'), `the sign-in button reads "${await button.innerText()}"`);
    await button.click();
    const flow = page.getByTestId('login-flow');
    await flow.waitFor({ state: 'visible', timeout: 10_000 });
    await waitFor('the one-time code', 10_000, async () => (await flow.innerText()).includes('ABCD-12345'));
    check(fake.logins.join(',') === 'codex', `unexpected sign-in requests ${fake.logins.join(',')}`);
    const link = flow.getByRole('link', { name: /Open sign-in page/ });
    check((await link.getAttribute('href')) === 'https://auth.openai.com/codex/device', 'the sign-in link is wrong');
    check((await link.getAttribute('rel'))?.includes('noopener'), 'the sign-in link lacks rel=noopener');
    await flow.getByRole('button', { name: 'Cancel' }).click();
    await waitFor('the cancelled sign-in', 10_000, async () => (await flow.innerText()).includes('Sign-in cancelled.'));
  } finally {
    await close();
  }
}

async function runBrowser(name: string, launch: () => Promise<Browser>, server: TestServer): Promise<number> {
  log(`\n${name}`);
  let browser: Browser | null = null;
  try {
    browser = await launch();
    const ms = await deepBuildTurn(browser, server);
    log(`  ✓ automatic → Codex on this computer; deep build streamed, validated and placed (${ms} ms); session key and model shown`);
    await signIn(browser, server);
    log('  ✓ Connect Codex card; Sign in with ChatGPT shows the device code; cancel');
    return ms;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  let server: TestServer | null = null;
  try {
    server = await startServer((l) => log(l));
    const chromiumMs = await runBrowser('Chromium', () => chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] }), server);
    const firefoxMs = await runBrowser('Firefox', () => firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } }), server);
    log(`\nlocal AI e2e passed (deep-build turn: Chromium ${chromiumMs} ms, Firefox ${firefoxMs} ms)`);
  } finally {
    await server?.stop().catch(() => undefined);
  }
}

main().catch((e: unknown) => {
  console.error(`local AI e2e FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
