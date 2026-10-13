/**
 * Real end-to-end check of the local bridge (opt-in; uses YOUR Codex /
 * Claude Code subscription, one short prompt per backend):
 *
 *   npm run build && npm run e2e:bridge [-- --backend=codex|claude-code|both] [--firefox]
 *       [--codex-model=<id>] [--claude-model=<alias>]
 *
 * Starts the production server (offline planner, static studio) and an
 * in-process bridge allowing only that studio origin, pairs the browser via
 * the deep link, selects the backend in the AI preferences and sends one
 * prompt. Passes when the turn finishes through the bridge (no fallback to
 * the offline planner), the world changed, and verification ran. Prints the
 * latency. One browser at a time; everything is shut down at the end.
 */
import { chromium, firefox, type Browser, type Page } from 'playwright';
import { parseBridgeConfig } from '../../apps/bridge/src/config';
import { startBridge, type RunningBridge } from '../../apps/bridge/src/start';
import { CHROME_ARGS, FIREFOX_PREFS, findChrome, findFirefox, startServer, type TestServer } from './support/env';

type Backend = 'codex' | 'claude-code';

const AGENT_TIMEOUT_MS = 8 * 60_000;
const PROMPT = 'a small lighthouse on a rocky islet at sunset';

const argv = process.argv.slice(2);
const arg = (name: string): string | undefined => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const which = arg('backend') ?? 'both';
const BACKENDS: Backend[] = which === 'both' ? ['codex', 'claude-code'] : which === 'codex' || which === 'claude-code' ? [which] : [];
const FIREFOX = argv.includes('--firefox');
const MODELS: Record<Backend, string> = { codex: arg('codex-model') ?? 'gpt-6.1-sol', 'claude-code': arg('claude-model') ?? 'haiku' };

function log(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function waitFor<T>(what: string, timeoutMs: number, probe: () => Promise<T | null | false>): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await probe();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

interface TurnState {
  busy: boolean;
  status: string | null;
  events: string[];
  via: string | null;
  head: number;
  entities: number;
  bridge: string;
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
      events: events.map((e) => (e.type === 'verify' ? `verify(${e.passed ? 'pass' : 'fail'})` : e.type === 'notice' || e.type === 'error' ? `${e.type}(${e.text.slice(0, 160)})` : e.type === 'quality' ? `quality(${e.score})` : e.type)),
      via: done && done.type === 'done' ? (done.via ?? null) : null,
      head: a.history.head,
      entities: Object.keys(a.history.current.entities).length,
      bridge: document.querySelector('[data-ai-status]')?.getAttribute('data-ai-status') ?? 'unknown',
    };
  });
}

async function runBackend(browser: Browser, server: TestServer, bridge: RunningBridge, backend: Backend): Promise<{ ms: number; via: string | null; events: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  try {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => log(`  [pageerror] ${e.message}`));
    // Preferences are plain localStorage (validated on read); the token travels only in the URL fragment.
    await page.addInitScript(
      ([b, model]) => {
        const prefs = { mode: 'bridge', backend: b, codexModel: b === 'codex' ? model : 'gpt-5.6-sol', claudeModel: b === 'claude-code' ? model : 'haiku', effort: 'low', refine: 0 };
        try {
          localStorage.setItem('aether.ai.prefs.v1', JSON.stringify(prefs));
        } catch {
          /* storage blocked: the test will fail on the fallback check */
        }
      },
      [backend, MODELS[backend]] as const,
    );
    const token = bridge.pairing.issue();
    await page.goto(`${server.url}/?debug=1&bridge=${encodeURIComponent(bridge.url)}#/new&aether-bridge=${token}`, { waitUntil: 'domcontentloaded' });
    await waitFor('the editor', 90_000, async () => {
      const s = await turnState(page);
      return s && s.entities > 0 ? s : null;
    });
    check(!(await page.evaluate(() => location.href)).includes('aether-bridge='), 'the pairing token stayed in the address bar');
    const before = (await turnState(page)) as TurnState;
    const input = page.getByLabel('Prompt', { exact: true });
    await input.click();
    await input.fill(PROMPT);
    const t0 = performance.now();
    await input.press('Enter');
    const after = await waitFor(`the ${backend} turn`, AGENT_TIMEOUT_MS, async () => {
      const s = await turnState(page);
      return s && !s.busy && s.status !== null && s.status !== 'streaming' && s.head !== before.head ? s : null;
    });
    const ms = Math.round(performance.now() - t0);
    log(`  ${backend}: ${after.status} in ${(ms / 1000).toFixed(1)} s via ${after.via ?? '?'} — ${after.events.join(' | ')}`);
    check(after.status === 'done', `${backend} turn ended with ${after.status}`);
    check(!after.events.some((e) => /offline planner/i.test(e)), `${backend} fell back to the offline planner`);
    check(after.via !== null && !/offline/i.test(after.via), `${backend} turn was not served by the bridge (via ${after.via})`);
    check(after.events.some((e) => e.startsWith('verify(')), `${backend} turn did not verify the world`);
    check(after.entities !== before.entities, `${backend} turn did not change the world`);
    return { ms, via: after.via, events: after.events };
  } finally {
    await ctx.close();
  }
}

function check(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

async function main(): Promise<void> {
  if (BACKENDS.length === 0) throw new Error('--backend must be codex, claude-code or both');
  let server: TestServer | null = null;
  let bridge: RunningBridge | null = null;
  let browser: Browser | null = null;
  try {
    server = await startServer((l) => log(l));
    const config = parseBridgeConfig(['--port', '0', '--studio', server.url, '--timeout', '300'], {});
    bridge = await startBridge(config, { logger: { info: () => undefined, warn: (m) => log(`  [bridge] ${m}`) } });
    log(`server ${server.url}, bridge ${bridge.url}, ${FIREFOX ? 'Firefox' : 'Chromium'}`);
    browser = FIREFOX
      ? await firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } })
      : await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
    const results: Array<{ backend: Backend; ms: number; via: string | null }> = [];
    for (const backend of BACKENDS) results.push({ backend, ...(await runBackend(browser, server, bridge, backend)) });
    log('\nbridge e2e passed:');
    for (const r of results) log(`  ${r.backend.padEnd(12)} ${(r.ms / 1000).toFixed(1).padStart(6)} s  (${r.via ?? ''})`);
  } finally {
    await browser?.close().catch(() => undefined);
    await bridge?.close().catch(() => undefined);
    await server?.stop().catch(() => undefined);
  }
}

main().catch((e: unknown) => {
  console.error(`bridge e2e FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
