/**
 * Codex backend over `@openai/codex-sdk` (the user's ChatGPT login, no API
 * key). Every run is locked down:
 *
 * - read-only sandbox, approval policy "never", no network, web search off;
 * - shell / exec / patch / image / browser / computer-use / plugin / app /
 *   multi-agent / memory / hook features disabled via config overrides;
 * - every MCP server from the user's config disabled by name;
 * - a fresh empty working directory (deleted afterwards), no AGENTS.md;
 * - an allowlisted environment (no API keys or tokens);
 * - streamed events are watched: the first command, file change, MCP call or
 *   web search aborts the run with `tool_violation`.
 *
 * The reply is constrained with `outputSchema` (strict JSON Schema), so the
 * model can only ever return the JSON protocol text.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Codex, type CodexOptions, type ThreadEvent, type ThreadOptions, type TurnOptions, type UserInput } from '@openai/codex-sdk';
import { MODEL_ID_RE, type TextBackend, type TextCompletionRequest, type TextCompletionResult } from '@aether/agent';
import { BridgeError, classifyCliFailure } from '../errors';
import { restrictedEnv, withTempDir } from '../sandbox';

/** Thread item types that mean the agent tried to act instead of answer. */
export const FORBIDDEN_ITEM_TYPES: ReadonlySet<string> = new Set(['command_execution', 'file_change', 'mcp_tool_call', 'web_search']);

/** Codex features turned off for every bridge run. */
export const CODEX_DISABLED_FEATURES = [
  'shell_tool', 'unified_exec', 'unified_exec_tty', 'shell_snapshot', 'view_image', 'image_generation', 'multi_agent', 'multi_agent_v2',
  'apps', 'plugins', 'remote_plugin', 'plugin_sharing', 'browser_use', 'browser_use_external', 'browser_use_full_cdp_access', 'in_app_browser',
  'computer_use', 'code_mode_host', 'goals', 'memories', 'hooks', 'tool_suggest', 'sleep_tool', 'skill_search',
  'skill_mcp_dependency_install', 'workspace_dependencies', 'realtime_conversation', 'worktrees',
] as const;

/** Config overrides applied to every run (flattened to `--config` flags by the SDK). */
export function codexLockdownConfig(): NonNullable<CodexOptions['config']> {
  const features: Record<string, boolean> = {};
  for (const f of CODEX_DISABLED_FEATURES) features[f] = false;
  return {
    features,
    web_search: 'disabled',
    approval_policy: 'never',
    sandbox_mode: 'read-only',
    project_doc_max_bytes: 0,
    shell_environment_policy: { inherit: 'none' },
    history: { persistence: 'none' },
  };
}

/** Thread options of every run (exported so tests can assert the lockdown). */
export function codexThreadOptions(req: Pick<TextCompletionRequest, 'model' | 'effort'>, workingDirectory: string): ThreadOptions {
  return {
    ...(req.model ? { model: req.model } : {}),
    modelReasoningEffort: req.effort ?? 'low',
    sandboxMode: 'read-only',
    approvalPolicy: 'never',
    networkAccessEnabled: false,
    webSearchMode: 'disabled',
    workingDirectory,
    skipGitRepoCheck: true,
  };
}

const MCP_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** `--config` overrides that disable each named MCP server. Throws on names that cannot be expressed safely. */
export function mcpDisableOverrides(names: readonly string[]): string[] {
  return names.map((n) => {
    if (!MCP_NAME.test(n)) throw new BridgeError('tool_violation', 'Refused: an MCP server in your Codex config has a name the bridge cannot disable safely.');
    return `mcp_servers.${n}.enabled=false`;
  });
}

/** Structural view of the SDK used here (a fake implements it in tests). */
export interface CodexLike {
  startThread(options?: ThreadOptions): { runStreamed(input: string | UserInput[], turnOptions?: TurnOptions): Promise<{ events: AsyncGenerator<ThreadEvent> }> };
}

/** Options of {@link createCodexBackend}. */
export interface CodexBackendOptions {
  /** Absolute path of the codex binary (default: the SDK's bundled CLI). */
  codexPath?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  tmpRoot?: string;
  /** Names of MCP servers configured for the user (each is disabled per run); null = unknown → refuse. */
  mcpServers?: () => Promise<readonly string[] | null>;
  /** SDK factory (tests inject a fake). */
  createCodex?: (options: CodexOptions) => CodexLike;
}

function imageExt(mime: string): string {
  return mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : mime === 'image/gif' ? 'gif' : 'png';
}

/** Create the Codex backend. */
export function createCodexBackend(opts: CodexBackendOptions = {}): TextBackend {
  const timeoutMs = opts.timeoutMs ?? 240_000;
  const factory = opts.createCodex ?? ((o: CodexOptions): CodexLike => new Codex(o));
  return {
    name: 'Codex',
    strictSchema: true,
    async complete(req: TextCompletionRequest, signal?: AbortSignal): Promise<TextCompletionResult> {
      // The model id becomes a CLI option: never let anything flag- or TOML-like through.
      if (req.model !== undefined && !MODEL_ID_RE.test(req.model)) throw new BridgeError('invalid_request', 'Invalid model id.');
      const servers = opts.mcpServers ? await opts.mcpServers() : [];
      if (servers === null) throw new BridgeError('tool_violation', 'Refused: the bridge could not list your Codex MCP servers to disable them.');
      const overrides = mcpDisableOverrides(servers);
      return withTempDir(async (dir) => {
        let codex: CodexLike;
        try {
          codex = factory({
            ...(opts.codexPath ? { codexPathOverride: opts.codexPath } : {}),
            env: restrictedEnv(opts.env),
            config: codexLockdownConfig(),
            configOverrides: overrides,
          });
        } catch (e) {
          throw new BridgeError('cli_missing', 'The Codex CLI could not be found. Install it (npm i -g @openai/codex) and run "codex login".', { cause: e });
        }
        const input: UserInput[] = [{ type: 'text', text: `<system>\n${req.system}\n</system>\n\n${req.prompt}` }];
        for (let i = 0; i < Math.min(4, req.images.length); i++) {
          const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(req.images[i] as string);
          if (!m?.[1] || !m[2]) continue;
          const path = join(dir, `view-${i}.${imageExt(m[1])}`);
          await writeFile(path, Buffer.from(m[2], 'base64'), { mode: 0o600 });
          input.push({ type: 'local_image', path });
        }
        const ctrl = new AbortController();
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          ctrl.abort();
        }, timeoutMs);
        const onAbort = (): void => ctrl.abort();
        if (signal?.aborted) ctrl.abort();
        else signal?.addEventListener('abort', onAbort, { once: true });
        let text = '';
        let usage: { inputTokens: number; outputTokens: number } | undefined;
        let failure: string | undefined;
        let violation: string | undefined;
        try {
          const thread = codex.startThread(codexThreadOptions(req, dir));
          const { events } = await thread.runStreamed(input, { outputSchema: req.schema, signal: ctrl.signal });
          for await (const ev of events) {
            if ((ev.type === 'item.started' || ev.type === 'item.updated' || ev.type === 'item.completed') && FORBIDDEN_ITEM_TYPES.has(ev.item.type)) {
              violation = ev.item.type;
              ctrl.abort();
              break;
            }
            if (ev.type === 'item.completed' && ev.item.type === 'agent_message') text = ev.item.text;
            else if (ev.type === 'turn.completed') usage = { inputTokens: ev.usage.input_tokens + ev.usage.cached_input_tokens, outputTokens: ev.usage.output_tokens };
            else if (ev.type === 'turn.failed') failure = ev.error.message;
            else if (ev.type === 'error') failure = ev.message;
          }
        } catch (e) {
          if (violation) {
            /* reported below */
          } else if (timedOut) throw new BridgeError('timeout', `Codex did not answer within ${Math.round(timeoutMs / 1000)} s.`);
          else if (signal?.aborted) throw new BridgeError('backend_error', 'cancelled');
          else if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new BridgeError('cli_missing', 'The Codex CLI could not be started. Install it and run "codex login".');
          else throw classifyCliFailure('Codex', e instanceof Error ? e.message : String(e));
        } finally {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
        }
        if (violation) throw new BridgeError('tool_violation', `Refused: Codex tried to use a tool (${violation}); the run was stopped.`);
        if (failure) throw classifyCliFailure('Codex', failure);
        if (!text) throw new BridgeError('backend_error', 'Codex returned an empty reply.');
        return { text, ...(usage ? { usage } : {}), ...(req.model ? { model: req.model } : {}) };
      }, opts.tmpRoot);
    },
  };
}
