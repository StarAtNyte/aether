/**
 * Bake the bundled default projects: every manifest entry's prompt is built
 * by the real agent loop with the offline planner (exactly what the editor
 * does without a model), independently re-verified with Rapier + logic, and
 * written as a compact world file to
 * `apps/studio/public/templates/worlds/<slug>.json` (the same envelope as
 * a world export). Fails when a world does not build, does not verify or
 * exceeds the import size limit.
 *
 * Run: `npm run showcase:bake` (all) or `npm run showcase:bake -- sakura kart`
 * (entries whose slug contains an argument). `--check` verifies that the
 * committed files are exactly what the planner produces today (no writes);
 * `--report` prints each world's verification summary.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { stableStringify, validateWorld, type WorldDoc } from '@aether/core';
import { createMockProvider, WorldAgent } from '@aether/agent';
import { initScripting } from '@aether/logic';
import { initPhysics } from '@aether/physics';
import { GENERATOR_LIBRARY, loadLibraryGenerator } from '@aether/procgen';
import { createNodeSandbox } from '@aether/procgen/node';
import { SHOWCASE, type ShowcaseEntry } from '../../apps/studio/src/showcase/manifest';
import { CATALOGS, GENERATOR_DRY_RUN_MS, NodeAgentHost, runVerify } from '../lib/headless-world';

const REPO_ROOT = join(import.meta.dirname, '..', '..');
const OUT_DIR = join(REPO_ROOT, 'apps/studio/public/templates/worlds');
/** Same limit as a world import in the studio. */
const MAX_BYTES = 5 * 1024 * 1024;

const ARGS = process.argv.slice(2);
const CHECK = ARGS.includes('--check');
/** `--report` prints every world's verification summary. */
const REPORT = ARGS.includes('--report');
const FILTERS = ARGS.filter((a) => !a.startsWith('--'));

/** The world file content for a baked world (stable key order, compact). */
export function worldFileText(world: WorldDoc): string {
  return `${stableStringify({ format: 'aether-world', version: 1, world })}\n`;
}

/**
 * A room rebuilt from a photo is not planned from its prompt: its world comes from the recorded photo run
 * (`npm run showcase:photo-rooms`) and is only re-validated and re-verified here, so the photo pipeline stays
 * reconstruct-only and nothing maps an uploaded photo to a stored room. A world the agent generated in a recorded run
 * (`origin: 'agent'`) is stored the same way: its file is the source, only re-validated and re-verified.
 */
async function bakePhoto(entry: ShowcaseEntry): Promise<{ text: string; entities: number; ms: number; stored: true }> {
  const t0 = performance.now();
  const text = readFileSync(join(OUT_DIR, `${entry.slug}.json`), 'utf8');
  const raw = JSON.parse(text) as { format?: string; world?: unknown };
  if (raw.format !== 'aether-world') throw new Error(`${entry.slug}: not an aether-world file`);
  const valid = validateWorld(raw.world);
  if (!valid.ok) throw new Error(`${entry.slug}: invalid world: ${valid.issues.slice(0, 3).map((i) => `${i.path}: ${i.message}`).join('; ')}`);
  if (worldFileText(valid.world) !== text) throw new Error(`${entry.slug}: world file is not in canonical form (run npm run showcase:photo-rooms for a photo room, or re-save the agent world)`);
  const verdict = await runVerify(valid.world);
  if (REPORT) console.log(verdict.summary);
  if (!verdict.passed) throw new Error(`${entry.slug}: verify failed: ${verdict.summary}`);
  return { text, entities: Object.keys(valid.world.entities).length, ms: Math.round(performance.now() - t0), stored: true };
}

async function bake(entry: ShowcaseEntry, sandbox: ReturnType<typeof createNodeSandbox>): Promise<{ text: string; entities: number; ms: number; stored?: true }> {
  if (entry.origin === 'photo' || entry.origin === 'agent') return bakePhoto(entry);
  const t0 = performance.now();
  const host = new NodeAgentHost(sandbox);
  const agent = new WorldAgent({ provider: createMockProvider({ library: GENERATOR_LIBRARY }), catalogs: CATALOGS, resolveGenerator: loadLibraryGenerator, maxRepairs: 2 });
  const problems: string[] = [];
  for await (const ev of agent.run(entry.prompt, host)) {
    if (ev.type === 'error') problems.push(`agent error: ${ev.text}`);
    else if (ev.type === 'patches' && ev.result.errors.length > 0) problems.push(`${ev.result.errors.length} rejected patch(es): ${ev.result.errors.slice(0, 6).map((e) => e.message).join(" | ")}`);
  }
  const world = host.getWorld();
  const valid = validateWorld(world);
  if (!valid.ok) problems.push(`invalid world: ${valid.issues.slice(0, 3).map((i) => `${i.path}: ${i.message}`).join('; ')}`);
  const verdict = await runVerify(world);
  if (REPORT) console.log(verdict.summary);
  if (!verdict.passed) problems.push(`verify failed: ${verdict.summary}`);
  if (problems.length > 0) throw new Error(`${entry.slug}: ${problems.join(' | ')}`);
  const text = worldFileText(world);
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error(`${entry.slug}: world file is ${Buffer.byteLength(text)} B (limit ${MAX_BYTES})`);
  return { text, entities: Object.keys(world.entities).length, ms: Math.round(performance.now() - t0) };
}

async function main(): Promise<void> {
  await initPhysics();
  await initScripting().catch(() => undefined);
  mkdirSync(OUT_DIR, { recursive: true });
  const sandbox = createNodeSandbox({ timeoutMs: GENERATOR_DRY_RUN_MS });
  let failed = 0;
  try {
    for (const entry of SHOWCASE) {
      if (FILTERS.length > 0 && !FILTERS.some((f) => entry.slug.includes(f))) continue;
      const file = join(OUT_DIR, `${entry.slug}.json`);
      try {
        const r = await bake(entry, sandbox);
        if (CHECK) {
          let current = '';
          try {
            current = readFileSync(file, 'utf8');
          } catch {
            // missing → reported below
          }
          if (current !== r.text) throw new Error(`${entry.slug}: ${current ? 'stale' : 'missing'} world file (run npm run showcase:bake)`);
          console.log(`ok    ${entry.slug.padEnd(22)} ${r.entities} entities, up to date`);
        } else if (r.stored) {
          console.log(`ok    ${entry.slug.padEnd(22)} ${r.entities} entities, stored world verified`);
        } else {
          writeFileSync(file, r.text);
          console.log(`baked ${entry.slug.padEnd(22)} ${r.entities} entities, ${(Buffer.byteLength(r.text) / 1024).toFixed(0)} KB, ${r.ms} ms`);
        }
      } catch (err) {
        failed++;
        console.error(`FAIL  ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    sandbox.dispose();
  }
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((err: unknown) => {
  console.error('bake crashed:', err);
  process.exitCode = 1;
});
