import { afterEach, describe, expect, it } from 'vitest';
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { GET as health } from '../../../api/health';
import { POST as llmPost } from '../../../api/llm';
import { handleLlm, LLM_CAPS, RateLimiter, type CreateMessage, type LlmDeps } from '../../../api/_lib/llm';

const BODY = { role: 'coder', system: 'sys', messages: [{ role: 'user', content: 'hi' }], maxTokens: 999_999 };

function req(body: unknown = BODY, headers: Record<string, string> = {}, ip = '203.0.113.7'): Request {
  return new Request('https://studio.test/api/llm', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...headers } });
}

function message(over: Partial<BetaMessage> = {}): BetaMessage {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: 'ok', citations: null }, { type: 'tool_use', id: 't1', name: 'apply_patch', input: { a: 1 } }],
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 2, cache_read_input_tokens: 3 },
    ...over,
  } as unknown as BetaMessage;
}

function deps(create: CreateMessage = async () => message()): LlmDeps & { calls: Parameters<CreateMessage>[0][] } {
  const calls: Parameters<CreateMessage>[0][] = [];
  return { limiter: new RateLimiter(), calls, log: () => {}, create: async (p, s) => (calls.push(p), create(p, s)) };
}

const saved = process.env['ANTHROPIC_API_KEY'];
afterEach(() => {
  if (saved === undefined) delete process.env['ANTHROPIC_API_KEY'];
  else process.env['ANTHROPIC_API_KEY'] = saved;
});

describe('api/health', () => {
  it('reports the hosted model only when the key is set', async () => {
    delete process.env['ANTHROPIC_API_KEY'];
    expect(await health().json()).toMatchObject({ ok: true, mode: 'mock', providers: ['mock'] });
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    expect(await health().json()).toMatchObject({ ok: true, mode: 'live', providers: ['anthropic'] });
  });
});

describe('api/llm', () => {
  it('answers 503 without the key', async () => {
    delete process.env['ANTHROPIC_API_KEY'];
    expect((await llmPost(req())).status).toBe(503);
  });

  it('maps role to an allowlisted model, caps output and returns a CompletionResponse', async () => {
    const d = deps();
    const res = await handleLlm(req({ ...BODY, model: 'claude-fable-5-2' }), d);
    expect(res.status).toBe(200);
    expect(d.calls[0]).toMatchObject({ model: 'claude-opus-5-5', max_tokens: LLM_CAPS.maxOutputTokens, thinking: { type: 'adaptive' } });
    expect(await res.json()).toEqual({
      content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 't1', name: 'apply_patch', input: { a: 1 } }],
      stopReason: 'tool_use',
      usage: { inputTokens: 15, outputTokens: 5 },
      model: 'claude-opus-5-5',
    });
  });

  it('puts tool results first and converts images', async () => {
    const d = deps();
    const png = 'data:image/png;base64,AAAA';
    const body = { ...BODY, messages: [{ role: 'user', content: [{ type: 'image', dataUrl: png }, { type: 'tool_result', toolUseId: 't1', content: 'done' }] }] };
    expect((await handleLlm(req(body), d)).status).toBe(200);
    expect(d.calls[0]?.messages[0]?.content).toEqual([
      { type: 'tool_result', tool_use_id: 't1', content: 'done' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
    ]);
  });

  it('rejects invalid requests, oversized bodies and other sites', async () => {
    const d = deps();
    expect((await handleLlm(req({ ...BODY, role: 'boss' }), d)).status).toBe(400);
    expect((await handleLlm(req('{'), d)).status).toBe(400);
    expect((await handleLlm(req('x'.repeat(LLM_CAPS.maxBodyBytes + 1)), d)).status).toBe(413);
    expect((await handleLlm(req(BODY, { origin: 'https://evil.test' }), d)).status).toBe(403);
    expect(d.calls).toHaveLength(0);
  });

  it('rate limits per client IP', async () => {
    const d = deps();
    for (let i = 0; i < LLM_CAPS.perIp; i++) expect((await handleLlm(req(), d)).status).toBe(200);
    const res = await handleLlm(req(), d);
    expect(res.status).toBe(429);
    expect(((await res.json()) as { message: string }).message).toMatch(/hosted model/);
    expect((await handleLlm(req(BODY, {}, '198.51.100.1'), d)).status).toBe(200);
  });

  it('maps upstream failures to safe errors and refusals to an error stop', async () => {
    const failing = deps(async () => {
      throw Object.assign(new Error('secret upstream text'), { status: 429 });
    });
    const res = await handleLlm(req(), failing);
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain('secret');
    const refused = deps(async () => message({ stop_reason: 'refusal', content: [], stop_details: { type: 'refusal', category: 'cyber', explanation: null } } as unknown as Partial<BetaMessage>));
    expect(await (await handleLlm(req(), refused)).json()).toMatchObject({ stopReason: 'error', content: [{ type: 'text', text: 'The model declined this request (cyber).' }] });
  });
});
