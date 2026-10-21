import { describe, expect, it } from 'vitest';
import type { ChecklistItem, FidelityMetrics } from '@aether/arch/photo';
import {
  JUDGE_SEED,
  JUDGE_SYSTEM,
  OBJECTIVE_TOLERANCE,
  ProgressTracker,
  aggregateJudgements,
  combinedScore,
  decideRound,
  judgeRequest,
  median,
  parseJudgement,
  runPanel,
  type Consensus,
  type JudgeSample,
  type RoundState,
} from '../src/photo/judge';
import type { CompletionRequest, CompletionResponse } from '../src/types';

const items = (n: number): ChecklistItem[] => Array.from({ length: n }, (_, i) => ({ id: `item-${i}`, category: 'furniture', text: `piece ${i}`, structural: i === 0 }));
const ids = (list: readonly ChecklistItem[]): Set<string> => new Set(list.map((c) => c.id));

/** A judge sample from plain numbers. */
function sample(cur: readonly number[], prev: readonly number[] | null = null, closer: JudgeSample['closer'] = null): JudgeSample {
  return {
    current: new Map(cur.map((s, i) => [`item-${i}`, { score: s, evidence: `photo vs render ${i}` }])),
    previous: new Map((prev ?? []).map((s, i) => [`item-${i}`, s])),
    closer,
  };
}

/** Deterministic pseudo-random numbers in 0..1. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const metrics = (o: Partial<FidelityMetrics> = {}): FidelityMetrics => ({ openings: 1, inventory: 1, placement: 0.9, sizes: 0.9, materials: 0.9, shell: null, clearance: 1, framing: 0.8, similarity: 0.3, regionColour: 0.6, ...o });

describe('parsing a judge answer', () => {
  const list = items(3);
  it('maps A and B back to the current and the previous render by the seat order', () => {
    const input = { verdicts: [{ id: 'item-0', a: 4, b: 1, evidence: 'photo: bed left; A: left; B: right' }], closer: 'A' };
    const first = parseJudgement(input, ids(list), 'current-first');
    expect(first?.current.get('item-0')?.score).toBe(4);
    expect(first?.previous.get('item-0')).toBe(1);
    expect(first?.closer).toBe('current');
    const second = parseJudgement(input, ids(list), 'previous-first');
    expect(second?.current.get('item-0')?.score).toBe(1);
    expect(second?.previous.get('item-0')).toBe(4);
    expect(second?.closer).toBe('previous');
  });

  it('drops verdicts without evidence and unknown ids, and rounds scores', () => {
    const s = parseJudgement({ verdicts: [{ id: 'item-0', a: 3.4, evidence: 'photo: x; render: x' }, { id: 'item-1', a: 4, evidence: '' }, { id: 'nope', a: 4, evidence: 'something' }, { id: 'item-2', a: '2', evidence: 'photo: y; render: z' }] }, ids(list), 'single');
    expect([...(s?.current.keys() ?? [])]).toEqual(['item-0', 'item-2']);
    expect(s?.current.get('item-0')?.score).toBe(3);
    expect(s?.current.get('item-2')?.score).toBe(2);
    expect(parseJudgement({ verdicts: [{ id: 'item-1', a: 4 }] }, ids(list), 'single')).toBeNull();
    expect(parseJudgement('garbage', ids(list), 'single')).toBeNull();
  });
});

describe('aggregating a panel', () => {
  const list = items(4);
  it('takes the median per item, so one wavering judge cannot flip an item', () => {
    const c = aggregateJudgements(list, [sample([4, 3, 1, 4]), sample([4, 1, 1, 4]), sample([0, 3, 2, 4])]) as Consensus;
    expect(c.medians).toEqual({ 'item-0': 4, 'item-1': 3, 'item-2': 1, 'item-3': 4 });
    expect(c.score.passed).toBe(3);
    expect(c.score.failing.map((f) => f.id)).toEqual(['item-2']);
    expect(c.judge).toBeCloseTo(12 / 16, 9);
    expect(c.spread).toBeGreaterThan(0);
    expect(c.preference).toBeNull();
  });

  it('decides the preference by majority, and a tie by the paired score difference', () => {
    const cur = [4, 4, 3, 3];
    const prev = [3, 3, 3, 3];
    expect(aggregateJudgements(list, [sample(cur, prev, 'current'), sample(cur, prev, 'current'), sample(cur, prev, 'previous')])?.preference).toBe('current');
    expect(aggregateJudgements(list, [sample(cur, prev, 'previous'), sample(cur, prev, 'previous'), sample(cur, prev, 'same')])?.preference).toBe('previous');
    // One vote each way and one "same": the paired differences (+2 for every judge) decide.
    expect(aggregateJudgements(list, [sample(cur, prev, 'current'), sample(cur, prev, 'previous'), sample(cur, prev, 'same')])?.preference).toBe('current');
    expect(aggregateJudgements(list, [sample(prev, prev, 'same'), sample(prev, prev, 'same'), sample(prev, prev, 'same')])?.preference).toBe('tie');
    expect(median([1, 3, 2])).toBe(2);
    expect(median([1, 4])).toBe(2.5);
  });

  it('counts an item nobody answered as failing, and needs at least one sample', () => {
    const c = aggregateJudgements(list, [sample([4, 4])]) as Consensus;
    expect(c.score.failing.map((f) => f.id)).toEqual(['item-2', 'item-3']);
    expect(c.score.failing[0]?.note).toBe('not judged');
    expect(aggregateJudgements(list, [])).toBeNull();
  });
});

describe('the round gate', () => {
  const ref: RoundState = { objective: 0.8, metrics: metrics(), judge: 0.7 };
  it('rejects a state whose measures regress, whatever the judges say', () => {
    expect(decideRound(ref, { ...ref, objective: 0.8 - OBJECTIVE_TOLERANCE - 0.001 }, 'current', 0.03).accept).toBe(false);
    const d = decideRound(ref, { ...ref, metrics: metrics({ inventory: 0.9 }) }, 'current', 0.03);
    expect(d.accept).toBe(false);
    expect(d.reason).toContain('inventory');
  });

  it('accepts what the judges prefer, rejects what they do not, and needs a measured gain on a tie', () => {
    expect(decideRound(ref, ref, 'current', 0.03)).toMatchObject({ accept: true, gain: true });
    expect(decideRound(ref, ref, 'previous', 0.03)).toMatchObject({ accept: false, gain: false });
    expect(decideRound(ref, ref, 'tie', 0.03)).toMatchObject({ accept: false, gain: false });
    expect(decideRound(ref, { ...ref, objective: 0.81 }, 'tie', 0.03)).toMatchObject({ accept: true, gain: true });
    expect(decideRound(ref, { ...ref, judge: 0.75 }, 'tie', 0.03)).toMatchObject({ accept: true, gain: true });
    expect(decideRound(null, ref, null, 0.03)).toMatchObject({ accept: true, gain: true });
  });

  it('without a relative judgement compares the combined score with a margin', () => {
    expect(decideRound(ref, { ...ref, judge: 0.68 }, null, 0.03).accept).toBe(true);
    expect(decideRound(ref, { ...ref, judge: 0.6 }, null, 0.03).accept).toBe(false);
    expect(combinedScore(ref)).toBeCloseTo(0.75, 9);
    expect(combinedScore({ objective: null, metrics: null, judge: 0.4 })).toBe(0.4);
  });

  it('stalls only after several rounds without progress', () => {
    const t = new ProgressTracker(3);
    const keys = new Set(['item-1']);
    expect(t.observe({ gain: true, keys }).stalled).toBe(false);
    expect(t.observe({ gain: false, keys }).stalled).toBe(false);
    expect(t.observe({ gain: false, keys }).stalled).toBe(false);
    // Progress resets the count.
    expect(t.observe({ gain: true, keys }).stalled).toBe(false);
    expect(t.observe({ gain: false, keys }).stalled).toBe(false);
    expect(t.observe({ gain: false, keys }).stalled).toBe(false);
    const v = t.observe({ gain: false, keys });
    expect(v.stalled).toBe(true);
    expect(v.stalled && v.reason).toMatch(/same 1 item/);
  });
});

describe('the panel calls', () => {
  const list = items(3);
  const input = { photo: 'data:image/png;base64,UA==', current: 'data:image/png;base64,Qw==', previous: 'data:image/png;base64,UA==', checklist: list, judges: 3, maxTokens: 4000 };

  it('every seat is stateless, at temperature 0 with its own fixed seed, and the seats alternate the A/B order', () => {
    const r0 = judgeRequest(input, 0);
    const r1 = judgeRequest(input, 1);
    expect(r0.req.session).toBeUndefined();
    expect(r0.req.temperature).toBe(0);
    expect(r0.req.seed).toBe(JUDGE_SEED);
    expect(r1.req.seed).toBe(JUDGE_SEED + 1);
    expect(r0.req.system).toBe(JUDGE_SYSTEM);
    expect(r0.req.role).toBe('critic');
    expect(r0.order).toBe('current-first');
    expect(r1.order).toBe('previous-first');
    const imgs = (r: CompletionRequest): string[] => (typeof r.messages[0]?.content === 'string' ? [] : (r.messages[0]?.content ?? []).flatMap((b) => (b.type === 'image' ? [b.dataUrl] : [])));
    expect(imgs(r0.req)).toEqual([input.photo, input.current, input.previous]);
    expect(imgs(r1.req)).toEqual([input.photo, input.previous, input.current]);
    // The words are the same for every seat and every round.
    expect(JSON.stringify(r0.req.messages[0]?.content).split('Image 1')[0]).toBe(JSON.stringify(r1.req.messages[0]?.content).split('Image 1')[0]);
    expect(judgeRequest({ ...input, previous: null }, 0).order).toBe('single');
  });

  it('runs the seats in parallel, leaves a failing seat out, retries a seat that did not call the tool', async () => {
    let calls = 0;
    let inFlight = 0;
    let maxInFlight = 0;
    const complete = async (req: CompletionRequest): Promise<CompletionResponse> => {
      calls++;
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      const seat = (req.seed ?? 0) - JUDGE_SEED;
      if (seat === 2) throw new Error('backend busy');
      if (seat === 1 && req.messages.length === 1) return { content: [{ type: 'text', text: 'thinking aloud' }], stopReason: 'end' };
      return { content: [{ type: 'tool_use', id: `j${seat}`, name: 'report_judgement', input: { verdicts: list.map((c) => ({ id: c.id, a: 4, b: 2, evidence: 'photo: x; render: x' })), closer: 'A' } }], stopReason: 'tool_use' };
    };
    const res = await runPanel(complete, input);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(calls).toBe(4);
    expect(res.failures).toEqual(['backend busy']);
    expect(res.consensus?.samples).toBe(2);
    // Seat 0 saw the current render as A and seat 1 as B: "A" means current for one and previous for the other.
    expect(res.consensus?.votes).toEqual({ current: 1, previous: 1, same: 0 });
    // The paired scores break the tie: seat 0 scored current 4 vs 2, seat 1 scored current 2 vs 4 (median 0) — a tie.
    expect(res.consensus?.preference).toBe('tie');
  });

  it('rethrows when every seat failed with an error', async () => {
    await expect(runPanel(async () => Promise.reject(new Error('offline')), { ...input, previous: null })).rejects.toThrow('offline');
  });
});

// ---------------------------------------------------------------------------
// A noisy judge: what the panel and the gate buy
// ---------------------------------------------------------------------------

/**
 * A simulated vision judge. Its score of an item is the truth plus noise: each call has a mood (the whole answer one
 * grade harsher or kinder, 15 % each way) and its reading of each item wavers one grade either way 20 % of the time.
 * Two renders shown side by side share the call's mood and its reading of an item (an unchanged piece looks the
 * same in both), with a further independent flicker of one grade 10 % of the time per item and render.
 */
function noisyJudge(r: () => number) {
  const step = (p: number): number => {
    const x = r();
    return x < p ? -1 : x > 1 - p ? 1 : 0;
  };
  const clip = (v: number): number => Math.max(0, Math.min(4, v));
  return {
    single(truth: readonly number[]): number[] {
      const m = step(0.15);
      return truth.map((t) => clip(t + m + step(0.2)));
    },
    pair(cur: readonly number[], prev: readonly number[]): JudgeSample {
      const m = step(0.15);
      const w = cur.map(() => step(0.2));
      const c = cur.map((t, i) => clip(t + m + (w[i] as number) + step(0.05)));
      const p = prev.map((t, i) => clip(t + m + (w[i] as number) + step(0.05)));
      const d = c.reduce((a, v, i) => a + v - (p[i] as number), 0);
      return sample(c, p, d >= 2 ? 'current' : d <= -2 ? 'previous' : 'same');
    },
  };
}

const sd = (xs: readonly number[]): number => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};

describe('a noisy judge, alone and as a panel', () => {
  const list = items(16);
  const truth = list.map((_, i) => (i % 4 === 0 ? 2 : i % 4 === 1 ? 3 : 4));

  it('the same room scores far more steadily as the median of three than as one judge', () => {
    const judge = noisyJudge(rng(11));
    const one: number[] = [];
    const three: number[] = [];
    const flipsOne: number[] = [];
    const flipsThree: number[] = [];
    let prevOne: Set<string> | null = null;
    let prevThree: Set<string> | null = null;
    const passing = (c: Consensus): Set<string> => new Set(list.filter((x) => !c.score.failing.some((f) => f.id === x.id)).map((x) => x.id));
    for (let k = 0; k < 300; k++) {
      const a = aggregateJudgements(list, [sample(judge.single(truth))]) as Consensus;
      const b = aggregateJudgements(list, [sample(judge.single(truth)), sample(judge.single(truth)), sample(judge.single(truth))]) as Consensus;
      one.push(a.score.rate);
      three.push(b.score.rate);
      const pa = passing(a);
      const pb = passing(b);
      if (prevOne) flipsOne.push([...list].filter((x) => pa.has(x.id) !== prevOne?.has(x.id)).length);
      if (prevThree) flipsThree.push([...list].filter((x) => pb.has(x.id) !== prevThree?.has(x.id)).length);
      prevOne = pa;
      prevThree = pb;
    }
    // Pass rate of the very same room: its spread shrinks to well under two thirds, and items flip far less often.
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    const line = `pass-rate sd: one ${sd(one).toFixed(3)}, median of three ${sd(three).toFixed(3)}; items flipping between looks: one ${mean(flipsOne).toFixed(2)}, median of three ${mean(flipsThree).toFixed(2)}`;
    expect(sd(three), line).toBeLessThan(sd(one) * 0.65);
    expect(mean(flipsThree), line).toBeLessThan(mean(flipsOne) * 0.75);
  });

  /**
   * The loop, simulated: each round the fixer makes a real improvement (65 %), a cosmetic change (20 %) or a mistake
   * (15 %, one item two grades worse, sometimes a structural one the measures see). The old loop judged each round
   * once and compared absolute scores with the best; the new one asks three judges to compare with the accepted state
   * and gates on the measures. Counted over many seeded runs: improvements thrown away, mistakes kept, runs stopped as
   * "stalled" while the fixer was still making real improvements, and the true quality the room ends at.
   */
  it('makes the loop stop oscillating: fewer good rounds rolled back, fewer mistakes kept, fewer false stalls', () => {
    type Tally = { goodRejected: number; badKept: number; falseStalls: number; rounds: number; finalTruth: number };
    const run = (mode: 'single' | 'panel', seed: number): Tally => {
      const r = rng(seed);
      const judge = noisyJudge(r);
      const t: Tally = { goodRejected: 0, badKept: 0, falseStalls: 0, rounds: 0, finalTruth: 0 };
      const state: number[] = list.map((_, i) => (i % 3 === 0 ? 1 : i % 3 === 1 ? 2 : 3));
      const objective = (s: readonly number[]): number => 0.5 + (0.5 * s.slice(0, 4).reduce((a, b) => a + b, 0)) / 16;
      const metricsOf = (s: readonly number[]): FidelityMetrics => metrics({ inventory: s[0] === 0 ? 0.9 : 1 });
      const look = (s: readonly number[], prev: readonly number[] | null): Consensus => {
        if (mode === 'single') return aggregateJudgements(list, [sample(judge.single(s))]) as Consensus;
        return aggregateJudgements(list, prev ? [judge.pair(s, prev), judge.pair(s, prev), judge.pair(s, prev)] : [sample(judge.single(s)), sample(judge.single(s)), sample(judge.single(s))]) as Consensus;
      };
      const stateOf = (s: readonly number[], c: Consensus): RoundState => ({ objective: objective(s), metrics: metricsOf(s), judge: mode === 'single' ? c.score.rate : c.judge });
      let accepted = state;
      let ref = stateOf(state, look(state, null));
      const tracker = new ProgressTracker(3);
      let stillImproving = 0;
      for (let round = 0; round < 10; round++) {
        const x = r();
        const next = [...accepted];
        const fails = next.map((v, i) => (v < 4 ? i : -1)).filter((i) => i >= 0);
        let kind: 'good' | 'cosmetic' | 'bad';
        if (x < 0.65 && fails.length > 0) {
          const i = fails[Math.floor(r() * fails.length)] as number;
          next[i] = Math.min(4, (next[i] as number) + 2);
          kind = 'good';
        } else if (x < 0.85) kind = 'cosmetic';
        else {
          const i = Math.floor(r() * next.length);
          next[i] = Math.max(0, (next[i] as number) - 2);
          kind = 'bad';
        }
        const c = look(next, mode === 'panel' ? accepted : null);
        const cand = stateOf(next, c);
        const d = decideRound(ref, cand, mode === 'panel' ? c.preference : null, 0.047);
        t.rounds++;
        if (kind === 'good' && !d.accept) t.goodRejected++;
        if (kind === 'bad' && d.accept) t.badKept++;
        if (d.accept && (mode === 'panel' || combinedScore(cand) >= combinedScore(ref))) {
          ref = cand;
          accepted = next;
        } else if (d.accept) accepted = next;
        if (kind === 'good') stillImproving = 3;
        else stillImproving = Math.max(0, stillImproving - 1);
        const v = tracker.observe({ gain: d.gain, keys: new Set(c.score.failing.map((f) => f.id)) });
        if (v.stalled) {
          // The loop stops here; a stop while real improvements were still coming in is a false stall.
          if (stillImproving > 0 && accepted.some((s) => s < 4)) t.falseStalls++;
          break;
        }
      }
      t.finalTruth = accepted.reduce((a, b) => a + b, 0) / (4 * accepted.length);
      return t;
    };
    const sum = (mode: 'single' | 'panel'): Tally => {
      const out: Tally = { goodRejected: 0, badKept: 0, falseStalls: 0, rounds: 0, finalTruth: 0 };
      for (let s = 1; s <= 200; s++) {
        const t = run(mode, s * 7919);
        for (const k of Object.keys(out) as Array<keyof Tally>) out[k] += t[k];
      }
      return out;
    };
    const old = sum('single');
    const neu = sum('panel');
    // The numbers, for the log of a failing run.
    const line = `single judge: ${JSON.stringify(old)}; panel + gate: ${JSON.stringify(neu)}`;
    expect(neu.goodRejected / neu.rounds, line).toBeLessThan((old.goodRejected / old.rounds) * 0.5);
    expect(neu.badKept / neu.rounds, line).toBeLessThan((old.badKept / old.rounds) * 0.5);
    expect(neu.falseStalls, line).toBeLessThan(old.falseStalls * 0.5);
    expect(neu.finalTruth / 200, line).toBeGreaterThan(old.finalTruth / 200 + 0.03);
  });
});
