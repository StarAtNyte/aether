/**
 * Cross-cutting HTTP middleware: access logging, CORS allowlist, origin
 * check for state-changing requests, rate limiting, body limits and
 * security headers.
 */
import type { MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type { AppEnv } from './app-env';
import type { ClientIpResolver } from './client-ip';
import { fail } from './http';
import type { Logger } from './logger';
import type { TokenBucketLimiter } from './rate-limit';

/** Structured access log line per request: method, path, status, duration. Never bodies or queries. */
export function accessLog(logger: Logger): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const started = performance.now();
    await next();
    const status = c.res.status;
    const fields = {
      reqId: c.get('requestId'),
      method: c.req.method,
      path: c.req.path.slice(0, 256),
      status,
      ms: Math.round((performance.now() - started) * 10) / 10,
    };
    if (status >= 500) logger.error('request', fields);
    else if (status >= 400) logger.warn('request', fields);
    else logger.info('request', fields);
  };
}

/** CORS for `/api/*`: only allowlisted origins get `Access-Control-Allow-Origin`. */
export function corsAllowlist(allowedOrigins: readonly string[]): MiddlewareHandler<AppEnv> {
  const allowed = new Set(allowedOrigins);
  return cors({
    origin: (origin) => (allowed.has(origin) ? origin : null),
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'X-Request-Id', 'X-Edit-Token', 'X-Aether-Provider', 'X-Aether-Key'],
    exposeHeaders: ['X-Request-Id', 'Retry-After', 'RateLimit-Limit', 'RateLimit-Remaining'],
    maxAge: 600,
  });
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Defense in depth against CSRF: a state-changing request that carries an
 * `Origin` header must come from an allowlisted origin or from this host.
 * (Requests without `Origin` — curl, server-to-server — are allowed; they
 * cannot carry a victim's ambient credentials, and we use none anyway.)
 */
export function originGuard(allowedOrigins: readonly string[]): MiddlewareHandler<AppEnv> {
  const allowed = new Set(allowedOrigins);
  return async (c, next) => {
    const origin = c.req.header('origin');
    if (origin === undefined || SAFE_METHODS.has(c.req.method) || allowed.has(origin)) return next();
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    const host = c.req.header('host');
    if (originHost !== null && host !== undefined && originHost === host) return next();
    return fail(c, 403, 'origin-not-allowed', 'Cross-origin requests from this origin are not allowed.');
  };
}

/** Per-client token-bucket rate limiting; answers 429 with `Retry-After` when exhausted. */
export function rateLimit(limiter: TokenBucketLimiter, clientIp: ClientIpResolver): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.req.method === 'OPTIONS') return next();
    const decision = limiter.take(clientIp(c));
    c.header('RateLimit-Limit', String(decision.limit));
    c.header('RateLimit-Remaining', String(decision.remaining));
    if (!decision.allowed) {
      c.header('Retry-After', String(decision.retryAfterSec));
      return fail(c, 429, 'rate-limited', 'Too many requests. Please slow down.');
    }
    return next();
  };
}

/** Reject request bodies larger than `maxBytes` with a JSON 413. */
export function jsonBodyLimit(maxBytes: number): MiddlewareHandler<AppEnv> {
  return bodyLimit({
    maxSize: maxBytes,
    onError: (c) => fail(c, 413, 'payload-too-large', `Request body exceeds ${maxBytes} bytes.`),
  });
}

/** Hosts the opt-in on-device model downloads from (weights from Hugging Face, WASM model libraries from GitHub). */
export const WEBLLM_HOSTS: readonly string[] = Object.freeze([
  'https://huggingface.co',
  'https://cdn-lfs.huggingface.co',
  'https://cdn-lfs-us-1.huggingface.co',
  'https://cdn-lfs.hf.co',
  'https://cdn-lfs-us-1.hf.co',
  'https://cas-bridge.xethub.hf.co',
  'https://raw.githubusercontent.com',
]);

/** Content-Security-Policy directives for the studio and API responses. */
export const CSP_DIRECTIVES = Object.freeze({
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
  workerSrc: ["'self'", 'blob:'],
  imgSrc: ["'self'", 'data:', 'blob:'],
  // blob:/data: so locally imported glTF models (blob URLs, data URIs) can be fetched.
  // Loopback (any port): the visitor's own Aether Bridge (token-paired, see apps/bridge) — the only wildcard.
  // The explicit hosts serve the opt-in on-device model (WebLLM weights and model libraries).
  connectSrc: ["'self'", 'blob:', 'data:', 'http://127.0.0.1:*', 'http://localhost:*', ...WEBLLM_HOSTS],
  styleSrc: ["'self'", "'unsafe-inline'"],
  fontSrc: ["'self'", 'data:'],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
});

/**
 * The generator sandbox worker compiles AI-written generator source with
 * `new Function` inside its locked-down worker (see procgen's sandbox), which
 * needs `'unsafe-eval'`. Only that worker script gets it, together with a
 * policy that denies everything else (no network, no nested workers): the
 * page itself keeps the strict policy above.
 */
export const SANDBOX_WORKER_CSP = "default-src 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'";
/** Built path of the generator sandbox worker. */
export const SANDBOX_WORKER_PATH = /^\/assets\/sandbox\.worker-[A-Za-z0-9_-]{4,32}\.js$/;

/**
 * The physics verification worker runs only our own code (Rapier and the
 * QuickJS interpreter as WebAssembly); it needs no eval and no network
 * beyond fetching its own same-origin wasm and chunks, so it gets a tighter
 * policy than the page (no bridge or model hosts).
 */
export const VERIFY_WORKER_CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'";
/** Built path of the verification worker. */
export const VERIFY_WORKER_PATH = /^\/assets\/verify\.worker-[A-Za-z0-9_-]{4,32}\.js$/;

/**
 * The geometry (cluster hierarchy) worker runs only our own typed-array
 * code: no eval, no WebAssembly, no network.
 */
export const DAG_WORKER_CSP = "default-src 'none'; script-src 'self'";
/** Built path of the geometry worker. */
export const DAG_WORKER_PATH = /^\/assets\/dag\.worker-[A-Za-z0-9_-]{4,32}\.js$/;

/** Security headers: CSP, nosniff, referrer policy, COOP, frame denial, HSTS (production only). */
export function securityHeaders(production: boolean): MiddlewareHandler<AppEnv> {
  const base = secureHeaders({
    contentSecurityPolicy: { ...CSP_DIRECTIVES },
    crossOriginOpenerPolicy: 'same-origin',
    crossOriginResourcePolicy: 'same-origin',
    crossOriginEmbedderPolicy: false,
    referrerPolicy: 'strict-origin-when-cross-origin',
    xContentTypeOptions: 'nosniff',
    xFrameOptions: 'DENY',
    strictTransportSecurity: production ? 'max-age=31536000; includeSubDomains' : false,
    permissionsPolicy: { camera: [], microphone: [], geolocation: [], payment: [], usb: [] },
  });
  return async (c, next) => {
    await base(c, next);
    if (SANDBOX_WORKER_PATH.test(c.req.path)) c.res.headers.set('Content-Security-Policy', SANDBOX_WORKER_CSP);
    else if (VERIFY_WORKER_PATH.test(c.req.path)) c.res.headers.set('Content-Security-Policy', VERIFY_WORKER_CSP);
    else if (DAG_WORKER_PATH.test(c.req.path)) c.res.headers.set('Content-Security-Policy', DAG_WORKER_CSP);
  };
}
