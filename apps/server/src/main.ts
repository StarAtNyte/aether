/**
 * Process bootstrap: load `.env`, validate config, pick the LLM provider,
 * build the app and listen. Handles graceful shutdown on SIGTERM/SIGINT.
 *
 * Run with `npm run start -w @aether/server` (or `dev` for watch mode).
 */
import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { ConfigError, REPO_ROOT, loadConfig, redactConfig, secretValues } from './config';
import { loadEnvFile } from './env-file';
import { loadSandboxValidator } from './generator-validation';
import { createLiveProvider } from './llm/providers';
import { planProviders } from './llm/provider-plan';
import { createRotatingSink } from './log-file';
import { createLogger } from './logger';
import type { LiveLlm } from './routes/llm';
import type { LocalBridgeInfo } from './routes/local';
import { bridgePublish, createPublishServices } from './publish/services';
import { LocalAi, parseBridgeConfig, startBridge, type RunningBridge } from '@aether/bridge';

/** Hard deadline for draining in-flight requests on shutdown. */
const SHUTDOWN_GRACE_MS = 10_000;

async function main(): Promise<void> {
  loadEnvFile(resolve(REPO_ROOT, '.env'));
  const config = loadConfig(process.env);
  const sink = config.local.logFile ? createRotatingSink(config.local.logFile) : undefined;
  const logger = createLogger({ level: config.logLevel, secrets: secretValues(config), ...(sink ? { sink } : {}) });

  const plan = planProviders(config);
  const llm: LiveLlm | null = plan.active ? { provider: await createLiveProvider(plan.active), models: plan.active.models } : null;
  const generatorValidator = config.generators.validate
    ? await loadSandboxValidator(logger, config.generators.timeoutMs, { maxQueue: config.generators.maxQueue })
    : null;

  // Local AI (the machine owner's signed-in CLIs): never on hosted deployments (see config.localAi).
  const local = config.localAi ? new LocalAi({ dataDir: resolve(config.dataDir, 'local-ai') }) : null;
  if (local) await local.init();

  // Publishing to the user's own hosting and the local network (local app only), shared by the
  // studio's same-origin routes and the bridge of hosted copies.
  const publish = local ? createPublishServices({ dir: resolve(config.dataDir, 'published'), playerDir: config.staticDir }) : null;

  // Optional bridge for hosted copies of the studio (same process, 127.0.0.1 only, token-paired).
  let bridge: RunningBridge | null = null;
  let bridgeInfo: LocalBridgeInfo | undefined;
  if (local && config.local.bridge) {
    const bridgeConfig = parseBridgeConfig(['--port', String(config.local.bridge.port), ...config.local.bridge.origins.flatMap((o) => ['--origin', o])], {});
    bridge = await startBridge(bridgeConfig, { logger: { info: (msg) => logger.info(`bridge: ${msg}`), warn: (msg) => logger.warn(`bridge: ${msg}`) }, ...(publish ? { publish: bridgePublish(publish) } : {}) });
    const running = bridge;
    bridgeInfo = { url: running.url, origins: config.local.bridge.origins, code: () => running.pairing.currentCode, issue: () => running.pairing.issue() };
    logger.info('bridge listening', { url: running.url, origins: config.local.bridge.origins.join(',') });
  }

  const shutdown = new AbortController();
  // `aether stop` asks for a graceful shutdown over HTTP (signals are not graceful on Windows).
  const stopRef: { current: ((signal: string) => void) | null } = { current: null };
  const app = createApp(config, {
    requestShutdown: () => setImmediate(() => stopRef.current?.('aether stop')),
    local,
    ...(bridgeInfo ? { bridge: bridgeInfo } : {}),
    ...(publish ? { publishServices: publish } : {}),
    logger,
    llm,
    providers: plan.mode === 'live' ? plan.available : ['mock'],
    generatorValidator,
    shutdownSignal: shutdown.signal,
  });

  const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
    logger.info('server listening', {
      address: info.address,
      port: info.port,
      mode: plan.mode,
      provider: plan.active?.name ?? 'mock',
      serveStatic: config.serveStatic,
      generatorValidation: generatorValidator !== null,
      localAi: local !== null,
    });
  });
  logger.debug('config', { config: JSON.stringify(redactConfig(config)) });

  let stopping = false;
  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    logger.info('shutting down', { signal });
    shutdown.abort();
    void generatorValidator?.dispose();
    void bridge?.close();
    void publish?.dispose();
    local?.dispose();
    const force = setTimeout(() => {
      logger.warn('forced exit after grace period');
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    force.unref();
    server.close((err) => {
      if (err) logger.error('error while closing server', { error: err.message });
      process.exit(err ? 1 : 0);
    });
    if ('closeIdleConnections' in server && typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
  };
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('SIGINT', () => stop('SIGINT'));
  if (process.platform === 'win32') process.once('SIGBREAK', () => stop('SIGBREAK'));
  stopRef.current = stop;
}

main().catch((err: unknown) => {
  const message = err instanceof ConfigError ? err.message : err instanceof Error ? `${err.name}: ${err.message}` : 'unknown startup failure';
  process.stderr.write(`${JSON.stringify({ level: 'error', msg: 'startup failed', error: message })}\n`);
  process.exit(1);
});
