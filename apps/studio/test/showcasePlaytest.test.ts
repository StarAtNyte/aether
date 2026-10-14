/**
 * Playtests of the bundled flagship games, on the exact world files the
 * studio ships (`public/templates/worlds/<slug>.json`): a bot plays the main
 * loop with keyboard-like input through real physics and logic and must
 * finish it — every pickup reachable, every lift ridable, the win screen
 * reachable.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateWorld, type Entity, type WorldDoc } from '@aether/core';
import { initPhysics } from '@aether/physics';
import { beforeAll, describe, expect, it } from 'vitest';
import { Bot } from './showcase/bot';
import { kartTrack } from '../../../packages/agent/src/providers/mock/showcase/kart-canyon';

function savedWorld(slug: string): WorldDoc {
  const text = readFileSync(fileURLToPath(new URL(`../public/templates/worlds/${slug}.json`, import.meta.url)), 'utf8');
  const raw = JSON.parse(text) as { world: unknown };
  const r = validateWorld(raw.world);
  if (!r.ok) throw new Error(`${slug}: invalid saved world`);
  return r.world;
}

function tagged(world: WorldDoc, tag: string): Entity[] {
  return Object.values(world.entities).filter((e) => e.tags.includes(tag));
}

beforeAll(async () => {
  await initPhysics();
});

describe('Lantern Isles playtest', () => {
  it('a bot crosses every bridge, rides every lift, gathers all twelve lanterns and wakes the Great Lantern', async () => {
    const world = savedWorld('lantern-isles');
    const isles = tagged(world, 'island').map((e) => ({ id: e.id, x: e.transform.position[0], z: e.transform.position[2], top: e.transform.position[1] + 0.35, r: (e.shape.kind === 'primitive' ? e.shape.size[0] : 2) / 2 }));
    const lifts = tagged(world, 'lift');
    const lanterns = tagged(world, 'lantern');
    expect(isles).toHaveLength(7);
    expect(lanterns).toHaveLength(12);
    const bot = await Bot.play(world);
    try {
      // Meet the guide first (she greets within 5 m).
      const guide = tagged(world, 'npc')[0] as Entity;
      expect(bot.walkTo(guide.transform.position[0], guide.transform.position[2] + 2, { radius: 1.5 })).toBe(true);
      expect(bot.host.messages.some((m) => m.startsWith('Mira:'))).toBe(true);
      for (let i = 1; i < isles.length; i++) {
        const from = isles[i - 1] as (typeof isles)[number];
        const to = isles[i] as (typeof isles)[number];
        const dx = to.x - from.x;
        const dz = to.z - from.z;
        const d = Math.hypot(dx, dz);
        const ux = dx / d;
        const uz = dz / d;
        const lift = lifts.find((l) => Math.hypot(l.transform.position[0] - (from.x + ux * (from.r + 2.4)), l.transform.position[2] - (from.z + uz * (from.r + 2.4))) < 1);
        if (!lift) {
          // Bridge: rim → far rim → into the island.
          expect(bot.walkTo(from.x + ux * (from.r - 1), from.z + uz * (from.r - 1), { timeout: 40 }), `reach the bridge to ${to.id}`).toBe(true);
          expect(bot.walkTo(to.x - ux * (to.r - 1.5), to.z - uz * (to.r - 1.5), { timeout: 40 }), `cross to ${to.id}`).toBe(true);
        } else {
          const lx = lift.transform.position[0];
          const lz = lift.transform.position[2];
          const bottom = lift.transform.position[1];
          // Wait at the rim for the lift to come down, step on, ride up, step off.
          expect(bot.walkTo(from.x + ux * (from.r - 0.8), from.z + uz * (from.r - 0.8), { timeout: 40 }), `reach the lift to ${to.id}`).toBe(true);
          expect(bot.waitUntil(() => Math.abs((bot.pw.getState(lift.id)?.position[1] ?? 0) - bottom) < 0.15, 30), 'lift comes down').toBe(true);
          expect(bot.walkTo(lx, lz, { radius: 0.35, timeout: 8 }), 'step onto the lift').toBe(true);
          expect(bot.waitUntil(() => bot.position[1] > to.top - 0.3, 30), `ride up to ${to.id}`).toBe(true);
          expect(bot.walkTo(to.x - ux * (to.r - 1.5), to.z - uz * (to.r - 1.5), { timeout: 20 }), `step off onto ${to.id}`).toBe(true);
        }
        expect(bot.position[1]).toBeGreaterThan(to.top - 0.5);
        // Gather this island's lanterns.
        for (const l of lanterns.filter((e) => Math.hypot(e.transform.position[0] - to.x, e.transform.position[2] - to.z) < to.r)) {
          expect(bot.walkTo(l.transform.position[0], l.transform.position[2], { radius: 0.5, timeout: 30 }), `reach ${l.id}`).toBe(true);
        }
      }
      expect(bot.state('lanterns')).toBe(12);
      const summit = isles[isles.length - 1] as (typeof isles)[number];
      // Touching the Great Lantern ends the game (the walk stops as soon as it does).
      bot.walkTo(summit.x, summit.z + 1.2, { radius: 0.3, timeout: 30 });
      bot.waitUntil(() => bot.outcome !== null, 5);
      expect(bot.outcome).toBe('win');
    } finally {
      bot.dispose();
    }
  }, 120_000);

  it('a fall returns the player to the last waystone', async () => {
    const world = savedWorld('lantern-isles');
    const bot = await Bot.play(world);
    try {
      const isle = tagged(world, 'island')[0] as Entity;
      // Walk off the edge of the home island.
      bot.walkTo(isle.transform.position[0] + 40, isle.transform.position[2], { timeout: 12 });
      bot.waitUntil(() => bot.position[1] > 15 && bot.time > 3, 20);
      expect(bot.position[1]).toBeGreaterThan(15);
      expect(bot.outcome).toBeNull();
    } finally {
      bot.dispose();
    }
  }, 60_000);
});

describe('Kart Canyon playtest', () => {
  it('a bot drives three laps through every checkpoint in order and takes the chequered flag', async () => {
    const world = savedWorld('kart-canyon');
    const track = kartTrack();
    const bot = await Bot.play(world);
    try {
      expect(bot.vehicle).not.toBeNull();
      let laps = 0;
      for (let lap = 0; lap < 3 && bot.outcome === null; lap++) {
        for (let i = 2; i < track.length && bot.outcome === null; i += 2) {
          const p = track[i] as [number, number, number];
          expect(bot.driveTo(p[0], p[2], { radius: 5, timeout: 25 }), `lap ${lap + 1}, waypoint ${i} at ${p.join(",")}, kart at ${bot.position.map((v) => v.toFixed(1)).join(",")} heading ${bot.heading.toFixed(0)} cp ${String(bot.state("cp"))}`).toBe(true);
        }
        // Back over the start line.
        const s = track[2] as [number, number, number];
        bot.driveTo(s[0], s[2], { radius: 5, timeout: 25 });
        laps = Number(bot.state('lap') ?? 0);
      }
      bot.waitUntil(() => bot.outcome !== null, 3);
      expect(laps).toBeGreaterThanOrEqual(2);
      expect(bot.outcome).toBe('win');
      expect(bot.time).toBeLessThan(240);
    } finally {
      bot.dispose();
    }
  }, 180_000);

  it('skipping a checkpoint does not count a lap', async () => {
    const world = savedWorld('kart-canyon');
    const track = kartTrack();
    const bot = await Bot.play(world);
    try {
      // Drive north up the straight, then turn back across the start line without the hairpin.
      const p = track[10] as [number, number, number];
      bot.driveTo(p[0], p[2], { radius: 5, timeout: 20 });
      const s = track[0] as [number, number, number];
      bot.driveTo(s[0], s[2] + 8, { radius: 5, timeout: 25 });
      expect(bot.state('lap')).toBe(0);
    } finally {
      bot.dispose();
    }
  }, 60_000);
});

describe('Chain Reaction playtest', () => {
  it('pressing Space sets off all five machines in turn and wins', async () => {
    const bot = await Bot.play(savedWorld('chain-reaction'));
    try {
      bot.step(0.5, { keys: ['space'] });
      bot.waitUntil(() => bot.outcome !== null, 30);
      expect(bot.state('machines')).toBe(5);
      expect(bot.outcome).toBe('win');
    } finally {
      bot.dispose();
    }
  }, 60_000);
});

describe('Sakura River Journey playtest', () => {
  it('a bot paddles the canoe down the river to the winter shrine', async () => {
    const { riverMeander } = await import('@aether/core');
    const bot = await Bot.play(savedWorld('sakura-river'));
    try {
      for (let z = 195; z >= -215 && bot.outcome === null; z -= 10) {
        // Reaching the shrine ends the game mid-stroke (the drive then stops early).
        const arrived = bot.driveTo(riverMeander(z, 520), z, { radius: 6, timeout: 30 });
        expect(arrived || bot.outcome !== null, `paddle to z=${z}, canoe at ${bot.position.map((v) => v.toFixed(1)).join(',')}`).toBe(true);
      }
      bot.waitUntil(() => bot.outcome !== null, 5);
      expect(bot.outcome).toBe('win');
      expect(Number(bot.state('lanterns'))).toBeGreaterThan(0);
    } finally {
      bot.dispose();
    }
  }, 180_000);
});
