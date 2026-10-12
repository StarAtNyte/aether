/**
 * Shared HTTP helpers: uniform JSON errors and safe JSON body reading.
 */
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { inspectUntrusted } from '@aether/core';

/** Uniform error body: `{ error: <code>, message?: string, issues?: [...] }`. */
export interface ErrorBody {
  error: string;
  message?: string;
  issues?: Array<{ path: string; message: string }>;
}

/** Maximum number of validation issues echoed back to a client. */
const MAX_ISSUES = 20;

/** Send a JSON error response. `message`/`issues` must never contain secrets or stack traces. */
export function fail(c: Context, status: ContentfulStatusCode, error: string, message?: string, issues?: ErrorBody['issues']): Response {
  const body: ErrorBody = { error };
  if (message !== undefined) body.message = message;
  if (issues && issues.length > 0) {
    body.issues = issues.slice(0, MAX_ISSUES).map((i) => ({ path: i.path.slice(0, 200), message: i.message.slice(0, 300) }));
  }
  return c.json(body, status);
}

/** Convert zod issues into `{ path, message }` pairs. */
export function zodToIssues(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>): Array<{ path: string; message: string }> {
  return issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message }));
}

/** Result of {@link readJsonBody}. */
export type JsonBodyResult = { ok: true; value: unknown } | { ok: false; response: Response };

/**
 * Read a JSON request body defensively:
 * - requires `Content-Type: application/json` (forces CORS preflight → CSRF defense);
 * - rejects malformed JSON;
 * - rejects prototype-pollution keys, excessive nesting and node-count bombs.
 * Body size is bounded earlier by the body-limit middleware.
 */
export async function readJsonBody(c: Context, guard: { maxDepth?: number; maxNodes?: number; maxStringLength?: number } = {}): Promise<JsonBodyResult> {
  const type = c.req.header('content-type') ?? '';
  if (!/^application\/json\s*(;|$)/i.test(type)) {
    return { ok: false, response: fail(c, 415, 'unsupported-media-type', 'Content-Type must be application/json.') };
  }
  let value: unknown;
  try {
    value = JSON.parse(await c.req.text()) as unknown;
  } catch {
    return { ok: false, response: fail(c, 400, 'invalid-json', 'Request body is not valid JSON.') };
  }
  const check = inspectUntrusted(value, guard);
  if (!check.ok) {
    return { ok: false, response: fail(c, 400, 'unsafe-input', 'Request body was rejected.', [{ path: check.path, message: check.message }]) };
  }
  return { ok: true, value };
}
