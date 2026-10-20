/**
 * Print what the offline planner builds for a prompt (entity count, generators used, scatter instances), for look
 * development of generated worlds without a browser.
 *
 * Run: `npx tsx scripts/genplan-probe.ts "a night forest adventure ..." [--json=out.json]`
 */
import { writeFileSync } from 'node:fs';
import { planMock } from '../packages/agent/src/providers/mock/planner';

const args = process.argv.slice(2);
const prompt = args.find((a) => !a.startsWith('--')) ?? 'a forest camp';
const out = args.find((a) => a.startsWith('--json='))?.slice(7);
const t0 = performance.now();
const plan = planMock(prompt, '');
const ms = performance.now() - t0;
const gens = new Map<string, number>();
let entities = 0;
let instances = 0;
for (const p of plan.patches) {
  if (p.op !== 'add' || !p.entity) continue;
  entities++;
  const shape = p.entity.shape as { kind?: string; generator?: string; count?: number; of?: { generator?: string; kind?: string; primitive?: string }; primitive?: string; id?: string } | undefined;
  const key = shape?.kind === 'scatter' ? `scatter:${shape.of?.generator ?? shape.of?.primitive ?? '?'}` : shape?.kind === 'procedural' ? `gen:${shape.generator}` : shape?.kind === 'asset' ? `asset:${shape.id}` : `${shape?.kind ?? 'none'}:${shape?.primitive ?? ''}`;
  gens.set(key, (gens.get(key) ?? 0) + (shape?.kind === 'scatter' ? (shape.count ?? 0) : 1));
  if (shape?.kind === 'scatter') instances += shape.count ?? 0;
}
process.stdout.write(`${plan.plan}\n${plan.message}\n${entities} entities, ${instances} scatter instances, ${plan.patches.length} patches, ${ms.toFixed(0)} ms, ${(JSON.stringify(plan.patches).length / 1024).toFixed(0)} KB\n`);
for (const [k, v] of [...gens].sort((a, b) => b[1] - a[1])) process.stdout.write(`  ${k}: ${v}\n`);
if (out) writeFileSync(out, JSON.stringify(plan, null, 1));
