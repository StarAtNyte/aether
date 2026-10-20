/**
 * House probe: compile the offline planner's plan for a prompt, list what each room got (and the notes), and with
 * `--walk` run the walkthrough bot over it (`--bare` drops the garden and the land round it, for comparison).
 *
 * Run: `npx tsx scripts/house-probe.ts "a scandinavian family house with a gable roof and 3 bedrooms" [--walk] [--bare]`
 */
import { applyPatches, createWorld, type PatchInput } from '@aether/core';
import { initPhysics } from '@aether/physics';
import { walkthrough } from '@aether/playtest';
import { compileBuilding } from '../packages/arch/src/compile';
import { applyArchOps } from '../packages/arch/src/ops';
import { planArch } from '../packages/agent/src/providers/mock/arch';

const args = process.argv.slice(2);
const prompt = args.find((a) => !a.startsWith('--')) ?? 'a two-storey modern house with a pool, an open-plan living room and kitchen, 2 bedrooms and residents';
const plan = planArch(prompt, '');
const op = plan?.arch?.ops[0] as { plan?: Record<string, unknown> } | undefined;
if (!plan || !op?.plan) throw new Error('no architecture plan for that prompt');
if (args.includes('--bare')) op.plan['site'] = { ...(op.plan['site'] as object), garden: false, surroundings: 'none' };
if (args.includes('--nosite')) delete op.plan['site'];
if (args.includes('--nodress')) for (const l of op.plan['levels'] as Array<{ rooms: Array<Record<string, unknown>> }>) for (const r of l.rooms) r['dress'] = false;
const out = compileBuilding(op.plan as Parameters<typeof compileBuilding>[0]);
const rooms = new Map<string, string[]>();
for (const e of out.entities) {
  const a = e.arch;
  if (!a?.room || (a.role !== 'furniture' && a.role !== 'fixture' && a.role !== 'light')) continue;
  rooms.set(a.room, [...(rooms.get(a.room) ?? []), a.kind ?? '?']);
}
for (const [room, kinds] of rooms) process.stdout.write(`${room}: ${kinds.sort().join(' ')}\n`);
process.stdout.write(`entities ${out.entities.length}; notes:\n${out.notes.map((n) => `  ${n}`).join('\n')}\n`);

async function walk(): Promise<void> {
  await initPhysics();
  const env = applyPatches(createWorld(), plan!.patches.filter((p) => p.op !== 'clear') as PatchInput[]);
  if (env.errors.length > 0) throw new Error(`environment patches failed: ${env.errors.map((e) => e.message).join('; ')}`);
  const built = applyArchOps(env.world, [op]);
  if (built.errors.length > 0) throw new Error(built.errors.map((e) => e.message).join('; '));
  const report = await walkthrough(built.target);
  process.stdout.write(`walkthrough: ${report.status} — ${report.summary}\n`);
  for (const f of report.findings.slice(0, 8)) process.stdout.write(`  ${f.code}: ${f.message}\n`);
}

if (args.includes('--walk')) await walk();
