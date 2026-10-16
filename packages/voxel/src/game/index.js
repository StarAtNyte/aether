/**
 * @aether/voxel/game — the reusable game kit for block worlds: items and
 * tools, inventory with stacks, data-driven crafting, day/night clock,
 * survival rules (health, hunger, fall damage, lava, drowning, respawn),
 * block breaking/placing, mobs and item drops. Pure and deterministic.
 */
export { VoxelGame, createInput, EYE_HEIGHT, PLAYER_HALF_WIDTH, PLAYER_HEIGHT, REACH, CREATIVE_REACH, MAX_DROPS } from './game';
export { ItemRegistry, HAND } from './items';
export { Inventory, INVENTORY_SLOTS, HOTBAR_SLOTS } from './inventory';
export { RecipeBook, BUILTIN_RECIPES } from './crafting';
export { DayClock, daylightAt, skyForHour, skyTintAt } from './clock';
export { MOB_SPECS, createMob, tickMob, hurtMob, rayMob, AGGRO_RANGE, ATTACK_RANGE } from './mobs';
