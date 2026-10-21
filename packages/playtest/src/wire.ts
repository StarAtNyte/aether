/**
 * Validation of a playtest report that crossed a boundary (a worker reply, a
 * stored project): shapes, finite numbers, bounded lists and strings. The
 * report is data for the UI, never instructions.
 */
import { z } from 'zod';
import { PLAYTEST_LIMITS, TRACE_STRIDE, type PlaytestProgress, type PlaytestReport } from './types';

const finite = z.number().refine(Number.isFinite, 'must be finite');
const vec3 = z.tuple([finite, finite, finite]);
const text = (max: number): z.ZodType<string> => z.string().transform((s) => s.slice(0, max));

const Finding = z.object({
  code: z.enum([
    'unreachable_objective', 'door_locked', 'door_stuck', 'unwinnable', 'lost', 'spawn_blocked', 'stuck', 'soft_lock', 'fell', 'no_win_condition', 'budget', 'unsupported', 'room_unreachable', 'door_blocked', 'clipping', 'no_entrance', 'talk_failed', 'lift_unusable',
  ]),
  severity: z.enum(['error', 'warning', 'info']),
  message: text(400),
  entities: z.array(text(128)).max(16),
  position: vec3.optional(),
  hint: text(400),
  data: z.record(z.string().max(40), z.union([finite, z.string().max(200), z.boolean(), z.array(finite).max(16)])).optional(),
});

const ObjectiveResult = z.object({
  id: text(160),
  kind: z.enum(['collect', 'goal', 'zone', 'room', 'plate', 'talk', 'press']),
  label: text(160),
  entity: text(128).optional(),
  position: vec3,
  required: z.boolean(),
  status: z.enum(['done', 'unreachable', 'blocked', 'untouched', 'pending']),
  at: finite.optional(),
  reason: text(300).optional(),
});

const TraceEvent = z.object({
  t: finite,
  kind: z.enum(['pickup', 'door', 'goal', 'fall', 'stuck', 'room', 'win', 'lose', 'start']),
  label: text(100),
  position: vec3,
});

const Trace = z
  .object({
    dt: z.number().gt(0).max(1),
    frames: z.number().int().min(2).max(PLAYTEST_LIMITS.MAX_TRACE_FRAMES + 1),
    poses: z.custom<Float32Array>((v) => v instanceof Float32Array && v.length <= (PLAYTEST_LIMITS.MAX_TRACE_FRAMES + 1) * TRACE_STRIDE, { message: 'expected a Float32Array' }),
    events: z.array(TraceEvent).max(400),
  })
  .refine((t) => t.poses.length === t.frames * TRACE_STRIDE, 'poses must hold frames × 4 values')
  .refine((t) => t.poses.every(Number.isFinite), 'poses must be finite');

/** A playtest report on the wire. */
export const ReportWire = z.object({
  v: z.literal(1),
  kind: z.enum(['game', 'walkthrough']),
  status: z.enum(['passed', 'failed', 'inconclusive', 'unsupported']),
  won: z.boolean(),
  outcome: z.enum(['win', 'lose']).nullable(),
  seconds: finite,
  steps: z.number().int().min(0),
  wallMs: finite,
  objectives: z.array(ObjectiveResult).max(PLAYTEST_LIMITS.MAX_OBJECTIVES),
  findings: z.array(Finding).max(PLAYTEST_LIMITS.MAX_FINDINGS),
  falls: z.number().int().min(0),
  stuckPoints: z.array(vec3).max(32),
  path: z.array(vec3).max(PLAYTEST_LIMITS.MAX_PATH_POINTS + 1),
  trace: Trace.optional(),
  summary: text(600),
  worldHash: z.string().regex(/^[0-9a-f]{16}$/),
  endText: text(200).optional(),
  stats: z.object({ searches: finite, expanded: finite, navNodes: finite, navCell: finite, navMs: finite, planMs: finite, evasions: finite.optional() }).optional(),
});

/** Validate a report received from a worker or storage; null when malformed. */
export function parseReport(raw: unknown): PlaytestReport | null {
  const r = ReportWire.safeParse(raw);
  return r.success ? (r.data as PlaytestReport) : null;
}

/** A progress message on the wire. */
export const ProgressWire = z.object({
  phase: z.enum(['prepare', 'navigate', 'play', 'analyse', 'done']),
  fraction: z.number().min(0).max(1),
  seconds: finite,
  note: text(200),
  position: vec3.optional(),
});

/** Validate a progress message; null when malformed. */
export function parseProgress(raw: unknown): PlaytestProgress | null {
  const r = ProgressWire.safeParse(raw);
  return r.success ? (r.data as PlaytestProgress) : null;
}
