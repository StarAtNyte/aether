/**
 * Shared fixtures for server tests: temp data dirs, configs, fake providers.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, type AppDeps } from '../src/app';
import { loadConfig, type ServerConfig } from '../src/config';
import type { CompletionRequest, LlmProvider } from '../src/llm/schema';
import type { LiveLlm } from '../src/routes/llm';

/** Role → model map used by live-mode tests. */
export const TEST_MODELS = { planner: 'test-planner', coder: 'test-coder', critic: 'test-critic' } as const;

/** Temp directories created by {@link makeConfig}; removed by {@link cleanupDirs}. */
const dirs: string[] = [];

/** Build a validated config with a fresh temp DATA_DIR. */
export function makeConfig(env: Record<string, string> = {}): ServerConfig {
  const dataDir = mkdtempSync(join(tmpdir(), 'aether-server-test-'));
  dirs.push(dataDir);
  return loadConfig({ AETHER_PROVIDER: 'mock', LOG_LEVEL: 'silent', DATA_DIR: dataDir, ...env });
}

/** Remove every temp dir created so far. */
export function cleanupDirs(): void {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
}

/** A fake upstream provider recording the requests it receives. */
export interface FakeProvider extends LlmProvider {
  calls: Array<{ req: CompletionRequest; signal: AbortSignal | undefined }>;
}

/** Create a fake provider whose behaviour is given by `impl`. */
export function fakeProvider(impl: (req: CompletionRequest, signal?: AbortSignal) => Promise<unknown>): FakeProvider {
  const calls: FakeProvider['calls'] = [];
  return {
    name: 'fake',
    calls,
    complete(req, signal) {
      calls.push({ req, signal });
      return impl(req, signal);
    },
  };
}

/** A provider that always answers with a short text completion. */
export function okProvider(usage = { inputTokens: 10, outputTokens: 5 }): FakeProvider {
  return fakeProvider(async () => ({ content: [{ type: 'text', text: 'hello' }], stopReason: 'end', usage }));
}

/** LiveLlm wrapper for a provider. */
export function live(provider: LlmProvider): LiveLlm {
  return { provider, models: { ...TEST_MODELS } };
}

/** Create an app with a constant client IP (rate limit key). */
export function makeApp(config: ServerConfig, deps: AppDeps = {}): ReturnType<typeof createApp> {
  return createApp(config, { clientIp: () => '203.0.113.7', ...deps });
}

/** JSON request init helper. */
export function jsonInit(method: string, body: unknown, headers: Record<string, string> = {}): RequestInit {
  return { method, body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...headers } };
}

/** Minimal valid completion request. */
export function completionBody(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { role: 'planner', system: 'You are a test.', messages: [{ role: 'user', content: 'hi' }], ...extra };
}

/** Tiny valid base64 PNG data URL (1x1). */
export const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
