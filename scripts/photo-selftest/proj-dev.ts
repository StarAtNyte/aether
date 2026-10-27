/**
 * Fast loop for the instance raster (no models, seconds): the true pieces of every fixture through the pipeline raster against the true
 * masks, IoU per piece kind and the median over pieces. Needs the fixtures of `run.ts` (masks.json, truth.json).
 *   npx tsx scripts/photo-selftest/proj-dev.ts [--worlds=a,b]
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createWorld } from '@aether/core';
import { SELFTEST_WORLDS, type TruthMasks } from '../../packages/agent/src/photo/selftest/fixture';
import { median, type SelftestTruth } from '../../packages/agent/src/photo/selftest/metrics';
import { pipelinePose, projectionOracle } from '../../packages/agent/src/photo/selftest/oracle';

const args = process.argv.slice(2);
const want = args.find((a) => a.startsWith('--worlds='))?.slice(9).split(',');
const root = join(homedir(), '.local/share/aether/qa/selftest');
const byKind = new Map<string, number[]>();
const meds: number[] = [];
for (const w of readdirSync(root).sort()) {
  if (!statSync(join(root, w)).isDirectory() || (want ? !want.includes(w) : !SELFTEST_WORLDS.some((x) => x.name === w))) continue;
  const raw = JSON.parse(readFileSync(resolve('apps/studio/public/templates/worlds', `${w}.json`), 'utf8')) as { world?: unknown };
  const world = createWorld((raw.world ?? raw) as never);
  for (const p of readdirSync(join(root, w)).sort()) {
    const dir = join(root, w, p);
    if (!existsSync(join(dir, 'truth.json'))) continue;
    const truth = JSON.parse(readFileSync(join(dir, 'truth.json'), 'utf8')) as SelftestTruth;
    const masks = JSON.parse(readFileSync(join(dir, 'masks.json'), 'utf8')) as TruthMasks;
    const pose = pipelinePose(world as never, truth);
    const r = pose ? projectionOracle(world as never, pose, truth, masks) : null;
    if (!r) continue;
    meds.push(r.median as number);
    for (const x of r.rows) byKind.set(x.kind, [...(byKind.get(x.kind) ?? []), x.iou]);
  }
}
for (const [k, v] of [...byKind].sort((a, b) => (median(a[1]) as number) - (median(b[1]) as number))) console.log(`${k.padEnd(14)} n=${String(v.length).padStart(3)} median IoU ${(median(v) as number).toFixed(2)}`);
console.log(`median of photo medians ${median(meds)}  median over pieces ${median([...byKind.values()].flat())}`);
