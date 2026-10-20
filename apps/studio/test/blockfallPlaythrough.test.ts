/**
 * Blockfall is an open survival sandbox with no win rule, so the verified-playable bot (which plays to a win and seals
 * the run) cannot drive it. This plays the shipped world's own game settings through one full day and night on flat
 * ground: gather, craft, build, dig, fight and eat, and be alive at the next sunrise (respawning when it falls).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateWorld, VoxelTerrain } from '@aether/core';
import { BlockRegistry, ChunkData, CHUNK_VOLUME, LAYER, VoxelWorld } from '@aether/voxel';
import { VoxelGame, createInput, type GameEvent, type GameInput } from '@aether/voxel/game';
import { describe, expect, it } from 'vitest';

const DT = 1 / 20;
const reg = new BlockRegistry();

function shipped(): VoxelTerrain['game'] {
  const raw = JSON.parse(readFileSync(fileURLToPath(new URL('../public/templates/worlds/blockfall.json', import.meta.url)), 'utf8')) as { world: unknown };
  const r = validateWorld(raw.world);
  if (!r.ok || !r.world.voxel) throw new Error('blockfall: invalid saved world');
  return VoxelTerrain.parse(r.world.voxel).game;
}

function flat(top: number): VoxelWorld {
  const w = new VoxelWorld(reg);
  const g = reg.id('grass') ?? 1;
  for (let cz = -3; cz <= 3; cz++)
    for (let cx = -3; cx <= 3; cx++) {
      const dense = new Uint16Array(CHUNK_VOLUME);
      dense.fill(g, 0, (top + 1) * LAYER);
      w.put(cx, cz, ChunkData.fromDense(dense), top);
    }
  return w;
}

describe('Blockfall: the shipped survival game plays through a day and a night', () => {
  it('gathers, crafts, builds, digs, fights, eats and is alive at the next sunrise', () => {
    const settings = shipped();
    expect(settings.mode).toBe('survival');
    const top = 9;
    const g = new VoxelGame({ world: flat(top), reg, settings, seed: 7, spawn: [0.5, top + 1, 0.5] });
    for (const item of ['wooden_pickaxe', 'wooden_axe', 'torch', 'bread', 'oak_planks']) expect(g.inventory.count(item), `start item ${item}`).toBeGreaterThan(0);

    const events: GameEvent[] = [];
    const input: GameInput = createInput();
    const step = (setup?: (i: GameInput) => void): void => {
      setup?.(input);
      g.tick(DT, input);
      input.use = false;
      input.attack = false;
      g.drainEvents((e) => events.push(e));
    };
    const run = (seconds: number, setup?: (i: GameInput) => void): void => {
      for (let t = 0; t < seconds; t += DT) step(setup);
    };

    // Dig the grass in front of the feet with the pickaxe and pick the drop up.
    run(0.5);
    run(3, (i) => {
      i.pitch = -0.6;
      i.primary = true;
    });
    input.primary = false;
    run(2.5, (i) => {
      i.forward = 1;
    });
    input.forward = 0;
    run(0.5);
    expect(events.some((e) => e.type === 'block' && e.to === 0), 'dug a block').toBe(true);
    expect(g.inventory.count('dirt'), 'collected the dirt').toBeGreaterThan(0);

    // Craft a table from the planks, put it down, and craft a tool at it.
    const planks = g.inventory.count('oak_planks');
    expect(g.craft('crafting_table'), 'crafted a table').toBe(true);
    expect(g.inventory.count('oak_planks')).toBe(planks - 4);
    expect(g.craft('wooden_sword'), 'a sword needs the table').toBe(false);
    const hotbar = g.inventory.slots.findIndex((s) => s?.item === 'crafting_table');
    expect(hotbar).toBeGreaterThanOrEqual(0);
    g.inventory.selected = Math.min(hotbar, 8);
    run(0.2, (i) => {
      i.pitch = -0.4;
    });
    step((i) => {
      i.pitch = -0.4;
      i.use = true;
    });
    run(0.5);
    expect(events.some((e) => e.type === 'block' && e.to === reg.id('crafting_table')), 'placed the table').toBe(true);
    expect(g.nearCraftingTable()).toBe(true);
    expect(g.craft('sticks'), 'crafted sticks').toBe(true);
    expect(g.craft('wooden_sword'), 'crafted a sword at the table').toBe(true);
    expect(g.inventory.count('wooden_sword')).toBeGreaterThan(0);

    // A full day: fight whatever hostile comes close, eat when hungry.
    const startDay = g.clock.day;
    let sawNight = false;
    let kills = 0;
    let deaths = 0;
    const slotOf = (item: string): number => g.inventory.slots.findIndex((s) => s?.item === item);
    const total = (settings.dayLength * 26) / 24;
    for (let t = 0; t < total; t += DT) {
      const p = g.player.body;
      if (g.player.dead) {
        deaths++;
        g.respawn();
        continue;
      }
      if (g.clock.hour >= 19 || g.clock.hour < 5) sawNight = true;
      let near: { x: number; z: number } | undefined;
      let best = 5 * 5;
      for (const m of g.mobs) {
        if (!m.spec.hostile) continue;
        const d = (m.body.x - p.x) ** 2 + (m.body.z - p.z) ** 2;
        if (d < best) {
          best = d;
          near = m.body;
        }
      }
      const before = g.mobs.length;
      const sword = slotOf('wooden_sword');
      const bread = slotOf('bread');
      const hungry = g.player.hunger < 13 && bread >= 0 && bread < 9;
      if (sword >= 0 && sword < 9) g.inventory.selected = hungry ? bread : sword;
      step((i) => {
        i.forward = 0;
        i.primary = false;
        if (near) {
          i.yaw = Math.atan2(-(near.x - p.x), -(near.z - p.z));
          i.pitch = -0.3;
          i.attack = true;
        }
        if (hungry) i.use = true;
      });
      if (g.mobs.length < before) kills++;
    }
    expect(sawNight, 'the night passed').toBe(true);
    expect(g.clock.day, 'the next day began').toBeGreaterThan(startDay);
    expect(g.player.dead, 'alive at sunrise').toBe(false);
    // The bot has no shelter, so the open-ground night costs it a few lives: dying and respawning is part of the loop.
    expect(kills, 'the sword killed mobs').toBeGreaterThan(0);
    expect(deaths, 'the night is dangerous but not hopeless').toBeLessThanOrEqual(8);
  });
});
