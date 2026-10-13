/**
 * Bridge errors: a stable code (shared with clients, see
 * `@aether/agent` BRIDGE_ERROR_CODES), an HTTP status and a safe message.
 * CLI output is never forwarded verbatim; it is classified instead.
 */
import type { BridgeErrorCode } from '@aether/agent';

/** HTTP status per error code. */
export const STATUS_FOR: Readonly<Record<BridgeErrorCode, number>> = {
  unauthorized: 401,
  forbidden_origin: 403,
  forbidden_host: 403,
  invalid_request: 400,
  too_large: 413,
  not_found: 404,
  busy: 429,
  rate_limited: 429,
  not_logged_in: 424,
  cli_missing: 503,
  timeout: 504,
  tool_violation: 502,
  backend_error: 502,
  pairing_locked: 429,
};

/** An error with a client-safe code and message. */
export class BridgeError extends Error {
  readonly code: BridgeErrorCode;
  readonly status: number;
  /** Seconds the client should wait (429s). */
  readonly retryAfterSec: number | undefined;

  constructor(code: BridgeErrorCode, message: string, opts: { retryAfterSec?: number; cause?: unknown } = {}) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = 'BridgeError';
    this.code = code;
    this.status = STATUS_FOR[code];
    this.retryAfterSec = opts.retryAfterSec;
  }
}

const NOT_LOGGED_IN = /not logged in|please (run )?`?(codex login|claude (auth )?login|\/login)|log ?in (again|first|required)|unauthori[sz]ed|\b401\b|invalid (api key|token)|authentication (failed|error|required)|oauth token (has )?expired/i;
const RATE_LIMITED = /rate.?limit|usage limit|too many requests|\b429\b|quota|limit (reached|exceeded)|try again (in|later|at)|out of (credits|usage)/i;

/** Classify CLI failure text (stderr / error events) into a bridge error. */
export function classifyCliFailure(backendLabel: string, text: string): BridgeError {
  const t = text.slice(0, 20_000);
  if (NOT_LOGGED_IN.test(t)) return new BridgeError('not_logged_in', `${backendLabel} is not signed in. Run the login command shown in Settings, then retry.`);
  if (RATE_LIMITED.test(t)) return new BridgeError('rate_limited', `${backendLabel} reports that your subscription's usage limit is reached. Try again later or switch models.`, { retryAfterSec: 60 });
  return new BridgeError('backend_error', `${backendLabel} failed to answer.`);
}
