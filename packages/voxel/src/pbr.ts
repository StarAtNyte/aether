/**
 * Photographic block materials: binds every procedural tile of a registry to a PBR material of the
 * block texture sheets (`apps/studio/public/blocks`, CC0 ambientCG scans) and describes how the terrain
 * shader treats it. The procedural pixel atlas stays the fallback for tiles that have no photographic
 * counterpart (flowers, torches, glass frames, book spines …) and supplies the alpha holes of sprites.
 *
 * A binding is data only: the render layer uploads {@link buildTileTable} as a small float texture (one
 * column per atlas tile) and the shader looks the tile up per fragment, so recoloured custom blocks and
 * bundled worlds share one code path. Tints re-colour the photograph towards the tile's own colour
 * (`(specColour / meanColour)^strength`, linear), which keeps wool, custom palettes and biome variants
 * working while the surface detail stays photographic.
 */
import type { TilePattern, TileSpec } from './blocks';

/** How the terrain shader shades a tile. */
export const PBR_CLASS = Object.freeze({
  /** No photograph: the procedural atlas colour (sprites, glass frames, book spines). */
  atlas: 0,
  /** Plain PBR material. */
  standard: 1,
  /** Dirt block with a grass fringe on the top edge (primary dirt, secondary grass). */
  grassSide: 2,
  /** Dirt block with a snow fringe on the top edge (primary dirt, secondary snow). */
  snowSide: 3,
  /** Foliage: alpha-cut clumps, translucency and wind. */
  leaves: 4,
  /** Stone with ore flecks of the accent colour. */
  ore: 5,
  /** Emissive flowing lava. */
  lava: 6,
  /** Glossy ice with inner scattering. */
  ice: 7,
  /** Metal: the albedo tints the reflection. */
  metal: 8,
  /** Emissive stone (glowstone): the atlas pattern drives the glow. */
  glow: 9,
  /** Grass blades drawn by the shader (alpha-cut, tapered, bending) in the tile's own colours. */
  blades: 10,
} as const);

/** Values of {@link PBR_CLASS}. */
export type PbrClass = (typeof PBR_CLASS)[keyof typeof PBR_CLASS];

/** How a tile maps onto the photographic materials. */
export interface PbrBinding {
  /** Material key of the sheets (null: no photograph, use the atlas). */
  key: string | null;
  cls: PbrClass;
  /** Multiplier of the material's roughness map (polished stone < 1). */
  rough: number;
  metallic: number;
  /** 0 keeps the photograph's own colour, 1 re-colours it fully to the tile's colour. */
  tint: number;
  /** How strongly the surface darkens and glosses near the waterline (0…1). */
  wet: number;
  /** Secondary material (the fringe of grass or snow sides). */
  key2?: string;
  /** Accent colour for ore flecks. */
  accent?: string;
  /** Emission strength (linear, 1 ≈ the sun-lit albedo). */
  emissive: number;
}

const bind = (key: string | null, cls: PbrClass, extra: Partial<PbrBinding> = {}): PbrBinding => ({
  key, cls, rough: 1, metallic: 0, tint: 0.85, wet: 0, emissive: 0, ...extra,
});

function parseHex(hex: string | undefined): [number, number, number] {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return [0.5, 0.5, 0.5];
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** sRGB (0…1) → linear. */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** A "#rrggbb" colour as linear RGB (grey when malformed). */
export function hexLinear(hex: string | undefined): [number, number, number] {
  const [r, g, b] = parseHex(hex);
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
}

function chroma(hex: string): number {
  const [r, g, b] = parseHex(hex);
  const mx = Math.max(r, g, b);
  return mx <= 0 ? 0 : (mx - Math.min(r, g, b)) / mx;
}

function luma(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Pattern → binding table (patterns that depend on the colour are resolved in {@link pbrBinding}). */
const BY_PATTERN: Partial<Record<TilePattern, PbrBinding>> = {
  solid: bind('plaster', 1, { tint: 1 }),
  stone: bind('stone', 1, { rough: 0.95, wet: 0.2 }),
  cobble: bind('cobble', 1, { wet: 0.25 }),
  mossy: bind('rock-mossy', 1, { wet: 0.25 }),
  dirt: bind('dirt', 1, { wet: 1 }),
  grass_top: bind('grass', 1, { wet: 0.35, rough: 1 }),
  grass_side: bind('dirt', 2, { wet: 0.8, key2: 'grass' }),
  snow_side: bind('dirt', 3, { wet: 0.5, key2: 'snow' }),
  sand: bind('sand', 1, { wet: 1, tint: 0.9 }),
  log_side: bind('bark', 1, { tint: 0.6 }),
  log_top: bind('wood', 1, { tint: 0.7 }),
  birch_side: bind('bark', 1, { tint: 1 }),
  planks: bind('planks', 1, { tint: 0.8 }),
  leaves: bind('moss', 4, { tint: 1, rough: 1 }),
  bricks: bind('bricks', 1, { tint: 0.55 }),
  stone_bricks: bind('stonebricks', 1, { tint: 0.7 }),
  glow: bind(null, 9, { emissive: 1.6 }),
  cactus_top: bind('moss', 1, { tint: 1 }),
  lava: bind('lava', 6, { emissive: 2.4, tint: 0 }),
  tall_grass: bind(null, 10),
  torch: bind(null, 0, { emissive: 2.2 }),
  wool: bind('fabric', 1, { tint: 1, rough: 1 }),
  tiles: bind('rooftile', 1, { tint: 0.7, rough: 0.8 }),
  table_top: bind('planks', 1, { tint: 0.8 }),
  hay_top: bind('thatch', 1, { tint: 0.8 }),
  hay_side: bind('thatch', 1, { tint: 0.8 }),
  // Half metallic: blocks are lit by the sun and sky only (no reflections to catch), where a full metal reads dark and olive.
  metal: bind('metal', 8, { tint: 1, metallic: 0.45, rough: 0.42 }),
  ice: bind('ice', 7, { tint: 0.75, rough: 0.35 }),
  obsidian: bind('rock-dark', 1, { tint: 1, rough: 0.28, metallic: 0.05 }),
  bedrock: bind('rock-dark', 1, { tint: 0.9, rough: 1 }),
  sandstone: bind('sandstone', 1, { tint: 0.8 }),
};

/**
 * The binding of one tile spec: the photographic material, its class and tint strength.
 * Pure and deterministic (the shader never sees the pattern name).
 */
export function pbrBinding(spec: TileSpec): PbrBinding {
  const p = spec.pattern;
  switch (p) {
    case 'noise':
      if (luma(spec.base) > 0.85 && chroma(spec.base) < 0.12) return bind('snow', 1, { tint: 0.7, wet: 0.2 });
      if (chroma(spec.base) > 0.3) return bind('clay', 1, { tint: 1 });
      return bind('concrete', 1, { tint: 1 });
    case 'smooth':
      return luma(spec.base) > 0.78 ? bind('plaster', 1, { tint: 1, rough: 0.45 }) : bind('concrete', 1, { tint: 1, rough: 0.5 });
    case 'gravel':
      return chroma(spec.base) > 0.3 ? bind('dirt-coarse', 1, { tint: 0.9, wet: 0.9 }) : bind('gravel-grey', 1, { tint: 0.9, wet: 0.6 });
    case 'planks':
      return luma(spec.base) < 0.26 ? bind('planks-dark', 1, { tint: 0.8 }) : bind('planks', 1, { tint: 0.8 });
    case 'ore':
      return bind('stone', 5, { tint: 0.9, accent: spec.detail ?? '#ffffff', rough: 0.9 });
    default: {
      const hit = BY_PATTERN[p];
      if (hit) return { ...hit };
      // No photographic counterpart: tile painted by the pixel atlas (sprites, water, glass, books, stripes, dots).
      return bind(null, 0);
    }
  }
}

/** Texture rows of the tile table (see {@link buildTileTable}). */
export const TILE_TABLE_ROWS = 4;

/** One material of the sheets (`block-materials.json`). */
export interface SheetMaterial {
  key: string;
  slot: number;
  /** Mean linear colour of the albedo. */
  mean: readonly [number, number, number];
}

/**
 * The per-tile lookup the terrain shader reads, RGBA float, `width` columns (one per atlas tile) × 4 rows:
 * row 0 `(slot, class, roughness scale, metallic)`, row 1 `(tint rgb, wet)`, row 2 `(tint2 rgb, slot2)`,
 * row 3 `(accent rgb, emissive)`. `slot` is −1 for tiles without a photograph.
 */
export function buildTileTable(tiles: readonly TileSpec[], materials: readonly SheetMaterial[], width = 256): Float32Array {
  const out = new Float32Array(width * TILE_TABLE_ROWS * 4);
  const bySlot = new Map(materials.map((m) => [m.key, m] as const));
  const tintOf = (hex: string, m: SheetMaterial | undefined, strength: number): [number, number, number] => {
    if (!m || strength <= 0) return [1, 1, 1];
    const lin = hexLinear(hex);
    return lin.map((v, i) => {
      const mean = Math.max(0.004, m.mean[i] as number);
      return Math.min(3.2, Math.max(0.25, (Math.max(0.004, v) / mean) ** strength));
    }) as [number, number, number];
  };
  for (let i = 0; i < width; i++) {
    const spec = tiles[i];
    let slot = -1;
    let cls = 0;
    let rough = 1;
    let metallic = 0;
    let tint: [number, number, number] = [1, 1, 1];
    let wet = 0;
    let slot2 = -1;
    let tint2: [number, number, number] = [1, 1, 1];
    let accent: [number, number, number] = [0, 0, 0];
    let emissive = 0;
    if (spec) {
      const b = pbrBinding(spec);
      const m = b.key ? bySlot.get(b.key) : undefined;
      if (m) {
        slot = m.slot;
        cls = b.cls;
        rough = b.rough;
        metallic = b.metallic;
        wet = b.wet;
        tint = tintOf(spec.base, m, b.tint);
        if (b.key2) {
          const m2 = bySlot.get(b.key2);
          if (m2) {
            slot2 = m2.slot;
            // The fringe colour is the detail colour of the side tile (its grass or snow).
            tint2 = tintOf(spec.detail ?? spec.base, m2, 0.9);
          }
        }
        if (b.accent) accent = hexLinear(b.accent);
        emissive = b.emissive;
      } else {
        // Atlas fallback; emissive patterns keep their glow, grass keeps its blades.
        cls = b.cls === PBR_CLASS.glow || b.cls === PBR_CLASS.blades ? b.cls : PBR_CLASS.atlas;
        emissive = b.emissive;
        if (b.cls === PBR_CLASS.blades) {
          accent = hexLinear(spec.base);
          tint2 = hexLinear(spec.accent ?? spec.base);
        }
      }
    }
    const o0 = i * 4;
    const o1 = (width + i) * 4;
    const o2 = (width * 2 + i) * 4;
    const o3 = (width * 3 + i) * 4;
    out.set([slot, cls, rough, metallic], o0);
    out.set([tint[0], tint[1], tint[2], wet], o1);
    out.set([tint2[0], tint2[1], tint2[2], slot2], o2);
    out.set([accent[0], accent[1], accent[2], emissive], o3);
  }
  return out;
}
