import { describe, expect, it } from 'vitest';
import { WorldAgent } from '../src/agent';
import { ConversationStore } from '../src/conversation';
import { CallLedger, STREAK_LIMIT, budgetNote, compactConversation, drainSteer, steerText, trimToAnswered } from '../src/harness';
import { ProviderError } from '../src/providers/errors';
import type { AgentEvent, ChatMessage, CompletionRequest, CompletionResponse, ContentBlock, Provider } from '../src/types';
import { collect, MemoryHost, TEST_CATALOGS } from './helpers';

class Scripted implements Provider {
  readonly name = 'scripted';
  readonly requests: CompletionRequest[] = [];
  constructor(private readonly script: Array<CompletionResponse | ((req: CompletionRequest) => CompletionResponse)>) {}
  async complete(req: CompletionRequest, signal?: AbortSignal): Promise<CompletionResponse> {
    if (signal?.aborted) throw new ProviderError('aborted', 'aborted');
    this.requests.push({ ...req, messages: req.messages.map((m) => ({ ...m, content: Array.isArray(m.content) ? [...m.content] : m.content })) });
    const next = this.script.shift();
    if (!next) return { content: [{ type: 'text', text: 'done' }], stopReason: 'end' };
    return typeof next === 'function' ? next(req) : next;
  }
}
let seq = 0;
const call = (name: string, input: unknown): ContentBlock => ({ type: 'tool_use', id: `c${++seq}`, name, input });
const turn = (...content: ContentBlock[]): CompletionResponse => ({ content, stopReason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end' });
const box = (id: string) => ({ op: 'add', entity: { id, shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] }, transform: { position: [0, 0.5, 0] } } });
const lastText = (req: CompletionRequest): string => {
  const m = req.messages.at(-1);
  return !m ? '' : typeof m.content === 'string' ? m.content : m.content.map((b) => (b.type === 'text' ? b.text : b.type === 'tool_result' ? b.content : '')).join('\n');
};

describe('CallLedger', () => {
  it('reflects on a repeated refusal and stops running a hopeless call', () => {
    const l = new CallLedger();
    const bad = { isError: true, content: 'Invalid edit_items input: x', edited: false };
    expect(l.record('edit_items', { a: 1 }, bad)).toBe('');
    expect(l.record('edit_items', { a: 1 }, bad)).toMatch(/refused 2 times/);
    expect(l.check('edit_items', { a: 1 }).refuse).toBeUndefined();
    expect(l.record('edit_items', { a: 1 }, bad)).toMatch(/will not be run again/);
    expect(l.check('edit_items', { a: 1 }).refuse).toMatch(/Not run/);
    // Key order does not matter; different arguments are a different call.
    expect(l.check('edit_items', { a: 1 }).refuse).toBeDefined();
    expect(l.check('edit_items', { a: 2 }).refuse).toBeUndefined();
  });
  it('tells the model to step back after a streak of refusals of one tool with different arguments', () => {
    const l = new CallLedger();
    const bad = { isError: true, content: 'refused', edited: false };
    let note = '';
    for (let i = 0; i < STREAK_LIMIT; i++) note = l.record('place_items', { i }, bad);
    expect(note).toMatch(/Step back/);
  });
  it('lists refused calls nobody redid, and forgets them once the tool succeeds afterwards', () => {
    const l = new CallLedger();
    l.record('edit_items', { a: 1 }, { isError: true, content: 'No item "sofa"', edited: false });
    expect(l.unresolved()).toEqual(['edit_items: No item "sofa"']);
    l.record('edit_items', { a: 2 }, { isError: false, content: 'ok', edited: true });
    expect(l.unresolved()).toEqual([]);
  });
});

describe('budgetNote', () => {
  it('warns two turns and one turn before the limit, once each, and when calls run low', () => {
    const said = new Set<string>();
    expect(budgetNote(5, 40, 48, said)).toBe('');
    expect(budgetNote(2, 40, 48, said)).toMatch(/2 model turns remain/);
    expect(budgetNote(2, 40, 48, said)).toBe('');
    expect(budgetNote(1, 40, 48, said)).toMatch(/LAST model turn/);
    expect(budgetNote(5, 5, 48, said)).toMatch(/Only 5 tool calls remain/);
  });
});

describe('compactConversation', () => {
  const big = (n: number): ChatMessage[] =>
    Array.from({ length: n }, (_, i): ChatMessage[] => [
      { role: 'assistant', content: [{ type: 'tool_use', id: `t${i}`, name: 'query_scene', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', toolUseId: `t${i}`, content: `result ${i} ` + 'x'.repeat(5000) }] },
    ]).flat();
  it('does nothing under the budget', () => {
    const m = big(3);
    expect(compactConversation(m, 100_000)).toBe(0);
  });
  it('shrinks old results in one sweep, keeps the newest messages whole, and is idempotent', () => {
    const m = big(20);
    const shrunk = compactConversation(m, 30_000, 6);
    expect(shrunk).toBeGreaterThan(10);
    const first = m[1]!.content as ContentBlock[];
    expect((first[0] as { content: string }).content).toMatch(/^result 0 x+\n… \[\d+ characters of this old result were dropped/);
    const newest = m.at(-1)!.content as ContentBlock[];
    expect((newest[0] as { content: string }).content.length).toBeGreaterThan(5000);
    expect(compactConversation(m, 30_000, 6)).toBe(0);
  });
});

describe('steering', () => {
  it('drains queued messages defensively', async () => {
    expect(await drainSteer(undefined)).toEqual([]);
    expect(await drainSteer(() => ['  hello ', '', 'x'.repeat(5000)] as string[])).toHaveLength(2);
    expect(await drainSteer(() => { throw new Error('x'); })).toEqual([]);
    expect(steerText(['more plants'])).toContain('<queued_message>\nmore plants\n</queued_message>');
  });
  it('hands a message the user queued while the run worked to the model, between turns', async () => {
    const provider = new Scripted([
      turn({ type: 'text', text: 'Adding a box.' }, call('apply_patches', { patches: [box('crate-1')], message: 'Add crate' })),
      turn(call('finish', { message: 'Done.' })),
    ]);
    let polls = 0;
    const steer = () => (++polls === 1 ? ['make it two crates'] : []);
    const events: AgentEvent[] = await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS }).run('a crate', new MemoryHost(), { steer }));
    expect(events.some((e) => e.type === 'steer' && e.text === 'make it two crates')).toBe(true);
    expect(lastText(provider.requests[1]!)).toContain('<queued_message>\nmake it two crates');
  });
  it('does not let the run end while a message is waiting', async () => {
    const provider = new Scripted([turn({ type: 'text', text: 'All done.' }), turn(call('finish', { message: 'ok' }))]);
    let polls = 0;
    await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS }).run('hello', new MemoryHost(), { steer: () => (++polls === 1 ? ['one more thing'] : []) }));
    expect(provider.requests).toHaveLength(2);
  });
});

describe('the loop reflects on refusals', () => {
  it('appends a reflection to a repeated refusal and, before finishing, lists calls that were never redone', async () => {
    const provider = new Scripted([
      turn(call('edit_items', { nonsense: true })),
      turn(call('edit_items', { nonsense: true })),
      turn(call('finish', { message: 'done' })),
      turn(call('finish', { message: 'The edit was not done.' })),
    ]);
    const events = await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS, maxTurns: 8 }).run('a thing', new MemoryHost()));
    expect(lastText(provider.requests[2]!)).toMatch(/refused 2 times/);
    expect(lastText(provider.requests[3]!)).toMatch(/Before you finish: these calls were refused/);
    expect(events.at(-1)?.type).toBe('done');
  });
  it('tells the model when only two turns remain', async () => {
    const provider = new Scripted([turn(call('query_scene', {})), turn(call('query_scene', {})), turn(call('finish', { message: 'x' }))]);
    await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS, maxTurns: 3 }).run('a thing', new MemoryHost()));
    expect(lastText(provider.requests[1]!)).toMatch(/2 model turns remain/);
  });
});

describe('a cancelled run can be continued', () => {
  it('trimToAnswered cuts back to the last answered turn and adds a note', () => {
    const m: ChatMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'req' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'query_scene', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', toolUseId: 'a', content: 'r' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'b', name: 'edit_items', input: {} }] },
    ];
    const kept = trimToAnswered(m)!;
    expect(kept).toHaveLength(3);
    expect(JSON.stringify(kept.at(-1))).toContain('cancelled');
    expect(trimToAnswered([m[0]!])).toBeNull();
  });
  it('keeps the conversation of a cancelled run for the next one, with the world the model last saw', async () => {
    const store = new ConversationStore();
    const ctl = new AbortController();
    const provider = new Scripted([
      turn(call('apply_patches', { patches: [box('crate-1')], message: 'Add' })),
      () => {
        ctl.abort();
        return turn(call('apply_patches', { patches: [box('crate-2')], message: 'Add' }));
      },
    ]);
    const agent = new WorldAgent({ provider, catalogs: TEST_CATALOGS, conversations: store });
    const host = new MemoryHost();
    const events = await collect(agent.run('crates', host, { signal: ctl.signal, session: 'p-abcdefgh1' }));
    expect(events.some((e) => e.type === 'error' && e.text === 'Cancelled.')).toBe(true);
    const c = store.continuable('p-abcdefgh1', agent.system);
    expect(c).not.toBeNull();
    expect(Object.keys(c!.world.entities)).toContain('crate-1');
    expect(c!.messages.at(-1)!.role).toBe('user');
  });
});
