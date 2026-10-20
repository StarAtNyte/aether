/**
 * Resumed conversations end to end (emulated provider → Codex / Claude Code backend with a session store): the
 * first call starts a thread with everything, later calls send only the new part and the images the thread has
 * not seen, and each call reports its own tokens although Codex reports running totals.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CodexOptions, ThreadEvent, ThreadOptions, UserInput } from '@openai/codex-sdk';
import { createEmulatedProvider, imageKey, requestView, type ChatMessage, type CompletionRequest } from '@aether/agent';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClaudeCodeBackend, STRUCTURED_OUTPUT_TOOL } from '../src/backends/claude';
import { codexTurnUsage, createCodexBackend, type CodexLike } from '../src/backends/codex';
import { SessionStore } from '../src/sessions';
import { fakeSpawn } from './helpers';

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'bridge-resume-'));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const img = (n: number): string => `data:image/png;base64,${btoa(`render-${n}`.padEnd(24, 'y'))}`;
const reply = '{"thoughts":"","tool_calls":[{"name":"finish","input_json":"{\\"message\\":\\"ok\\"}"}],"final_message":""}';
const TOOLS = [{ name: 'finish', description: 'Finish.', inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'], additionalProperties: false } }];

/** A fake Codex SDK whose threads report running totals, like Codex 0.16x. */
function cumulativeCodex(perTurnInput: number[]): { create: (o: CodexOptions) => CodexLike; inputs: UserInput[][]; started: number; resumed: string[] } {
  const state = { inputs: [] as UserInput[][], started: 0, resumed: [] as string[] };
  let totals = { input: 0, cached: 0, output: 0 };
  let turn = 0;
  const thread = (id: string) => ({
    id,
    runStreamed: async (input: string | UserInput[]) => {
      state.inputs.push(typeof input === 'string' ? [{ type: 'text', text: input }] : input);
      const i = perTurnInput[turn] ?? 1000;
      totals = { input: totals.input + i, cached: totals.cached + (turn === 0 ? 0 : i - 50), output: totals.output + 10 };
      turn++;
      const events: ThreadEvent[] = [
        { type: 'thread.started', thread_id: id },
        { type: 'item.completed', item: { id: 'm', type: 'agent_message', text: reply } },
        { type: 'turn.completed', usage: { input_tokens: totals.input, cached_input_tokens: totals.cached, cache_write_input_tokens: 0, output_tokens: totals.output, reasoning_output_tokens: 0 } },
      ];
      return { events: (async function* () { for (const e of events) yield e; })() };
    },
  });
  return {
    get inputs() { return state.inputs; },
    get started() { return state.started; },
    get resumed() { return state.resumed; },
    create: () => ({
      startThread: (_o?: ThreadOptions) => {
        state.started++;
        return thread('thread-0001');
      },
      resumeThread: (id: string) => {
        state.resumed.push(id);
        return thread(id);
      },
    }),
  };
}

const textOf = (input: UserInput[] | undefined): string => (input ?? []).filter((x): x is Extract<UserInput, { type: 'text' }> => x.type === 'text').map((x) => x.text).join('\n');

describe('codexTurnUsage', () => {
  it('turns running totals into the tokens of one turn (input includes the cached part)', () => {
    const a = codexTurnUsage({ input: 36_000, cached: 0, output: 500 }, undefined);
    expect(a.usage).toEqual({ inputTokens: 36_000, cachedInputTokens: 0, outputTokens: 500 });
    const b = codexTurnUsage({ input: 74_000, cached: 36_000, output: 800 }, a.totals);
    expect(b.usage).toEqual({ inputTokens: 38_000, cachedInputTokens: 36_000, outputTokens: 300 });
    expect(b.totals).toEqual({ input: 74_000, cached: 36_000, output: 800, lastInput: 38_000 });
  });

  it('takes per-turn counters as they are (a turn of a resumed thread re-reads at least the last one)', () => {
    const a = codexTurnUsage({ input: 36_000, cached: 0, output: 500 }, undefined);
    const b = codexTurnUsage({ input: 38_000, cached: 36_000, output: 300 }, a.totals);
    expect(b.usage).toEqual({ inputTokens: 38_000, cachedInputTokens: 36_000, outputTokens: 300 });
    const c = codexTurnUsage({ input: 39_000, cached: 37_000, output: 200 }, b.totals);
    expect(c.usage.inputTokens).toBe(39_000);
  });
});

describe('Codex: one thread across calls', () => {
  it('sends the system and the conversation once, then only what is new; images once; per-call tokens', async () => {
    const fake = cumulativeCodex([30_000, 31_000, 32_000]);
    const sessions = new SessionStore();
    const provider = createEmulatedProvider({ backend: createCodexBackend({ createCodex: fake.create, sessions, tmpRoot: root, mcpServers: async () => [] }) });
    const convo: ChatMessage[] = [{ role: 'user', content: [{ type: 'text', text: 'Build a hut' }] }];
    const ask = (): Promise<{ usage?: { inputTokens: number; cachedInputTokens?: number } }> => provider.complete({ role: 'planner', system: 'SYSTEM PROMPT', messages: requestView(convo), tools: TOOLS, session: 'p-abcdefgh1' } satisfies CompletionRequest);
    const r1 = await ask();
    expect(r1.usage).toEqual({ inputTokens: 30_000, outputTokens: 10 });
    expect(textOf(fake.inputs[0])).toContain('SYSTEM PROMPT');
    convo.push({ role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'finish', input: { message: 'ok' } }] });
    convo.push({ role: 'user', content: [{ type: 'tool_result', toolUseId: 'c1', content: 'Finished.' }, { type: 'text', text: 'Image 1: front' }, { type: 'image', dataUrl: img(1) }, { type: 'text', text: 'REVIEW round 1. Look.' }] });
    const r2 = await ask();
    expect(r2.usage).toEqual({ inputTokens: 31_000, cachedInputTokens: 30_950, outputTokens: 10 });
    const second = textOf(fake.inputs[1]);
    expect(second).not.toContain('SYSTEM PROMPT');
    expect(second).not.toContain('Build a hut');
    // The model's own last reply is in the thread already: not echoed.
    expect(second).not.toContain('<assistant>');
    expect(second).toContain('REVIEW round 1');
    expect(fake.inputs[1]?.filter((x) => x.type === 'local_image')).toHaveLength(1);
    expect(second).toContain(`Image ${imageKey(img(1))}:`);
    // Next round: new renders; the old one becomes a placeholder and is not attached again.
    convo.push({ role: 'assistant', content: [{ type: 'tool_use', id: 'c2', name: 'finish', input: { message: 'ok' } }] });
    convo.push({ role: 'user', content: [{ type: 'tool_result', toolUseId: 'c2', content: 'Finished.' }, { type: 'text', text: 'Image 1: front' }, { type: 'image', dataUrl: img(2) }, { type: 'text', text: 'REVIEW round 2. Look.' }] });
    const r3 = await ask();
    expect(r3.usage?.inputTokens).toBe(32_000);
    expect(fake.started).toBe(1);
    expect(fake.resumed).toEqual(['thread-0001', 'thread-0001']);
    const third = fake.inputs[2] ?? [];
    expect(third.filter((x) => x.type === 'local_image')).toHaveLength(1);
    expect(textOf(third)).toContain(`Image ${imageKey(img(2))}:`);
    expect(textOf(third)).not.toContain(`Image ${imageKey(img(1))}:`);
    expect(sessions.peek('p-abcdefgh1', 'codex', undefined)?.totals).toEqual({ input: 93_000, cached: 62_900, output: 30, lastInput: 32_000 });
  });

  it('starts a new thread when the conversation does not extend the one it holds', async () => {
    const fake = cumulativeCodex([30_000, 30_000]);
    const sessions = new SessionStore();
    const provider = createEmulatedProvider({ backend: createCodexBackend({ createCodex: fake.create, sessions, tmpRoot: root, mcpServers: async () => [] }) });
    await provider.complete({ role: 'planner', system: 'S', messages: [{ role: 'user', content: 'one' }], tools: TOOLS, session: 'p-abcdefgh1' });
    await provider.complete({ role: 'planner', system: 'S', messages: [{ role: 'user', content: 'something else' }], tools: TOOLS, session: 'p-abcdefgh1' });
    expect(fake.started).toBe(2);
    expect(textOf(fake.inputs[1])).toContain('something else');
  });
});

describe('Claude Code: one session across calls', () => {
  const ok = (): string[] => [
    JSON.stringify({ type: 'system', subtype: 'init', tools: [STRUCTURED_OUTPUT_TOOL], mcp_servers: [] }),
    JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: reply, structured_output: JSON.parse(reply) as unknown, usage: { input_tokens: 40, cache_creation_input_tokens: 100, cache_read_input_tokens: 5000, output_tokens: 9 }, modelUsage: { 'claude-sonnet-5': {} } }),
  ];

  it('resumes with only the new part and the new images, and reports the cached part', async () => {
    const f = fakeSpawn([{ lines: ok() }, { lines: ok() }]);
    const sessions = new SessionStore();
    const provider = createEmulatedProvider({ backend: createClaudeCodeBackend({ spawn: f.spawn, sessions, tmpRoot: root }) });
    const convo: ChatMessage[] = [{ role: 'user', content: [{ type: 'text', text: 'Build a hut' }, { type: 'image', dataUrl: img(7) }] }];
    const r1 = await provider.complete({ role: 'planner', system: 'S', messages: requestView(convo), tools: TOOLS, session: 'p-abcdefgh1' });
    expect(r1.usage).toEqual({ inputTokens: 5140, cachedInputTokens: 5000, outputTokens: 9 });
    convo.push({ role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'finish', input: { message: 'ok' } }] });
    convo.push({ role: 'user', content: [{ type: 'tool_result', toolUseId: 'c1', content: 'done' }, { type: 'text', text: 'Image 1: view' }, { type: 'image', dataUrl: img(8) }, { type: 'text', text: 'REVIEW round 1.' }] });
    await provider.complete({ role: 'planner', system: 'S', messages: requestView(convo), tools: TOOLS, session: 'p-abcdefgh1' });
    const second = f.calls[1];
    expect(second?.args).toContain('--resume');
    const msg = JSON.parse(second?.stdin ?? '') as { message: { content: ContentBlockWire[] } };
    expect(msg.message.content.filter((c) => c.type === 'image')).toHaveLength(1);
    expect(msg.message.content[0]?.text).not.toContain('Build a hut');
    expect(msg.message.content[0]?.text).toContain('REVIEW round 1.');
    const keys = msg.message.content.filter((c) => c.type === 'text').map((c) => c.text);
    expect(keys).toContain(`Image ${imageKey(img(8))}:`);
  });
});

type ContentBlockWire = { type: string; text?: string };
