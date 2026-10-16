/**
 * Shared fixtures for server tests: temp data dirs, configs, fake providers.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
/** Role → model map used by live-mode tests. */
export const TEST_MODELS = { planner: 'test-planner', coder: 'test-coder', critic: 'test-critic' };
/** Temp directories created by {@link makeConfig}; removed by {@link cleanupDirs}. */
const dirs = [];
/** Build a validated config with a fresh temp DATA_DIR. */
export function makeConfig(env = {}) {
    const dataDir = mkdtempSync(join(tmpdir(), 'aether-server-test-'));
    dirs.push(dataDir);
    return loadConfig({ AETHER_PROVIDER: 'mock', LOG_LEVEL: 'silent', DATA_DIR: dataDir, ...env });
}
/** Remove every temp dir created so far. */
export function cleanupDirs() {
    for (const d of dirs.splice(0))
        rmSync(d, { recursive: true, force: true });
}
/** Create a fake provider whose behaviour is given by `impl`. */
export function fakeProvider(impl) {
    const calls = [];
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
export function okProvider(usage = { inputTokens: 10, outputTokens: 5 }) {
    return fakeProvider(async () => ({ content: [{ type: 'text', text: 'hello' }], stopReason: 'end', usage }));
}
/** LiveLlm wrapper for a provider. */
export function live(provider) {
    return { provider, models: { ...TEST_MODELS } };
}
/** Create an app with a constant client IP (rate limit key). */
export function makeApp(config, deps = {}) {
    return createApp(config, { clientIp: () => '203.0.113.7', ...deps });
}
/** JSON request init helper. */
export function jsonInit(method, body, headers = {}) {
    return { method, body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...headers } };
}
/** Minimal valid completion request. */
export function completionBody(extra = {}) {
    return { role: 'planner', system: 'You are a test.', messages: [{ role: 'user', content: 'hi' }], ...extra };
}
/** Tiny valid base64 PNG data URL (1x1). */
export const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
