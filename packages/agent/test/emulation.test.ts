import { createWorld } from '@aether/core';
import { describe, expect, it } from 'vitest';
import { WorldAgent } from '../src/agent';
import { extractJsonObject } from '../src/emulation/json';
import { parseEmulatedReply, replyJsonSchema } from '../src/emulation/protocol';
import { createEmulatedProvider, type TextBackend, type TextCompletionRequest, type TextCompletionResult } from '../src/emulation/provider';
import { renderTranscript } from '../src/emulation/transcript';
import { ProviderError } from '../src/providers/errors';
import { AGENT_TOOLS } from '../src/tools';
import type { CompletionRequest } from '../src/types';
import { collect, MemoryHost, TEST_CATALOGS } from './helpers';

/** Text backend replaying scripted replies and recording requests. */
class FakeBackend implements TextBackend {
  readonly name = 'fake';
  readonly requests: TextCompletionRequest[] = [];
  constructor(
    private readonly replies: Array<string | TextCompletionResult>,
    readonly strictSchema = false,
  ) {}
  async complete(req: TextCompletionRequest): Promise<TextCompletionResult> {
    this.requests.push(req);
    const next = this.replies.shift();
    if (next === undefined) throw new Error('no more replies');
    return typeof next === 'string' ? { text: next, usage: { inputTokens: 10, outputTokens: 5 } } : next;
  }
}

const TOOLS = AGENT_TOOLS;
const req = (over: Partial<CompletionRequest> = {}): CompletionRequest => ({
  role: 'planner',
  system: 'SYSTEM',
  messages: [{ role: 'user', content: 'build a red box' }],
  tools: TOOLS,
  ...over,
});

describe('extractJsonObject', () => {
  it('parses plain JSON, fenced JSON and JSON embedded in prose', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
    expect(extractJsonObject('Here:\n```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJsonObject('Sure! {"a":{"b":"}"}} trailing')).toEqual({ a: { b: '}' } });
  });
  it('rejects arrays, garbage, unbalanced and oversized text', () => {
    expect(extractJsonObject('[1,2]')).toBeUndefined();
    expect(extractJsonObject('no json here')).toBeUndefined();
    expect(extractJsonObject('{"a": 1')).toBeUndefined();
    expect(extractJsonObject(`{"a":"${'x'.repeat(1_600_000)}"}`)).toBeUndefined();
  });
});

describe('replyJsonSchema', () => {
  it('strict variant requires every property and carries arguments as a JSON string', () => {
    const s = replyJsonSchema(TOOLS, true) as { required: string[]; properties: { tool_calls: { items: { properties: Record<string, unknown>; additionalProperties: boolean } } } };
    expect(s.required).toEqual(['thoughts', 'tool_calls', 'final_message']);
    expect(Object.keys(s.properties.tool_calls.items.properties)).toEqual(['name', 'input_json']);
    expect(s.properties.tool_calls.items.additionalProperties).toBe(false);
  });
  it('without tools only a final message is requested', () => {
    expect(replyJsonSchema([], false)).toMatchObject({ required: ['final_message'] });
  });
});

describe('parseEmulatedReply', () => {
  it('maps tool calls (object and JSON-string inputs) to tool_use blocks with stable ids', () => {
    const value = { thoughts: 'Adding a box.', tool_calls: [{ name: 'apply_patches', input: { patches: [{ op: 'clear' }], message: 'x' } }, { name: 'finish', input_json: '{"message":"done"}' }] };
    const a = parseEmulatedReply(value, TOOLS, 's');
    const b = parseEmulatedReply(value, TOOLS, 's');
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.response.stopReason).toBe('tool_use');
    expect(a.response.content[0]).toEqual({ type: 'text', text: 'Adding a box.' });
    const calls = a.response.content.filter((c) => c.type === 'tool_use');
    expect(calls.map((c) => c.type === 'tool_use' && c.input)).toEqual([{ patches: [{ op: 'clear' }], message: 'x' }, { message: 'done' }]);
    expect(a.response.content).toEqual(b.response.content);
  });
  it('a final message without tools ends the turn', () => {
    const r = parseEmulatedReply({ tool_calls: [], final_message: 'Hello' }, TOOLS, 's');
    expect(r).toEqual({ ok: true, response: { content: [{ type: 'text', text: 'Hello' }], stopReason: 'end' } });
  });
  it('rejects unknown tools, non-object inputs, broken input_json and empty replies', () => {
    expect(parseEmulatedReply({ tool_calls: [{ name: 'rm_rf', input: {} }] }, TOOLS, 's')).toMatchObject({ ok: false });
    expect(parseEmulatedReply({ tool_calls: [{ name: 'finish', input: [1] }] }, TOOLS, 's')).toMatchObject({ ok: false });
    expect(parseEmulatedReply({ tool_calls: [{ name: 'finish', input_json: '{oops' }] }, TOOLS, 's')).toMatchObject({ ok: false });
    expect(parseEmulatedReply({ tool_calls: [{ name: 'finish', input_json: '"str"' }] }, TOOLS, 's')).toMatchObject({ ok: false });
    expect(parseEmulatedReply({ tool_calls: [] }, TOOLS, 's')).toMatchObject({ ok: false });
    expect(parseEmulatedReply('nope', TOOLS, 's')).toMatchObject({ ok: false });
  });
  it('caps the number of tool calls', () => {
    const many = Array.from({ length: 17 }, () => ({ name: 'inspect', input: {} }));
    expect(parseEmulatedReply({ tool_calls: many }, TOOLS, 's')).toMatchObject({ ok: false });
  });
});

describe('renderTranscript', () => {
  it('puts the protocol and tools in the system prompt and the conversation in the prompt', () => {
    const r = renderTranscript(req(), true);
    expect(r.system.startsWith('SYSTEM')).toBe(true);
    expect(r.system).toContain('Tool protocol');
    expect(r.system).toContain('### apply_patches');
    expect(r.system).toContain('input_json');
    expect(r.prompt).toContain('<user>\nbuild a red box\n</user>');
  });
  it('summarizes old tool inputs, keeps the latest assistant turn verbatim and collects images', () => {
    const big = { patches: Array.from({ length: 50 }, (_, i) => ({ op: 'add', entity: { id: `e-${i}` } })), message: 'Forest' };
    const r = renderTranscript(
      req({
        messages: [
          { role: 'user', content: [{ type: 'image', dataUrl: 'data:image/png;base64,AAAA' }, { type: 'text', text: 'like this' }] },
          { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'apply_patches', input: big }] },
          { role: 'user', content: [{ type: 'tool_result', toolUseId: 't1', content: 'applied 50' }] },
          { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'apply_patches', input: big }] },
          { role: 'user', content: [{ type: 'tool_result', toolUseId: 't2', content: 'applied 50', isError: true }] },
        ],
      }),
      false,
    );
    expect(r.images).toEqual(['data:image/png;base64,AAAA']);
    expect(r.prompt).toContain('[50 patches, already applied]');
    expect(r.prompt).toContain('"id":"e-49"');
    expect(r.prompt).toContain('<tool_result id="t2" error="true">applied 50</tool_result>');
  });
});

describe('createEmulatedProvider', () => {
  it('returns tool calls from a valid JSON reply and forwards model/effort/schema', async () => {
    const backend = new FakeBackend([JSON.stringify({ thoughts: 'ok', tool_calls: [{ name: 'finish', input: { message: 'Done' } }] })]);
    const p = createEmulatedProvider({ backend, model: 'm1', effort: 'low' });
    const res = await p.complete(req());
    expect(res.stopReason).toBe('tool_use');
    expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(backend.requests[0]).toMatchObject({ model: 'm1', effort: 'low', role: 'planner' });
    expect(backend.requests[0]?.schema).toMatchObject({ type: 'object' });
    // The backend learns the emulated tool names (to recognise a model calling one natively).
    expect(backend.requests[0]?.toolNames).toEqual(req().tools?.map((t) => t.name));
    // The protocol tells the model the tools are not directly callable and to use structured output if offered.
    expect(backend.requests[0]?.system).toContain('NOT callable directly');
    expect(backend.requests[0]?.system).toContain('structured-output tool');
  });
  it('prefers structured output when the backend returns it', async () => {
    const backend = new FakeBackend([{ text: 'garbage', structured: { tool_calls: [], final_message: 'Hi' } }]);
    const res = await createEmulatedProvider({ backend }).complete(req());
    expect(res.content).toEqual([{ type: 'text', text: 'Hi' }]);
  });
  it('re-asks once after an invalid reply, quoting the problem', async () => {
    const backend = new FakeBackend(['not json', JSON.stringify({ tool_calls: [], final_message: 'fixed' })]);
    const res = await createEmulatedProvider({ backend }).complete(req());
    expect(res.content).toEqual([{ type: 'text', text: 'fixed' }]);
    expect(backend.requests).toHaveLength(2);
    expect(backend.requests[1]?.prompt).toContain('Your previous reply could not be used: the reply is not a JSON object');
  });
  it('fails with invalid_response after the re-ask budget', async () => {
    const backend = new FakeBackend(['x', JSON.stringify({ tool_calls: [{ name: 'nope', input: {} }] })]);
    await expect(createEmulatedProvider({ backend }).complete(req())).rejects.toMatchObject({ code: 'invalid_response' });
    expect(backend.requests).toHaveLength(2);
  });
  it('honours an already-aborted signal', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(createEmulatedProvider({ backend: new FakeBackend([]) }).complete(req(), ctrl.signal)).rejects.toBeInstanceOf(ProviderError);
  });
  it('drives WorldAgent end to end (patch, finish, verification) unchanged', async () => {
    const add = { op: 'add', entity: { id: 'red-box', shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] }, material: { color: '#ff0000' }, transform: { position: [0, 0.5, 0] } } };
    const backend = new FakeBackend(
      [JSON.stringify({ thoughts: 'One red box.', tool_calls: [{ name: 'apply_patches', input_json: JSON.stringify({ patches: [add], message: 'Add box' }) }, { name: 'finish', input_json: '{"message":"Built a red box."}' }], final_message: '' })],
      true,
    );
    const host = new MemoryHost(createWorld());
    const agent = new WorldAgent({ provider: createEmulatedProvider({ backend }), catalogs: TEST_CATALOGS });
    const events = await collect(agent.run('a red box', host));
    expect(host.world.entities['red-box']).toBeDefined();
    expect(events.some((e) => e.type === 'verify' && e.passed)).toBe(true);
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(backend.requests[0]?.system).toContain('input_json');
  });
});
