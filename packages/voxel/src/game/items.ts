/**
 * Item registry of the game kit: every block (placeable) plus the
 * non-block items (tools, materials, food, mob drops), with stack sizes,
 * tool classes and tiers, attack damage and food value. Data-driven: the
 * block part comes from the world's {@link BlockRegistry} (custom blocks
 * included), the rest from the table below.
 */
import { VOXEL_ITEM_IDS } from '@aether/core';
import type { BlockRegistry, ToolKind } from '../blocks';
import { AIR } from '../constants';

/** Static data of an item. */
export interface ItemDef {
  id: string;
  label: string;
  /** Largest stack (1 for tools). */
  maxStack: number;
  /** Numeric block placed by this item (−1: not placeable). */
  block: number;
  /** Tool class and tier (1 wood, 2 stone, 3 iron, 4 diamond). */
  tool?: { kind: ToolKind; tier: number; speed: number };
  /** Melee damage (hearts × 2) when held. */
  damage: number;
  /** Hunger restored when eaten (0: not food). */
  food: number;
  /** Icon / token colour "#rrggbb". */
  color: string;
}

interface Extra {
  label: string;
  color: string;
  tool?: { kind: ToolKind; tier: number; speed: number };
  damage?: number;
  food?: number;
  maxStack?: number;
}

const TIER_SPEED = [1, 2, 4, 6, 8] as const;
const TIER_COLOR = ['#8a6a3e', '#b98d58', '#8b8d90', '#d6d6d6', '#68ddd5'] as const;

function tool(kind: ToolKind, tier: number, label: string, damage: number): Extra {
  return { label, color: TIER_COLOR[tier] as string, tool: { kind, tier, speed: TIER_SPEED[tier] as number }, damage, maxStack: 1 };
}

const ITEMS: Readonly<Record<(typeof VOXEL_ITEM_IDS)[number], Extra>> = {
  stick: { label: 'Stick', color: '#8a6a3e' },
  coal: { label: 'Coal', color: '#2a2a2c' },
  iron_ingot: { label: 'Iron Ingot', color: '#d8d8d8' },
  gold_ingot: { label: 'Gold Ingot', color: '#f3c53e' },
  diamond: { label: 'Diamond', color: '#5fe3e0' },
  wooden_pickaxe: tool('pickaxe', 1, 'Wooden Pickaxe', 2),
  stone_pickaxe: tool('pickaxe', 2, 'Stone Pickaxe', 3),
  iron_pickaxe: tool('pickaxe', 3, 'Iron Pickaxe', 4),
  diamond_pickaxe: tool('pickaxe', 4, 'Diamond Pickaxe', 5),
  wooden_axe: tool('axe', 1, 'Wooden Axe', 3),
  stone_axe: tool('axe', 2, 'Stone Axe', 4),
  iron_axe: tool('axe', 3, 'Iron Axe', 5),
  wooden_shovel: tool('shovel', 1, 'Wooden Shovel', 2),
  stone_shovel: tool('shovel', 2, 'Stone Shovel', 3),
  iron_shovel: tool('shovel', 3, 'Iron Shovel', 4),
  wooden_sword: tool('sword', 1, 'Wooden Sword', 4),
  stone_sword: tool('sword', 2, 'Stone Sword', 5),
  iron_sword: tool('sword', 3, 'Iron Sword', 6),
  diamond_sword: tool('sword', 4, 'Diamond Sword', 7),
  apple: { label: 'Apple', color: '#d8312b', food: 4 },
  bread: { label: 'Bread', color: '#c99a4a', food: 5 },
  raw_mutton: { label: 'Raw Mutton', color: '#c4504a', food: 2 },
  cooked_mutton: { label: 'Cooked Mutton', color: '#8f4a2c', food: 6 },
  raw_porkchop: { label: 'Raw Porkchop', color: '#f0a3a4', food: 3 },
  cooked_porkchop: { label: 'Cooked Porkchop', color: '#b8743f', food: 8 },
  raw_chicken: { label: 'Raw Chicken', color: '#f2c7b0', food: 2 },
  cooked_chicken: { label: 'Cooked Chicken', color: '#c98a4a', food: 6 },
  feather: { label: 'Feather', color: '#f2f2f2' },
  rotten_flesh: { label: 'Rotten Flesh', color: '#7a5a3a', food: 2 },
  string: { label: 'String', color: '#e8e8e8' },
  wheat: { label: 'Wheat', color: '#d8b13d' },
};

/** Fist: no tool. */
export const HAND: ItemDef = { id: 'hand', label: 'Hand', maxStack: 0, block: -1, damage: 1, food: 0, color: '#ffd2a8' };

/** All items of a world: blocks first (by numeric id), then non-block items. */
export class ItemRegistry {
  private readonly byId = new Map<string, ItemDef>();
  readonly list: readonly ItemDef[];

  constructor(readonly blocks: BlockRegistry) {
    const list: ItemDef[] = [];
    for (const t of blocks.types) {
      if (t.num === AIR || t.liquid) continue;
      const def: ItemDef = { id: t.id, label: t.label, maxStack: 64, block: t.num, damage: 1, food: 0, color: t.color };
      list.push(def);
      this.byId.set(t.id, def);
    }
    for (const id of VOXEL_ITEM_IDS) {
      if (this.byId.has(id)) continue;
      const e = ITEMS[id];
      const def: ItemDef = { id, label: e.label, maxStack: e.maxStack ?? 64, block: -1, damage: e.damage ?? 1, food: e.food ?? 0, color: e.color, ...(e.tool ? { tool: e.tool } : {}) };
      list.push(def);
      this.byId.set(id, def);
    }
    this.list = list;
  }

  /** Item by id (undefined when unknown). */
  get(id: string): ItemDef | undefined {
    return this.byId.get(id);
  }

  /** True for a known item id. */
  has(id: string): boolean {
    return this.byId.has(id);
  }

  /** Item that a numeric block drops as (itself unless the block says otherwise). */
  blockItem(num: number): ItemDef | undefined {
    const t = this.blocks.type(num);
    return this.byId.get(t.id);
  }
}
