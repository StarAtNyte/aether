import { describe, expect, it } from 'vitest';
import { createAnthropicProvider } from '../src/providers/anthropic';
import { chatMessagesToWire, createChatCompletionsProvider, parseChatCompletion } from '../src/providers/chat-completions';
import { ProviderError } from '../src/providers/errors';
import { AGENT_TOOLS } from '../src/tools';
import type { ChatMessage } from '../src/types';

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function fake(replies: Array<{ status: number; body: unknown }>): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    const r = replies.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  };
  return { fetch: fn as typeof fetch, calls };
}

const FAST = { maxRetries: 0, timeoutMs: 1000 };
const MODELS = { planner: 'google/gemini-3.8-flash', coder: 'google/gemini-3.8-flash', critic: 'google/gemini-3.8-flash' };
const KEY = 'sk-or-v1-0123456789abcdef0123456789';

const conversation: ChatMessage[] = [
  { role: 'user', content: [{ type: 'image', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' }, { type: 'text', text: 'build a castle' }] },
  { role: 'assistant', content: [{ type: 'text', text: 'Building.' }, { type: 'tool_use', id: 'call_a', name: 'apply_patches', input: { patches: [] } }] },
  { role: 'user', content: [{ type: 'tool_result', toolUseId: 'call_a', content: 'ok' }, { type: 'text', text: 'and a moat' }] },
];

describe('chat completions provider', () => {
  it('converts messages: system first, tool calls, tool results before user text, images as data URLs', () => {
    const wire = chatMessagesToWire('SYS', conversation);
    expect(wire[0]).toEqual({ role: 'system', content: 'SYS' });
    expect(wire[1]).toEqual({ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } }, { type: 'text', text: 'build a castle' }] });
    expect(wire[2]).toEqual({ role: 'assistant', content: 'Building.', tool_calls: [{ id: 'call_a', type: 'function', function: { name: 'apply_patches', arguments: '{"patches":[]}' } }] });
    expect(wire[3]).toEqual({ role: 'tool', tool_call_id: 'call_a', content: 'ok' });
    expect(wire[4]).toEqual({ role: 'user', content: [{ type: 'text', text: 'and a moat' }] });
  });

  it('rejects images that are not base64 data URLs', () => {
    expect(() => chatMessagesToWire('s', [{ role: 'user', content: [{ type: 'image', dataUrl: 'https://evil.example/x.png' }] }])).toThrow(ProviderError);
  });

  it('parses text, tool calls (with missing ids), stop reasons and usage', () => {
    const r = parseChatCompletion({
      model: 'x',
      choices: [{ finish_reason: 'tool_calls', message: { content: 'Hi', tool_calls: [{ function: { name: 'apply_patches', arguments: '{"a":1}' } }, { id: 'c2', function: { name: 'finish', arguments: 'not json' } }] } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
    expect(r.stopReason).toBe('tool_use');
    expect(r.content).toEqual([
      { type: 'text', text: 'Hi' },
      { type: 'tool_use', id: 'call_0', name: 'apply_patches', input: { a: 1 } },
      { type: 'tool_use', id: 'c2', name: 'finish', input: 'not json' },
    ]);
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(parseChatCompletion({ choices: [{ finish_reason: 'length', message: { content: 'x' } }] }).stopReason).toBe('max_tokens');
    expect(parseChatCompletion({ choices: [{ finish_reason: 'content_filter', message: { content: null } }] }).stopReason).toBe('error');
    expect(() => parseChatCompletion({ nope: 1 })).toThrow(ProviderError);
    expect(() => parseChatCompletion({ choices: [] })).toThrow(ProviderError);
  });

  it('posts to <base>/chat/completions with only content-type and authorization headers', async () => {
    const f = fake([{ status: 200, body: { choices: [{ finish_reason: 'stop', message: { content: 'done' } }] } }]);
    const p = createChatCompletionsProvider({ apiKey: KEY, baseUrl: 'https://openrouter.ai/api/v1/', models: MODELS, name: 'openrouter', fetch: f.fetch, retry: FAST });
    const out = await p.complete({ role: 'planner', system: 'S', messages: conversation, tools: AGENT_TOOLS, maxTokens: 999_999 });
    expect(out.content).toEqual([{ type: 'text', text: 'done' }]);
    expect(f.calls[0]?.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(Object.keys(f.calls[0]?.headers ?? {}).sort()).toEqual(['authorization', 'content-type']);
    expect(f.calls[0]?.headers['authorization']).toBe(`Bearer ${KEY}`);
    expect(f.calls[0]?.body['model']).toBe('google/gemini-3.8-flash');
    expect(f.calls[0]?.body['max_tokens']).toBe(32_000);
    expect((f.calls[0]?.body['tools'] as unknown[]).length).toBe(AGENT_TOOLS.length);
  });

  it('maps errors (including Gemini array-wrapped errors) and never echoes the key', async () => {
    const f = fake([{ status: 400, body: [{ error: { message: 'API key not valid' } }] }]);
    const p = createChatCompletionsProvider({ apiKey: KEY, baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', models: MODELS, name: 'gemini', fetch: f.fetch, retry: FAST });
    const err = await p.complete({ role: 'planner', system: 'S', messages: [{ role: 'user', content: 'x' }] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).message).toContain('API key not valid');
    expect((err as ProviderError).message).not.toContain(KEY);
    const auth = fake([{ status: 401, body: { error: { message: 'bad' } } }]);
    const p2 = createChatCompletionsProvider({ apiKey: KEY, baseUrl: 'https://openrouter.ai/api/v1', models: MODELS, name: 'openrouter', fetch: auth.fetch, retry: FAST });
    expect(((await p2.complete({ role: 'planner', system: 'S', messages: [{ role: 'user', content: 'x' }] }).catch((e: unknown) => e)) as ProviderError).code).toBe('auth');
  });

  it('refuses a missing key or a non-https endpoint', () => {
    expect(() => createChatCompletionsProvider({ apiKey: '', baseUrl: 'https://openrouter.ai/api/v1', models: MODELS, name: 'x' })).toThrow(ProviderError);
    expect(() => createChatCompletionsProvider({ apiKey: KEY, baseUrl: 'http://evil.example', models: MODELS, name: 'x' })).toThrow(ProviderError);
  });
});

describe('anthropic provider in the browser', () => {
  it('sends the direct-browser-access header only when asked', async () => {
    const reply = { status: 200, body: { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' } };
    const browser = fake([reply]);
    await createAnthropicProvider({ apiKey: 'sk-ant-0123456789abcdef', models: { planner: 'a', coder: 'a', critic: 'a' }, fetch: browser.fetch, browser: true, retry: FAST }).complete({ role: 'planner', system: 's', messages: [{ role: 'user', content: 'x' }] });
    expect(browser.calls[0]?.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    const server = fake([reply]);
    await createAnthropicProvider({ apiKey: 'sk-ant-0123456789abcdef', models: { planner: 'a', coder: 'a', critic: 'a' }, fetch: server.fetch, retry: FAST }).complete({ role: 'planner', system: 's', messages: [{ role: 'user', content: 'x' }] });
    expect(server.calls[0]?.headers['anthropic-dangerous-direct-browser-access']).toBeUndefined();
  });
});
