/**
 * Every shipped game, played start to finish by the verified-playable bot on
 * the exact world file the studio ships, and sealed. Worlds the bot cannot
 * drive (orbit view, vehicles, block worlds, one-button machines) are played
 * to their ending by the hand-written bots in `showcasePlaytest.test.ts`,
 * `voxelSession.test.ts` and the voxel game tests; this table says which is
 * which, so a new game cannot ship without one of the two.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateWorld, type WorldDoc } from '@aether/core';
import { initPhysics } from '@aether/physics';
import { playtest, toProof, unsupportedReason } from '@aether/playtest';
import { checkProof, createProof } from '@aether/verifier';
import { beforeAll, describe, expect, it } from 'vitest';
import { SHOWCASE } from '../src/showcase/manifest';

function savedWorld(slug: string): WorldDoc {
  const text = readFileSync(fileURLToPath(new URL(`../public/templates/worlds/${slug}.json`, import.meta.url)), 'utf8');
  const raw = JSON.parse(text) as { world: unknown };
  const r = validateWorld(raw.world);
  if (!r.ok) throw new Error(`${slug}: invalid saved world`);
  return r.world;
}

/** Games the bot plays itself: it must win, and its run must seal. */
const BOT_PLAYS = ['chain-reaction', 'highland-trail', 'lantern-isles', 'hollow-gate', 'neon-rain-city', 'kyoto-temple', 'orbital-lab', 'painterly-meadow', 'four-seasons-garden'] as const;

/** Why the bot cannot drive the rest, and what plays them to the end instead. */
const OTHER_BOTS: Record<string, string> = {
  'kart-canyon': 'vehicle: showcasePlaytest.test.ts drives three laps',
  'sakura-river': 'vehicle: showcasePlaytest.test.ts paddles the river',
  blockfall: 'block world: blockfallPlaythrough.test.ts plays the shipped survival game through a day and night',
  'skyline-penthouse': 'architecture: walked by the walkthrough bot',
  'dusk-lake-house': 'architecture: walked by the walkthrough bot',
  'casa-patio': 'architecture: walked by the walkthrough bot',
  'kestrel-outpost': 'shooter: packages/agent/test/kestrel-outpost.test.ts fights all five waves to an ending with the weapon',
};

beforeAll(async () => {
  await initPhysics();
});

describe('every featured world has a player that finishes it', () => {
  it('is covered by the bot or by a named hand-written playtest', () => {
    for (const e of SHOWCASE.filter((x) => x.curation === 'featured')) {
      const covered = (BOT_PLAYS as readonly string[]).includes(e.slug) || Object.hasOwn(OTHER_BOTS, e.slug);
      expect(covered, `${e.slug} has no playtest`).toBe(true);
    }
  });

  it('the games the table sends to other bots are really unsupported by the verified bot', () => {
    for (const slug of ['kart-canyon', 'sakura-river', 'blockfall']) expect(unsupportedReason(savedWorld(slug)), slug).not.toBeNull();
  });
});

describe.each(BOT_PLAYS)('%s: the verified-playable bot', (slug) => {
  it('wins on the shipped world and the sealed run checks out', async () => {
    const world = savedWorld(slug);
    expect(world.intro, 'a title card').toBeTruthy();
    expect(world.rules.some((r) => r.then.some((a) => a.do === 'win')) || Object.values(world.entities).some((e) => e.behaviors.some((b) => b.type === 'goal')), 'a way to win').toBe(true);
    const report = await playtest(world);
    expect(report.summary).toContain('Verified playable');
    expect(report.status).toBe('passed');
    expect(report.findings.filter((f) => f.severity === 'error')).toEqual([]);
    const proof = await createProof(world, { playtest: toProof(report) });
    expect(proof.playtest, 'a passed run is sealed').toBeDefined();
    expect((await checkProof(proof, world)).status).toBe('verified');
  }, 180_000);
});
