/**
 * Playtest of The Hollow Gate on the exact world file the studio ships: a bot
 * plays the main loop through real physics and logic with every character
 * active (a patrolling guard, a shopkeeper, a hunting wolf pack, villagers):
 * it earns gold, talks to Mira, buys the key, walks to the gate and leaves.
 * Also: the guard really reacts to the bot, the wolves keep away from fire,
 * and nothing falls through the floor or gets stuck over a long idle run.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateWorld } from '@aether/core';
import { initPhysics, verify } from '@aether/physics';
import { beforeAll, describe, expect, it } from 'vitest';
import { createVerifyLogic } from '../src/engine/headlessHost';
import { Bot } from './showcase/bot';
function savedWorld(slug) {
    const text = readFileSync(fileURLToPath(new URL(`../public/templates/worlds/${slug}.json`, import.meta.url)), 'utf8');
    const raw = JSON.parse(text);
    const r = validateWorld(raw.world);
    if (!r.ok)
        throw new Error(`${slug}: invalid saved world`);
    return r.world;
}
const byRole = (w, role) => Object.values(w.entities).filter((e) => e.npc?.role === role);
beforeAll(async () => {
    await initPhysics();
});
describe('The Hollow Gate: the shipped world', () => {
    const world = savedWorld('hollow-gate');
    it('has all three archetypes plus villagers, each a plain entity.npc', () => {
        expect(byRole(world, 'guard')).toHaveLength(1);
        expect(byRole(world, 'shopkeeper')).toHaveLength(1);
        expect(byRole(world, 'wolf')).toHaveLength(3);
        expect(byRole(world, 'villager')).toHaveLength(2);
        const marek = byRole(world, 'guard')[0];
        expect(marek.npc?.carries).toContain('torch');
        expect(marek.npc?.waypoints.length).toBe(2);
        for (const wolf of byRole(world, 'wolf'))
            expect(wolf.npc).toMatchObject({ fears: ['fire'], activeHours: [19, 6] });
    });
    it('passes its own verification, including the npcs test, with real physics', async () => {
        const logic = createVerifyLogic(world);
        try {
            const report = await verify(world, { logic: logic.factory, maxSeconds: 20, budgetMs: 20_000 });
            expect(report.results.filter((r) => !r.passed)).toEqual([]);
            expect(report.results.some((r) => r.kind === 'npcs' && r.passed)).toBe(true);
            expect(report.passed).toBe(true);
        }
        finally {
            logic.dispose();
        }
    });
    it('a bot earns gold, buys the key from Mira, passes the guard and leaves through the gate', async () => {
        const bot = await Bot.play(world);
        try {
            const npcs = bot.runtime.npcs;
            expect(npcs.count).toBe(7);
            // Gold near the spawn, the road and the fire (none of it near the wolves).
            for (const [x, z] of [[3, 21], [-2, 10], [11, 7]])
                expect(bot.walkTo(x, z, { radius: 0.9, timeout: 25 }), `gold at ${x},${z}`).toBe(true);
            expect(Number(bot.state('coins'))).toBeGreaterThanOrEqual(6);
            // Mira: stand by her stall, press E, take the first choice (buy).
            expect(bot.walkTo(-9.6, 18.6, { radius: 0.8, timeout: 30 })).toBe(true);
            bot.step(0.3);
            expect(npcs.prompt?.name).toBe('Mira');
            bot.step(0.1, { keys: ['KeyE'] });
            bot.step(0.1);
            expect(npcs.dialogue?.speaker).toBe('Mira');
            expect(npcs.dialogue?.choices[0]).toMatch(/Buy the key/);
            bot.step(0.1, { keys: ['Digit1'] });
            bot.step(0.1);
            expect(bot.state('key')).toBe(1);
            expect(Number(bot.state('coins'))).toBeGreaterThanOrEqual(1);
            bot.step(0.1, { keys: ['KeyE'] }); // "A pleasure doing business." → close
            bot.step(0.1);
            expect(npcs.dialogue).toBeNull();
            const gate = Object.values(world.entities).find((e) => e.tags.includes('door') && e.tags.includes('gate'));
            expect(bot.state(`${gate.id}-unlocked`)).toBe(true);
            // Through the middle of the hamlet, past the guard, out of the gate.
            expect(bot.walkTo(0, 5, { radius: 1.2, timeout: 25 })).toBe(true);
            bot.walkTo(0, -9, { radius: 1.2, timeout: 25 });
            bot.walkTo(0, -26, { radius: 0.6, timeout: 30 });
            expect(bot.outcome).toBe('win');
            // The hamlet really was alive around it.
            const marek = byRole(world, 'guard')[0];
            expect(bot.runtime.readState(`${marek.id}.npcLegs`)).toBeGreaterThanOrEqual(0);
            expect(bot.runtime.log.some((e) => e.text.includes(`${marek.id}:`))).toBe(true);
        }
        finally {
            bot.dispose();
        }
    }, 120_000);
    it('the guard hears and chases a bot that runs by, and hurts it', async () => {
        const bot = await Bot.play(world);
        try {
            const marek = byRole(world, 'guard')[0];
            bot.walkTo(0, -7, { radius: 1, timeout: 25 });
            bot.step(6);
            expect(['chase', 'attack', 'investigate']).toContain(bot.runtime.npcs.info(marek.id)?.mode);
            expect(Number(bot.state('health'))).toBeLessThan(100);
        }
        finally {
            bot.dispose();
        }
    }, 120_000);
    it('wolves hunt a bot that walks into the woods at night, but not one that stays by the fire', async () => {
        const hunted = await Bot.play(world);
        try {
            hunted.walkTo(-20, 8, { radius: 1, timeout: 40 });
            hunted.step(5);
            const modes = byRole(world, 'wolf').map((w) => hunted.runtime.npcs.info(w.id)?.mode);
            expect(modes.some((m) => m === 'chase' || m === 'attack')).toBe(true);
        }
        finally {
            hunted.dispose();
        }
        const safe = await Bot.play(world);
        try {
            safe.walkTo(-5, 18.5, { radius: 1, timeout: 30 });
            safe.step(20);
            expect(Number(safe.state('health'))).toBe(100);
        }
        finally {
            safe.dispose();
        }
    }, 180_000);
    it('a sleeping pack: in daylight the wolves rest', async () => {
        const day = { ...world, environment: { ...world.environment, timeOfDay: 12, sky: 'day' } };
        const bot = await Bot.play(day);
        try {
            bot.walkTo(-20, 8, { radius: 1, timeout: 40 });
            bot.step(6);
            for (const w of byRole(world, 'wolf'))
                expect(bot.runtime.npcs.info(w.id)?.mode).toBe('idle');
            expect(Number(bot.state('health'))).toBe(100);
        }
        finally {
            bot.dispose();
        }
    }, 120_000);
    it('nobody gets stuck or falls through the floor in a long idle run', async () => {
        const bot = await Bot.play(world);
        try {
            bot.step(90);
            for (const info of bot.runtime.npcs.infos()) {
                expect(info.dead).toBe(false);
                expect(info.stuck, info.id).toBeLessThan(3);
                const y = bot.pw.getState(info.id)?.position[1] ?? 0;
                expect(y, info.id).toBeGreaterThan(-0.5);
            }
        }
        finally {
            bot.dispose();
        }
    }, 120_000);
});
