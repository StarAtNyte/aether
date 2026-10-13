import { describe, expect, it } from 'vitest';
import { createBridgeProvider, fetchBridgeStatus, pairBridge } from '../src/bridge/client';
import { normalizeBridgeUrl, PAIRING_CODE_RE } from '../src/bridge/protocol';
import { createFallbackProvider } from '../src/providers/fallback';
import { createMockProvider } from '../src/providers/mock/index';
import { ProviderError } from '../src/providers/errors';
import { createWebLlmProvider, type WebLlmEngineLike } from '../src/providers/webllm';
import type { CompletionRequest, Provider } from '../src/types';

const TOKEN = 'A'.repeat(43);
const STATUS = {
  ok: true,
  name: 'aether-bridge',
  version: '0.1.0',
  backends: [{ id: 'codex', label: 'Codex', installed: true, loggedIn: true, detail: 'Logged in using ChatGPT', models: [{ id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol', efforts: ['low', 'medium', 'high'] }], defaultModel: 'gpt-6.1-sol', busy: 0 }],
};

function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): { fetch: typeof fetch; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return handler(String(input), init ?? {});
  }) as typeof fetch;
  return { fetch: f, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const REQ: CompletionRequest = { role: 'planner', system: 's', messages: [{ role: 'user', content: 'hi' }] };

describe('normalizeBridgeUrl', () => {
  it('accepts only loopback http(s) origins', () => {
    expect(normalizeBridgeUrl('http://127.0.0.1:8790/')).toBe('http://127.0.0.1:8790');
    expect(normalizeBridgeUrl('http://localhost:9000/v1')).toBe('http://localhost:9000');
    expect(normalizeBridgeUrl('http://[::1]:8790')).toBe('http://[::1]:8790');
    for (const bad of ['https://evil.example', 'http://127.0.0.1.evil.example:8790', 'http://user:pw@127.0.0.1:8790', 'file:///etc/passwd', 'javascript:alert(1)', '', 'http://10.0.0.2:8790']) {
      expect(normalizeBridgeUrl(bad)).toBeNull();
    }
  });
  it('pairing codes use an unambiguous alphabet', () => {
    expect(PAIRING_CODE_RE.test('ABCD-EF23')).toBe(true);
    expect(PAIRING_CODE_RE.test('ABCDEF23')).toBe(true);
    expect(PAIRING_CODE_RE.test('ABCD-EF0O')).toBe(false);
  });
});

describe('bridge client', () => {
  it('pairs: posts the upper-cased code and returns the token', async () => {
    const f = fakeFetch(() => json({ token: TOKEN }));
    await expect(pairBridge('http://127.0.0.1:8790', ' abcd-ef23 ', f.fetch)).resolves.toBe(TOKEN);
    expect(f.calls[0]?.url).toBe('http://127.0.0.1:8790/v1/pair');
    expect(JSON.parse(String(f.calls[0]?.init.body))).toEqual({ code: 'ABCD-EF23' });
  });
  it('never contacts a non-loopback URL', async () => {
    const f = fakeFetch(() => json({ token: TOKEN }));
    await expect(pairBridge('https://evil.example', 'ABCD-EF23', f.fetch)).rejects.toMatchObject({ reason: 'invalid_url' });
    expect(() => createBridgeProvider({ baseUrl: 'https://evil.example', token: TOKEN, backend: 'codex' })).toThrow(ProviderError);
    expect(f.calls).toHaveLength(0);
  });
  it('reads and validates the status with the bearer token', async () => {
    const f = fakeFetch(() => json(STATUS));
    const s = await fetchBridgeStatus('http://127.0.0.1:8790', TOKEN, f.fetch);
    expect(s.backends[0]?.loggedIn).toBe(true);
    expect((f.calls[0]?.init.headers as Record<string, string>)['authorization']).toBe(`Bearer ${TOKEN}`);
    const bad = fakeFetch(() => json({ ok: true, name: 'something-else' }));
    await expect(fetchBridgeStatus('http://127.0.0.1:8790', TOKEN, bad.fetch)).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('maps a refused connection to bridge_offline', async () => {
    const f = fakeFetch(() => {
      throw new TypeError('fetch failed');
    });
    await expect(fetchBridgeStatus('http://127.0.0.1:8790', TOKEN, f.fetch)).rejects.toMatchObject({ code: 'network', reason: 'bridge_offline' });
  });
  it('maps bridge error bodies to ProviderErrors with reasons', async () => {
    const cases: Array<[number, string, string]> = [
      [401, 'unauthorized', 'auth'],
      [424, 'not_logged_in', 'auth'],
      [503, 'cli_missing', 'not_found'],
      [429, 'rate_limited', 'rate_limit'],
      [504, 'timeout', 'timeout'],
      [502, 'tool_violation', 'invalid_response'],
    ];
    for (const [status, code, mapped] of cases) {
      const f = fakeFetch(() => json({ error: { code, message: `m-${code}` } }, status, { 'retry-after': '7' }));
      const p = createBridgeProvider({ baseUrl: 'http://127.0.0.1:8790', token: TOKEN, backend: 'codex', fetch: f.fetch });
      const err = await p.complete(REQ).catch((e: unknown) => e);
      expect(err).toMatchObject({ code: mapped, reason: code, message: `m-${code}`, retryAfterMs: 7000 });
    }
  });
  it('sends backend/model/effort with the request and validates the completion', async () => {
    const f = fakeFetch(() => json({ content: [{ type: 'text', text: 'ok' }], stopReason: 'end' }));
    const p = createBridgeProvider({ baseUrl: 'http://localhost:8790', token: TOKEN, backend: 'claude-code', model: 'haiku', effort: 'low', fetch: f.fetch });
    expect(p.name).toBe('claude-code');
    await expect(p.complete(REQ)).resolves.toMatchObject({ stopReason: 'end' });
    expect(JSON.parse(String(f.calls[0]?.init.body))).toMatchObject({ backend: 'claude-code', model: 'haiku', effort: 'low', request: { role: 'planner' } });
    const bad = fakeFetch(() => json({ content: 'nope' }));
    await expect(createBridgeProvider({ baseUrl: 'http://localhost:8790', token: TOKEN, backend: 'codex', fetch: bad.fetch }).complete(REQ)).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('aborts with the caller signal', async () => {
    const f = fakeFetch((_url, init) => new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    const ctrl = new AbortController();
    const pending = createBridgeProvider({ baseUrl: 'http://localhost:8790', token: TOKEN, backend: 'codex', fetch: f.fetch }).complete(REQ, ctrl.signal);
    ctrl.abort();
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
  });
});

describe('createFallbackProvider', () => {
  const failing = (err: unknown): Provider => ({ name: 'codex', complete: async () => Promise.reject(err) });
  it('switches to the fallback once, reports why and stays there', async () => {
    const notices: unknown[] = [];
    let primaryCalls = 0;
    const primary: Provider = {
      name: 'codex',
      complete: async () => {
        primaryCalls++;
        throw new ProviderError('network', 'down', { reason: 'bridge_offline' });
      },
    };
    const p = createFallbackProvider({ primary, fallback: createMockProvider(), onFallback: (n) => notices.push(n) });
    expect(p.name).toBe('codex');
    const res = await p.complete({ role: 'planner', system: 's', messages: [{ role: 'user', content: 'a forest' }] });
    expect(res.model).toBe('aether-mock');
    await p.complete({ role: 'planner', system: 's', messages: [{ role: 'user', content: 'more' }] });
    expect(primaryCalls).toBe(1);
    expect(notices).toEqual([{ from: 'codex', to: 'mock', code: 'network', reason: 'bridge_offline', message: 'down' }]);
    expect(p.name).toBe('mock');
    expect(p.fellBack?.reason).toBe('bridge_offline');
  });
  it('never falls back on a caller abort', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const p = createFallbackProvider({ primary: failing(new ProviderError('aborted', 'aborted')), fallback: createMockProvider() });
    await expect(p.complete(REQ, ctrl.signal)).rejects.toMatchObject({ code: 'aborted' });
    expect(p.fellBack).toBeNull();
  });
});

describe('createWebLlmProvider', () => {
  it('sends a JSON-schema-constrained request and maps the reply to tool calls', async () => {
    const seen: unknown[] = [];
    const engine: WebLlmEngineLike = {
      chat: {
        completions: {
          create: async (r) => {
            seen.push(r);
            return { choices: [{ message: { content: JSON.stringify({ tool_calls: [{ name: 'finish', input: { message: 'ok' } }] }) } }], usage: { prompt_tokens: 12, completion_tokens: 3 } };
          },
        },
      },
    };
    const p = createWebLlmProvider({ engine, model: 'Qwen2.5-3B-Instruct-q4f16_1-MLC' });
    const res = await p.complete({ ...REQ, tools: [{ name: 'finish', description: 'd', inputSchema: { type: 'object' } }] });
    expect(res).toMatchObject({ stopReason: 'tool_use', model: 'Qwen2.5-3B-Instruct-q4f16_1-MLC', usage: { inputTokens: 12, outputTokens: 3 } });
    const r = seen[0] as { response_format: { type: string; schema: string }; messages: Array<{ role: string }> };
    expect(r.response_format.type).toBe('json_object');
    expect(JSON.parse(r.response_format.schema)).toMatchObject({ type: 'object' });
    expect(r.messages.map((m) => m.role)).toEqual(['system', 'user']);
  });
  it('interrupts generation on abort and wraps engine failures', async () => {
    let interrupted = false;
    const ctrl = new AbortController();
    const engine: WebLlmEngineLike = {
      chat: { completions: { create: () => new Promise((_res, rej) => setTimeout(() => rej(new Error('interrupted')), 5)) } },
      interruptGenerate: () => {
        interrupted = true;
      },
    };
    const pending = createWebLlmProvider({ engine, model: 'm' }).complete(REQ, ctrl.signal);
    ctrl.abort();
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
    expect(interrupted).toBe(true);
    const broken: WebLlmEngineLike = { chat: { completions: { create: async () => Promise.reject(new Error('GPU lost')) } } };
    await expect(createWebLlmProvider({ engine: broken, model: 'm' }).complete(REQ)).rejects.toMatchObject({ code: 'server', reason: 'webllm_error' });
  });
});
