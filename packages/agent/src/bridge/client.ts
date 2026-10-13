/**
 * Browser/Node client of the local Aether Bridge: pairing, status and a
 * {@link Provider} that sends completions to Codex or Claude Code through it.
 *
 * Calls are never retried automatically (a headless call spends the user's
 * subscription quota); failures become {@link ProviderError}s whose `reason`
 * carries the bridge error code (or 'bridge_offline') for the setup UX.
 */
import type { CompletionRequest, CompletionResponse, Provider } from '../types';
import { CompletionResponseSchema } from '../wire';
import { ProviderError, type ProviderErrorCode } from '../providers/errors';
import { anySignal } from '../providers/transport';
import {
  BridgeErrorSchema,
  BridgePairResponseSchema,
  BridgeStatusSchema,
  BRIDGE_TOKEN_RE,
  normalizeBridgeUrl,
  type BridgeBackendId,
  type BridgeEffort,
  type BridgeErrorCode,
  type BridgeStatus,
} from './protocol';

/** Largest response accepted from the bridge (bytes). */
const MAX_RESPONSE_CHARS = 8 * 1024 * 1024;
/** Default client-side timeout of one completion (headless calls are slow). */
export const BRIDGE_COMPLETE_TIMEOUT_MS = 300_000;
/** Default timeout of status/pair requests. */
export const BRIDGE_PROBE_TIMEOUT_MS = 4_000;

const CODE_FOR: Readonly<Record<BridgeErrorCode, ProviderErrorCode>> = {
  unauthorized: 'auth',
  forbidden_origin: 'permission',
  forbidden_host: 'permission',
  invalid_request: 'bad_request',
  too_large: 'too_large',
  not_found: 'not_found',
  busy: 'overloaded',
  rate_limited: 'rate_limit',
  not_logged_in: 'auth',
  cli_missing: 'not_found',
  timeout: 'timeout',
  tool_violation: 'invalid_response',
  backend_error: 'server',
  pairing_locked: 'rate_limit',
};

/** One request to the bridge or to local AI (internal to the clients). */
export interface CallOptions {
  method: 'GET' | 'POST' | 'DELETE';
  url: string;
  token?: string;
  body?: unknown;
  fetch: typeof fetch;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Message when the service cannot be reached. */
  offline?: string;
}

/** Send one JSON request; bridge-format errors become {@link ProviderError}s. */
export async function call(opts: CallOptions): Promise<unknown> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), opts.timeoutMs);
  const signal = anySignal([opts.signal, timeout.signal]);
  const headers: Record<string, string> = { accept: 'application/json' };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers['authorization'] = `Bearer ${opts.token}`;
  try {
    let res: Response;
    try {
      res = await opts.fetch(opts.url, {
        method: opts.method,
        headers,
        signal,
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      });
    } catch (e) {
      if (opts.signal?.aborted) throw new ProviderError('aborted', 'request aborted', { cause: e });
      if (timeout.signal.aborted) throw new ProviderError('timeout', `the bridge did not answer within ${Math.round(opts.timeoutMs / 1000)} s`, { cause: e, reason: 'timeout' });
      throw new ProviderError('network', opts.offline ?? 'the local bridge is not running (start it with "npm run bridge")', { cause: e, reason: 'bridge_offline' });
    }
    let text: string;
    try {
      text = await res.text();
    } catch (e) {
      if (opts.signal?.aborted) throw new ProviderError('aborted', 'request aborted', { cause: e });
      if (timeout.signal.aborted) throw new ProviderError('timeout', 'the bridge timed out', { cause: e, reason: 'timeout' });
      throw new ProviderError('network', 'connection to the bridge was lost', { cause: e, reason: 'bridge_offline' });
    }
    if (text.length > MAX_RESPONSE_CHARS) throw new ProviderError('invalid_response', 'the bridge response is too large');
    let body: unknown;
    try {
      body = text.length > 0 ? (JSON.parse(text) as unknown) : undefined;
    } catch {
      body = undefined;
    }
    if (!res.ok) {
      const err = BridgeErrorSchema.safeParse(body);
      if (err.success) {
        const { code, message } = err.data.error;
        const retry = Number(res.headers.get('retry-after'));
        throw new ProviderError(CODE_FOR[code], message, {
          status: res.status,
          reason: code,
          ...(Number.isFinite(retry) && retry > 0 ? { retryAfterMs: retry * 1000 } : {}),
        });
      }
      throw new ProviderError('server', `bridge error ${res.status}`, { status: res.status, reason: 'backend_error' });
    }
    if (body === undefined) throw new ProviderError('invalid_response', 'the bridge returned a non-JSON response');
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function requireUrl(raw: string): string {
  const url = normalizeBridgeUrl(raw);
  if (!url) throw new ProviderError('bad_request', 'the bridge address must be a local http://127.0.0.1:<port> or http://localhost:<port> URL', { reason: 'invalid_url' });
  return url;
}

/** Exchange a pairing code for a bearer token. */
export async function pairBridge(baseUrl: string, code: string, fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<string> {
  const url = requireUrl(baseUrl);
  const clean = code.trim().toUpperCase();
  const body = await call({ method: 'POST', url: `${url}/v1/pair`, body: { code: clean }, fetch: fetchImpl, timeoutMs: BRIDGE_PROBE_TIMEOUT_MS });
  const parsed = BridgePairResponseSchema.safeParse(body);
  if (!parsed.success) throw new ProviderError('invalid_response', 'the bridge returned a malformed pairing response');
  return parsed.data.token;
}

/** Read the bridge status (backends, login state, models). */
export async function fetchBridgeStatus(baseUrl: string, token: string, fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis), signal?: AbortSignal): Promise<BridgeStatus> {
  const url = requireUrl(baseUrl);
  if (!BRIDGE_TOKEN_RE.test(token)) throw new ProviderError('auth', 'not paired with the bridge', { reason: 'unauthorized' });
  const body = await call({ method: 'GET', url: `${url}/v1/status`, token, fetch: fetchImpl, timeoutMs: BRIDGE_PROBE_TIMEOUT_MS, ...(signal ? { signal } : {}) });
  const parsed = BridgeStatusSchema.safeParse(body);
  if (!parsed.success) throw new ProviderError('invalid_response', 'the bridge returned a malformed status');
  return parsed.data;
}

/** Options of {@link createBridgeProvider}. */
export interface BridgeProviderOptions {
  baseUrl: string;
  token: string;
  backend: BridgeBackendId;
  model?: string;
  effort?: BridgeEffort;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** A provider that completes through the local bridge (Codex or Claude Code). */
export function createBridgeProvider(opts: BridgeProviderOptions): Provider {
  const url = requireUrl(opts.baseUrl);
  if (!BRIDGE_TOKEN_RE.test(opts.token)) throw new ProviderError('auth', 'not paired with the bridge', { reason: 'unauthorized' });
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = Math.max(1_000, Math.min(900_000, opts.timeoutMs ?? BRIDGE_COMPLETE_TIMEOUT_MS));
  return {
    name: opts.backend,
    async complete(req: CompletionRequest, signal?: AbortSignal): Promise<CompletionResponse> {
      const body = {
        backend: opts.backend,
        ...(opts.model ? { model: opts.model } : {}),
        ...(opts.effort ? { effort: opts.effort } : {}),
        request: req,
      };
      const json = await call({ method: 'POST', url: `${url}/v1/complete`, token: opts.token, body, fetch: doFetch, timeoutMs, ...(signal ? { signal } : {}) });
      const parsed = CompletionResponseSchema.safeParse(json);
      if (!parsed.success) throw new ProviderError('invalid_response', 'the bridge returned a malformed completion');
      return parsed.data as CompletionResponse;
    },
  };
}
