/**
 * Bot probe: runs the verified-playable bot (a game) or the walkthrough bot (a building) headless on world files or
 * on what the offline planner builds for a prompt, and prints the verdict with its cost figures (wall time, steps,
 * simulated seconds, navigation grid size and search effort). For profiling the bot on generated worlds.
 *
 * Run: `npx tsx scripts/bot-probe.ts <file.json | "prompt:a night forest ..." | plan:building.json> ... [--list=inputs.txt] [--budget=20000] [--findings] [--progress]`
 * A file is a bare world or `{ world }`, a plan file a `create_building` plan; the default budget is the studio's (20 s of compute).
 */
import { readFileSync } from 'node:fs';
import { applyPatches, createWorld, validateWorld, type PatchInput, type WorldDoc } from '@aether/core';
import { applyArchOps } from '@aether/arch';
import { loadCatalog } from '@aether/assets';
import { clearColliderCache, initPhysics } from '@aether/physics';
import { playtest, playtestKindOf, walkthrough, type PlaytestProgress } from '@aether/playtest';
import { planMock } from '../packages/agent/src/providers/mock/planner';

/** The world the offline planner builds for a prompt (its patches, then its architecture ops). */
function applyPlanned(plan: ReturnType<typeof planMock>): WorldDoc {
  const env = applyPatches(createWorld(), plan.patches.filter((p) => p.op !== 'clear') as PatchInput[]);
  if (env.errors.length > 0) throw new Error(`plan patches failed: ${env.errors.map((e) => e.message).join('; ')}`);
  if (!plan.arch) return env.world;
  const built = applyArchOps(env.world, plan.arch.ops);
  if (built.errors.length > 0) throw new Error(built.errors.map((e) => e.message).join('; '));
  return built.target;
}

const args = process.argv.slice(2);
const budget = Number(args.find((a) => a.startsWith('--budget='))?.slice(9) ?? '0') || undefined;
const showFindings = args.includes('--findings');
const showProgress = args.includes('--progress');
const list = args.find((a) => a.startsWith('--list='))?.slice(7);
const inputs = [...args.filter((a) => !a.startsWith('--')), ...(list ? readFileSync(list, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith('#')) : [])];
if (inputs.length === 0) throw new Error('usage: bot-probe <file.json | prompt:...> ...');

function load(input: string): WorldDoc {
  if (input.startsWith('prompt:')) return applyPlanned(planMock(input.slice(7), ''));
  if (input.startsWith('plan:')) {
    // A building plan (`create_building`), compiled on an empty world.
    const built = applyArchOps(createWorld(), [{ op: 'create_building', plan: JSON.parse(readFileSync(input.slice(5), 'utf8')) as unknown }]);
    if (built.errors.length > 0) throw new Error(built.errors.map((e) => e.message).join('; '));
    return built.target;
  }
  const raw = JSON.parse(readFileSync(input, 'utf8')) as { world?: unknown };
  const checked = validateWorld(raw.world ?? raw);
  if (!checked.ok) throw new Error(`${input}: invalid world`);
  return checked.world;
}

await initPhysics();
// The studio's worker has the asset catalog loaded before a run (colliders, sizes of library models): so does the probe.
await loadCatalog();
for (const input of inputs) {
  const world = load(input);
  if (args.includes('--fresh')) clearColliderCache();
  const kind = playtestKindOf(world);
  const t0 = performance.now();
  const r = await (kind === 'walkthrough' ? walkthrough : playtest)(world, {
    trace: true,
    ...(budget ? { budgetMs: budget } : {}),
    ...(showProgress ? { onProgress: (p: PlaytestProgress) => process.stdout.write(`    ${p.seconds.toFixed(1)} s ${p.phase} ${p.note} ${p.position?.map((v) => v.toFixed(1)).join(',') ?? ''}\n`) } : {}),
  });
  const ms = performance.now() - t0;
  const s = r.stats;
  const done = r.objectives.filter((o) => o.status === 'done').length;
  process.stdout.write(
    `${input.slice(-60)}\n  ${kind} ${r.status} in ${ms.toFixed(0)} ms (sim ${r.seconds.toFixed(1)} s, ${r.steps} steps), ${done}/${r.objectives.length} objectives, ` +
      `nav ${s?.navNodes ?? 0} nodes @${s?.navCell ?? 0} m in ${s?.navMs.toFixed(0) ?? 0} ms, ${s?.searches ?? 0} searches (${s?.expanded ?? 0} expanded, ${s?.planMs.toFixed(0) ?? 0} ms), evasions ${s?.evasions ?? 0}\n  ${r.summary}\n`,
  );
  if (showFindings) for (const f of r.findings) process.stdout.write(`    ${f.severity} ${f.code}: ${f.message}\n`);
  if (showFindings) for (const o of r.objectives) if (o.status !== 'done') process.stdout.write(`    objective ${o.label} ${o.status}${o.reason ? `: ${o.reason}` : ''}\n`);
}
