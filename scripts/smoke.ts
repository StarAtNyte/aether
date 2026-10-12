/**
 * Cross-package smoke test: drives the real WorldAgent loop with the offline
 * mock provider against a Node AgentHost built from core History, physics
 * `verify` and the logic runtime (the same headless adapter the studio uses).
 *
 * Every prompt must produce a valid world whose verification passes, and the
 * agent loop must finish without error events. Exits non-zero otherwise.
 *
 * Run: `npm run smoke` (or `npx tsx scripts/smoke.ts`).
 */
import { performance } from 'node:perf_hooks';
import { createWorld, History, validateWorld, type GeneratorDef, type PatchResult, type ScriptDef, type WorldDoc } from '@aether/core';
import { createMockProvider, WorldAgent, type AgentCatalogs, type AgentEvent, type AgentHost } from '@aether/agent';
import { BEHAVIOR_CATALOG, RULE_DOCS, SCRIPT_API_DTS, createScriptRunner, initScripting, isScriptingReady } from '@aether/logic';
import { initPhysics, summarizeReport, verify } from '@aether/physics';
import { GENERATOR_API_DTS, GENERATOR_EXAMPLES, catalog, resolveParams, staticCheckSource, validateOutput, type SandboxRunner } from '@aether/procgen';
import { createNodeSandbox } from '@aether/procgen/node';
import { createVerifyLogic } from '../apps/studio/src/engine/headlessHost';
import { EXAMPLE_PROMPTS } from '../apps/studio/src/lib/examples';

/**
 * Prompts covering the showcase themes plus every example-gallery card
 * (one per line of the report). `npx tsx scripts/smoke.ts "<prompt>"` runs
 * only the given prompts.
 */
const DEFAULT_PROMPTS: readonly string[] = [
  'a cozy forest camp with a campfire and tents',
  'a domino run that knocks over a bell',
  'a coin collecting game: grab 8 coins before time runs out',
  'an asteroid field in space',
  'a bowling alley with ten pins',
  ...EXAMPLE_PROMPTS.map((e) => e.prompt),
];
const PROMPTS: readonly string[] = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_PROMPTS;

/** Headless verification limits (same order of magnitude as the studio). */
const VERIFY_MAX_SECONDS = 25;
const VERIFY_BUDGET_MS = 20_000;
const GENERATOR_DRY_RUN_MS = 1_000;

/** Catalogs for the agent's system prompt (same data the studio sends). */
const CATALOGS: AgentCatalogs = {
  generators: catalog(),
  behaviors: BEHAVIOR_CATALOG,
  ruleDocs: RULE_DOCS,
  generatorApiDts: GENERATOR_API_DTS,
  generatorExamples: GENERATOR_EXAMPLES,
  scriptApiDts: SCRIPT_API_DTS,
};

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Node AgentHost: History for edits, Rapier + logic for verification. */
class NodeAgentHost implements AgentHost {
  readonly history = new History(createWorld());
  verifyRuns = 0;

  constructor(private readonly sandbox: SandboxRunner) {}

  getWorld(): WorldDoc {
    return this.history.current;
  }

  applyPatches(patches: unknown[], message: string): PatchResult {
    return this.history.commit(patches, message, 'agent');
  }

  async verify(world: WorldDoc): Promise<{ report: unknown; summary: string; passed: boolean }> {
    this.verifyRuns++;
    return runVerify(world);
  }

  async validateGenerator(def: GeneratorDef): Promise<{ ok: boolean; error?: string }> {
    const check = staticCheckSource(def.source);
    if (!check.ok) return { ok: false, error: `rejected by static check: ${check.problems.slice(0, 5).join('; ')}` };
    try {
      const out = await this.sandbox.run(def, resolveParams(def.params, {}), 1, { timeoutMs: GENERATOR_DRY_RUN_MS });
      const v = validateOutput(out);
      return v.ok ? { ok: true } : { ok: false, error: v.error };
    } catch (err) {
      return { ok: false, error: errorText(err) };
    }
  }

  async validateScript(def: ScriptDef): Promise<{ ok: boolean; error?: string }> {
    if (!isScriptingReady()) return { ok: false, error: 'script sandbox unavailable' };
    const runner = createScriptRunner();
    try {
      runner.load(def);
      const problems = runner.takeDiagnostics().filter((d) => d.scriptId === def.id);
      return problems.length > 0 ? { ok: false, error: problems.map((p) => p.text).join('; ') } : { ok: true };
    } catch (err) {
      return { ok: false, error: errorText(err) };
    } finally {
      runner.dispose();
    }
  }
}

/** Run world tests + diagnostics with rules/behaviors hooked in. */
async function runVerify(world: WorldDoc): Promise<{ report: unknown; summary: string; passed: boolean }> {
  const hasScripts = Object.keys(world.scripts).length > 0;
  const logic = createVerifyLogic(world, {
    scripts: () => (hasScripts && isScriptingReady() ? createScriptRunner({ seed: world.seed }) : undefined),
  });
  try {
    const report = await verify(world, { logic: logic.factory, maxSeconds: VERIFY_MAX_SECONDS, budgetMs: VERIFY_BUDGET_MS });
    return { report, summary: summarizeReport(report), passed: report.passed };
  } finally {
    logic.dispose();
  }
}

interface SmokeResult {
  prompt: string;
  ok: boolean;
  entities: number;
  tests: number;
  agentVerifyPassed: boolean | null;
  finalVerifyPassed: boolean;
  ms: number;
  problems: string[];
}

async function runPrompt(prompt: string, sandbox: SandboxRunner): Promise<SmokeResult> {
  const t0 = performance.now();
  const host = new NodeAgentHost(sandbox);
  const agent = new WorldAgent({ provider: createMockProvider(), catalogs: CATALOGS, maxRepairs: 2 });
  const problems: string[] = [];
  let lastVerify: Extract<AgentEvent, { type: 'verify' }> | null = null;
  let done = false;

  for await (const ev of agent.run(prompt, host)) {
    if (ev.type === 'error') problems.push(`agent error: ${ev.text}`);
    else if (ev.type === 'verify') lastVerify = ev;
    else if (ev.type === 'patches' && ev.result.errors.length > 0) problems.push(`${ev.result.errors.length} rejected patch(es) in '${ev.message}'`);
    else if (ev.type === 'done') done = true;
  }
  if (!done) problems.push('agent loop ended without a done event');

  const world = host.getWorld();
  const valid = validateWorld(world);
  if (!valid.ok) problems.push(`invalid world: ${valid.issues.slice(0, 3).map((i) => `${i.path}: ${i.message}`).join('; ')}`);
  const entities = Object.keys(world.entities).length;
  if (entities === 0) problems.push('world is empty');

  // Independent re-verification of the final world (not trusting the agent's event).
  const final = await runVerify(world);
  if (!final.passed) problems.push(`final verify failed: ${final.summary}`);
  if (lastVerify && !lastVerify.passed) problems.push(`agent verify failed: ${lastVerify.summary}`);

  return {
    prompt,
    ok: problems.length === 0,
    entities,
    tests: world.tests.length,
    agentVerifyPassed: lastVerify ? lastVerify.passed : null,
    finalVerifyPassed: final.passed,
    ms: Math.round(performance.now() - t0),
    problems,
  };
}

async function main(): Promise<void> {
  const t0 = performance.now();
  await initPhysics();
  await initScripting().catch(() => undefined);

  const sandbox = createNodeSandbox({ timeoutMs: GENERATOR_DRY_RUN_MS });
  const results: SmokeResult[] = [];
  try {
    for (const prompt of PROMPTS) results.push(await runPrompt(prompt, sandbox));
  } finally {
    sandbox.dispose();
  }

  const rows = results.map((r) => ({
    prompt: r.prompt.length > 48 ? `${r.prompt.slice(0, 45)}...` : r.prompt,
    entities: r.entities,
    tests: r.tests,
    agentVerify: r.agentVerifyPassed === null ? 'n/a' : r.agentVerifyPassed ? 'pass' : 'FAIL',
    finalVerify: r.finalVerifyPassed ? 'pass' : 'FAIL',
    ms: r.ms,
    status: r.ok ? 'OK' : 'FAIL',
  }));
  console.table(rows);
  for (const r of results.filter((x) => !x.ok)) {
    console.error(`\n[FAIL] ${r.prompt}`);
    for (const p of r.problems) console.error(`  - ${p}`);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} prompts passed in ${Math.round(performance.now() - t0)} ms`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((err: unknown) => {
  console.error('smoke crashed:', err);
  process.exitCode = 1;
});
