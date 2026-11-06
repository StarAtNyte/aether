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
    // Platform health checks hit /api/health every few seconds: keep them out of info-level logs.
    else if (fields.path === '/api/health') logger.debug('request', fields);
    else logger.info('request', fields);
  };
}

/** CORS for `/api/*`: only allowlisted origins get `Access-Control-Allow-Origin`. */
export function corsAllowlist(allowedOrigins: readonly string[]): MiddlewareHandler<AppEnv> {
  const allowed = new Set(allowedOrigins);
  return cors({
    origin: (origin) => (allowed.has(origin) ? origin : null),
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'X-Request-Id', 'X-Edit-Token'],
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

/**
 * Where the asset hub's thumbnails come from (the same Hugging Face hosts a dataset file redirects to). The studio fetches the hub's
 * index and models with GET from these hosts (connect-src above) and shows thumbnails from them. The player gets none of this:
 * a game embeds the hub models it uses, so a published page never talks to Hugging Face.
 */
export const HUB_IMAGE_HOSTS: readonly string[] = Object.freeze(WEBLLM_HOSTS.filter((h) => h.includes('huggingface.co') || h.includes('hf.co')));

/**
 * Hugging Face's file CDN: a dataset file (`/resolve/<rev>/…`) answers with a redirect to a host under `cdn.hf.co`
 * (`us.aws.cdn.hf.co`; listed host by host: the policy has no wildcards). The studio streams Amazon Berkeley Objects products from there; the asset
 * hub's files redirect there too. Published games embed the products they use.
 */
export const HF_CDN_HOSTS: readonly string[] = Object.freeze(['https://us.aws.cdn.hf.co']);

/** CDN that serves the library files a lean studio build does not ship (a pinned GitHub commit, see scripts/vite/asset-library.ts). */
export const LIBRARY_CDN_HOSTS: readonly string[] = Object.freeze(['https://cdn.jsdelivr.net']);

/**
 * Model APIs the studio calls straight from the browser with the user's own
 * key (bring your own key): Anthropic, OpenAI, OpenRouter, Google Gemini.
 * Must equal `BYOK_ORIGINS` of the studio's provider catalog (a test checks it).
 */
export const BYOK_API_HOSTS: readonly string[] = Object.freeze(['https://api.anthropic.com', 'https://api.openai.com', 'https://openrouter.ai', 'https://generativelanguage.googleapis.com']);

/** Content-Security-Policy directives for the studio and API responses. */
export const CSP_DIRECTIVES = Object.freeze({
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
  workerSrc: ["'self'", 'blob:'],
  imgSrc: ["'self'", 'data:', 'blob:', ...HUB_IMAGE_HOSTS, ...HF_CDN_HOSTS],
  // Exported videos and music previews play from blob: URLs.
  mediaSrc: ["'self'", 'blob:'],
  // blob:/data: so locally imported glTF models (blob URLs, data URIs) can be fetched.
  // Loopback (any port): the visitor's own Aether Bridge (token-paired, see apps/bridge) — the only wildcard.
  // The explicit hosts serve the opt-in on-device model (WebLLM weights and model libraries)
  // and the model APIs a user's own key is sent to (never to Aether's server).
  connectSrc: ["'self'", 'blob:', 'data:', 'http://127.0.0.1:*', 'http://localhost:*', ...BYOK_API_HOSTS, ...WEBLLM_HOSTS, ...HF_CDN_HOSTS, ...LIBRARY_CDN_HOSTS],
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
 * The Basis Universal transcoder worker (KTX2 textures; `public/basis/ktx2-worker.js`): the transcoder's
 * Emscripten embind glue builds its bindings with `new Function`, so the worker needs `'unsafe-eval'`. It
 * gets the same sealed policy as the sandbox worker (no network, no nested workers: its WebAssembly binary
 * arrives by message); the page itself keeps the strict policy.
 */
export const TRANSCODER_WORKER_CSP = "default-src 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'";
/** Served path of the transcoder worker (studio, or a build in the local library of published games). */
export const TRANSCODER_WORKER_PATH = /^(\/published\/[a-z0-9]{12})?\/basis\/ktx2-worker\.js$/;

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

/**
 * Hosts the player reads templates' cooked packages from (`/play#t=<slug>`): the dataset's `resolve` URLs on
 * huggingface.co (a manifest answers with a same-host redirect) and the CDN its packs redirect to. GET only, no
 * credentials; a failure loads the world live.
 */
export const COOKED_HOSTS: readonly string[] = Object.freeze(['https://huggingface.co', ...HF_CDN_HOSTS]);

/**
 * Content-Security-Policy of the standalone player (`/play`): the same strict
 * script policy as the studio, no AI host and no bridge (the player talks to
 * neither), only the cooked-package hosts above in `connect-src`, and
 * embeddable in other sites (`frame-ancestors *`), so a published game can be
 * put in an `<iframe>`. It runs no editor and holds no keys. A downloaded
 * build (publish/gameBuild.ts) keeps its own policy with no third-party host.
 */
export const PLAY_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' blob: data: https://huggingface.co https://us.aws.cdn.hf.co; style-src 'self' 'unsafe-inline'; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors *";
/**
 * Content-Security-Policy of a published build (the local library's `/published/<id>/…`, a build served on the LAN): the
 * player's policy with no third-party host at all, as a downloaded build's own (publish/gameBuild.ts). A build ships its
 * cooked package (if any) beside its page.
 */
export const BUILD_PLAY_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors *";
/** Paths of the player page (the static `play.html` and its clean URL). */
export const PLAY_PATH = /^\/play(\.html)?$/;
/** Paths of builds in the local library of published games (`/published/<id>/…`). */
export const PUBLISHED_PATH = /^\/published\/[a-z0-9]{12}(\/.*)?$/;

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
    if (TRANSCODER_WORKER_PATH.test(c.req.path)) c.res.headers.set('Content-Security-Policy', TRANSCODER_WORKER_CSP);
    else if (PLAY_PATH.test(c.req.path) || (PUBLISHED_PATH.test(c.req.path) && !/\/sandbox\.worker-[A-Za-z0-9_-]{4,32}\.js$/.test(c.req.path))) {
      c.res.headers.set('Content-Security-Policy', PLAY_PATH.test(c.req.path) ? PLAY_CSP : BUILD_PLAY_CSP);
      // Embeddable: the frame policy lives in frame-ancestors.
      c.res.headers.delete('X-Frame-Options');
      c.res.headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
      c.res.headers.set('Referrer-Policy', 'no-referrer');
    } else if (PUBLISHED_PATH.test(c.req.path)) c.res.headers.set('Content-Security-Policy', SANDBOX_WORKER_CSP);
    else if (SANDBOX_WORKER_PATH.test(c.req.path)) c.res.headers.set('Content-Security-Policy', SANDBOX_WORKER_CSP);
    else if (VERIFY_WORKER_PATH.test(c.req.path)) c.res.headers.set('Content-Security-Policy', VERIFY_WORKER_CSP);
    else if (DAG_WORKER_PATH.test(c.req.path)) c.res.headers.set('Content-Security-Policy', DAG_WORKER_CSP);
  };
}
