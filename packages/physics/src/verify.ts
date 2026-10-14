/**
 * Headless verification of `world.tests`: build a fresh PhysicsWorld,
 * fast-forward with fixed steps (optionally driving gameplay logic through a
 * hook) until every test is decided, the simulated horizon is reached or the
 * wall-clock budget runs out.
 */
import { navigableVerdict } from '@aether/arch';
import type { EntityId, Vec3, WorldDoc, WorldTest } from '@aether/core';
import { compare, readStateKey, resolveSelector } from '@aether/core';
import { diagnoseWorld, findOverlaps } from './diagnose';
import { entityPose } from './plan';
import { collidersBounds } from './shapes';
import { resolveShapeColliders } from './source';
import { TraceRecorder, type TraceOptions } from './trace';
import { GROUND_ID, type ColliderProvider, type LogicHook, type PhysicsEvent, type Quat, type TestResult, type VerifyReport } from './types';
import { distance, fmt, rotate, tiltDegrees } from './vec';
import { yieldToHost } from './yield';
import { PhysicsWorld } from './world';

/** Defaults and caps of {@link verify}. */
export const VERIFY_LIMITS = Object.freeze({
  DEFAULT_MAX_SECONDS: 12,
  MAX_SECONDS: 60,
  DEFAULT_BUDGET_MS: 1500,
  MAX_BUDGET_MS: 30_000,
  /** Zone bounds are expanded by this margin (m) for `reaches`. */
  ZONE_MARGIN: 0.1,
  /** Max entity ids listed in one message. */
  MAX_LISTED: 5,
});

/** Options of {@link verify}. */
export interface VerifyOptions {
  colliders?: ColliderProvider;
  logic?: (pw: PhysicsWorld) => LogicHook;
  maxSeconds?: number;
  /** Compute budget in ms (time spent stepping; time yielded to the host is not counted). */
  budgetMs?: number;
  /**
   * Yield to the event loop after this many ms of continuous stepping
   * (default {@link VERIFY_SLICE_MS}; 0 disables yielding).
   */
  sliceMs?: number;
  /**
   * Run only these indices of `world.tests` (a shard of a parallel run).
   * Out-of-range and duplicate indices are ignored. The report then lists
   * results for exactly these tests, in ascending index order, and sets
   * `testIndices`.
   */
  tests?: readonly number[];
  /** Compute static diagnostics (default true; parallel shards skip them except one). */
  diagnostics?: boolean;
  /** Abort the run: the promise rejects with an `AbortError` at the next step. */
  signal?: AbortSignal;
  /** Called once per test as soon as it is decided (incremental progress). */
  onResult?: (index: number, result: TestResult) => void;
  /**
   * Record the motion of the bodies that move (`report.trace`) for a replay.
   * The run then continues to at least `minSeconds` of simulated time
   * (default 3 s, within `maxSeconds` and the budget) after the tests are
   * decided.
   */
  trace?: boolean | TraceOptions;
}

/** Error thrown by {@link verify} when its `signal` aborts. */
export class VerifyAbortedError extends Error {
  override name = 'AbortError';
  constructor() {
    super('verification cancelled');
  }
}

/** Sorted, de-duplicated, in-range test indices of a shard (all tests when `only` is undefined). */
export function shardIndices(count: number, only: readonly number[] | undefined): number[] {
  if (!only) return Array.from({ length: count }, (_, i) => i);
  const set = new Set<number>();
  for (const i of only) if (Number.isInteger(i) && i >= 0 && i < count) set.add(i);
  return [...set].sort((a, b) => a - b);
}

/** Default stepping slice before verify yields to the host (keeps a UI thread responsive). */
export const VERIFY_SLICE_MS = 8;

type Verdict = { passed: boolean; message: string } | null;

/** A running test: `check` returns a verdict once decided, `timeout` when time ran out. */
interface Evaluator {
  test: WorldTest;
  /** Simulated seconds this test needs at most. */
  horizon: number;
  check(t: number): Verdict;
  onEvents?(events: readonly PhysicsEvent[]): void;
  timeout(t: number): string;
}

interface Ctx {
  pw: PhysicsWorld;
  world: WorldDoc;
  hook: LogicHook | null;
}

function list(ids: readonly string[]): string {
  const shown = ids.slice(0, VERIFY_LIMITS.MAX_LISTED).join(', ');
  return ids.length > VERIFY_LIMITS.MAX_LISTED ? `${shown} (+${ids.length - VERIFY_LIMITS.MAX_LISTED} more)` : shown;
}

function targets(ctx: Ctx, selector: string): EntityId[] {
  const playerId = ctx.world.player.controls;
  return resolveSelector(ctx.world, selector, playerId ? { playerId } : undefined);
}

function position(ctx: Ctx, id: EntityId): Vec3 {
  return ctx.pw.getState(id)?.position ?? entityPose(ctx.world, id).position;
}

function orientation(ctx: Ctx, id: EntityId): Quat {
  return ctx.pw.getState(id)?.quaternion ?? entityPose(ctx.world, id).quaternion;
}

function noTargets(test: WorldTest, selector: string): Evaluator {
  return { test, horizon: 0, check: () => ({ passed: false, message: `selector '${selector}' matched no entities` }), timeout: () => '' };
}

/** World-space AABB of an entity's shape. */
function zoneBounds(ctx: Ctx, id: EntityId): { min: Vec3; max: Vec3 } | null {
  const e = ctx.world.entities[id];
  if (!e) return null;
  const local = collidersBounds(resolveShapeColliders(e, 'auto', ctx.world).colliders);
  if (!local) return null;
  const pose = entityPose(ctx.world, id);
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const x of [local.min[0], local.max[0]]) for (const y of [local.min[1], local.max[1]]) for (const z of [local.min[2], local.max[2]]) {
    const p = rotate(pose.quaternion, [x * pose.scale[0], y * pose.scale[1], z * pose.scale[2]]);
    for (let k = 0; k < 3; k++) {
      const v = (p[k] as number) + (pose.position[k] as number);
      if (v < (min[k] as number)) min[k] = v;
      if (v > (max[k] as number)) max[k] = v;
    }
  }
  const m = VERIFY_LIMITS.ZONE_MARGIN;
  return { min: [min[0] - m, min[1] - m, min[2] - m], max: [max[0] + m, max[1] + m, max[2] + m] };
}

function inBox(p: Vec3, b: { min: Vec3; max: Vec3 }): boolean {
  return p[0] >= b.min[0] && p[0] <= b.max[0] && p[1] >= b.min[1] && p[1] <= b.max[1] && p[2] >= b.min[2] && p[2] <= b.max[2];
}

function stableTest(ctx: Ctx, test: Extract<WorldTest, { kind: 'stable' }>): Evaluator {
  const ids = targets(ctx, test.target).filter((id) => ctx.pw._records().get(id)?.type === 'dynamic');
  const start = new Map(ids.map((id) => [id, position(ctx, id)] as const));
  return {
    test,
    horizon: test.seconds,
    check: (t) => {
      if (ids.length === 0) return { passed: true, message: `no dynamic bodies match '${test.target}'` };
      let worst = 0;
      let worstId = '';
      for (const id of ids) {
        const d = distance(position(ctx, id), start.get(id) as Vec3);
        if (d > worst) {
          worst = d;
          worstId = id;
        }
      }
      if (worst > test.maxDrift) return { passed: false, message: `${worstId} drifted ${fmt(worst)}m (max ${fmt(test.maxDrift)}m) by t=${fmt(t, 1)}s; it is not resting stably` };
      if (t >= test.seconds) return { passed: true, message: `${ids.length} bod${ids.length === 1 ? 'y' : 'ies'} stayed within ${fmt(test.maxDrift)}m for ${fmt(test.seconds, 1)}s` };
      return null;
    },
    timeout: (t) => `not decided: simulation stopped at t=${fmt(t, 1)}s before ${fmt(test.seconds, 1)}s`,
  };
}

function noOverlapTest(ctx: Ctx, test: Extract<WorldTest, { kind: 'noOverlap' }>): Evaluator {
  const ids = test.target === '*' ? null : new Set(targets(ctx, test.target));
  const pairs = ids && ids.size === 0 ? [] : findOverlaps(ctx.pw, ids ?? undefined);
  const verdict: Verdict = pairs.length === 0
    ? { passed: true, message: 'no interpenetrating bodies at t=0' }
    : { passed: false, message: `${pairs.length} overlap(s) at t=0: ${pairs.slice(0, VERIFY_LIMITS.MAX_LISTED).map((p) => `${p.a}/${p.b === GROUND_ID ? 'ground' : p.b} by ${fmt(p.depth)}m`).join(', ')}` };
  return { test, horizon: 0, check: () => verdict, timeout: () => '' };
}

function reachesTest(ctx: Ctx, test: Extract<WorldTest, { kind: 'reaches' }>): Evaluator {
  const ids = targets(ctx, test.target);
  if (ids.length === 0) return noTargets(test, test.target);
  const zone = test.zone;
  let zoneIds: Set<EntityId> = new Set();
  let boxes: Array<{ min: Vec3; max: Vec3 }> = [];
  let label: string;
  if (typeof zone === 'string') {
    zoneIds = new Set(targets(ctx, zone));
    if (zoneIds.size === 0) return noTargets(test, zone);
    boxes = [...zoneIds].map((id) => zoneBounds(ctx, id)).filter((b): b is { min: Vec3; max: Vec3 } => b !== null);
    label = `'${zone}'`;
  } else {
    label = `sphere at [${zone.center.map((v) => fmt(v)).join(', ')}] r=${fmt(zone.radius)}`;
  }
  const targetSet = new Set(ids);
  let touched: EntityId | null = null;
  let closest = Infinity;
  return {
    test,
    horizon: test.within,
    onEvents: (events) => {
      for (const e of events) {
        if (e.type !== 'collisionStart' && e.type !== 'sensorEnter') continue;
        if (targetSet.has(e.a) && zoneIds.has(e.b)) touched = e.a;
        else if (targetSet.has(e.b) && zoneIds.has(e.a)) touched = e.b;
      }
    },
    check: (t) => {
      if (touched) return { passed: true, message: `${touched} reached ${label} at t=${fmt(t, 1)}s` };
      for (const id of ids) {
        const p = position(ctx, id);
        if (typeof zone === 'string') {
          for (const b of boxes) if (inBox(p, b)) return { passed: true, message: `${id} reached ${label} at t=${fmt(t, 1)}s` };
        } else {
          const d = distance(p, zone.center) - zone.radius;
          if (d <= 0) return { passed: true, message: `${id} reached ${label} at t=${fmt(t, 1)}s` };
          closest = Math.min(closest, d);
        }
      }
      if (t >= test.within) {
        const how = Number.isFinite(closest) ? ` (closest approach ${fmt(closest)}m)` : '';
        return { passed: false, message: `${list(ids)} did not reach ${label} within ${fmt(test.within, 1)}s${how}` };
      }
      return null;
    },
    timeout: (t) => `not decided: simulation stopped at t=${fmt(t, 1)}s (needs ${fmt(test.within, 1)}s)`,
  };
}

function eventuallyTest(ctx: Ctx, test: Extract<WorldTest, { kind: 'eventually' }>): Evaluator {
  const { key, op, value } = test.condition;
  const read = (): ReturnType<LogicHook['readState']> => {
    const v = ctx.hook?.readState(key);
    return v !== undefined ? v : readStateKey(ctx.world, key);
  };
  return {
    test,
    horizon: test.within,
    check: (t) => {
      const v = read();
      if (compare(v, op, value)) return { passed: true, message: `${key} ${op} ${JSON.stringify(value)} became true at t=${fmt(t, 1)}s` };
      if (t >= test.within) {
        const why = ctx.hook ? '' : ' (no logic hook: rules did not run)';
        return { passed: false, message: `${key} was ${JSON.stringify(v ?? null)}; expected ${op} ${JSON.stringify(value)} within ${fmt(test.within, 1)}s${why}` };
      }
      return null;
    },
    timeout: (t) => `not decided: simulation stopped at t=${fmt(t, 1)}s (needs ${fmt(test.within, 1)}s)`,
  };
}

/** Shared shape of `moves`/`topples`: every target must reach a per-target measure. */
function allTargetsTest(
  ctx: Ctx,
  test: WorldTest,
  selector: string,
  within: number,
  goal: number,
  unit: string,
  verb: string,
  measure: (id: EntityId) => number,
): Evaluator {
  const ids = targets(ctx, selector);
  if (ids.length === 0) return noTargets(test, selector);
  const best = new Map<EntityId, number>(ids.map((id) => [id, 0]));
  const done = new Set<EntityId>();
  return {
    test,
    horizon: within,
    check: (t) => {
      for (const id of ids) {
        if (done.has(id)) continue;
        const m = measure(id);
        if (m > (best.get(id) as number)) best.set(id, m);
        if (m >= goal) done.add(id);
      }
      if (done.size === ids.length) return { passed: true, message: `all ${ids.length} ${verb} by t=${fmt(t, 1)}s` };
      if (t >= within) {
        const missing = ids.filter((id) => !done.has(id));
        const first = missing[0] as EntityId;
        return {
          passed: false,
          message: `${done.size}/${ids.length} ${verb} within ${fmt(within, 1)}s; not: ${list(missing)} (${first} reached ${fmt(best.get(first) as number, 1)}${unit} of ${fmt(goal, 1)}${unit})`,
        };
      }
      return null;
    },
    timeout: (t) => `not decided: ${done.size}/${ids.length} ${verb} when simulation stopped at t=${fmt(t, 1)}s`,
  };
}

function staysAboveTest(ctx: Ctx, test: Extract<WorldTest, { kind: 'staysAbove' }>): Evaluator {
  const ids = targets(ctx, test.target);
  if (ids.length === 0) return noTargets(test, test.target);
  return {
    test,
    horizon: test.within,
    check: (t) => {
      for (const id of ids) {
        const y = position(ctx, id)[1];
        if (y < test.y) return { passed: false, message: `${id} fell to y=${fmt(y)} (below ${fmt(test.y)}) at t=${fmt(t, 1)}s` };
      }
      if (t >= test.within) return { passed: true, message: `${ids.length} target(s) stayed above y=${fmt(test.y)} for ${fmt(test.within, 1)}s` };
      return null;
    },
    timeout: (t) => `not decided: simulation stopped at t=${fmt(t, 1)}s (needs ${fmt(test.within, 1)}s)`,
  };
}

function evaluator(ctx: Ctx, test: WorldTest): Evaluator {
  switch (test.kind) {
    case 'stable':
      return stableTest(ctx, test);
    case 'noOverlap':
      return noOverlapTest(ctx, test);
    case 'reaches':
      return reachesTest(ctx, test);
    case 'eventually':
      return eventuallyTest(ctx, test);
    case 'moves': {
      const start = new Map<EntityId, Vec3>();
      return allTargetsTest(ctx, test, test.target, test.within, test.distance, 'm', 'moved', (id) => {
        let s = start.get(id);
        if (!s) {
          s = position(ctx, id);
          start.set(id, s);
        }
        return distance(position(ctx, id), s);
      });
    }
    case 'topples': {
      const start = new Map<EntityId, Quat>();
      return allTargetsTest(ctx, test, test.target, test.within, test.degrees, '°', 'toppled', (id) => {
        let q0 = start.get(id);
        if (!q0) {
          q0 = orientation(ctx, id);
          start.set(id, q0);
        }
        return tiltDegrees(q0, orientation(ctx, id));
      });
    }
    case 'staysAbove':
      return staysAboveTest(ctx, test);
    case 'navigable': {
      // Static, decided at t = 0 from the document (navigation grid, door swings, furniture).
      const verdict = navigableVerdict(ctx.world, test.target, test.clearance);
      return { test, horizon: 0, check: () => verdict, timeout: () => '' };
    }
  }
}

function clampNum(v: number | undefined, fallback: number, lo: number, hi: number): number {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v as number)) : fallback;
}

/**
 * Run `world.tests` headless. Diagnostics are computed on the same fresh
 * world before stepping. A report passes when every test passed and there is
 * no error-severity diagnostic.
 */
export async function verify(world: WorldDoc, opts: VerifyOptions = {}): Promise<VerifyReport> {
  const t0 = performance.now();
  const maxSeconds = clampNum(opts.maxSeconds, VERIFY_LIMITS.DEFAULT_MAX_SECONDS, 0, VERIFY_LIMITS.MAX_SECONDS);
  const budgetMs = clampNum(opts.budgetMs, VERIFY_LIMITS.DEFAULT_BUDGET_MS, 1, VERIFY_LIMITS.MAX_BUDGET_MS);
  const sliceMs = clampNum(opts.sliceMs, VERIFY_SLICE_MS, 0, 1000);
  const signal = opts.signal;
  const indices = shardIndices(world.tests.length, opts.tests);
  if (signal?.aborted) throw new VerifyAbortedError();
  const pw = await PhysicsWorld.create(world, opts.colliders ? { colliders: opts.colliders } : {});
  try {
    const diagnostics = opts.diagnostics === false ? [] : diagnoseWorld(pw);
    const ctx: Ctx = { pw, world, hook: null };
    let hookError: string | null = null;
    if (opts.logic) {
      try {
        ctx.hook = opts.logic(pw);
      } catch (err) {
        hookError = err instanceof Error ? err.message.slice(0, 200) : 'logic failed to start';
      }
    }
    const results = new Map<number, TestResult>();
    const decide = (index: number, result: TestResult): void => {
      results.set(index, result);
      if (opts.onResult) {
        try {
          opts.onResult(index, result);
        } catch {
          /* a progress listener never breaks verification */
        }
      }
    };
    const active: Array<Evaluator & { index: number }> = [];
    for (const index of indices) {
      const test = world.tests[index] as WorldTest;
      const ev = evaluator(ctx, test);
      const v = ev.check(0);
      if (v) decide(index, { id: test.id, kind: test.kind, ...v, atTime: 0 });
      else active.push({ ...ev, index });
    }
    const recorder = opts.trace ? new TraceRecorder(pw, opts.trace === true ? {} : opts.trace) : null;
    recorder?.sample(pw, 0);
    const horizon = Math.min(maxSeconds, active.reduce((m, e) => Math.max(m, e.horizon), 0));
    // The replay wants a few seconds of motion even when every test was decided early.
    const runFor = recorder ? Math.min(maxSeconds, Math.max(horizon, recorder.minSeconds)) : horizon;
    let budgetHit = false;
    // Compute time spent before stepping (world build, diagnostics) counts too.
    let spentMs = performance.now() - t0;
    let sliceStart = performance.now();
    while ((active.length > 0 || recorder?.wantsMore(pw.time) === true) && pw.time < runFor - 1e-9) {
      if (signal?.aborted) throw new VerifyAbortedError();
      const now = performance.now();
      if (spentMs + (now - sliceStart) > budgetMs) {
        budgetHit = true;
        break;
      }
      if (sliceMs > 0 && now - sliceStart >= sliceMs) {
        // Cooperative yield: rendering/input (or a cancel message) run between slices; yielded time is not billed.
        spentMs += now - sliceStart;
        await yieldToHost();
        sliceStart = performance.now();
        if (signal?.aborted) throw new VerifyAbortedError();
      }
      const events = pw.stepFixed();
      if (ctx.hook && !hookError) {
        try {
          ctx.hook.tick(pw.dt, pw, events);
        } catch (err) {
          hookError = err instanceof Error ? err.message.slice(0, 200) : 'logic error';
        }
      }
      const t = pw.time;
      recorder?.sample(pw, t);
      // In-place compaction (no per-step array allocation).
      let kept = 0;
      for (let i = 0; i < active.length; i++) {
        const ev = active[i] as Evaluator & { index: number };
        ev.onEvents?.(events);
        const v = ev.check(t);
        if (v) decide(ev.index, { id: ev.test.id, kind: ev.test.kind, ...v, atTime: Number(t.toFixed(3)) });
        else active[kept++] = ev;
      }
      active.length = kept;
    }
    for (const ev of active) {
      const why = budgetHit ? `inconclusive: wall-clock budget of ${budgetMs}ms exhausted at t=${fmt(pw.time, 1)}s` : ev.timeout(pw.time);
      decide(ev.index, { id: ev.test.id, kind: ev.test.kind, passed: false, message: why });
    }
    const ordered = indices.map((i) => results.get(i) as TestResult);
    if (hookError) {
      for (const r of ordered) if (!r.passed && r.kind === 'eventually') r.message += ` (logic error: ${hookError})`;
    }
    const passed = ordered.every((r) => r.passed) && !diagnostics.some((d) => d.severity === 'error');
    const report: VerifyReport = { passed, results: ordered, diagnostics, simulatedSeconds: Number(pw.time.toFixed(3)), ms: performance.now() - t0 };
    if (opts.tests) report.testIndices = indices;
    const trace = recorder?.finish();
    if (trace) report.trace = trace;
    return report;
  } finally {
    pw.dispose();
  }
}
