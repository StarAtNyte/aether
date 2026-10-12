/**
 * JSON-over-HTTP transport shared by the providers: per-attempt timeouts
 * combined with the caller's AbortSignal, exponential backoff with jitter for
 * retryable failures (429 / 5xx / 529 / network / timeout), `retry-after`
 * support, response size caps and normalized {@link ProviderError}s.
 */
import { ProviderError, codeForStatus } from './errors';

/** Retry and timeout policy. */
export interface RetryPolicy {
  /** Retries after the first attempt (default 3). */
  maxRetries?: number;
  /** Per-attempt timeout in ms (default 180 000). */
  timeoutMs?: number;
  /** First backoff delay in ms (default 500); doubles per attempt. */
  baseDelayMs?: number;
  /** Upper bound for any single wait in ms (default 30 000). */
  maxDelayMs?: number;
  /** Jitter source in [0,1). Network jitter is not simulation, but it is injectable for tests. */
  random?: () => number;
  /** Abortable sleep, injectable for tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** One JSON POST request. */
export interface PostJsonRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  fetch: typeof fetch;
  signal?: AbortSignal;
  policy?: RetryPolicy;
  /** Extracts a concise message from an error body (vendor specific). */
  describeError?: (status: number, body: unknown) => string;
  /** Maximum accepted response size in bytes (default 8 MiB). */
  maxResponseBytes?: number;
}

const DEFAULT_MAX_RESPONSE = 8 * 1024 * 1024;

/** Combine signals; uses AbortSignal.any when available. */
export function anySignal(signals: ReadonlyArray<AbortSignal | undefined>): AbortSignal {
  const list = signals.filter((s): s is AbortSignal => s !== undefined);
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(list);
  const ctrl = new AbortController();
  for (const s of list) {
    if (s.aborted) {
      ctrl.abort(s.reason);
      break;
    }
    s.addEventListener('abort', () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}

/** Sleep that rejects with an `aborted` ProviderError when `signal` fires. */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ProviderError('aborted', 'request aborted'));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new ProviderError('aborted', 'request aborted'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Parse a `retry-after` header (seconds or HTTP date is reduced to seconds only). */
function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  return undefined;
}

function backoffDelay(attempt: number, policy: Required<Pick<RetryPolicy, 'baseDelayMs' | 'maxDelayMs'>>, random: () => number, hint?: number): number {
  const exp = policy.baseDelayMs * 2 ** attempt;
  const jittered = exp / 2 + random() * (exp / 2);
  return Math.min(policy.maxDelayMs, Math.max(hint ?? 0, jittered));
}

async function readBody(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new ProviderError('invalid_response', `response too large (${declared} bytes)`, { status: res.status });
  const text = await res.text();
  if (text.length > maxBytes) throw new ProviderError('invalid_response', `response too large (${text.length} chars)`, { status: res.status });
  return text;
}

function parseJson(text: string): unknown {
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

async function attempt(req: PostJsonRequest, timeoutMs: number, maxBytes: number): Promise<unknown> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), timeoutMs);
  const signal = anySignal([req.signal, timeout.signal]);
  try {
    let res: Response;
    try {
      res = await req.fetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal });
    } catch (e) {
      if (req.signal?.aborted) throw new ProviderError('aborted', 'request aborted', { cause: e });
      if (timeout.signal.aborted) throw new ProviderError('timeout', `request timed out after ${timeoutMs} ms`, { cause: e });
      throw new ProviderError('network', 'network error contacting the model provider', { cause: e });
    }
    let text: string;
    try {
      text = await readBody(res, maxBytes);
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      if (req.signal?.aborted) throw new ProviderError('aborted', 'request aborted', { cause: e });
      if (timeout.signal.aborted) throw new ProviderError('timeout', `request timed out after ${timeoutMs} ms`, { cause: e });
      throw new ProviderError('network', 'connection lost while reading the response', { cause: e });
    }
    const body = parseJson(text);
    if (!res.ok) {
      const detail = req.describeError?.(res.status, body) ?? `HTTP ${res.status}`;
      const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'));
      throw new ProviderError(codeForStatus(res.status), detail, retryAfterMs === undefined ? { status: res.status } : { status: res.status, retryAfterMs });
    }
    if (body === undefined) throw new ProviderError('invalid_response', 'provider returned a non-JSON response', { status: res.status });
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POST `body` as JSON and return the parsed JSON response, retrying retryable
 * failures with exponential backoff and jitter. Never retries 4xx (except 408/409/429)
 * or caller aborts.
 */
export async function postJson(req: PostJsonRequest): Promise<unknown> {
  const policy = req.policy ?? {};
  const maxRetries = Math.max(0, Math.min(10, policy.maxRetries ?? 3));
  const timeoutMs = Math.max(1, policy.timeoutMs ?? 180_000);
  const delays = { baseDelayMs: policy.baseDelayMs ?? 500, maxDelayMs: policy.maxDelayMs ?? 30_000 };
  const random = policy.random ?? Math.random;
  const sleep = policy.sleep ?? abortableSleep;
  const maxBytes = req.maxResponseBytes ?? DEFAULT_MAX_RESPONSE;

  for (let i = 0; ; i++) {
    if (req.signal?.aborted) throw new ProviderError('aborted', 'request aborted');
    try {
      return await attempt(req, timeoutMs, maxBytes);
    } catch (e) {
      const err = e instanceof ProviderError ? e : new ProviderError('network', 'unexpected transport failure', { cause: e });
      if (!err.retryable || i >= maxRetries) throw err;
      await sleep(backoffDelay(i, delays, random, err.retryAfterMs), req.signal);
    }
  }
}
