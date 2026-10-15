/**
 * Determinism: every bundled game seals and re-verifies, and the replay of a
 * few pinned games hashes to the recorded values. The pins are what keeps
 * `REPLAY_ENGINE` honest: if a physics, rules or trace change moves them, the
 * engine version must be bumped (and the pins regenerated with
 * `UPDATE_GOLDEN=1`), because proofs sealed before the change no longer
 * replay to the same outcome.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateWorld } from '@aether/core';
import { REPLAY_ENGINE, checkProof, createProof } from '../src/index';
import { pinnedWorlds } from './fixtures';

const TEMPLATES = new URL('../../../apps/studio/public/templates/worlds/', import.meta.url);
const GOLDEN = new URL('./golden.json', import.meta.url);

interface Golden {
  engine: string;
  worlds: Record<string, { world: string; claim: string; trace: string | null; tests: number; passed: boolean }>;
}

describe('every bundled game', () => {
  it('seals and then re-verifies as exactly what was sealed', async () => {
    const slugs = readdirSync(TEMPLATES).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
    for (const slug of slugs) {
      const raw = JSON.parse(readFileSync(new URL(`${slug}.json`, TEMPLATES), 'utf8')) as { world: unknown };
      const v = validateWorld(raw.world);
      if (!v.ok) continue;
      const proof = await createProof(v.world, { now: 1 });
      const check = await checkProof(JSON.parse(JSON.stringify(proof)), v.world);
      expect(check.status, `${slug}: ${check.differences.join('; ')}`).toBe('verified');
    }
  }, 120_000);
});

describe('pinned replays', () => {
  it('hash to the recorded values for this engine version', async () => {
    const now: Golden = { engine: REPLAY_ENGINE, worlds: {} };
    for (const [slug, world] of Object.entries(pinnedWorlds())) {
      const proof = await createProof(world, { now: 1 });
      now.worlds[slug] = { world: proof.world.hash, claim: proof.claim.hash, trace: proof.trace?.hash ?? null, tests: proof.claim.tests.length, passed: proof.claim.passed };
    }
    if (process.env['UPDATE_GOLDEN'] === '1') {
      writeFileSync(GOLDEN, `${JSON.stringify(now, null, 2)}\n`);
      return;
    }
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Golden;
    expect(golden.engine, 'bump REPLAY_ENGINE together with regenerating golden.json').toBe(REPLAY_ENGINE);
    expect(now.worlds).toEqual(golden.worlds);
    for (const w of Object.values(now.worlds)) expect(w.passed).toBe(true);
  }, 60_000);
});
