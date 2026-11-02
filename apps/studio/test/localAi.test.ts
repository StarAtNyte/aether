import { describe, expect, it } from 'vitest';
import { AiConnection, projectSessionKey } from '../src/ai/connection';
import { DEFAULT_AI_PREFS, parsePrefs, type AiPrefs } from '../src/ai/prefs';
import { OFFLINE_CHOICE_PREFS } from '../src/onboarding/firstRun';

const TOKEN = 'T'.repeat(43);
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const backend = (id: 'codex' | 'claude-code', loggedIn: boolean) => ({
  id,
  label: id === 'codex' ? 'Codex' : 'Claude Code',
  installed: true,
  loggedIn,
  detail: loggedIn ? 'Logged in' : 'Not logged in',
  models: id === 'codex' ? [{ id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol', vision: true }] : [{ id: 'sonnet', label: 'Sonnet', vision: true }],
  defaultModel: id === 'codex' ? 'gpt-6.1-sol' : 'sonnet',
  busy: 0,
});
const LOCAL = (codex: boolean, claude: boolean) => ({ ok: true, name: 'aether-local', version: '1', backends: [backend('codex', codex), backend('claude-code', claude)], account: null, jobs: 0, login: null });
const BRIDGE = (codex: boolean) => ({ ok: true, name: 'aether-bridge', version: '0.1.0', backends: [backend('codex', codex)] });

function router(routes: Record<string, (init: RequestInit, url: string) => Response | Promise<Response>>): { fetch: typeof fetch; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  return {
    calls,
    fetch: (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, init });
      for (const [k, h] of Object.entries(routes)) if (url.split('?')[0]?.endsWith(k)) return h(init, url);
      throw new TypeError('fetch failed');
    }) as typeof fetch,
  };
}

const prefs = (p: Partial<AiPrefs>): AiPrefs => ({ ...DEFAULT_AI_PREFS, ...p });
const session = (pairing: boolean) => {
  const map = new Map<string, string>();
  if (pairing) map.set('aether.bridge.v1', JSON.stringify({ url: 'http://127.0.0.1:8790', token: TOKEN }));
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
};

describe('local AI connection', () => {
  it('prefers deep build on by default and validates the budget', () => {
    expect(DEFAULT_AI_PREFS.deep).toBe(true);
    expect(DEFAULT_AI_PREFS.deepTurns).toBe(3);
    expect(parsePrefs({ deep: 'yes', deepTurns: 99, mode: 'local' })).toMatchObject({ deep: true, deepTurns: 3, mode: 'local' });
  });

  it('is off when the server does not offer it (hosted)', async () => {
    const r = router({ '/api/health': () => json({ ok: true, mode: 'mock', providers: [], byok: true }) });
    const ai = new AiConnection({ fetch: r.fetch, session: null });
    await ai.refresh();
    expect(ai.store.getState().local.state).toBe('off');
    expect(r.calls.some((c) => c.url.includes('/api/local'))).toBe(false);
    expect(ai.resolve(prefs({ mode: 'local' }))).toMatchObject({ kind: 'local', ready: false });
    expect(ai.resolve(prefs({ mode: 'auto' })).kind).toBe('offline');
  });

  it('the first-run offline choice stays offline even when Claude Code is signed in on this computer', async () => {
    const r = router({
      '/api/health': () => json({ ok: true, mode: 'mock', providers: [], byok: true, local: true }),
      '/api/local/status': () => json(LOCAL(false, true)),
    });
    const ai = new AiConnection({ fetch: r.fetch, session: null });
    await ai.refresh();
    expect(ai.resolve(prefs({}))).toMatchObject({ kind: 'local', ready: true });
    const chosen = parsePrefs({ ...DEFAULT_AI_PREFS, ...OFFLINE_CHOICE_PREFS });
    expect(chosen.mode).toBe('offline');
    expect(ai.resolve(chosen)).toMatchObject({ kind: 'offline', ready: true });
  });

  it('auto picks the preferred backend on this computer first, then the other, then the bridge', async () => {
    let local = LOCAL(true, true);
    const r = router({
      '/api/health': () => json({ ok: true, mode: 'mock', providers: [], byok: true, local: true }),
      '/api/local/status': () => json(local),
      '/v1/status': () => json(BRIDGE(true)),
    });
    const ai = new AiConnection({ fetch: r.fetch, session: session(true) });
    await ai.refresh();
    expect(ai.store.getState().local.state).toBe('ready');
    expect(ai.resolve(prefs({ mode: 'auto', backend: 'codex' }))).toMatchObject({ kind: 'local', ready: true, worker: true });
    expect(ai.resolve(prefs({ mode: 'auto', backend: 'codex' })).label).toContain('Codex');
    // Claude Code is the default backend: with both signed in, auto takes it.
    expect(ai.resolve(prefs({ mode: 'auto' })).label).toContain('Claude Code');

    local = LOCAL(false, true);
    await ai.refreshLocal();
    const second = ai.resolve(prefs({ mode: 'auto' }));
    expect(second).toMatchObject({ kind: 'local', ready: true });
    expect(second.label).toContain('Claude Code');

    local = LOCAL(false, false);
    await ai.refreshLocal();
    expect(ai.store.getState().local.state).toBe('not_logged_in');
    expect(ai.resolve(prefs({ mode: 'auto' })).kind).toBe('bridge');
  });

  it('sends quick completions to /api/local/complete with the project session key', async () => {
    const r = router({
      '/api/health': () => json({ ok: true, mode: 'mock', providers: [], byok: true, local: true }),
      '/api/local/status': () => json(LOCAL(true, false)),
      '/api/local/complete': () => json({ content: [{ type: 'text', text: 'ok' }], stopReason: 'end', model: 'gpt-6.1-sol' }),
    });
    const ai = new AiConnection({ fetch: r.fetch, session: null });
    await ai.refresh();
    const p = prefs({ mode: 'local', effort: 'medium' });
    const provider = ai.createProvider(p);
    expect(provider).not.toBeNull();
    const out = await provider?.complete({ role: 'planner', system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [], maxTokens: 100, session: 'p-abcdefgh1' });
    expect(out?.content[0]).toEqual({ type: 'text', text: 'ok' });
    const call = r.calls.find((c) => c.url.endsWith('/api/local/complete'));
    const body = JSON.parse(String(call?.init.body)) as { backend: string; model: string; effort: string; request: { session?: string } };
    expect(body).toMatchObject({ backend: 'codex', model: 'gpt-6.1-sol', effort: 'medium' });
    expect(body.request.session).toBe('p-abcdefgh1');
  });

  it('forgets a deleted project on local AI and on the bridge', async () => {
    const r = router({
      '/api/health': () => json({ ok: true, mode: 'mock', providers: [], byok: true, local: true }),
      '/api/local/status': () => json(LOCAL(true, false)),
      '/api/local/sessions/p-abcdefgh1': () => json({ cleared: 1 }),
      '/v1/sessions/p-abcdefgh1': () => json({ cleared: 0 }),
      '/v1/status': () => json(BRIDGE(true)),
    });
    const ai = new AiConnection({ fetch: r.fetch, session: session(true) });
    await ai.forgetProject('abcdefgh1');
    const deletes = r.calls.filter((c) => c.init.method === 'DELETE').map((c) => c.url);
    expect(deletes).toEqual(['/api/local/sessions/p-abcdefgh1', 'http://127.0.0.1:8790/v1/sessions/p-abcdefgh1']);
    const bridgeCall = r.calls.find((c) => c.url.includes('/v1/sessions/'));
    expect((bridgeCall?.init.headers as Record<string, string>)['authorization']).toBe(`Bearer ${TOKEN}`);
  });

  it('builds safe session keys only', () => {
    expect(projectSessionKey('abcdefgh1')).toBe('p-abcdefgh1');
    expect(projectSessionKey('../x')).toBeNull();
    expect(projectSessionKey(null)).toBeNull();
  });
});

describe('alternate assistants', () => {
  it('lists the other signed-in backend (own default model), never the chosen one or a signed-out one', async () => {
    const r = router({ '/api/health': () => json({ ok: true, mode: 'mock', providers: [], byok: true, local: true }), '/api/local/status': () => json(LOCAL(true, true)) });
    const ai = new AiConnection({ fetch: r.fetch, session: null });
    await ai.refresh();
    const p = prefs({ mode: 'local', backend: 'codex' });
    const resolved = ai.resolve(p);
    expect(resolved).toMatchObject({ kind: 'local', ready: true });
    const alts = ai.alternates(p, resolved);
    expect(alts.map((a) => a.resolved.label)).toEqual(['Claude Code on this computer · sonnet']);
    expect(ai.alternates(p, { kind: 'offline', label: 'x', ready: true, vision: false })).toEqual([]);
  });

  it('has no alternates when the other assistant is signed out', async () => {
    const r = router({ '/api/health': () => json({ ok: true, mode: 'mock', providers: [], byok: true, local: true }), '/api/local/status': () => json(LOCAL(true, false)) });
    const ai = new AiConnection({ fetch: r.fetch, session: null });
    await ai.refresh();
    const p = prefs({ mode: 'local', backend: 'codex' });
    expect(ai.alternates(p, ai.resolve(p))).toEqual([]);
  });
});
