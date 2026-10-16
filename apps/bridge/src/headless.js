/**
 * Headless providers for Node callers (the Aether server with
 * AETHER_PROVIDER=codex|claude-code, the eval and library scripts): the same
 * locked-down backends and tool-use emulation the bridge uses, without HTTP.
 */
import { createEmulatedProvider } from '@aether/agent';
import { createClaudeCodeBackend } from './backends/claude';
import { createCodexBackend } from './backends/codex';
import { cached, listCodexMcpServers } from './backends/status';
import { which } from './which';
/** Find the CLIs: explicit paths win, then PATH. */
export function resolveCommands(opts = {}) {
    return {
        codex: opts.codexPath ? which(opts.codexPath) : which('codex'),
        claude: opts.claudePath ? which(opts.claudePath) : which('claude'),
    };
}
/** Both backends, configured with the lockdown (MCP list cached for 60 s). */
export function createHeadlessBackends(opts = {}, commands = resolveCommands(opts)) {
    const mcp = cached(() => listCodexMcpServers({ codexCommand: commands.codex, claudeCommand: null, ...(opts.env ? { env: opts.env } : {}) }), 60_000);
    return {
        // Without a codex on PATH the SDK falls back to its bundled CLI.
        codex: createCodexBackend({ ...(commands.codex ? { codexPath: commands.codex } : {}), mcpServers: mcp, ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}), ...(opts.env ? { env: opts.env } : {}), ...(opts.sessions ? { sessions: opts.sessions } : {}) }),
        'claude-code': createClaudeCodeBackend({ command: commands.claude ?? 'claude', ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}), ...(opts.env ? { env: opts.env } : {}), ...(opts.sessions ? { sessions: opts.sessions } : {}) }),
    };
}
/** A tool-calling provider over one headless backend. */
export function createHeadlessProvider(backend, opts = {}) {
    const backends = createHeadlessBackends(opts);
    return createEmulatedProvider({ backend: backends[backend], name: backend, ...(opts.model ? { model: opts.model } : {}), ...(opts.effort ? { effort: opts.effort } : {}) });
}
