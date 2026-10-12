/**
 * Map upstream LLM failures to safe, stable client-facing errors.
 *
 * Upstream error text may contain request ids, partial prompts or (in the
 * worst case) credentials, so it is NEVER forwarded: clients receive only a
 * fixed error code and message; details go to the scrubbed server log.
 */

/** Client-facing error description. */
export interface SafeUpstreamError {
  status: 502 | 503 | 504;
  code: 'upstream-timeout' | 'upstream-auth' | 'upstream-rate-limited' | 'upstream-bad-request' | 'upstream-unavailable' | 'upstream-error';
  message: string;
  /** Upstream HTTP status if it could be determined (for logs). */
  upstreamStatus?: number;
}

/** Best-effort extraction of an HTTP status from an unknown provider error. */
export function upstreamStatusOf(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  for (const key of ['status', 'statusCode']) {
    const v = (err as Record<string, unknown>)[key];
    if (typeof v === 'number' && Number.isInteger(v) && v >= 100 && v <= 599) return v;
  }
  const resp = (err as { response?: unknown }).response;
  if (typeof resp === 'object' && resp !== null) {
    const v = (resp as { status?: unknown }).status;
    if (typeof v === 'number' && Number.isInteger(v) && v >= 100 && v <= 599) return v;
  }
  const msg = (err as { message?: unknown }).message;
  if (typeof msg === 'string') {
    const m = /\b(?:HTTP|status)[\s:]*([45]\d\d)\b/i.exec(msg) ?? /\b([45]\d\d)\b/.exec(msg);
    if (m?.[1]) return Number(m[1]);
  }
  return undefined;
}

/** Translate an upstream failure (already known not to be a client abort) into a safe error. */
export function mapUpstreamError(err: unknown, timedOut: boolean): SafeUpstreamError {
  const providerCode = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined;
  if (timedOut || providerCode === 'timeout') return { status: 504, code: 'upstream-timeout', message: 'The language model took too long to respond.' };
  if (providerCode === 'network') return { status: 502, code: 'upstream-unavailable', message: 'The language model provider is unavailable.' };
  const upstreamStatus = upstreamStatusOf(err);
  const base = upstreamStatus === undefined ? {} : { upstreamStatus };
  if (upstreamStatus === 401 || upstreamStatus === 403) {
    return { ...base, status: 502, code: 'upstream-auth', message: 'The language model provider rejected the server credentials.' };
  }
  if (upstreamStatus === 429 || upstreamStatus === 529) {
    return { ...base, status: 503, code: 'upstream-rate-limited', message: 'The language model provider is busy. Please retry shortly.' };
  }
  if (upstreamStatus === 400 || upstreamStatus === 404 || upstreamStatus === 413 || upstreamStatus === 422) {
    return { ...base, status: 502, code: 'upstream-bad-request', message: 'The language model provider rejected the request.' };
  }
  if (upstreamStatus !== undefined && upstreamStatus >= 500) {
    return { ...base, status: 502, code: 'upstream-unavailable', message: 'The language model provider is unavailable.' };
  }
  return { ...base, status: 502, code: 'upstream-error', message: 'The language model request failed.' };
}
