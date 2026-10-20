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
  model_unavailable: 422,
  context_too_large: 413,
  network_error: 502,
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
const MODEL_UNAVAILABLE = /model[^\n]{0,80}(not (found|supported|available|exist)|does not exist|unsupported|unknown|invalid|deprecated|retired)|unknown model|no such model|invalid model|not available (for|to|with) (your|this) (account|plan|subscription)|(requires|only available (on|with)) (a |the )?(newer|different|paid|pro|plus|max)/i;
const CONTEXT_TOO_LARGE = /context (length|window)|too many tokens|maximum context|prompt is too long|input[^.\n]{0,24}too (long|large)|token limit|exceeds? the (maximum|max|limit)|request too large/i;
const NETWORK = /\bE(CONNRESET|CONNREFUSED|NOTFOUND|TIMEDOUT|AI_AGAIN|HOSTUNREACH|NETUNREACH)\b|network (error|is unreachable|unreachable)|fetch failed|socket hang up|getaddrinfo|dns (error|failure|lookup)|connection (reset|refused|closed|lost)|stream (disconnected|closed|ended) (before|unexpectedly)|error sending request|failed to connect|\btls\b|certificate (verify|error)|proxy (error|connect)/i;
const OVERLOADED = /overloaded|\b5\d\d\b[^.\n]{0,24}(error|unavailable|gateway)|internal server error|service unavailable|temporarily unavailable|at capacity|server (error|is busy)/i;

/**
 * A short, safe excerpt of CLI failure text for the user: first meaningful
 * line, with paths, URLs, e-mail addresses and long token-like strings
 * removed, at most 140 characters. Never the raw output.
 */
export function failureExcerpt(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 3 && !/^(at |\s*\^|stack|error:?$|\{|\}|\[?\d{4}-\d\d-\d\d)/i.test(l));
  const raw = lines.find((l) => /[a-z]{3}/i.test(l)) ?? '';
  const clean = raw
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/(?:[A-Za-z]:)?[\\/](?:[\w.@~-]+[\\/])+[\w.@~-]*/g, '')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '')
    .replace(/\b(?:sk|pk|rk|ghp|gho|xox[abp]|key|tok|token|bearer)[-_ ][A-Za-z0-9_.-]{3,}/gi, '')
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, '')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^(error|fatal|warning)[:\s]+/i, '')
    .trim();
  return clean.length > 140 ? `${clean.slice(0, 137)}...` : clean;
}

/**
 * When a usage limit lifts, as the CLI phrased it ("Try again at Oct 21st, 2026
 * 12:14 AM", "try again in 3 hours"): letters, digits and time punctuation only,
 * so nothing else from the CLI's output is echoed.
 */
export function limitResetText(text: string): string | null {
  const m = /try again (at|in) ([A-Za-z0-9 ,:]{1,40}?(?:\s?[AP]M)?)(?=[.!\n]|$)/i.exec(text);
  if (!m || !m[1] || !m[2]) return null;
  const v = m[2].trim();
  return /\d/.test(v) ? `${m[1].toLowerCase()} ${v}` : null;
}

/** Classify CLI failure text (stderr / error events) into a bridge error. */
export function classifyCliFailure(backendLabel: string, text: string): BridgeError {
  const t = text.slice(0, 20_000);
  if (NOT_LOGGED_IN.test(t)) return new BridgeError('not_logged_in', `${backendLabel} is not signed in. Run the login command shown in Settings, then retry.`);
  if (RATE_LIMITED.test(t)) {
    const when = limitResetText(t);
    return new BridgeError('rate_limited', `${backendLabel} reports that your subscription's usage limit is reached. ${when ? `It resets ${when}; try again then` : 'Try again later'} or switch models.`, { retryAfterSec: 60 });
  }
  if (MODEL_UNAVAILABLE.test(t)) return new BridgeError('model_unavailable', `${backendLabel} does not offer the selected model on this account. Pick another model in Settings → AI connection.`);
  if (CONTEXT_TOO_LARGE.test(t)) return new BridgeError('context_too_large', `The request is too large for ${backendLabel}'s context window. Start from a smaller world or shorten the prompt.`);
  if (NETWORK.test(t)) return new BridgeError('network_error', `${backendLabel} could not reach its service (network error). Check your internet connection and try again.`, { retryAfterSec: 10 });
  const why = failureExcerpt(t);
  if (OVERLOADED.test(t)) return new BridgeError('backend_error', `${backendLabel}'s service is overloaded or failing right now${why ? ` (${why})` : ''}. Try again in a moment.`, { retryAfterSec: 20 });
  return new BridgeError('backend_error', `${backendLabel} failed to answer${why ? `: ${why}` : ' (no further detail from its output)'}.`);
}
