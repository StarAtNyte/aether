/**
 * Wire contract of the local Aether Bridge (apps/bridge), shared by the
 * bridge itself and its browser/Node clients. Everything crossing the
 * boundary is validated with these zod schemas on both sides.
 *
 *   POST /v1/pair      { code }                      → { token }
 *   GET  /v1/status    (bearer)                      → BridgeStatus
 *   POST /v1/complete  (bearer) BridgeCompleteRequest → CompletionResponse
 *   POST /v1/image     (bearer) BridgeImageRequest    → { image: data URL, model }   (Codex's built-in image tool)
 *
 * Errors are `{ error: { code: BridgeErrorCode, message } }`.
 */
import { z } from 'zod';
import { CompletionRequestSchema } from '../wire';

/** Headless backends the bridge can drive. */
export const BRIDGE_BACKENDS = ['codex', 'claude-code'] as const;
/** A headless backend id. */
export type BridgeBackendId = (typeof BRIDGE_BACKENDS)[number];
/** Reasoning effort accepted by the bridge. */
export const BRIDGE_EFFORTS = ['low', 'medium', 'high'] as const;
/** A reasoning effort level. */
export type BridgeEffort = (typeof BRIDGE_EFFORTS)[number];

/** Default port of the bridge. */
export const BRIDGE_DEFAULT_PORT = 8790;
/** Model ids/aliases: conservative charset (they become CLI arguments). */
export const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
/** Pairing codes: 8 characters from an unambiguous alphabet, optionally grouped "ABCD-EFGH". */
export const PAIRING_CODE_RE = /^[A-HJ-NP-Z2-9]{4}-?[A-HJ-NP-Z2-9]{4}$/;
/** Bearer tokens: 43 base64url characters (32 random bytes). */
export const BRIDGE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Error codes returned by the bridge. */
export const BRIDGE_ERROR_CODES = [
  'unauthorized',
  'forbidden_origin',
  'forbidden_host',
  'invalid_request',
  'too_large',
  'not_found',
  'busy',
  'rate_limited',
  'not_logged_in',
  'cli_missing',
  'timeout',
  'tool_violation',
  'backend_error',
  'pairing_locked',
  /** The chosen model is unknown or not offered on this account. */
  'model_unavailable',
  /** The request does not fit the model's context window. */
  'context_too_large',
  /** The CLI could not reach its own service (no internet, DNS, TLS). */
  'network_error',
  /** A Blender action that runs Python was sent without the user's confirmation. */
  'confirmation_required',
  /** Blender is not installed, switched off, or not reachable (local only). */
  'blender_unavailable',
] as const;
/** A bridge error code. */
export type BridgeErrorCode = (typeof BRIDGE_ERROR_CODES)[number];

/** `POST /v1/pair` body. */
export const BridgePairRequestSchema = z.object({ code: z.string().max(16) }).strict();
/** `POST /v1/pair` response. */
export const BridgePairResponseSchema = z.object({ token: z.string().regex(BRIDGE_TOKEN_RE) });

/** `POST /v1/complete` body. */
export const BridgeCompleteRequestSchema = z
  .object({
    backend: z.enum(BRIDGE_BACKENDS),
    model: z.string().regex(MODEL_ID_RE).optional(),
    effort: z.enum(BRIDGE_EFFORTS).optional(),
    request: CompletionRequestSchema,
  })
  .strict();
/** Parsed `POST /v1/complete` body. */
export type BridgeCompleteRequest = z.infer<typeof BridgeCompleteRequestSchema>;

/** `POST /v1/image` body: a prompt and optionally a reference picture. */
export const BridgeImageRequestSchema = z
  .object({
    backend: z.literal('codex').default('codex'),
    prompt: z.string().min(1).max(1500),
    size: z.union([z.literal(512), z.literal(1024)]).optional(),
    /** PNG / JPEG / WebP data URL (a crop of the user's photo). */
    reference: z.string().max(6_000_000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/).optional(),
  })
  .strict();
/** Parsed `POST /v1/image` body. */
export type BridgeImageRequest = z.infer<typeof BridgeImageRequestSchema>;

/** One model a backend offers. */
export const BridgeModelSchema = z.object({
  id: z.string().regex(MODEL_ID_RE),
  label: z.string().max(80),
  efforts: z.array(z.enum(BRIDGE_EFFORTS)).max(3).optional(),
  vision: z.boolean().optional(),
});
/** A model offered by a backend. */
export type BridgeModel = z.infer<typeof BridgeModelSchema>;

/** Availability of one backend. */
export const BridgeBackendStatusSchema = z.object({
  id: z.enum(BRIDGE_BACKENDS),
  label: z.string().max(60),
  /** CLI found on PATH. */
  installed: z.boolean(),
  /** Signed in (subscription login). */
  loggedIn: z.boolean(),
  /** Human-readable state, e.g. "Logged in using ChatGPT". */
  detail: z.string().max(200),
  /** Signed-in account and plan where the CLI reports them, e.g. "you@example.com · Max". */
  account: z.string().max(160).optional(),
  models: z.array(BridgeModelSchema).max(32),
  defaultModel: z.string().regex(MODEL_ID_RE).optional(),
  /** The backend can make pictures (Codex: its built-in image tool; needs the ChatGPT login). */
  image: z.boolean().optional(),
  /** Jobs running + queued. */
  busy: z.number().int().min(0).max(1000),
});
/** Availability of one backend. */
export type BridgeBackendStatus = z.infer<typeof BridgeBackendStatusSchema>;

/** `GET /v1/status` response. */
export const BridgeStatusSchema = z.object({
  ok: z.literal(true),
  name: z.literal('aether-bridge'),
  version: z.string().max(40),
  backends: z.array(BridgeBackendStatusSchema).max(4),
});
/** Parsed bridge status. */
export type BridgeStatus = z.infer<typeof BridgeStatusSchema>;

/** Error body. */
/** Codes from a newer bridge than this client read as a plain backend error (the message still explains). */
export const BridgeErrorSchema = z.object({ error: z.object({ code: z.enum(BRIDGE_ERROR_CODES).catch('backend_error'), message: z.string().max(500) }) });

/**
 * Normalize a user-supplied bridge URL. Only loopback HTTP(S) origins are
 * accepted (`127.0.0.1`, `localhost`, `[::1]`), so a crafted deep link can
 * never send the pairing token anywhere else. Returns the origin, or null.
 */
export function normalizeBridgeUrl(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 200) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '[::1]') return null;
  return url.origin;
}
