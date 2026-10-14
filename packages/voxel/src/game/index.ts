/**
 * @aether/voxel/game — the reusable game kit for block worlds: items and
 * tools, inventory with stacks, data-driven crafting, day/night clock,
 * survival rules (health, hunger, fall damage, lava, drowning, respawn),
 * block breaking/placing, mobs and item drops. Pure and deterministic.
 */
export { VoxelGame, createInput, EYE_HEIGHT, PLAYER_HALF_WIDTH, PLAYER_HEIGHT, REACH, CREATIVE_REACH, MAX_DROPS, type GameInput, type GameEvent, type DamageCause, type PlayerState, type Target, type Drop, type VoxelGameOptions } from './game';
export { ItemRegistry, HAND, type ItemDef } from './items';
export { Inventory, INVENTORY_SLOTS, HOTBAR_SLOTS, type Stack } from './inventory';
export { RecipeBook, BUILTIN_RECIPES, type Recipe } from './crafting';
export { DayClock, daylightAt, skyForHour, skyTintAt, type ClockSky } from './clock';
export { MOB_SPECS, createMob, tickMob, hurtMob, rayMob, AGGRO_RANGE, ATTACK_RANGE, type Mob, type MobSpec, type MobState, type MobWorld, type MobTickResult } from './mobs';
