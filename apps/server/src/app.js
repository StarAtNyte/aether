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
import { createClientIpResolver } from './client-ip';
import { secretValues } from './config';
import { JsonFileStore } from './file-store';
import { sendErrorPage, wantsHtmlPage } from './error-pages';
import { fail } from './http';
import { scrub, silentLogger } from './logger';
import { accessGate, ADMIN_HEADER, hostGuard, secretEquals, sessionCookie } from './local-guard';
import { accessLog, corsAllowlist, jsonBodyLimit, originGuard, rateLimit, securityHeaders } from './middleware';
import { TokenBucketLimiter } from './rate-limit';
import { createTrellisProvider } from '@aether/assets';
import { registerImageTo3dRoutes } from './routes/image-to-3d';
import { GENERATOR_HASH_RE, registerGeneratorRoutes } from './routes/generators';
import { registerLlmRoutes } from './routes/llm';
import { registerLocalRoutes } from './routes/local';
import { registerWorldRoutes, WORLD_ID_RE } from './routes/worlds';
import { registerPublishRoutes } from './routes/publish';
import { createPublishServices, MAX_BUILD_UPLOAD_BYTES } from './publish/services';
import { registerStatic } from './static';
import { DailyTokenBudget } from './token-budget';
export { MAX_BUILD_UPLOAD_BYTES } from './publish/services';
/** Per-route request body caps (bytes). */
function bodyCaps(config) {
    return {
        llm: config.llm.maxBodyBytes,
        // JSON whitespace may make the request larger than the normalized world.
        worlds: config.storage.maxWorldBytes + 64 * 1024,
        generators: config.storage.maxGeneratorBytes,
    };
}
/** Build the Aether API (and, in production, studio) HTTP application. */
export function createApp(config, deps = {}) {
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
    const app = new Hono();
    app.use('*', requestId({ limitLength: 64 }));
    app.use('*', accessLog(logger));
    app.use('*', securityHeaders(config.production));
    // Local app (`aether start`): answer only on our own address, gate LAN access, hand the studio its session cookie.
    if (config.local.allowedHosts)
        app.use('*', hostGuard(config.local.allowedHosts));
    if (config.local.accessToken)
        app.use('*', accessGate(config.local.accessToken, false));
    if (config.local.sessionSecret)
        app.use('*', sessionCookie(config.local.sessionSecret, false));
    app.use('/api/*', corsAllowlist(config.allowedOrigins));
    app.use('/api/*', originGuard(config.allowedOrigins));
    app.use('/api/*', async (c, next) => {
        c.header('Cache-Control', 'no-store');
        await next();
    });
    const llmRate = rateLimit(llmLimiter, clientIp);
    const apiRate = rateLimit(apiLimiter, clientIp);
    app.use('/api/*', async (c, next) => {
        if (c.req.path === '/api/health')
            return next();
        return c.req.path === '/api/llm' || c.req.path === '/api/local/complete' ? llmRate(c, next) : apiRate(c, next);
    });
    const generatorPutRate = rateLimit(generatorPutLimiter, clientIp);
    app.on('PUT', '/api/generators/*', generatorPutRate);
    app.use('/api/llm', jsonBodyLimit(caps.llm));
    const localLimit = jsonBodyLimit(caps.llm);
    const buildLimit = jsonBodyLimit(MAX_BUILD_UPLOAD_BYTES);
    // Build uploads are zips (large); everything else under /api/local is small JSON.
    app.use('/api/local/*', (c, next) => (c.req.path === '/api/local/publish/builds' && c.req.method === 'POST' ? buildLimit(c, next) : localLimit(c, next)));
    app.use('/api/worlds', jsonBodyLimit(caps.worlds));
    app.use('/api/worlds/*', jsonBodyLimit(caps.worlds));
    app.use('/api/generators/*', jsonBodyLimit(caps.generators));
    const providers = deps.providers ?? (llm ? [llm.provider.name] : ['mock']);
    const local = config.localAi ? (deps.local ?? null) : null;
    const secret = config.local.sessionSecret;
    const requestShutdown = deps.requestShutdown;
    if (secret && requestShutdown) {
        app.post('/api/admin/shutdown', (c) => {
            if (!secretEquals(c.req.header(ADMIN_HEADER), secret))
                return fail(c, 401, 'unauthorized', 'Only the aether command can stop the server.');
            requestShutdown();
            return c.json({ ok: true, stopping: true }, 202);
        });
    }
    const instance = config.local.instanceId;
    app.get('/api/health', (c) => c.json({ ok: true, mode: llm ? 'live' : 'mock', providers: [...providers], byok: false, local: local !== null, imageTo3d: config.imageTo3d !== null, ...(instance ? { instance } : {}) }, 200));
    if (local) {
        registerLocalRoutes(app, {
            local,
            logger,
            ...(config.local.sessionSecret ? { sessionSecret: config.local.sessionSecret } : {}),
            ...(deps.bridge ? { bridge: deps.bridge } : {}),
            ...(deps.isLoopback ? { isLoopback: deps.isLoopback } : {}),
            ...(deps.shutdownSignal ? { shutdownSignal: deps.shutdownSignal } : {}),
        });
        const services = deps.publishServices ?? createPublishServices({ dir: `${config.dataDir}/published`, playerDir: config.staticDir, now, ...deps.publish });
        registerPublishRoutes(app, { store: services.store, jobs: services.jobs, lan: services.lan, logger, maxUploadBytes: MAX_BUILD_UPLOAD_BYTES });
        deps.onPublish?.(services);
        deps.shutdownSignal?.addEventListener('abort', () => void services.dispose());
    }
    registerLlmRoutes(app, {
        llm,
        budget,
        timeoutMs: config.llm.timeoutMs,
        maxOutputTokens: config.llm.maxOutputTokens,
        logger,
        ...(deps.shutdownSignal ? { shutdownSignal: deps.shutdownSignal } : {}),
    });
    registerGeneratorRoutes(app, { store: generatorStore, validator: deps.generatorValidator ?? null, logger });
    registerWorldRoutes(app, { store: worldStore, maxWorldBytes: config.storage.maxWorldBytes });
    if (config.imageTo3d) {
        const provider = deps.imageTo3d ?? createTrellisProvider(config.imageTo3d);
        registerImageTo3dRoutes(app, { provider, logger, ...(deps.shutdownSignal ? { shutdownSignal: deps.shutdownSignal } : {}) });
    }
    if (config.serveStatic)
        registerStatic(app, config.staticDir, logger);
    app.notFound((c) => (wantsHtmlPage(c) ? sendErrorPage(c, 404) : fail(c, 404, 'not-found', 'Route not found.')));
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
        return wantsHtmlPage(c) ? sendErrorPage(c, 500) : fail(c, 500, 'internal', 'Internal server error.');
    });
    return app;
}
