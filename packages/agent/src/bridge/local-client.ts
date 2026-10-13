/**
 * Clients of local AI (`/api/local/*` on an Aether server running on the
 * user's machine) and of the bridge's account endpoints (`/v1/auth/*`,
 * `/v1/sessions/*`). Every response is validated; failures become
 * {@link ProviderError}s like the bridge client's.
 */
import type { CompletionRequest, CompletionResponse, Provider } from '../types';
import { CompletionResponseSchema } from '../wire';
import { ProviderError } from '../providers/errors';
import { call, BRIDGE_COMPLETE_TIMEOUT_MS, BRIDGE_PROBE_TIMEOUT_MS } from './client';
import {
  AccountsListSchema,
  LocalJobEventSchema,
  LocalJobSchema,
  LocalStatusSchema,
  LoginStateSchema,
  JOB_ID_RE,
  PROJECT_SESSION_RE,
  type AccountsList,
  type AssetJobRequest,
  type LocalJob,
  type LocalJobEvent,
  type LocalStatus,
  type LoginState,
} from './local-protocol';
import { BRIDGE_TOKEN_RE, normalizeBridgeUrl, type BridgeBackendId, type BridgeEffort } from './protocol';
import { z } from 'zod';

/** Default base path of local AI on the Aether server. */
export const LOCAL_AI_BASE = '/api/local';
const OFFLINE = 'local AI is not available (the Aether server is not running on this computer)';
const LoginEnvelope = z.object({ login: LoginStateSchema.nullable() });
const LogoutResult = z.object({ ok: z.boolean(), message: z.string().max(300) });

function parse<T>(schema: z.ZodType<T>, body: unknown, what: string): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new ProviderError('invalid_response', `malformed ${what}`);
  return r.data;
}

/** Sign-in and conversation endpoints shared by local AI and the bridge. */
export interface AiAccountApi {
  login(backend: BridgeBackendId): Promise<LoginState>;
  loginStatus(): Promise<LoginState | null>;
  cancelLogin(): Promise<LoginState | null>;
  logout(backend: BridgeBackendId, accountId?: string): Promise<{ ok: boolean; message: string }>;
  /** Forget a project's resumable conversations. */
  clearSessions(project: string): Promise<void>;
}

/** Local AI client. */
export interface LocalAiApi extends AiAccountApi {
  readonly base: string;
  status(signal?: AbortSignal): Promise<LocalStatus>;
  accounts(): Promise<AccountsList>;
  addAccount(label: string): Promise<LoginState>;
  activateAccount(id: string): Promise<AccountsList>;
  removeAccount(id: string): Promise<AccountsList>;
  startJob(req: AssetJobRequest): Promise<LocalJob>;
  job(id: string): Promise<LocalJob>;
  cancelJob(id: string): Promise<LocalJob>;
  /**
   * Follow a job's progress until it ends: events from `after` on, over
   * server-sent events, reconnecting (with the last seen cursor) when the
   * stream drops. Resolves to the finished job.
   */
  followJob(id: string, opts: { onEvent?: (e: LocalJobEvent) => void; signal?: AbortSignal; after?: number; maxReconnects?: number }): Promise<LocalJob>;
}

/** Parse one server-sent-events block (`event:` / `data:` / `id:` lines). */
export function parseSseBlock(block: string): { event: string; data: string; id?: string } | null {
  let event = 'message';
  let id: string | undefined;
  const data: string[] = [];
  for (const raw of block.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line.startsWith(':') || line === '') continue;
    const i = line.indexOf(':');
    const field = i < 0 ? line : line.slice(0, i);
    const value = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '');
    if (field === 'event') event = value.slice(0, 32);
    else if (field === 'data') data.push(value);
    else if (field === 'id') id = value.slice(0, 16);
  }
  if (data.length === 0) return null;
  return { event, data: data.join('\n'), ...(id !== undefined ? { id } : {}) };
}

const MAX_SSE_BUFFER = 256 * 1024;

/** Create the local AI client (`base` is same-origin by default). */
export function createLocalAiApi(opts: { base?: string; fetch?: typeof fetch } = {}): LocalAiApi {
  const base = (opts.base ?? LOCAL_AI_BASE).replace(/\/+$/, '');
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const req = (method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown, timeoutMs = 15_000, signal?: AbortSignal): Promise<unknown> =>
    call({ method, url: `${base}${path}`, fetch: doFetch, timeoutMs, offline: OFFLINE, ...(body !== undefined ? { body } : {}), ...(signal ? { signal } : {}) });
  const jobPath = (id: string): string => {
    if (!JOB_ID_RE.test(id)) throw new ProviderError('bad_request', 'invalid job id');
    return `/jobs/${id}`;
  };

  const api: LocalAiApi = {
    base,
    async status(signal) {
      return parse(LocalStatusSchema, await req('GET', '/status', undefined, 25_000, signal), 'local AI status');
    },
    async login(backend) {
      return parse(LoginStateSchema, await req('POST', '/login', { backend }), 'sign-in state');
    },
    async loginStatus() {
      return parse(LoginEnvelope, await req('GET', '/login'), 'sign-in state').login;
    },
    async cancelLogin() {
      return parse(LoginEnvelope, await req('POST', '/login/cancel', {}), 'sign-in state').login;
    },
    async logout(backend, accountId) {
      return parse(LogoutResult, await req('POST', '/logout', { backend, ...(accountId ? { accountId } : {}) }, 30_000), 'sign-out result');
    },
    async clearSessions(project) {
      if (!PROJECT_SESSION_RE.test(project)) return;
      await req('DELETE', `/sessions/${project}`);
    },
    async accounts() {
      return parse(AccountsListSchema, await req('GET', '/accounts', undefined, 40_000), 'account list');
    },
    async addAccount(label) {
      return parse(LoginStateSchema, await req('POST', '/accounts', { label }), 'sign-in state');
    },
    async activateAccount(id) {
      return parse(AccountsListSchema, await req('POST', `/accounts/${encodeURIComponent(id)}/activate`, {}, 30_000), 'account list');
    },
    async removeAccount(id) {
      return parse(AccountsListSchema, await req('DELETE', `/accounts/${encodeURIComponent(id)}`, undefined, 30_000), 'account list');
    },
    async startJob(job) {
      return parse(LocalJobSchema, await req('POST', '/jobs', job), 'job');
    },
    async job(id) {
      return parse(LocalJobSchema, await req('GET', jobPath(id)), 'job');
    },
    async cancelJob(id) {
      return parse(LocalJobSchema, await req('POST', `${jobPath(id)}/cancel`, {}), 'job');
    },
    async followJob(id, o) {
      let cursor = o.after ?? 0;
      let reconnects = 0;
      const maxReconnects = o.maxReconnects ?? 20;
      for (;;) {
        if (o.signal?.aborted) throw new ProviderError('aborted', 'request aborted');
        let ended: LocalJob | null = null;
        try {
          const res = await doFetch(`${base}${jobPath(id)}/events?after=${cursor}`, { headers: { accept: 'text/event-stream' }, ...(o.signal ? { signal: o.signal } : {}) });
          if (!res.ok || !res.body) {
            if (res.status === 404) throw new ProviderError('not_found', 'the job no longer exists');
            throw new ProviderError('server', `local AI error ${res.status}`);
          }
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
            if (buf.length > MAX_SSE_BUFFER) throw new ProviderError('invalid_response', 'job event stream too large');
            let at: number;
            while ((at = buf.indexOf('\n\n')) >= 0) {
              const block = parseSseBlock(buf.slice(0, at));
              buf = buf.slice(at + 2);
              if (!block) continue;
              if (block.event === 'progress') {
                let raw: unknown;
                try {
                  raw = JSON.parse(block.data) as unknown;
                } catch {
                  continue;
                }
                const ev = LocalJobEventSchema.safeParse(raw);
                if (!ev.success || ev.data.seq <= cursor) continue;
                cursor = ev.data.seq;
                reconnects = 0;
                try {
                  o.onEvent?.(ev.data);
                } catch {
                  /* a UI listener must not break the stream */
                }
              } else if (block.event === 'end') {
                let raw: unknown = null;
                try {
                  raw = JSON.parse(block.data) as unknown;
                } catch {
                  raw = null;
                }
                ended = parse(LocalJobSchema, raw, 'job');
              }
            }
            if (ended) {
              void reader.cancel().catch(() => undefined);
              break;
            }
          }
        } catch (e) {
          if (o.signal?.aborted) throw new ProviderError('aborted', 'request aborted', { cause: e });
          if (e instanceof ProviderError && (e.code === 'not_found' || e.code === 'invalid_response')) throw e;
          if (++reconnects > maxReconnects) throw e instanceof ProviderError ? e : new ProviderError('network', 'lost the connection to local AI', { cause: e });
        }
        if (ended) return ended;
        // The stream dropped before the end: check the job, then reconnect from the cursor.
        try {
          const j = await api.job(id);
          if (j.status !== 'queued' && j.status !== 'running') {
            if (j.events > cursor) continue;
            return j;
          }
        } catch (e) {
          if (e instanceof ProviderError && e.code === 'not_found') throw e;
        }
        await new Promise((r) => setTimeout(r, Math.min(5000, 500 * 2 ** Math.min(4, reconnects))));
      }
    },
  };
  return api;
}

/** Options of {@link createLocalProvider}. */
export interface LocalProviderOptions {
  backend: BridgeBackendId;
  model?: string;
  effort?: BridgeEffort;
  base?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** A provider that completes through local AI (the server's worker processes). */
export function createLocalProvider(opts: LocalProviderOptions): Provider {
  const base = (opts.base ?? LOCAL_AI_BASE).replace(/\/+$/, '');
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = Math.max(1_000, Math.min(900_000, opts.timeoutMs ?? BRIDGE_COMPLETE_TIMEOUT_MS));
  return {
    name: `local-${opts.backend}`,
    async complete(request: CompletionRequest, signal?: AbortSignal): Promise<CompletionResponse> {
      const body = { backend: opts.backend, ...(opts.model ? { model: opts.model } : {}), ...(opts.effort ? { effort: opts.effort } : {}), request };
      const json = await call({ method: 'POST', url: `${base}/complete`, body, fetch: doFetch, timeoutMs, offline: OFFLINE, ...(signal ? { signal } : {}) });
      return parse(CompletionResponseSchema, json, 'completion') as CompletionResponse;
    },
  };
}

/** The bridge's sign-in / conversation endpoints (bearer token). */
export function createBridgeAccountApi(opts: { baseUrl: string; token: string; fetch?: typeof fetch }): AiAccountApi {
  const url = normalizeBridgeUrl(opts.baseUrl);
  if (!url) throw new ProviderError('bad_request', 'the bridge address must be a local http://127.0.0.1:<port> URL', { reason: 'invalid_url' });
  if (!BRIDGE_TOKEN_RE.test(opts.token)) throw new ProviderError('auth', 'not paired with the bridge', { reason: 'unauthorized' });
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const req = (method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown, timeoutMs = BRIDGE_PROBE_TIMEOUT_MS * 4): Promise<unknown> =>
    call({ method, url: `${url}${path}`, token: opts.token, fetch: doFetch, timeoutMs, ...(body !== undefined ? { body } : {}) });
  return {
    async login(backend) {
      return parse(LoginStateSchema, await req('POST', '/v1/auth/login', { backend }), 'sign-in state');
    },
    async loginStatus() {
      return parse(LoginEnvelope, await req('GET', '/v1/auth/login'), 'sign-in state').login;
    },
    async cancelLogin() {
      return parse(LoginEnvelope, await req('POST', '/v1/auth/login/cancel', {}), 'sign-in state').login;
    },
    async logout(backend) {
      return parse(LogoutResult, await req('POST', '/v1/auth/logout', { backend }, 30_000), 'sign-out result');
    },
    async clearSessions(project) {
      if (!PROJECT_SESSION_RE.test(project)) return;
      await req('DELETE', `/v1/sessions/${project}`);
    },
  };
}
