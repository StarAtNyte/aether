import { createServer, request as httpRequest } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ResponseCache } from '../src/cache';
import { normalizeOrigin, parseBridgeConfig } from '../src/config';
import { MAX_PAIR_ATTEMPTS, Pairing } from '../src/pairing';
import { JobQueue } from '../src/queue';
import { createBridgeHandler } from '../src/server';
import { LoginManager } from '../src/auth';
import { SessionStore } from '../src/sessions';
import { fakeSpawn } from './helpers';
const ORIGIN = 'http://localhost:5173';
/** Backend answering with a finish call after an optional delay. */
class FakeBackend {
    delayMs;
    name = 'Fake';
    strictSchema = false;
    calls = 0;
    aborted = 0;
    models = [];
    constructor(delayMs = 0) {
        this.delayMs = delayMs;
    }
    complete(req, signal) {
        this.calls++;
        this.models.push(req.model);
        return new Promise((resolve, reject) => {
            const t = setTimeout(() => resolve({ text: JSON.stringify({ tool_calls: [{ name: 'finish', input: { message: 'ok' } }] }) }), this.delayMs);
            signal?.addEventListener('abort', () => {
                clearTimeout(t);
                this.aborted++;
                reject(new Error('aborted'));
            });
        });
    }
}
let server;
let port = 0;
let pairing;
let codex;
let claude;
let sessions;
let loginCalls;
let authChanges = 0;
function call(method, path, opts = {}) {
    return new Promise((resolve, reject) => {
        const req = httpRequest({ host: '127.0.0.1', port, method, path, headers: { host: opts.host ?? `127.0.0.1:${port}`, ...opts.headers } }, (res) => {
            let text = '';
            res.on('data', (c) => (text += c.toString()));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text ? JSON.parse(text) : null }));
        });
        req.on('error', reject);
        if (opts.body !== undefined)
            req.write(opts.body);
        req.end();
    });
}
async function pairToken() {
    const r = await call('POST', '/v1/pair', { headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ code: pairing.currentCode }) });
    expect(r.status).toBe(200);
    return r.body.token;
}
const completion = (backend = 'codex', text = 'hello') => JSON.stringify({ backend, model: 'gpt-6.1-sol', effort: 'low', request: { role: 'planner', system: 's', messages: [{ role: 'user', content: text }], tools: [{ name: 'finish', description: 'd', inputSchema: { type: 'object' } }] } });
beforeEach(async () => {
    pairing = new Pairing();
    codex = new FakeBackend(30);
    claude = new FakeBackend();
    sessions = new SessionStore();
    authChanges = 0;
    const loginSpawn = fakeSpawn([{ lines: ['Follow these steps to sign in with ChatGPT:', '1. Open https://auth.openai.com/codex/device in your browser', '2. Enter this one-time code ABCD-12345'], hang: true }]);
    loginCalls = loginSpawn.calls;
    const login = new LoginManager({ codexCommand: '/usr/bin/codex', claudeCommand: null, spawn: loginSpawn.spawn, run: fakeSpawn([{ lines: ['Successfully logged out'], code: 0 }]).spawn });
    const handler = createBridgeHandler({
        login,
        sessions,
        onAuthChange: () => void authChanges++,
        config: { origins: [ORIGIN, 'https://studio.example'], maxBodyBytes: 64 * 1024, maxWaiting: 1 },
        port: () => port,
        pairing,
        backends: { codex, 'claude-code': claude },
        status: async () => [
            { id: 'codex', label: 'Codex', installed: true, loggedIn: true, detail: 'Logged in using ChatGPT', models: [{ id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol' }] },
            { id: 'claude-code', label: 'Claude Code', installed: false, loggedIn: false, detail: 'not found', models: [] },
        ],
    });
    server = createServer(handler);
    await new Promise((r) => server.listen(0, '127.0.0.1', () => r()));
    port = server.address().port;
});
afterEach(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(() => r()));
});
describe('bridge HTTP security', () => {
    it('rejects a foreign Host header (DNS rebinding)', async () => {
        const r = await call('GET', '/v1/ping', { host: 'evil.example:8790' });
        expect(r.status).toBe(403);
        expect(r.body).toMatchObject({ error: { code: 'forbidden_host' } });
    });
    it('rejects disallowed origins without CORS headers', async () => {
        const r = await call('GET', '/v1/ping', { headers: { origin: 'https://evil.example' } });
        expect(r.status).toBe(403);
        expect(r.body).toMatchObject({ error: { code: 'forbidden_origin' } });
        expect(r.headers['access-control-allow-origin']).toBeUndefined();
    });
    it('answers CORS + Private Network Access preflights for allowed origins only', async () => {
        const ok = await call('OPTIONS', '/v1/complete', { headers: { origin: 'https://studio.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, content-type', 'access-control-request-private-network': 'true' } });
        expect(ok.status).toBe(204);
        expect(ok.headers['access-control-allow-origin']).toBe('https://studio.example');
        expect(ok.headers['access-control-allow-private-network']).toBe('true');
        expect(String(ok.headers['access-control-allow-headers'])).toContain('authorization');
        expect(ok.headers['vary']).toBe('Origin');
        const noPna = await call('OPTIONS', '/v1/complete', { headers: { origin: ORIGIN, 'access-control-request-method': 'POST' } });
        expect(noPna.headers['access-control-allow-private-network']).toBeUndefined();
        const bad = await call('OPTIONS', '/v1/complete', { headers: { origin: 'https://evil.example', 'access-control-request-private-network': 'true' } });
        expect(bad.status).toBe(403);
        expect(bad.headers['access-control-allow-private-network']).toBeUndefined();
    });
    it('requires the bearer token on status and complete', async () => {
        for (const [m, p] of [['GET', '/v1/status'], ['POST', '/v1/complete']]) {
            const none = await call(m, p, { headers: { origin: ORIGIN }, ...(m === 'POST' ? { body: completion() } : {}) });
            expect(none.status).toBe(401);
            const wrong = await call(m, p, { headers: { origin: ORIGIN, authorization: `Bearer ${'x'.repeat(43)}` }, ...(m === 'POST' ? { body: completion() } : {}) });
            expect(wrong.status).toBe(401);
        }
        expect(codex.calls).toBe(0);
    });
    it('pairs with the printed code once; wrong codes rotate the code after the limit', async () => {
        const code = pairing.currentCode;
        const token = await pairToken();
        expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        const reuse = await call('POST', '/v1/pair', { headers: { origin: ORIGIN }, body: JSON.stringify({ code }) });
        expect(reuse.status).toBe(401);
        const current = pairing.currentCode;
        // The reused code above already counted as one wrong guess.
        for (let i = 0; i < MAX_PAIR_ATTEMPTS - 2; i++)
            expect((await call('POST', '/v1/pair', { body: JSON.stringify({ code: 'AAAA-AAAA' }) })).status).toBe(401);
        const locked = await call('POST', '/v1/pair', { body: JSON.stringify({ code: 'AAAA-AAAA' }) });
        expect(locked.body).toMatchObject({ error: { code: 'pairing_locked' } });
        expect(pairing.currentCode).not.toBe(current);
        const garbage = await call('POST', '/v1/pair', { body: '{"code": 12}' });
        expect(garbage.status).toBe(400);
    });
    it('caps body size and validates JSON + schema', async () => {
        const token = await pairToken();
        const h = { origin: ORIGIN, authorization: `Bearer ${token}` };
        expect((await call('POST', '/v1/complete', { headers: h, body: 'x'.repeat(70 * 1024) })).status).toBe(413);
        expect((await call('POST', '/v1/complete', { headers: h, body: '{nope' })).status).toBe(400);
        const badModel = JSON.stringify({ backend: 'codex', model: 'gpt; rm -rf /', request: { role: 'planner', system: 's', messages: [{ role: 'user', content: 'x' }] } });
        expect((await call('POST', '/v1/complete', { headers: h, body: badModel })).status).toBe(400);
        const extra = JSON.stringify({ backend: 'codex', request: { role: 'planner', system: 's', messages: [{ role: 'user', content: 'x' }] }, shell: 'ls' });
        expect((await call('POST', '/v1/complete', { headers: h, body: extra })).status).toBe(400);
        expect(codex.calls).toBe(0);
    });
});
describe('bridge HTTP behaviour', () => {
    it('reports status with busy counts', async () => {
        const token = await pairToken();
        const r = await call('GET', '/v1/status', { headers: { origin: ORIGIN, authorization: `Bearer ${token}` } });
        expect(r.status).toBe(200);
        expect(r.headers['access-control-allow-origin']).toBe(ORIGIN);
        expect(r.body).toMatchObject({ ok: true, name: 'aether-bridge', backends: [{ id: 'codex', loggedIn: true, busy: 0 }, { id: 'claude-code', installed: false }] });
    });
    it('completes through the emulated provider and caches identical requests', async () => {
        const token = await pairToken();
        const h = { origin: ORIGIN, authorization: `Bearer ${token}` };
        const a = await call('POST', '/v1/complete', { headers: h, body: completion() });
        expect(a.status).toBe(200);
        expect(a.body).toMatchObject({ stopReason: 'tool_use', content: [{ type: 'tool_use', name: 'finish' }] });
        const b = await call('POST', '/v1/complete', { headers: h, body: completion() });
        expect(b.headers['x-aether-cache']).toBe('hit');
        expect(codex.calls).toBe(1);
        await call('POST', '/v1/complete', { headers: h, body: completion('claude-code') });
        expect(claude.calls).toBe(1);
    });
    it('runs one job per backend, queues one, refuses more with busy', async () => {
        const token = await pairToken();
        const h = { origin: ORIGIN, authorization: `Bearer ${token}` };
        const results = await Promise.all([1, 2, 3].map((i) => call('POST', '/v1/complete', { headers: h, body: completion('codex', `q${i}`) })));
        expect(results.map((r) => r.status).sort()).toEqual([200, 200, 429]);
        const busy = results.find((r) => r.status === 429);
        expect(busy?.body).toMatchObject({ error: { code: 'busy' } });
        expect(busy?.headers['retry-after']).toBe('10');
    });
    it('aborts the backend run when the client disconnects', async () => {
        const token = await pairToken();
        await new Promise((resolve) => {
            const req = httpRequest({ host: '127.0.0.1', port, method: 'POST', path: '/v1/complete', headers: { host: `127.0.0.1:${port}`, origin: ORIGIN, authorization: `Bearer ${token}` } });
            req.on('error', () => resolve());
            req.end(completion('codex', 'slow'));
            setTimeout(() => {
                req.destroy();
                resolve();
            }, 10);
        });
        await new Promise((r) => setTimeout(r, 60));
        expect(codex.aborted).toBe(1);
    });
    // Regression: the inner request's free-form `model` (≤ 128 chars, no pattern) took precedence
    // over the validated top-level one and would have reached `claude --model <value>`.
    it('ignores the inner request model: only the validated top-level model reaches the backend', async () => {
        const token = await pairToken();
        const h = { origin: ORIGIN, authorization: `Bearer ${token}` };
        const body = (outer) => JSON.stringify({ backend: 'claude-code', ...(outer ? { model: outer } : {}), request: { role: 'planner', model: '--dangerously-skip-permissions', system: 's', messages: [{ role: 'user', content: `m-${outer ?? 'none'}` }], tools: [{ name: 'finish', description: 'd', inputSchema: { type: 'object' } }] } });
        expect((await call('POST', '/v1/complete', { headers: h, body: body('haiku') })).status).toBe(200);
        expect((await call('POST', '/v1/complete', { headers: h, body: body(undefined) })).status).toBe(200);
        expect(claude.models).toEqual(['haiku', undefined]);
        const bad = await call('POST', '/v1/complete', { headers: h, body: JSON.stringify({ backend: 'codex', model: '--yolo', request: { role: 'planner', system: 's', messages: [{ role: 'user', content: 'x' }] } }) });
        expect(bad.status).toBe(400);
    });
    it('unknown endpoints are 404 after auth', async () => {
        const token = await pairToken();
        expect((await call('GET', '/v1/secrets', { headers: { authorization: `Bearer ${token}` } })).status).toBe(404);
    });
});
describe('config, queue, cache', () => {
    it('accepts only exact, non-wildcard origins (https unless loopback)', () => {
        expect(normalizeOrigin('https://studio.example/path')).toBe('https://studio.example');
        expect(normalizeOrigin('http://localhost:3000')).toBe('http://localhost:3000');
        expect(normalizeOrigin('http://studio.example')).toBeNull();
        expect(normalizeOrigin('https://*.example')).toBeNull();
        expect(normalizeOrigin('https://u:p@studio.example')).toBeNull();
        const c = parseBridgeConfig(['--port', '0', '--origin', 'https://studio.example'], { AETHER_BRIDGE_ORIGINS: 'https://other.example' });
        expect(c.port).toBe(0);
        expect(c.origins).toContain('https://studio.example');
        expect(c.origins).toContain('https://other.example');
        expect(() => parseBridgeConfig(['--origin', 'http://evil.example'])).toThrow(/invalid origin/);
        expect(() => parseBridgeConfig(['--port', '99999'])).toThrow();
        expect(() => parseBridgeConfig(['--bogus'])).toThrow(/unknown flag/);
    });
    it('queue removes aborted waiters', async () => {
        const q = new JobQueue(2);
        let release = () => undefined;
        const first = q.run(() => new Promise((r) => (release = () => r(1))));
        const ctrl = new AbortController();
        const second = q.run(async () => 2, ctrl.signal);
        expect(q.size).toBe(2);
        ctrl.abort();
        await expect(second).rejects.toMatchObject({ message: 'cancelled' });
        expect(q.size).toBe(1);
        release();
        await expect(first).resolves.toBe(1);
        expect(q.size).toBe(0);
    });
    it('cache evicts by count and bytes', () => {
        const c = new ResponseCache(2, 1000);
        c.set('a', 'x');
        c.set('b', 'y');
        c.get('a');
        c.set('c', 'z');
        expect(c.get('b')).toBeUndefined();
        expect(c.get('a')).toBe('x');
        c.set('big', 'q'.repeat(300));
        expect(c.get('big')).toBeUndefined();
    });
});
describe('bridge sign-in and conversations', () => {
    const auth = (token) => ({ origin: ORIGIN, authorization: `Bearer ${token}`, 'content-type': 'application/json' });
    it('requires pairing for sign-in and session endpoints', async () => {
        expect((await call('POST', '/v1/auth/login', { headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: '{"backend":"codex"}' })).status).toBe(401);
        expect((await call('DELETE', '/v1/sessions/p-abcdefgh1', { headers: { origin: ORIGIN } })).status).toBe(401);
    });
    it('runs the CLI device sign-in and relays only its link and code', async () => {
        const token = await pairToken();
        const r = await call('POST', '/v1/auth/login', { headers: auth(token), body: JSON.stringify({ backend: 'codex' }) });
        expect(r.status).toBe(200);
        expect(loginCalls[0]?.args).toEqual(['login', '--device-auth']);
        await new Promise((res) => setTimeout(res, 20));
        const st = await call('GET', '/v1/auth/login', { headers: auth(token) });
        expect(st.body).toMatchObject({ login: { backend: 'codex', running: true, url: 'https://auth.openai.com/codex/device', code: 'ABCD-12345' } });
        // One sign-in at a time.
        const again = await call('POST', '/v1/auth/login', { headers: auth(token), body: JSON.stringify({ backend: 'codex' }) });
        expect(again.status).toBe(400);
        const cancel = await call('POST', '/v1/auth/login/cancel', { headers: auth(token), body: '{}' });
        expect(cancel.body).toMatchObject({ login: { running: false, finished: { ok: false } } });
        expect(loginCalls[0]?.killed).toBe(true);
        expect(authChanges).toBeGreaterThan(0);
        const bad = await call('POST', '/v1/auth/login', { headers: auth(token), body: JSON.stringify({ backend: 'rm -rf' }) });
        expect(bad.status).toBe(400);
    });
    it('signs out through the CLI', async () => {
        const token = await pairToken();
        const r = await call('POST', '/v1/auth/logout', { headers: auth(token), body: JSON.stringify({ backend: 'codex' }) });
        expect(r.body).toEqual({ ok: true, message: 'Signed out.' });
    });
    it('forgets a project\'s conversations', async () => {
        const token = await pairToken();
        sessions.record('p-abcdefgh1', 'codex', undefined, { id: 'thread-1', systemHash: 'a'.repeat(64), body: 'x' });
        sessions.record('p-other0001', 'codex', undefined, { id: 'thread-2', systemHash: 'a'.repeat(64), body: 'x' });
        const r = await call('DELETE', '/v1/sessions/p-abcdefgh1', { headers: { origin: ORIGIN, authorization: `Bearer ${token}` } });
        expect(r.body).toEqual({ cleared: 1 });
        expect(sessions.size).toBe(1);
        const bad = await call('DELETE', '/v1/sessions/..', { headers: { origin: ORIGIN, authorization: `Bearer ${token}` } });
        expect(bad.status).toBe(404);
    });
});
