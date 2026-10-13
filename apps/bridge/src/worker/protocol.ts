/**
 * Protocol of the AI worker process: one job as JSON on stdin, progress as
 * `AETHER_PROGRESS {json}` lines on stderr, the result as one JSON object on
 * stdout. Both sides validate everything they read.
 */
import { z } from 'zod';
import { BRIDGE_BACKENDS, BRIDGE_EFFORTS, BRIDGE_ERROR_CODES, MODEL_ID_RE } from '@aether/agent';

/** Prefix of progress lines on the worker's stderr. */
export const PROGRESS_PREFIX = 'AETHER_PROGRESS ';

const Session = z.object({
  id: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
  systemHash: z.string().regex(/^[0-9a-f]{64}$/),
  body: z.string().max(512 * 1024),
  dir: z.string().max(1024).optional(),
});
/** A conversation handed to / returned by the worker. */
export type WorkerSession = z.infer<typeof Session>;

const TextRequest = z.object({
  role: z.enum(['planner', 'coder', 'critic']),
  system: z.string().max(2_000_000),
  prompt: z.string().max(8_000_000),
  schema: z.record(z.string(), z.unknown()),
  images: z.array(z.string().max(8 * 1024 * 1024)).max(4),
  toolNames: z.array(z.string().max(64)).max(64).optional(),
  model: z.string().regex(MODEL_ID_RE).optional(),
  effort: z.enum(BRIDGE_EFFORTS).optional(),
  maxOutputTokens: z.number().int().positive().max(200_000).optional(),
  session: z.object({ key: z.string().regex(/^[a-z0-9][a-z0-9-]{7,79}$/), body: z.string().max(8_000_000), tail: z.string().max(100_000) }).optional(),
});

/** A job for the worker. */
export const WorkerJob = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('complete'),
    backend: z.enum(BRIDGE_BACKENDS),
    request: TextRequest,
    /** The conversation to resume (from the parent's session store). */
    session: Session.optional(),
    /** Codex home of the account to use (null: the machine default). */
    codexHome: z.string().max(1024).nullable().optional(),
    timeoutMs: z.number().int().min(1000).max(900_000).optional(),
  }),
  z.object({
    kind: z.literal('agentic'),
    backend: z.enum(BRIDGE_BACKENDS),
    model: z.string().regex(MODEL_ID_RE).optional(),
    effort: z.enum(BRIDGE_EFFORTS).optional(),
    /** Absolute path of the throwaway workspace. */
    workspace: z.string().min(2).max(1024),
    /** The task prompt (also in task.md). */
    task: z.string().min(1).max(200_000),
    /** The artifact the agent must produce, relative to the workspace (checked with `node check.mjs <artifact>`). */
    artifact: z.string().regex(/^out\/[a-z0-9-]{1,40}\.json$/),
    maxTurns: z.number().int().min(1).max(8),
    codexHome: z.string().max(1024).nullable().optional(),
  }),
]);
/** A worker job. */
export type WorkerJob = z.infer<typeof WorkerJob>;

const Usage = z.object({ inputTokens: z.number().min(0), outputTokens: z.number().min(0) });

/** The worker's result (stdout). */
export const WorkerResult = z.union([
  z.object({
    ok: z.literal(true),
    kind: z.literal('complete'),
    text: z.string().max(8_000_000),
    structured: z.unknown().optional(),
    usage: Usage.optional(),
    model: z.string().max(64).optional(),
    resumed: z.boolean().optional(),
    session: Session.optional(),
  }),
  z.object({
    ok: z.literal(true),
    kind: z.literal('agentic'),
    turns: z.number().int().min(0).max(8),
    passed: z.boolean(),
    usage: Usage.optional(),
    model: z.string().max(64).optional(),
    message: z.string().max(4000).optional(),
  }),
  z.object({ ok: z.literal(false), code: z.enum(BRIDGE_ERROR_CODES), message: z.string().max(500) }),
]);
/** The worker's result. */
export type WorkerResult = z.infer<typeof WorkerResult>;

/** One progress event. */
export const WorkerProgress = z.object({ phase: z.string().min(1).max(48), message: z.string().max(500) });
/** One progress event. */
export type WorkerProgress = z.infer<typeof WorkerProgress>;

/** Parse one stderr line; the progress event or null. */
export function parseProgressLine(line: string): WorkerProgress | null {
  if (!line.startsWith(PROGRESS_PREFIX) || line.length > 4096) return null;
  try {
    const r = WorkerProgress.safeParse(JSON.parse(line.slice(PROGRESS_PREFIX.length)));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/** Runs one worker job (normally `runWorker`; tests inject fakes). */
export type WorkerRunner = (job: WorkerJob, opts: { timeoutMs: number; signal?: AbortSignal; onProgress?: (p: WorkerProgress) => void }) => Promise<WorkerResult>;
