/**
 * Provider for the live test scripts (eval-photo, eval-design, eval-agent, brief-probe, bench, ...).
 *
 * The scripts' tests run on an Anthropic API key, not on a Codex or Claude Code login: the key is read from
 * `AETHER_ANTHROPIC_API_KEY` or from the private file `~/.config/aether/anthropic.key` (mode 600, outside the
 * repo) and is never printed or logged. The `backend` argument of the scripts is kept for their command lines but
 * is ignored: the CLI backends are used only when `AETHER_ALLOW_CLI=1` is set on purpose.
 * Not used by the studio or the bridge (the product keeps its own connections).
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createAnthropicProvider, type BridgeBackendId, type BridgeEffort, type Provider } from '@aether/agent';
import { createHeadlessProvider as createCliProvider } from '../../apps/bridge/src/headless';

type HeadlessOpts = Parameters<typeof createCliProvider>[1];

const KEY_FILE = join(homedir(), '.config', 'aether', 'anthropic.key');
const DEFAULT_MODEL = 'claude-opus-5-5';

function readKey(): string {
  const env = process.env['AETHER_ANTHROPIC_API_KEY']?.trim();
  if (env) return env;
  if (!existsSync(KEY_FILE)) throw new Error(`No Anthropic API key: set AETHER_ANTHROPIC_API_KEY or put the key in ${KEY_FILE} (mode 600).`);
  const mode = statSync(KEY_FILE).mode & 0o077;
  if (mode !== 0) throw new Error(`${KEY_FILE} is readable by other users: run chmod 600 on it.`);
  const key = readFileSync(KEY_FILE, 'utf8').trim();
  if (!key) throw new Error(`${KEY_FILE} is empty.`);
  return key;
}

/** Same call as the bridge's `createHeadlessProvider`, answered by the Anthropic API unless CLI use is explicitly allowed. */
export function createHeadlessProvider(backend: BridgeBackendId, opts: NonNullable<HeadlessOpts> & { model?: string; effort?: BridgeEffort } = {}): Provider {
  if (process.env['AETHER_ALLOW_CLI'] === '1') {
    // Long generation turns on a big world can outlast the CLI's default answer window: AETHER_CLI_TIMEOUT_MS widens it.
    const t = Number(process.env['AETHER_CLI_TIMEOUT_MS']);
    return createCliProvider(backend, Number.isFinite(t) && t > 0 && !opts.timeoutMs ? { ...opts, timeoutMs: t } : opts);
  }
  const model = opts.model ?? process.env['AETHER_LIVE_MODEL'] ?? DEFAULT_MODEL;
  const effort = opts.effort === 'low' || opts.effort === 'medium' || opts.effort === 'high' ? opts.effort : 'medium';
  return createAnthropicProvider({
    apiKey: readKey(),
    models: { planner: model, coder: model, critic: model },
    effort: { planner: effort, coder: effort, critic: effort },
    defaultMaxTokens: 16_000,
  });
}
