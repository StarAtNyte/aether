/**
 * Message protocol of the physics verification worker, validated with zod on
 * both ends. Requests carry the world document (re-validated in the worker
 * with `validateWorld`) plus the renderer's colliders for shapes the worker
 * cannot rebuild itself (model-written generators, imported models). Replies
 * stream one `progress` message per decided test and end with exactly one
 * `done` message per request id.
 *
 * Size caps: a request's colliders hold at most {@link MAX_COLLIDER_FLOATS}
 * numbers in total and {@link MAX_COLLIDER_ENTITIES} entities; every string
 * in a reply is clipped; result and diagnostic lists are capped.
 */
import { z } from 'zod';
import type { ColliderDesc } from '@aether/procgen';
import type { Diagnostic, SettleReport, TestResult, VerifyReport, VerifyTrace } from '@aether/physics';

/** Entities that may carry renderer colliders in one request. */
export const MAX_COLLIDER_ENTITIES = 5000;
/** Colliders per entity (matches physics' per-shape cap). */
export const MAX_COLLIDERS_PER_ENTITY = 2048;
/** Total numbers (floats + indices) across all colliders of one request (64 MB of float32). */
export const MAX_COLLIDER_FLOATS = 16 * 1024 * 1024;
/** Results and diagnostics accepted in one reply. */
export const MAX_REPLY_ITEMS = 512;
/** Longest string accepted in a reply. */
const MAX_TEXT = 2000;
/** Largest request id (ids are positive safe integers). */
const MAX_ID = Number.MAX_SAFE_INTEGER;

const finite = z.number().refine(Number.isFinite, 'must be finite');
const vec3 = z.tuple([finite, finite, finite]);
const count = z.number().int().min(0).max(1_000_000);

const float32 = (max: number): z.ZodType<Float32Array> =>
  z.custom<Float32Array>((v) => v instanceof Float32Array && v.length <= max, { message: `expected a Float32Array of at most ${max} values` });
const uint32 = (max: number): z.ZodType<Uint32Array> =>
  z.custom<Uint32Array>((v) => v instanceof Uint32Array && v.length <= max, { message: `expected a Uint32Array of at most ${max} values` });

/** One collider description (procgen convention), as sent to the worker. */
export const ColliderDescSchema: z.ZodType<ColliderDesc> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('box'), halfExtents: vec3, offset: vec3, rotation: vec3.optional() }).strict(),
  z.object({ kind: z.literal('sphere'), radius: finite, offset: vec3 }).strict(),
  z.object({ kind: z.literal('capsule'), halfHeight: finite, radius: finite, offset: vec3 }).strict(),
  z.object({ kind: z.literal('cylinder'), halfHeight: finite, radius: finite, offset: vec3 }).strict(),
  z.object({ kind: z.literal('hull'), points: float32(3 * 65_536), offset: vec3 }).strict(),
  z.object({ kind: z.literal('trimesh'), positions: float32(3 * 1_000_000), indices: uint32(6_000_000) }).strict(),
  z
    .object({ kind: z.literal('heightfield'), rows: z.number().int().min(1).max(4096), cols: z.number().int().min(1).max(4096), heights: float32(4097 * 4097), size: vec3 })
    .strict()
    .refine((h) => h.heights.length === (h.rows + 1) * (h.cols + 1), 'heights must hold (rows+1)*(cols+1) samples'),
]) as z.ZodType<ColliderDesc>;

/** Renderer colliders per entity id. */
export const CollidersSchema = z
  .array(z.tuple([z.string().min(1).max(128), z.array(ColliderDescSchema).max(MAX_COLLIDERS_PER_ENTITY)]))
  .max(MAX_COLLIDER_ENTITIES)
  .refine((list) => colliderNumbers(list) <= MAX_COLLIDER_FLOATS, `colliders exceed ${MAX_COLLIDER_FLOATS} numbers`);

/** Numbers carried by a collider list (the size cap). */
export function colliderNumbers(list: ReadonlyArray<readonly [string, readonly ColliderDesc[]]>): number {
  let n = 0;
  for (const [, descs] of list) {
    for (const d of descs) {
      if (d.kind === 'hull') n += d.points.length;
      else if (d.kind === 'trimesh') n += d.positions.length + d.indices.length;
      else if (d.kind === 'heightfield') n += d.heights.length;
      else n += 10;
    }
  }
  return n;
}

const requestId = z.number().int().min(1).max(MAX_ID);

/** Options of a verification request. */
export const VerifyRequestOptions = z
  .object({
    maxSeconds: z.number().min(0).max(60),
    budgetMs: z.number().min(1).max(30_000),
    /** Indices of `world.tests` to run (a shard); all tests when absent. */
    tests: z.array(z.number().int().min(0).max(10_000)).max(1000).optional(),
    /** Compute static diagnostics in this request. */
    diagnostics: z.boolean(),
    /** Record a motion trace for the proof replay (one shard per run). */
    trace: z.boolean().optional(),
  })
  .strict();

/** Main thread → worker. */
export const VerifyRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('verify'), id: requestId, world: z.unknown(), colliders: CollidersSchema, options: VerifyRequestOptions }).strict(),
  z.object({ type: z.literal('diagnose'), id: requestId, world: z.unknown(), colliders: CollidersSchema }).strict(),
  z
    .object({
      type: z.literal('settle'),
      id: requestId,
      world: z.unknown(),
      colliders: CollidersSchema,
      seconds: z.number().min(0).max(30).optional(),
      only: z.array(z.string().min(1).max(128)).max(5000).optional(),
    })
    .strict(),
  /** Load and initialise physics (and scripting) ahead of the first request. */
  z.object({ type: z.literal('warm'), id: requestId, scripting: z.boolean() }).strict(),
  z.object({ type: z.literal('cancel'), id: requestId }).strict(),
]);

/** A validated request. */
export type VerifyRequest = z.infer<typeof VerifyRequestSchema>;

const text = z.string().transform((s) => s.slice(0, MAX_TEXT));

/** A test result as reported by the worker. */
export const TestResultSchema: z.ZodType<TestResult> = z.object({
  id: text,
  kind: text,
  passed: z.boolean(),
  message: text,
  atTime: finite.optional(),
}) as z.ZodType<TestResult>;

/** A diagnostic as reported by the worker. */
export const DiagnosticSchema: z.ZodType<Diagnostic> = z.object({
  severity: z.enum(['error', 'warning', 'info']),
  code: z.enum(['overlap', 'floating', 'outOfBounds', 'jointInvalid', 'tooManyBodies', 'fellOut', 'unstable', 'noCharacter']),
  entities: z.array(text).max(MAX_REPLY_ITEMS),
  message: text,
  suggestion: text.optional(),
}) as z.ZodType<Diagnostic>;

/** Bodies in one motion trace. */
export const MAX_TRACE_BODIES = 64;
/** Frames in one motion trace (20 s at 30 Hz). */
export const MAX_TRACE_FRAMES = 601;
/** Floats per body per frame (position xyz + quaternion xyzw). */
const TRACE_STRIDE = 7;

/** A motion trace as reported by the worker: exact length, finite values. */
export const VerifyTraceSchema: z.ZodType<VerifyTrace> = z
  .object({
    ids: z.array(z.string().min(1).max(128)).min(1).max(MAX_TRACE_BODIES),
    dt: z.number().gt(0).max(1),
    frames: z.number().int().min(2).max(MAX_TRACE_FRAMES),
    poses: float32(MAX_TRACE_BODIES * MAX_TRACE_FRAMES * TRACE_STRIDE),
  })
  .strict()
  .refine((t) => t.poses.length === t.frames * t.ids.length * TRACE_STRIDE, 'poses must hold frames × bodies × 7 values')
  .refine((t) => t.poses.every(Number.isFinite), 'poses must be finite') as z.ZodType<VerifyTrace>;

/** A verification report as reported by the worker. */
export const VerifyReportSchema: z.ZodType<VerifyReport> = z.object({
  passed: z.boolean(),
  results: z.array(TestResultSchema).max(MAX_REPLY_ITEMS),
  diagnostics: z.array(DiagnosticSchema).max(MAX_REPLY_ITEMS),
  simulatedSeconds: finite,
  ms: finite,
  testIndices: z.array(count).max(MAX_REPLY_ITEMS).optional(),
  trace: VerifyTraceSchema.optional(),
}) as z.ZodType<VerifyReport>;

/** A settle report as reported by the worker (patches are re-validated by History on commit). */
export const SettleReportSchema: z.ZodType<SettleReport> = z.object({
  patches: z.array(z.unknown()).max(10_000),
  moved: z.array(z.object({ id: text, distance: finite })).max(10_000),
  unstable: z.array(text).max(10_000),
  fellOut: z.array(text).max(10_000),
  seconds: finite,
  ms: finite,
}) as z.ZodType<SettleReport>;

/** Worker → main thread. */
export const VerifyReplySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('progress'), id: requestId, index: count, result: TestResultSchema }),
  z.object({ type: z.literal('verified'), id: requestId, report: VerifyReportSchema }),
  z.object({ type: z.literal('diagnosed'), id: requestId, diagnostics: z.array(DiagnosticSchema).max(MAX_REPLY_ITEMS) }),
  z.object({ type: z.literal('settled'), id: requestId, report: SettleReportSchema }),
  z.object({ type: z.literal('warmed'), id: requestId }),
  z.object({ type: z.literal('failed'), id: requestId, error: text, cancelled: z.boolean() }),
]);

/** A validated reply. */
export type VerifyReply = z.infer<typeof VerifyReplySchema>;

/** Validate a message received by the worker (null when malformed). */
export function parseVerifyRequest(data: unknown): VerifyRequest | null {
  const r = VerifyRequestSchema.safeParse(data);
  return r.success ? r.data : null;
}

/** Validate a message received from the worker (null when malformed). */
export function parseVerifyReply(data: unknown): VerifyReply | null {
  const r = VerifyReplySchema.safeParse(data);
  return r.success ? r.data : null;
}
