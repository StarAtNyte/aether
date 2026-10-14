/**
 * Agentic worker mode: a coding agent (Codex or Claude Code, the user's own
 * sign-in) iterates in a throwaway workspace — write the artifact, run the
 * checker, look at the preview image, fix — for a bounded number of rounds.
 *
 * Lockdown:
 * - Codex: sandbox "workspace-write" (writes only inside the workspace),
 *   network off, web search off, approval "never", every MCP server and every
 *   feature except the shell and image viewing disabled, a core-only shell
 *   environment (no secrets), any MCP or web call aborts the run;
 * - Claude Code: `--restricted` with only Read / Write / Edit / Bash, Bash
 *   allowed for `node check.mjs` only, no MCP / settings / plugins, nothing
 *   may ask for permission; any other tool, a Bash command other than the
 *   checker, or a file outside the workspace kills the run.
 *
 * Nothing the agent says is trusted: the parent reads only the artifact file
 * and validates it with its own sandbox.
 */
import { constants } from 'node:fs';
import { lstat, mkdtemp, open, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { Codex, type CodexOptions, type ThreadEvent, type ThreadOptions } from '@openai/codex-sdk';
import { CODEX_DISABLED_FEATURES, mcpDisableOverrides } from '../backends/codex';
import { CLAUDE_DEFAULT_MODEL } from '../backends/claude';
import { listCodexMcpServers } from '../backends/status';
import { BridgeError, classifyCliFailure } from '../errors';
import { runProcess } from '../process';
import { restrictedEnv } from '../sandbox';
import { which } from '../which';
import { sdkExecutable } from '../spawn-plan';
import { bundledCheckScript } from './workspace';
import type { WorkerJob, WorkerResult } from './protocol';

type AgenticJob = Extract<WorkerJob, { kind: 'agentic' }>;

/** Collaborators of {@link runAgentic} (injectable for tests). */
export interface AgenticDeps {
  env: NodeJS.ProcessEnv;
  progress: (phase: string, message: string) => void;
  /** Codex SDK factory (tests inject a fake). */
  createCodex?: (options: CodexOptions) => { startThread(options?: ThreadOptions): { runStreamed(input: string, turn?: { signal?: AbortSignal }): Promise<{ events: AsyncGenerator<ThreadEvent> }> } };
  /** Runs the checker; default `node check.mjs <artifact>` in the workspace. */
  check?: (workspace: string, artifact: string) => Promise<{ passed: boolean; report: string }>;
  claudeCommand?: string | null;
  /** Codex MCP server names to disable (default: `codex mcp list`); null refuses the run. */
  mcpServers?: () => Promise<string[] | null>;
}

/** Features that stay ON for agentic Codex runs (the agent must run the checker and look at the preview). */
export const CODEX_AGENTIC_FEATURES: ReadonlySet<string> = new Set(['shell_tool', 'unified_exec', 'view_image', 'code_mode_host']);

/** Codex config overrides of an agentic run. */
export function codexAgenticConfig(): NonNullable<CodexOptions['config']> {
  const features: Record<string, boolean> = {};
  for (const f of CODEX_DISABLED_FEATURES) if (!CODEX_AGENTIC_FEATURES.has(f)) features[f] = false;
  return {
    features,
    web_search: 'disabled',
    approval_policy: 'never',
    sandbox_mode: 'workspace-write',
    sandbox_workspace_write: { network_access: false },
    project_doc_max_bytes: 0,
    // Commands see only core variables (PATH, HOME, …): no keys or tokens.
    shell_environment_policy: { inherit: 'core' },
    history: { persistence: 'none' },
    // The user's own Codex skills are not part of the task: keep their instructions out of the run.
    skills: { include_instructions: false, bundled: { enabled: false } },
  };
}

/** Thread options of an agentic Codex run. */
export function codexAgenticThread(job: Pick<AgenticJob, 'model' | 'effort' | 'workspace'>): ThreadOptions {
  return {
    ...(job.model ? { model: job.model } : {}),
    modelReasoningEffort: job.effort ?? 'medium',
    sandboxMode: 'workspace-write',
    approvalPolicy: 'never',
    networkAccessEnabled: false,
    webSearchMode: 'disabled',
    workingDirectory: job.workspace,
    skipGitRepoCheck: true,
  };
}

/** Claude Code arguments of an agentic run (exported for tests). */
export function claudeAgenticArgs(job: Pick<AgenticJob, 'model' | 'effort'>, systemFile: string): string[] {
  return [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--model', job.model ?? CLAUDE_DEFAULT_MODEL,
    '--effort', job.effort ?? 'medium',
    '--restricted',
    '--tools', 'Read,Write,Edit,Bash',
    // Writes only under out/ (the checker and the task stay as Aether wrote them); the only command is the checker.
    '--allowedTools', 'Read', 'Write(./out/**)', 'Edit(./out/**)', 'Bash(node check.mjs:*)',
    '--disallowedTools', 'WebFetch,WebSearch,Task,Agent,NotebookEdit,MultiEdit,Glob,Grep,LS,TodoWrite,KillShell,BashOutput,Skill,SlashCommand',
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--safe-mode',
    '--setting-sources', '',
    '--disable-slash-commands',
    '--permission-mode', 'dontAsk',
    '--permission-prompts', 'none',
    '--no-session-persistence',
    '--system-prompt-file', systemFile,
  ];
}

const ALLOWED_CLAUDE_TOOLS: ReadonlySet<string> = new Set(['Read', 'Write', 'Edit', 'Bash']);
const CHECK_COMMAND = /^node check\.mjs(?: [A-Za-z0-9_./-]{1,80})?$/;

/** True when `path` (absolute or relative to `root`) stays inside `root`. */
export function insideWorkspace(root: string, path: string): boolean {
  const r = resolve(root);
  const p = resolve(r, path);
  return p === r || p.startsWith(r + sep);
}

/**
 * Inspect one Claude stream-json line of an agentic run; returns a reason to
 * kill the run, and reports progress.
 */
export function observeAgenticClaude(line: string, workspace: string, report: (phase: string, message: string) => void): string | void {
  let ev: unknown;
  try {
    ev = JSON.parse(line) as unknown;
  } catch {
    return;
  }
  if (typeof ev !== 'object' || ev === null) return;
  const e = ev as Record<string, unknown>;
  if (e['type'] === 'system' && e['subtype'] === 'init') {
    const tools = Array.isArray(e['tools']) ? e['tools'].filter((t): t is string => typeof t === 'string') : [];
    const extra = tools.filter((t) => !ALLOWED_CLAUDE_TOOLS.has(t) && t !== 'StructuredOutput');
    const mcp = Array.isArray(e['mcp_servers']) ? e['mcp_servers'].length : 0;
    if (extra.length > 0 || mcp > 0) return `tools exposed: ${extra.slice(0, 5).join(', ')}${mcp > 0 ? ` +${mcp} MCP` : ''}`;
    return;
  }
  if (e['type'] !== 'assistant') return;
  const msg = e['message'];
  const content = typeof msg === 'object' && msg !== null ? (msg as { content?: unknown }).content : undefined;
  if (!Array.isArray(content)) return;
  for (const b of content) {
    if (typeof b !== 'object' || b === null) continue;
    const block = b as Record<string, unknown>;
    if (block['type'] === 'text' && typeof block['text'] === 'string' && block['text'].trim()) report('message', block['text'].trim().slice(0, 200));
    if (block['type'] !== 'tool_use') continue;
    const name = typeof block['name'] === 'string' ? block['name'] : '';
    const input = typeof block['input'] === 'object' && block['input'] !== null ? (block['input'] as Record<string, unknown>) : {};
    if (!ALLOWED_CLAUDE_TOOLS.has(name)) return `tool call: ${name.slice(0, 40)}`;
    if (name === 'Bash') {
      const cmd = typeof input['command'] === 'string' ? input['command'].trim() : '';
      if (!CHECK_COMMAND.test(cmd)) return 'a shell command other than the checker';
      report('check', 'Running checks…');
    } else {
      const path = typeof input['file_path'] === 'string' ? input['file_path'] : '';
      if (!path || !insideWorkspace(workspace, path)) return 'a file outside the workspace';
      if (name !== 'Read' && !insideWorkspace(join(workspace, 'out'), path)) return 'a file outside out/';
      if (name !== 'Read') report('write', `Writing ${basename(path).slice(0, 60)}…`);
    }
  }
}

/**
 * Node flags that confine a checker run to its workspace with the Node
 * permission model: read the workspace, write only `out/`, no child
 * processes, workers, native addons or WASI. The checker executes
 * model-written generator code in `node:vm`, which is not a security
 * boundary on its own; these flags are the boundary on the host.
 */
export function confinedNodeArgs(workspace: string, script: string, version: string = process.versions.node): string[] {
  const [major = 0, minor = 0] = version.split('.').map((n) => Number(n));
  const flag = major > 22 || (major === 22 && minor >= 13) ? '--permission' : '--experimental-permission';
  return [flag, `--allow-fs-read=${resolve(workspace)}`, `--allow-fs-read=${resolve(script)}`, `--allow-fs-write=${join(resolve(workspace), 'out')}`, '--disable-proto=throw'];
}

/**
 * Run Aether's own checker (the pristine bundle, not the workspace copy the
 * agent could have edited) on `artifact`, confined to the workspace
 * (60 s, core environment).
 */
export async function runConfinedCheck(workspace: string, artifact: string, env: NodeJS.ProcessEnv): Promise<{ passed: boolean; valid: boolean; report: string }> {
  const script = await bundledCheckScript();
  const r = await runProcess(process.execPath, [...confinedNodeArgs(workspace, script), script, artifact], { cwd: workspace, env: restrictedEnv(env), timeoutMs: 60_000, maxStdout: 256 * 1024 });
  const report = `${r.stdout}\n${r.stderr}`.trim().slice(-6000);
  return { passed: r.code === 0 && /^RESULT: PASS$/m.test(r.stdout), valid: /^VALID: yes$/m.test(r.stdout), report: report || 'The checker printed nothing.' };
}

/** Default checker between rounds. */
async function defaultCheck(workspace: string, artifact: string, env: NodeJS.ProcessEnv): Promise<{ passed: boolean; report: string }> {
  const r = await runConfinedCheck(workspace, artifact, env);
  return { passed: r.passed, report: r.report };
}

/** First line of a checker report worth showing ("RESULT: FAIL — …"). */
function headline(report: string): string {
  const issue = report.split('\n').find((l) => l.startsWith('- issue:'));
  return (issue ?? report.split('\n')[0] ?? '').replace(/^- issue:\s*/, '').slice(0, 160);
}

/** Run an agentic job to completion (bounded rounds). */
export async function runAgentic(job: AgenticJob, deps: AgenticDeps): Promise<WorkerResult> {
  const check = deps.check ?? ((ws: string, art: string) => defaultCheck(ws, art, deps.env));
  const usage = { inputTokens: 0, outputTokens: 0 };
  let message = '';
  let passed = false;
  let turn = 0;
  let next = job.task;
  // One Codex thread for the whole job: later rounds continue the same conversation.
  const codex: CodexSession = { thread: null };
  for (; turn < job.maxTurns; turn++) {
    deps.progress('turn', turn === 0 ? 'Starting the coding agent…' : `Round ${turn + 1}: fixing what the checker found…`);
    if (job.backend === 'codex') message = await codexTurn(job, next, usage, deps, codex);
    else message = await claudeTurn(job, next, usage, deps);
    deps.progress('check', 'Checking the result…');
    const r = await check(job.workspace, job.artifact);
    passed = r.passed;
    deps.progress('check', passed ? 'Checks passed' : `Checks failed: ${headline(r.report)}`);
    if (passed) {
      turn++;
      break;
    }
    next = `The checker still FAILS. Its report:\n\n${r.report}\n\nFix ${job.artifact} and run \`node check.mjs ${job.artifact}\` again until it prints RESULT: PASS.`;
  }
  return { ok: true, kind: 'agentic', turns: Math.min(turn, job.maxTurns), passed, usage, ...(job.model ? { model: job.model } : {}), ...(message ? { message: message.slice(0, 4000) } : {}) };
}

type CodexThreadRun = ReturnType<NonNullable<AgenticDeps['createCodex']>>['startThread'] extends (...a: never[]) => infer T ? T : never;
interface CodexSession {
  thread: CodexThreadRun | null;
}

async function codexTurn(job: AgenticJob, input: string, usage: { inputTokens: number; outputTokens: number }, deps: AgenticDeps, session: CodexSession): Promise<string> {
  if (!session.thread) {
    const codexPath = which('codex');
    const servers = deps.mcpServers ? await deps.mcpServers() : await listCodexMcpServers({ codexCommand: codexPath, claudeCommand: null, env: deps.env });
    if (servers === null) throw new BridgeError('tool_violation', 'Refused: the MCP servers in your Codex config could not be listed to disable them.');
    const options: CodexOptions = {
      ...(sdkExecutable(codexPath) ? { codexPathOverride: sdkExecutable(codexPath) } : {}),
      env: restrictedEnv(deps.env),
      config: codexAgenticConfig(),
      configOverrides: mcpDisableOverrides(servers),
    } as CodexOptions;
    const codex = deps.createCodex ? deps.createCodex(options) : new Codex(options);
    session.thread = codex.startThread(codexAgenticThread(job));
  }
  const thread = session.thread;
  const ctrl = new AbortController();
  let last = '';
  let lastPhase = '';
  const say = (phase: string, msg: string): void => {
    if (phase === lastPhase && phase === 'thinking') return;
    lastPhase = phase;
    deps.progress(phase, msg);
  };
  let failure: string | undefined;
  let violation: string | undefined;
  const { events } = await thread.runStreamed(input, { signal: ctrl.signal });
  for await (const ev of events) {
    if (ev.type === 'item.started' || ev.type === 'item.updated' || ev.type === 'item.completed') {
      const item = ev.item;
      if (item.type === 'mcp_tool_call' || item.type === 'web_search') {
        violation = item.type;
        ctrl.abort();
        break;
      }
      if (ev.type === 'item.started' && item.type === 'command_execution') say(/check\.mjs/.test(item.command) ? 'check' : 'command', /check\.mjs/.test(item.command) ? 'Running checks…' : 'Running a command…');
      else if (ev.type === 'item.completed' && item.type === 'file_change') say('write', `Writing ${item.changes.map((c) => basename(c.path)).slice(0, 3).join(', ').slice(0, 80)}…`);
      else if (ev.type === 'item.started' && item.type === 'reasoning') say('thinking', 'Thinking…');
      else if (ev.type === 'item.completed' && item.type === 'agent_message') {
        last = item.text;
        say('message', item.text.trim().slice(0, 200));
      }
    } else if (ev.type === 'turn.completed') {
      usage.inputTokens += ev.usage.input_tokens + ev.usage.cached_input_tokens;
      usage.outputTokens += ev.usage.output_tokens;
    } else if (ev.type === 'turn.failed') failure = ev.error.message;
    else if (ev.type === 'error') failure = ev.message;
  }
  if (violation) throw new BridgeError('tool_violation', `Refused: the coding agent tried to use ${violation}; the run was stopped.`);
  if (failure) throw classifyCliFailure('Codex', failure);
  return last;
}

async function claudeTurn(job: AgenticJob, input: string, usage: { inputTokens: number; outputTokens: number }, deps: AgenticDeps): Promise<string> {
  const command = deps.claudeCommand ?? which('claude');
  if (!command) throw new BridgeError('cli_missing', 'The Claude Code CLI ("claude") is not installed or not on PATH.');
  const sysDir = await mkdtemp(join(tmpdir(), 'aether-agentic-'));
  try {
    const systemFile = join(sysDir, 'system.txt');
    await writeFile(systemFile, 'You build one artifact file in the current folder by following the task. Use only Read, Write, Edit and `node check.mjs`. Never access anything outside the current folder.', { encoding: 'utf8', mode: 0o600 });
    let violation: string | undefined;
    let result: Record<string, unknown> | undefined;
    const r = await runProcess(command, claudeAgenticArgs(job, systemFile), {
      cwd: job.workspace,
      env: restrictedEnv(deps.env),
      timeoutMs: 900_000,
      maxStdout: 16 * 1024 * 1024,
      stdin: `${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: input }] } })}\n`,
      onLine: (line) => {
        try {
          const e = JSON.parse(line) as Record<string, unknown>;
          if (e['type'] === 'result') result = e;
        } catch {
          /* not JSON */
        }
        const reason = observeAgenticClaude(line, job.workspace, deps.progress);
        if (reason) violation = reason;
        return reason;
      },
    });
    if (r.spawnError) throw new BridgeError('cli_missing', 'Claude Code could not be started.');
    if (violation) throw new BridgeError('tool_violation', `Refused: the coding agent used ${violation}; the run was stopped.`);
    if (r.stopped === 'timeout') throw new BridgeError('timeout', 'The coding agent ran out of time.');
    if (!result || result['is_error'] === true) throw classifyCliFailure('Claude Code', `${typeof result?.['result'] === 'string' ? result['result'] : ''}\n${r.stderr}`);
    const u = typeof result['usage'] === 'object' && result['usage'] !== null ? (result['usage'] as Record<string, number>) : {};
    usage.inputTokens += (u['input_tokens'] ?? 0) + (u['cache_read_input_tokens'] ?? 0) + (u['cache_creation_input_tokens'] ?? 0);
    usage.outputTokens += u['output_tokens'] ?? 0;
    return typeof result['result'] === 'string' ? result['result'] : '';
  } finally {
    await rm(sysDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Read the artifact the agent produced (bounded); null when missing or too large. */
export async function readArtifact(workspace: string, artifact: string, maxBytes = 120 * 1024): Promise<string | null> {
  if (!insideWorkspace(workspace, artifact)) return null;
  const path = join(workspace, artifact);
  try {
    // The agent controls the folder: never follow a link it may have planted (it could point anywhere).
    const st = await lstat(path);
    if (!st.isFile() || st.size > maxBytes) return null;
    const real = await realpath(path);
    if (!insideWorkspace(await realpath(workspace), real)) return null;
    const handle = await open(real, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const text = await handle.readFile({ encoding: 'utf8' });
      return text.length > maxBytes ? null : text;
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}
