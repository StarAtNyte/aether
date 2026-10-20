/**
 * Walkthroughs of the bundled architecture flagships, on the exact world files the studio ships
 * (`public/templates/worlds/<slug>.json`): the walkthrough bot enters at the player spawn, with the residents standing in
 * their rooms, and must walk every room through its doors and up its stairs. The residents are NPC capsules (kinematic
 * bodies): if one stood in a doorway or a walkway the bot could not get past, so this is also the proof that the people
 * of a house never block it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateWorld, type WorldDoc } from '@aether/core';
import { initPhysics } from '@aether/physics';
import { walkthrough } from '@aether/playtest';
import { PLAYER_PSEUDO_ID } from '../src/config';
import { terrainHeight } from '../../../packages/agent/src/providers/mock/showcase/kit';
import { Bot } from './showcase/bot';
import { beforeAll, describe, expect, it } from 'vitest';

function savedWorld(slug: string): WorldDoc {
  const text = readFileSync(fileURLToPath(new URL(`../public/templates/worlds/${slug}.json`, import.meta.url)), 'utf8');
  const raw = JSON.parse(text) as { world: unknown };
  const r = validateWorld(raw.world);
  if (!r.ok) throw new Error(`${slug}: invalid saved world`);
  return r.world;
}

beforeAll(async () => {
  await initPhysics();
});

describe.each([
  ['casa-patio', 3],
  ['skyline-penthouse', 2],
  ['dusk-lake-house', 2],
])('%s walkthrough with its people', (slug, people) => {
  it('has the people, and a bot still walks every room and opens every door', async () => {
    const world = savedWorld(slug);
    const residents = Object.values(world.entities).filter((e) => e.arch?.role === 'resident');
    expect(residents).toHaveLength(people);
    for (const r of residents) {
      expect(r.character).toBeDefined();
      expect(r.npc?.dialogue).toBeDefined();
      expect(r.shape.kind === 'primitive' && r.shape.primitive).toBe('capsule');
    }
    const report = await walkthrough(world);
    expect(report.status, report.summary).toBe('passed');
    expect(report.objectives.every((o) => o.status === 'done'), report.summary).toBe(true);
    expect(report.findings.filter((f) => f.code === 'door_blocked')).toEqual([]);
  }, 240_000);
});

describe.each(['casa-patio', 'dusk-lake-house'])('%s landscape', (slug) => {
  it('the player stands on the terrain wherever it is dropped: the plot at y = 0, the lawn and the hillside at the height of the ground', async () => {
    const world = savedWorld(slug);
    const land = Object.values(world.entities).find((e) => e.tags.includes('terrain'));
    if (land?.shape.kind !== 'procedural') throw new Error('no terrain');
    const raw = terrainHeight(land.shape.params, land.shape.seed ?? 0, Number(land.shape.params['size']));
    const heightAt = (x: number, z: number): number => raw(x, z) + land.transform.position[1];
    const bot = await Bot.play(world);
    try {
      const probes: Array<[number, number]> = slug === 'casa-patio' ? [[-30, 40], [30, 30], [-60, -45], [0, 60]] : [[30, 22], [-12, 14], [40, -20], [7, 52]];
      for (const [x, z] of probes) {
        bot.host.teleport(PLAYER_PSEUDO_ID, [x, heightAt(x, z) + 3, z]);
        bot.step(2);
        const y = bot.position[1];
        // Feet at the ground (the capsule's origin is at its feet or its centre within a metre).
        expect(Math.abs(y - heightAt(x, z)), `${slug} at ${x},${z}: stands at ${y.toFixed(2)}, ground ${heightAt(x, z).toFixed(2)}`).toBeLessThan(1.1);
      }
      // The house plot is level at y = 0 (the floor starts at the plinth).
      bot.host.teleport(PLAYER_PSEUDO_ID, [world.player.spawn[0] + 40, 3, world.player.spawn[2] + 5]);
      bot.step(2);
      expect(Math.abs(bot.position[1] - heightAt(world.player.spawn[0] + 40, world.player.spawn[2] + 5))).toBeLessThan(1.1);
      expect(Math.abs(heightAt(0, 0))).toBeLessThan(0.05);
    } finally {
      bot.dispose();
    }
  }, 120_000);
});
