/**
 * Walkthrough probe: runs the walkthrough bot on a shipped template (optionally without its residents) and prints the
 * verdict and every finding. `npx tsx scripts/walk-probe.ts <slug|file.json> [--no-people]`
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateWorld } from '@aether/core';
import { initPhysics } from '@aether/physics';
import { walkthrough, withoutEntities } from '@aether/playtest';

const slug = process.argv[2];
if (!slug) throw new Error('usage: walk-probe <slug> [--no-people]');
const text = readFileSync(slug.endsWith('.json') ? slug : join(import.meta.dirname, '..', 'apps/studio/public/templates/worlds', `${slug}.json`), 'utf8');
const checked = validateWorld((JSON.parse(text) as { world: unknown }).world);
if (!checked.ok) throw new Error('invalid world');
let world = checked.world;
if (process.argv.includes('--no-people')) {
  const ids = Object.values(world.entities).filter((e) => e.arch?.role === 'resident').map((e) => e.id);
  world = withoutEntities(world, new Set(ids));
  process.stdout.write(`removed ${ids.length} residents\n`);
}
await initPhysics();
const r = await walkthrough(world);
process.stdout.write(`${r.status}: ${r.summary}\n`);
for (const f of r.findings) process.stdout.write(`  finding ${f.code}: ${f.message}\n`);
for (const o of r.objectives) if (o.status !== 'done') process.stdout.write(`  objective ${o.id} ${o.status}\n`);
