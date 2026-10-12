import { describe, expect, it } from 'vitest';
import { createAnthropicProvider } from '../src/providers/anthropic';
import { ProviderError } from '../src/providers/errors';
import { createHttpProvider } from '../src/providers/http';
import { createOpenAIProvider } from '../src/providers/openai';
import { postJson } from '../src/providers/transport';
import { AGENT_TOOLS } from '../src/tools';
import type { ChatMessage, CompletionRequest } from '../src/types';

interface Recorded {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

type Reply = { status: number; body: unknown; headers?: Record<string, string> } | 'hang' | 'network-error';

/** Fake fetch replaying canned replies; never touches the network. */
function fakeFetch(replies: Reply[]): { fetch: typeof fetch; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    const reply = replies.shift() ?? { status: 500, body: { error: { message: 'script exhausted' } } };
    if (reply === 'network-error') throw new TypeError('fetch failed');
    if (reply === 'hang') {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
      });
    }
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json', ...reply.headers } });
  };
  return { fetch: fn as typeof fetch, calls };
}

const FAST = { sleep: async () => undefined, random: () => 0.5, timeoutMs: 1000 };
const MODELS = { planner: 'claude-haiku-5-5', coder: 'claude-sonnet-5-5', critic: 'claude-opus-5-5' };

const conversation: ChatMessage[] = [
  { role: 'user', content: [{ type: 'image', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' }, { type: 'text', text: 'build a castle' }] },
  { role: 'assistant', content: [{ type: 'text', text: 'Building.' }, { type: 'tool_use', id: 'toolu_1', name: 'apply_patches', input: { patches: [], message: 'm' } }] },
  { role: 'user', content: [{ type: 'text', text: 'note' }, { type: 'tool_result', toolUseId: 'toolu_1', content: 'Applied 0/0', isError: true }] },
];

const req = (over: Partial<CompletionRequest> = {}): CompletionRequest => ({ role: 'planner', system: 'SYSTEM', messages: conversation, tools: AGENT_TOOLS, maxTokens: 2000, ...over });

const anthropicOk = {
  id: 'msg_1',
  model: 'claude-haiku-5-5',
  stop_reason: 'tool_use',
  content: [
    { type: 'thinking', thinking: '', signature: 'sig-abc' },
    { type: 'text', text: 'Plan' },
    { type: 'tool_use', id: 'toolu_2', name: 'finish', input: { message: 'ok' } },
  ],
  usage: { input_tokens: 10, cache_read_input_tokens: 900, cache_creation_input_tokens: 0, output_tokens: 42 },
};

describe('Anthropic provider', () => {
  it('builds a correct Messages API request', async () => {
    const f = fakeFetch([{ status: 200, body: anthropicOk }]);
    const p = createAnthropicProvider({ apiKey: 'sk-test', models: MODELS, fetch: f.fetch, retry: FAST });
    await p.complete(req());
    const call = f.calls[0]!;
    expect(call.url).toBe('https://api.anthropic.com/v1/messages');
    expect(call.headers['x-api-key']).toBe('sk-test');
    expect(call.headers['anthropic-version']).toBe('2023-06-01');
    expect(call.body['model']).toBe('claude-haiku-5-5');
    expect(call.body['max_tokens']).toBe(2000);
    expect(call.body['output_config']).toEqual({ effort: 'medium' });
    expect(call.body['temperature']).toBeUndefined();
    expect(call.body['thinking']).toBeUndefined();
    expect(call.body['system']).toEqual([{ type: 'text', text: 'SYSTEM', cache_control: { type: 'ephemeral' } }]);
    const tools = call.body['tools'] as Array<Record<string, unknown>>;
    expect(tools.map((t) => t['name'])).toEqual(AGENT_TOOLS.map((t) => t.name));
    expect(tools[0]).toMatchObject({ input_schema: AGENT_TOOLS[0]!.inputSchema });
    expect(tools.filter((t) => t['cache_control'])).toHaveLength(1);
    expect(tools.at(-1)!['cache_control']).toEqual({ type: 'ephemeral' });
    const msgs = call.body['messages'] as Array<{ role: string; content: Array<Record<string, unknown>> }>;
    expect(msgs[0]!.content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } });
    expect(msgs[1]!.content[1]).toEqual({ type: 'tool_use', id: 'toolu_1', name: 'apply_patches', input: { patches: [], message: 'm' } });
    // tool_result blocks are moved to the front of the user turn.
    expect(msgs[2]!.content[0]).toEqual({ type: 'tool_result', tool_use_id: 'toolu_1', content: 'Applied 0/0', is_error: true });
    expect(msgs[2]!.content[1]).toEqual({ type: 'text', text: 'note' });
  });

  it('uses role models and per-role effort', async () => {
    const f = fakeFetch([{ status: 200, body: anthropicOk }]);
    await createAnthropicProvider({ apiKey: 'k', models: MODELS, fetch: f.fetch, retry: FAST, effort: { coder: 'xhigh' } }).complete(req({ role: 'coder', tools: [] }));
    expect(f.calls[0]!.body['model']).toBe('claude-sonnet-5-5');
    expect(f.calls[0]!.body['output_config']).toEqual({ effort: 'xhigh' });
    expect(f.calls[0]!.body['tools']).toBeUndefined();
  });

  it('normalizes the response and replays thinking blocks verbatim', async () => {
    const f = fakeFetch([{ status: 200, body: anthropicOk }, { status: 200, body: { ...anthropicOk, stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] } }]);
    const p = createAnthropicProvider({ apiKey: 'k', models: MODELS, fetch: f.fetch, retry: FAST });
    const res = await p.complete(req());
    expect(res.stopReason).toBe('tool_use');
    expect(res.content).toEqual([{ type: 'text', text: 'Plan' }, { type: 'tool_use', id: 'toolu_2', name: 'finish', input: { message: 'ok' } }]);
    expect(res.usage).toEqual({ inputTokens: 910, outputTokens: 42 });
    await p.complete(req({ messages: [...conversation, { role: 'assistant', content: res.content }, { role: 'user', content: [{ type: 'tool_result', toolUseId: 'toolu_2', content: 'ok' }] }] }));
    const msgs = f.calls[1]!.body['messages'] as Array<{ content: Array<Record<string, unknown>> }>;
    expect(msgs[3]!.content[0]).toEqual({ type: 'thinking', thinking: '', signature: 'sig-abc' });
  });

  it('maps refusals and max_tokens', async () => {
    const f = fakeFetch([{ status: 200, body: { ...anthropicOk, stop_reason: 'refusal', content: [] } }, { status: 200, body: { ...anthropicOk, stop_reason: 'max_tokens' } }]);
    const p = createAnthropicProvider({ apiKey: 'k', models: MODELS, fetch: f.fetch, retry: FAST });
    expect((await p.complete(req())).stopReason).toBe('error');
    expect((await p.complete(req())).stopReason).toBe('max_tokens');
  });

  it('retries 429 and 529 then succeeds, honoring retry-after', async () => {
    const waits: number[] = [];
    const f = fakeFetch([
      { status: 429, body: { error: { message: 'rate limited' } }, headers: { 'retry-after': '2' } },
      { status: 529, body: { error: { message: 'overloaded' } } },
      { status: 200, body: anthropicOk },
    ]);
    const p = createAnthropicProvider({ apiKey: 'k', models: MODELS, fetch: f.fetch, retry: { ...FAST, sleep: async (ms) => { waits.push(ms); } } });
    const res = await p.complete(req());
    expect(res.stopReason).toBe('tool_use');
    expect(f.calls).toHaveLength(3);
    expect(waits[0]).toBe(2000);
    expect(waits[1]).toBeGreaterThanOrEqual(500);
  });

  it('gives up after 3 retries on 5xx', async () => {
    const f = fakeFetch(Array.from({ length: 5 }, () => ({ status: 500, body: { error: { message: 'boom' } } })));
    const p = createAnthropicProvider({ apiKey: 'k', models: MODELS, fetch: f.fetch, retry: FAST });
    await expect(p.complete(req())).rejects.toMatchObject({ code: 'server', status: 500 });
    expect(f.calls).toHaveLength(4);
  });

  it('does not retry 400 / 401 and keeps the vendor message', async () => {
    for (const [status, code] of [[400, 'bad_request'], [401, 'auth']] as const) {
      const f = fakeFetch([{ status, body: { type: 'error', error: { type: 'invalid_request_error', message: 'messages: bad' } } }, { status: 200, body: anthropicOk }]);
      const p = createAnthropicProvider({ apiKey: 'k', models: MODELS, fetch: f.fetch, retry: FAST });
      const err = await p.complete(req()).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ProviderError);
      expect(err).toMatchObject({ code, retryable: false });
      expect((err as Error).message).toContain('messages: bad');
      expect(f.calls).toHaveLength(1);
    }
  });

  it('times out hung requests and retries them', async () => {
    const f = fakeFetch(['hang', { status: 200, body: anthropicOk }]);
    const p = createAnthropicProvider({ apiKey: 'k', models: MODELS, fetch: f.fetch, retry: { ...FAST, timeoutMs: 20 } });
    expect((await p.complete(req())).stopReason).toBe('tool_use');
    expect(f.calls).toHaveLength(2);
  });

  it('reports timeout after exhausting retries', async () => {
    const f = fakeFetch(['hang', 'hang']);
    const p = createAnthropicProvider({ apiKey: 'k', models: MODELS, fetch: f.fetch, retry: { ...FAST, timeoutMs: 10, maxRetries: 1 } });
    await expect(p.complete(req())).rejects.toMatchObject({ code: 'timeout' });
  });

  it('caller abort wins and is not retried', async () => {
    const f = fakeFetch(['hang', { status: 200, body: anthropicOk }]);
    const p = createAnthropicProvider({ apiKey: 'k', models: MODELS, fetch: f.fetch, retry: { ...FAST, timeoutMs: 5000 } });
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 10);
    await expect(p.complete(req(), ctrl.signal)).rejects.toMatchObject({ code: 'aborted' });
    expect(f.calls).toHaveLength(1);
  });

  it('retries network errors', async () => {
    const f = fakeFetch(['network-error', { status: 200, body: anthropicOk }]);
    const p = createAnthropicProvider({ apiKey: 'k', models: MODELS, fetch: f.fetch, retry: FAST });
    expect((await p.complete(req())).stopReason).toBe('tool_use');
  });

  it('rejects malformed responses, bad images and missing keys', async () => {
    const f = fakeFetch([{ status: 200, body: { nope: true } }]);
    const p = createAnthropicProvider({ apiKey: 'k', models: MODELS, fetch: f.fetch, retry: FAST });
    await expect(p.complete(req())).rejects.toMatchObject({ code: 'invalid_response' });
    await expect(p.complete(req({ messages: [{ role: 'user', content: [{ type: 'image', dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }] }] }))).rejects.toMatchObject({ code: 'bad_request' });
    expect(() => createAnthropicProvider({ apiKey: '', models: MODELS })).toThrow(ProviderError);
  });

  it('honors a custom base URL', async () => {
    const f = fakeFetch([{ status: 200, body: anthropicOk }]);
    await createAnthropicProvider({ apiKey: 'k', models: MODELS, fetch: f.fetch, retry: FAST, baseUrl: 'https://proxy.example/' }).complete(req());
    expect(f.calls[0]!.url).toBe('https://proxy.example/v1/messages');
  });
});

const openaiOk = {
  id: 'resp_1',
  model: 'gpt-6-luna',
  status: 'completed',
  output: [
    { type: 'reasoning', id: 'rs_1', encrypted_content: 'enc', summary: [] },
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Plan' }] },
    { type: 'function_call', call_id: 'call_9', name: 'apply_patches', arguments: '{"patches":[],"message":"m"}' },
  ],
  usage: { input_tokens: 50, output_tokens: 7 },
};

describe('OpenAI provider', () => {
  const OAI = { planner: 'gpt-6-luna', coder: 'gpt-6.1-sol', critic: 'gpt-6.1-sol' };

  it('builds a Responses API request with instructions, input items and function tools', async () => {
    const f = fakeFetch([{ status: 200, body: openaiOk }]);
    await createOpenAIProvider({ apiKey: 'sk-oa', models: OAI, fetch: f.fetch, retry: FAST }).complete(req());
    const call = f.calls[0]!;
    expect(call.url).toBe('https://api.openai.com/v1/responses');
    expect(call.headers['authorization']).toBe('Bearer sk-oa');
    expect(call.body).toMatchObject({ model: 'gpt-6-luna', instructions: 'SYSTEM', max_output_tokens: 2000, store: false, reasoning: { effort: 'low' }, include: ['reasoning.encrypted_content'] });
    const tools = call.body['tools'] as Array<Record<string, unknown>>;
    expect(tools[0]).toEqual({ type: 'function', name: 'apply_patches', description: AGENT_TOOLS[0]!.description, parameters: AGENT_TOOLS[0]!.inputSchema, strict: false });
    const input = call.body['input'] as Array<Record<string, unknown>>;
    expect(input[0]).toEqual({ type: 'message', role: 'user', content: [{ type: 'input_image', image_url: 'data:image/png;base64,iVBORw0KGgo=' }, { type: 'input_text', text: 'build a castle' }] });
    expect(input[1]).toEqual({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Building.' }] });
    expect(input[2]).toEqual({ type: 'function_call', call_id: 'toolu_1', name: 'apply_patches', arguments: '{"patches":[],"message":"m"}' });
    expect(input[3]).toEqual({ type: 'function_call_output', call_id: 'toolu_1', output: 'ERROR: Applied 0/0' });
    expect(input[4]).toEqual({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'note' }] });
  });

  it('parses function calls into tool_use and replays reasoning items', async () => {
    const f = fakeFetch([{ status: 200, body: openaiOk }, { status: 200, body: { ...openaiOk, output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] }] } }]);
    const p = createOpenAIProvider({ apiKey: 'k', models: OAI, fetch: f.fetch, retry: FAST });
    const res = await p.complete(req());
    expect(res.stopReason).toBe('tool_use');
    expect(res.content).toEqual([{ type: 'text', text: 'Plan' }, { type: 'tool_use', id: 'call_9', name: 'apply_patches', input: { patches: [], message: 'm' } }]);
    expect(res.usage).toEqual({ inputTokens: 50, outputTokens: 7 });
    await p.complete(req({ messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: res.content }, { role: 'user', content: [{ type: 'tool_result', toolUseId: 'call_9', content: 'done' }] }] }));
    const input = f.calls[1]!.body['input'] as Array<Record<string, unknown>>;
    expect(input[1]).toMatchObject({ type: 'reasoning', encrypted_content: 'enc' });
    expect(input.at(-1)).toEqual({ type: 'function_call_output', call_id: 'call_9', output: 'done' });
  });

  it('keeps malformed arguments as a string for the agent to report', async () => {
    const f = fakeFetch([{ status: 200, body: { ...openaiOk, output: [{ type: 'function_call', call_id: 'c', name: 'finish', arguments: '{bad' }] } }]);
    const res = await createOpenAIProvider({ apiKey: 'k', models: OAI, fetch: f.fetch, retry: FAST }).complete(req());
    expect(res.content[0]).toEqual({ type: 'tool_use', id: 'c', name: 'finish', input: '{bad' });
  });

  it('maps incomplete, failed and refusal responses', async () => {
    const f = fakeFetch([
      { status: 200, body: { ...openaiOk, status: 'incomplete', output: [] } },
      { status: 200, body: { ...openaiOk, status: 'failed', error: { message: 'server_error' }, output: [] } },
      { status: 200, body: { ...openaiOk, output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'no' }] }] } },
    ]);
    const p = createOpenAIProvider({ apiKey: 'k', models: OAI, fetch: f.fetch, retry: { ...FAST, maxRetries: 0 } });
    expect((await p.complete(req())).stopReason).toBe('max_tokens');
    await expect(p.complete(req())).rejects.toMatchObject({ code: 'server' });
    expect((await p.complete(req())).stopReason).toBe('error');
  });

  it('retries 429 then succeeds; no retry on 400', async () => {
    const f = fakeFetch([{ status: 429, body: { error: { message: 'slow down' } } }, { status: 200, body: openaiOk }, { status: 400, body: { error: { message: 'bad schema' } } }]);
    const p = createOpenAIProvider({ apiKey: 'k', models: OAI, fetch: f.fetch, retry: FAST });
    expect((await p.complete(req())).stopReason).toBe('tool_use');
    await expect(p.complete(req())).rejects.toMatchObject({ code: 'bad_request', message: expect.stringContaining('bad schema') });
    expect(f.calls).toHaveLength(3);
  });
});

describe('HTTP proxy provider', () => {
  it('posts the request without a model and validates the response', async () => {
    const f = fakeFetch([{ status: 200, body: { content: [{ type: 'text', text: 'hi' }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 2 } } }]);
    const p = createHttpProvider({ endpoint: '/api/llm', fetch: f.fetch, retry: FAST });
    const res = await p.complete(req({ model: 'gpt-evil-expensive' }));
    expect(res).toEqual({ content: [{ type: 'text', text: 'hi' }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 2 } });
    expect(f.calls[0]!.url).toBe('/api/llm');
    expect(f.calls[0]!.body['model']).toBeUndefined();
    expect(f.calls[0]!.body['role']).toBe('planner');
  });

  it('rejects malformed server responses', async () => {
    const f = fakeFetch([{ status: 200, body: { content: 'nope', stopReason: 'weird' } }]);
    await expect(createHttpProvider({ endpoint: '/api/llm', fetch: f.fetch, retry: FAST }).complete(req())).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('maps server errors (string or object) and retries 503', async () => {
    const f = fakeFetch([{ status: 503, body: { error: 'upstream down' } }, { status: 413, body: { error: { message: 'body too large' } } }]);
    const err = await createHttpProvider({ endpoint: '/api/llm', fetch: f.fetch, retry: FAST }).complete(req()).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'too_large', message: expect.stringContaining('body too large') });
    expect(f.calls).toHaveLength(2);
  });
});

describe('transport', () => {
  it('caps response size', async () => {
    const big = 'x'.repeat(2000);
    const f = fakeFetch([{ status: 200, body: { big } }]);
    await expect(postJson({ url: 'u', headers: {}, body: {}, fetch: f.fetch, policy: FAST, maxResponseBytes: 1000 })).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('backoff grows exponentially with jitter and is capped', async () => {
    const waits: number[] = [];
    const f = fakeFetch(Array.from({ length: 4 }, () => ({ status: 500, body: {} })));
    await postJson({ url: 'u', headers: {}, body: {}, fetch: f.fetch, policy: { sleep: async (ms) => { waits.push(ms); }, random: () => 1, baseDelayMs: 100, maxDelayMs: 300 } }).catch(() => undefined);
    expect(waits).toEqual([100, 200, 300]);
  });
});
