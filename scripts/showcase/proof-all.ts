/**
 * Plays the bundled flagship worlds with the verified-playable bot and checks the sealed replay of each win.
 *
 * Run: `npx tsx scripts/showcase/proof-all.ts [slug …]` (default: the six action, city and story flagships).
 * Prints one line per world: bot status, how long (simulated seconds) the winning run took, and whether the
 * independent replay of the sealed proof verifies. Exits non-zero when any world is not playable or not sealed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { validateWorld, type WorldDoc } from '@aether/core';
import { initScripting } from '@aether/logic';
import { initPhysics } from '@aether/physics';
import { playtest } from '@aether/playtest';
import { checkProof, createProof } from '@aether/verifier';

const ROOT = join(import.meta.dirname, '..', '..');
const DEFAULT = ['hollow-gate', 'kart-canyon', 'neon-rain-city', 'kyoto-temple', 'orbital-lab', 'chain-reaction'];

function load(slug: string): WorldDoc {
  const raw = JSON.parse(readFileSync(join(ROOT, 'apps/studio/public/templates/worlds', `${slug}.json`), 'utf8')) as { world: unknown };
  const r = validateWorld(raw.world);
  if (!r.ok) throw new Error(`${slug}: invalid template`);
  return r.world;
}

async function main(): Promise<void> {
  await initPhysics();
  await initScripting();
  const slugs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  let failed = 0;
  for (const slug of slugs.length > 0 ? slugs : DEFAULT) {
    const t0 = performance.now();
    const world = load(slug);
    const report = await playtest(world, { trace: false });
    let sealed = 'skipped';
    if (report.status === 'passed') {
      const proof = await createProof(world);
      const check = await checkProof(JSON.parse(JSON.stringify(proof)), world);
      sealed = check.playable ? 'sealed-playable' : `NOT PLAYABLE (${check.status})`;
      if (!check.playable) failed++;
    } else failed++;
    process.stdout.write(`${slug.padEnd(16)} bot=${report.status.padEnd(8)} ${sealed.padEnd(16)} ${((performance.now() - t0) / 1000).toFixed(1)}s  ${report.summary.replace(/\s+/g, ' ').slice(0, 160)}\n`);
  }
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`);
  process.exitCode = 1;
});
