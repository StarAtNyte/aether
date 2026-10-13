/**
 * The bridge's HTTP surface (node:http, no framework):
 *
 *   GET  /v1/ping       → { ok, name }                     (no token; lets the studio tell "offline" from "unpaired")
 *   POST /v1/pair       { code } → { token }
 *   GET  /v1/status     → BridgeStatus                      (bearer token)
 *   POST /v1/complete   BridgeCompleteRequest → CompletionResponse (bearer token)
 *
 * Every request must target the loopback Host (DNS-rebinding guard) and, when
 * it carries an Origin, come from an allowlisted origin. CORS and Private
 * Network Access preflights are answered for allowed origins only. Bodies
 * are size-capped while streaming, parsed and zod-validated; responses are
 * validated too. Logs carry method/path/status/timing only.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  BridgeCompleteRequestSchema,
  BridgePairRequestSchema,
  CompletionResponseSchema,
  createEmulatedProvider,
  ProviderError,
  type BridgeBackendId,
  type BridgeBackendStatus,
  type BridgeStatus,
  type CompletionResponse,
  type TextBackend,
} from '@aether/agent';
import { contentHash, ResponseCache } from './cache';
import type { BridgeConfig } from './config';
import { BridgeError } from './errors';
import type { Pairing } from './pairing';
import { JobQueue } from './queue';

/** Bridge version reported by /v1/status. */
export const BRIDGE_VERSION = '0.1.0';

/** Minimal logger (metadata only). */
export interface BridgeLogger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
}

/** Collaborators of the handler (all injectable for tests). */
export interface BridgeDeps {
  config: Pick<BridgeConfig, 'origins' | 'maxBodyBytes' | 'maxWaiting'>;
  /** The port actually bound (Host check). */
  port: () => number;
  pairing: Pairing;
  backends: Readonly<Record<BridgeBackendId, TextBackend>>;
  /** Backend availability (cached by the caller). */
  status: () => Promise<Array<Omit<BridgeBackendStatus, 'busy'>>>;
  logger?: BridgeLogger;
  now?: () => number;
}

/** Global pairing attempts per minute (on top of the per-code limit). */
const PAIR_PER_MINUTE = 20;

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'cross-origin',
};

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.headersSent) return;
  const text = JSON.stringify(body);
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers, 'content-length': String(Buffer.byteLength(text)) });
  res.end(text);
}

function sendError(res: ServerResponse, err: BridgeError, headers: Record<string, string>): void {
  const h = { ...headers };
  if (err.retryAfterSec !== undefined) h['retry-after'] = String(err.retryAfterSec);
  send(res, err.status, { error: { code: err.code, message: err.message.slice(0, 500) } }, h);
}

/** Read a body up to `max` bytes (rejects with too_large while streaming). */
function readBody(req: IncomingMessage, max: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? '0');
    if (Number.isFinite(declared) && declared > max) {
      reject(new BridgeError('too_large', `Request body exceeds ${max} bytes.`));
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    req.on('data', (c: Buffer) => {
      if (failed) return;
      size += c.length;
      if (size > max) {
        failed = true;
        reject(new BridgeError('too_large', `Request body exceeds ${max} bytes.`));
        req.resume();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!failed) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (e) => {
      if (!failed) reject(new BridgeError('invalid_request', 'Could not read the request body.', { cause: e }));
    });
  });
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BridgeError('invalid_request', 'The request body is not valid JSON.');
  }
}

function bearer(req: IncomingMessage): string | undefined {
  const h = req.headers['authorization'];
  if (typeof h !== 'string' || h.length > 200) return undefined;
  const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(h);
  return m?.[1];
}

/** Create the request handler. */
export function createBridgeHandler(deps: BridgeDeps): (req: IncomingMessage, res: ServerResponse) => void {
  const origins = new Set(deps.config.origins);
  const now = deps.now ?? Date.now;
  const queues: Record<BridgeBackendId, JobQueue> = { codex: new JobQueue(deps.config.maxWaiting), 'claude-code': new JobQueue(deps.config.maxWaiting) };
  const cache = new ResponseCache<CompletionResponse>();
  const log = deps.logger;
  let pairWindow = { start: now(), count: 0 };

  const hostAllowed = (host: string | undefined): boolean => {
    const p = deps.port();
    return host === `127.0.0.1:${p}` || host === `localhost:${p}` || host === `[::1]:${p}`;
  };

  const handle = async (req: IncomingMessage, res: ServerResponse, cors: Record<string, string>): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const route = `${req.method ?? 'GET'} ${url.pathname}`;
    if (route === 'GET /v1/ping') {
      send(res, 200, { ok: true, name: 'aether-bridge' }, cors);
      return;
    }
    if (route === 'POST /v1/pair') {
      if (now() - pairWindow.start > 60_000) pairWindow = { start: now(), count: 0 };
      if (++pairWindow.count > PAIR_PER_MINUTE) throw new BridgeError('pairing_locked', 'Too many pairing attempts. Wait a minute.', { retryAfterSec: 60 });
      const body = BridgePairRequestSchema.safeParse(parseJson(await readBody(req, 1024)));
      if (!body.success) throw new BridgeError('invalid_request', 'Send {"code": "XXXX-XXXX"}.');
      const r = deps.pairing.pair(body.data.code);
      if (!r.ok) throw new BridgeError(r.locked ? 'pairing_locked' : 'unauthorized', r.locked ? 'Too many wrong codes: the bridge printed a new pairing code.' : 'That pairing code is not valid. Check the code printed by the bridge.');
      log?.info('paired');
      send(res, 200, { token: r.token }, cors);
      return;
    }
    if (route !== 'GET /v1/status' && route !== 'POST /v1/complete') throw new BridgeError('not_found', 'Unknown endpoint.');
    if (!deps.pairing.verify(bearer(req))) throw new BridgeError('unauthorized', 'Not paired with this bridge (or it restarted). Pair again with the code it printed.');

    if (route === 'GET /v1/status') {
      const list = await deps.status();
      const status: BridgeStatus = { ok: true, name: 'aether-bridge', version: BRIDGE_VERSION, backends: list.map((b) => ({ ...b, busy: queues[b.id].size })) };
      send(res, 200, status, cors);
      return;
    }

    const parsed = BridgeCompleteRequestSchema.safeParse(parseJson(await readBody(req, deps.config.maxBodyBytes)));
    if (!parsed.success) throw new BridgeError('invalid_request', `The completion request is invalid (${parsed.error.issues[0]?.path.join('.') ?? ''}: ${parsed.error.issues[0]?.message ?? ''}).`.slice(0, 300));
    const { backend, model, effort } = parsed.data;
    // Only the validated top-level `model` may choose a model: the inner request's free-form
    // `model` field would otherwise reach the CLI's argument list / SDK options.
    const { model: _ignoredInnerModel, ...request } = parsed.data.request;
    const key = contentHash({ backend, model: model ?? null, effort: effort ?? null, request });
    const hit = cache.get(key);
    if (hit) {
      log?.info('complete', { backend, cached: true });
      send(res, 200, hit, { ...cors, 'x-aether-cache': 'hit' });
      return;
    }
    const ctrl = new AbortController();
    const onClose = (): void => {
      if (!res.writableEnded) ctrl.abort();
    };
    res.on('close', onClose);
    const started = now();
    try {
      const provider = createEmulatedProvider({ backend: deps.backends[backend], ...(model ? { model } : {}), ...(effort ? { effort } : {}) });
      const out = await queues[backend].run(() => provider.complete(request as Parameters<typeof provider.complete>[0], ctrl.signal), ctrl.signal);
      const valid = CompletionResponseSchema.safeParse(out);
      if (!valid.success) throw new BridgeError('backend_error', 'The model returned an unexpected response.');
      cache.set(key, valid.data as CompletionResponse);
      log?.info('complete', { backend, model: model ?? 'default', ms: now() - started });
      send(res, 200, valid.data, cors);
    } finally {
      res.off('close', onClose);
    }
  };

  return (req, res) => {
    const started = now();
    const origin = typeof req.headers['origin'] === 'string' ? req.headers['origin'] : undefined;
    const cors: Record<string, string> = { vary: 'Origin' };
    const finish = (status: number): void => log?.info('request', { method: req.method, path: (req.url ?? '').split('?')[0]?.slice(0, 64), status, ms: now() - started });
    res.on('finish', () => finish(res.statusCode));

    if (!hostAllowed(req.headers['host'])) {
      sendError(res, new BridgeError('forbidden_host', 'Requests must address the bridge as 127.0.0.1 or localhost.'), cors);
      return;
    }
    if (origin !== undefined) {
      if (!origins.has(origin)) {
        sendError(res, new BridgeError('forbidden_origin', `Origin ${origin.slice(0, 100)} is not allowed. Start the bridge with --origin ${origin.slice(0, 100)} to allow it.`), cors);
        return;
      }
      cors['access-control-allow-origin'] = origin;
      cors['access-control-expose-headers'] = 'retry-after, x-aether-cache';
    }
    if (req.method === 'OPTIONS') {
      if (origin === undefined) {
        sendError(res, new BridgeError('forbidden_origin', 'Preflight without an Origin.'), cors);
        return;
      }
      const headers: Record<string, string> = {
        ...cors,
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'authorization, content-type',
        'access-control-max-age': '600',
      };
      // Private Network Access (Chromium): a public page may call this loopback service.
      if (req.headers['access-control-request-private-network'] === 'true') headers['access-control-allow-private-network'] = 'true';
      res.writeHead(204, { ...headers, 'content-length': '0', 'cache-control': 'no-store' });
      res.end();
      return;
    }
    handle(req, res, cors).catch((e: unknown) => {
      let err: BridgeError;
      if (e instanceof BridgeError) err = e;
      else if (e instanceof ProviderError && e.code === 'invalid_response') err = new BridgeError('backend_error', 'The model returned an unusable reply twice. Try again or pick another model.');
      else if (e instanceof ProviderError && e.code === 'aborted') err = new BridgeError('backend_error', 'cancelled');
      else {
        log?.warn('unexpected error', { name: e instanceof Error ? e.name : typeof e });
        err = new BridgeError('backend_error', 'The bridge hit an unexpected error.');
      }
      if (err.code !== 'unauthorized' && err.code !== 'not_found') log?.warn('request failed', { code: err.code });
      sendError(res, err, cors);
    });
  };
}
