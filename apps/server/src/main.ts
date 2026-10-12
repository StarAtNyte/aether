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
import { createLogger } from './logger';
import type { LiveLlm } from './routes/llm';

/** Hard deadline for draining in-flight requests on shutdown. */
const SHUTDOWN_GRACE_MS = 10_000;

async function main(): Promise<void> {
  loadEnvFile(resolve(REPO_ROOT, '.env'));
  const config = loadConfig(process.env);
  const logger = createLogger({ level: config.logLevel, secrets: secretValues(config) });

  const plan = planProviders(config);
  const llm: LiveLlm | null = plan.active ? { provider: createLiveProvider(plan.active), models: plan.active.models } : null;
  const generatorValidator = config.generators.validate
    ? await loadSandboxValidator(logger, config.generators.timeoutMs, { maxQueue: config.generators.maxQueue })
    : null;

  const shutdown = new AbortController();
  const app = createApp(config, {
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
}

main().catch((err: unknown) => {
  const message = err instanceof ConfigError ? err.message : err instanceof Error ? `${err.name}: ${err.message}` : 'unknown startup failure';
  process.stderr.write(`${JSON.stringify({ level: 'error', msg: 'startup failed', error: message })}\n`);
  process.exit(1);
});
