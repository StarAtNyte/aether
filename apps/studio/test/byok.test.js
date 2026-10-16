import { ProviderError } from '@aether/agent';
import { describe, expect, it } from 'vitest';
import { byokModelFor, createDirectProvider, estimateRequestTokens, listProviderModels, meteredProvider } from '../src/ai/byok';
import { BYOK_CATALOG, BYOK_KEY_RE, BYOK_ORIGINS, BYOK_PROVIDERS, BYOK_SESSION_CALL_CAP, isByokProvider, maskKey } from '../src/ai/byokCatalog';
import { AiConnection } from '../src/ai/connection';
import { DEFAULT_AI_PREFS, parsePrefs } from '../src/ai/prefs';
import { loadByokKeys, loadByokUsage, saveByokKeys, saveByokUsage } from '../src/ai/session';
function mem() {
    const map = new Map();
    return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}
function fakeFetch(reply) {
    const calls = [];
    const fn = async (input, init = {}) => {
        const url = String(input);
        calls.push({ url, init });
        const r = reply(url);
        return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
    };
    return { fetch: fn, calls };
}
const KEY = 'sk-test-0123456789abcdefghijklmnop';
const prefs = (p = {}) => ({ ...DEFAULT_AI_PREFS, ...p });
const REQ = { role: 'planner', system: 'sys', messages: [{ role: 'user', content: 'hello world' }] };
const chatReply = { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2 } };
const anthropicReply = { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 2 } };
const openaiReply = { output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }], usage: { input_tokens: 5, output_tokens: 2 } };
describe('provider catalog', () => {
    it('lists four providers with https origins, key pages and a default model in the shortlist', () => {
        expect([...BYOK_PROVIDERS]).toEqual(['anthropic', 'openai', 'openrouter', 'gemini']);
        for (const p of BYOK_PROVIDERS) {
            const info = BYOK_CATALOG[p];
            expect(info.origin).toMatch(/^https:\/\/[a-z.]+$/);
            expect(info.keyPage).toMatch(/^https:\/\//);
            expect(info.models.some((m) => m.id === info.defaultModel)).toBe(true);
        }
        expect(BYOK_ORIGINS).toHaveLength(4);
        expect(isByokProvider('gemini')).toBe(true);
        expect(isByokProvider('__proto__')).toBe(false);
    });
    it('rejects keys that could inject headers and masks keys for display', () => {
        expect(BYOK_KEY_RE.test(KEY)).toBe(true);
        expect(BYOK_KEY_RE.test(`${KEY}\r\nx-evil: 1`)).toBe(false);
        expect(BYOK_KEY_RE.test('short')).toBe(false);
        expect(maskKey('sk-ant-api03-abcdefghijklmnopWXYZ')).toBe('sk-ant-••••WXYZ');
        expect(maskKey('AIzaSyabcdefghijklmnopqrstu1234')).not.toContain('abcdefgh');
        expect(maskKey('tiny')).toBe('••••');
    });
});
describe('key storage', () => {
    it('keeps keys in session storage only, unless remembered on this device', () => {
        const session = mem();
        const device = mem();
        saveByokKeys(session, device, { openai: KEY }, false);
        expect(device.map.size).toBe(0);
        expect(loadByokKeys(session, device)).toEqual({ keys: { openai: KEY }, remembered: false });
        saveByokKeys(session, device, { openai: KEY, gemini: `AIza${KEY}` }, true);
        // A new tab (empty session storage) still finds remembered keys.
        expect(loadByokKeys(mem(), device)).toEqual({ keys: { openai: KEY, gemini: `AIza${KEY}` }, remembered: true });
        saveByokKeys(session, device, {}, true);
        expect(session.map.size + device.map.size).toBe(0);
    });
    it('drops invalid and unknown entries and migrates the old single-key format', () => {
        const session = mem();
        session.setItem('aether.byok.v2', JSON.stringify({ keys: { openai: 'bad key', evil: KEY, __proto__: { anthropic: KEY } } }));
        expect(loadByokKeys(session, null).keys).toEqual({});
        const old = mem();
        old.setItem('aether.byok.v1', JSON.stringify({ provider: 'anthropic', key: KEY }));
        expect(loadByokKeys(old, null).keys).toEqual({ anthropic: KEY });
        expect(old.map.has('aether.byok.v1')).toBe(false);
        old.setItem('aether.byok.v2', '{not json');
        expect(loadByokKeys(old, null).keys).toEqual({});
    });
    it('validates the usage counters', () => {
        const s = mem();
        saveByokUsage(s, { calls: 3, inputTokens: 10, outputTokens: 4 });
        expect(loadByokUsage(s)).toEqual({ calls: 3, inputTokens: 10, outputTokens: 4 });
        s.setItem('aether.byok.usage.v1', JSON.stringify({ calls: -5, inputTokens: 'x', outputTokens: 1e99 }));
        expect(loadByokUsage(s)).toEqual({ calls: 0, inputTokens: 0, outputTokens: 1e12 });
    });
    it('accepts per-provider model choices in preferences and drops malformed ones', () => {
        const p = parsePrefs({ byokProvider: 'openrouter', byokModels: { openrouter: 'anthropic/claude-sonnet-5.5', gemini: 'bad model id with spaces' } });
        expect(p.byokProvider).toBe('openrouter');
        expect(p.byokModels).toEqual({ openrouter: 'anthropic/claude-sonnet-5.5' });
        expect(parsePrefs({ byokProvider: 'evil' }).byokProvider).toBe('anthropic');
        expect(byokModelFor('gemini', undefined)).toBe(BYOK_CATALOG.gemini.defaultModel);
        expect(byokModelFor('gemini', 'gemini-3.7-flash')).toBe('gemini-3.7-flash');
    });
});
describe('direct providers', () => {
    it.each([
        ['anthropic', 'https://api.anthropic.com/v1/messages', anthropicReply],
        ['openai', 'https://api.openai.com/v1/responses', openaiReply],
        ['openrouter', 'https://openrouter.ai/api/v1/chat/completions', chatReply],
        ['gemini', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', chatReply],
    ])('%s calls its own API with the key and the chosen model', async (provider, url, body) => {
        const f = fakeFetch(() => ({ status: 200, body }));
        const out = await createDirectProvider(provider, KEY, 'model-x', f.fetch).complete(REQ);
        expect(out.content[0]).toEqual({ type: 'text', text: 'ok' });
        expect(f.calls).toHaveLength(1);
        expect(f.calls[0]?.url).toBe(url);
        expect(new URL(url).origin).toBe(BYOK_CATALOG[provider].origin);
        const headers = f.calls[0]?.init.headers;
        expect(JSON.parse(String(f.calls[0]?.init.body)).model).toBe('model-x');
        if (provider === 'anthropic') {
            expect(headers['x-api-key']).toBe(KEY);
            expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
        }
        else
            expect(headers['authorization']).toBe(`Bearer ${KEY}`);
        expect(String(f.calls[0]?.init.body)).not.toContain(KEY);
    });
    it('maps a rejected key to an auth error', async () => {
        const f = fakeFetch(() => ({ status: 401, body: { error: { message: 'invalid x-api-key' } } }));
        await expect(createDirectProvider('anthropic', KEY, 'm', f.fetch).complete(REQ)).rejects.toMatchObject({ code: 'auth' });
    });
});
describe('usage meter and session cap', () => {
    function meter(start = { calls: 0, inputTokens: 0, outputTokens: 0 }) {
        let v = start;
        return { read: () => v, write: (u) => (v = u), value: () => v };
    }
    const inner = (calls) => ({
        name: 'x',
        complete: async () => {
            calls.n++;
            return { content: [{ type: 'text', text: 'ok' }], stopReason: 'end', usage: { inputTokens: 40, outputTokens: 9 } };
        },
    });
    it('counts calls and replaces the token estimate with the reported count', async () => {
        const m = meter();
        const calls = { n: 0 };
        await meteredProvider(inner(calls), m).complete(REQ);
        expect(m.value()).toEqual({ calls: 1, inputTokens: 40, outputTokens: 9 });
        expect(estimateRequestTokens(REQ)).toBeGreaterThan(0);
    });
    it('refuses calls past the cap before anything is sent', async () => {
        const m = meter({ calls: BYOK_SESSION_CALL_CAP, inputTokens: 0, outputTokens: 0 });
        const calls = { n: 0 };
        const err = await meteredProvider(inner(calls), m).complete(REQ).catch((e) => e);
        expect(err).toBeInstanceOf(ProviderError);
        expect(err.reason).toBe('session_cap');
        expect(calls.n).toBe(0);
    });
    it('the connection resolves to not-ready at the cap and the counter can be reset', () => {
        const session = mem();
        saveByokUsage(session, { calls: BYOK_SESSION_CALL_CAP, inputTokens: 1, outputTokens: 1 });
        const ai = new AiConnection({ session, fetch: fakeFetch(() => ({ status: 500, body: {} })).fetch });
        expect(ai.setByok('gemini', `AIza${KEY}`)).toBeNull();
        expect(ai.resolve(prefs({ mode: 'byok', byokProvider: 'gemini' }))).toMatchObject({ ready: false });
        ai.resetByokUsage();
        expect(ai.resolve(prefs({ mode: 'byok', byokProvider: 'gemini' }))).toMatchObject({ ready: true, kind: 'byok' });
        expect(loadByokUsage(session).calls).toBe(0);
    });
});
describe('connection with keys', () => {
    it('auto mode uses a key after local AI, bridge and server are unavailable', () => {
        const ai = new AiConnection({ session: mem(), fetch: fakeFetch(() => ({ status: 500, body: {} })).fetch });
        expect(ai.resolve(prefs({ mode: 'auto' })).kind).toBe('offline');
        ai.setByok('openrouter', `sk-or-v1-${KEY}`);
        const r = ai.resolve(prefs({ mode: 'auto', byokProvider: 'anthropic' }));
        expect(r).toMatchObject({ kind: 'byok', ready: true });
        expect(r.label).toContain('OpenRouter');
    });
    it('remembers keys on the device only when asked, and forgets one provider at a time', () => {
        const session = mem();
        const device = mem();
        const ai = new AiConnection({ session, device });
        ai.setByok('openai', KEY);
        expect(device.map.size).toBe(0);
        ai.setByok('anthropic', `sk-ant-${KEY}`, { remember: true });
        expect(ai.store.getState().byok).toMatchObject({ remembered: true, provider: 'anthropic' });
        expect(new AiConnection({ session: mem(), device }).store.getState().byok.providers.sort()).toEqual(['anthropic', 'openai']);
        ai.clearByok('anthropic');
        expect(ai.store.getState().byok.providers).toEqual(['openai']);
        ai.setByokRemember(false);
        expect(device.map.size).toBe(0);
        expect(ai.store.getState().byok.remembered).toBe(false);
    });
    it('loads and caches the provider model list with the key', async () => {
        const f = fakeFetch(() => ({ status: 200, body: { data: [{ id: 'gpt-6.1-sol' }, { id: 'gpt-6-tts' }, { id: 'text-embedding-9' }] } }));
        const ai = new AiConnection({ session: mem(), fetch: f.fetch });
        await expect(ai.listByokModels('openai')).rejects.toBeInstanceOf(ProviderError);
        ai.setByok('openai', KEY);
        expect((await ai.listByokModels('openai')).map((m) => m.id)).toEqual(['gpt-6.1-sol']);
        await ai.listByokModels('openai');
        expect(f.calls).toHaveLength(1);
        expect(f.calls[0]?.init.credentials).toBe('omit');
    });
});
describe('model lists', () => {
    it('keeps only tool-capable models and caps the list', async () => {
        const data = [{ id: 'a/b', supported_parameters: ['tools'] }, { id: 'c/d', supported_parameters: [] }, { id: 'e/f:free', supported_parameters: ['tools'] }, { id: 'bad id!', supported_parameters: ['tools'] }];
        const f = fakeFetch(() => ({ status: 200, body: { data } }));
        expect((await listProviderModels('openrouter', KEY, f.fetch)).map((m) => m.id)).toEqual(['a/b']);
        // OpenRouter's list is public: the key is not sent.
        expect(JSON.stringify(f.calls[0]?.init.headers)).not.toContain(KEY);
        const g = fakeFetch(() => ({ status: 200, body: { data: [{ id: 'models/gemini-3.8-flash' }, { id: 'models/text-embedding-4' }] } }));
        expect((await listProviderModels('gemini', KEY, g.fetch)).map((m) => m.id)).toEqual(['gemini-3.8-flash']);
    });
    it('rejects malformed lists and reports a rejected key', async () => {
        await expect(listProviderModels('openai', KEY, fakeFetch(() => ({ status: 200, body: { data: 'nope' } })).fetch)).rejects.toMatchObject({ code: 'invalid_response' });
        await expect(listProviderModels('openai', KEY, fakeFetch(() => ({ status: 401, body: {} })).fetch)).rejects.toMatchObject({ code: 'auth' });
    });
});
