import type { GeneratorDef } from '@aether/core';
import { createWorld } from '@aether/core';
import { describe, expect, it } from 'vitest';
import { WorldAgent } from '../src/agent';
import { parseUserTurn } from '../src/context';
import { ProviderError } from '../src/providers/errors';
import { AGENT_TOOLS } from '../src/tools';
import type { AgentEvent, CompletionRequest, CompletionResponse, ContentBlock, Provider } from '../src/types';
import { collect, MemoryHost, TEST_CATALOGS } from './helpers';

/** Provider that replays scripted responses and records requests. */
class ScriptedProvider implements Provider {
  readonly name = 'scripted';
  readonly requests: CompletionRequest[] = [];
  constructor(private readonly script: Array<CompletionResponse | ((req: CompletionRequest) => CompletionResponse | Promise<CompletionResponse>)>) {}

  async complete(req: CompletionRequest, signal?: AbortSignal): Promise<CompletionResponse> {
    if (signal?.aborted) throw new ProviderError('aborted', 'aborted');
    // Snapshot: the agent keeps appending to the same array.
    this.requests.push({ ...req, messages: req.messages.map((m) => ({ ...m, content: Array.isArray(m.content) ? [...m.content] : m.content })) });
    const next = this.script.shift();
    if (!next) return { content: [{ type: 'text', text: 'no more script' }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } };
    return typeof next === 'function' ? next(req) : next;
  }
}

let toolSeq = 0;
function call(name: string, input: unknown): ContentBlock {
  toolSeq++;
  return { type: 'tool_use', id: `call-${toolSeq}`, name, input };
}

function turn(...content: ContentBlock[]): CompletionResponse {
  return { content, stopReason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end', usage: { inputTokens: 100, outputTokens: 10 } };
}

const box = (id: string, y = 0.5) => ({ op: 'add', entity: { id, shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] }, transform: { position: [0, y, 0] } } });

function types(events: AgentEvent[]): string[] {
  return events.map((e) => e.type);
}

describe('WorldAgent loop', () => {
  it('runs plan → patches → finish → verify → done in order', async () => {
    const provider = new ScriptedProvider([turn({ type: 'text', text: 'Adding a box.' }, call('apply_patches', { patches: [box('crate-1')], message: 'Add crate' }), call('finish', { message: 'A crate.' }))]);
    const host = new MemoryHost();
    const events = await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS }).run('a crate', host));
    expect(types(events)).toEqual(['status', 'plan', 'patches', 'message', 'status', 'verify', 'done']);
    expect(host.world.entities['crate-1']).toBeDefined();
    expect(host.commits[0]?.message).toBe('Add crate');
    const done = events.at(-1);
    expect(done).toEqual({ type: 'done', usage: { inputTokens: 100, outputTokens: 10, calls: 1 } });
  });

  it('sends system prompt, tools, summary envelope and images to the planner', async () => {
    const provider = new ScriptedProvider([turn({ type: 'text', text: 'ok' })]);
    const img = 'data:image/png;base64,iVBORw0KGgo=';
    await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS }).run('make a tree', new MemoryHost(), { images: [img] }));
    const req = provider.requests[0]!;
    expect(req.role).toBe('planner');
    expect(req.tools).toBe(AGENT_TOOLS);
    expect(req.system).toContain('Aether');
    const first = req.messages[0]!.content as ContentBlock[];
    expect(first[0]).toEqual({ type: 'image', dataUrl: img });
    const env = parseUserTurn((first[1] as { text: string }).text);
    expect(env?.request).toBe('make a tree');
    expect(env?.summary).toMatch(/^world /);
  });

  it('reports rejected patches with index and message back to the model', async () => {
    const provider = new ScriptedProvider([
      turn(call('apply_patches', { patches: [box('a'), box('a'), { op: 'nope' }], message: 'm' })),
      turn(call('finish', { message: 'done' })),
    ]);
    const host = new MemoryHost();
    const events = await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS }).run('x', host));
    const p = events.find((e) => e.type === 'patches');
    expect(p?.type === 'patches' && p.result.applied).toBe(1);
    expect(p?.type === 'patches' && p.result.errors.map((e) => e.index)).toEqual([1, 2]);
    const result = (provider.requests[1]!.messages.at(-1)!.content as ContentBlock[])[0];
    expect(result).toMatchObject({ type: 'tool_result' });
    const text = (result as { content: string }).content;
    expect(text).toContain('Applied 1/3');
    expect(text).toContain('[1] add');
    expect(text).toContain('[2]');
  });

  it('triggers repair turns on failed verification and stops at maxRepairs', async () => {
    const provider = new ScriptedProvider([
      turn(call('apply_patches', { patches: [box('a')], message: 'm' }), call('finish', { message: 'v1' })),
      turn(call('apply_patches', { patches: [box('b')], message: 'fix 1' }), call('finish', { message: 'v2' })),
      turn(call('apply_patches', { patches: [box('c')], message: 'fix 2' }), call('finish', { message: 'v3' })),
      turn(call('apply_patches', { patches: [box('d')], message: 'fix 3' }), call('finish', { message: 'v4' })),
    ]);
    const host = new MemoryHost();
    host.verifyResults = [false, false, false, false];
    const events = await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS, maxRepairs: 2 }).run('x', host));
    const repairs = events.filter((e) => e.type === 'repair');
    expect(repairs.map((r) => r.type === 'repair' && r.attempt)).toEqual([1, 2]);
    expect(host.verifyCalls).toBe(3);
    expect(provider.requests).toHaveLength(3);
    // The repair message carries the verification summary and follows the tool results.
    const last = provider.requests[1]!.messages.at(-1)!.content as ContentBlock[];
    expect(last.at(-1)).toMatchObject({ type: 'text' });
    expect((last.at(-1) as { text: string }).text).toContain('domino-6 did not topple');
    expect(last.slice(0, -1).every((b) => b.type === 'tool_result')).toBe(true);
    expect(events.at(-1)?.type).toBe('done');
  });

  it('stops repairing once verification passes', async () => {
    const provider = new ScriptedProvider([
      turn(call('apply_patches', { patches: [box('a')], message: 'm' }), call('finish', { message: 'v1' })),
      turn(call('apply_patches', { patches: [box('b')], message: 'fix' }), call('finish', { message: 'v2' })),
    ]);
    const host = new MemoryHost();
    host.verifyResults = [false, true];
    const events = await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS }).run('x', host));
    expect(events.filter((e) => e.type === 'verify').map((e) => e.type === 'verify' && e.passed)).toEqual([false, true]);
    expect(events.filter((e) => e.type === 'repair')).toHaveLength(1);
  });

  it('does not re-verify when the model makes no changes after a failure', async () => {
    const provider = new ScriptedProvider([turn(call('apply_patches', { patches: [box('a')], message: 'm' }), call('finish', { message: 'v1' })), turn({ type: 'text', text: 'I cannot fix it.' })]);
    const host = new MemoryHost();
    host.verifyResults = [false];
    const events = await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS }).run('x', host));
    expect(host.verifyCalls).toBe(1);
    expect(events.some((e) => e.type === 'status' && /issues remaining/.test(e.text))).toBe(true);
  });

  it('does not verify when nothing was edited', async () => {
    const provider = new ScriptedProvider([turn({ type: 'text', text: 'The world has 0 entities.' })]);
    const host = new MemoryHost();
    const events = await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS }).run('how many entities?', host));
    expect(host.verifyCalls).toBe(0);
    expect(types(events)).toEqual(['status', 'message', 'done']);
  });

  it('honors maxTurns', async () => {
    const provider = new ScriptedProvider(Array.from({ length: 10 }, () => () => turn(call('inspect', {}))));
    const events = await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS, maxTurns: 3 }).run('x', new MemoryHost()));
    expect(provider.requests).toHaveLength(3);
    expect(events.some((e) => e.type === 'status' && /Stopped after 3/.test(e.text))).toBe(true);
    expect(events.at(-1)?.type).toBe('done');
  });

  it('caps total tool calls', async () => {
    const many = Array.from({ length: 6 }, () => call('inspect', {}));
    const provider = new ScriptedProvider([turn(...many), turn(call('finish', { message: 'ok' }))]);
    await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS, maxToolCalls: 4 }).run('x', new MemoryHost()));
    const results = provider.requests[1]!.messages.at(-1)!.content as Array<{ content: string; isError?: boolean }>;
    expect(results).toHaveLength(6);
    expect(results.slice(4).every((r) => r.isError && /budget exhausted/.test(r.content))).toBe(true);
  });

  it('surfaces provider errors as events and never throws', async () => {
    const provider: Provider = { name: 'bad', complete: async () => { throw new ProviderError('auth', 'Anthropic API error 401: invalid x-api-key'); } };
    const events = await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS }).run('x', new MemoryHost()));
    expect(types(events)).toEqual(['status', 'error', 'done']);
    expect(events[1]).toMatchObject({ type: 'error', text: expect.stringContaining('401') });
  });

  it('surfaces host verify crashes as error events', async () => {
    const provider = new ScriptedProvider([turn(call('apply_patches', { patches: [box('a')], message: 'm' }), call('finish', { message: 'v' }))]);
    const host = new MemoryHost();
    host.verify = async () => { throw new Error('physics exploded'); };
    const events = await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS }).run('x', host));
    expect(events.at(-2)).toMatchObject({ type: 'error', text: expect.stringContaining('physics exploded') });
    expect(events.at(-1)?.type).toBe('done');
  });

  it('abort before start yields Cancelled + done', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const provider = new ScriptedProvider([turn({ type: 'text', text: 'never' })]);
    const events = await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS }).run('x', new MemoryHost(), { signal: ctrl.signal }));
    expect(events.filter((e) => e.type === 'error')).toEqual([{ type: 'error', text: 'Cancelled.' }]);
    expect(events.at(-1)?.type).toBe('done');
  });

  it('abort during a slow provider call cancels promptly', async () => {
    const ctrl = new AbortController();
    const provider: Provider = { name: 'slow', complete: () => new Promise(() => undefined) };
    const run = collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS }).run('x', new MemoryHost(), { signal: ctrl.signal }));
    setTimeout(() => ctrl.abort(), 10);
    const events = await run;
    expect(events.map((e) => e.type)).toEqual(['status', 'error', 'done']);
    expect(events[1]).toEqual({ type: 'error', text: 'Cancelled.' });
  });

  it('abort between tool calls stops before further edits', async () => {
    const ctrl = new AbortController();
    const provider = new ScriptedProvider([turn(call('apply_patches', { patches: [box('a')], message: 'm' }), call('apply_patches', { patches: [box('b')], message: 'm2' }))]);
    const host = new MemoryHost();
    const origApply = host.applyPatches.bind(host);
    host.applyPatches = (p, m) => {
      const r = origApply(p, m);
      ctrl.abort();
      return r;
    };
    const events = await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS }).run('x', host, { signal: ctrl.signal }));
    expect(host.commits).toHaveLength(1);
    expect(events.at(-2)).toEqual({ type: 'error', text: 'Cancelled.' });
  });

  it('rejects bad input as an error event', async () => {
    const agent = new WorldAgent({ provider: new ScriptedProvider([]), catalogs: TEST_CATALOGS });
    for (const [prompt, opts] of [
      ['   ', {}],
      ['x'.repeat(9000), {}],
      ['ok', { images: ['http://evil/x.png'] }],
      ['ok', { images: Array.from({ length: 5 }, () => 'data:image/png;base64,AAAA') }],
    ] as const) {
      const events = await collect(agent.run(prompt, new MemoryHost(), opts as { images?: string[] }));
      expect(types(events)).toEqual(['error', 'done']);
    }
  });

  it('continues after a truncated (max_tokens) reply without tools', async () => {
    const provider = new ScriptedProvider([{ content: [{ type: 'text', text: 'Let me write a very long' }], stopReason: 'max_tokens' }, turn({ type: 'text', text: 'done' })]);
    await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS }).run('x', new MemoryHost()));
    expect(provider.requests).toHaveLength(2);
    const nudge = provider.requests[1]!.messages.at(-1)!;
    expect(nudge.role).toBe('user');
    expect(JSON.stringify(nudge.content)).toContain('cut off');
  });

  it('sanitizes chat history (text only, starts with user)', async () => {
    const provider = new ScriptedProvider([turn({ type: 'text', text: 'ok' })]);
    await collect(
      new WorldAgent({ provider, catalogs: TEST_CATALOGS }).run('next', new MemoryHost(), {
        history: [
          { role: 'assistant', content: 'orphan' },
          { role: 'user', content: [{ type: 'text', text: 'build a forest' }, { type: 'image', dataUrl: 'data:image/png;base64,AAAA' }] },
          { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'finish', input: {} }, { type: 'text', text: 'Built a forest.' }] },
        ],
      }),
    );
    const msgs = provider.requests[0]!.messages;
    expect(msgs[0]).toEqual({ role: 'user', content: 'build a forest' });
    expect(msgs[1]).toEqual({ role: 'assistant', content: 'Built a forest.' });
    expect(msgs).toHaveLength(3);
  });
});

describe('WorldAgent tools', () => {
  const gen = { id: 'obelisk', description: 'tall stone', params: { height: { type: 'number', default: 4 } }, source: 'return api.build();' };

  it('write_generator validates via host and defines the generator', async () => {
    const provider = new ScriptedProvider([turn(call('write_generator', gen)), turn(call('finish', { message: 'ok' }))]);
    const host = new MemoryHost();
    let validated = 0;
    host.validateGenerator = async () => { validated++; return { ok: true }; };
    const events = await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS }).run('x', host));
    expect(validated).toBe(1);
    expect(host.world.generators['obelisk']).toBeDefined();
    expect(events.find((e) => e.type === 'generator')).toMatchObject({ ok: true });
  });

  it('write_generator reports validation errors and does not define', async () => {
    const provider = new ScriptedProvider([turn(call('write_generator', gen)), turn(call('finish', { message: 'ok' }))]);
    const host = new MemoryHost();
    host.validateGenerator = async () => ({ ok: false, error: 'forbidden token: fetch' });
    const events = await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS }).run('x', host));
    expect(host.world.generators['obelisk']).toBeUndefined();
    expect(events.find((e) => e.type === 'generator')).toMatchObject({ ok: false, error: 'forbidden token: fetch' });
    const res = (provider.requests[1]!.messages.at(-1)!.content as Array<{ content: string; isError?: boolean }>)[0]!;
    expect(res.isError).toBe(true);
    expect(res.content).toContain('forbidden token: fetch');
  });

  it('write_generator rejects built-in ids and invalid shapes', async () => {
    const provider = new ScriptedProvider([turn(call('write_generator', { ...gen, id: 'rock' }), call('write_generator', { ...gen, id: 'Bad Id' })), turn(call('finish', { message: 'ok' }))]);
    const host = new MemoryHost();
    await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS }).run('x', host));
    const results = provider.requests[1]!.messages.at(-1)!.content as Array<{ content: string; isError?: boolean }>;
    expect(results[0]!.content).toMatch(/built-in/);
    expect(results[1]!.content).toMatch(/Invalid generator/);
    expect(Object.keys(host.world.generators)).toHaveLength(0);
  });

  it('request_asset calls the coder role, retries once with the error, then defines', async () => {
    let coderCalls = 0;
    const provider = new ScriptedProvider([
      turn(call('request_asset', { id: 'cathedral', description: 'gothic cathedral' })),
      (req) => {
        coderCalls++;
        expect(req.role).toBe('coder');
        expect(req.tools?.[0]?.name).toBe('submit_generator');
        return turn(call('submit_generator', { ...gen, id: 'cathedral', source: 'fetch("x")' }));
      },
      (req) => {
        coderCalls++;
        const lastMsg = req.messages.at(-1)!.content as Array<{ type: string; content?: string }>;
        expect(lastMsg[0]?.type).toBe('tool_result');
        expect(lastMsg[0]?.content).toContain('no network');
        return turn(call('submit_generator', { ...gen, id: 'cathedral' }));
      },
      turn(call('finish', { message: 'ok' })),
    ]);
    const host = new MemoryHost();
    host.validateGenerator = async (def) => (def.source.includes('fetch') ? { ok: false, error: 'no network access allowed' } : { ok: true });
    const events = await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS }).run('x', host));
    expect(coderCalls).toBe(2);
    expect(host.world.generators['cathedral']).toBeDefined();
    expect(events.find((e) => e.type === 'done')).toMatchObject({ usage: { calls: 4 } });
  });

  it('request_asset uses the deep builder when given, and validates its result', async () => {
    const provider = new ScriptedProvider([turn(call('request_asset', { id: 'cathedral', description: 'gothic cathedral', params_hint: 'towers' })), turn(call('finish', { message: 'ok' }))]);
    const host = new MemoryHost();
    const validated: string[] = [];
    host.validateGenerator = async (def) => {
      validated.push(def.id);
      return { ok: true };
    };
    const specs: unknown[] = [];
    const events = await collect(
      new WorldAgent({
        provider,
        catalogs: TEST_CATALOGS,
        buildAsset: async (spec) => {
          specs.push(spec);
          return { ok: true as const, def: { ...(gen as GeneratorDef), id: 'something-else' }, note: '2 rounds' };
        },
      }).run('x', host),
    );
    expect(specs).toEqual([{ id: 'cathedral', description: 'gothic cathedral', paramsHint: 'towers' }]);
    expect(validated).toEqual(['cathedral']);
    expect(host.world.generators['cathedral']).toBeDefined();
    expect(provider.requests.every((r) => r.role !== 'coder')).toBe(true);
    expect(events.some((e) => e.type === 'status' && /coding agent/.test(e.text))).toBe(true);
  });

  it('request_asset falls back to the coder when the deep build fails or is rejected', async () => {
    for (const outcome of ['error', 'invalid'] as const) {
      const provider = new ScriptedProvider([
        turn(call('request_asset', { id: 'cathedral', description: 'gothic cathedral' })),
        turn(call('submit_generator', { ...gen, id: 'cathedral' })),
        turn(call('finish', { message: 'ok' })),
      ]);
      const host = new MemoryHost();
      host.validateGenerator = async (def) => (def.source.includes('BAD') ? { ok: false, error: 'rejected' } : { ok: true });
      const events = await collect(
        new WorldAgent({
          provider,
          catalogs: TEST_CATALOGS,
          buildAsset: async () => (outcome === 'error' ? { ok: false as const, error: 'the checker kept failing' } : { ok: true as const, def: { ...(gen as GeneratorDef), id: 'cathedral', source: `${gen.source} // BAD` } }),
        }).run('x', host),
      );
      expect(provider.requests.some((r) => r.role === 'coder')).toBe(true);
      expect(host.world.generators['cathedral']?.source).not.toContain('BAD');
      expect(events.some((e) => e.type === 'status' && /directly instead/.test(e.text))).toBe(true);
    }
  });

  it('write_script validates and defines a script', async () => {
    const provider = new ScriptedProvider([turn(call('write_script', { id: 'hopper', description: 'hops', source: 'return [];' })), turn(call('finish', { message: 'ok' }))]);
    const host = new MemoryHost();
    host.validateScript = async () => ({ ok: true });
    await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS }).run('x', host));
    expect(host.world.scripts['hopper']).toBeDefined();
  });

  it('inspect returns summary or entity JSON', async () => {
    const world = createWorld({ entities: { tree: { id: 'tree', shape: { kind: 'procedural', generator: 'tree-oak', params: {} } } } });
    const provider = new ScriptedProvider([turn(call('inspect', {}), call('inspect', { ids: ['tree', 'ghost'] }), call('inspect', { ids: ['nope'] })), turn({ type: 'text', text: 'k' })]);
    await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS }).run('x', new MemoryHost(world)));
    const results = provider.requests[1]!.messages.at(-1)!.content as Array<{ content: string; isError?: boolean }>;
    expect(results[0]!.content).toContain('tree | -');
    expect(results[1]!.content).toContain('"generator":"tree-oak"');
    expect(results[1]!.content).toContain('Not found: ghost');
    expect(results[2]!.isError).toBe(true);
  });

  it('run_verification returns the summary and counts as verification', async () => {
    const provider = new ScriptedProvider([turn(call('apply_patches', { patches: [box('a')], message: 'm' }), call('run_verification', {})), turn(call('finish', { message: 'ok' }))]);
    const host = new MemoryHost();
    const events = await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS }).run('x', host));
    expect(host.verifyCalls).toBe(1);
    expect(events.filter((e) => e.type === 'verify')).toHaveLength(1);
  });

  it('rejects unknown tools, malformed JSON and oversized input', async () => {
    const provider = new ScriptedProvider([
      turn(call('rm_rf', {}), call('apply_patches', '{"patches": [ broken'), call('apply_patches', { patches: [{ op: 'setState', key: 'k', value: 'x'.repeat(700_000) }], message: 'big' }), call('apply_patches', { patches: [] })),
      turn(call('finish', { message: 'ok' })),
    ]);
    const host = new MemoryHost();
    await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS }).run('x', host));
    const results = provider.requests[1]!.messages.at(-1)!.content as Array<{ content: string; isError?: boolean }>;
    expect(results.every((r) => r.isError)).toBe(true);
    expect(results[0]!.content).toMatch(/Unknown tool/);
    expect(results[1]!.content).toMatch(/not valid JSON/);
    expect(results[2]!.content).toMatch(/too large/);
    expect(results[3]!.content).toMatch(/Invalid apply_patches/);
    expect(host.commits).toHaveLength(0);
  });

  it('prototype-pollution payloads are rejected and do not pollute', async () => {
    const evil = JSON.parse('{"op":"update","id":"a","set":{"__proto__":{"polluted":true}}}') as unknown;
    const provider = new ScriptedProvider([turn(call('apply_patches', { patches: [box('a'), evil], message: 'm' })), turn(call('finish', { message: 'ok' }))]);
    const host = new MemoryHost();
    await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS }).run('x', host));
    expect(host.commits[0]!.result.errors).toHaveLength(1);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});

describe('people always get a body', () => {
  it('attaches a rigged character to a capsule guard added by apply_patches and tells the model', async () => {
    const guard = { op: 'add', entity: { id: 'guard-1', name: 'Gate guard', shape: { kind: 'primitive', primitive: 'capsule', size: [0.5, 1.75, 0.5] }, physics: { body: 'dynamic' } } };
    const provider = new ScriptedProvider([turn(call('apply_patches', { patches: [guard], message: 'Add a guard' })), turn(call('finish', { message: 'done' }))]);
    const host = new MemoryHost();
    const events = await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS }).run('a guard at the gate', host));
    expect(host.world.entities['guard-1']?.character?.wardrobe).toBe('guard');
    expect(host.commits.map((c) => c.message)).toContain('Give 1 person a character');
    const result = (provider.requests[1]!.messages.at(-1)!.content as ContentBlock[])[0] as { content: string };
    expect(result.content).toMatch(/rigged character was attached/);
    expect(events.filter((e) => e.type === 'patches')).toHaveLength(2);
  });
});
