/**
 * Vocabulary of voxel worlds: the ids of built-in blocks, items, mobs and
 * structures. Only names live here (core validates patches against them);
 * the data behind each id (colors, hardness, recipes, AI) lives in
 * `@aether/voxel`, whose tests assert that both lists stay identical.
 */

/** Built-in block ids, in registry order (index + 1 is the numeric id; 0 is air). */
export const VOXEL_BLOCK_IDS = [
  // Terrain
  'stone', 'cobblestone', 'mossy_cobblestone', 'dirt', 'coarse_dirt', 'grass', 'snowy_grass', 'sand', 'red_sand', 'gravel', 'clay',
  'sandstone', 'snow', 'ice', 'packed_ice', 'water', 'lava', 'bedrock', 'obsidian',
  // Wood and plants
  'oak_log', 'oak_planks', 'oak_leaves', 'birch_log', 'birch_planks', 'birch_leaves', 'spruce_log', 'spruce_planks', 'spruce_leaves',
  'dark_planks', 'cactus', 'dead_bush', 'tall_grass', 'poppy', 'dandelion', 'cornflower',
  // Ores and minerals
  'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'coal_block', 'iron_block', 'gold_block', 'diamond_block',
  // Building
  'bricks', 'stone_bricks', 'mossy_stone_bricks', 'smooth_stone', 'quartz', 'terracotta', 'roof_tiles', 'glass', 'glowstone', 'torch',
  'bookshelf', 'crafting_table', 'hay_bale',
  // Wool
  'white_wool', 'red_wool', 'orange_wool', 'yellow_wool', 'lime_wool', 'green_wool', 'cyan_wool', 'light_blue_wool', 'blue_wool',
  'purple_wool', 'magenta_wool', 'pink_wool', 'brown_wool', 'gray_wool', 'black_wool',
] as const;

/** A built-in block id. */
export type VoxelBuiltinBlock = (typeof VOXEL_BLOCK_IDS)[number];

/** Built-in item ids that are not blocks (tools, materials, food, mob drops). */
export const VOXEL_ITEM_IDS = [
  'stick', 'coal', 'iron_ingot', 'gold_ingot', 'diamond',
  'wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe',
  'wooden_axe', 'stone_axe', 'iron_axe',
  'wooden_shovel', 'stone_shovel', 'iron_shovel',
  'wooden_sword', 'stone_sword', 'iron_sword', 'diamond_sword',
  'apple', 'bread', 'raw_mutton', 'cooked_mutton', 'raw_porkchop', 'cooked_porkchop', 'raw_chicken', 'cooked_chicken',
  'feather', 'rotten_flesh', 'string', 'wheat',
] as const;

/** A built-in non-block item id. */
export type VoxelBuiltinItem = (typeof VOXEL_ITEM_IDS)[number];

/** Mob kinds of the game kit (passive animals and hostile night mobs). */
export const VOXEL_MOB_KINDS = ['sheep', 'pig', 'chicken', 'zombie', 'spider'] as const;

/** Procedural structures the `structure` edit can stamp. */
export const VOXEL_STRUCTURES = ['house', 'castle', 'tower', 'bridge', 'well', 'pyramid', 'tree', 'lamppost', 'wall', 'arch'] as const;

/** Terrain generator presets. */
export const VOXEL_PRESETS = ['survival', 'plains', 'forest', 'desert', 'snow', 'mountains', 'islands', 'flat', 'void'] as const;

/** World height in blocks (y = 0 … WORLD_HEIGHT − 1). */
export const VOXEL_WORLD_HEIGHT = 128;
/** Chunk edge in blocks (x and z). */
export const VOXEL_CHUNK_SIZE = 16;
/** Water level of generated terrain (the top water block is at y = SEA_LEVEL − 1). */
export const VOXEL_SEA_LEVEL = 48;

const BUILTIN_BLOCKS: ReadonlySet<string> = new Set<string>(VOXEL_BLOCK_IDS);
const BUILTIN_ITEMS: ReadonlySet<string> = new Set<string>(VOXEL_ITEM_IDS);

/** True for a built-in block id (not 'air'). */
export function isBuiltinBlock(id: string): boolean {
  return BUILTIN_BLOCKS.has(id);
}

/** True for a built-in item id that is not a block. */
export function isBuiltinItem(id: string): boolean {
  return BUILTIN_ITEMS.has(id);
}
