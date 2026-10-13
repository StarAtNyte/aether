/**
 * HTTP application construction (no process side effects).
 *
 * `createApp(config, deps)` wires middleware and routes into a Hono app that
 * tests drive with `app.request()`; `main.ts` binds it to a socket. Every
 * external effect (LLM provider, clock, client-IP resolution, generator
 * sandbox) is injected so tests run offline and deterministically.
 */
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requestId } from 'hono/request-id';
import type { AppEnv } from './app-env';
import { createClientIpResolver, type ClientIpResolver } from './client-ip';
import { secretValues, type ServerConfig } from './config';
import { JsonFileStore } from './file-store';
import type { GeneratorValidator } from './generator-validation';
import { fail } from './http';
import { scrub, silentLogger, type Logger } from './logger';
import { accessLog, corsAllowlist, jsonBodyLimit, originGuard, rateLimit, securityHeaders } from './middleware';
import { TokenBucketLimiter } from './rate-limit';
import { GENERATOR_HASH_RE, registerGeneratorRoutes } from './routes/generators';
import { registerByokRoutes } from './routes/byok';
import { registerLlmRoutes, type LiveLlm } from './routes/llm';
import { registerWorldRoutes, WORLD_ID_RE } from './routes/worlds';
import { registerStatic } from './static';
import { DailyTokenBudget } from './token-budget';

/** Injectable collaborators of the app. All optional; defaults are production-safe. */
export interface AppDeps {
  logger?: Logger;
  /** Live upstream LLM; `null`/absent means mock mode (`/api/llm` answers 503). */
  llm?: LiveLlm | null;
  /** Provider names reported by `/api/health` (defaults to the live provider's name, or `['mock']`). */
  providers?: readonly string[];
  /** Sandbox check for uploaded generators; `null`/absent skips execution checks. */
  generatorValidator?: GeneratorValidator | null;
  /** Client key for rate limiting (defaults to trusted-proxy-aware IP resolution). */
  clientIp?: ClientIpResolver;
  /** Clock in ms (rate limiter and token budget). */
  now?: () => number;
  /** Aborted when the process starts shutting down (cancels in-flight upstream calls). */
  shutdownSignal?: AbortSignal;
  /** Upstream fetch for bring-your-own-key calls (tests inject a fake). */
  byokFetch?: typeof fetch;
}

/** Per-route request body caps (bytes). */
function bodyCaps(config: ServerConfig): { llm: number; worlds: number; generators: number } {
  return {
    llm: config.llm.maxBodyBytes,
    // JSON whitespace may make the request larger than the normalized world.
    worlds: config.storage.maxWorldBytes + 64 * 1024,
    generators: config.storage.maxGeneratorBytes,
  };
}

/** Build the Aether API (and, in production, studio) HTTP application. */
export function createApp(config: ServerConfig, deps: AppDeps = {}): Hono<AppEnv> {
  const logger = deps.logger ?? silentLogger;
  const now = deps.now ?? Date.now;
  const llm = deps.llm ?? null;
  const clientIp = deps.clientIp ?? createClientIpResolver(config.trustProxyHops);
  const secrets = secretValues(config);
  const caps = bodyCaps(config);

  const llmLimiter = new TokenBucketLimiter({ perMinute: config.rateLimit.llmPerMinute, burst: config.rateLimit.llmBurst, now });
  const apiLimiter = new TokenBucketLimiter({ perMinute: config.rateLimit.apiPerMinute, burst: config.rateLimit.apiBurst, now });
  const generatorPutLimiter = new TokenBucketLimiter({
    perMinute: config.rateLimit.generatorPutPerMinute,
    burst: config.rateLimit.generatorPutBurst,
    now,
  });
  const budget = new DailyTokenBudget(config.llm.dailyTokenBudget, now);
  const generatorStore = new JsonFileStore({
    dir: `${config.dataDir}/generators`,
    keyPattern: GENERATOR_HASH_RE,
    maxEntries: config.storage.maxGenerators,
    maxBytes: config.storage.maxGeneratorBytes,
  });
  const worldStore = new JsonFileStore({
    dir: `${config.dataDir}/worlds`,
    keyPattern: WORLD_ID_RE,
    maxEntries: config.storage.maxWorlds,
    maxBytes: config.storage.maxWorldBytes + 4096,
  });

  const app = new Hono<AppEnv>();

  app.use('*', requestId({ limitLength: 64 }));
  app.use('*', accessLog(logger));
  app.use('*', securityHeaders(config.production));

  app.use('/api/*', corsAllowlist(config.allowedOrigins));
  app.use('/api/*', originGuard(config.allowedOrigins));
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  });
  const llmRate = rateLimit(llmLimiter, clientIp);
  const apiRate = rateLimit(apiLimiter, clientIp);
  app.use('/api/*', async (c, next) => {
    if (c.req.path === '/api/health') return next();
    return c.req.path === '/api/llm' || c.req.path === '/api/llm/byok' ? llmRate(c, next) : apiRate(c, next);
  });
  const generatorPutRate = rateLimit(generatorPutLimiter, clientIp);
  app.on('PUT', '/api/generators/*', generatorPutRate);
  app.use('/api/llm', jsonBodyLimit(caps.llm));
  app.use('/api/llm/byok', jsonBodyLimit(caps.llm));
  app.use('/api/worlds', jsonBodyLimit(caps.worlds));
  app.use('/api/worlds/*', jsonBodyLimit(caps.worlds));
  app.use('/api/generators/*', jsonBodyLimit(caps.generators));

  const providers = deps.providers ?? (llm ? [llm.provider.name] : ['mock']);
  app.get('/api/health', (c) => c.json({ ok: true, mode: llm ? 'live' : 'mock', providers: [...providers], byok: config.byok }, 200));

  registerLlmRoutes(app, {
    llm,
    budget,
    timeoutMs: config.llm.timeoutMs,
    maxOutputTokens: config.llm.maxOutputTokens,
    logger,
    ...(deps.shutdownSignal ? { shutdownSignal: deps.shutdownSignal } : {}),
  });
  registerByokRoutes(app, {
    enabled: config.byok,
    models: { anthropic: { ...config.models.anthropic }, openai: { ...config.models.openai } },
    timeoutMs: config.llm.timeoutMs,
    maxOutputTokens: config.llm.maxOutputTokens,
    logger,
    ...(deps.byokFetch ? { fetch: deps.byokFetch } : {}),
    ...(deps.shutdownSignal ? { shutdownSignal: deps.shutdownSignal } : {}),
  });
  registerGeneratorRoutes(app, { store: generatorStore, validator: deps.generatorValidator ?? null, logger });
  registerWorldRoutes(app, { store: worldStore, maxWorldBytes: config.storage.maxWorldBytes });

  if (config.serveStatic) registerStatic(app, config.staticDir, logger);

  app.notFound((c) => fail(c, 404, 'not-found', 'Route not found.'));
  app.onError((err, c) => {
    if (err instanceof HTTPException && err.status < 500) {
      return fail(c, err.status === 413 ? 413 : 400, err.status === 413 ? 'payload-too-large' : 'bad-request', 'The request could not be processed.');
    }
    logger.error('unhandled error', {
      reqId: c.get('requestId'),
      path: c.req.path.slice(0, 256),
      errorName: err instanceof Error ? err.name : typeof err,
      error: scrub(err instanceof Error ? err.message : String(err), secrets),
    });
    return fail(c, 500, 'internal', 'Internal server error.');
  });

  return app;
}
