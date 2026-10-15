import { describe, expect, it } from 'vitest';
import { History, createWorld, type GeneratorDef } from '@aether/core';
import type { SandboxRunner } from '@aether/procgen';
import { generateBuiltinSync } from '@aether/procgen';
import { AgentBridge, agentCatalogs, parseHealth, runVerification, selectProvider } from '../src/engine/AgentBridge';

function fakeFetch(body: unknown, ok = true): typeof fetch {
  return (async () => ({ ok, json: async () => body }) as Response) as unknown as typeof fetch;
}

describe('provider selection', () => {
  it('parses health responses defensively', () => {
    expect(parseHealth({ ok: true, mode: 'live', providers: ['anthropic', 5] })).toEqual({ live: true, providers: ['anthropic'] });
    expect(parseHealth({ ok: true, mode: 'mock' }).live).toBe(false);
    expect(parseHealth(null).live).toBe(false);
    expect(parseHealth('live').live).toBe(false);
  });

  it('uses the server proxy when live, the mock otherwise', async () => {
    const live = await selectProvider(fakeFetch({ ok: true, mode: 'live', providers: ['anthropic'] }));
    expect(live.live).toBe(true);
    expect(live.name).toBe('anthropic');
    const mock = await selectProvider(fakeFetch({ ok: true, mode: 'mock' }));
    expect(mock.live).toBe(false);
    expect(mock.provider.name).toBe('mock');
    const down = await selectProvider((async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch);
    expect(down.live).toBe(false);
  });
});

describe('AgentBridge review captures', () => {
  const view = (name: string) => ({ name, label: name, kind: 'wall' as const, pose: { position: [0, 1.5, 0] as [number, number, number], target: [0, 1, 1] as [number, number, number], up: [0, 1, 0] as [number, number, number], fov: 70 }, hideTops: false, aspect: 1.5, marks: [] });

  it('returns nothing without a viewport (after waiting) and nothing for no views', async () => {
    const bridge = new AgentBridge(new History(createWorld()), null);
    expect(await bridge.captureReview([])).toEqual([]);
    const ctrl = new AbortController();
    const p = bridge.captureReview([view('a')], { signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 20);
    expect(await p).toEqual([]);
  });

  it('waits for the viewport to mount, then renders each pose and keeps only the views that came out', async () => {
    const bridge = new AgentBridge(new History(createWorld()), null);
    const calls: Array<{ hideTops: boolean }[]> = [];
    const sim = {
      capturePoses: async (poses: Array<{ hideTops: boolean }>) => {
        calls.push(poses);
        return poses.map((_, i) => (i === 1 ? null : 'data:image/jpeg;base64,/9j/'));
      },
    };
    const p = bridge.captureReview([view('a'), view('b'), { ...view('c'), hideTops: true }]);
    setTimeout(() => bridge.attach(sim as never), 30);
    const out = await p;
    expect(out.map((o) => o.name)).toEqual(['a', 'c']);
    expect(calls[0]?.map((c) => c.hideTops)).toEqual([false, false, true]);
  });
});

describe('AgentBridge', () => {
  it('exposes the agent catalogs', () => {
    const c = agentCatalogs();
    expect(c.generators.length).toBeGreaterThanOrEqual(20);
    expect(c.behaviors.length).toBeGreaterThan(10);
    expect(c.ruleDocs.length).toBeGreaterThan(50);
  });

  it('commits agent patches to history with source "agent"', () => {
    const history = new History(createWorld());
    const bridge = new AgentBridge(history, null);
    const r = bridge.applyPatches([{ op: 'add', entity: { id: 'rock' } }, { op: 'add', entity: { id: 'BAD ID' } }], 'Add rock');
    expect(r.applied).toHaveLength(1);
    expect(r.errors).toHaveLength(1);
    expect(bridge.getWorld().entities['rock']).toBeDefined();
    expect(history.entries().at(-1)).toMatchObject({ source: 'agent', message: 'Add rock' });
  });

  it('rejects unsafe generator source before it reaches the sandbox', async () => {
    let ran = false;
    const sandbox: SandboxRunner = {
      run: async () => {
        ran = true;
        return generateBuiltinSync('rock', {}, 1);
      },
      dispose: () => undefined,
    };
    const bridge = new AgentBridge(new History(createWorld()), sandbox);
    const bad: GeneratorDef = { id: 'evil', description: 'x', params: {}, source: 'fetch("https://evil"); return api.build();' };
    const r = await bridge.validateGenerator(bad);
    expect(r.ok).toBe(false);
    expect(ran).toBe(false);
    const good: GeneratorDef = { id: 'ok-gen', description: 'x', params: {}, source: 'api.add(api.box(1,1,1), {}); return api.build();' };
    expect(await bridge.validateGenerator(good)).toEqual({ ok: true });
    expect(ran).toBe(true);
  });

  it('reports a missing sandbox and sandbox failures as errors', async () => {
    const def: GeneratorDef = { id: 'gen-x', description: 'x', params: {}, source: 'return api.build();' };
    expect((await new AgentBridge(new History(createWorld()), null).validateGenerator(def)).ok).toBe(false);
    const failing: SandboxRunner = { run: async () => Promise.reject(new Error('timeout after 2500ms')), dispose: () => undefined };
    const r = await new AgentBridge(new History(createWorld()), failing).validateGenerator(def);
    expect(r).toEqual({ ok: false, error: 'timeout after 2500ms' });
  });

  it('screenshot is null without a viewport', async () => {
    expect(await new AgentBridge(new History(createWorld()), null).screenshot()).toBeNull();
  });
});

describe('headless verification', () => {
  it('runs world tests with rules hooked in', async () => {
    const world = createWorld({
      environment: { gravity: [0, -9.81, 0] },
      state: { score: 0 },
      entities: {
        crate: { id: 'crate', transform: { position: [0, 0.5, 0] }, shape: { kind: 'primitive', primitive: 'box' }, physics: { body: 'dynamic' } },
      },
      rules: [{ id: 'point', when: { on: 'timer', at: 0.5 }, then: [{ do: 'add', key: 'score', amount: 1 }] }],
      tests: [
        { id: 'rests', kind: 'stable', target: 'crate', seconds: 1 },
        { id: 'scores', kind: 'eventually', condition: { key: 'score', op: '>=', value: 1 }, within: 2 },
      ],
    });
    const r = await runVerification(world, null);
    expect(r.passed).toBe(true);
    expect(r.summary.length).toBeGreaterThan(0);
    const report = r.report as { results: Array<{ id: string; passed: boolean }> };
    expect(report.results.map((x) => x.id).sort()).toEqual(['rests', 'scores']);
  }, 20_000);

  it('keeps the motion trace out of the report the model sees', async () => {
    const world = createWorld({
      entities: { ball: { id: 'ball', transform: { position: [0, 3, 0] }, shape: { kind: 'primitive', primitive: 'sphere' }, physics: { body: 'dynamic' } } },
      tests: [{ id: 'falls', kind: 'moves', target: 'ball', distance: 0.5, within: 2 }],
    });
    const r = await runVerification(world, null, { trace: true });
    expect(r.passed).toBe(true);
    expect(r.trace?.ids).toEqual(['ball']);
    expect('trace' in (r.report as object)).toBe(false);
    expect(JSON.stringify(r.report)).not.toContain('poses');
    const plain = await runVerification(world, null);
    expect(plain.trace).toBeUndefined();
  }, 20_000);

  it('fails tests that cannot pass', async () => {
    const world = createWorld({
      entities: { ball: { id: 'ball', transform: { position: [0, 3, 0] }, shape: { kind: 'primitive', primitive: 'sphere' }, physics: { body: 'dynamic' } } },
      tests: [{ id: 'never', kind: 'eventually', condition: { key: 'won', op: '==', value: true }, within: 1 }],
    });
    const r = await runVerification(world, null);
    expect(r.passed).toBe(false);
  }, 20_000);
});
