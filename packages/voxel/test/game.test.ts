import { describe, expect, it } from 'vitest';
import { VoxelGame as VoxelGameSettings } from '@aether/core';
import { createInput, VoxelGame, type GameEvent } from '../src/game/game';
import { Inventory } from '../src/game/inventory';
import { ItemRegistry } from '../src/game/items';
import { RecipeBook } from '../src/game/crafting';
import { daylightAt, DayClock, skyForHour } from '../src/game/clock';
import { flatWorld, id, reg } from './helpers';

const DT = 1 / 60;

function game(settings: Partial<ReturnType<typeof VoxelGameSettings.parse>> = {}, groundTop = 9): VoxelGame {
  const world = flatWorld(2, groundTop, 'grass');
  return new VoxelGame({ world, reg, settings: VoxelGameSettings.parse({ mobs: false, ...settings }), seed: 1, spawn: [0.5, groundTop + 1, 0.5] });
}

function run(g: VoxelGame, seconds: number, setup?: (i: ReturnType<typeof createInput>, t: number) => void): GameEvent[] {
  const input = createInput();
  const events: GameEvent[] = [];
  for (let t = 0; t < seconds; t += DT) {
    setup?.(input, t);
    g.tick(DT, input);
    input.use = false;
    input.attack = false;
    input.toggleFly = false;
    g.drainEvents((e) => events.push(e));
  }
  return events;
}

describe('inventory and crafting', () => {
  const items = new ItemRegistry(reg);

  it('stacks to the item maximum, hotbar first, and reports leftovers', () => {
    const inv = new Inventory(items);
    expect(inv.add('stone', 130)).toBe(0);
    expect(inv.slots.slice(0, 3).map((s) => s?.count)).toEqual([64, 64, 2]);
    expect(inv.add('wooden_pickaxe', 2)).toBe(0);
    expect(inv.slots[3]?.count).toBe(1);
    expect(inv.slots[4]?.item).toBe('wooden_pickaxe');
    expect(inv.add('not_an_item', 3)).toBe(3);
    expect(inv.remove('stone', 100)).toBe(100);
    expect(inv.count('stone')).toBe(30);
    inv.move(4, 10);
    expect(inv.slots[10]?.item).toBe('wooden_pickaxe');
  });

  it('crafts atomically and requires a table for tools', () => {
    const inv = new Inventory(items);
    const book = new RecipeBook(items);
    inv.add('oak_log', 2);
    expect(book.craft(book.get('oak_planks') as never, inv, false)).toBe(true);
    expect(inv.count('oak_planks')).toBe(4);
    expect(book.craft(book.get('sticks') as never, inv, false)).toBe(true);
    expect(inv.count('stick')).toBe(4);
    const pick = book.get('wooden_pickaxe');
    if (!pick) throw new Error('missing recipe');
    expect(book.craft(pick, inv, false)).toBe(false);
    expect(inv.count('oak_planks')).toBe(2);
    expect(book.craft(pick, inv, true)).toBe(false); // only 2 planks
    inv.add('oak_planks', 1);
    expect(book.craft(pick, inv, true)).toBe(true);
    expect(inv.count('wooden_pickaxe')).toBe(1);
    expect(inv.count('stick')).toBe(2);
  });

  it('accepts world recipes', () => {
    const book = new RecipeBook(items, [{ id: 'gold_from_dirt', inputs: [{ item: 'dirt', count: 9 }], output: { item: 'gold_ingot', count: 1 } }]);
    expect(book.get('gold_from_dirt')?.output.item).toBe('gold_ingot');
  });
});

describe('day/night clock', () => {
  it('cycles sky presets and daylight', () => {
    expect(skyForHour(12)).toBe('day');
    expect(skyForHour(23)).toBe('night');
    expect(skyForHour(6)).toBe('dawn');
    expect(skyForHour(18.5)).toBe('sunset');
    expect(daylightAt(12)).toBeCloseTo(1, 5);
    expect(daylightAt(0)).toBeCloseTo(0.16, 5);
    const c = new DayClock(8, 240, true);
    c.tick(120);
    expect(c.hour).toBeCloseTo(20, 5);
    expect(c.isNight).toBe(true);
    c.tick(120);
    expect(c.day).toBe(1);
  });
});

describe('VoxelGame', () => {
  it('walks, jumps and stays on the ground', () => {
    const g = game();
    run(g, 1);
    expect(g.player.body.onGround).toBe(true);
    const z0 = g.player.body.z;
    run(g, 1, (i) => {
      i.forward = 1;
    });
    expect(g.player.body.z).toBeLessThan(z0 - 3);
    let peak = 0;
    run(g, 1, (i, t) => {
      i.jump = t < 0.05;
      peak = Math.max(peak, g.player.body.y);
    });
    expect(peak - 10).toBeGreaterThan(1.1);
    expect(peak - 10).toBeLessThan(1.5);
  });

  it('breaks blocks by hardness and tool, drops items and picks them up', () => {
    const g = game();
    run(g, 0.5);
    const hand = g.heldItem();
    const stoneTime = g.breakTime(id('stone'), hand);
    expect(stoneTime).toBeGreaterThan(g.breakTime(id('dirt'), hand));
    g.inventory.add('wooden_pickaxe', 1);
    const pick = g.items.get('wooden_pickaxe');
    if (!pick) throw new Error('no pickaxe');
    expect(g.breakTime(id('stone'), pick)).toBeLessThan(stoneTime);
    expect(g.harvests(id('iron_ore'), pick)).toBe(false);
    expect(g.breakTime(id('bedrock'), pick)).toBe(Infinity);
    // Look straight down and dig the grass under the player.
    const events = run(g, 2, (i) => {
      i.pitch = -Math.PI / 2 + 0.01;
      i.primary = true;
    });
    expect(events.some((e) => e.type === 'block' && e.to === 0)).toBe(true);
    expect(events.some((e) => e.type === 'sound' && e.name === 'break')).toBe(true);
    run(g, 1.5);
    expect(g.inventory.count('dirt')).toBeGreaterThan(0);
  });

  it('picks up a drop lying in the hole dug beside the feet (player still standing)', () => {
    const g = game();
    run(g, 0.5);
    const b = g.player.body;
    // Stand across two cells so digging one keeps the player up.
    b.x = 0.02;
    b.z = 0.5;
    run(g, 0.3);
    expect(b.onGround).toBe(true);
    const feet = Math.floor(b.y);
    g.breakBlock(-1, feet - 1, 0);
    run(g, 3);
    expect(Math.floor(b.y)).toBe(feet);
    expect(g.inventory.count('dirt')).toBe(1);
    expect(g.drops.length).toBe(0);
  });

  it('a drop two blocks down in a neighbouring hole hops up to the player', () => {
    const g = game();
    run(g, 0.5);
    const b = g.player.body;
    b.x = 0.5;
    b.z = 0.5;
    run(g, 0.3);
    const feet = Math.floor(b.y);
    // A two-deep pit right next to the player; the drop lands at its bottom.
    g.breakBlock(1, feet - 1, 0);
    g.breakBlock(1, feet - 2, 0);
    g.inventory.clear();
    g.drops.length = 0;
    g.spawnDrop('cobblestone', 1, 1.5, feet - 2 + 0.1, 0.5, false);
    run(g, 4);
    expect(Math.floor(b.y)).toBe(feet);
    expect(g.inventory.count('cobblestone')).toBe(1);
  });

  it('finds open solid ground to spawn on: never leaves, plants or water', () => {
    const w = flatWorld(1, 9, 'grass');
    // A tree canopy and a pond around (0, 0); open grass from x = 3.
    for (let z = -2; z <= 2; z++) for (let x = -2; x <= 2; x++) w.set(x, 12, z, id('oak_leaves'));
    w.set(0, 10, 0, id('oak_log'));
    w.set(0, 11, 0, id('oak_log'));
    for (let z = -3; z <= 3; z++) w.set(-3, 9, z, id('water'));
    w.set(3, 10, 0, id('poppy'));
    const spot = w.findSpawn(0, 0, 8);
    expect(spot).not.toBeNull();
    const [x, y, z] = spot as [number, number, number];
    expect(y).toBe(10);
    expect(w.get(Math.floor(x), 9, Math.floor(z))).toBe(id('grass'));
    expect(Math.max(Math.abs(Math.floor(x)), Math.abs(Math.floor(z)))).toBe(3);
    expect(Math.floor(x) === 3 && Math.floor(z) === 0).toBe(false); // the flower cell is skipped
    expect(w.findSpawn(500, 500, 4)).toBeNull(); // nothing loaded there
  });

  it('places the held block on the targeted face', () => {
    const g = game();
    g.inventory.add('oak_planks', 3);
    g.inventory.select(0);
    run(g, 0.3);
    const events = run(g, 0.3, (i, t) => {
      i.pitch = -0.9;
      i.use = t < DT;
    });
    const placed = events.find((e) => e.type === 'block' && e.to === id('oak_planks'));
    expect(placed).toBeTruthy();
    expect(g.inventory.count('oak_planks')).toBe(2);
  });

  it('applies fall damage, respawns after death', () => {
    const g = game();
    g.player.body.y = 30;
    g.player.fallFrom = 30;
    const events = run(g, 3);
    const dmg = events.find((e) => e.type === 'damage');
    expect(dmg && dmg.type === 'damage' && dmg.cause).toBe('fall');
    expect(g.player.health).toBeLessThan(20);
    g.damage(100, 'mob');
    expect(g.player.dead).toBe(true);
    g.respawn();
    expect(g.player.dead).toBe(false);
    expect(g.player.health).toBe(20);
  });

  it('creative mode never takes damage and flies', () => {
    const g = game({ mode: 'creative' });
    g.player.body.y = 40;
    g.player.fallFrom = 40;
    run(g, 3);
    expect(g.player.health).toBe(20);
    run(g, 0.1, (i) => {
      i.toggleFly = true;
    });
    expect(g.player.flying).toBe(true);
    const y = g.player.body.y;
    run(g, 0.5, (i) => {
      i.jump = true;
    });
    expect(g.player.body.y).toBeGreaterThan(y + 1);
  });

  it('spawns passive mobs by day, hostile mobs at night that chase and hurt', () => {
    const g = game({ mobs: true, startHour: 12, cycle: false, maxMobs: 12 });
    run(g, 20);
    expect(g.mobs.some((m) => !m.spec.hostile)).toBe(true);
    const night = game({ mobs: true, startHour: 23, cycle: false, maxMobs: 12, passive: [] });
    const z = night.spawnMob('zombie', 6.5, 10.01, 0.5);
    expect(z).not.toBeNull();
    const events = run(night, 8);
    expect(events.some((e) => e.type === 'damage' && e.cause === 'mob')).toBe(true);
  });

  it('kills mobs with melee and drops their loot', () => {
    const g = game({ mobs: false });
    run(g, 0.3);
    const m = g.spawnMob('pig', 0.5, 10.01, -1.5);
    expect(m).not.toBeNull();
    if (m) m.health = 3;
    g.inventory.add('diamond_sword', 1);
    run(g, 3, (i) => {
      i.pitch = -0.6;
      i.attack = true;
    });
    expect(g.mobs.length).toBe(0);
    run(g, 2);
    expect(g.inventory.count('raw_porkchop') + g.drops.filter((d) => d.item === 'raw_porkchop').length).toBeGreaterThan(0);
  });

  it('drowns and burns in survival', () => {
    const g = game();
    const w = g.world;
    for (let y = 10; y < 14; y++) for (let z = -1; z <= 1; z++) for (let x = -1; x <= 1; x++) w.set(x, y, z, id('water'));
    const events = run(g, 16);
    expect(events.some((e) => e.type === 'damage' && e.cause === 'drown')).toBe(true);
    const h = game();
    h.world.set(0, 10, 0, id('lava'));
    const ev2 = run(h, 1);
    expect(ev2.some((e) => e.type === 'damage' && e.cause === 'lava')).toBe(true);
  });

  it('saves and restores the player', () => {
    const g = game({ startItems: [{ item: 'torch', count: 8 }] });
    run(g, 0.5, (i) => {
      i.forward = 1;
    });
    const snap = g.snapshotPlayer();
    const h = game();
    h.loadPlayer(snap);
    expect(h.player.body.z).toBeCloseTo(g.player.body.z, 6);
    expect(h.inventory.count('torch')).toBe(8);
  });

  it('is deterministic for a seed', () => {
    const a = game({ mobs: true, maxMobs: 10 });
    const b = game({ mobs: true, maxMobs: 10 });
    run(a, 5, (i) => {
      i.forward = 0.5;
    });
    run(b, 5, (i) => {
      i.forward = 0.5;
    });
    expect(a.mobs.map((m) => [m.spec.kind, m.body.x])).toEqual(b.mobs.map((m) => [m.spec.kind, m.body.x]));
  });
});
