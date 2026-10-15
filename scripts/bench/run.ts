/**
 * Aether benchmark. Reproducible, offline, no API keys.
 *
 *   npm run bench                 full suite (80 prompts, 100+ edits, repair and speed studies)
 *   npm run bench:quick           CI-safe subset (about 10 s) that also checks the claims below
 *   npx tsx scripts/bench/run.ts --write      full run, writes docs/benchmark/results.json and BENCHMARK.md tables
 *   npx tsx scripts/bench/run.ts --provider=codex --allow-model --max-calls=30 --limit=8
 *                                 optional: score a signed-in model on the first prompts, hard-capped
 *
 * See docs/BENCHMARK.md for the method, the baselines and the results.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMockProvider, type Provider } from '@aether/agent';
import { initScripting } from '@aether/logic';
import { initPhysics } from '@aether/physics';
import { GENERATOR_LIBRARY } from '@aether/procgen';
import type { SandboxRunner } from '@aether/procgen';
import { createNodeSandbox } from '@aether/procgen/node';
import type { WorldDoc } from '@aether/core';
import { createHeadlessProvider } from '../../apps/bridge/src/headless';
import { GENERATOR_DRY_RUN_MS } from '../lib/headless-world';
import { coverageSummary, editSummary, repairSummary, speedSummary, winnability, type CoverageSummary, type EditSummary, type RepairSummary, type SpeedSummary, type WinnabilitySummary } from './aggregate';
import { BASES, QUICK_BASES } from './bases';
import { ASSUMED_TOKENS_PER_SECOND, editsFor, prepareBase, runEdit, type EditArm, type EditRow } from './edit-study';
import { runPrompt, freshProvider, type PromptRow } from './prompt-study';
import { compactJson, renderMarkdown, renderModel, spliceResults } from './report';
import { repairStudy, type RepairRow } from './repair-study';
import { speedOf, type SpeedRow } from './speed-study';
import { PROMPTS, QUICK_PROMPTS } from './suite';
import { recordingProvider, runAgent } from './world-eval';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RESULTS_JSON = resolve(ROOT, 'docs/benchmark/results.json');
const BENCHMARK_MD = resolve(ROOT, 'docs/BENCHMARK.md');

/** Everything a run produces (this is what results.json holds). */
export interface BenchResults {
  schema: 1;
  mode: 'full' | 'quick';
  machine: { node: string; cpus: number; platform: string };
  assumptions: { tokensPerSecond: number; tokenEstimate: string; botSeconds: number };
  prompts: PromptRow[];
  winnability: { inVocabulary: WinnabilitySummary; stretch: WinnabilitySummary; flagship: WinnabilitySummary };
  repair: { rows: RepairRow[]; verifyOnly: RepairSummary; withPlaytest: RepairSummary; physicsFaults: { verifyOnly: RepairSummary; withPlaytest: RepairSummary }; winFaults: { verifyOnly: RepairSummary; withPlaytest: RepairSummary } };
  edits: { rows: EditRow[]; summary: EditSummary };
  speed: { rows: SpeedRow[]; summary: SpeedSummary };
  coverage: CoverageSummary;
  provider?: ProviderResults;
}

/** Results of the optional model run. */
export interface ProviderResults {
  name: string;
  callsUsed: number;
  maxCalls: number;
  prompts: PromptRow[];
  coverage: CoverageSummary;
  /** The same prompts under the offline planner, for a side-by-side. */
  offlineCoverage: CoverageSummary;
}

interface Args {
  quick: boolean;
  write: boolean;
  check: boolean;
  json: string | undefined;
  provider: 'mock' | 'codex' | 'claude-code';
  allowModel: boolean;
  modelOnly: boolean;
  maxCalls: number;
  limit: number;
}

function parseArgs(argv: readonly string[]): Args {
  const get = (name: string): string | undefined => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const has = (name: string): boolean => argv.includes(`--${name}`);
  const provider = (get('provider') ?? 'mock') as Args['provider'];
  if (!['mock', 'codex', 'claude-code'].includes(provider)) throw new Error('--provider must be mock, codex or claude-code');
  const maxCalls = Math.min(30, Math.max(1, Number(get('max-calls') ?? 30) || 30));
  return {
    quick: has('quick'),
    write: has('write'),
    check: has('check') || has('quick'),
    json: get('json'),
    provider,
    allowModel: has('allow-model'),
    modelOnly: has('model-only'),
    maxCalls,
    limit: Math.max(1, Number(get('limit') ?? 10) || 10),
  };
}

const mockProvider = (): Provider => createMockProvider({ library: GENERATOR_LIBRARY });
const log = (msg: string): void => {
  process.stderr.write(`${msg}\n`);
};

/**
 * Run the benchmark's four studies and return the results. `quick` selects the
 * CI subset. `initPhysics()` (and, for script worlds, `initScripting()`) must
 * have run.
 */
export async function runBench(opts: { quick: boolean; sandbox: SandboxRunner; log?: (msg: string) => void }): Promise<BenchResults> {
  const { quick, sandbox } = opts;
  const log = opts.log ?? ((): void => undefined);
  const prompts = quick ? QUICK_PROMPTS : PROMPTS;
  const bases = quick ? QUICK_BASES : BASES;

  // (1) + (4): every prompt through the real loop.
  log(`prompts: ${prompts.length}`);
  const rows: PromptRow[] = [];
  const worlds = new Map<string, WorldDoc>();
  for (const q of prompts) {
    const { row, world } = await runPrompt(q, freshProvider(mockProvider), sandbox);
    rows.push(row);
    worlds.set(q.id, world);
    log(`  ${q.id} ${row.structureOk ? 'ok  ' : 'MISS'} fid=${row.fidelity.toFixed(2)} ${row.hasWin ? `bot=${row.playFinal?.won ? 'win' : 'no '}` : '       '} ${row.ms}ms  ${q.prompt.slice(0, 60)}`);
  }
  const open = rows.filter((r) => !r.flagship);
  const win = {
    inVocabulary: winnability(open.filter((r) => !r.stretch)),
    stretch: winnability(open.filter((r) => r.stretch)),
    flagship: winnability(rows.filter((r) => r.flagship)),
  };

  // (1b) self-repair: break working games and physics scenes, run the loop.
  log('repair study');
  const repairRows: RepairRow[] = [];
  const repairSources = prompts.filter((q) => {
    const r = rows.find((x) => x.id === q.id);
    return r && !r.flagship && !r.stretch && r.verifyFinal && (q.kind === 'game' || q.kind === 'physics') && (r.hasWin ? r.playFinal?.won === true : true);
  });
  for (const q of repairSources.slice(0, quick ? 3 : 40)) {
    const w = worlds.get(q.id) as WorldDoc;
    const out = await repairStudy(q.id, w, sandbox);
    repairRows.push(...out);
  }
  const physics = repairRows.filter((r) => r.breaks === 'physics');
  const winRows = repairRows.filter((r) => r.breaks === 'winnability');

  // (2) edit versus regenerate.
  log('edit study');
  const editRows: EditRow[] = [];
  for (const b of bases) {
    const gen = await runAgent(b.prompt, { provider: recordingProvider(mockProvider()), sandbox });
    const base = await prepareBase(b.id, b.prompt, gen.world);
    const cases = editsFor(b.id, gen.world, quick ? 4 : 9);
    for (const c of cases) editRows.push(await runEdit(base, c, mockProvider, sandbox));
    log(`  ${b.id}: ${cases.length} edits`);
  }

  // (3) verification speed.
  log('speed study');
  const speedRows: SpeedRow[] = [];
  const speedPrompts = prompts.filter((q) => !q.flagship || !quick).filter((q) => {
    const w = worlds.get(q.id);
    return w && Object.keys(w.entities).length > 0 && !w.voxel;
  });
  for (const q of speedPrompts.slice(0, quick ? 5 : 100)) speedRows.push(await speedOf(q.id, worlds.get(q.id) as WorldDoc, quick ? 2 : 3));

  return {
    schema: 1,
    mode: quick ? 'quick' : 'full',
    machine: { node: process.version, cpus: cpus().length, platform: process.platform },
    assumptions: { tokensPerSecond: ASSUMED_TOKENS_PER_SECOND, tokenEstimate: 'ceil(characters / 4) of the canonical JSON', botSeconds: 150 },
    prompts: rows,
    winnability: win,
    repair: {
      rows: repairRows,
      verifyOnly: repairSummary(repairRows, 'verifyOnly'),
      withPlaytest: repairSummary(repairRows, 'withPlaytest'),
      physicsFaults: { verifyOnly: repairSummary(physics, 'verifyOnly'), withPlaytest: repairSummary(physics, 'withPlaytest') },
      winFaults: { verifyOnly: repairSummary(winRows, 'verifyOnly'), withPlaytest: repairSummary(winRows, 'withPlaytest') },
    },
    edits: { rows: editRows, summary: editSummary(editRows) },
    speed: { rows: speedRows, summary: speedSummary(speedRows) },
    coverage: coverageSummary(rows),
  };
}

const r1 = (v: number): number => Math.round(v * 10) / 10;

function slimArm(a: EditArm): Record<string, unknown> {
  const c = a.collateral;
  return {
    done: a.satisfied,
    share: Math.round(c.completion * 100) / 100,
    out: a.outputTokens,
    in: a.inputTokens,
    ops: a.patchOps,
    touched: a.entitiesTouched,
    localMs: r1(a.localMs),
    unrequested: c.collateralLeaves,
    unrequestedEntities: c.collateralEntities,
    changed: c.totalLeaves,
    ...(c.examples.length > 0 ? { examples: c.examples } : {}),
    verifyOk: a.verifyAfter,
    verifyRegression: a.verifyRegression,
    ...(a.winnableAfter !== null ? { winnable: a.winnableAfter, playRegression: a.playRegression } : {}),
  };
}

/**
 * The committed form of the results: the same numbers, but per-edit rows keep
 * only what a reader needs (the perfect-copy arm shares Aether's world, so only
 * its cost is stored). The summaries are computed before this step from the
 * full rows.
 */
export function slimResults(r: BenchResults): unknown {
  return {
    ...r,
    edits: {
      summary: r.edits.summary,
      rows: r.edits.rows.map((x) => ({
        id: x.case.id,
        base: x.case.baseId,
        kind: x.case.kind,
        request: x.case.request,
        baseWinnable: x.aether.winnableBefore,
        baseVerifies: x.aether.verifyBefore,
        aether: slimArm(x.aether),
        regenPerfectCopy: { out: x.regenOracle.outputTokens, in: x.regenOracle.inputTokens, ops: x.regenOracle.patchOps, localMs: r1(x.regenOracle.localMs) },
        regenFresh: slimArm(x.regenFresh),
      })),
    },
    speed: { summary: r.speed.summary, rows: r.speed.rows },
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await initPhysics();
  await initScripting().catch(() => undefined);
  const sandbox = createNodeSandbox({ timeoutMs: GENERATOR_DRY_RUN_MS });
  const t0 = performance.now();
  try {
    if (args.modelOnly) {
      if (args.provider === 'mock' || !args.allowModel) throw new Error('--model-only needs --provider=codex|claude-code and --allow-model');
      const model = await runModel(args, sandbox);
      const file = resolve(ROOT, `docs/benchmark/model-${model.name}.json`);
      if (args.write) await writeFile(file, `${compactJson(model)}\n`);
      process.stdout.write(`${renderModel(model)}\n`);
      return;
    }
    const results = await runBench({ quick: args.quick, sandbox, log });
    // (4b) optional: a signed-in model on the first prompts, hard-capped.
    if (args.provider !== 'mock') {
      if (!args.allowModel) throw new Error('refusing to call a model without --allow-model (calls are capped at --max-calls, never above 30)');
      results.provider = await runModel(args, sandbox);
    } else {
      // A model run is expensive and never part of `bench`; show the last committed one next to the offline numbers.
      const saved = await savedModelRun();
      if (saved) results.provider = saved;
    }

    const problems = args.check ? check(results) : [];
    if (args.write && !args.quick) {
      await mkdir(dirname(RESULTS_JSON), { recursive: true });
      await writeFile(RESULTS_JSON, `${compactJson(slimResults(results))}\n`);
      const md = await readFile(BENCHMARK_MD, 'utf8');
      await writeFile(BENCHMARK_MD, spliceResults(md, renderMarkdown(results)));
      log(`wrote ${RESULTS_JSON} and the results section of ${BENCHMARK_MD}`);
    }
    if (args.json) await writeFile(resolve(args.json), `${compactJson(slimResults(results))}\n`);

    process.stdout.write(`${renderMarkdown(results, { headlineOnly: args.quick })}\n`);
    log(`done in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    if (problems.length > 0) {
      log(`CHECK FAILED:\n  ${problems.join('\n  ')}`);
      process.exitCode = 1;
    } else if (args.check) log('checks passed');
  } finally {
    sandbox.dispose();
  }
}

/** The committed model run (docs/benchmark/model-codex.json), or undefined when absent or malformed. */
async function savedModelRun(): Promise<ProviderResults | undefined> {
  try {
    const raw: unknown = JSON.parse(await readFile(resolve(ROOT, 'docs/benchmark/model-codex.json'), 'utf8'));
    const o = raw as Partial<ProviderResults> | null;
    if (o && typeof o.name === 'string' && Array.isArray(o.prompts) && o.coverage && o.offlineCoverage && typeof o.callsUsed === 'number' && typeof o.maxCalls === 'number') return o as ProviderResults;
  } catch {
    /* no saved run */
  }
  return undefined;
}

/** Score a signed-in model on a spread of prompts, never above the call cap. */
async function runModel(args: Args, sandbox: ReturnType<typeof createNodeSandbox>): Promise<ProviderResults> {
  const inner = createHeadlessProvider(args.provider as 'codex' | 'claude-code', { effort: 'low' });
  const shared = recordingProvider(inner, args.maxCalls);
  // An even spread over the suite (games, physics, voxel, houses, scenes, stretch), not just the first prompts.
  const pool = PROMPTS.filter((q) => !q.flagship);
  const chosen = Array.from({ length: Math.min(args.limit, pool.length) }, (_, i) => pool[Math.floor((i * pool.length) / Math.min(args.limit, pool.length))] as (typeof pool)[number]);
  const rows: PromptRow[] = [];
  const offline: PromptRow[] = [];
  for (const q of chosen) {
    if (shared.calls() >= args.maxCalls) break;
    log(`  model: ${q.id} (${shared.calls()}/${args.maxCalls} calls)`);
    const { row } = await runPrompt(q, shared, sandbox, true);
    rows.push(row);
    offline.push((await runPrompt(q, freshProvider(mockProvider), sandbox, true)).row);
  }
  return { name: args.provider, callsUsed: shared.calls(), maxCalls: args.maxCalls, prompts: rows, coverage: coverageSummary(rows), offlineCoverage: coverageSummary(offline) };
}

/**
 * Claims the quick run must keep true. Each is something the documentation
 * says; a failure means a real regression (or an intentional change that
 * needs a fresh `npm run bench -- --write`).
 */
export function check(r: BenchResults): string[] {
  const bad: string[] = [];
  const ed = r.edits.summary;
  const need = (ok: boolean, msg: string): void => {
    if (!ok) bad.push(msg);
  };
  // The documented claims hold for the prompts marked `quick`; the rest of the suite is where Aether is measured, not asserted.
  const claimed = new Set(QUICK_PROMPTS.map((q) => q.id));
  for (const row of r.prompts) {
    need(row.error === undefined, `${row.id}: the agent errored (${row.error ?? ''})`);
    if (!claimed.has(row.id)) continue;
    if (row.kind === 'game') need(row.playFinal?.won === true, `${row.id}: the bot can no longer win this generated game (${row.playFinal?.why ?? 'no win condition'})`);
    need(row.structureOk, `${row.id}: structure check fails (${row.structureWhy})`);
    need(row.fidelity >= 1, `${row.id}: the world lost part of what was asked (missing ${row.missing.join(', ')})`);
    need(row.verifyFinal, `${row.id}: final verification fails`);
  }
  need(ed.edits >= 4, 'edit study produced too few edits');
  need(ed.aether.satisfied.rate >= 0.8, `Aether completes only ${(ed.aether.satisfied.rate * 100).toFixed(0)}% of the sampled edits (floor 80%)`);
  need(ed.aether.outputTokensMedian * 3 < ed.regenOracle.outputTokensMedian, 'a minimal patch is no longer at least 3x cheaper than re-emitting the world');
  need(ed.aether.collateralLeavesMean <= ed.regenFresh.collateralLeavesMean, 'Aether changes more unrequested properties than regeneration does');
  need(r.speed.summary.forkDriftMax < 1e-6, `a fork no longer replays exactly (drift ${r.speed.summary.forkDriftMax} m)`);
  need(r.speed.summary.verifyRealtimeMedian >= 5, `verification is only ${r.speed.summary.verifyRealtimeMedian}x real time (floor 5x)`);
  for (const row of r.repair.rows) {
    if (row.effective && row.breaks === 'physics') need(row.verifyOnly.repaired, `repair: ${row.worldId}/${row.fault} is no longer repaired by the loop`);
    if (row.effective && row.breaks === 'winnability') need(row.withPlaytest.repaired, `repair: ${row.worldId}/${row.fault} is no longer repaired with a playtest in the loop`);
  }
  return bad;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => {
    log(`benchmark crashed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    process.exitCode = 1;
  });
}
