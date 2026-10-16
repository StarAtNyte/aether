/**
 * Claude Code headless backend: spawns the user's installed `claude` CLI in
 * print mode (their subscription login, no API key) with every tool, MCP
 * server, setting source, slash command and session file disabled, inside a
 * fresh empty directory. The only thing the model can do is return JSON
 * matching our schema (`--json-schema` → `structured_output`).
 *
 * Defense in depth: the CLI's own `system/init` event lists the tools it
 * exposes; any tool other than the structured-output tool, any MCP server, or
 * any `tool_use` other than it, kills the run (`tool_violation`).
 */
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MODEL_ID_RE } from '@aether/agent';
import { BridgeError, classifyCliFailure } from '../errors';
import { runProcess } from '../process';
import { restrictedEnv, withTempDir } from '../sandbox';
import { sha256 } from '../sessions';
/** The CLI's structured-output tool (the only tool allowed to appear). */
export const STRUCTURED_OUTPUT_TOOL = 'StructuredOutput';
/** Built-in tools denied explicitly on top of `--tools ""`. */
export const CLAUDE_DENIED_TOOLS = ['Bash', 'Edit', 'Write', 'Read', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch', 'Task', 'Agent', 'TodoWrite', 'KillShell', 'BashOutput', 'Skill', 'SlashCommand'];
/** Claude Code model aliases offered in the UI (as documented by `claude --help`). */
export const CLAUDE_MODELS = [
    { id: 'haiku', label: 'Haiku (fastest)', vision: true },
    { id: 'sonnet', label: 'Sonnet', vision: true },
    { id: 'opus', label: 'Opus', vision: true },
    { id: 'fable', label: 'Fable (most capable)', vision: true },
];
/** Default model: fast enough for interactive building. */
export const CLAUDE_DEFAULT_MODEL = 'sonnet';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The exact argument list for one run (exported so tests can assert the lockdown). */
export function claudeArgs(req, systemFile, session = { mode: 'none' }) {
    // Only CLI-generated / our own UUIDs ever become an argument.
    const persistence = session.mode !== 'none' && UUID_RE.test(session.id) ? (session.mode === 'new' ? ['--session-id', session.id] : ['--resume', session.id]) : ['--no-session-persistence'];
    return [
        '-p',
        '--input-format', 'stream-json',
        '--output-format', 'stream-json',
        '--verbose',
        '--model', req.model ?? CLAUDE_DEFAULT_MODEL,
        '--effort', req.effort ?? 'low',
        // No tools at all: the built-in set is emptied and the dangerous ones are denied again.
        '--tools', '',
        '--disallowedTools', CLAUDE_DENIED_TOOLS.join(','),
        // No MCP servers, settings files, plugins, hooks, CLAUDE.md, skills or slash commands.
        '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
        '--safe-mode',
        '--setting-sources', '',
        '--disable-slash-commands',
        // Nothing may ask for or receive permission; nothing is persisted unless the conversation is resumable.
        '--permission-mode', 'dontAsk',
        '--permission-prompts', 'none',
        ...persistence,
        '--system-prompt-file', systemFile,
        '--json-schema', JSON.stringify(req.schema),
    ];
}
/** One stream-json user message with text and images. */
export function claudeInput(req) {
    const content = [{ type: 'text', text: req.prompt }];
    for (const url of req.images.slice(0, 4)) {
        const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
        if (m)
            content.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
    }
    return `${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`;
}
/**
 * Direct calls to an emulated protocol tool (e.g. `apply_patches`) tolerated
 * per run. Such a call cannot execute — the verified init event proves the CLI
 * exposes nothing but the structured-output tool, so the CLI answers "no such
 * tool" and the model retries through structured output.
 */
export const MAX_STRAY_PROTOCOL_CALLS = 3;
/**
 * Inspect one stream-json line; returns a reason to kill the run.
 *
 * Fail closed: any exposed tool other than the structured-output tool, any MCP
 * server, or any `tool_use` of another name is a violation — except a call
 * whose name is one of the request's own emulated tools (`protocolTools`) after
 * a verified init, which is a harmless model slip (bounded by
 * {@link MAX_STRAY_PROTOCOL_CALLS}).
 */
export function observeClaudeLine(line, into, protocolTools = new Set()) {
    let ev;
    try {
        ev = JSON.parse(line);
    }
    catch {
        return;
    }
    if (typeof ev !== 'object' || ev === null)
        return;
    const e = ev;
    if (e['type'] === 'system' && e['subtype'] === 'init') {
        const tools = Array.isArray(e['tools']) ? e['tools'].filter((t) => typeof t === 'string') : [];
        const extra = tools.filter((t) => t !== STRUCTURED_OUTPUT_TOOL);
        const mcp = Array.isArray(e['mcp_servers']) ? e['mcp_servers'].length : 0;
        if (extra.length > 0 || mcp > 0) {
            into.violation = `tools exposed: ${[...extra.slice(0, 5), ...(mcp > 0 ? [`${mcp} MCP server(s)`] : [])].join(', ')}`;
            return 'tools';
        }
        into.initVerified = true;
    }
    else if (e['type'] === 'assistant') {
        const msg = e['message'];
        const content = typeof msg === 'object' && msg !== null ? msg.content : undefined;
        if (Array.isArray(content)) {
            for (const b of content) {
                if (typeof b !== 'object' || b === null || b.type !== 'tool_use')
                    continue;
                const name = b.name;
                if (name === STRUCTURED_OUTPUT_TOOL)
                    continue;
                if (into.initVerified === true && typeof name === 'string' && protocolTools.has(name)) {
                    into.strayCalls = (into.strayCalls ?? 0) + 1;
                    if (into.strayCalls > MAX_STRAY_PROTOCOL_CALLS) {
                        into.stray = true;
                        return 'stray';
                    }
                    continue;
                }
                into.violation = `tool call: ${String(name).slice(0, 40)}`;
                return 'tool_use';
            }
        }
    }
    else if (e['type'] === 'rate_limit_event') {
        const info = e['rate_limit_info'];
        if (typeof info === 'object' && info !== null && info.status === 'rejected')
            into.rateLimited = true;
    }
    else if (e['type'] === 'result') {
        into.result = e;
    }
}
/**
 * The request's emulated tool names that may be tolerated as stray calls.
 * Built-in CLI tool names, MCP-style names and the structured-output tool are
 * never tolerable, whatever the (untrusted) request calls its tools.
 */
export function protocolToolSet(names) {
    const denied = new Set([...CLAUDE_DENIED_TOOLS, STRUCTURED_OUTPUT_TOOL]);
    const out = new Set();
    for (const n of (names ?? []).slice(0, 64))
        if (/^[a-z][a-z0-9_]{0,63}$/.test(n) && !denied.has(n) && !n.startsWith('mcp__'))
            out.add(n);
    return out;
}
function num(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
/** Create the Claude Code backend. */
export function createClaudeCodeBackend(opts = {}) {
    const command = opts.command ?? 'claude';
    const timeoutMs = opts.timeoutMs ?? 240_000;
    return {
        name: 'Claude Code',
        strictSchema: false,
        async complete(req, signal) {
            // The model id becomes a CLI argument: never let anything flag-like through.
            if (req.model !== undefined && !MODEL_ID_RE.test(req.model))
                throw new BridgeError('invalid_request', 'Invalid model id.');
            return withTempDir(async (dir) => {
                const systemFile = join(dir, 'system.txt');
                await writeFile(systemFile, req.system, { encoding: 'utf8', mode: 0o600 });
                const observed = { rateLimited: false };
                const protocolTools = protocolToolSet(req.toolNames);
                // Resumable conversations live in their own (empty, private) working directory: the CLI keys sessions by it.
                const session = req.session && opts.sessions ? req.session : undefined;
                const plan = session && opts.sessions ? opts.sessions.plan(session.key, 'claude-code', req.model, req.system, session.body) : { resume: null };
                let sessionArgs = { mode: 'none' };
                let cwd = dir;
                let prompt = req.prompt;
                if (session && plan.resume?.dir) {
                    sessionArgs = { mode: 'resume', id: plan.resume.id };
                    cwd = plan.resume.dir;
                    prompt = `${plan.delta.trim().length > 0 ? `${plan.delta.trim()}\n\n` : ''}${session.tail}`;
                }
                else if (session) {
                    sessionArgs = { mode: 'new', id: randomUUID() };
                    cwd = await mkdtemp(join(opts.tmpRoot ?? tmpdir(), 'aether-claude-session-'));
                }
                const run = await runProcess(command, claudeArgs(req, systemFile, sessionArgs), {
                    cwd,
                    env: restrictedEnv(opts.env),
                    timeoutMs,
                    stdin: claudeInput({ ...req, prompt }),
                    onLine: (line) => observeClaudeLine(line, observed, protocolTools),
                    ...(signal ? { signal } : {}),
                    ...(opts.spawn ? { spawn: opts.spawn } : {}),
                });
                try {
                    if (run.spawnError) {
                        if (run.spawnError.code === 'ENOENT')
                            throw new BridgeError('cli_missing', 'The Claude Code CLI ("claude") is not installed or not on PATH.');
                        throw new BridgeError('backend_error', 'Claude Code could not be started.');
                    }
                    if (run.stopped === 'aborted')
                        throw new BridgeError('backend_error', 'cancelled');
                    if (run.stopped === 'timeout')
                        throw new BridgeError('timeout', `Claude Code did not answer within ${Math.round(timeoutMs / 1000)} s.`);
                    if (observed.violation)
                        throw new BridgeError('tool_violation', `Refused: the Claude Code run exposed or used a tool (${observed.violation}).`);
                    if (observed.stray)
                        throw new BridgeError('backend_error', 'Claude Code kept calling tools directly instead of replying with JSON. Try again or pick another model.');
                    if (run.stopped === 'stdout_cap')
                        throw new BridgeError('backend_error', 'Claude Code produced too much output.');
                    const res = observed.result;
                    if (observed.rateLimited && (!res || res['is_error'] === true))
                        throw new BridgeError('rate_limited', "Claude Code reports that your subscription's usage limit is reached. Try again later.", { retryAfterSec: 60 });
                    if (!res || res['is_error'] === true || run.code !== 0) {
                        const text = `${typeof res?.['result'] === 'string' ? res['result'] : ''}\n${String(res?.['api_error_status'] ?? '')}\n${run.stderr}`;
                        throw classifyCliFailure('Claude Code', text);
                    }
                    if (session && sessionArgs.mode !== 'none')
                        opts.sessions?.record(session.key, 'claude-code', req.model, { id: sessionArgs.id, systemHash: sha256(req.system), body: session.body, dir: cwd });
                    const usage = typeof res['usage'] === 'object' && res['usage'] !== null ? res['usage'] : {};
                    const modelUsage = typeof res['modelUsage'] === 'object' && res['modelUsage'] !== null ? Object.keys(res['modelUsage']) : [];
                    return {
                        text: typeof res['result'] === 'string' ? res['result'] : '',
                        ...(res['structured_output'] !== undefined && res['structured_output'] !== null ? { structured: res['structured_output'] } : {}),
                        usage: { inputTokens: num(usage['input_tokens']) + num(usage['cache_creation_input_tokens']) + num(usage['cache_read_input_tokens']), outputTokens: num(usage['output_tokens']) },
                        ...(modelUsage[0] ? { model: modelUsage[0].slice(0, 64) } : {}),
                        ...(sessionArgs.mode === 'resume' ? { resumed: true } : {}),
                    };
                }
                catch (e) {
                    // A failed run must not leave a half-made conversation behind.
                    if (sessionArgs.mode === 'new')
                        await rm(cwd, { recursive: true, force: true }).catch(() => undefined);
                    else if (sessionArgs.mode === 'resume' && session)
                        opts.sessions?.forget(session.key, 'claude-code', req.model);
                    throw e;
                }
            }, opts.tmpRoot);
        },
    };
}
