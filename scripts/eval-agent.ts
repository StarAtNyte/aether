/**
 * Agent evaluation harness: runs a prompt suite through the real WorldAgent
 * loop against one provider and reports, per prompt and in total, the patch
 * error rate, verification pass rate (independent re-verification of the
 * final world), latency, model calls and the 3D quality score with its rubric
 * breakdown (deterministic heuristics, so scores are comparable across
 * models).
 *
 *   npx tsx scripts/eval-agent.ts                         # offline planner, full suite
 *   npx tsx scripts/eval-agent.ts --provider=codex --effort=low --limit=3
 *   npx tsx scripts/eval-agent.ts --provider=claude-code --model=haiku --limit=3
 *   options: --model=<id> --effort=low|medium|high --limit=N --max-calls=N --json=<file> "<prompt>"…
 *            --no-assets ("No assets" mode, AgentOptions.noAssets) --world-out=<file> (last world JSON) --max-turns=N --max-tool-calls=N
 *            --world-in=<file> (start from a saved world: the prompt refines it)
 *
 * codex / claude-code use the CLIs you are signed in to (no API keys), with
 * the same locked-down backends as the bridge. --max-calls bounds the total
 * number of model calls (default 40 for headless providers).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { setCatalog } from '@aether/assets';
import { validateWorld, type WorldDoc } from '@aether/core';
import { QUALITY_CRITERIA, WorldAgent, assessWorld, createMockProvider, type CompletionRequest, type Provider, type QualityCriterion } from '@aether/agent';
import { initScripting } from '@aether/logic';
import { initPhysics } from '@aether/physics';
import { GENERATOR_LIBRARY, loadLibraryGenerator } from '@aether/procgen';
import { createNodeSandbox } from '@aether/procgen/node';
import { createHeadlessProvider } from './lib/live-provider';
import { CATALOGS, GENERATOR_DRY_RUN_MS, NodeAgentHost, runVerify } from './lib/headless-world';
import { DEFAULT_PROMPTS } from './smoke-prompts';

type ProviderName = 'mock' | 'codex' | 'claude-code';

interface Args {
  provider: ProviderName;
  model: string | undefined;
  effort: 'low' | 'medium' | 'high';
  limit: number;
  maxCalls: number;
  json: string | undefined;
  noAssets: boolean;
  worldOut: string | undefined;
  worldIn: string | undefined;
  maxTurns: number | undefined;
  maxToolCalls: number | undefined;
  prompts: readonly string[];
}

/** One prompt's outcome. */
interface EvalRow {
  prompt: string;
  ok: boolean;
  ms: number;
  calls: number;
  patchesApplied: number;
  patchesRejected: number;
  verifyPassed: boolean;
  repairs: number;
  quality: number;
  criteria: Record<QualityCriterion, number>;
  entities: number;
  error?: string;
}

function parseArgs(argv: readonly string[]): Args {
  const get = (name: string): string | undefined => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const provider = (get('provider') ?? 'mock') as ProviderName;
  if (!['mock', 'codex', 'claude-code'].includes(provider)) throw new Error('--provider must be mock, codex or claude-code');
  const effort = get('effort') ?? 'low';
  if (effort !== 'low' && effort !== 'medium' && effort !== 'high') throw new Error('--effort must be low, medium or high');
  const model = get('model');
  if (model !== undefined && !/^[A-Za-z0-9._:-]{1,64}$/.test(model)) throw new Error('invalid --model');
  const positional = argv.filter((a) => !a.startsWith('--'));
  return {
    provider,
    model,
    effort,
    limit: Math.max(1, Number(get('limit') ?? 1000) || 1000),
    maxCalls: Math.max(1, Number(get('max-calls') ?? (provider === 'mock' ? 10_000 : provider === 'codex' || provider === 'claude-code' ? 300 : 40)) || 40),
    json: get('json'),
    noAssets: argv.includes('--no-assets'),
    worldOut: get('world-out'),
    worldIn: get('world-in'),
    maxTurns: get('max-turns') ? Number(get('max-turns')) : undefined,
    maxToolCalls: get('max-tool-calls') ? Number(get('max-tool-calls')) : undefined,
    prompts: positional.length > 0 ? positional : DEFAULT_PROMPTS,
  };
}

/** Count calls and refuse beyond the budget (shared across the suite). */
function budgeted(inner: Provider, max: number): Provider & { calls: () => number } {
  let n = 0;
  return {
    name: inner.name,
    calls: () => n,
    async complete(req: CompletionRequest, signal?: AbortSignal) {
      if (n >= max) throw new Error(`call budget exhausted (${max})`);
      n++;
      const res = await inner.complete(req, signal);
      // Which model really answered (Claude Code reports it in modelUsage).
      console.log(`[call ${n}] role=${req.role ?? '?'} model=${res.model ?? 'unreported'}`);
      return res;
    },
  };
}

/** "No assets": the prompt does not list the asset library. */
function withoutAssetSummary(c: typeof CATALOGS): typeof CATALOGS {
  const { assetSummary: _omit, ...rest } = c;
  return rest;
}

const pct = (num: number, den: number): string => (den === 0 ? 'n/a' : `${((num / den) * 100).toFixed(1)}%`);

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await initPhysics();
  // "No assets": no library catalog, so architecture furnishes with its parametric pieces only.
  if (args.noAssets) setCatalog(null);
  await initScripting().catch(() => undefined);
  const base = args.provider === 'mock'
    ? createMockProvider({ library: GENERATOR_LIBRARY })
    : createHeadlessProvider(args.provider, { effort: args.effort, ...(args.model ? { model: args.model } : {}) });
  const provider = budgeted(base, args.maxCalls);
  const sandbox = createNodeSandbox({ timeoutMs: GENERATOR_DRY_RUN_MS });
  const rows: EvalRow[] = [];
  const initial = args.worldIn ? (JSON.parse(await readFile(args.worldIn, 'utf8')) as WorldDoc) : undefined;
  try {
    for (const prompt of args.prompts.slice(0, args.limit)) {
      const host = new NodeAgentHost(sandbox, initial);
      const agent = new WorldAgent({ provider, catalogs: args.noAssets ? withoutAssetSummary(CATALOGS) : CATALOGS, resolveGenerator: loadLibraryGenerator, maxRepairs: 2, ...(args.noAssets ? { noAssets: true } : {}), ...(args.maxTurns ? { maxTurns: args.maxTurns } : {}), ...(args.maxToolCalls ? { maxToolCalls: args.maxToolCalls } : {}) });
      const before = provider.calls();
      const t0 = performance.now();
      let applied = 0;
      let rejected = 0;
      let repairs = 0;
      let error: string | undefined;
      for await (const ev of agent.run(prompt, host, initial ? { intent: 'refine' } : {})) {
        if (ev.type === 'patches') {
          applied += ev.result.applied;
          rejected += ev.result.errors.length;
        } else if (ev.type === 'verify' && !ev.passed) repairs++;
        else if (ev.type === 'error') error = ev.text.slice(0, 200);
      }
      const ms = Math.round(performance.now() - t0);
      const world = host.getWorld();
      if (args.worldOut) await writeFile(args.worldOut, `${JSON.stringify(world, null, 2)}\n`);
      const final = Object.keys(world.entities).length > 0 ? await runVerify(world) : { passed: false, summary: 'empty world' };
      const quality = assessWorld({ world, prompt, verifyPassed: final.passed });
      const criteria = Object.fromEntries(QUALITY_CRITERIA.map((c) => [c, quality.criteria[c].score])) as Record<QualityCriterion, number>;
      const valid = validateWorld(world).ok;
      rows.push({
        prompt,
        ok: !error && valid && final.passed,
        ms,
        calls: provider.calls() - before,
        patchesApplied: applied,
        patchesRejected: rejected,
        verifyPassed: final.passed,
        repairs,
        quality: quality.score,
        criteria,
        entities: Object.keys(world.entities).length,
        ...(error ? { error } : {}),
      });
      console.log(`${final.passed ? 'pass' : 'FAIL'} ${String(ms).padStart(7)} ms  q${String(quality.score).padStart(3)}  ${prompt.slice(0, 60)}${error ? `  [${error}]` : ''}`);
    }
  } finally {
    sandbox.dispose();
  }

  const n = rows.length;
  const applied = rows.reduce((s, r) => s + r.patchesApplied, 0);
  const rejected = rows.reduce((s, r) => s + r.patchesRejected, 0);
  const lat = rows.map((r) => r.ms).sort((a, b) => a - b);
  const median = lat[Math.floor(lat.length / 2)] ?? 0;
  const p90 = lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.9))] ?? 0;
  const meanQuality = n ? rows.reduce((s, r) => s + r.quality, 0) / n : 0;
  const criteriaMean = Object.fromEntries(QUALITY_CRITERIA.map((c) => [c, n ? +(rows.reduce((s, r) => s + r.criteria[c], 0) / n).toFixed(1) : 0]));
  console.table(rows.map((r) => ({ prompt: r.prompt.length > 40 ? `${r.prompt.slice(0, 37)}...` : r.prompt, ms: r.ms, calls: r.calls, patches: `${r.patchesApplied}/${r.patchesApplied + r.patchesRejected}`, verify: r.verifyPassed ? 'pass' : 'FAIL', quality: r.quality })));
  const summary = {
    provider: args.provider,
    model: args.model ?? 'default',
    effort: args.provider === 'mock' ? 'n/a' : args.effort,
    prompts: n,
    patchErrorRate: pct(rejected, applied + rejected),
    verificationPassRate: pct(rows.filter((r) => r.verifyPassed).length, n),
    successRate: pct(rows.filter((r) => r.ok).length, n),
    latencyMedianMs: median,
    latencyP90Ms: p90,
    modelCalls: provider.calls(),
    qualityMean: +meanQuality.toFixed(1),
    qualityCriteriaMean: criteriaMean,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (args.json) await writeFile(args.json, `${JSON.stringify({ summary, rows }, null, 2)}\n`);
  process.exitCode = rows.every((r) => r.ok) ? 0 : 1;
}

main().catch((e: unknown) => {
  console.error('eval crashed:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
