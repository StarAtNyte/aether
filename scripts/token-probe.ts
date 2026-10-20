/**
 * Token probe: runs prompts (and follow-up edits on the same project) through
 * the real WorldAgent with the studio's settings (review loop, level tools,
 * high turn and tool limits) against a signed-in Codex or Claude Code, and
 * logs every model call: whether the conversation was resumed, what was sent
 * and the input / cached / output tokens the call really used. At the end the
 * world is verified and play-tested (game bot or building walkthrough) so a
 * cheaper layout can be checked for unchanged quality.
 *
 *   npx tsx scripts/token-probe.ts --provider=codex "night forest adventure: 5 lanterns, wolves, river, shrine on the hill" \
 *     --edit="move the shrine 6 metres to the east" --json=out.json
 *
 * Renders are not available in Node, so the review loop runs without images
 * (the studio adds them when the model can see).
 */
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import type { CodexOptions } from '@openai/codex-sdk';
import { Codex } from '@openai/codex-sdk';
import { WorldAgent, createEmulatedProvider, resumeInput, type LevelToolRunner, type TextBackend, type TextEffort } from '@aether/agent';
import { initScripting } from '@aether/logic';
import { initPhysics } from '@aether/physics';
import { playtest, walkthrough } from '@aether/playtest';
import { loadLibraryGenerator } from '@aether/procgen';
import { createNodeSandbox } from '@aether/procgen/node';
import { createClaudeCodeBackend } from '../apps/bridge/src/backends/claude';
import { createCodexBackend, type CodexLike } from '../apps/bridge/src/backends/codex';
import { listCodexMcpServers } from '../apps/bridge/src/backends/status';
import { SessionStore } from '../apps/bridge/src/sessions';
import { findCliPath } from '../apps/bridge/src/which';
import { CATALOGS, GENERATOR_DRY_RUN_MS, NodeAgentHost, runVerify } from './lib/headless-world';

interface CallRow {
  run: number;
  call: number;
  resumed: boolean;
  systemChars: number;
  promptChars: number;
  /** Characters actually sent (the new part when resumed). */
  sentChars: number;
  images: number;
  /** What the backend reported for the call. */
  reportedIn: number;
  reportedCached: number;
  out: number;
  /** Raw Codex counters (cumulative per thread in Codex 0.16x). */
  raw?: { input: number; cached: number; output: number };
  ms: number;
}

const argv = process.argv.slice(2);
const get = (name: string): string | undefined => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const provider = get('provider') ?? 'codex';
if (provider !== 'codex' && provider !== 'claude-code') throw new Error('--provider must be codex or claude-code');
const effortArg = get('effort') ?? 'low';
if (effortArg !== 'low' && effortArg !== 'medium' && effortArg !== 'high') throw new Error('--effort must be low, medium or high');
const effort: TextEffort = effortArg;
const model = get('model');
if (model !== undefined && !/^[A-Za-z0-9._:-]{1,64}$/.test(model)) throw new Error('invalid --model');
const promptArg = argv.find((a) => !a.startsWith('--'));
if (!promptArg) throw new Error('give a prompt');
const prompt: string = promptArg;
const edits = argv.filter((a) => a.startsWith('--edit=')).map((a) => a.slice(7));
const jsonOut = get('json');

const rows: CallRow[] = [];
let lastRaw: { input: number; cached: number; output: number } | undefined;
let runNo = 0;

/** The real Codex SDK with its usage events recorded. */
function recordingCodex(o: CodexOptions): CodexLike {
  const real = new Codex(o);
  const wrap = (t: ReturnType<Codex['startThread']>): ReturnType<CodexLike['startThread']> => ({
    get id() {
      return t.id;
    },
    async runStreamed(input, turn) {
      const r = await t.runStreamed(input, turn);
      async function* events() {
        for await (const ev of r.events) {
          if (ev.type === 'turn.completed') lastRaw = { input: ev.usage.input_tokens, cached: ev.usage.cached_input_tokens, output: ev.usage.output_tokens };
          yield ev;
        }
      }
      return { events: events() };
    },
  });
  return { startThread: (opts) => wrap(real.startThread(opts)), resumeThread: (id, opts) => wrap(real.resumeThread(id, opts)) };
}

const sessions = new SessionStore();
const env = process.env;
const inner: TextBackend =
  provider === 'codex'
    ? (() => {
        const command = findCliPath('codex', { env });
        return createCodexBackend({ ...(command ? { codexPath: command } : {}), sessions, createCodex: recordingCodex, mcpServers: () => listCodexMcpServers({ codexCommand: command, claudeCommand: null, env }) });
      })()
    : createClaudeCodeBackend({ command: findCliPath('claude', { env }) ?? 'claude', sessions });

const backend: TextBackend = {
  name: inner.name,
  strictSchema: inner.strictSchema,
  async complete(req, signal) {
    const t0 = performance.now();
    lastRaw = undefined;
    const known = req.session ? sessions.peek(req.session.key, provider, req.model) : undefined;
    const r = await inner.complete(req, signal);
    const sent = r.resumed && req.session && known ? resumeInput(known.body, req.session.body, req.session.tail, req.imageKeys ?? []).text.length : req.system.length + req.prompt.length;
    const row: CallRow = {
      run: runNo,
      call: rows.length + 1,
      resumed: r.resumed === true,
      systemChars: req.system.length,
      promptChars: req.prompt.length,
      sentChars: sent,
      images: req.images.length,
      reportedIn: r.usage?.inputTokens ?? 0,
      reportedCached: r.usage?.cachedInputTokens ?? 0,
      out: r.usage?.outputTokens ?? 0,
      ...(lastRaw ? { raw: lastRaw } : {}),
      ms: Math.round(performance.now() - t0),
    };
    rows.push(row);
    console.log(`call ${row.call} run ${row.run} ${row.resumed ? 'resumed' : 'fresh  '} sent ${row.sentChars} chars, in ${row.reportedIn} (cached ${row.reportedCached}) out ${row.out}${row.raw ? ` raw ${JSON.stringify(row.raw)}` : ''} ${row.ms} ms`);
    return r;
  },
};

const levelTools: LevelToolRunner = async (world, name, input) => {
  const { runLevelTool } = await import('@aether/playtest/level');
  const r = await runLevelTool(world, name, input);
  return { ok: r.ok, text: r.text, patches: r.patches, message: r.message, ...(r.data ? { data: r.data } : {}) };
};

async function main(): Promise<void> {
  await initPhysics();
  await initScripting().catch(() => undefined);
  const sandbox = createNodeSandbox({ timeoutMs: GENERATOR_DRY_RUN_MS });
  const host = new NodeAgentHost(sandbox);
  const llm = createEmulatedProvider({ backend, name: provider, effort, ...(model ? { model } : {}) });
  const session = `probe-${randomBytes(6).toString('hex')}`;
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  const runs: Array<{ prompt: string; ms: number; calls: number; inputTokens: number; cachedInputTokens: number; outputTokens: number; messages: string[] }> = [];
  try {
    for (const [i, text] of [prompt, ...edits].entries()) {
      runNo = i + 1;
      const agent = new WorldAgent({ provider: llm, catalogs: CATALOGS, resolveGenerator: loadLibraryGenerator, maxRepairs: 2, promptProfile: 'full', levelTools, review: { vision: false, maxViews: 6 }, maxTurns: 40, maxToolCalls: 300, photo: { vision: false } });
      const t0 = performance.now();
      const said: string[] = [];
      let usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, calls: 0 };
      for await (const ev of agent.run(text, host, { session, history, intent: i === 0 ? 'new' : 'auto' })) {
        if (ev.type === 'message') said.push(ev.text);
        else if (ev.type === 'review') console.log(`  review ${ev.round} ${ev.phase}: ${ev.text.slice(0, 140)}`);
        else if (ev.type === 'verify') console.log(`  verify ${ev.passed ? 'pass' : 'FAIL'}: ${ev.summary.split('\n')[0]?.slice(0, 140)}`);
        else if (ev.type === 'error') console.log(`  error: ${ev.text.slice(0, 200)}`);
        else if (ev.type === 'done') usage = { inputTokens: ev.usage.inputTokens, cachedInputTokens: ev.usage.cachedInputTokens ?? 0, outputTokens: ev.usage.outputTokens, calls: ev.usage.calls };
      }
      history.push({ role: 'user', content: text }, { role: 'assistant', content: said.join(' ').slice(0, 2000) || 'Done.' });
      runs.push({ prompt: text, ms: Math.round(performance.now() - t0), ...usage, messages: said });
      console.log(`run ${runNo}: ${usage.calls} calls, in ${usage.inputTokens} (cached ${usage.cachedInputTokens}), out ${usage.outputTokens}, ${Math.round(performance.now() - t0)} ms`);
    }
  } finally {
    sandbox.dispose();
  }
  const world = host.getWorld();
  const verify = await runVerify(world);
  const building = Object.values(world.entities).some((e) => e.arch?.role === 'building');
  const bot = await (building ? walkthrough(world) : playtest(world));
  const summary = {
    provider,
    effort,
    model: model ?? 'default',
    prompt,
    edits,
    entities: Object.keys(world.entities).length,
    verify: verify.passed,
    verifySummary: verify.summary.split('\n')[0],
    bot: { kind: building ? 'walkthrough' : 'game', status: bot.status, summary: bot.summary },
    runs,
    totals: {
      calls: rows.length,
      resumed: rows.filter((r) => r.resumed).length,
      inputTokens: rows.reduce((s, r) => s + r.reportedIn, 0),
      cachedInputTokens: rows.reduce((s, r) => s + r.reportedCached, 0),
      outputTokens: rows.reduce((s, r) => s + r.out, 0),
      sentChars: rows.reduce((s, r) => s + r.sentChars, 0),
    },
  };
  console.log(JSON.stringify(summary, null, 2));
  if (jsonOut) await writeFile(jsonOut, `${JSON.stringify({ summary, calls: rows, world }, null, 2)}\n`);
}

main().catch((e: unknown) => {
  console.error('probe crashed:', e instanceof Error ? e.stack : e);
  process.exitCode = 1;
});
