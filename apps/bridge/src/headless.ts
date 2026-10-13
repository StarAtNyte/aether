/**
 * Headless providers for Node callers (the Aether server with
 * AETHER_PROVIDER=codex|claude-code, the eval and library scripts): the same
 * locked-down backends and tool-use emulation the bridge uses, without HTTP.
 */
import { createEmulatedProvider, type BridgeBackendId, type BridgeEffort, type Provider, type TextBackend } from '@aether/agent';
import { createClaudeCodeBackend } from './backends/claude';
import { createCodexBackend } from './backends/codex';
import { cached, listCodexMcpServers } from './backends/status';
import { which } from './which';

/** Options of {@link createHeadlessBackends}. */
export interface HeadlessOptions {
  codexPath?: string | undefined;
  claudePath?: string | undefined;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

/** Resolved CLI commands (null when not installed). */
export interface ResolvedCommands {
  codex: string | null;
  claude: string | null;
}

/** Find the CLIs: explicit paths win, then PATH. */
export function resolveCommands(opts: HeadlessOptions = {}): ResolvedCommands {
  return {
    codex: opts.codexPath ? which(opts.codexPath) : which('codex'),
    claude: opts.claudePath ? which(opts.claudePath) : which('claude'),
  };
}

/** Both backends, configured with the lockdown (MCP list cached for 60 s). */
export function createHeadlessBackends(opts: HeadlessOptions = {}, commands: ResolvedCommands = resolveCommands(opts)): Record<BridgeBackendId, TextBackend> {
  const mcp = cached(() => listCodexMcpServers({ codexCommand: commands.codex, claudeCommand: null, ...(opts.env ? { env: opts.env } : {}) }), 60_000);
  return {
    // Without a codex on PATH the SDK falls back to its bundled CLI.
    codex: createCodexBackend({ ...(commands.codex ? { codexPath: commands.codex } : {}), mcpServers: mcp, ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}), ...(opts.env ? { env: opts.env } : {}) }),
    'claude-code': createClaudeCodeBackend({ command: commands.claude ?? 'claude', ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}), ...(opts.env ? { env: opts.env } : {}) }),
  };
}

/** A tool-calling provider over one headless backend. */
export function createHeadlessProvider(backend: BridgeBackendId, opts: HeadlessOptions & { model?: string; effort?: BridgeEffort } = {}): Provider {
  const backends = createHeadlessBackends(opts);
  return createEmulatedProvider({ backend: backends[backend], name: backend, ...(opts.model ? { model: opts.model } : {}), ...(opts.effort ? { effort: opts.effort } : {}) });
}
