/**
 * Rebuild the bundled "rebuilt from a photo" example rooms from the recorded photo runs
 * (tests/fixtures/photo/<id>.transcript.json, replayed through the unchanged photo pipeline by
 * scripts/eval-photo.ts) and write each world as a showcase world file. `showcase:bake` then verifies them.
 *
 * Run: `npm run showcase:photo-rooms` (all) or `npm run showcase:photo-rooms -- hotel pd1`.
 * Needs ffmpeg; also writes the card thumbnail from the final render when `--thumbs` is given.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stableStringify, validateWorld, type WorldDoc } from '@aether/core';
import { initPhysics } from '@aether/physics';
import { runVerify } from '../lib/headless-world';
import { SHOWCASE } from '../../apps/studio/src/showcase/manifest';

const ROOT = join(import.meta.dirname, '..', '..');
const OUT = join(ROOT, 'apps/studio/public/templates');
const THUMBS = process.argv.includes('--thumbs');
/** Bundled texture maps are served from here (see `TextureSetDef.base`). */
const TEXTURE_DIR = join(OUT, 'textures');
const TEXTURE_BASE = 'templates/textures';
const FILTERS = process.argv.slice(2).filter((a) => !a.startsWith('--'));

/** Fixture id of eval-photo for each photo file. */
const RUN_ID: Readonly<Record<string, string>> = { 'bedroom-cc0-hotel.jpg': 'hotel', 'bedroom-cc0-twin.jpg': 'twin', 'bedroom-pd-1.jpg': 'pd1', 'bedroom-pd-2.jpg': 'pd2' };

/** Same envelope and key order as bake.ts (bake --check compares byte for byte). */
const worldFileText = (world: WorldDoc): string => `${stableStringify({ format: 'aether-world', version: 1, world })}\n`;

/**
 * The recorded run ends mid-loop, so a piece the usability check still flags can remain (a curtain over tall furniture,
 * one with no window beside it). The checker names the fix ("Remove <id>: ..."); apply exactly those removals so the
 * bundled room passes verification, as the compare loop would have done next.
 */
async function repair(world: WorldDoc): Promise<{ world: WorldDoc; removed: string[]; passed: boolean }> {
  let cur = world;
  const removed: string[] = [];
  for (let i = 0; i < 6; i++) {
    const verdict = await runVerify(cur);
    if (verdict.passed) return { world: cur, removed, passed: true };
    const ids = [...new Set([...verdict.summary.matchAll(/Remove (room-photo-[\w-]+):/g)].map((m) => m[1] as string))].filter((id) => cur.entities[id]?.arch?.kind === 'curtain');
    if (ids.length === 0) break;
    const entities = { ...cur.entities };
    for (const id of ids) delete entities[id];
    removed.push(...ids);
    cur = { ...cur, entities };
  }
  return { world: cur, removed, passed: false };
}

await initPhysics();
// A full rebuild replaces every room's texture files (a filtered one keeps the others').
if (FILTERS.length === 0) rmSync(TEXTURE_DIR, { recursive: true, force: true });
const tmp = mkdtempSync(join(tmpdir(), 'photo-rooms-'));
let failed = 0;
try {
  for (const e of SHOWCASE.filter((x) => x.origin === 'photo' && x.photo)) {
    if (FILTERS.length > 0 && !FILTERS.some((f) => e.slug.includes(f) || RUN_ID[e.photo?.file ?? ''] === f)) continue;
    const id = RUN_ID[e.photo?.file ?? ''];
    if (!id) throw new Error(`${e.slug}: unknown photo file`);
    const r = spawnSync('npx', ['tsx', join(ROOT, 'scripts/eval-photo.ts'), `--photo=${id}`, '--mode=replay', ...(THUMBS ? ['--render=gpu'] : []), `--out=${tmp}`], { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'], encoding: 'utf8' });
    if (r.status !== 0) {
      console.error(`FAIL  ${e.slug}: replay exited ${r.status}`);
      failed++;
      continue;
    }
    const world = JSON.parse(readFileSync(join(tmp, id, 'world.json'), 'utf8')) as unknown;
    const v = validateWorld(world);
    if (!v.ok) {
      console.error(`FAIL  ${e.slug}: invalid world: ${v.issues[0]?.message}`);
      failed++;
      continue;
    }
    // The look the reviewing assistant chose for this room from its renders (exposure, grade, lights), recorded next to the transcript.
    const lookFile = join(ROOT, 'tests/fixtures/photo', `${id}.look.json`);
    let world0: WorldDoc = v.world;
    if (existsSync(lookFile)) {
      const look = JSON.parse(readFileSync(lookFile, 'utf8')) as { environment?: Record<string, unknown> };
      if (look.environment) world0 = { ...world0, environment: { ...world0.environment, ...look.environment } } as WorldDoc;
    }
    // Texture sets of the room are static files next to the worlds; the records point at them.
    if (world0.textures) {
      const textures = Object.fromEntries(Object.entries(world0.textures).map(([k, d]) => [k, { ...d, base: TEXTURE_BASE }]));
      world0 = { ...world0, textures } as WorldDoc;
      mkdirSync(TEXTURE_DIR, { recursive: true });
      const from = join(tmp, id, 'textures');
      if (existsSync(from)) for (const f of readdirSync(from)) copyFileSync(join(from, f), join(TEXTURE_DIR, f));
    }
    const fixed = await repair(world0);
    if (!fixed.passed) {
      console.error(`FAIL  ${e.slug}: still fails verification after removing ${fixed.removed.join(', ') || 'nothing'}`);
      failed++;
      continue;
    }
    if (fixed.removed.length > 0) console.log(`      ${e.slug}: removed ${fixed.removed.join(', ')} (flagged by the usability check)`);
    writeFileSync(join(OUT, 'worlds', `${e.slug}.json`), worldFileText(fixed.world));
    if (THUMBS) {
      const w = spawnSync('python3', ['-I', join(ROOT, 'scripts/showcase/to-webp.py'), join(tmp, id, 'final.png'), join(OUT, `${e.slug}.webp`), '640', '360', '60'], { stdio: 'inherit' });
      if (w.status !== 0) failed++;
    }
    console.log(`wrote ${e.slug} (${Object.keys(fixed.world.entities).length} entities)`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
process.exitCode = failed > 0 ? 1 : 0;
