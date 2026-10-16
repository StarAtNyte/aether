import { describe, expect, it } from 'vitest';
import { createBridgeAccountApi, createLocalAiApi, createLocalProvider, parseSseBlock, ProviderError } from '../src';
const JOB_ID = '0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e';
const job = (status, events) => ({
    id: JOB_ID,
    kind: 'asset',
    backend: 'codex',
    accountId: 'default',
    spec: { id: 'tower', description: 'x' },
    budget: { turns: 2, minutes: 5 },
    status,
    createdAt: 1,
    events,
});
const ev = (seq) => `id: ${seq}\nevent: progress\ndata: ${JSON.stringify({ seq, at: seq, phase: 'write', message: `step ${seq}` })}\n\n`;
const sse = (text, close = true) => new Response(new ReadableStream({
    start(c) {
        c.enqueue(new TextEncoder().encode(text));
        if (close)
            c.close();
        else
            setTimeout(() => c.error(new Error('connection reset')), 10);
    },
}), { headers: { 'content-type': 'text/event-stream' } });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
describe('server-sent events', () => {
    it('parses blocks (multi-line data, comments, ids)', () => {
        expect(parseSseBlock('id: 3\nevent: progress\ndata: {"a":\ndata: 1}')).toEqual({ id: '3', event: 'progress', data: '{"a":\n1}' });
        expect(parseSseBlock(': keep-alive')).toBeNull();
        expect(parseSseBlock('data: x')).toEqual({ event: 'message', data: 'x' });
    });
});
describe('local AI client', () => {
    it('follows a job across a dropped stream without repeating events', async () => {
        const urls = [];
        let n = 0;
        const fetch = (async (input) => {
            const url = String(input);
            urls.push(url);
            if (url.endsWith(`/jobs/${JOB_ID}`))
                return json(job('running', 2));
            n++;
            if (n === 1)
                return sse(ev(1) + ev(2), false);
            return sse(ev(2) + ev(3) + `event: end\ndata: ${JSON.stringify({ ...job('done', 3) })}\n\n`);
        });
        const api = createLocalAiApi({ fetch });
        const seen = [];
        const done = await api.followJob(JOB_ID, { onEvent: (e) => seen.push(e.seq) });
        expect(done.status).toBe('done');
        expect(seen).toEqual([1, 2, 3]);
        expect(urls.filter((u) => u.includes('/events'))).toEqual([`/api/local/jobs/${JOB_ID}/events?after=0`, `/api/local/jobs/${JOB_ID}/events?after=2`]);
    });
    it('rejects invalid job ids before any request', async () => {
        const api = createLocalAiApi({ fetch: (async () => json({})) });
        await expect(api.job('../../etc')).rejects.toBeInstanceOf(ProviderError);
    });
    it('maps bridge-format errors and validates responses', async () => {
        const api = createLocalAiApi({ fetch: (async () => json({ error: { code: 'not_logged_in', message: 'Codex is not signed in.' } }, 424)) });
        await expect(api.status()).rejects.toMatchObject({ code: 'auth', reason: 'not_logged_in' });
        const bad = createLocalAiApi({ fetch: (async () => json({ ok: true, name: 'something else' })) });
        await expect(bad.status()).rejects.toMatchObject({ code: 'invalid_response' });
        const offline = createLocalAiApi({ fetch: (async () => Promise.reject(new TypeError('fetch failed'))) });
        await expect(offline.status()).rejects.toMatchObject({ reason: 'bridge_offline', message: expect.stringContaining('local AI') });
    });
    it('posts completions with backend, model and effort', async () => {
        let body;
        const fetch = (async (_u, init) => {
            body = JSON.parse(String(init?.body));
            return json({ content: [{ type: 'text', text: 'ok' }], stopReason: 'end' });
        });
        const p = createLocalProvider({ backend: 'claude-code', model: 'sonnet', effort: 'high', fetch });
        await p.complete({ role: 'planner', system: 's', messages: [{ role: 'user', content: 'x' }], tools: [], maxTokens: 10 });
        expect(body).toMatchObject({ backend: 'claude-code', model: 'sonnet', effort: 'high' });
    });
});
describe('bridge account client', () => {
    it('sends the pairing token and refuses non-loopback addresses', async () => {
        const calls = [];
        const fetch = (async (input, init) => {
            calls.push({ url: String(input), auth: (init?.headers)['authorization'] });
            return json({ login: null });
        });
        const token = 'A'.repeat(43);
        const api = createBridgeAccountApi({ baseUrl: 'http://127.0.0.1:8790', token, fetch });
        expect(await api.loginStatus()).toBeNull();
        expect(calls[0]).toEqual({ url: 'http://127.0.0.1:8790/v1/auth/login', auth: `Bearer ${token}` });
        expect(() => createBridgeAccountApi({ baseUrl: 'https://evil.example', token, fetch })).toThrow();
    });
});
describe('sign-in state', () => {
    it('accepts only https verification links', async () => {
        const { LoginStateSchema } = await import('../src');
        const base = { backend: 'codex', running: true, output: '', startedAt: 1 };
        expect(LoginStateSchema.safeParse({ ...base, url: 'https://auth.openai.com/codex/device' }).success).toBe(true);
        expect(LoginStateSchema.safeParse({ ...base, url: 'javascript:alert(1)' }).success).toBe(false);
        expect(LoginStateSchema.safeParse({ ...base, url: 'http://evil.example' }).success).toBe(false);
    });
});
