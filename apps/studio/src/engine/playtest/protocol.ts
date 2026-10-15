/**
 * Message protocol of the playtest worker, validated with zod on both ends.
 * A request carries the world document (re-validated in the worker with
 * `validateWorld`) and caps on simulated time and wall-clock time; replies
 * stream `progress` messages and end with exactly one `done` or `failed`
 * per request id.
 */
import { z } from 'zod';
import { PLAYTEST_LIMITS, type PlaytestProgress, type PlaytestReport } from '@aether/playtest/types';
import { ProgressWire, ReportWire } from '@aether/playtest/wire';

const requestId = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);

/** Options of a playtest request (clamped again inside the bot). */
export const PlaytestRequestOptions = z
  .object({
    maxSimSeconds: z.number().min(5).max(PLAYTEST_LIMITS.MAX_SIM_SECONDS),
    budgetMs: z.number().min(500).max(PLAYTEST_LIMITS.MAX_BUDGET_MS),
    trace: z.boolean(),
  })
  .strict();

/** Main thread → worker. */
export const PlaytestRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('run'), id: requestId, kind: z.enum(['game', 'walkthrough']), world: z.unknown(), options: PlaytestRequestOptions }).strict(),
  z.object({ type: z.literal('warm'), id: requestId }).strict(),
  z.object({ type: z.literal('cancel'), id: requestId }).strict(),
]);

/** A validated request. */
export type PlaytestRequest = z.infer<typeof PlaytestRequestSchema>;

/** Worker → main thread. */
export const PlaytestReplySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('progress'), id: requestId, progress: ProgressWire }),
  z.object({ type: z.literal('done'), id: requestId, report: ReportWire }),
  z.object({ type: z.literal('warmed'), id: requestId }),
  z.object({ type: z.literal('failed'), id: requestId, error: z.string().transform((s) => s.slice(0, 600)), cancelled: z.boolean() }),
]);

/** A validated reply. */
export type PlaytestReply = z.infer<typeof PlaytestReplySchema>;

/** Validate a message received by the worker (null when malformed). */
export function parsePlaytestRequest(data: unknown): PlaytestRequest | null {
  const r = PlaytestRequestSchema.safeParse(data);
  return r.success ? r.data : null;
}

/** Validate a message received from the worker (null when malformed). */
export function parsePlaytestReply(data: unknown): PlaytestReply | null {
  const r = PlaytestReplySchema.safeParse(data);
  return r.success ? r.data : null;
}

/** Re-exports for callers that only need the data types. */
export type { PlaytestProgress, PlaytestReport };
