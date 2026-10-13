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
import { validateWorld } from '@aether/core';
import { createMockProvider, WorldAgent, type AgentEvent } from '@aether/agent';
import { initScripting } from '@aether/logic';
import { initPhysics } from '@aether/physics';
import { GENERATOR_LIBRARY, loadLibraryGenerator, type SandboxRunner } from '@aether/procgen';
import { createNodeSandbox } from '@aether/procgen/node';
import { CATALOGS, GENERATOR_DRY_RUN_MS, NodeAgentHost, runVerify } from './lib/headless-world';
import { DEFAULT_PROMPTS } from './smoke-prompts';

/** `npx tsx scripts/smoke.ts "<prompt>"` runs only the given prompts. */
const PROMPTS: readonly string[] = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_PROMPTS;

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
  const agent = new WorldAgent({ provider: createMockProvider({ library: GENERATOR_LIBRARY }), catalogs: CATALOGS, resolveGenerator: loadLibraryGenerator, maxRepairs: 2 });
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
