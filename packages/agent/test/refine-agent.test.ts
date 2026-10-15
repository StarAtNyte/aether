import { loadCatalog } from '@aether/assets';
import { beforeAll, describe, expect, it } from 'vitest';
import { WorldAgent, SLICE_THRESHOLD } from '../src/agent';
import { createMockProvider } from '../src/providers/mock/index';
import type { AgentEvent, CompletionRequest, CompletionResponse, Provider } from '../src/types';
import { loadFixture } from './fine/fixtures';
import { catalog } from '@aether/procgen';
import { MemoryHost, TEST_CATALOGS as STUB, collect } from './helpers';

/** The real generator catalogue: parameter specs decide which slot a colour edit changes. */
const TEST_CATALOGS = { ...STUB, generators: catalog() };

beforeAll(async () => {
  await loadCatalog();
});

/** A provider that records its requests and plays a script. */
function scripted(script: Array<(req: CompletionRequest) => CompletionResponse>): { provider: Provider; requests: CompletionRequest[] } {
  const requests: CompletionRequest[] = [];
  let i = 0;
  return {
    requests,
    provider: {
      name: 'scripted',
      async complete(req) {
        requests.push(structuredClone(req));
        const step = script[Math.min(i++, script.length - 1)];
        if (!step) throw new Error('script exhausted');
        return step(req);
      },
    },
  };
}

const patchCall = (patches: unknown[], id = 'c1'): CompletionResponse => ({ content: [{ type: 'tool_use', id, name: 'apply_patches', input: { patches, message: 'edit' } }], stopReason: 'tool_use' });
const finishCall = (message = 'Done.', id = 'f1'): CompletionResponse => ({ content: [{ type: 'tool_use', id, name: 'finish', input: { message } }], stopReason: 'tool_use' });

function types(events: AgentEvent[]): string[] {
  return events.map((e) => e.type);
}

describe('local small edits through the agent', () => {
  it('apply with zero model calls and report a compact diff', async () => {
    const { provider, requests } = scripted([() => finishCall()]);
    const host = new MemoryHost(loadFixture('camp'));
    const agent = new WorldAgent({ provider, catalogs: TEST_CATALOGS });
    const events = await collect(agent.run('make the second tent red', host));
    expect(requests).toHaveLength(0);
    expect(host.commits).toHaveLength(1);
    expect(types(events)).toEqual(['patches', 'edit', 'memory', 'message', 'done']);
    const edit = events.find((e) => e.type === 'edit');
    expect(edit && edit.type === 'edit' && edit.diff.length).toBeGreaterThan(0);
    expect(edit && edit.type === 'edit' && edit.local).toBe(true);
    // colours are cosmetic: physics is not re-run
    expect(host.verifyCalls).toBe(0);
  });

  it('geometric edits re-check physics once', async () => {
    const { provider } = scripted([() => finishCall()]);
    const host = new MemoryHost(loadFixture('camp'));
    const agent = new WorldAgent({ provider, catalogs: TEST_CATALOGS });
    const events = await collect(agent.run('move the first tent 2 meters to the left', host));
    expect(host.verifyCalls).toBe(1);
    expect(types(events)).toContain('verify');
  });

  it('asks which one when it cannot tell', async () => {
    const { provider, requests } = scripted([() => finishCall()]);
    const host = new MemoryHost(loadFixture('apartment'));
    const events = await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS }).run('make the rug red', host));
    const q = events.find((e) => e.type === 'clarify');
    expect(q && q.type === 'clarify' && q.candidates.length).toBeGreaterThanOrEqual(3);
    expect(host.commits).toHaveLength(0);
    expect(requests).toHaveLength(0);
  });

  it('hands undo to the host', async () => {
    const { provider } = scripted([() => finishCall()]);
    const events = await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS }).run('undo that', new MemoryHost(loadFixture('camp'))));
    expect(events.find((e) => e.type === 'history')).toMatchObject({ action: 'undo' });
  });

  it('remembers the last edit for "it" and "the other one"', async () => {
    const { provider } = scripted([() => finishCall()]);
    const host = new MemoryHost(loadFixture('camp'));
    const agent = new WorldAgent({ provider, catalogs: TEST_CATALOGS });
    const first = await collect(agent.run('make the first tent yellow', host));
    const memory = first.find((e) => e.type === 'memory');
    expect(memory).toBeDefined();
    await collect(agent.run('do the same for the other tent', host, { memory: memory && memory.type === 'memory' ? memory.memory : undefined }));
    const t1 = host.world.entities['tent-1']!;
    const t2 = host.world.entities['tent-2']!;
    expect(t1.shape.kind === 'procedural' && t2.shape.kind === 'procedural' && t1.shape.params['color']).toBe(t2.shape.kind === 'procedural' ? t2.shape.params['color'] : undefined);
  });

  it('uses the selection', async () => {
    const { provider } = scripted([() => finishCall()]);
    const host = new MemoryHost(loadFixture('camp'));
    await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS }).run('make this red', host, { selection: ['tent-1'] }));
    const t = host.world.entities['tent-1']!;
    expect(t.shape.kind === 'procedural' && t.shape.params['color']).not.toBe(loadFixture('camp').entities['tent-1']!.shape.kind === 'procedural' ? (loadFixture('camp').entities['tent-1']!.shape as { params: Record<string, unknown> }).params['color'] : null);
  });

  it('a refusal is the answer (no model call)', async () => {
    const { provider, requests } = scripted([() => finishCall()]);
    const host = new MemoryHost(loadFixture('apartment'));
    const events = await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS }).run('make the sofa legs white', host));
    expect(requests).toHaveLength(0);
    expect(events.some((e) => e.type === 'message' && /walnut|oak/.test(e.text))).toBe(true);
    expect(host.commits).toHaveLength(0);
  });
});

describe('host-provided context is untrusted', () => {
  it('ignores hostile selections, memory and headings', async () => {
    const { provider } = scripted([() => finishCall()]);
    const host = new MemoryHost(loadFixture('camp'));
    const hostile = JSON.parse('{"targets":["__proto__","tent-1",{"x":1},42],"handled":"nope","last":{"op":"eval","ref":{"__proto__":{"polluted":true}}},"rooms":[null]}') as never;
    const events = await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS }).run('make it a bit bigger', host, { selection: ['../../etc', '__proto__', 'x'.repeat(500), 'tent-2'] as never, memory: hostile, heading: Number.NaN }));
    expect(events.find((e) => e.type === 'error')).toBeUndefined();
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    // "it" fell on the one valid selected object
    expect(host.world.entities['tent-2']).not.toEqual(loadFixture('camp').entities['tent-2']);
    expect(host.world.entities['tent-1']).toEqual(loadFixture('camp').entities['tent-1']);
  });

  it('memory with a bad command is reduced to its ids', async () => {
    const { sanitizeMemory } = await import('../src/refine/memory');
    const m = sanitizeMemory({ targets: ['tent-1'], last: { op: 'paint', ref: { text: 'x'.repeat(100_000) } } });
    expect(m.targets).toEqual(['tent-1']);
    expect(m.last).toBeUndefined();
  });
});

describe('requests the fast path declines go to the model, guarded', () => {
  it('a sloppy patch is held back, then the minimal one is applied', async () => {
    const w = loadFixture('camp');
    const sloppy = [{ op: 'update', id: 'tent-2', set: { shape: { params: { color: '#d94b3d' } } } }, { op: 'remove', id: 'jetty-1' }, { op: 'update', id: 'rock-1', set: { transform: { position: [0, 0, 0] } } }];
    const minimal = [{ op: 'update', id: 'tent-2', set: { shape: { params: { color: '#d94b3d' } } } }];
    const { provider, requests } = scripted([() => patchCall(sloppy), () => patchCall(minimal, 'c2'), () => finishCall()]);
    const host = new MemoryHost(w);
    const events = await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS, maxRepairs: 0 }).run('give the second tent a warmer vibe', host));
    expect(requests.length).toBeGreaterThanOrEqual(2);
    // the first patch never reached the world
    expect(host.world.entities['jetty-1']).toBeDefined();
    expect(host.world.entities['rock-1']!.transform.position).toEqual(w.entities['rock-1']!.transform.position);
    expect(host.world.entities['tent-2']!.shape.kind === 'procedural' && host.world.entities['tent-2']!.shape.params['color']).toBe('#d94b3d');
    expect(events.some((e) => e.type === 'status' && /unrelated/.test(e.text))).toBe(true);
    // the model was told why
    const second = JSON.stringify(requests[1]?.messages);
    expect(second).toMatch(/small edit/);
  });

  it('a model that keeps over-editing changes nothing', async () => {
    const w = loadFixture('camp');
    const sloppy = [{ op: 'clear', keepEnvironment: true }];
    const { provider } = scripted([() => patchCall(sloppy)]);
    const host = new MemoryHost(w);
    await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS, maxRepairs: 0, maxTurns: 3 }).run('give the second tent a warmer vibe', host));
    expect(host.commits).toHaveLength(0);
    expect(Object.keys(host.world.entities)).toHaveLength(Object.keys(w.entities).length);
  });

  it('without the guard the same patch destroys the world (why it exists)', async () => {
    const w = loadFixture('camp');
    const { provider } = scripted([() => patchCall([{ op: 'clear', keepEnvironment: true }]), () => finishCall()]);
    const host = new MemoryHost(w);
    await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS, maxRepairs: 0, fineEdit: false }).run('give the second tent a warmer vibe', host));
    expect(Object.keys(host.world.entities).length).toBeLessThan(5);
  });

  it('large worlds send a focused slice, small ones everything', async () => {
    const big = loadFixture('penthouse');
    expect(Object.keys(big.entities).length).toBeGreaterThan(SLICE_THRESHOLD);
    const { provider, requests } = scripted([() => finishCall()]);
    await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS, maxRepairs: 0, localEdits: false }).run('give the sofa a cosier feel', new MemoryHost(big)));
    const text = JSON.stringify(requests[0]?.messages);
    expect(text).toContain('penthouse-l0-living-f0');
    const entityLines = (text.match(/\\n(?:  )*[a-z0-9-]+ \| /g) ?? []).length;
    expect(entityLines).toBeLessThanOrEqual(SLICE_THRESHOLD + 10);
    expect(text).toMatch(/refine:/);
  });
});

describe('refine by default', () => {
  it('a described scene re-dresses the world, it does not replace it', async () => {
    const w = loadFixture('camp');
    const host = new MemoryHost(w);
    await collect(new WorldAgent({ provider: createMockProvider(), catalogs: TEST_CATALOGS, maxRepairs: 0 }).run('a haunted forest at night with fog', host));
    expect(host.world.entities['tent-1']).toBeDefined();
    expect(host.world.entities['campfire-1']).toBeDefined();
  });

  it('intent "new" replaces the world', async () => {
    const w = loadFixture('camp');
    const host = new MemoryHost(w);
    await collect(new WorldAgent({ provider: createMockProvider(), catalogs: TEST_CATALOGS, maxRepairs: 0 }).run('a haunted castle at night', host, { intent: 'new' }));
    expect(host.world.entities['tent-1']).toBeUndefined();
  });

  it('"start over" replaces it too', async () => {
    const host = new MemoryHost(loadFixture('camp'));
    await collect(new WorldAgent({ provider: createMockProvider(), catalogs: TEST_CATALOGS, maxRepairs: 0 }).run('start over with a desert canyon', host));
    expect(host.world.entities['tent-1']).toBeUndefined();
  });
});
