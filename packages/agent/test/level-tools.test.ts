/**
 * The level tools inside the agent loop: offered only when the host can
 * measure, executed through the host's runner, committed as one undo step,
 * refusals handed back to the model as text.
 */
import { createWorld } from '@aether/core';
import { describe, expect, it } from 'vitest';
import { WorldAgent } from '../src/agent';
import { AGENT_TOOLS, LEVEL_TOOLS } from '../src/tools';
import type { CompletionRequest, CompletionResponse, ContentBlock, LevelToolRunner, Provider } from '../src/types';
import { collect, MemoryHost, TEST_CATALOGS } from './helpers';

class Scripted implements Provider {
  readonly name = 'scripted';
  readonly requests: CompletionRequest[] = [];
  constructor(private readonly script: CompletionResponse[]) {}
  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    this.requests.push({ ...req, messages: req.messages.map((m) => ({ ...m, content: Array.isArray(m.content) ? [...m.content] : m.content })) });
    return this.script.shift() ?? { content: [{ type: 'text', text: 'done' }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } };
  }
}

let seq = 0;
const call = (name: string, input: unknown): ContentBlock => ({ type: 'tool_use', id: `c-${++seq}`, name, input });
const turn = (...content: ContentBlock[]): CompletionResponse => ({ content, stopReason: 'tool_use', usage: { inputTokens: 10, outputTokens: 5 } });

const orbPatch = { op: 'add', entity: { id: 'orb-1', shape: { kind: 'primitive', primitive: 'sphere', size: [0.5, 0.5, 0.5] }, transform: { position: [2, 1, 2] } } };

describe('level tools in the agent', () => {
  it('are not offered, and not executable, without a runner', async () => {
    const provider = new Scripted([turn(call('place_level_items', { items: [] }), call('finish', { message: 'x' }))]);
    const host = new MemoryHost();
    await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS }).run('a level', host));
    expect(provider.requests[0]?.tools).toBe(AGENT_TOOLS);
    expect(provider.requests[0]?.system).not.toContain('Levels: decide the layout');
    const result = provider.requests[1]?.messages.at(-1)?.content as ContentBlock[] | undefined;
    const text = JSON.stringify(result);
    expect(text).toMatch(/Unknown tool|not available/);
  });

  it('are offered with a runner, which runs and commits its patches as one undo step', async () => {
    const seen: Array<{ name: string; input: unknown }> = [];
    const levelTools: LevelToolRunner = async (_world, name, input) => {
      seen.push({ name, input });
      return name === 'query_level' ? { ok: true, text: 'Player: thirdPerson', patches: [], message: 'Level query' } : { ok: true, text: 'Placed 1 item(s): orb-1', patches: [orbPatch], message: 'Place 1 level item' };
    };
    const provider = new Scripted([
      turn(call('query_level', { op: 'summary' }), call('place_level_items', { items: [{ id: 'orb-1', x: 2, z: 2 }] })),
      turn(call('finish', { message: 'Placed an orb.' })),
    ]);
    const host = new MemoryHost(createWorld());
    const events = await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS, levelTools }).run('a small level', host));
    expect(provider.requests[0]?.tools).toEqual([...AGENT_TOOLS, ...LEVEL_TOOLS]);
    expect(provider.requests[0]?.system).toContain('Levels: decide the layout');
    expect(seen.map((s) => s.name)).toEqual(['query_level', 'place_level_items']);
    expect(host.world.entities['orb-1']).toBeDefined();
    expect(host.commits.map((c) => c.message)).toEqual(['Place 1 level item']);
    expect(events.some((e) => e.type === 'patches')).toBe(true);
    const results = JSON.stringify(provider.requests[1]?.messages.at(-1)?.content);
    expect(results).toContain('Player: thirdPerson');
  });

  it('hand a refusal back as an error result and change nothing', async () => {
    const levelTools: LevelToolRunner = async () => ({ ok: false, text: 'far: the player cannot get to (60, 5, 0): 41 m from the nearest place the player can stand and 4.8 m too high', patches: [], message: 'Place' });
    const provider = new Scripted([turn(call('place_level_items', { items: [{ id: 'far', x: 60, z: 0 }] })), turn(call('finish', { message: 'gave up' }))]);
    const host = new MemoryHost();
    await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS, levelTools }).run('a level', host));
    expect(host.commits).toHaveLength(0);
    const blocks = provider.requests[1]?.messages.at(-1)?.content as Array<{ type: string; isError?: boolean; content?: string }>;
    const res = blocks.find((b) => b.type === 'tool_result');
    expect(res?.isError).toBe(true);
    expect(res?.content).toContain('too high');
  });

  it('survive a runner that throws', async () => {
    const levelTools: LevelToolRunner = async () => {
      throw new Error('wasm failed');
    };
    const provider = new Scripted([turn(call('query_level', { op: 'summary' })), turn(call('finish', { message: 'ok' }))]);
    const host = new MemoryHost();
    const events = await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS, levelTools }).run('a level', host));
    expect(events.at(-1)?.type).toBe('done');
    expect(JSON.stringify(provider.requests[1]?.messages.at(-1)?.content)).toContain('wasm failed');
  });

  it('refuse string arguments and oversized input', async () => {
    const levelTools: LevelToolRunner = async () => ({ ok: true, text: 'fine', patches: [], message: '' });
    const provider = new Scripted([turn(call('query_level', 'not json'), call('query_level', { op: 'ground', points: 'x'.repeat(700_000) })), turn(call('finish', { message: 'ok' }))]);
    await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS, levelTools }).run('a level', new MemoryHost()));
    const text = JSON.stringify(provider.requests[1]?.messages.at(-1)?.content);
    expect(text).toContain('not valid JSON');
    expect(text).toContain('too large');
  });
});
