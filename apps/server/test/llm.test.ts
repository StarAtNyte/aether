import { afterAll, describe, expect, it } from 'vitest';
import { createLogger } from '../src/logger';
import { mapUpstreamError, upstreamStatusOf } from '../src/llm/errors';
import { PNG_DATA_URL, TEST_MODELS, cleanupDirs, completionBody, fakeProvider, jsonInit, live, makeApp, makeConfig, okProvider } from './helpers';

afterAll(cleanupDirs);

const post = (body: unknown, headers: Record<string, string> = {}) => jsonInit('POST', body, headers);

describe('POST /api/llm — mock mode', () => {
  it('answers 503 mock-mode when no provider is configured', async () => {
    const res = await makeApp(makeConfig()).request('/api/llm', post(completionBody()));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'mock-mode' });
  });
});

describe('POST /api/llm — validation', () => {
  const app = () => makeApp(makeConfig({ RATE_LIMIT_LLM_BURST: '1000' }), { llm: live(okProvider()) });

  async function expectInvalid(body: unknown, status = 400, error = 'invalid-request'): Promise<void> {
    const res = await app().request('/api/llm', post(body));
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ error });
  }

  it('accepts a minimal valid request', async () => {
    const res = await app().request('/api/llm', post(completionBody()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ content: [{ type: 'text', text: 'hello' }], stopReason: 'end' });
  });

  it('rejects a bad role', () => expectInvalid(completionBody({ role: 'admin' })));
  it('rejects unknown keys', () => expectInvalid(completionBody({ apiKey: 'x' })));
  it('rejects an oversized system prompt', () => expectInvalid(completionBody({ system: 'x'.repeat(60_001) })));
  it('rejects too many messages', () =>
    expectInvalid(completionBody({ messages: Array.from({ length: 61 }, () => ({ role: 'user', content: 'x' })) })));
  it('rejects empty messages', () => expectInvalid(completionBody({ messages: [] })));
  it('rejects too many tools', () =>
    expectInvalid(completionBody({ tools: Array.from({ length: 17 }, (_, i) => ({ name: `t${i}`, description: '', inputSchema: {} })) })));
  it('rejects duplicate tool names', () =>
    expectInvalid(completionBody({ tools: [0, 1].map(() => ({ name: 'dup', description: '', inputSchema: {} })) })));

  it('rejects too many images', () =>
    expectInvalid(
      completionBody({ messages: [{ role: 'user', content: Array.from({ length: 5 }, () => ({ type: 'image', dataUrl: PNG_DATA_URL })) }] }),
    ));

  it('accepts up to four valid images', async () => {
    const res = await app().request(
      '/api/llm',
      post(completionBody({ messages: [{ role: 'user', content: Array.from({ length: 4 }, () => ({ type: 'image', dataUrl: PNG_DATA_URL })) }] })),
    );
    expect(res.status).toBe(200);
  });

  it('rejects disallowed image MIME types', async () => {
    for (const dataUrl of ['data:image/svg+xml;base64,PHN2Zz4=', 'data:image/gif;base64,R0lGOD==', 'https://example.com/a.png', 'data:text/html;base64,PGI+']) {
      await expectInvalid(completionBody({ messages: [{ role: 'user', content: [{ type: 'image', dataUrl }] }] }));
    }
  });

  it('rejects oversize images even when the body cap is raised', async () => {
    const big = makeApp(makeConfig({ AETHER_LLM_MAX_BODY_BYTES: String(4 * 1024 * 1024) }), { llm: live(okProvider()) });
    const res = await big.request(
      '/api/llm',
      post(completionBody({ messages: [{ role: 'user', content: [{ type: 'image', dataUrl: `data:image/png;base64,${'A'.repeat(1_500_000)}` }] }] })),
    );
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('too large');
  });

  it('rejects bodies above 1 MB with 413', async () => {
    const res = await app().request('/api/llm', post(completionBody({ messages: [{ role: 'user', content: 'x'.repeat(1_100_000) }] })));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: 'payload-too-large' });
  });

  it('rejects non-JSON content types and malformed JSON', async () => {
    const wrongType = await app().request('/api/llm', { method: 'POST', body: '{}', headers: { 'Content-Type': 'text/plain' } });
    expect(wrongType.status).toBe(415);
    await expectInvalid('{not json', 400, 'invalid-json');
  });

  it('rejects prototype-pollution keys', () => expectInvalid('{"role":"planner","__proto__":{"x":1}}', 400, 'unsafe-input'));
});

describe('POST /api/llm — model selection and limits', () => {
  it('maps role to the server-side model and ignores client-supplied model', async () => {
    const provider = okProvider();
    const app = makeApp(makeConfig({ RATE_LIMIT_LLM_BURST: '100' }), { llm: live(provider) });
    for (const role of ['planner', 'coder', 'critic'] as const) {
      const res = await app.request('/api/llm', post(completionBody({ role, model: 'gpt-expensive-ultra' })));
      expect(res.status).toBe(200);
      expect((await res.json()).model).toBe(TEST_MODELS[role]);
    }
    expect(provider.calls.map((c) => c.req.model)).toEqual([TEST_MODELS.planner, TEST_MODELS.coder, TEST_MODELS.critic]);
  });

  it('caps maxTokens at the configured output limit', async () => {
    const provider = okProvider();
    const app = makeApp(makeConfig({ AETHER_MAX_OUTPUT_TOKENS: '1000' }), { llm: live(provider) });
    await app.request('/api/llm', post(completionBody({ maxTokens: 999_999 })));
    await app.request('/api/llm', post(completionBody({ maxTokens: 50 })));
    await app.request('/api/llm', post(completionBody()));
    expect(provider.calls.map((c) => c.req.maxTokens)).toEqual([1000, 50, 1000]);
  });

  it('rejects malformed upstream responses with 502', async () => {
    const provider = fakeProvider(async () => ({ content: 'not-an-array', stopReason: 'end' }));
    const res = await makeApp(makeConfig(), { llm: live(provider) }).request('/api/llm', post(completionBody()));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'upstream-invalid-response' });
  });
});

describe('POST /api/llm — upstream failures', () => {
  const cases: Array<[unknown, number, string]> = [
    [Object.assign(new Error('Unauthorized: invalid x-api-key sk-ant-leakme12345'), { status: 401 }), 502, 'upstream-auth'],
    [Object.assign(new Error('rate limited'), { status: 429 }), 503, 'upstream-rate-limited'],
    [Object.assign(new Error('overloaded'), { status: 529 }), 503, 'upstream-rate-limited'],
    [Object.assign(new Error('bad'), { status: 400 }), 502, 'upstream-bad-request'],
    [Object.assign(new Error('boom'), { status: 500 }), 502, 'upstream-unavailable'],
    [Object.assign(new Error('socket hang up'), { code: 'network' }), 502, 'upstream-unavailable'],
    [Object.assign(new Error('slow'), { code: 'timeout' }), 504, 'upstream-timeout'],
    ['weird string throw', 502, 'upstream-error'],
  ];

  it.each(cases)('maps %s to a safe error', async (thrown, status, code) => {
    const lines: string[] = [];
    const logger = createLogger({ level: 'debug', sink: (l) => lines.push(l), secrets: ['sk-ant-leakme12345'] });
    const provider = fakeProvider(async () => {
      throw thrown;
    });
    const config = makeConfig({ ANTHROPIC_API_KEY: 'sk-ant-leakme12345' });
    const res = await makeApp(config, { llm: live(provider), logger }).request('/api/llm', post(completionBody()));
    expect(res.status).toBe(status);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ error: code });
    expect(text).not.toContain('leakme');
    expect(text).not.toContain('Unauthorized');
    expect(lines.join('\n')).not.toContain('sk-ant-leakme12345');
  });

  it('times out slow upstream calls and aborts them', async () => {
    let aborted = false;
    const provider = fakeProvider(
      (_req, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('aborted'));
          });
        }),
    );
    const config = { ...makeConfig(), llm: { ...makeConfig().llm, timeoutMs: 30 } };
    const res = await makeApp(config, { llm: live(provider) }).request('/api/llm', post(completionBody()));
    expect(res.status).toBe(504);
    expect(await res.json()).toMatchObject({ error: 'upstream-timeout' });
    expect(aborted).toBe(true);
  });

  it('aborts the upstream call when the client disconnects', async () => {
    const client = new AbortController();
    let upstreamSignal: AbortSignal | undefined;
    const provider = fakeProvider(
      (_req, signal) =>
        new Promise((_resolve, reject) => {
          upstreamSignal = signal;
          signal?.addEventListener('abort', () => reject(new Error('aborted')));
          setTimeout(() => client.abort(), 5);
        }),
    );
    const app = makeApp(makeConfig(), { llm: live(provider) });
    const res = await app.request('/api/llm', { ...post(completionBody()), signal: client.signal });
    expect(upstreamSignal?.aborted).toBe(true);
    expect(res.status).toBe(408);
  });

  it('aborts in-flight calls on shutdown', async () => {
    const shutdown = new AbortController();
    const provider = fakeProvider(
      (_req, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('aborted')));
          setTimeout(() => shutdown.abort(), 5);
        }),
    );
    const res = await makeApp(makeConfig(), { llm: live(provider), shutdownSignal: shutdown.signal }).request('/api/llm', post(completionBody()));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'shutting-down' });
  });
});

describe('daily token budget', () => {
  it('returns 429 once the daily budget is spent and resets the next UTC day', async () => {
    let now = Date.UTC(2026, 9, 13, 12, 0, 0);
    const provider = okProvider({ inputTokens: 60, outputTokens: 40 });
    const app = makeApp(makeConfig({ AETHER_DAILY_TOKEN_BUDGET: '150', RATE_LIMIT_LLM_BURST: '100' }), { llm: live(provider), now: () => now });
    expect((await app.request('/api/llm', post(completionBody()))).status).toBe(200); // 100 used
    expect((await app.request('/api/llm', post(completionBody()))).status).toBe(200); // 200 used
    const blocked = await app.request('/api/llm', post(completionBody()));
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ error: 'token-budget-exhausted' });
    expect(Number(blocked.headers.get('retry-after'))).toBe(12 * 3600);
    expect(provider.calls).toHaveLength(2);
    now = Date.UTC(2026, 9, 14, 0, 0, 1);
    expect((await app.request('/api/llm', post(completionBody()))).status).toBe(200);
  });

  it('estimates usage when upstream omits it', async () => {
    const provider = fakeProvider(async () => ({ content: [{ type: 'text', text: 'x'.repeat(4000) }], stopReason: 'end' }));
    const app = makeApp(makeConfig({ AETHER_DAILY_TOKEN_BUDGET: '500' }), { llm: live(provider) });
    expect((await app.request('/api/llm', post(completionBody()))).status).toBe(200);
    expect((await app.request('/api/llm', post(completionBody()))).status).toBe(429);
  });

  it('is disabled with a budget of 0', async () => {
    const app = makeApp(makeConfig({ AETHER_DAILY_TOKEN_BUDGET: '0', RATE_LIMIT_LLM_BURST: '100' }), {
      llm: live(okProvider({ inputTokens: 1e9, outputTokens: 1e9 })),
    });
    for (let i = 0; i < 3; i++) expect((await app.request('/api/llm', post(completionBody()))).status).toBe(200);
  });
});

describe('upstream error helpers', () => {
  it('extracts statuses from several error shapes', () => {
    expect(upstreamStatusOf({ status: 401 })).toBe(401);
    expect(upstreamStatusOf({ statusCode: 503 })).toBe(503);
    expect(upstreamStatusOf({ response: { status: 429 } })).toBe(429);
    expect(upstreamStatusOf(new Error('HTTP 404 not found'))).toBe(404);
    expect(upstreamStatusOf({ status: 99999 })).toBeUndefined();
    expect(upstreamStatusOf(null)).toBeUndefined();
  });

  it('prefers the timeout flag', () => {
    expect(mapUpstreamError({ status: 401 }, true).code).toBe('upstream-timeout');
  });
});
