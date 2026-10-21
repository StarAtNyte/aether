/**
 * A steadier judge for the compare loop.
 *
 * One vision model scoring a render against a photo is noisy: the same room passes an item in one call and fails it
 * in the next, so a loop that compares absolute scores cannot tell progress from noise. This module makes the
 * judgement steady while the model stays the one that judges:
 *
 * - a fixed rubric: every checklist item gets an integer 0..4 with the evidence for it (an answer without evidence
 *   does not count), from a fixed system prompt, on the same view every round (the photo camera, without marks);
 * - a panel: N independent, stateless calls (temperature 0 and a fixed seed per seat where the backend honours them),
 *   aggregated per item by the median, so one wavering answer cannot flip an item;
 * - relative comparison: from the second look on, each judge sees the accepted render and the new one side by side,
 *   blind (A and B, in alternating order), scores both and says which is closer to the photo. Progress decisions use
 *   that preference, not the difference of two noisy absolutes;
 * - a gate that combines it with the deterministic fidelity measures ({@link decideRound}): a round is accepted only
 *   when the measures do not regress and the judges prefer it.
 */
import { MAX_VERDICTS, STRUCTURAL_METRICS, type ChecklistItem, type FidelityMetrics, type Scoreboard } from '@aether/arch/photo';
import { z } from 'zod';
import type { StallVerdict } from '../review';
import type { CompletionRequest, CompletionResponse, ContentBlock, ToolDef } from '../types';

/** Name of the tool a judge answers through. */
export const JUDGE_TOOL_NAME = 'report_judgement';
/** Default number of independent judges per look. */
export const JUDGES_DEFAULT = 3;
/** Most judges per look. */
export const JUDGES_MAX = 7;
/** Base of the fixed per-seat seeds (seat k uses JUDGE_SEED + k). */
export const JUDGE_SEED = 7331;
/** Rubric score at which an item passes. */
export const PASS_SCORE = 3;

/** The rubric, one line per integer. */
export const RUBRIC: readonly string[] = [
  '4 = matches the photo: right place, size, shape, colour and material',
  '3 = close: one minor difference (a few centimetres, a slightly different shade)',
  '2 = recognisably the same thing but clearly off in position, size, proportion or colour',
  '1 = present but wrong: wrong wall or place, wrong kind, wrong colour family',
  '0 = missing, or not visible where the photo shows it',
];

/** System prompt of every judge call (fixed: the same words every round and every seat). */
export const JUDGE_SYSTEM =
  'You are a meticulous, consistent reviewer of architectural reconstructions. You compare renders of a 3D room with the reference photograph it was rebuilt from, item by item, with a fixed integer rubric, and you back every score with evidence you can point to in the images. You never guess: the same picture always gets the same score from you. You answer only by calling the report_judgement tool.';

/** The tool a judge answers through. */
export const JUDGE_TOOL: ToolDef = {
  name: JUDGE_TOOL_NAME,
  description: 'Report the rubric score of every checklist item, with evidence, and (when two renders are shown) which render is closer to the photo.',
  inputSchema: {
    type: 'object',
    properties: {
      verdicts: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_VERDICTS,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'checklist id' },
            a: { type: 'integer', minimum: 0, maximum: 4, description: 'rubric score of render A' },
            b: { type: 'integer', minimum: 0, maximum: 4, description: 'rubric score of render B (only when two renders are shown)' },
            evidence: { type: 'string', description: 'one sentence: what the photo shows and what the render shows' },
          },
          required: ['id', 'a', 'evidence'],
        },
      },
      closer: { type: 'string', enum: ['A', 'B', 'same'], description: 'which render is closer to the photo overall (two renders only)' },
      why: { type: 'string', description: 'one sentence: the decisive difference' },
    },
    required: ['verdicts'],
    additionalProperties: false,
  },
};

const Score = z.preprocess((v) => (typeof v === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(v) ? Number(v) : typeof v === 'boolean' ? (v ? 4 : 1) : v), z.number().finite().min(0).max(4).transform((n) => Math.round(n)));
const JudgeVerdict = z.object({
  id: z.string().min(1).max(60),
  a: Score,
  b: Score.optional(),
  evidence: z.string().trim().min(3).max(400),
});
const JudgeInput = z.object({
  verdicts: z.array(z.unknown()).min(1).max(MAX_VERDICTS),
  closer: z.preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.enum(['a', 'b', 'same'])).optional(),
  why: z.string().max(400).optional(),
});

/** Which of the two renders a seat was shown first. */
export type SeatOrder = 'single' | 'current-first' | 'previous-first';

/** One judge's answer, mapped back from A/B to current/previous. */
export interface JudgeSample {
  /** Rubric score and evidence of the current render, per checklist id. */
  current: Map<string, { score: number; evidence: string }>;
  /** Scores of the previous (accepted) render, when it was shown. */
  previous: Map<string, number>;
  /** Which render this judge found closer to the photo (null: one render only, or no answer). */
  closer: 'current' | 'previous' | 'same' | null;
}

/** Parse one judge's tool input. Verdicts without evidence or with unknown ids are dropped; null when nothing usable is left. */
export function parseJudgement(input: unknown, ids: ReadonlySet<string>, order: SeatOrder): JudgeSample | null {
  const p = JudgeInput.safeParse(input);
  if (!p.success) return null;
  const current = new Map<string, { score: number; evidence: string }>();
  const previous = new Map<string, number>();
  for (const raw of p.data.verdicts) {
    const v = JudgeVerdict.safeParse(raw);
    if (!v.success || !ids.has(v.data.id)) continue;
    const cur = order === 'previous-first' ? v.data.b : v.data.a;
    const prev = order === 'previous-first' ? v.data.a : v.data.b;
    if (cur === undefined) continue;
    current.set(v.data.id, { score: cur, evidence: v.data.evidence });
    if (order !== 'single' && prev !== undefined) previous.set(v.data.id, prev);
  }
  if (current.size === 0) return null;
  let closer: JudgeSample['closer'] = null;
  if (order !== 'single' && p.data.closer) {
    if (p.data.closer === 'same') closer = 'same';
    else closer = (p.data.closer === 'a') === (order === 'current-first') ? 'current' : 'previous';
  }
  return { current, previous, closer };
}

/** Median of a non-empty list (the mean of the two middle values for an even count). */
export function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

/** The panel's aggregated judgement of one render. */
export interface Consensus {
  /** Pass/fail per checklist item (pass: median score ≥ {@link PASS_SCORE}). */
  score: Scoreboard;
  /** Mean over the checklist of the median rubric score, divided by 4 (0..1). Items nobody scored count 0. */
  judge: number;
  /** Mean over items of (highest − lowest score) / 4: how much the judges disagreed (0 = unanimous). */
  spread: number;
  /** Judges whose answers were used. */
  samples: number;
  /** Median score per item. */
  medians: Record<string, number>;
  /** Preference between the new render and the accepted one (null when only one render was shown). */
  preference: 'current' | 'previous' | 'tie' | null;
  votes: { current: number; previous: number; same: number };
}

/**
 * Aggregate the samples of a panel. Per item the median of the integer scores; the preference is the majority of the
 * explicit votes, and when those tie, the median over judges of the paired score difference (current − previous, summed
 * over items) decides when it is at least one grade; otherwise it is a tie. Null without samples.
 */
export function aggregateJudgements(checklist: readonly ChecklistItem[], samples: readonly JudgeSample[]): Consensus | null {
  if (samples.length === 0) return null;
  let passed = 0;
  let total = 0;
  let spread = 0;
  const medians: Record<string, number> = {};
  const failing: Scoreboard['failing'] = [];
  for (const item of checklist) {
    const got = samples.map((s) => s.current.get(item.id)).filter((x): x is { score: number; evidence: string } => x !== undefined);
    if (got.length === 0) {
      medians[item.id] = 0;
      failing.push({ ...item, note: 'not judged' });
      spread += 0;
      continue;
    }
    const scores = got.map((g) => g.score);
    const m = median(scores);
    medians[item.id] = m;
    total += m;
    spread += (Math.max(...scores) - Math.min(...scores)) / 4;
    if (m >= PASS_SCORE) passed++;
    else {
      // The evidence of the judge whose score is nearest the median says what differs.
      const near = [...got].sort((a, b) => Math.abs(a.score - m) - Math.abs(b.score - m))[0];
      failing.push({ ...item, note: `${m}/4: ${near?.evidence ?? ''}`.slice(0, 240) });
    }
  }
  const n = checklist.length;
  const score: Scoreboard = { total: n, passed, rate: n === 0 ? 1 : passed / n, failing, structuralFailed: failing.some((f) => f.structural) };
  const votes = { current: 0, previous: 0, same: 0 };
  const paired: number[] = [];
  for (const s of samples) {
    if (s.closer) votes[s.closer]++;
    if (s.previous.size > 0) {
      let d = 0;
      for (const [id, v] of s.current) {
        const p = s.previous.get(id);
        if (p !== undefined) d += v.score - p;
      }
      paired.push(d);
    }
  }
  const pairwise = votes.current + votes.previous + votes.same > 0 || paired.length > 0;
  let preference: Consensus['preference'] = null;
  if (pairwise) {
    if (votes.current > votes.previous && votes.current >= votes.same) preference = 'current';
    else if (votes.previous > votes.current && votes.previous >= votes.same) preference = 'previous';
    else {
      const d = paired.length > 0 ? median(paired) : 0;
      preference = d >= 1 ? 'current' : d <= -1 ? 'previous' : 'tie';
    }
  }
  return { score, judge: n === 0 ? 1 : total / (4 * n), spread: n === 0 ? 0 : spread / n, samples: samples.length, medians, preference, votes };
}

/** The words of a judge call (the same for every seat and every round, apart from the A/B order). */
export function judgeText(checklist: readonly ChecklistItem[], pairwise: boolean): string {
  return [
    pairwise
      ? 'JUDGE. Image 1 is the reference PHOTO of a room. Images 2 and 3 are two renders, A and B, of a 3D reconstruction of it after different edits, seen from the photo\'s camera.'
      : 'JUDGE. Image 1 is the reference PHOTO of a room. Image 2 is a render of a 3D reconstruction of it, seen from the photo\'s camera.',
    `Score every checklist item with this rubric (integers only):\n${RUBRIC.map((r) => `- ${r}`).join('\n')}`,
    'The renders are plain previews: flatter light than a photograph, no glare, a flat sky in the windows. Never lower a score for lighting quality or gloss alone; judge shape, size, position, proportion, hue and lightness relative to the things around it.',
    'Evidence is required for every score: one sentence naming what the photo shows and what the render shows ("photo: bed centred under two round prints; render: bed half a metre to the right"). A score without evidence is discarded.',
    pairwise
      ? 'Give "a" (the score of render A) and "b" (the score of render B) for every item, then "closer": "A" or "B" for the render that is closer to the photo overall, or "same" when you cannot tell them apart.'
      : 'Give "a" (the score of the render) for every item.',
    `Checklist:\n${checklist.map((c) => `- ${c.id}: ${c.text}`).join('\n')}`,
    'Call report_judgement once with every id.',
  ].join('\n');
}

/** What a panel looks at. */
export interface PanelInput {
  /** The photograph (data URL). */
  photo: string;
  /** The render of the room as it stands (data URL, the photo camera without marks). */
  current: string;
  /** The render of the accepted state, for the relative comparison (null on the first look). */
  previous: string | null;
  checklist: readonly ChecklistItem[];
  /** Number of judges (1..{@link JUDGES_MAX}). */
  judges: number;
  maxTokens: number;
}

/** One model call (the pipeline wraps the provider: usage, availability, abort). */
export type Complete = (req: CompletionRequest) => Promise<CompletionResponse>;

/** The request of seat `k`. */
export function judgeRequest(input: PanelInput, k: number): { req: CompletionRequest; order: SeatOrder } {
  const pairwise = input.previous !== null;
  // Seats alternate which render they see first, so a judge's habit of preferring the first (or second) image cancels out.
  const order: SeatOrder = !pairwise ? 'single' : k % 2 === 0 ? 'current-first' : 'previous-first';
  const images: ContentBlock[] = [{ type: 'text', text: 'Image 1: the PHOTO' }, { type: 'image', dataUrl: input.photo }];
  if (!pairwise) images.push({ type: 'text', text: 'Image 2: the RENDER' }, { type: 'image', dataUrl: input.current });
  else {
    const [a, b] = order === 'current-first' ? [input.current, input.previous as string] : [input.previous as string, input.current];
    images.push({ type: 'text', text: 'Image 2: RENDER A' }, { type: 'image', dataUrl: a }, { type: 'text', text: 'Image 3: RENDER B' }, { type: 'image', dataUrl: b });
  }
  const req: CompletionRequest = {
    role: 'critic',
    system: JUDGE_SYSTEM,
    messages: [{ role: 'user', content: [{ type: 'text', text: judgeText(input.checklist, pairwise) }, ...images] }],
    tools: [JUDGE_TOOL],
    maxTokens: input.maxTokens,
    temperature: 0,
    seed: JUDGE_SEED + k,
  };
  return { req, order };
}

/** Result of {@link runPanel}. */
export interface PanelResult {
  consensus: Consensus | null;
  /** Why seats gave nothing usable (empty when all answered). */
  failures: string[];
  /** Model calls made. */
  calls: number;
}

/**
 * Ask the panel: every seat in parallel, each stateless (no conversation key), one retry for a seat that did not call
 * the tool. A seat that fails is left out; the error of the first seat is rethrown only when every seat failed with an
 * exception (so an abort or a lost connection still surfaces).
 */
export async function runPanel(complete: Complete, input: PanelInput): Promise<PanelResult> {
  const n = Math.max(1, Math.min(JUDGES_MAX, Math.floor(input.judges)));
  const ids = new Set(input.checklist.map((c) => c.id));
  let calls = 0;
  const seat = async (k: number): Promise<JudgeSample | string> => {
    const { req, order } = judgeRequest(input, k);
    for (let attempt = 0; attempt < 2; attempt++) {
      calls++;
      const res = await complete(req);
      const call = res.content.find((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use' && b.name === JUDGE_TOOL_NAME);
      const sample = call ? parseJudgement(call.input, ids, order) : null;
      if (sample) return sample;
      req.messages = [
        ...req.messages,
        { role: 'assistant', content: res.content.length > 0 ? res.content : [{ type: 'text', text: '(no answer)' }] },
        ...(call
          ? [{ role: 'user' as const, content: [{ type: 'tool_result' as const, toolUseId: call.id, content: 'No usable verdicts: every verdict needs a checklist id, an integer "a" 0..4 and evidence.', isError: true }] }]
          : [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Call report_judgement now with a scored, evidenced verdict for every checklist id.' }] }]),
      ];
    }
    return 'no usable judgement';
  };
  const settled = await Promise.allSettled(Array.from({ length: n }, (_, k) => seat(k)));
  const samples: JudgeSample[] = [];
  const failures: string[] = [];
  for (const s of settled) {
    if (s.status === 'fulfilled') {
      if (typeof s.value === 'string') failures.push(s.value);
      else samples.push(s.value);
    } else failures.push(s.reason instanceof Error ? s.reason.message : String(s.reason));
  }
  if (samples.length === 0 && settled.every((s) => s.status === 'rejected')) {
    const first = settled[0];
    if (first && first.status === 'rejected') throw first.reason;
  }
  return { consensus: aggregateJudgements(input.checklist, samples), failures, calls };
}

/** The panel's judgement in words, for the model that fixes the room. */
export function consensusText(c: Consensus, limit = 16): string {
  const head = `Independent judges (${c.samples}, median per item, rubric 0-4, pass at ${PASS_SCORE}): ${c.score.passed}/${c.score.total} pass, judge score ${Math.round(c.judge * 100)}%${c.spread > 0.15 ? ` (they disagree on some items: spread ${Math.round(c.spread * 100)}%)` : ''}.`;
  const pref = c.preference === null ? '' : `Compared with the accepted state they found the new render ${c.preference === 'current' ? 'closer to the photo' : c.preference === 'previous' ? 'further from the photo' : 'neither closer nor further'} (votes: ${c.votes.current} new, ${c.votes.previous} accepted, ${c.votes.same} same).`;
  const fails = c.score.failing.slice(0, limit).map((f) => `- ${f.id}: ${f.note}`);
  return [head, pref, ...(fails.length > 0 ? ['Still different:', ...fails] : [])].filter((l) => l.length > 0).join('\n');
}

// ---------------------------------------------------------------------------
// The gate and the stall detector
// ---------------------------------------------------------------------------

/** A measured fidelity drop larger than this rejects a round. */
export const OBJECTIVE_TOLERANCE = 0.015;
/** A drop of a structural measure (openings, inventory, clearance) larger than this rejects a round. */
export const STRUCTURAL_TOLERANCE = 0.04;
/** A rise of the measured fidelity at least this large counts as progress on its own. */
export const OBJECTIVE_GAIN = 0.005;
/** A rise of the judges' median score at least this large counts as progress when their votes tie. */
export const JUDGE_GAIN = 0.03;

/** What a round is decided on. */
export interface RoundState {
  /** Measured fidelity sub-score (null when nothing could be measured). */
  objective: number | null;
  metrics: FidelityMetrics | null;
  /** Judge score 0..1: the panel's median rubric score, or the single judge's pass rate. */
  judge: number;
}

/** The decision of {@link decideRound}. */
export interface Decision {
  accept: boolean;
  /** The round is measurable progress (for the stall detector). */
  gain: boolean;
  reason: string;
}

/** The combined signal shown and used for the legacy comparison: half judge, half measured fidelity. */
export function combinedScore(s: RoundState): number {
  return s.objective === null ? s.judge : 0.5 * s.judge + 0.5 * s.objective;
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;

/**
 * Accept or reject a new state against the accepted one.
 * - The measures may not regress: the sub-score may not fall by more than {@link OBJECTIVE_TOLERANCE}, and no
 *   structural measure by more than {@link STRUCTURAL_TOLERANCE}.
 * - With a relative judgement (`preference`), the judges must prefer the new state; on a tie it is accepted only when
 *   the measures rise by {@link OBJECTIVE_GAIN} or the judges' median score by {@link JUDGE_GAIN}.
 * - Without one (a single judge in the conversation, or the panel gave nothing), the combined score may not fall by
 *   more than `margin`.
 */
export function decideRound(ref: RoundState | null, cand: RoundState, preference: Consensus['preference'], margin: number): Decision {
  if (!ref) return { accept: true, gain: true, reason: 'the first look' };
  if (ref.objective !== null && cand.objective !== null && cand.objective < ref.objective - OBJECTIVE_TOLERANCE) {
    return { accept: false, gain: false, reason: `the measured fidelity fell from ${pct(ref.objective)} to ${pct(cand.objective)}` };
  }
  if (ref.metrics && cand.metrics) {
    for (const k of STRUCTURAL_METRICS) {
      const a = ref.metrics[k];
      const b = cand.metrics[k];
      if (a !== null && b !== null && b < a - STRUCTURAL_TOLERANCE) return { accept: false, gain: false, reason: `the measured ${k} fell from ${pct(a)} to ${pct(b)}` };
    }
  }
  const objGain = ref.objective !== null && cand.objective !== null ? cand.objective - ref.objective : 0;
  if (preference === 'previous') return { accept: false, gain: false, reason: 'the judges found the accepted state closer to the photo' };
  if (preference === 'current') return { accept: true, gain: true, reason: 'the judges found the new state closer to the photo' };
  if (preference === 'tie') {
    if (objGain >= OBJECTIVE_GAIN) return { accept: true, gain: true, reason: `the judges could not tell them apart and the measured fidelity rose ${pct(objGain)}` };
    if (cand.judge - ref.judge >= JUDGE_GAIN) return { accept: true, gain: true, reason: `the judges' scores rose from ${pct(ref.judge)} to ${pct(cand.judge)}` };
    return { accept: false, gain: false, reason: 'neither the judges nor the measures found it closer to the photo' };
  }
  const a = combinedScore(ref);
  const b = combinedScore(cand);
  if (b < a - margin) return { accept: false, gain: false, reason: `the combined score fell from ${pct(a)} to ${pct(b)}` };
  return { accept: true, gain: b > a + OBJECTIVE_GAIN, reason: b > a ? 'the combined score rose' : 'the combined score held' };
}

/**
 * Stall detection on the combined signal: the loop is going nowhere when no round has been measurable progress
 * (an accepted, preferred or measurably better state) for `limit` rounds in a row.
 */
export class ProgressTracker {
  private readonly limit: number;
  private noGain = 0;
  private prevKeys: string | null = null;
  private sameKeys = 0;

  constructor(limit = 3) {
    this.limit = Math.max(2, Math.min(20, Math.floor(limit)));
  }

  observe(o: { gain: boolean; keys: ReadonlySet<string> }): StallVerdict {
    const k = [...o.keys].sort().join('|');
    this.sameKeys = k === this.prevKeys ? this.sameKeys + 1 : 0;
    this.prevKeys = k;
    this.noGain = o.gain ? 0 : this.noGain + 1;
    if (this.noGain >= this.limit) {
      return { stalled: true, reason: this.sameKeys + 1 >= this.limit ? `the same ${o.keys.size} item${o.keys.size === 1 ? '' : 's'} still differ and no change in the last ${this.noGain} rounds was an improvement` : `no measurable improvement in the last ${this.noGain} rounds` };
    }
    return { stalled: false };
  }
}
