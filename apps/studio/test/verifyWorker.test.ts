import { describe, expect, it, vi } from 'vitest';
import { createWorld, type EntityInput, type WorldDoc, type WorldDocInput } from '@aether/core';
import type { WorkerLike } from '@aether/procgen';
import * as physics from '@aether/physics';
import { createVerifyHandler } from '../src/engine/verify/handler';
import { colliderNumbers, MAX_COLLIDER_FLOATS, parseVerifyReply, parseVerifyRequest, type VerifyReply } from '../src/engine/verify/protocol';
import { mergeShardReports, MIN_PARALLEL_SECONDS, planShards, testHorizon, verifyLanes } from '../src/engine/verify/shards';
import { VerifyPool, VerifyTimeoutError, WorkerUnavailableError } from '../src/engine/verify/pool';
import { VerificationService } from '../src/engine/verify/service';
import { needsRendererColliders, workerColliders } from '../src/engine/verify/colliders';
import { LiveVerifyFeed, FLUSH_MS } from '../src/engine/verify/live';
import type { VerifyState } from '../src/state/store';

function world(entities: EntityInput[], extra: Partial<WorldDocInput> = {}): WorldDoc {
  const map: Record<string, EntityInput> = {};
  for (const e of entities) map[e.id] = e;
  return createWorld({ ...extra, entities: map });
}

/** Four independent tests (≈ 11 simulated seconds in total: worth two lanes). */
function multiTestWorld(): WorldDoc {
  return world(
    [
      { id: 'crate', shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] }, transform: { position: [0, 0.5, 5] }, physics: { body: 'dynamic' } },
      { id: 'ball', shape: { kind: 'primitive', primitive: 'sphere', size: [0.6, 0.6, 0.6] }, transform: { position: [-5, 3, 0] }, physics: { body: 'dynamic', initialVelocity: [4, 0, 0] } },
      { id: 'goal', shape: { kind: 'primitive', primitive: 'box', size: [1, 2, 4] }, transform: { position: [3, 1, 0] }, physics: { body: 'static', sensor: true } },
      { id: 'pit', shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] }, transform: { position: [20, 5, 0] }, physics: { body: 'dynamic' } },
    ],
    {
      environment: { ground: { material: { preset: 'grass' }, size: 30 } },
      tests: [
        { id: 'rest', kind: 'stable', target: 'crate', seconds: 1 },
        { id: 'clear', kind: 'noOverlap' },
        { id: 'goal', kind: 'reaches', target: 'ball', zone: 'goal', within: 5 },
        { id: 'falls', kind: 'staysAbove', target: 'pit', y: -1, within: 5 },
      ],
    },
  );
}

const OPTIONS = { maxSeconds: 12, budgetMs: 10_000, diagnostics: true };

/** Runs the handler and collects its replies. */
function harness() {
  const replies: VerifyReply[] = [];
  const handler = createVerifyHandler({ physics: async () => physics, post: (r) => replies.push(r), sliceMs: 1 });
  return { handler, replies };
}

describe('verify worker protocol (pure handler)', () => {
  it('verifies a world: one progress message per test, then exactly one terminal reply', async () => {
    const { handler, replies } = harness();
    await handler.handle({ type: 'verify', id: 7, world: multiTestWorld(), colliders: [], options: OPTIONS });
    const progress = replies.filter((r) => r.type === 'progress');
    const terminal = replies.filter((r) => r.type !== 'progress');
    expect(progress).toHaveLength(4);
    expect(terminal).toHaveLength(1);
    const done = terminal[0];
    expect(done?.type).toBe('verified');
    if (done?.type !== 'verified') return;
    expect(done.id).toBe(7);
    expect(done.report.results.map((r) => r.id)).toEqual(['rest', 'clear', 'goal', 'falls']);
    expect(done.report.results[3]?.passed).toBe(false);
    // Every reply passes the main thread's validation.
    for (const r of replies) expect(parseVerifyReply(JSON.parse(JSON.stringify(r)))).not.toBeNull();
    expect(handler.running).toBe(0);
  });

  it('runs a shard (subset of tests) without diagnostics', async () => {
    const { handler, replies } = harness();
    await handler.handle({ type: 'verify', id: 1, world: multiTestWorld(), colliders: [], options: { ...OPTIONS, tests: [2, 0], diagnostics: false } });
    const done = replies.find((r) => r.type === 'verified');
    expect(done?.type === 'verified' && done.report.testIndices).toEqual([0, 2]);
    expect(done?.type === 'verified' && done.report.diagnostics).toEqual([]);
    expect(replies.filter((r) => r.type === 'progress').map((r) => (r.type === 'progress' ? r.index : -1)).sort()).toEqual([0, 2]);
  });

  it('cancel aborts a running request with a cancelled failure', async () => {
    const replies: VerifyReply[] = [];
    let handlerRef: ReturnType<typeof createVerifyHandler> | null = null;
    const handler = createVerifyHandler({
      physics: async () => physics,
      sliceMs: 1,
      post: (r) => {
        replies.push(r);
        // Cancel as soon as the first test is decided (the run keeps stepping for the others).
        if (r.type === 'progress' && replies.filter((x) => x.type === 'progress').length === 1) void handlerRef?.handle({ type: 'cancel', id: 3 });
      },
    });
    handlerRef = handler;
    await handler.handle({ type: 'verify', id: 3, world: multiTestWorld(), colliders: [], options: OPTIONS });
    const last = replies[replies.length - 1];
    expect(last).toEqual({ type: 'failed', id: 3, error: 'verification cancelled', cancelled: true });
    expect(replies.some((r) => r.type === 'verified')).toBe(false);
  });

  it('rejects malformed requests, invalid worlds and duplicate ids with a failure (never throws)', async () => {
    const { handler, replies } = harness();
    await handler.handle(null);
    await handler.handle({ type: 'verify', id: 4, world: {}, colliders: 'nope', options: OPTIONS });
    await handler.handle({ type: 'verify', id: 5, world: { version: 1, entities: { __proto__: {} } }, colliders: [], options: OPTIONS });
    await handler.handle({ type: 'verify', id: 6, world: { entities: 5 }, colliders: [], options: OPTIONS });
    await handler.handle({ type: 'nuke', id: 8 });
    expect(replies).toEqual([
      { type: 'failed', id: 4, error: 'malformed verification request', cancelled: false },
      expect.objectContaining({ type: 'failed', id: 5, cancelled: false }),
      expect.objectContaining({ type: 'failed', id: 6, cancelled: false }),
      { type: 'failed', id: 8, error: 'malformed verification request', cancelled: false },
    ]);
    expect((replies[2] as { error: string }).error).toMatch(/^invalid world/);
    const { handler: h2, replies: r2 } = harness();
    const a = h2.handle({ type: 'verify', id: 9, world: multiTestWorld(), colliders: [], options: OPTIONS });
    await h2.handle({ type: 'verify', id: 9, world: multiTestWorld(), colliders: [], options: OPTIONS });
    await a;
    expect(r2.filter((r) => r.type === 'failed')).toEqual([{ type: 'failed', id: 9, error: 'duplicate request id', cancelled: false }]);
  });

  it('warm loads physics once; diagnose and settle answer with validated payloads', async () => {
    const init = vi.fn(physics.initPhysics);
    const replies: VerifyReply[] = [];
    const handler = createVerifyHandler({ physics: async () => ({ ...physics, initPhysics: init }), post: (r) => replies.push(r) });
    await handler.handle({ type: 'warm', id: 1, scripting: false });
    const overlap = world([
      { id: 'a', shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] }, transform: { position: [0, 0.5, 0] }, physics: { body: 'dynamic' } },
      { id: 'b', shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] }, transform: { position: [0.5, 0.5, 0] }, physics: { body: 'dynamic' } },
    ]);
    await handler.handle({ type: 'diagnose', id: 2, world: overlap, colliders: [] });
    await handler.handle({ type: 'settle', id: 3, world: overlap, colliders: [], seconds: 1 });
    expect(init).toHaveBeenCalledTimes(1);
    expect(replies.map((r) => r.type)).toEqual(['warmed', 'diagnosed', 'settled']);
    const d = replies[1];
    expect(d?.type === 'diagnosed' && d.diagnostics.some((x) => x.code === 'overlap')).toBe(true);
    for (const r of replies) expect(parseVerifyReply(r)).not.toBeNull();
  });

  it('a physics load failure becomes a failed reply and is retried on the next request', async () => {
    let calls = 0;
    const replies: VerifyReply[] = [];
    const handler = createVerifyHandler({
      physics: async () => {
        calls++;
        if (calls === 1) throw new Error('chunk load failed');
        return physics;
      },
      post: (r) => replies.push(r),
    });
    await handler.handle({ type: 'warm', id: 1, scripting: false });
    await handler.handle({ type: 'warm', id: 2, scripting: false });
    expect(replies).toEqual([{ type: 'failed', id: 1, error: 'chunk load failed', cancelled: false }, { type: 'warmed', id: 2 }]);
  });

  it('validates collider payloads: typed arrays, heightfield sample counts and the total size cap', () => {
    const base = { type: 'diagnose', id: 1, world: {} };
    expect(parseVerifyRequest({ ...base, colliders: [['rock', [{ kind: 'hull', points: new Float32Array(9), offset: [0, 0, 0] }]]] })).not.toBeNull();
    expect(parseVerifyRequest({ ...base, colliders: [['rock', [{ kind: 'hull', points: [1, 2, 3], offset: [0, 0, 0] }]]] })).toBeNull();
    expect(parseVerifyRequest({ ...base, colliders: [['t', [{ kind: 'heightfield', rows: 2, cols: 2, heights: new Float32Array(9), size: [1, 1, 1] }]]] })).not.toBeNull();
    expect(parseVerifyRequest({ ...base, colliders: [['t', [{ kind: 'heightfield', rows: 2, cols: 2, heights: new Float32Array(8), size: [1, 1, 1] }]]] })).toBeNull();
    expect(parseVerifyRequest({ ...base, colliders: [['b', [{ kind: 'box', halfExtents: [1, 1, Number.NaN], offset: [0, 0, 0] }]]] })).toBeNull();
    expect(parseVerifyRequest({ ...base, colliders: [['b', [{ kind: 'box', halfExtents: [1, 1, 1], offset: [0, 0, 0], evil: 1 }]]] })).toBeNull();
    const big = new Float32Array(3 * 1_000_000);
    const list = Array.from({ length: 6 }, (_, i) => [`m${i}`, [{ kind: 'trimesh', positions: big, indices: new Uint32Array(0) }]]);
    expect(colliderNumbers(list as never)).toBeGreaterThan(MAX_COLLIDER_FLOATS);
    expect(parseVerifyRequest({ ...base, colliders: list })).toBeNull();
    expect(parseVerifyReply({ type: 'verified', id: 1, report: { passed: true, results: [], diagnostics: [], simulatedSeconds: Number.POSITIVE_INFINITY, ms: 1 } })).toBeNull();
    expect(parseVerifyReply({ type: 'progress', id: 0, index: 0, result: { id: 'a', kind: 'k', passed: true, message: '' } })).toBeNull();
  });
});

describe('fork verification planning', () => {
  const tests = multiTestWorld().tests;

  it('splits tests across lanes by simulated horizon, diagnostics in the lightest shard', () => {
    expect(tests.map((t) => testHorizon(t, 12))).toEqual([1, 0, 5, 5]);
    const shards = planShards(tests, 2, 12);
    expect(shards).toHaveLength(2);
    expect(shards.map((s) => s.load).sort()).toEqual([5, 6]);
    expect(shards.flatMap((s) => s.tests).sort()).toEqual([0, 1, 2, 3]);
    expect(shards.filter((s) => s.diagnostics)).toHaveLength(1);
    expect(shards.find((s) => s.diagnostics)?.load).toBe(5);
  });

  it('keeps one shard for one lane, one test or too little simulation', () => {
    expect(planShards(tests, 1, 12)).toEqual([{ tests: [0, 1, 2, 3], diagnostics: true, load: 11 }]);
    expect(planShards(tests.slice(0, 1), 2, 12)).toHaveLength(1);
    expect(planShards(tests.slice(0, 2), 2, 12)[0]?.load).toBeLessThan(MIN_PARALLEL_SECONDS);
    expect(planShards(tests.slice(0, 2), 2, 12)).toHaveLength(1);
    expect(planShards([], 2, 12)).toEqual([{ tests: [], diagnostics: true, load: 0 }]);
  });

  it('merges shard reports back into world order (missing tests fail)', () => {
    const r = (id: string, passed = true) => ({ id, kind: 'stable', passed, message: id });
    const merged = mergeShardReports(tests, [
      { tests: [1, 2], report: { passed: true, results: [r('clear'), r('goal')], diagnostics: [{ severity: 'warning', code: 'floating', entities: ['x'], message: 'm' }], simulatedSeconds: 5, ms: 40, testIndices: [1, 2] } },
      { tests: [0], report: { passed: true, results: [r('rest')], diagnostics: [], simulatedSeconds: 1, ms: 30, testIndices: [0] } },
    ]);
    expect(merged.results.map((x) => x.id)).toEqual(['rest', 'clear', 'goal', 'falls']);
    expect(merged.results[3]).toMatchObject({ passed: false, message: 'not decided: no verification result' });
    expect(merged.passed).toBe(false);
    expect(merged.simulatedSeconds).toBe(5);
    expect(merged.ms).toBe(40);
    expect(merged.diagnostics).toHaveLength(1);
  });

  it('sizes the pool from cores, device memory and low-memory mode', () => {
    expect(verifyLanes({ hardwareConcurrency: 8, deviceMemory: 8 })).toBe(2);
    expect(verifyLanes({ hardwareConcurrency: 8 })).toBe(2);
    expect(verifyLanes({ hardwareConcurrency: 2, deviceMemory: 16 })).toBe(1);
    expect(verifyLanes({ hardwareConcurrency: 8, deviceMemory: 4 })).toBe(1);
    expect(verifyLanes({ hardwareConcurrency: 16, deviceMemory: 32, lowMemory: true })).toBe(1);
    expect(verifyLanes({})).toBe(1);
  });
});

/** In-process "worker" running the real handler (structured clone emulated). */
class FakeWorker implements WorkerLike {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  terminated = false;
  readonly received: unknown[] = [];
  private readonly handler = createVerifyHandler({
    physics: async () => physics,
    sliceMs: 1,
    post: (r) => setTimeout(() => !this.terminated && this.onmessage?.({ data: structuredClone(r) } as MessageEvent), 0),
  });

  constructor(opts: { silent?: boolean } = {}) {
    if (!opts.silent) setTimeout(() => this.onmessage?.({ data: { type: 'ready' } } as MessageEvent), 0);
  }

  postMessage(message: unknown): void {
    if (this.terminated) return;
    const data = structuredClone(message);
    this.received.push(data);
    setTimeout(() => void this.handler.handle(data), 0);
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe('VerifyPool (fake workers running the real handler)', () => {
  it('runs a fork verification on two lanes, streams every result and merges in world order', async () => {
    const workers: FakeWorker[] = [];
    const pool = new VerifyPool({ lanes: 2, idleMs: 0, createWorker: () => (workers.push(new FakeWorker()), workers[workers.length - 1] as FakeWorker) });
    const doc = multiTestWorld();
    const progress: number[] = [];
    let planned = 0;
    const r = await pool.verify(doc, { colliders: [], maxSeconds: 12, budgetMs: 10_000, onResult: (i) => progress.push(i), onPlan: (n) => (planned = n) });
    expect(planned).toBe(2);
    expect(r.lanes).toBe(2);
    expect(workers).toHaveLength(2);
    expect(progress.sort()).toEqual([0, 1, 2, 3]);
    const direct = await physics.verify(doc, { budgetMs: 10_000 });
    expect(r.report.results).toEqual(direct.results);
    expect(r.report.diagnostics).toEqual(direct.diagnostics);
    expect(r.report.passed).toBe(direct.passed);
    pool.dispose();
    expect(workers.every((w) => w.terminated)).toBe(true);
  });

  it('cancels: the abort rejects at once and a cancel message reaches every running lane', async () => {
    const workers: FakeWorker[] = [];
    const pool = new VerifyPool({ lanes: 2, idleMs: 0, createWorker: () => (workers.push(new FakeWorker()), workers[workers.length - 1] as FakeWorker) });
    const ctrl = new AbortController();
    const run = pool.verify(multiTestWorld(), { colliders: [], maxSeconds: 12, budgetMs: 10_000, signal: ctrl.signal });
    await new Promise((r) => setTimeout(r, 5));
    ctrl.abort();
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    for (const w of workers) expect(w.received.some((m) => (m as { type?: string }).type === 'cancel')).toBe(true);
    pool.dispose();
  });

  it('a worker that never starts disables the pool (WorkerUnavailableError → main-thread fallback)', async () => {
    const pool = new VerifyPool({
      lanes: 1,
      idleMs: 0,
      createWorker: () => {
        const w = new FakeWorker({ silent: true });
        setTimeout(() => w.onerror?.(new Event('error')), 0);
        return w;
      },
    });
    await expect(pool.verify(multiTestWorld(), { colliders: [], maxSeconds: 12, budgetMs: 1000 })).rejects.toBeInstanceOf(WorkerUnavailableError);
    expect(pool.available).toBe(false);
    const service = new VerificationService(pool, async (w) => physics.verify(w, { budgetMs: 10_000 }));
    const planned: Array<{ lanes: number; worker: boolean }> = [];
    const out = await service.run(multiTestWorld(), { maxSeconds: 12, budgetMs: 10_000, onPlan: (p) => planned.push(p) });
    expect(out.ok && out.worker).toBe(false);
    expect(out.ok && out.report.results).toHaveLength(4);
    expect(planned).toEqual([{ lanes: 1, worker: false }]);
  });

  it('a constructor that throws disables the pool', async () => {
    const pool = new VerifyPool({
      createWorker: () => {
        throw new Error('module workers unsupported');
      },
    });
    await expect(pool.verify(multiTestWorld(), { colliders: [], maxSeconds: 12, budgetMs: 1000 })).rejects.toBeInstanceOf(WorkerUnavailableError);
    expect(pool.available).toBe(false);
  });

  it('a request past its time budget terminates the worker with a timeout error', async () => {
    vi.useFakeTimers();
    try {
      const hung: FakeWorker[] = [];
      const pool = new VerifyPool({
        lanes: 1,
        slackMs: 0,
        idleMs: 0,
        createWorker: () => {
          const w = new FakeWorker();
          w.postMessage = () => undefined; // swallows requests: never answers
          hung.push(w);
          return w;
        },
      });
      const run = pool.verify(multiTestWorld(), { colliders: [], maxSeconds: 12, budgetMs: 100 });
      const caught = run.catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(1); // 'ready'
      // A cold worker gets the start allowance (15 s) even when the budget is shorter.
      await vi.advanceTimersByTimeAsync(16_000);
      const err = await caught;
      expect(err).toBeInstanceOf(VerifyTimeoutError);
      expect(hung[0]?.terminated).toBe(true);
      expect(pool.liveWorkers).toBe(0);
      expect(pool.available).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('terminates idle workers after the idle period', async () => {
    vi.useFakeTimers();
    try {
      const workers: FakeWorker[] = [];
      const pool = new VerifyPool({ lanes: 1, idleMs: 1000, createWorker: () => (workers.push(new FakeWorker()), workers[workers.length - 1] as FakeWorker) });
      pool.warm();
      await vi.advanceTimersByTimeAsync(50);
      expect(pool.liveWorkers).toBe(1);
      await vi.advanceTimersByTimeAsync(1100);
      expect(pool.liveWorkers).toBe(0);
      expect(workers[0]?.terminated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores replies that fail validation or name unknown requests', async () => {
    const w = new FakeWorker();
    const pool = new VerifyPool({ lanes: 1, idleMs: 0, createWorker: () => w });
    const run = pool.verify(multiTestWorld(), { colliders: [], maxSeconds: 12, budgetMs: 10_000 });
    w.onmessage?.({ data: { type: 'verified', id: 999, report: {} } } as MessageEvent);
    w.onmessage?.({ data: { type: 'verified', id: 1, report: { passed: 'yes' } } } as MessageEvent);
    w.onmessage?.({ data: '<script>' } as MessageEvent);
    const r = await run;
    expect(r.report.results).toHaveLength(4);
    pool.dispose();
  });
});

describe('renderer colliders for the worker', () => {
  it('copies only shapes the worker cannot rebuild (custom generators, models)', () => {
    const doc = world(
      [
        { id: 'tree', shape: { kind: 'procedural', generator: 'tree', params: {} }, physics: { body: 'static' } },
        { id: 'blob', shape: { kind: 'procedural', generator: 'blob', params: {} }, physics: { body: 'static' } },
        { id: 'statue', shape: { kind: 'model', url: '/models/statue.glb' }, physics: { body: 'static' } },
        { id: 'crate', shape: { kind: 'primitive', primitive: 'box' }, physics: { body: 'dynamic' } },
      ],
      { generators: { blob: { id: 'blob', description: 'a blob', source: 'api.add(api.box(1,1,1));', params: {} } } },
    );
    expect(Object.values(doc.entities).filter((e) => needsRendererColliders(doc, e)).map((e) => e.id).sort()).toEqual(['blob', 'statue']);
    const provider = vi.fn((e: { id: string }) => (e.id === 'statue' ? undefined : [{ kind: 'sphere' as const, radius: 1, offset: [0, 1, 0] as [number, number, number] }]));
    expect(workerColliders(doc, provider)).toEqual([['blob', [{ kind: 'sphere', radius: 1, offset: [0, 1, 0] }]]]);
    expect(workerColliders(doc, undefined)).toEqual([]);
    expect(workerColliders(doc, () => {
      throw new Error('boom');
    })).toEqual([]);
  });
});

describe('LiveVerifyFeed', () => {
  function sink() {
    let state: VerifyState = { status: 'idle', summary: '', results: [], diagnostics: [], head: null, ms: 0 };
    const writes: Array<Partial<VerifyState>> = [];
    return {
      writes,
      get state() {
        return state;
      },
      sink: { get: () => state, set: (p: Partial<VerifyState>) => (writes.push(p), (state = { ...state, ...p })), head: () => 12 },
    };
  }

  it('lists every test at start, coalesces result bursts and writes the final report', async () => {
    vi.useFakeTimers();
    try {
      const s = sink();
      const feed = new LiveVerifyFeed(s.sink);
      feed.start(multiTestWorld());
      expect(s.state.status).toBe('running');
      expect(s.state.head).toBe(12);
      expect(s.state.live?.tests.map((t) => t.id)).toEqual(['rest', 'clear', 'goal', 'falls']);
      feed.plan({ lanes: 2, worker: true });
      for (let i = 0; i < 4; i++) feed.result(i, { id: `t${i}`, kind: 'stable', passed: i !== 3, message: 'm' });
      feed.result(99, { id: 'x', kind: 'k', passed: true, message: '' });
      const before = s.writes.length;
      await vi.advanceTimersByTimeAsync(FLUSH_MS + 1);
      expect(s.writes.length).toBe(before + 1);
      expect(s.state.live?.lanes).toBe(2);
      expect(s.state.live?.results.filter((r) => r !== null)).toHaveLength(4);
      feed.end({ report: { passed: false, results: [{ id: 'falls', kind: 'staysAbove', passed: false, message: 'fell' }], diagnostics: [], simulatedSeconds: 5, ms: 30 }, summary: 's', passed: false, lanes: 2, worker: true, cancelled: false }, 42);
      expect(s.state).toMatchObject({ status: 'failed', ms: 42, lanes: 2, worker: true, simulatedSeconds: 5, live: null });
      feed.end({ report: { error: 'verification cancelled' }, summary: '', passed: false, lanes: 1, worker: true, cancelled: true }, 1);
      expect(s.state.status).toBe('idle');
    } finally {
      vi.useRealTimers();
    }
  });
});
