/**
 * What the voxel game HUD shows: a plain, comparable snapshot pushed from
 * the session to the UI store only when something visible changed.
 */

/** How to draw an item icon. */
export type ItemIcon =
  | { kind: 'block'; top: number; side: number; flat: boolean }
  | { kind: 'item'; index: number };

/** One inventory slot as shown. */
export interface HudSlot {
  item: string;
  label: string;
  count: number;
  icon: ItemIcon;
}

/** A recipe row in the crafting list. */
export interface HudRecipe {
  id: string;
  label: string;
  count: number;
  icon: ItemIcon;
  craftable: boolean;
  needsTable: boolean;
  inputs: Array<{ label: string; count: number; have: number; icon: ItemIcon }>;
}

/** The HUD snapshot. */
export interface VoxelHudState {
  mode: 'survival' | 'creative' | 'explore';
  /** Spawn area still streaming in: progress 0…1 (null once playable). */
  loading: number | null;
  health: number;
  hunger: number;
  /** Breath 0…10 (10: not under water). */
  air: number;
  dead: boolean;
  deathCause: string;
  slots: Array<HudSlot | null>;
  selected: number;
  inventoryOpen: boolean;
  recipes: HudRecipe[];
  nearTable: boolean;
  hour: number;
  day: number;
  locked: boolean;
  view: 'first' | 'third';
  flying: boolean;
  /** Label of the block under the crosshair. */
  target: string;
  /** Rounded feet position. */
  position: [number, number, number];
  /** Atlas data URL for block icons (stable per terrain). */
  atlasUrl: string;
  /** Item icon strip data URL (stable). */
  itemsUrl: string;
  /** Number of icons in the item strip. */
  itemCount: number;
  /** Most recent pickup ("+3 Oak Log"), cleared after a few seconds. */
  toast: string;
}

function iconEq(a: ItemIcon, b: ItemIcon): boolean {
  if (a.kind === 'block' && b.kind === 'block') return a.top === b.top && a.side === b.side && a.flat === b.flat;
  if (a.kind === 'item' && b.kind === 'item') return a.index === b.index;
  return false;
}

function slotEq(a: HudSlot | null, b: HudSlot | null): boolean {
  if (a === null || b === null) return a === b;
  return a.item === b.item && a.count === b.count && a.label === b.label && iconEq(a.icon, b.icon);
}

/** Value equality of two HUD snapshots (cheap; recipes compared by craftability and counts). */
export function hudEqual(a: VoxelHudState | null, b: VoxelHudState | null): boolean {
  if (a === null || b === null) return a === b;
  if (
    a.mode !== b.mode || a.loading !== b.loading || a.health !== b.health || a.hunger !== b.hunger || a.air !== b.air || a.dead !== b.dead ||
    a.deathCause !== b.deathCause || a.selected !== b.selected || a.inventoryOpen !== b.inventoryOpen || a.nearTable !== b.nearTable || a.hour !== b.hour ||
    a.day !== b.day || a.locked !== b.locked || a.view !== b.view || a.flying !== b.flying || a.target !== b.target || a.atlasUrl !== b.atlasUrl ||
    a.itemsUrl !== b.itemsUrl || a.toast !== b.toast || a.position[0] !== b.position[0] || a.position[1] !== b.position[1] || a.position[2] !== b.position[2]
  ) {
    return false;
  }
  if (a.slots.length !== b.slots.length) return false;
  for (let i = 0; i < a.slots.length; i++) if (!slotEq(a.slots[i] ?? null, b.slots[i] ?? null)) return false;
  if (a.recipes.length !== b.recipes.length) return false;
  for (let i = 0; i < a.recipes.length; i++) {
    const x = a.recipes[i] as HudRecipe;
    const y = b.recipes[i] as HudRecipe;
    if (x.id !== y.id || x.craftable !== y.craftable || x.inputs.length !== y.inputs.length) return false;
    for (let k = 0; k < x.inputs.length; k++) if ((x.inputs[k] as { have: number }).have !== (y.inputs[k] as { have: number }).have) return false;
  }
  return true;
}
