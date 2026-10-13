/**
 * Wire contract of local AI on the Aether server (`/api/local/*`, only when
 * the server runs on the user's own machine) and of the matching bridge
 * endpoints (`/v1/auth/*`, `/v1/sessions/*`, `/v1/jobs*`). Shared by the
 * services and their clients; both sides validate with these schemas.
 *
 *   GET    /api/local/status                 → LocalStatus
 *   POST   /api/local/complete               BridgeCompleteRequest → CompletionResponse
 *   DELETE /api/local/sessions/:project      → { cleared }
 *   POST   /api/local/login                  LoginStartRequest → LoginState
 *   GET    /api/local/login                  → { login: LoginState | null }
 *   POST   /api/local/login/cancel           → { login }
 *   POST   /api/local/logout                 { backend, accountId? } → { ok, message }
 *   GET    /api/local/accounts               → AccountsList
 *   POST   /api/local/accounts               { label } → LoginState (device sign-in for the new account)
 *   POST   /api/local/accounts/:id/activate  → AccountsList
 *   DELETE /api/local/accounts/:id           → AccountsList
 *   POST   /api/local/jobs                   AssetJobRequest → LocalJob
 *   GET    /api/local/jobs/:id               → LocalJob
 *   GET    /api/local/jobs/:id/events?after= → text/event-stream of LocalJobEvent, then `end` with the LocalJob
 *   POST   /api/local/jobs/:id/cancel        → LocalJob
 */
import { z } from 'zod';
import { GeneratorDef } from '@aether/core';
import { BRIDGE_BACKENDS, BRIDGE_EFFORTS, BridgeBackendStatusSchema, MODEL_ID_RE } from './protocol';

/** Session keys sent by the studio: `p-<project id>` (lowercase). */
export const PROJECT_SESSION_RE = /^[a-z0-9][a-z0-9-]{7,79}$/;
/** Account ids (`default` or a UUID). */
export const ACCOUNT_ID_RE = /^(default|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
/** Job ids (UUID). */
export const JOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A sign-in flow (the CLI's own). */
export const LoginStateSchema = z.object({
  backend: z.enum(BRIDGE_BACKENDS),
  accountId: z.string().regex(ACCOUNT_ID_RE).optional(),
  running: z.boolean(),
  url: z.string().max(400).regex(/^https:\/\/[^\s"'<>]+$/).optional(),
  code: z.string().max(16).optional(),
  output: z.string().max(4000),
  startedAt: z.number(),
  finished: z.object({ ok: z.boolean(), message: z.string().max(200) }).optional(),
});
/** A sign-in flow. */
export type LoginState = z.infer<typeof LoginStateSchema>;

/** `POST …/login` body. */
export const LoginStartRequestSchema = z.object({ backend: z.enum(BRIDGE_BACKENDS) }).strict();
/** `POST …/logout` body. */
export const LogoutRequestSchema = z.object({ backend: z.enum(BRIDGE_BACKENDS), accountId: z.string().regex(ACCOUNT_ID_RE).optional() }).strict();

/** One Codex account. */
export const LocalAccountSchema = z.object({
  id: z.string().regex(ACCOUNT_ID_RE),
  label: z.string().max(80),
  active: z.boolean(),
  signedIn: z.boolean(),
  detail: z.string().max(200),
});
/** One Codex account. */
export type LocalAccount = z.infer<typeof LocalAccountSchema>;
/** `GET …/accounts`. */
export const AccountsListSchema = z.object({ items: z.array(LocalAccountSchema).max(16), activeId: z.string().regex(ACCOUNT_ID_RE), jobs: z.number().int().min(0) });
/** The account list. */
export type AccountsList = z.infer<typeof AccountsListSchema>;
/** `POST …/accounts` body. */
export const AccountCreateRequestSchema = z.object({ label: z.string().min(1).max(80) }).strict();

/** `GET /api/local/status`. */
export const LocalStatusSchema = z.object({
  ok: z.literal(true),
  name: z.literal('aether-local'),
  version: z.string().max(40),
  backends: z.array(BridgeBackendStatusSchema).max(4),
  /** The active Codex account (multi-account). */
  account: z.object({ id: z.string().regex(ACCOUNT_ID_RE), label: z.string().max(80) }).nullable(),
  /** Build jobs queued or running. */
  jobs: z.number().int().min(0),
  login: LoginStateSchema.nullable(),
});
/** Local AI status. */
export type LocalStatus = z.infer<typeof LocalStatusSchema>;

/** Budget of one agentic build. */
export const JobBudgetSchema = z.object({ turns: z.number().int().min(1).max(6), minutes: z.number().int().min(1).max(20) });
/** Budget of one agentic build. */
export type JobBudget = z.infer<typeof JobBudgetSchema>;
/** Default budget of a deep build. */
export const DEFAULT_JOB_BUDGET: JobBudget = { turns: 3, minutes: 8 };

/** What a deep asset build should produce. */
export const AssetSpecSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
  description: z.string().min(1).max(2000),
  paramsHint: z.string().max(1000).optional(),
});

/** `POST …/jobs` body. */
export const AssetJobRequestSchema = z
  .object({
    kind: z.literal('asset'),
    backend: z.enum(BRIDGE_BACKENDS),
    model: z.string().regex(MODEL_ID_RE).optional(),
    effort: z.enum(BRIDGE_EFFORTS).optional(),
    spec: AssetSpecSchema,
    budget: JobBudgetSchema.default(DEFAULT_JOB_BUDGET),
  })
  .strict();
/** A deep asset build request (input form: `budget` optional). */
export type AssetJobRequest = z.input<typeof AssetJobRequestSchema>;

/** Job states. */
export const JOB_STATES = ['queued', 'running', 'done', 'failed', 'cancelled'] as const;
/** A job state. */
export type JobState = (typeof JOB_STATES)[number];

/** A build job. */
export const LocalJobSchema = z.object({
  id: z.string().regex(JOB_ID_RE),
  kind: z.literal('asset'),
  backend: z.enum(BRIDGE_BACKENDS),
  accountId: z.string().max(64),
  model: z.string().regex(MODEL_ID_RE).optional(),
  effort: z.enum(BRIDGE_EFFORTS).optional(),
  spec: z.object({ id: z.string().max(64), description: z.string().max(2000), paramsHint: z.string().max(1000).optional() }),
  budget: z.object({ turns: z.number().int(), minutes: z.number().int() }),
  status: z.enum(JOB_STATES),
  createdAt: z.number(),
  startedAt: z.number().optional(),
  finishedAt: z.number().optional(),
  error: z.string().max(500).optional(),
  events: z.number().int().min(0),
  result: z
    .object({
      def: GeneratorDef,
      turns: z.number().int(),
      checkerPassed: z.boolean(),
      usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }).optional(),
      model: z.string().max(64).optional(),
    })
    .optional(),
});
/** A build job. */
export type LocalJob = z.infer<typeof LocalJobSchema>;

/** One progress event of a job. */
export const LocalJobEventSchema = z.object({ seq: z.number().int().min(1), at: z.number(), phase: z.string().max(48), message: z.string().max(500) });
/** One progress event of a job. */
export type LocalJobEvent = z.infer<typeof LocalJobEventSchema>;
