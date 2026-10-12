import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Json, ScriptDef } from '@aether/core';
import {
  createScriptRunner,
  initScripting,
  isScriptingReady,
  EMPTY_INPUT,
  LogicRuntime,
  MAX_INTENTS_PER_CALL,
  MAX_SCRIPT_CALLS_PER_TICK,
  SCRIPT_API_DTS,
  SCRIPT_HEAP_BUDGET_BYTES,
  scriptHeapUsage,
  validateIntents,
  type ManagedScriptRunner,
  type ScriptSnapshot,
} from '../src';
import { FakeHost, logText, run, worldOf } from './helpers';

const snap = (over: Partial<ScriptSnapshot> = {}): ScriptSnapshot => ({
  dt: 1 / 60,
  time: 0,
  self: { id: 'e', position: [0, 0, 0], velocity: [0, 0, 0], state: {} },
  world: { score: 0 },
  nearby: [],
  input: { forward: 0, right: 0, jump: false, action: false },
  ...over,
});

const def = (id: string, source: string): ScriptDef => ({ id, description: 'test', source });

let runner: ManagedScriptRunner;
const runners: ManagedScriptRunner[] = [];
function newRunner(opts?: Parameters<typeof createScriptRunner>[0]): ManagedScriptRunner {
  const r = createScriptRunner(opts);
  runners.push(r);
  return r;
}

beforeAll(async () => {
  await initScripting();
  await initScripting(); // idempotent
});

afterEach(() => {
  for (const r of runners.splice(0)) r.dispose();
});

describe('script runner', () => {
  it('initializes once and reports readiness', () => {
    expect(isScriptingReady()).toBe(true);
  });

  it('caps the summed heap of all script runtimes on the shared WASM module', () => {
    const base = scriptHeapUsage().reservedBytes;
    const per = 16 * 1024 * 1024;
    const a = newRunner({ memoryLimitBytes: per });
    const b = newRunner({ memoryLimitBytes: per });
    const fit = Math.floor((SCRIPT_HEAP_BUDGET_BYTES - base) / per);
    for (let i = 0; i < fit + 3; i++) (i % 2 === 0 ? a : b).load(def(`s${i}`, 'return [];'));
    expect(a.activeScripts().length + b.activeScripts().length).toBe(fit);
    const diags = [...a.takeDiagnostics(), ...b.takeDiagnostics()].map((d) => d.text);
    expect(diags.some((t) => /memory budget exhausted/.test(t))).toBe(true);
    expect(scriptHeapUsage().reservedBytes).toBeLessThanOrEqual(SCRIPT_HEAP_BUDGET_BYTES);
    // Unloading and disposing return the reservation.
    a.unload('s0');
    a.dispose();
    b.dispose();
    expect(scriptHeapUsage().reservedBytes).toBe(base);
  });

  it('runs a script body and returns validated intents', () => {
    runner = newRunner();
    runner.load(def('mover', `return [{ do: 'moveTo', target: [ctx.self.position[0] + 1, 0, 0], speed: 2 }];`));
    expect(runner.update('mover', 'e', snap())).toEqual([{ do: 'moveTo', target: [1, 0, 0], speed: 2 }]);
  });

  it('accepts a single intent object and undefined/empty results', () => {
    runner = newRunner();
    runner.load(def('one', `if (ctx.time > 1) return { do: 'add', key: 'score', amount: 1 };`));
    expect(runner.update('one', 'e', snap())).toEqual([]);
    expect(runner.update('one', 'e', snap({ time: 2 }))).toEqual([{ do: 'add', key: 'score', amount: 1 }]);
  });

  it('interrupts infinite loops within the budget and disables after 3 overruns', () => {
    runner = newRunner({ budgetMs: 5 });
    runner.load(def('spin-forever', `while (true) {}`));
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      expect(runner.update('spin-forever', 'e', snap())).toEqual([]);
      expect(performance.now() - t0).toBeLessThan(250);
    }
    const diags = runner.takeDiagnostics().map((d) => d.text);
    expect(diags.filter((d) => d.includes('exceeded 5ms budget'))).toHaveLength(3);
    expect(diags.at(-1)).toContain("disabled: exceeded its time budget 3 times");
    expect(runner.activeScripts()).not.toContain('spin-forever');
    const t0 = performance.now();
    expect(runner.update('spin-forever', 'e', snap())).toEqual([]);
    expect(performance.now() - t0).toBeLessThan(5);
  });

  it('cannot reach host globals or dynamic code evaluation', () => {
    runner = newRunner();
    runner.load(
      def(
        'probe',
        `
        const probe = (f) => { try { return f(); } catch (e) { return 'threw'; } };
        return [
          { do: 'setSelfState', key: 'fetch', value: typeof fetch },
          { do: 'setSelfState', key: 'process', value: typeof process },
          { do: 'setSelfState', key: 'require', value: typeof require },
          { do: 'setSelfState', key: 'window', value: typeof window },
          { do: 'setSelfState', key: 'date', value: typeof Date },
          { do: 'setSelfState', key: 'eval', value: probe(() => eval('1 + 1')) },
          { do: 'setSelfState', key: 'fn', value: probe(() => Function('return globalThis.process')()) === undefined || probe(() => Function('return 1')()) === 'threw' },
          { do: 'setSelfState', key: 'promise', value: typeof Promise },
          { do: 'setSelfState', key: 'regexp', value: typeof RegExp },
          { do: 'setSelfState', key: 'globals', value: Object.getOwnPropertyNames(globalThis).filter((k) => ['fetch', 'process', 'require', 'XMLHttpRequest', 'WebSocket', 'importScripts', 'postMessage', 'std', 'os', 'print', 'console'].includes(k)) },
        ];`,
      ),
    );
    const out = runner.update('probe', 'e', snap());
    const values = Object.fromEntries(out.map((i) => [(i as { key: string }).key, (i as { value: Json }).value]));
    expect(values).toMatchObject({
      fetch: 'undefined',
      process: 'undefined',
      require: 'undefined',
      window: 'undefined',
      date: 'undefined',
      promise: 'undefined',
      regexp: 'undefined',
      globals: [],
    });
    expect(values['eval']).not.toBe(2);
    expect(values['fn']).toBe(true);
  });

  it('cannot pollute host prototypes through its output', () => {
    runner = newRunner();
    runner.load(def('pollute', `return JSON.parse('[{"do":"set","key":"x","value":{"__proto__":{"polluted":true}}}]');`));
    expect(runner.update('pollute', 'e', snap())).toEqual([]);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(runner.takeDiagnostics()[0]?.text).toContain('forbidden key');
  });

  it('rejects invalid intents and keeps valid ones', () => {
    runner = newRunner();
    runner.load(
      def(
        'mixed',
        `return [
          { do: 'nope' },
          { do: 'add', key: 'score', amount: 'lots' },
          { do: 'moveTo', target: [1, 2], speed: 1 },
          { do: 'setSelfState', key: 'a.b', value: 1 },
          { do: 'moveTo', target: [0, 0, 0], speed: 1, extra: true },
          'string',
          { do: 'add', key: 'score', amount: 2 },
        ];`,
      ),
    );
    expect(runner.update('mixed', 'e', snap())).toEqual([{ do: 'add', key: 'score', amount: 2 }]);
    expect(runner.takeDiagnostics()).toHaveLength(6);
  });

  it(`caps intents at ${MAX_INTENTS_PER_CALL} per call`, () => {
    runner = newRunner();
    runner.load(def('flood', `const out = []; for (let i = 0; i < 100; i++) out.push({ do: 'add', key: 'score', amount: 1 }); return out;`));
    expect(runner.update('flood', 'e', snap())).toHaveLength(MAX_INTENTS_PER_CALL);
  });

  it('survives runtime errors, syntax errors and stack overflows', () => {
    runner = newRunner({ maxErrors: 2 });
    runner.load(def('throws', `throw new Error('boom');`));
    runner.load(def('syntax', `return [;`));
    runner.load(def('recurse', `const f = (n) => f(n + 1) + 1; return f(0);`));
    expect(runner.update('throws', 'e', snap())).toEqual([]);
    expect(runner.update('throws', 'e', snap())).toEqual([]);
    expect(runner.update('syntax', 'e', snap())).toEqual([]);
    expect(runner.update('recurse', 'e', snap())).toEqual([]);
    const text = runner.takeDiagnostics().map((d) => d.text).join('\n');
    expect(text).toContain('Error: boom');
    expect(text).toContain("script 'throws' disabled: 2 errors");
    expect(text).toMatch(/script 'syntax' disabled: failed to load: SyntaxError/);
    expect(text).toMatch(/stack overflow|too much recursion|RangeError|InternalError/i);
  });

  it('enforces the memory limit', () => {
    runner = newRunner({ memoryLimitBytes: 4 * 1024 * 1024, budgetMs: 2000 });
    runner.load(def('hog', `const a = []; for (;;) a.push(new Array(10000).fill(1.5));`));
    expect(runner.update('hog', 'e', snap())).toEqual([]);
    expect(runner.takeDiagnostics().map((d) => d.text).join('\n')).toMatch(/out of memory|exceeded/);
    // the runner keeps working for other scripts
    runner.load(def('ok', `return [{ do: 'sound', sound: 'bell' }];`));
    expect(runner.update('ok', 'e', snap())).toEqual([{ do: 'sound', sound: 'bell' }]);
  });

  it('has a deterministic Math.random and no Date', () => {
    const src = `return [{ do: 'setSelfState', key: 'r', value: [Math.random(), Math.random()] }];`;
    const a = newRunner({ seed: 42 });
    const b = newRunner({ seed: 42 });
    a.load(def('rand', src));
    b.load(def('rand', src));
    const ra = a.update('rand', 'e', snap());
    expect(ra).toEqual(b.update('rand', 'e', snap()));
    const c = newRunner({ seed: 43 });
    c.load(def('rand', src));
    expect(c.update('rand', 'e', snap())).not.toEqual(ra);
  });

  it('recompiles only when the source changes', () => {
    runner = newRunner();
    runner.load(def('vv', `globalThis.n = (globalThis.n || 0) + 1; return [{ do: 'setSelfState', key: 'n', value: globalThis.n }];`));
    runner.update('vv', 'e', snap());
    runner.load(def('vv', `globalThis.n = (globalThis.n || 0) + 1; return [{ do: 'setSelfState', key: 'n', value: globalThis.n }];`));
    expect(runner.update('vv', 'e', snap())).toEqual([{ do: 'setSelfState', key: 'n', value: 2 }]);
    runner.load(def('vv', `return [{ do: 'setSelfState', key: 'n', value: 'new' }];`));
    expect(runner.update('vv', 'e', snap())).toEqual([{ do: 'setSelfState', key: 'n', value: 'new' }]);
    runner.unload('vv');
    expect(runner.update('vv', 'e', snap())).toEqual([]);
  });

  it('rejects malformed script definitions', () => {
    runner = newRunner();
    runner.load({ id: 'Bad Id', description: '', source: 'return []' } as ScriptDef);
    expect(runner.takeDiagnostics()[0]?.text).toContain('script rejected');
    expect(runner.activeScripts()).toEqual([]);
  });

  it('is unusable after dispose (and dispose is idempotent)', () => {
    const r = createScriptRunner();
    r.load(def('xx', 'return []'));
    r.dispose();
    r.dispose();
    expect(r.update('xx', 'e', snap())).toEqual([]);
    expect(() => r.load(def('yy', 'return []'))).toThrow(/disposed/);
  });

  it('does not leak: many load/dispose cycles stay healthy', () => {
    for (let i = 0; i < 30; i++) {
      const r = createScriptRunner();
      r.load(def('aa', `return [{ do: 'setSelfState', key: 'i', value: ${i} }];`));
      expect(r.update('aa', 'e', snap())).toEqual([{ do: 'setSelfState', key: 'i', value: i }]);
      r.dispose();
    }
  });
});

describe('scripts in the runtime', () => {
  it('moves the entity, persists self state and applies actions', () => {
    const r = newRunner();
    const host = new FakeHost();
    const w = worldOf(
      [{ id: 'drone', behaviors: [{ type: 'script', params: { script: 'patroller' } }] }],
      [],
      {
        state: { score: 0 },
        scripts: {
          patroller: def(
            'patroller',
            `const n = (ctx.self.state.ticks || 0) + 1;
             const out = [{ do: 'setSelfState', key: 'ticks', value: n }, { do: 'moveTo', target: [10, 0, 0], speed: 6 }];
             if (n === 30) out.push({ do: 'add', key: 'score', amount: 5 }, { do: 'setProperty', target: 'self', path: 'visible', value: false });
             return out;`,
          ),
        },
      },
    );
    const rt = new LogicRuntime(w, host, { scripts: r });
    run(rt, 60);
    expect(rt.readState('drone.ticks')).toBe(60);
    expect(rt.readState('score')).toBe(5);
    expect(host.getTransform('drone')?.position[0]).toBeCloseTo(6, 6);
    expect(host.properties).toEqual([{ id: 'drone', path: 'visible', value: false }]);
    expect(logText(rt.log)).toContain("script 'patroller' on drone: score 0→5");
  });

  it('surfaces overruns in the runtime log and keeps ticking', () => {
    const r = newRunner({ budgetMs: 3 });
    const host = new FakeHost();
    const w = worldOf([{ id: 'bad', behaviors: [{ type: 'script', params: { script: 'loop' } }] }], [{ id: 't', when: { on: 'tick', every: 0.05 }, then: [{ do: 'add', key: 'score', amount: 1 }] }], {
      scripts: { loop: def('loop', 'for (;;) {}') },
    });
    const rt = new LogicRuntime(w, host, { scripts: r });
    run(rt, 6);
    expect(logText(rt.log)).toContain("script 'loop' on bad: script 'loop' disabled: exceeded its time budget 3 times");
    expect(rt.readState('score')).toBe(2);
  });

  it('logs a clear message when no runner is configured or the script is missing', () => {
    const host = new FakeHost();
    const w = worldOf([{ id: 'a', behaviors: [{ type: 'script', params: { script: 'ghost' } }] }]);
    const rt = new LogicRuntime(w, host);
    run(rt, 3);
    expect(logText(rt.log)).toContain("script 'ghost' on a skipped: no ScriptRunner configured");
    const rt2 = new LogicRuntime(w, host, { scripts: newRunner() });
    run(rt2, 3);
    expect(logText(rt2.log)).toContain("script 'ghost' on a not found in world.scripts");
  });
});

describe('intent validation (host side)', () => {
  it('handles hostile shapes', () => {
    expect(validateIntents(null).intents).toEqual([]);
    expect(validateIntents({ do: 'reset' }).intents).toEqual([{ do: 'reset' }]);
    const deep: unknown[] = [];
    let cur = deep;
    for (let i = 0; i < 100; i++) {
      const next: unknown[] = [];
      cur.push(next);
      cur = next;
    }
    expect(validateIntents(deep).problems[0]).toContain('nested deeper');
  });

  it('documents the API for the LLM', () => {
    expect(SCRIPT_API_DTS).toContain('interface ScriptContext');
    expect(SCRIPT_API_DTS).toContain("do: 'moveTo'");
    expect(SCRIPT_API_DTS).toContain("do: 'setSelfState'");
  });
});

describe('script tick budget', () => {
  it('caps script calls per tick deterministically and serves every slot round-robin with catch-up dt', () => {
    const calls: Array<{ tick: number; id: string; dt: number }> = [];
    let tick = 0;
    const fake = {
      load() {},
      update(_scriptId: string, entityId: string, s: ScriptSnapshot) {
        calls.push({ tick, id: entityId, dt: s.dt });
        return [];
      },
      dispose() {},
    };
    const n = MAX_SCRIPT_CALLS_PER_TICK + 16;
    const entities = Array.from({ length: n }, (_, i) => ({
      id: `bot-${i}`,
      transform: { position: [i * 2, 0, 0] as [number, number, number] },
      behaviors: [{ type: 'script' as const, params: { script: 'brain' } }],
    }));
    const w = worldOf(entities, [], { scripts: { brain: def('brain', 'return [];') } });
    const rt = new LogicRuntime(w, new FakeHost(), { scripts: fake });
    for (tick = 0; tick < 6; tick++) rt.tick(1 / 60, EMPTY_INPUT, []);
    const perTick = new Map<number, number>();
    for (const c of calls) perTick.set(c.tick, (perTick.get(c.tick) ?? 0) + 1);
    for (const count of perTick.values()) expect(count).toBeLessThanOrEqual(MAX_SCRIPT_CALLS_PER_TICK);
    const served = new Set(calls.map((c) => c.id));
    expect(served.size).toBe(n); // nobody starves
    // A deferred slot receives the simulated time it missed.
    expect(Math.max(...calls.map((c) => c.dt))).toBeGreaterThan(1 / 60 + 1e-9);
  });

  it('finds neighbours through the per-tick grid (same result as a linear scan)', () => {
    const seen: string[][] = [];
    const fake = {
      load() {},
      update(_s: string, entityId: string, s: ScriptSnapshot) {
        if (entityId === 'center') seen.push(s.nearby.map((x) => x.id));
        return [];
      },
      dispose() {},
    };
    const ents = [
      { id: 'center', behaviors: [{ type: 'script' as const, params: { script: 'brain-b' } }] },
      { id: 'near', transform: { position: [3, 0, 0] as [number, number, number] } },
      { id: 'edge', transform: { position: [0, 0, 14.9] as [number, number, number] } },
      { id: 'far', transform: { position: [0, 0, 15.5] as [number, number, number] } },
      { id: 'neg', transform: { position: [-14, 0, 0] as [number, number, number] } },
    ];
    const rt = new LogicRuntime(worldOf(ents, [], { scripts: { 'brain-b': def('brain-b', 'return [];') } }), new FakeHost(), { scripts: fake });
    rt.tick(1 / 60, EMPTY_INPUT, []);
    expect(seen[0]).toEqual(['near', 'neg', 'edge']);
  });
});
