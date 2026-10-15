import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CodexOptions, ThreadEvent, ThreadOptions, TurnOptions, UserInput } from '@openai/codex-sdk';
import type { TextCompletionRequest } from '@aether/agent';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claudeArgs, createClaudeCodeBackend, MAX_STRAY_PROTOCOL_CALLS, protocolToolSet, STRUCTURED_OUTPUT_TOOL } from '../src/backends/claude';
import { codexLockdownConfig, createCodexBackend, CODEX_DISABLED_FEATURES, mcpDisableOverrides, type CodexLike } from '../src/backends/codex';
import { parseCodexModels, probeClaude, probeCodex } from '../src/backends/status';
import { restrictedEnv } from '../src/sandbox';
import { fakeSpawn } from './helpers';

const SECRET_ENV = { HOME: '/home/u', PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-ant-secret', OPENAI_API_KEY: 'sk-secret', CODEX_API_KEY: 'x', GITHUB_TOKEN: 'ghp', AWS_SECRET_ACCESS_KEY: 'aws', LANG: 'en_US.UTF-8' };
const REQ: TextCompletionRequest = { role: 'planner', system: 'SYS', prompt: 'PROMPT', schema: { type: 'object' }, images: ['data:image/png;base64,iVBORw0KGgo='], model: 'haiku', effort: 'low' };

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'bridge-test-'));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const ok = (structured: unknown): string[] => [
  JSON.stringify({ type: 'system', subtype: 'init', tools: [STRUCTURED_OUTPUT_TOOL], mcp_servers: [] }),
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: STRUCTURED_OUTPUT_TOOL, input: structured }] } }),
  JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(structured), structured_output: structured, usage: { input_tokens: 5, cache_read_input_tokens: 10, output_tokens: 3 }, modelUsage: { 'claude-haiku-5-5': {} } }),
];

describe('restrictedEnv', () => {
  it('passes only allowlisted variables, never secrets', () => {
    const env = restrictedEnv(SECRET_ENV);
    expect(env).toEqual({ HOME: '/home/u', PATH: '/usr/bin', LANG: 'en_US.UTF-8' });
    expect(restrictedEnv(SECRET_ENV, { MY_TOKEN: 'x', FOO: 'bar' })).toMatchObject({ FOO: 'bar' });
    expect(restrictedEnv(SECRET_ENV, { MY_TOKEN: 'x' })['MY_TOKEN']).toBeUndefined();
  });
});

describe('Claude Code backend', () => {
  it('locks the CLI down: no tools, no MCP, no settings, no sessions, no permissions', () => {
    const args = claudeArgs(REQ, '/tmp/x/system.txt');
    const val = (flag: string): string | undefined => args[args.indexOf(flag) + 1];
    expect(args[0]).toBe('-p');
    expect(val('--tools')).toBe('');
    expect(val('--disallowedTools')).toContain('Bash');
    expect(val('--disallowedTools')).toContain('WebFetch');
    expect(args).toContain('--strict-mcp-config');
    expect(val('--mcp-config')).toBe('{"mcpServers":{}}');
    expect(args).toContain('--safe-mode');
    expect(val('--setting-sources')).toBe('');
    expect(args).toContain('--disable-slash-commands');
    expect(args).toContain('--no-session-persistence');
    expect(val('--permission-mode')).toBe('dontAsk');
    expect(val('--permission-prompts')).toBe('none');
    expect(val('--model')).toBe('haiku');
    expect(val('--effort')).toBe('low');
    expect(val('--system-prompt-file')).toBe('/tmp/x/system.txt');
    expect(JSON.parse(val('--json-schema') ?? '')).toEqual({ type: 'object' });
    for (const bad of ['--dangerously-skip-permissions', '--allowedTools', '--add-dir', 'bypassPermissions']) expect(args).not.toContain(bad);
  });

  it('runs in a fresh temp dir with a restricted env, sends images on stdin, returns structured output, cleans up', async () => {
    const f = fakeSpawn([{ lines: ok({ tool_calls: [], final_message: 'hi' }) }]);
    const b = createClaudeCodeBackend({ spawn: f.spawn, env: SECRET_ENV, tmpRoot: root });
    const r = await b.complete(REQ);
    expect(r).toMatchObject({ structured: { tool_calls: [], final_message: 'hi' }, usage: { inputTokens: 15, outputTokens: 3 }, model: 'claude-haiku-5-5' });
    const call = f.calls[0];
    expect(call?.options.shell).toBe(false);
    expect(call?.options.env).toEqual({ HOME: '/home/u', PATH: '/usr/bin', LANG: 'en_US.UTF-8' });
    expect(String(call?.options.cwd)).toContain('aether-bridge-');
    const msg = JSON.parse(call?.stdin ?? '') as { message: { content: Array<{ type: string }> } };
    expect(msg.message.content.map((c) => c.type)).toEqual(['text', 'image']);
    expect(existsSync(String(call?.options.cwd))).toBe(false);
    expect(await readdir(root)).toEqual([]);
  });

  it('kills the run when the CLI exposes or uses any other tool', async () => {
    const exposed = fakeSpawn([{ lines: [JSON.stringify({ type: 'system', subtype: 'init', tools: [STRUCTURED_OUTPUT_TOOL, 'Bash'], mcp_servers: [] })], hang: true }]);
    await expect(createClaudeCodeBackend({ spawn: exposed.spawn, tmpRoot: root }).complete(REQ)).rejects.toMatchObject({ code: 'tool_violation' });
    expect(exposed.calls[0]?.killed).toBe(true);
    const used = fakeSpawn([{ lines: [JSON.stringify({ type: 'system', subtype: 'init', tools: [STRUCTURED_OUTPUT_TOOL], mcp_servers: [] }), JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/etc/passwd' } }] } })], hang: true }]);
    await expect(createClaudeCodeBackend({ spawn: used.spawn, tmpRoot: root }).complete(REQ)).rejects.toMatchObject({ code: 'tool_violation' });
    const mcp = fakeSpawn([{ lines: [JSON.stringify({ type: 'system', subtype: 'init', tools: [STRUCTURED_OUTPUT_TOOL], mcp_servers: [{ name: 'x' }] })], hang: true }]);
    await expect(createClaudeCodeBackend({ spawn: mcp.spawn, tmpRoot: root }).complete(REQ)).rejects.toMatchObject({ code: 'tool_violation' });
  });

  // Regression: a real haiku run once called `apply_patches` as a native tool (it does not exist in
  // the CLI, which only exposes StructuredOutput) and the whole turn fell back to the offline planner.
  describe('stray calls to emulated protocol tools', () => {
    const INIT = JSON.stringify({ type: 'system', subtype: 'init', tools: [STRUCTURED_OUTPUT_TOOL], mcp_servers: [] });
    const stray = (name: string): string => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input: { patches: [] } }] } });
    const PROTO_REQ: TextCompletionRequest = { ...REQ, toolNames: ['apply_patches', 'finish'] };

    it('tolerates a direct call to a protocol tool after a verified init and returns the structured reply', async () => {
      const structured = { tool_calls: [{ name: 'finish', input: {} }] };
      const f = fakeSpawn([{ lines: [INIT, stray('apply_patches'), ...ok(structured).slice(1)] }]);
      const r = await createClaudeCodeBackend({ spawn: f.spawn, tmpRoot: root }).complete(PROTO_REQ);
      expect(r.structured).toEqual(structured);
      expect(f.calls[0]?.killed).toBe(false);
    });

    it('fails closed when the call comes before the init event proved the tool set', async () => {
      const f = fakeSpawn([{ lines: [stray('apply_patches')], hang: true }]);
      await expect(createClaudeCodeBackend({ spawn: f.spawn, tmpRoot: root }).complete(PROTO_REQ)).rejects.toMatchObject({ code: 'tool_violation' });
      expect(f.calls[0]?.killed).toBe(true);
    });

    it('still treats names that are not protocol tools of this request as violations', async () => {
      const f = fakeSpawn([{ lines: [INIT, stray('write_generator')], hang: true }]);
      await expect(createClaudeCodeBackend({ spawn: f.spawn, tmpRoot: root }).complete(PROTO_REQ)).rejects.toMatchObject({ code: 'tool_violation' });
    });

    it('never lets a request make built-in, MCP or structured-output names tolerable', async () => {
      expect([...protocolToolSet(['apply_patches', 'Read', 'Bash', 'mcp__fs__read', STRUCTURED_OUTPUT_TOOL, 'WebFetch', 'finish'])]).toEqual(['apply_patches', 'finish']);
      const f = fakeSpawn([{ lines: [INIT, stray('Read')], hang: true }]);
      await expect(createClaudeCodeBackend({ spawn: f.spawn, tmpRoot: root }).complete({ ...REQ, toolNames: ['Read'] })).rejects.toMatchObject({ code: 'tool_violation' });
    });

    it('stops a run that keeps calling protocol tools directly (backend error, not a violation)', async () => {
      const lines = [INIT, ...Array.from({ length: MAX_STRAY_PROTOCOL_CALLS + 1 }, () => stray('apply_patches'))];
      const f = fakeSpawn([{ lines, hang: true }]);
      await expect(createClaudeCodeBackend({ spawn: f.spawn, tmpRoot: root }).complete(PROTO_REQ)).rejects.toMatchObject({ code: 'backend_error' });
      expect(f.calls[0]?.killed).toBe(true);
    });
  });

  it('maps a missing CLI, a logged-out CLI, rate limits and timeouts', async () => {
    await expect(createClaudeCodeBackend({ spawn: fakeSpawn([{ enoent: true }]).spawn, tmpRoot: root }).complete(REQ)).rejects.toMatchObject({ code: 'cli_missing' });
    const out = fakeSpawn([{ lines: [JSON.stringify({ type: 'result', is_error: true, result: 'Not logged in · Please run /login' })], code: 1 }]);
    await expect(createClaudeCodeBackend({ spawn: out.spawn, tmpRoot: root }).complete(REQ)).rejects.toMatchObject({ code: 'not_logged_in' });
    const limited = fakeSpawn([{ lines: [JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected' } }), JSON.stringify({ type: 'result', is_error: true, result: 'limit' })], code: 1 }]);
    await expect(createClaudeCodeBackend({ spawn: limited.spawn, tmpRoot: root }).complete(REQ)).rejects.toMatchObject({ code: 'rate_limited' });
    const slow = fakeSpawn([{ hang: true }]);
    await expect(createClaudeCodeBackend({ spawn: slow.spawn, tmpRoot: root, timeoutMs: 30 }).complete(REQ)).rejects.toMatchObject({ code: 'timeout' });
    expect(slow.calls[0]?.killed).toBe(true);
  });

  it('refuses a flag-like model id before spawning anything', async () => {
    const f = fakeSpawn([{ lines: ok({ tool_calls: [] }) }]);
    await expect(createClaudeCodeBackend({ spawn: f.spawn, tmpRoot: root }).complete({ ...REQ, model: '--dangerously-skip-permissions' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(f.calls).toEqual([]);
  });

  it('kills the CLI when the caller aborts', async () => {
    const f = fakeSpawn([{ hang: true }]);
    const ctrl = new AbortController();
    const p = createClaudeCodeBackend({ spawn: f.spawn, tmpRoot: root }).complete(REQ, ctrl.signal);
    setTimeout(() => ctrl.abort(), 10);
    await expect(p).rejects.toMatchObject({ message: 'cancelled' });
    expect(f.calls[0]?.killed).toBe(true);
  });
});

/** Fake Codex SDK recording options and replaying events. */
function fakeCodex(events: ThreadEvent[] | (() => AsyncGenerator<ThreadEvent>)): { create: (o: CodexOptions) => CodexLike; seen: { options?: CodexOptions; thread?: ThreadOptions; input?: string | UserInput[]; turn?: TurnOptions } } {
  const seen: { options?: CodexOptions; thread?: ThreadOptions; input?: string | UserInput[]; turn?: TurnOptions } = {};
  return {
    seen,
    create: (options) => {
      seen.options = options;
      return {
        startThread: (thread) => {
          seen.thread = thread;
          return {
            runStreamed: async (input, turn) => {
              seen.input = input;
              seen.turn = turn;
              if (typeof events === 'function') return { events: events() };
              return {
                events: (async function* () {
                  for (const e of events) yield e;
                })(),
              };
            },
          };
        },
      };
    },
  };
}

const message = (text: string): ThreadEvent => ({ type: 'item.completed', item: { id: 'i1', type: 'agent_message', text } });
const done: ThreadEvent = { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 20, cache_write_input_tokens: 0, output_tokens: 7, reasoning_output_tokens: 0 } };

describe('Codex backend', () => {
  it('runs read-only, approval never, offline, every tool feature disabled, every MCP server disabled, restricted env', async () => {
    const f = fakeCodex([message('{"tool_calls":[]}'), done]);
    const b = createCodexBackend({ createCodex: f.create, env: SECRET_ENV, tmpRoot: root, mcpServers: async () => ['hoplite', 'stitch'], codexPath: '/usr/bin/codex' });
    const r = await b.complete({ ...REQ, model: 'gpt-6.1-sol' });
    expect(r).toEqual({ text: '{"tool_calls":[]}', usage: { inputTokens: 120, outputTokens: 7 }, model: 'gpt-6.1-sol' });
    expect(f.seen.thread).toMatchObject({ sandboxMode: 'read-only', approvalPolicy: 'never', networkAccessEnabled: false, webSearchMode: 'disabled', skipGitRepoCheck: true, modelReasoningEffort: 'low', model: 'gpt-6.1-sol' });
    expect(String(f.seen.thread?.workingDirectory)).toContain('aether-bridge-');
    expect(f.seen.options?.env).toEqual({ HOME: '/home/u', PATH: '/usr/bin', LANG: 'en_US.UTF-8' });
    expect(f.seen.options?.codexPathOverride).toBe('/usr/bin/codex');
    expect(f.seen.options?.configOverrides).toEqual(['mcp_servers.hoplite.enabled=false', 'mcp_servers.stitch.enabled=false']);
    const cfg = f.seen.options?.config as ReturnType<typeof codexLockdownConfig>;
    for (const feat of ['shell_tool', 'unified_exec', 'apps', 'plugins', 'browser_use', 'computer_use', 'multi_agent', 'image_generation']) expect((cfg['features'] as Record<string, boolean>)[feat]).toBe(false);
    expect(cfg).toMatchObject({ web_search: 'disabled', approval_policy: 'never', sandbox_mode: 'read-only', project_doc_max_bytes: 0 });
    expect(f.seen.turn?.outputSchema).toEqual({ type: 'object' });
    const input = f.seen.input as UserInput[];
    expect(input[0]).toMatchObject({ type: 'text' });
    expect(input[1]).toMatchObject({ type: 'local_image' });
    expect(b.strictSchema).toBe(true);
    expect(await readdir(root)).toEqual([]);
    expect(CODEX_DISABLED_FEATURES.length).toBeGreaterThan(20);
  });

  it('aborts and refuses on any command, file change, MCP call or web search', async () => {
    for (const type of ['command_execution', 'file_change', 'mcp_tool_call', 'web_search'] as const) {
      let aborted = false;
      const f = fakeCodex(async function* () {
        const item = type === 'command_execution' ? { id: 'c', type, command: 'cat ~/.ssh/id_rsa', aggregated_output: '', status: 'in_progress' as const } : type === 'file_change' ? { id: 'f', type, changes: [], status: 'completed' as const } : type === 'mcp_tool_call' ? { id: 'm', type, server: 's', tool: 't', arguments: {}, status: 'in_progress' as const } : { id: 'w', type, query: 'q' };
        yield { type: 'item.started', item } as ThreadEvent;
        aborted = true;
        yield message('{"tool_calls":[]}');
      });
      await expect(createCodexBackend({ createCodex: f.create, tmpRoot: root }).complete(REQ)).rejects.toMatchObject({ code: 'tool_violation' });
      expect(aborted).toBe(false);
    }
  });

  it('refuses a model id that could smuggle config before starting the SDK', async () => {
    const f = fakeCodex([message('{"tool_calls":[]}'), done]);
    await expect(createCodexBackend({ createCodex: f.create, tmpRoot: root }).complete({ ...REQ, model: 'x" sandbox_mode="danger-full-access' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(f.seen.options).toBeUndefined();
  });

  it('maps failures: usage limit, login, missing CLI, empty reply, unlistable MCP config', async () => {
    const limit = fakeCodex([{ type: 'turn.failed', error: { message: "You've hit your usage limit. Try again in 3 hours." } }]);
    await expect(createCodexBackend({ createCodex: limit.create, tmpRoot: root }).complete(REQ)).rejects.toMatchObject({ code: 'rate_limited' });
    const login = fakeCodex(async function* () {
      yield* [];
      throw new Error('Codex Exec exited with code 1: Not logged in. Please run `codex login`.');
    });
    await expect(createCodexBackend({ createCodex: login.create, tmpRoot: root }).complete(REQ)).rejects.toMatchObject({ code: 'not_logged_in' });
    // The CLI printed the real reason as an error event, then the SDK threw its generic exit-code error: keep the reason.
    const hidden = fakeCodex(async function* () {
      yield { type: 'error', message: "You've hit your usage limit. Try again at 4:59 PM." } as ThreadEvent;
      throw new Error('Codex Exec exited with code 1: Reading prompt from stdin...');
    });
    await expect(createCodexBackend({ createCodex: hidden.create, tmpRoot: root }).complete(REQ)).rejects.toMatchObject({ code: 'rate_limited' });
    const missing = createCodexBackend({
      createCodex: () => {
        throw new Error('Unable to locate Codex CLI binaries');
      },
      tmpRoot: root,
    });
    await expect(missing.complete(REQ)).rejects.toMatchObject({ code: 'cli_missing' });
    await expect(createCodexBackend({ createCodex: fakeCodex([done]).create, tmpRoot: root }).complete(REQ)).rejects.toMatchObject({ code: 'backend_error' });
    await expect(createCodexBackend({ createCodex: fakeCodex([done]).create, tmpRoot: root, mcpServers: async () => null }).complete(REQ)).rejects.toMatchObject({ code: 'tool_violation' });
    expect(() => mcpDisableOverrides(['ok', 'bad name"; rm -rf'])).toThrow();
  });
});

describe('probes', () => {
  it('parses the Codex model catalog (listed models, effort subset, vision)', () => {
    const text = JSON.stringify({ models: [
      { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1-Sol', visibility: 'list', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'high' }, { effort: 'xhigh' }], input_modalities: ['text', 'image'] },
      { slug: 'hidden', visibility: 'hide' },
      { slug: 'bad slug!', visibility: 'list' },
    ] });
    expect(parseCodexModels(text)).toEqual([{ id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol', efforts: ['low', 'medium', 'high'], vision: true }]);
    expect(parseCodexModels('nope')).toEqual([]);
  });
  it('detects login state and models; missing CLIs report not installed', async () => {
    const f = fakeSpawn([{ lines: ['Logged in using ChatGPT'] }, { lines: [JSON.stringify({ models: [{ slug: 'gpt-6-luna', display_name: 'GPT-6-Luna', visibility: 'list', supported_reasoning_levels: [{ effort: 'low' }] }] })] }]);
    const codex = await probeCodex({ codexCommand: 'codex', claudeCommand: null, spawn: f.spawn });
    expect(codex).toMatchObject({ installed: true, loggedIn: true, detail: 'Logged in using ChatGPT', defaultModel: 'gpt-6-luna' });
    expect(f.calls.map((c) => c.args)).toEqual([['login', 'status'], ['debug', 'models']]);
    expect(await probeCodex({ codexCommand: null, claudeCommand: null })).toMatchObject({ installed: false, loggedIn: false });
    const c = fakeSpawn([{ lines: [JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty' })] }]);
    expect(await probeClaude({ codexCommand: null, claudeCommand: 'claude', spawn: c.spawn })).toMatchObject({ installed: true, loggedIn: true });
    const notSub = fakeSpawn([{ lines: [JSON.stringify({ loggedIn: true, apiProvider: 'bedrock' })] }]);
    expect(await probeClaude({ codexCommand: null, claudeCommand: 'claude', spawn: notSub.spawn })).toMatchObject({ loggedIn: false });
    const out = fakeSpawn([{ lines: [JSON.stringify({ loggedIn: false })], code: 1 }]);
    expect(await probeClaude({ codexCommand: null, claudeCommand: 'claude', spawn: out.spawn })).toMatchObject({ installed: true, loggedIn: false });
  });
});
