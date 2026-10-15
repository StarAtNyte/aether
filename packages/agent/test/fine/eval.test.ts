/**
 * The small-edit eval. Prints the before/after table with EVAL_REPORT=1
 * (`npm run eval:edits` prints it too) and enforces the accuracy floor in CI.
 */
import { loadCatalog } from '@aether/assets';
import { beforeAll, describe, expect, it } from 'vitest';
import { CASES } from './cases';
import { HOLDOUT } from './cases-holdout';
import { loadFixture } from './fixtures';
import { agentEngine, baselineEngine, fastEngine, recordedModelEngine, runCase, summarise, type Engine, type Verdict } from './harness';
import type { EditCase } from './types';

const ALL: readonly EditCase[] = [...CASES, ...HOLDOUT];
const REPORT = process.env['EVAL_REPORT'] === '1';

async function runAll(engine: Engine, cases: readonly EditCase[] = ALL): Promise<Verdict[]> {
  const out: Verdict[] = [];
  for (const c of cases) out.push(await runCase(engine, c));
  return out;
}

const pct = (n: number): string => `${(n * 100).toFixed(0)}%`;

describe('small-edit eval set', () => {
  beforeAll(async () => {
    await loadCatalog();
  });

  it('has 100+ cases over arch, voxel, game and scene worlds, with real ids', () => {
    expect(ALL.length).toBeGreaterThanOrEqual(100);
    const worlds = new Set(ALL.map((c) => c.world));
    for (const w of ['apartment', 'penthouse', 'blocks', 'lantern', 'coins', 'kart', 'camp', 'meadow'] as const) expect(worlds.has(w)).toBe(true);
    const ids = new Set<string>();
    for (const c of ALL) {
      expect(ids.has(c.id), `duplicate case id ${c.id}`).toBe(false);
      ids.add(c.id);
      const w = loadFixture(c.world);
      for (const id of [...(c.expect.t ?? []), ...(c.expect.removed ?? []), ...(c.selection ?? [])]) {
        expect(Object.hasOwn(w.entities, id), `${c.id}: unknown entity ${id}`).toBe(true);
      }
    }
  });

  it('the fast path + planner beats the unassisted planner by a wide margin', async () => {
    const base = await runAll(baselineEngine);
    const fast = await runAll(fastEngine);
    const agent = await runAll(agentEngine);
    const sb = summarise(baselineEngine.name, base);
    const sf = summarise(fastEngine.name, fast);
    const sa = summarise(agentEngine.name, agent);
    if (REPORT) {
      for (const s of [sb, sf, sa]) console.log(`${s.engine.padEnd(40)} pass ${String(s.passed).padStart(3)}/${s.total}  target ${pct(s.targetAccuracy).padStart(4)}  over-edit ${pct(s.overEditRate).padStart(4)}  p50 ${s.p50.toFixed(1)} ms  p95 ${s.p95.toFixed(1)} ms  model calls/edit ${s.llmCallsPerEdit.toFixed(2)}`);
      for (const v of agent.filter((x) => !x.ok)) console.log(`  FAIL ${v.id}: ${v.why}`);
    }
    // Before: most small edits fail or touch unrelated things.
    expect(sb.targetAccuracy).toBeLessThan(0.6);
    expect(sb.overEditRate).toBeGreaterThan(0.1);
    // After.
    expect(sa.passed / sa.total).toBeGreaterThanOrEqual(0.95);
    expect(sa.targetAccuracy).toBeGreaterThanOrEqual(0.97);
    expect(sa.overEditRate).toBeLessThanOrEqual(0.02);
    expect(sf.p95).toBeLessThan(100);
    expect(sa.llmCallsPerEdit).toBeLessThan(0.1);
  }, 120_000);

  it('a careless model is held to the minimal patch by the guard', async () => {
    // Cases where a model would be asked to edit something specific (not questions, declines or undo).
    const editing = ALL.filter((c) => (c.expect.t?.length ?? 0) > 0 && !c.expect.wall && !c.prior && !c.selection && c.world !== 'blocks' && !c.expect.added);
    expect(editing.length).toBeGreaterThan(40);
    const unguarded = await runAll(recordedModelEngine(false), editing);
    const guarded = await runAll(recordedModelEngine(true), editing);
    const su = summarise('model path, guard off', unguarded);
    const sg = summarise('model path, guard on', guarded);
    if (REPORT) {
      console.log(`${su.engine.padEnd(40)} pass ${su.passed}/${su.total}  target ${pct(su.targetAccuracy)}  over-edit ${pct(su.overEditRate)}`);
      console.log(`${sg.engine.padEnd(40)} pass ${sg.passed}/${sg.total}  target ${pct(sg.targetAccuracy)}  over-edit ${pct(sg.overEditRate)}`);
    }
    expect(su.overEditRate).toBeGreaterThan(0.8);
    expect(sg.overEditRate).toBeLessThanOrEqual(0.05);
    expect(sg.targetAccuracy).toBeGreaterThanOrEqual(0.95);
  }, 120_000);

  it('the holdout (wording the parser was not built around) stays above 90%', async () => {
    const vs = await runAll(fastEngine, HOLDOUT);
    const s = summarise(fastEngine.name, vs);
    if (REPORT) console.log(`holdout: ${s.passed}/${s.total}`);
    expect(s.passed / s.total).toBeGreaterThanOrEqual(0.9);
  }, 60_000);
});
