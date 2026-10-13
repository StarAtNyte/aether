import { afterAll, describe, expect, it } from 'vitest';
import { cleanupDirs, makeApp, makeConfig } from './helpers';
import type { Logger } from '../src/logger';

/** Unscrubbed recording logger: proves the key is never handed to the logger at all. */
function memoryLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const rec = (msg: string, f?: unknown): void => void lines.push(`${msg} ${JSON.stringify(f ?? {})}`);
  return { lines, logger: { debug: rec, info: rec, warn: rec, error: rec } };
}

const KEY = 'sk-ant-test-0123456789abcdefghij';
const BODY = JSON.stringify({ role: 'planner', system: 's', messages: [{ role: 'user', content: 'hi' }] });

function upstream(reply: { status: number; body: unknown }): { fetch: typeof fetch; calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> } {
  const calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  return {
    calls,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  };
}

const headers = (extra: Record<string, string> = {}): Record<string, string> => ({ 'content-type': 'application/json', 'x-aether-provider': 'anthropic', 'x-aether-key': KEY, ...extra });

afterAll(cleanupDirs);

describe('POST /api/llm/byok', () => {
  it('forwards the visitor key to the provider once, with the allowlisted role model', async () => {
    const up = upstream({ status: 200, body: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'hello' }], usage: { input_tokens: 1, output_tokens: 1 } } });
    const app = makeApp(makeConfig(), { byokFetch: up.fetch });
    const res = await app.request('/api/llm/byok', { method: 'POST', headers: headers(), body: BODY });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ content: [{ type: 'text', text: 'hello' }], model: 'claude-haiku-5-5' });
    expect(up.calls).toHaveLength(1);
    expect(up.calls[0]?.headers['x-api-key']).toBe(KEY);
    expect(up.calls[0]?.body['model']).toBe('claude-haiku-5-5');
  });

  it('works while the server itself is in mock mode (owner keys are never involved)', async () => {
    const up = upstream({ status: 200, body: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }], usage: {} } });
    const app = makeApp(makeConfig({ OPENAI_API_KEY: 'owner-key-should-not-be-used' }), { byokFetch: up.fetch });
    const res = await app.request('/api/llm/byok', { method: 'POST', headers: headers({ 'x-aether-provider': 'openai' }), body: BODY });
    expect(res.status).toBe(200);
    expect(up.calls[0]?.headers['authorization']).toBe(`Bearer ${KEY}`);
    expect((await app.request('/api/llm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: BODY })).status).toBe(503);
  });

  it('never logs or echoes the key, even when the provider rejects it', async () => {
    const logger = memoryLogger();
    const up = upstream({ status: 401, body: { error: { type: 'authentication_error', message: `invalid x-api-key ${KEY}` } } });
    const app = makeApp(makeConfig(), { byokFetch: up.fetch, logger: logger.logger });
    const res = await app.request('/api/llm/byok', { method: 'POST', headers: headers(), body: BODY });
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).toContain('rejected your API key');
    expect(text).not.toContain(KEY);
    expect(logger.lines.join('\n')).not.toContain(KEY);
  });

  it('validates provider, key and body; can be disabled', async () => {
    const app = makeApp(makeConfig());
    expect((await app.request('/api/llm/byok', { method: 'POST', headers: headers({ 'x-aether-provider': 'evil' }), body: BODY })).status).toBe(400);
    expect((await app.request('/api/llm/byok', { method: 'POST', headers: headers({ 'x-aether-key': 'short' }), body: BODY })).status).toBe(400);
    expect((await app.request('/api/llm/byok', { method: 'POST', headers: headers(), body: '{"role":"planner"}' })).status).toBe(400);
    const off = makeApp(makeConfig({ AETHER_BYOK: 'false' }));
    expect((await off.request('/api/llm/byok', { method: 'POST', headers: headers(), body: BODY })).status).toBe(404);
    expect(await (await off.request('/api/health')).json()).toMatchObject({ byok: false });
  });

  it('allows the BYOK headers in CORS preflights and the loopback bridge in CSP', async () => {
    const app = makeApp(makeConfig());
    const pre = await app.request('/api/llm/byok', { method: 'OPTIONS', headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST', 'access-control-request-headers': 'x-aether-key, x-aether-provider, content-type' } });
    expect((pre.headers.get('access-control-allow-headers') ?? '').toLowerCase()).toContain('x-aether-key');
    const csp = (await app.request('/api/health')).headers.get('content-security-policy') ?? '';
    expect(csp).toContain('http://127.0.0.1:*');
    expect(csp).not.toMatch(/connect-src[^;]*\s\*(\s|;)/);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });
});
