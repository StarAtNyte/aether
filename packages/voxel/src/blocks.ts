/**
 * Block registry: the data behind every block id (data-driven, extendable
 * per world). Numeric ids: 0 is air, built-in blocks follow the order of
 * `VOXEL_BLOCK_IDS` (1…N), custom blocks of a world come after them.
 *
 * Each block declares how it renders (`cube`, `cutout` cube with alpha
 * holes, `cross` sprite, `liquid`), how it collides (`solid`), whether it
 * hides its neighbours and stops light (`opaque`), the block light it emits,
 * how long it takes to break (`hardness`, `tool`, `tier`) and what it drops.
 * Faces reference procedural pixel tiles ({@link TileSpec}) that `atlas.ts`
 * paints into one texture.
 */
import { VOXEL_BLOCK_IDS, type VoxelBlockDef } from '@aether/core';
import { AIR } from './constants';

/** Procedural pixel pattern of a 16 × 16 tile. */
export type TilePattern =
  | 'noise' | 'solid' | 'stone' | 'cobble' | 'dirt' | 'grass_top' | 'grass_side' | 'snow_side' | 'sand' | 'gravel' | 'log_side' | 'log_top'
  | 'birch_side' | 'planks' | 'leaves' | 'ore' | 'bricks' | 'stone_bricks' | 'glass' | 'glow' | 'torch' | 'flower' | 'tall_grass' | 'dead_bush'
  | 'cactus_side' | 'cactus_top' | 'water' | 'lava' | 'wool' | 'tiles' | 'bookshelf' | 'table_top' | 'table_side' | 'hay_side' | 'hay_top'
  | 'metal' | 'smooth' | 'ice' | 'obsidian' | 'bedrock' | 'stripes' | 'dots' | 'sandstone' | 'mossy';

/** One tile of the block atlas: a pattern painted with up to three colors. */
export interface TileSpec {
  pattern: TilePattern;
  base: string;
  detail?: string;
  accent?: string;
}

/** How a block is meshed. */
export type BlockRender = 'none' | 'cube' | 'cutout' | 'cross' | 'liquid';
/** Tool class that breaks a block fastest. */
export type ToolKind = 'pickaxe' | 'axe' | 'shovel' | 'sword';

/** Static definition of a block (built-in table or custom block def). */
export interface BlockSpec {
  id: string;
  label: string;
  render: BlockRender;
  /** Collides with players, mobs and items. */
  solid: boolean;
  /** Hides neighbouring faces and blocks light completely. */
  opaque: boolean;
  liquid?: boolean;
  /** Block light emitted (0–15). */
  emissive?: number;
  /** Extra light lost when passing through (leaves 1, water 2). */
  filter?: number;
  /** Seconds-ish break difficulty (Minecraft-like scale; < 0 unbreakable). */
  hardness: number;
  tool?: ToolKind;
  /** Minimum tool tier (1 wood, 2 stone, 3 iron, 4 diamond) for a drop. */
  tier?: number;
  /** Item dropped (default: itself; null: nothing). */
  drops?: string | null;
  /** Extra chance drop (e.g. apples from oak leaves). */
  bonus?: { item: string; chance: number };
  top: TileSpec;
  side?: TileSpec;
  bottom?: TileSpec;
}

/** Resolved runtime block type (numeric id, tile indices into the atlas). */
export interface BlockType extends Readonly<Omit<BlockSpec, 'side' | 'bottom' | 'emissive' | 'filter' | 'liquid' | 'tier'>> {
  readonly num: number;
  readonly liquid: boolean;
  readonly emissive: number;
  readonly filter: number;
  readonly tier: number;
  readonly side: TileSpec;
  readonly bottom: TileSpec;
  /** Atlas tile index per face: [top, bottom, side]. */
  readonly tiles: readonly [number, number, number];
  /** Average color "#rrggbb" (particles, map, item drops). */
  readonly color: string;
}

const t = (pattern: TilePattern, base: string, detail?: string, accent?: string): TileSpec => ({ pattern, base, ...(detail ? { detail } : {}), ...(accent ? { accent } : {}) });
const cube = (id: string, label: string, hardness: number, top: TileSpec, extra: Partial<BlockSpec> = {}): BlockSpec => ({ id, label, render: 'cube', solid: true, opaque: true, hardness, top, ...extra });

const STONE = '#8b8d90';
const ore = (id: string, label: string, speck: string, tier: number, drops: string | null): BlockSpec =>
  cube(id, label, 3, t('ore', STONE, speck, '#6f7174'), { tool: 'pickaxe', tier, ...(drops !== null ? { drops } : {}) });
const wool = (id: string, label: string, base: string): BlockSpec => cube(id, label, 0.8, t('wool', base), { tool: 'shovel' });
const plant = (id: string, label: string, tile: TileSpec, drops: string | null = id, bonus?: BlockSpec['bonus']): BlockSpec => ({
  id, label, render: 'cross', solid: false, opaque: false, hardness: 0, top: tile, drops, ...(bonus ? { bonus } : {}),
});

/** Built-in blocks, keyed by id (order follows `VOXEL_BLOCK_IDS`). */
export const BUILTIN_BLOCKS: Readonly<Record<string, BlockSpec>> = Object.freeze({
  stone: cube('stone', 'Stone', 1.5, t('stone', STONE, '#727477', '#a0a2a5'), { tool: 'pickaxe', tier: 1, drops: 'cobblestone' }),
  cobblestone: cube('cobblestone', 'Cobblestone', 2, t('cobble', '#808285', '#56585b', '#9c9ea1'), { tool: 'pickaxe', tier: 1 }),
  mossy_cobblestone: cube('mossy_cobblestone', 'Mossy Cobblestone', 2, t('mossy', '#7e8183', '#55585a', '#5f7d3a'), { tool: 'pickaxe', tier: 1 }),
  dirt: cube('dirt', 'Dirt', 0.5, t('dirt', '#8a5f3c', '#6b462b', '#9c6f4a'), { tool: 'shovel' }),
  coarse_dirt: cube('coarse_dirt', 'Coarse Dirt', 0.5, t('gravel', '#77553a', '#5a3f2a', '#94704f'), { tool: 'shovel' }),
  grass: cube('grass', 'Grass Block', 0.6, t('grass_top', '#76a947', '#5b8c3a', '#92c35b'), {
    tool: 'shovel', drops: 'dirt', side: t('grass_side', '#8a5f3c', '#76a947', '#5b8c3a'), bottom: t('dirt', '#8a5f3c', '#6b462b', '#9c6f4a'),
  }),
  snowy_grass: cube('snowy_grass', 'Snowy Grass', 0.6, t('noise', '#f2f6fb', '#dfe8f2'), {
    tool: 'shovel', drops: 'dirt', side: t('snow_side', '#8a5f3c', '#f2f6fb', '#dfe8f2'), bottom: t('dirt', '#8a5f3c', '#6b462b', '#9c6f4a'),
  }),
  sand: cube('sand', 'Sand', 0.5, t('sand', '#d6c286', '#bfa66c', '#e4d49e'), { tool: 'shovel' }),
  red_sand: cube('red_sand', 'Red Sand', 0.5, t('sand', '#c9773f', '#b06231', '#d98c55'), { tool: 'shovel' }),
  gravel: cube('gravel', 'Gravel', 0.6, t('gravel', '#867f7a', '#67615d', '#a29b96'), { tool: 'shovel' }),
  clay: cube('clay', 'Clay', 0.6, t('smooth', '#a1a6b5', '#8f94a3'), { tool: 'shovel' }),
  sandstone: cube('sandstone', 'Sandstone', 0.8, t('sandstone', '#cfb97f', '#b89f68', '#dfcd98'), { tool: 'pickaxe', tier: 1 }),
  snow: cube('snow', 'Snow', 0.2, t('noise', '#f4f7fb', '#e1e9f2'), { tool: 'shovel' }),
  ice: cube('ice', 'Ice', 0.5, t('ice', '#a8d2f2', '#8cbfe8', '#d6ecfb'), { tool: 'pickaxe', drops: null }),
  packed_ice: cube('packed_ice', 'Packed Ice', 0.5, t('ice', '#8db6e6', '#7aa4d8', '#b8d4f2'), { tool: 'pickaxe', drops: null }),
  water: { id: 'water', label: 'Water', render: 'liquid', solid: false, opaque: false, liquid: true, filter: 2, hardness: -1, drops: null, top: t('water', '#3a78d0', '#2f66b8', '#5b95e0') },
  lava: { id: 'lava', label: 'Lava', render: 'liquid', solid: false, opaque: false, liquid: true, emissive: 15, filter: 2, hardness: -1, drops: null, top: t('lava', '#e8601a', '#ffae2b', '#b33a12') },
  bedrock: cube('bedrock', 'Bedrock', -1, t('bedrock', '#4b4b4d', '#2e2e30', '#6a6a6c'), { drops: null }),
  obsidian: cube('obsidian', 'Obsidian', 50, t('obsidian', '#1f1631', '#3b2a5e', '#120c1e'), { tool: 'pickaxe', tier: 4 }),

  oak_log: cube('oak_log', 'Oak Log', 2, t('log_top', '#b18e58', '#8e6d40', '#6b5132'), { tool: 'axe', side: t('log_side', '#6b5132', '#523d23', '#7d6140') }),
  oak_planks: cube('oak_planks', 'Oak Planks', 2, t('planks', '#b98d58', '#8e6a3f', '#c99d68'), { tool: 'axe' }),
  oak_leaves: { id: 'oak_leaves', label: 'Oak Leaves', render: 'cutout', solid: true, opaque: false, filter: 1, hardness: 0.2, drops: null, bonus: { item: 'apple', chance: 0.06 }, top: t('leaves', '#4c8a33', '#3a6e27', '#64a344') },
  birch_log: cube('birch_log', 'Birch Log', 2, t('log_top', '#cdb787', '#ab9563', '#ddd8cc'), { tool: 'axe', side: t('birch_side', '#ddd8cc', '#3b3832', '#c4beb0') }),
  birch_planks: cube('birch_planks', 'Birch Planks', 2, t('planks', '#d5c08b', '#b19d68', '#e2cf9d'), { tool: 'axe' }),
  birch_leaves: { id: 'birch_leaves', label: 'Birch Leaves', render: 'cutout', solid: true, opaque: false, filter: 1, hardness: 0.2, drops: null, top: t('leaves', '#6d9c44', '#557f33', '#86b45a') },
  spruce_log: cube('spruce_log', 'Spruce Log', 2, t('log_top', '#7d5f3a', '#5f4629', '#4f3a22'), { tool: 'axe', side: t('log_side', '#4f3a22', '#3a2a17', '#5f4630') }),
  spruce_planks: cube('spruce_planks', 'Spruce Planks', 2, t('planks', '#7b5b37', '#5e4428', '#8b6a44'), { tool: 'axe' }),
  spruce_leaves: { id: 'spruce_leaves', label: 'Spruce Leaves', render: 'cutout', solid: true, opaque: false, filter: 1, hardness: 0.2, drops: null, top: t('leaves', '#2f5d3b', '#22472c', '#3f7450') },
  dark_planks: cube('dark_planks', 'Dark Planks', 2, t('planks', '#4b3321', '#352316', '#5c4129'), { tool: 'axe' }),
  cactus: { id: 'cactus', label: 'Cactus', render: 'cube', solid: true, opaque: true, hardness: 0.4, top: t('cactus_top', '#6aa646', '#4a8233'), side: t('cactus_side', '#5c9a3a', '#3f7a2a', '#d8e8b0') },
  dead_bush: plant('dead_bush', 'Dead Bush', t('dead_bush', '#8a6a3e', '#6d5230'), 'stick'),
  tall_grass: plant('tall_grass', 'Tall Grass', t('tall_grass', '#6aa040', '#4f8530', '#86bb55'), null, { item: 'wheat', chance: 0.14 }),
  poppy: plant('poppy', 'Poppy', t('flower', '#d8312b', '#4f8530', '#f05a45')),
  dandelion: plant('dandelion', 'Dandelion', t('flower', '#f2d22e', '#4f8530', '#fff07a')),
  cornflower: plant('cornflower', 'Cornflower', t('flower', '#4a6fe3', '#4f8530', '#7d9cf5')),

  coal_ore: ore('coal_ore', 'Coal Ore', '#2a2a2c', 1, 'coal'),
  iron_ore: ore('iron_ore', 'Iron Ore', '#d9ab8c', 2, null),
  gold_ore: ore('gold_ore', 'Gold Ore', '#f5d33f', 3, null),
  diamond_ore: ore('diamond_ore', 'Diamond Ore', '#5fe3e0', 3, 'diamond'),
  coal_block: cube('coal_block', 'Block of Coal', 5, t('metal', '#2a2a2c', '#1a1a1c', '#3c3c3f'), { tool: 'pickaxe', tier: 1 }),
  iron_block: cube('iron_block', 'Block of Iron', 5, t('metal', '#d6d6d6', '#b4b4b4', '#f2f2f2'), { tool: 'pickaxe', tier: 2 }),
  gold_block: cube('gold_block', 'Block of Gold', 3, t('metal', '#f3c53e', '#d9a520', '#fde58a'), { tool: 'pickaxe', tier: 3 }),
  diamond_block: cube('diamond_block', 'Block of Diamond', 5, t('metal', '#68ddd5', '#3fbdb5', '#b5f5f0'), { tool: 'pickaxe', tier: 3 }),

  bricks: cube('bricks', 'Bricks', 2, t('bricks', '#9c4a39', '#c7b7a3', '#b0594a'), { tool: 'pickaxe', tier: 1 }),
  stone_bricks: cube('stone_bricks', 'Stone Bricks', 1.5, t('stone_bricks', '#808285', '#5c5e61', '#97999c'), { tool: 'pickaxe', tier: 1 }),
  mossy_stone_bricks: cube('mossy_stone_bricks', 'Mossy Stone Bricks', 1.5, t('stone_bricks', '#7b7f7c', '#5a5d5b', '#5f7d3a'), { tool: 'pickaxe', tier: 1 }),
  smooth_stone: cube('smooth_stone', 'Smooth Stone', 2, t('smooth', '#a3a5a7', '#8c8e90'), { tool: 'pickaxe', tier: 1 }),
  quartz: cube('quartz', 'Quartz Block', 0.8, t('smooth', '#ece6dc', '#d8d0c3'), { tool: 'pickaxe', tier: 1 }),
  terracotta: cube('terracotta', 'Terracotta', 1.25, t('noise', '#a25f43', '#8e5038'), { tool: 'pickaxe', tier: 1 }),
  roof_tiles: cube('roof_tiles', 'Roof Tiles', 1.25, t('tiles', '#8f3c2e', '#6c2a20', '#a8503f'), { tool: 'pickaxe', tier: 1 }),
  glass: { id: 'glass', label: 'Glass', render: 'cutout', solid: true, opaque: false, hardness: 0.3, drops: null, top: t('glass', '#cfe8f5', '#f2fbff', '#a8d4ec') },
  glowstone: cube('glowstone', 'Glowstone', 0.3, t('glow', '#f0c25a', '#fff2b0', '#c98e2c'), { emissive: 15 }),
  torch: { id: 'torch', label: 'Torch', render: 'cross', solid: false, opaque: false, emissive: 14, hardness: 0, top: t('torch', '#7a5a36', '#ffd34d', '#ff8a1f') },
  bookshelf: cube('bookshelf', 'Bookshelf', 1.5, t('planks', '#b98d58', '#8e6a3f', '#c99d68'), { tool: 'axe', side: t('bookshelf', '#8e6a3f', '#a33b2f', '#3b5ea8') }),
  crafting_table: cube('crafting_table', 'Crafting Table', 2.5, t('table_top', '#a57b47', '#6e4f2c', '#c9a06a'), { tool: 'axe', side: t('table_side', '#8e6a3f', '#5c4126', '#b8b8b8'), bottom: t('planks', '#b98d58', '#8e6a3f', '#c99d68') }),
  hay_bale: cube('hay_bale', 'Hay Bale', 0.5, t('hay_top', '#d8b13d', '#b08a28', '#ead07a'), { side: t('hay_side', '#d8b13d', '#8b5a2b', '#ead07a') }),

  white_wool: wool('white_wool', 'White Wool', '#e9ecec'),
  red_wool: wool('red_wool', 'Red Wool', '#a8302b'),
  orange_wool: wool('orange_wool', 'Orange Wool', '#ee7a1c'),
  yellow_wool: wool('yellow_wool', 'Yellow Wool', '#f5c530'),
  lime_wool: wool('lime_wool', 'Lime Wool', '#74b628'),
  green_wool: wool('green_wool', 'Green Wool', '#58702a'),
  cyan_wool: wool('cyan_wool', 'Cyan Wool', '#1a8b93'),
  light_blue_wool: wool('light_blue_wool', 'Light Blue Wool', '#45addb'),
  blue_wool: wool('blue_wool', 'Blue Wool', '#3a3fa0'),
  purple_wool: wool('purple_wool', 'Purple Wool', '#7b31ad'),
  magenta_wool: wool('magenta_wool', 'Magenta Wool', '#bd4ab4'),
  pink_wool: wool('pink_wool', 'Pink Wool', '#ec92b0'),
  brown_wool: wool('brown_wool', 'Brown Wool', '#77502f'),
  gray_wool: wool('gray_wool', 'Gray Wool', '#454b4f'),
  black_wool: wool('black_wool', 'Black Wool', '#18191d'),
});

const AIR_SPEC: BlockSpec = { id: 'air', label: 'Air', render: 'none', solid: false, opaque: false, hardness: 0, drops: null, top: t('solid', '#000000') };

/** Map a custom block def onto a block spec (recoloring a built-in keeps its behaviour). */
export function specFromDef(def: VoxelBlockDef, builtin: BlockSpec | undefined): BlockSpec {
  const pattern: TilePattern = def.pattern === 'tiles' ? 'tiles' : def.pattern;
  const detail = def.detail ?? shade(def.color, -0.18);
  const accent = shade(def.color, 0.14);
  // Recoloring a built-in with the default pattern keeps each face's own pattern (grass sides stay grass sides).
  const tile = (base: string, keep: TileSpec | undefined): TileSpec =>
    keep && def.pattern === 'noise' ? { ...keep, base, detail: def.detail ?? shade(base, -0.18), accent: shade(base, 0.14) } : t(pattern, base, detail, accent);
  const top = tile(def.top ?? def.color, builtin?.top);
  const side = tile(def.color, builtin ? (builtin.side ?? builtin.top) : undefined);
  const bottom = tile(def.bottom ?? def.color, builtin ? (builtin.bottom ?? builtin.top) : undefined);
  const render: BlockRender = def.liquid ? 'liquid' : def.transparent ? 'cutout' : 'cube';
  return {
    ...(builtin ?? {}),
    id: def.id,
    label: def.name ?? builtin?.label ?? titleCase(def.id),
    render: builtin && builtin.render === 'cross' ? 'cross' : render,
    solid: def.liquid ? false : def.solid,
    opaque: !def.transparent && !def.liquid && def.solid,
    liquid: def.liquid,
    emissive: def.emissive,
    filter: def.liquid ? 2 : def.transparent ? 1 : 0,
    hardness: def.hardness,
    ...(def.drops !== undefined ? { drops: def.drops } : {}),
    top,
    side,
    bottom,
  };
}

function titleCase(id: string): string {
  return id.replace(/_/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** Lighten (amount > 0) or darken a "#rrggbb" color. */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number): number => Math.round(Math.max(0, Math.min(255, amount >= 0 ? v + (255 - v) * amount : v * (1 + amount))));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function tileKey(s: TileSpec): string {
  return `${s.pattern}|${s.base}|${s.detail ?? ''}|${s.accent ?? ''}`;
}

/** Most distinct tiles in the atlas (16 × 16 grid). */
export const MAX_TILES = 256;

/**
 * The resolved registry of one world: built-ins (possibly recolored) plus
 * custom blocks, numeric ids, per-face atlas tiles and flag tables for the
 * hot loops (meshing, lighting, collision).
 */
export class BlockRegistry {
  /** Block types by numeric id (index 0 is air). */
  readonly types: readonly BlockType[];
  /** Distinct tiles in atlas order. */
  readonly tiles: readonly TileSpec[];
  /** Per numeric id: 1 when solid (collides). */
  readonly solid: Uint8Array;
  /** Per numeric id: 1 when opaque (hides faces, stops light). */
  readonly opaque: Uint8Array;
  /** Per numeric id: render class (0 none, 1 cube, 2 cutout, 3 cross, 4 liquid). */
  readonly render: Uint8Array;
  /** Per numeric id: emitted block light. */
  readonly emissive: Uint8Array;
  /** Per numeric id: light lost when passing (1 + filter for non-opaque, 15 for opaque). */
  readonly lightCost: Uint8Array;
  /** Per numeric id × 3: atlas tile of [top, bottom, side]. */
  readonly faceTiles: Uint16Array;
  private readonly byName = new Map<string, number>();

  constructor(custom: readonly VoxelBlockDef[] = []) {
    const specs: BlockSpec[] = [AIR_SPEC];
    const overrides = new Map(custom.map((d) => [d.id, d] as const));
    for (const id of VOXEL_BLOCK_IDS) {
      const builtin = BUILTIN_BLOCKS[id] as BlockSpec;
      const def = overrides.get(id);
      specs.push(def ? specFromDef(def, builtin) : builtin);
    }
    for (const def of custom) if (!Object.prototype.hasOwnProperty.call(BUILTIN_BLOCKS, def.id) && def.id !== 'air') specs.push(specFromDef(def, undefined));

    const tileIndex = new Map<string, number>();
    const tiles: TileSpec[] = [];
    const tileOf = (s: TileSpec): number => {
      const key = tileKey(s);
      const hit = tileIndex.get(key);
      if (hit !== undefined) return hit;
      if (tiles.length >= MAX_TILES) return 0;
      tileIndex.set(key, tiles.length);
      tiles.push(s);
      return tiles.length - 1;
    };
    const n = specs.length;
    this.solid = new Uint8Array(n);
    this.opaque = new Uint8Array(n);
    this.render = new Uint8Array(n);
    this.emissive = new Uint8Array(n);
    this.lightCost = new Uint8Array(n);
    this.faceTiles = new Uint16Array(n * 3);
    const types: BlockType[] = [];
    specs.forEach((s, num) => {
      const side = s.side ?? s.top;
      const bottom = s.bottom ?? s.top;
      const tiles3: [number, number, number] = num === AIR ? [0, 0, 0] : [tileOf(s.top), tileOf(bottom), tileOf(side)];
      const type: BlockType = {
        ...s,
        num,
        liquid: s.liquid === true,
        emissive: Math.max(0, Math.min(15, s.emissive ?? 0)),
        filter: s.filter ?? 0,
        tier: s.tier ?? 0,
        side,
        bottom,
        tiles: tiles3,
        color: s.render === 'cube' || s.render === 'liquid' ? side.base : s.top.base,
      };
      types.push(type);
      this.byName.set(s.id, num);
      this.solid[num] = s.solid ? 1 : 0;
      this.opaque[num] = s.opaque ? 1 : 0;
      this.render[num] = RENDER_CODE[s.render];
      this.emissive[num] = type.emissive;
      this.lightCost[num] = s.opaque ? 15 : 1 + type.filter;
      this.faceTiles[num * 3] = tiles3[0];
      this.faceTiles[num * 3 + 1] = tiles3[1];
      this.faceTiles[num * 3 + 2] = tiles3[2];
    });
    this.types = types;
    this.tiles = tiles;
  }

  /** Numeric id of a block name (undefined when unknown). */
  id(name: string): number | undefined {
    return this.byName.get(name);
  }

  /** Numeric id of a block name, or air. */
  idOr(name: string, fallback = AIR): number {
    return this.byName.get(name) ?? fallback;
  }

  /** Block type by numeric id (air for out-of-range ids). */
  type(num: number): BlockType {
    return (this.types[num] ?? this.types[AIR]) as BlockType;
  }

  /** Number of block types including air. */
  get size(): number {
    return this.types.length;
  }
}

/** Numeric render codes of {@link BlockRegistry.render}. */
export const RENDER_CODE: Readonly<Record<BlockRender, number>> = Object.freeze({ none: 0, cube: 1, cutout: 2, cross: 3, liquid: 4 });
