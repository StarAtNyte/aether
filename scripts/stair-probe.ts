/**
 * Stair probe: measures every stair of a building plan (or of the buildings in a world file) the way the tools do,
 * prints what settling the plan would move, and the building check of the plan as drawn and as settled.
 *
 * Run: `npx tsx scripts/stair-probe.ts <plan.json | world.json> ...`
 */
import { readFileSync } from 'node:fs';
import { createWorld, type WorldDoc } from '@aether/core';
import { applyArchOps, checkBuilding, checkStair, parsePlan, settleStairs } from '@aether/arch';

for (const input of process.argv.slice(2)) {
  const raw = JSON.parse(readFileSync(input, 'utf8')) as { entities?: Record<string, { arch?: { role?: string; plan?: unknown } }>; world?: WorldDoc };
  const entities = raw.world?.entities ?? raw.entities;
  const plans = entities ? Object.values(entities).filter((e) => e.arch?.role === 'building' && e.arch.plan !== undefined).map((e) => e.arch?.plan) : [raw];
  for (const p of plans) {
    const plan = parsePlan(p);
    process.stdout.write(`${input.slice(-50)} ${plan.id}\n`);
    plan.levels.forEach((l, li) =>
      l.stairs.forEach((s, si) => {
        const c = checkStair(plan, li, s, undefined, l.stairs.filter((_, k) => k !== si));
        process.stdout.write(`  level ${li} stair ${si} ${JSON.stringify(s)}: ${c.problems.length === 0 ? 'works' : c.problems.join('; ')}\n`);
      }),
    );
    const settled = settleStairs(plan);
    for (const m of settled.moved) process.stdout.write(`  moved: ${m}\n`);
    for (const f of settled.failing) process.stdout.write(`  failing: ${f}\n`);
    for (const exact of [true, false]) {
      const res = applyArchOps(createWorld(), [{ op: 'create_building', plan: p, exactStairs: exact }]);
      const rep = checkBuilding(res.target, plan.id);
      process.stdout.write(`  building check (${exact ? 'as drawn' : 'settled'}): ${rep.reachable}/${rep.rooms} rooms${rep.issues.map((i) => `\n    ${i.code}: ${i.message}\n      fix: ${i.hint}`).join('')}\n`);
    }
  }
}
