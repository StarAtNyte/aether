/**
 * Crafting: shapeless recipes (inputs → output), data-driven. Built-in
 * recipes cover the survival loop (planks, sticks, tools, torches, a
 * crafting table, cooking, building blocks); a world adds its own through
 * `voxel.game.recipes`. Crafting checks and consumes inventory contents
 * atomically.
 */
import type { VoxelRecipe } from '@aether/core';
import type { Inventory } from './inventory';
import type { ItemRegistry } from './items';

/** A recipe with resolved counts. */
export interface Recipe {
  id: string;
  inputs: ReadonlyArray<{ item: string; count: number }>;
  output: { item: string; count: number };
  /** Needs a crafting table within reach (bigger recipes). */
  table: boolean;
}

const r = (id: string, inputs: Array<[string, number]>, output: [string, number], table = false): Recipe => ({
  id, inputs: inputs.map(([item, count]) => ({ item, count })), output: { item: output[0], count: output[1] }, table,
});

/** Built-in recipes. */
export const BUILTIN_RECIPES: readonly Recipe[] = [
  r('oak_planks', [['oak_log', 1]], ['oak_planks', 4]),
  r('birch_planks', [['birch_log', 1]], ['birch_planks', 4]),
  r('spruce_planks', [['spruce_log', 1]], ['spruce_planks', 4]),
  r('sticks', [['oak_planks', 2]], ['stick', 4]),
  r('sticks_birch', [['birch_planks', 2]], ['stick', 4]),
  r('sticks_spruce', [['spruce_planks', 2]], ['stick', 4]),
  r('crafting_table', [['oak_planks', 4]], ['crafting_table', 1]),
  r('torch', [['coal', 1], ['stick', 1]], ['torch', 4]),
  r('wooden_pickaxe', [['oak_planks', 3], ['stick', 2]], ['wooden_pickaxe', 1], true),
  r('wooden_axe', [['oak_planks', 3], ['stick', 2]], ['wooden_axe', 1], true),
  r('wooden_shovel', [['oak_planks', 1], ['stick', 2]], ['wooden_shovel', 1], true),
  r('wooden_sword', [['oak_planks', 2], ['stick', 1]], ['wooden_sword', 1], true),
  r('stone_pickaxe', [['cobblestone', 3], ['stick', 2]], ['stone_pickaxe', 1], true),
  r('stone_axe', [['cobblestone', 3], ['stick', 2]], ['stone_axe', 1], true),
  r('stone_shovel', [['cobblestone', 1], ['stick', 2]], ['stone_shovel', 1], true),
  r('stone_sword', [['cobblestone', 2], ['stick', 1]], ['stone_sword', 1], true),
  r('iron_ingot', [['iron_ore', 1], ['coal', 1]], ['iron_ingot', 1], true),
  r('gold_ingot', [['gold_ore', 1], ['coal', 1]], ['gold_ingot', 1], true),
  r('iron_pickaxe', [['iron_ingot', 3], ['stick', 2]], ['iron_pickaxe', 1], true),
  r('iron_axe', [['iron_ingot', 3], ['stick', 2]], ['iron_axe', 1], true),
  r('iron_shovel', [['iron_ingot', 1], ['stick', 2]], ['iron_shovel', 1], true),
  r('iron_sword', [['iron_ingot', 2], ['stick', 1]], ['iron_sword', 1], true),
  r('diamond_pickaxe', [['diamond', 3], ['stick', 2]], ['diamond_pickaxe', 1], true),
  r('diamond_sword', [['diamond', 2], ['stick', 1]], ['diamond_sword', 1], true),
  r('stone_bricks', [['stone', 4]], ['stone_bricks', 4]),
  r('smooth_stone', [['cobblestone', 1], ['coal', 1]], ['stone', 1], true),
  r('glass', [['sand', 1], ['coal', 1]], ['glass', 1], true),
  r('bricks', [['clay', 4]], ['bricks', 1]),
  r('sandstone', [['sand', 4]], ['sandstone', 1]),
  r('bread', [['wheat', 3]], ['bread', 1]),
  r('cooked_mutton', [['raw_mutton', 1], ['coal', 1]], ['cooked_mutton', 1], true),
  r('cooked_porkchop', [['raw_porkchop', 1], ['coal', 1]], ['cooked_porkchop', 1], true),
  r('cooked_chicken', [['raw_chicken', 1], ['coal', 1]], ['cooked_chicken', 1], true),
  r('white_wool', [['string', 4]], ['white_wool', 1]),
  r('bookshelf', [['oak_planks', 6], ['white_wool', 3]], ['bookshelf', 1], true),
  r('glowstone', [['torch', 4], ['glass', 1]], ['glowstone', 1], true),
  r('hay_bale', [['wheat', 9]], ['hay_bale', 1]),
  r('iron_block', [['iron_ingot', 9]], ['iron_block', 1], true),
  r('gold_block', [['gold_ingot', 9]], ['gold_block', 1], true),
  r('diamond_block', [['diamond', 9]], ['diamond_block', 1], true),
  r('coal_block', [['coal', 9]], ['coal_block', 1]),
];

/** The recipe book of a world: built-ins plus its own (a world recipe with a built-in id replaces it). */
export class RecipeBook {
  readonly recipes: readonly Recipe[];

  constructor(items: ItemRegistry, extra: readonly VoxelRecipe[] = []) {
    const byId = new Map<string, Recipe>();
    for (const rec of BUILTIN_RECIPES) byId.set(rec.id, rec);
    for (const rec of extra) {
      byId.set(rec.id, { id: rec.id, inputs: rec.inputs.map((s) => ({ item: s.item, count: s.count })), output: { item: rec.output.item, count: rec.output.count }, table: false });
    }
    // Recipes whose items do not exist in this world (a custom registry) are dropped.
    this.recipes = [...byId.values()].filter((rec) => items.has(rec.output.item) && rec.inputs.every((i) => items.has(i.item)));
  }

  /** Recipe by id. */
  get(id: string): Recipe | undefined {
    return this.recipes.find((rec) => rec.id === id);
  }

  /** True when the inventory holds every input (and a table is near when needed). */
  canCraft(rec: Recipe, inv: Inventory, nearTable: boolean): boolean {
    if (rec.table && !nearTable) return false;
    for (const i of rec.inputs) if (inv.count(i.item) < i.count) return false;
    return true;
  }

  /**
   * Craft once: consumes the inputs and adds the output. Atomic — nothing
   * changes when an input is missing or the output does not fit.
   */
  craft(rec: Recipe, inv: Inventory, nearTable: boolean): boolean {
    if (!this.canCraft(rec, inv, nearTable)) return false;
    const before = inv.snapshot();
    for (const i of rec.inputs) inv.remove(i.item, i.count);
    const left = inv.add(rec.output.item, rec.output.count);
    if (left > 0) {
      inv.load(before, inv.selected);
      return false;
    }
    return true;
  }
}
