import { MODEL_ID_RE, type BridgeBackendStatus } from '@aether/agent';
import { describe, expect, it } from 'vitest';
import { AiConnection, effectiveBridgeChoice, parseServerHealth } from '../src/ai/connection';
import { extractBridgeLink } from '../src/ai/deepLink';
import { fallbackText, hostedBridgeNote, isLocalOrigin } from '../src/ai/messages';
import { DEFAULT_AI_PREFS, loadAiPrefs, parsePrefs, PREF_MODEL_ID_RE, saveAiPrefs, type AiPrefs } from '../src/ai/prefs';
import { loadBridgeSession, loadByokKeys, saveBridgeSession, validateBridgeLink, type SessionStore } from '../src/ai/session';
import { reviveChat } from '../src/lib/chat';
import type { StorageLike } from '../src/lib/storage';

const TOKEN = 'T'.repeat(43);

function mem(): StorageLike & SessionStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const STATUS = (loggedIn: boolean) => ({
  ok: true,
  name: 'aether-bridge',
  version: '0.1.0',
  backends: [
    { id: 'codex', label: 'Codex', installed: true, loggedIn, detail: loggedIn ? 'Logged in using ChatGPT' : 'Not logged in', models: [{ id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol', vision: true }], defaultModel: 'gpt-6.1-sol', busy: 0 },
    { id: 'claude-code', label: 'Claude Code', installed: false, loggedIn: false, detail: 'not found', models: [], busy: 0 },
  ],
});

/** Fake fetch routing by URL. */
function router(routes: Record<string, (init: RequestInit) => Response | Promise<Response>>): { fetch: typeof fetch; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  return {
    calls,
    fetch: (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, init });
      for (const [k, h] of Object.entries(routes)) if (url.endsWith(k)) return h(init);
      throw new TypeError('fetch failed');
    }) as typeof fetch,
  };
}

const prefs = (p: Partial<AiPrefs>): AiPrefs => ({ ...DEFAULT_AI_PREFS, ...p });

describe('AI preferences', () => {
  it('validate field by field and fall back to defaults', () => {
    expect(parsePrefs({ mode: 'bridge', codexModel: 'gpt; rm -rf', refine: 9, effort: 'max', extra: 1 })).toEqual({ ...DEFAULT_AI_PREFS, mode: 'bridge' });
    expect(parsePrefs('garbage')).toEqual(DEFAULT_AI_PREFS);
    expect(PREF_MODEL_ID_RE.source).toBe(MODEL_ID_RE.source);
  });
  it('are remembered per project with a global default', () => {
    const s = mem();
    saveAiPrefs(s, prefs({ mode: 'offline', refine: 2 }), 'abcdefgh1');
    expect(loadAiPrefs(s, 'abcdefgh1')).toMatchObject({ mode: 'offline', refine: 2 });
    saveAiPrefs(s, prefs({ mode: 'bridge' }), 'zzzzzzzz2');
    expect(loadAiPrefs(s, 'abcdefgh1').mode).toBe('offline');
    expect(loadAiPrefs(s, 'newproject3').mode).toBe('bridge');
    expect(loadAiPrefs(s, '../evil').mode).toBe('bridge');
  });
});

describe('session secrets and deep links', () => {
  it('stores the pairing in session storage only when valid', () => {
    const s = mem();
    saveBridgeSession(s, { url: 'http://127.0.0.1:8790', token: TOKEN });
    expect(loadBridgeSession(s)).toEqual({ url: 'http://127.0.0.1:8790', token: TOKEN });
    s.setItem('aether.bridge.v1', JSON.stringify({ url: 'https://evil.example', token: TOKEN }));
    expect(loadBridgeSession(s)).toBeNull();
    s.setItem('aether.byok.v1', JSON.stringify({ provider: 'anthropic', key: 'bad key with spaces' }));
    expect(loadByokKeys(s, null).keys).toEqual({});
  });
  it('strips the deep link from the URL and validates it', () => {
    const r = extractBridgeLink(`https://studio.example/?bridge=http%3A%2F%2F127.0.0.1%3A8790#aether-bridge=${TOKEN}`);
    expect(r.clean).toBe('/');
    expect(validateBridgeLink(r.link ?? { url: null, token: null })).toEqual({ url: 'http://127.0.0.1:8790', token: TOKEN });
    const routed = extractBridgeLink(`https://studio.example/x?a=1&bridge=http://localhost:9000#/p/abcdefgh&aether-bridge=${TOKEN}`);
    expect(routed.clean).toBe('/x?a=1#/p/abcdefgh');
    const evil = extractBridgeLink(`https://studio.example/?bridge=https://evil.example#aether-bridge=${TOKEN}`);
    expect(validateBridgeLink(evil.link ?? { url: null, token: null })).toBeNull();
    expect(extractBridgeLink('https://studio.example/#/projects')).toEqual({ link: null, clean: '/#/projects' });
  });
});

describe('AiConnection', () => {
  it('parses server health defensively', () => {
    expect(parseServerHealth({ ok: true, mode: 'live', providers: ['codex', 3], byok: true })).toEqual({ state: 'live', providers: ['codex'], byok: true, local: false });
    expect(parseServerHealth({ ok: true, mode: 'mock', providers: [], byok: false, local: true }).local).toBe(true);
    expect(parseServerHealth({ ok: true, mode: 'mock', local: 'yes' }).local).toBe(false);
    expect(parseServerHealth(null).state).toBe('offline');
  });

  it('pairs, stores the token in session storage, and resolves auto → bridge', async () => {
    const session = mem();
    const r = router({ '/v1/pair': () => json({ token: TOKEN }), '/v1/status': () => json(STATUS(true)), '/api/health': () => json({ ok: true, mode: 'mock', providers: ['mock'], byok: true }) });
    const ai = new AiConnection({ fetch: r.fetch, session });
    expect(ai.resolve(prefs({ mode: 'auto' })).kind).toBe('offline');
    expect(await ai.pair('http://127.0.0.1:8790', 'abcd-ef23')).toBeNull();
    expect(loadBridgeSession(session)?.token).toBe(TOKEN);
    expect(ai.store.getState().bridge.state).toBe('ready');
    const auto = ai.resolve(prefs({ mode: 'auto', codexModel: 'gpt-6.1-sol' }));
    expect(auto).toMatchObject({ kind: 'bridge', ready: true, label: 'Codex · gpt-6.1-sol', vision: true });
    const p = ai.createProvider(prefs({ mode: 'bridge' }));
    expect(p?.name).toBe('codex');
  });

  it('never sends a saved model the bridge catalog no longer lists (regression)', async () => {
    const r = router({ '/v1/status': () => json(STATUS(true)) });
    const ai = new AiConnection({ fetch: r.fetch, session: mem() });
    ai.adoptPairing({ url: 'http://127.0.0.1:8790', token: TOKEN });
    await ai.refreshBridge();
    const stale = prefs({ mode: 'bridge', backend: 'codex', codexModel: 'gpt-retired-1' });
    expect(ai.resolve(stale)).toMatchObject({ ready: true, label: 'Codex · gpt-6.1-sol' });
    const sent: unknown[] = [];
    const r2 = router({ '/v1/status': () => json(STATUS(true)), '/v1/complete': (init) => (sent.push(JSON.parse(String(init.body))), json({ content: [{ type: 'text', text: 'ok' }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } })) });
    const ai2 = new AiConnection({ fetch: r2.fetch, session: mem() });
    ai2.adoptPairing({ url: 'http://127.0.0.1:8790', token: TOKEN });
    await ai2.refreshBridge();
    await ai2.createProvider(stale)?.complete({ role: 'planner', system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [], maxTokens: 100 });
    expect(sent[0]).toMatchObject({ backend: 'codex', model: 'gpt-6.1-sol' });
    // A model the catalog lists is kept; an effort the model lacks falls back to low.
    const listed = { ...STATUS(true).backends[0], models: [{ id: 'gpt-6.1-sol', label: 'a', efforts: ['low', 'medium'] }, { id: 'gpt-6-luna', label: 'b', efforts: ['low', 'medium'] }] } as BridgeBackendStatus;
    expect(effectiveBridgeChoice(prefs({ backend: 'codex', codexModel: 'gpt-6-luna', effort: 'high' }), [listed])).toEqual({ backend: 'codex', model: 'gpt-6-luna', effort: 'low' });
    // No catalog yet (bridge not probed): the saved choice is sent unchanged.
    expect(effectiveBridgeChoice(prefs({ backend: 'codex', codexModel: 'gpt-x', effort: 'high' }), [])).toEqual({ backend: 'codex', model: 'gpt-x', effort: 'high' });
  });

  it('reports why a chosen connection is unusable (never silently)', async () => {
    const r = router({ '/api/health': () => json({ ok: true, mode: 'mock', byok: false }), '/v1/status': () => json(STATUS(false)) });
    const ai = new AiConnection({ fetch: r.fetch, session: mem(), webGpu: async () => ({ ok: false, reason: 'no WebGPU' }) });
    await ai.refresh();
    expect(ai.resolve(prefs({ mode: 'bridge' }))).toMatchObject({ ready: false, reason: 'the local bridge is not paired' });
    ai.adoptPairing({ url: 'http://127.0.0.1:8790', token: TOKEN });
    await ai.refreshBridge();
    expect(ai.resolve(prefs({ mode: 'bridge', backend: 'codex' }))).toMatchObject({ ready: false, reason: 'Codex is not signed in on this computer' });
    expect(ai.resolve(prefs({ mode: 'server' })).ready).toBe(false);
    expect(ai.resolve(prefs({ mode: 'byok' })).reason).toContain('no Anthropic API key');
    await ai.loadWebLlm(DEFAULT_AI_PREFS.webllmModel);
    expect(ai.store.getState().webllm).toMatchObject({ state: 'unsupported', detail: 'no WebGPU' });
    expect(ai.createProvider(prefs({ mode: 'webllm' }))).toBeNull();
  });

  it('detects a stopped bridge and a restarted one (token rejected → unpaired)', async () => {
    const session = mem();
    saveBridgeSession(session, { url: 'http://127.0.0.1:8790', token: TOKEN });
    const offline = new AiConnection({ fetch: router({}).fetch, session });
    await offline.refreshBridge();
    expect(offline.store.getState().bridge.state).toBe('offline');
    const restarted = new AiConnection({ fetch: router({ '/v1/status': () => json({ error: { code: 'unauthorized', message: 'no' } }, 401) }).fetch, session });
    await restarted.refreshBridge();
    expect(restarted.store.getState().bridge).toMatchObject({ paired: false, state: 'unpaired' });
    expect(loadBridgeSession(session)).toBeNull();
  });

  it('sends a BYO key straight to the provider, never to our server', async () => {
    const r = router({ '/api/health': () => json({ ok: true, mode: 'mock', byok: false }), '/v1/responses': () => json({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }], usage: { input_tokens: 7, output_tokens: 3 } }) });
    const session = mem();
    const ai = new AiConnection({ fetch: r.fetch, session });
    await ai.probeServer();
    expect(ai.setByok('openai', 'short')).not.toBeNull();
    expect(ai.setByok('openai', 'sk-test-0123456789abcdefghijk')).toBeNull();
    // The server not accepting personal keys does not matter any more.
    expect(ai.resolve(prefs({ mode: 'byok', byokProvider: 'openai' })).ready).toBe(true);
    const p = ai.createProvider(prefs({ mode: 'byok', byokProvider: 'openai' }));
    await p?.complete({ role: 'planner', system: 's', messages: [{ role: 'user', content: 'x' }] });
    const call = r.calls.find((c) => c.url === 'https://api.openai.com/v1/responses');
    expect((call?.init.headers as Record<string, string>)['authorization']).toBe('Bearer sk-test-0123456789abcdefghijk');
    for (const c of r.calls.filter((x) => !x.url.startsWith('https://api.openai.com'))) expect(JSON.stringify(c.init)).not.toContain('sk-test');
    expect(ai.store.getState().byok).toMatchObject({ provider: 'openai', providers: ['openai'], usage: { calls: 1, inputTokens: 7, outputTokens: 3 } });
    expect(JSON.stringify(ai.store.getState())).not.toContain('sk-test');
    expect([...session.map.keys()].sort()).toEqual(['aether.byok.usage.v1', 'aether.byok.v2']);
    ai.clearByok();
    expect(session.map.has('aether.byok.v2')).toBe(false);
    expect(ai.resolve(prefs({ mode: 'byok', byokProvider: 'openai' })).ready).toBe(false);
  });

  it('loads an on-device model through the injected loader with progress', async () => {
    const progress: number[] = [];
    const ai = new AiConnection({
      session: mem(),
      webGpu: async () => ({ ok: true, reason: '' }),
      loadEngine: async (_m, onProgress) => {
        onProgress(0.5, 'half');
        return { chat: { completions: { create: async () => ({ choices: [{ message: { content: '{"tool_calls":[],"final_message":"hi"}' } }] }) } } };
      },
    });
    ai.store.subscribe((s) => progress.push(s.webllm.progress));
    await ai.loadWebLlm(DEFAULT_AI_PREFS.webllmModel);
    expect(ai.store.getState().webllm.state).toBe('ready');
    expect(progress).toContain(0.5);
    const p = ai.createProvider(prefs({ mode: 'webllm' }));
    expect((await p?.complete({ role: 'planner', system: 's', messages: [{ role: 'user', content: 'x' }] }))?.content).toEqual([{ type: 'text', text: 'hi' }]);
  });

  it('explains fallbacks with an action', () => {
    expect(fallbackText('Codex · gpt-6.1-sol', { from: 'codex', to: 'mock', code: 'network', reason: 'bridge_offline', message: 'x' })).toContain('npx aether start');
    expect(fallbackText('Claude Code', { from: 'claude-code', to: 'mock', code: 'rate_limit', reason: 'rate_limited', message: 'x' })).toContain('usage limit');
  });
});

describe('chat views for the AI connection', () => {
  it('revives notice, quality and extended done events (and drops junk)', () => {
    const chat = reviveChat([
      { role: 'user', text: 'a castle' },
      {
        role: 'assistant',
        status: 'done',
        events: [
          { type: 'notice', tone: 'warning', text: 'Codex could not answer' },
          { type: 'quality', score: 140, round: 1, source: 'evil', summary: 's', criteria: [{ id: 'composition', label: 'Composition', score: 99, note: 'n' }, 'junk'], applied: ['grounded 1', 3] },
          { type: 'done', inputTokens: 1, outputTokens: 2, calls: 1, ms: 1234, via: 'Codex · gpt-6.1-sol' },
        ],
      },
    ]);
    const a = chat[1];
    expect(a?.role === 'assistant' && a.events).toEqual([
      { type: 'notice', tone: 'warning', text: 'Codex could not answer' },
      { type: 'quality', score: 100, round: 1, source: 'heuristic', summary: 's', criteria: [{ id: 'composition', label: 'Composition', score: 10, note: 'n' }], applied: ['grounded 1'] },
      { type: 'done', inputTokens: 1, outputTokens: 2, calls: 1, ms: 1234, via: 'Codex · gpt-6.1-sol' },
    ]);
  });
});

describe('hosted bridge browser notes', () => {
  const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
  const IOS_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1';
  const CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
  const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:141.0) Gecko/20100101 Firefox/141.0';
  it('warns WebKit browsers on hosted pages, hints Chromium, stays quiet locally and in Firefox', () => {
    expect(hostedBridgeNote('https://studio.example', SAFARI)?.tone).toBe('warn');
    expect(hostedBridgeNote('https://studio.example', IOS_CHROME)?.tone).toBe('warn');
    expect(hostedBridgeNote('https://studio.example', CHROME)?.tone).toBe('info');
    expect(hostedBridgeNote('https://studio.example', FIREFOX)).toBeNull();
    expect(hostedBridgeNote('http://localhost:5173', SAFARI)).toBeNull();
    expect(isLocalOrigin('http://127.0.0.1:4173')).toBe(true);
    expect(isLocalOrigin('http://localhost.evil.example')).toBe(false);
  });
});
