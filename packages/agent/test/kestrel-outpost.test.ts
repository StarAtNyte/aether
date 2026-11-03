/**
 * Kestrel Outpost plays as a shooter, headless: Rapier physics, the logic runtime and a human-like bot (`kestrel-bot.ts`).
 * The waves must come and advance, raiders must die and drop loot, the player and the relay must take fire, the session
 * must end, and the difficulty must suit a person: wave 1 survived, about half reaching wave 4, wave 5 hard but winnable.
 */
import { applyPatches, createWorld, type WorldDoc } from '@aether/core';
import { initPhysics } from '@aether/physics';
import { beforeAll, describe, expect, it } from 'vitest';
import { KESTREL_WAVES, kestrelOutpost } from '../src/providers/mock/showcase/kestrel-outpost';
import { playKestrel, type BotRun } from './kestrel-bot';

function world(): WorldDoc {
  const r = applyPatches(createWorld(), kestrelOutpost().patches);
  expect(r.errors.map((e) => e.message)).toEqual([]);
  return r.world;
}

describe('Kestrel Outpost', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('is a shooter world: a weapon, an over-the-shoulder player, raider templates for every pass, a relay to defend', () => {
    const w = world();
    expect(w.player.weapon?.magazine).toBeGreaterThan(0);
    expect(w.player.character?.hold).toBe('rifle');
    expect(w.intro?.button).toBe('Play');
    const templates = Object.values(w.entities).filter((e) => e.template && e.npc);
    expect(templates.length).toBe(9);
    for (const t of templates) {
      expect(t.character).toBeDefined();
      expect(t.npc?.enemies).toContain('player');
      expect(t.npc?.drops?.length).toBeGreaterThan(0);
    }
    expect(w.entities['relay']?.npc?.allies).toContain('player');
    expect(w.hud.map((h) => h.key)).toEqual(['wave', 'alive', 'relay.health', 'health', 'score']);
  });

  it('plays: waves advance, raiders die and drop loot, the player and the relay take fire, and the game ends', async () => {
    const r = await playKestrel(world(), { seed: 7, skill: 0.5 });
    expect(r.waveMax).toBeGreaterThanOrEqual(2);
    expect(r.kills).toBeGreaterThanOrEqual(6);
    expect(r.hits).toBeGreaterThan(0);
    expect(r.drops).toBeGreaterThan(0);
    expect(r.minHealth).toBeLessThan(100);
    expect(r.outcome === 'win' || r.outcome === 'lose').toBe(true);
    if (r.outcome === 'win') expect(r.waveMax).toBe(KESTREL_WAVES);
  }, 120_000);

  it('is balanced for a human: wave 1 is survived, about half reach wave 4, wave 5 is hard but winnable', async () => {
    // 32 human-like players (reaction delay, flick-and-settle aim, bursts; skill 0.2 to 0.8) on varied world seeds.
    const w = world();
    const runs: BotRun[] = [];
    for (let i = 0; i < 32; i++) runs.push(await playKestrel({ ...w, seed: 101 + i * 31 }, { seed: 1000 + i * 7919, skill: 0.2 + (0.6 * (i % 6)) / 5 }));
    const share = (f: (r: BotRun) => boolean): number => runs.filter(f).length / runs.length;
    const wave1 = share((r) => r.cleared >= 1);
    const wave4 = share((r) => r.waveMax >= 4);
    const wins = share((r) => r.outcome === 'win');
    // eslint-disable-next-line no-console
    console.log(`kestrel balance: cleared wave 1 ${Math.round(wave1 * 100)}%, reached wave 4 ${Math.round(wave4 * 100)}%, won ${Math.round(wins * 100)}%`);
    expect(wave1).toBeGreaterThanOrEqual(0.9);
    expect(wave4).toBeGreaterThanOrEqual(0.3);
    expect(wave4).toBeLessThanOrEqual(0.75);
    expect(wins).toBeGreaterThan(0);
    expect(wins).toBeLessThanOrEqual(0.4);
    // Nobody is hit in the first seconds: wave 1 gives time to find cover.
    for (const r of runs) if (r.firstHurt >= 0) expect(r.firstHurt).toBeGreaterThan(8);
  }, 300_000);
});
