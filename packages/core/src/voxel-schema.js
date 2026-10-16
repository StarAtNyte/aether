/**
 * Voxel terrain in the World IR (additive, optional `world.voxel`).
 *
 * A voxel world is fully described by plain JSON: a seeded terrain
 * generator preset, optional custom block types, an ordered list of edits
 * (boxes, spheres, structures, pixel art …) replayed over the generated
 * terrain, and the game-kit settings (survival rules, day length, mobs,
 * starting items, extra recipes). The same document always regenerates the
 * same blocks. Players' own block changes are game saves, not part of the
 * document (see `@aether/voxel` persistence).
 *
 * Coordinates are integer BLOCK coordinates: block (x, y, z) fills the unit
 * cube [x, x+1] × [y, y+1] × [z, z+1] in world metres. y runs from 0 to
 * {@link VOXEL_WORLD_HEIGHT} − 1. With `anchor: "surface"` an edit's y
 * values are offsets above the generated ground at the edit's anchor column.
 */
import './zod-config';
import { z } from 'zod';
import { VOXEL_MOB_KINDS, VOXEL_PRESETS, VOXEL_STRUCTURES, VOXEL_WORLD_HEIGHT } from './voxel-ids';
const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'color must be #rrggbb');
/** Block or item id: lowercase snake case ("stone", "oak_planks", "my_marble"). */
export const VoxelBlockId = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/, 'block ids are lowercase snake_case');
/** Largest |x| / |z| of an edit coordinate (blocks). */
export const VOXEL_MAX_COORD = 100_000;
const Coord = z.number().int().min(-VOXEL_MAX_COORD).max(VOXEL_MAX_COORD);
/** y may reach above/below the world when anchored to the surface (clipped when rasterized). */
const CoordY = z.number().int().min(-1024).max(1024);
/** Integer block position [x, y, z]. */
export const VoxelPos = z.tuple([Coord, CoordY, Coord]);
/** `world`: y is absolute; `surface`: y is relative to the generated ground at the anchor column. */
export const VoxelAnchor = z.enum(['world', 'surface']);
/** Material palette of a structure (each optional; sensible defaults per structure). */
export const VoxelPalette = z.object({
    wall: VoxelBlockId.optional(),
    roof: VoxelBlockId.optional(),
    floor: VoxelBlockId.optional(),
    trim: VoxelBlockId.optional(),
    window: VoxelBlockId.optional(),
    accent: VoxelBlockId.optional(),
});
/** Facing of stairs and structures. */
export const VoxelDirection = z.enum(['north', 'south', 'east', 'west']);
/** A plane for flat edits: "xy" faces ±z, "zy" faces ±x, "xz" is horizontal. */
export const VoxelPlane = z.enum(['xy', 'zy', 'xz']);
/** Character-grid pixel art: each row is a string, each character a palette key ("." = keep). */
export const VOXEL_MAX_PIXEL_SIDE = 96;
/**
 * Block edits. Applied in document order over the generated terrain; later
 * edits win. "block": "air" carves.
 */
export const VoxelEdit = z.discriminatedUnion('shape', [
    /** Solid (or hollow: walls, floor and ceiling only) axis-aligned box between two corners (inclusive). */
    z.object({ shape: z.literal('box'), from: VoxelPos, to: VoxelPos, block: VoxelBlockId, hollow: z.boolean().default(false), anchor: VoxelAnchor.default('world') }),
    z.object({ shape: z.literal('sphere'), center: VoxelPos, radius: z.number().min(0.5).max(64), block: VoxelBlockId, hollow: z.boolean().default(false), anchor: VoxelAnchor.default('world') }),
    /** Cylinder standing on `base` (its bottom center) along `axis`. */
    z.object({
        shape: z.literal('cylinder'), base: VoxelPos, radius: z.number().min(0.5).max(64), height: z.number().int().min(1).max(VOXEL_WORLD_HEIGHT),
        axis: z.enum(['x', 'y', 'z']).default('y'), block: VoxelBlockId, hollow: z.boolean().default(false), anchor: VoxelAnchor.default('world'),
    }),
    /** Straight line of blocks; `radius` > 0 makes a round beam. */
    z.object({ shape: z.literal('line'), from: VoxelPos, to: VoxelPos, radius: z.number().min(0).max(8).default(0), block: VoxelBlockId, anchor: VoxelAnchor.default('world') }),
    /** A staircase climbing one block per step toward `direction`, filled underneath. */
    z.object({
        shape: z.literal('stairs'), from: VoxelPos, direction: VoxelDirection, steps: z.number().int().min(1).max(VOXEL_WORLD_HEIGHT),
        width: z.number().int().min(1).max(32).default(3), block: VoxelBlockId, anchor: VoxelAnchor.default('world'),
    }),
    /** A procedural building or object (see VOXEL_STRUCTURES). `at` is its bottom center. */
    z.object({
        shape: z.literal('structure'), structure: z.enum(VOXEL_STRUCTURES), at: VoxelPos,
        size: z.enum(['small', 'medium', 'large']).default('medium'), facing: VoxelDirection.default('south'),
        /** Bridge length / wall length in blocks. */
        length: z.number().int().min(3).max(128).optional(),
        palette: VoxelPalette.default({}), anchor: VoxelAnchor.default('surface'),
    }),
    /**
     * Pixel art from a character grid (top row first): `palette` maps a
     * character to a block ("air" carves); "." and " " leave blocks as they are.
     */
    z.object({
        shape: z.literal('pixels'), at: VoxelPos, rows: z.array(z.string().max(VOXEL_MAX_PIXEL_SIDE)).min(1).max(VOXEL_MAX_PIXEL_SIDE),
        palette: z.record(z.string().length(1), VoxelBlockId).refine((p) => Object.keys(p).length <= 24, 'at most 24 palette entries'),
        plane: VoxelPlane.default('xy'), scale: z.number().int().min(1).max(4).default(1), anchor: VoxelAnchor.default('world'),
    }),
    /** Block letters (5×7 font) written left to right; `at` is the bottom-left corner. */
    z.object({
        shape: z.literal('text'), text: z.string().min(1).max(40), at: VoxelPos, block: VoxelBlockId,
        plane: VoxelPlane.default('xy'), scale: z.number().int().min(1).max(4).default(1), anchor: VoxelAnchor.default('world'),
    }),
    /** Replace every `block` inside the box with `with`. */
    z.object({ shape: z.literal('replace'), from: VoxelPos, to: VoxelPos, block: VoxelBlockId, with: VoxelBlockId, anchor: VoxelAnchor.default('world') }),
    /** Empty a box (sets air). */
    z.object({ shape: z.literal('clear'), from: VoxelPos, to: VoxelPos, anchor: VoxelAnchor.default('world') }),
]);
/** Surface pattern of a custom block's procedural texture. */
export const VoxelPattern = z.enum(['noise', 'solid', 'bricks', 'planks', 'stone', 'ore', 'glass', 'leaves', 'stripes', 'dots', 'tiles']);
/**
 * A custom block type (or a recolor of a built-in one when `id` is built-in).
 * Colors drive the procedural pixel texture; `top` / `bottom` default to `color`.
 */
export const VoxelBlockDef = z.object({
    id: VoxelBlockId,
    name: z.string().max(40).optional(),
    color: HexColor,
    top: HexColor.optional(),
    bottom: HexColor.optional(),
    /** Color of ore specks / brick mortar / plank grain, when the pattern uses one. */
    detail: HexColor.optional(),
    pattern: VoxelPattern.default('noise'),
    solid: z.boolean().default(true),
    /** Light passes and neighbours stay visible (glass, leaves). */
    transparent: z.boolean().default(false),
    liquid: z.boolean().default(false),
    /** Block light level emitted (0–15). */
    emissive: z.number().int().min(0).max(15).default(0),
    /** Seconds to break by hand (0 = instant). */
    hardness: z.number().min(0).max(100).default(1),
    /** Item dropped when broken (default: the block itself; null: nothing). */
    drops: VoxelBlockId.nullable().optional(),
});
/** An item stack. */
export const VoxelStack = z.object({ item: VoxelBlockId, count: z.number().int().min(1).max(64).default(1) });
/** A shapeless crafting recipe: the inputs (up to 9 stacks) make `output`. */
export const VoxelRecipe = z.object({
    id: z.string().regex(/^[a-z][a-z0-9_-]{0,47}$/),
    inputs: z.array(VoxelStack).min(1).max(9),
    output: VoxelStack,
});
/** Mob kind. */
export const VoxelMobKind = z.enum(VOXEL_MOB_KINDS);
/** Game-kit settings of a voxel world. */
export const VoxelGame = z.object({
    /** survival: health, hunger, mining times, drops; creative: fly (double-tap Space), instant breaking, infinite blocks; explore: no game HUD. */
    mode: z.enum(['survival', 'creative', 'explore']).default('survival'),
    /** Seconds per full day/night cycle. */
    dayLength: z.number().min(30).max(7200).default(600),
    /** Hour (0–24) at which play starts. */
    startHour: z.number().min(0).max(24).default(8),
    /** Run the day/night cycle (false freezes the clock at startHour). */
    cycle: z.boolean().default(true),
    mobs: z.boolean().default(true),
    passive: z.array(VoxelMobKind).max(8).default(['sheep', 'pig', 'chicken']),
    hostile: z.array(VoxelMobKind).max(8).default(['zombie', 'spider']),
    /** Most mobs alive at once. */
    maxMobs: z.number().int().min(0).max(64).default(20),
    hunger: z.boolean().default(true),
    fallDamage: z.boolean().default(true),
    /** Keep the inventory on death. */
    keepInventory: z.boolean().default(false),
    /** Items in the hotbar / inventory at start (in order). */
    startItems: z.array(VoxelStack).max(36).default([]),
    /** Extra crafting recipes (built-in recipes always exist). */
    recipes: z.array(VoxelRecipe).max(64).default([]),
});
/** Terrain preset. */
export const VoxelPreset = z.enum(VOXEL_PRESETS);
/** Most edits a world can hold. */
export const VOXEL_MAX_EDITS = 2000;
/** Most custom block types. */
export const VOXEL_MAX_BLOCK_DEFS = 64;
/** The voxel terrain of a world. */
export const VoxelTerrain = z.object({
    preset: VoxelPreset.default('survival'),
    /** Terrain seed (default: the world seed). */
    seed: z.number().int().optional(),
    /** Chunks (16 blocks) streamed around the player in each direction. */
    viewDistance: z.number().int().min(2).max(16).default(6),
    /** Half-size of a finite world in blocks (0 = endless). */
    border: z.number().int().min(0).max(30_000).default(0),
    blocks: z.array(VoxelBlockDef).max(VOXEL_MAX_BLOCK_DEFS).default([]),
    edits: z.array(VoxelEdit).max(VOXEL_MAX_EDITS).default([]),
    game: VoxelGame.default(VoxelGame.parse({})),
});
// ---------------------------------------------------------------------------
// Volume bounds (limits are enforced on these upper bounds)
// ---------------------------------------------------------------------------
/** Footprint × height upper bound of each structure size (blocks). */
const STRUCTURE_BOUNDS = { small: 16 * 16 * 24, medium: 32 * 32 * 40, large: 56 * 56 * 64 };
function span(a, b) {
    return Math.abs(a - b) + 1;
}
/** Upper bound of the blocks an edit writes (used for the per-patch and per-world block limits). */
export function voxelEditVolume(e) {
    switch (e.shape) {
        case 'box':
        case 'replace':
        case 'clear':
            return span(e.from[0], e.to[0]) * span(e.from[1], e.to[1]) * span(e.from[2], e.to[2]);
        case 'sphere': {
            const d = 2 * Math.ceil(e.radius) + 1;
            return d * d * d;
        }
        case 'cylinder': {
            const d = 2 * Math.ceil(e.radius) + 1;
            return d * d * e.height;
        }
        case 'line': {
            const len = Math.max(span(e.from[0], e.to[0]), span(e.from[1], e.to[1]), span(e.from[2], e.to[2]));
            const d = 2 * Math.ceil(e.radius) + 1;
            return len * d * d;
        }
        case 'stairs':
            return e.steps * e.steps * e.width;
        case 'structure':
            return e.structure === 'bridge' || e.structure === 'wall' ? (e.length ?? 24) * 12 * 24 : STRUCTURE_BOUNDS[e.size];
        case 'pixels': {
            let w = 0;
            for (const r of e.rows)
                w = Math.max(w, r.length);
            return w * e.rows.length * e.scale * e.scale * e.scale;
        }
        case 'text':
            return e.text.length * 6 * 8 * e.scale * e.scale * e.scale;
    }
}
/** Block ids an edit references (for registry checks). */
export function voxelEditBlocks(e) {
    switch (e.shape) {
        case 'box':
        case 'sphere':
        case 'cylinder':
        case 'line':
        case 'stairs':
        case 'text':
            return [e.block];
        case 'replace':
            return [e.block, e.with];
        case 'clear':
            return [];
        case 'pixels':
            return Object.values(e.palette);
        case 'structure':
            return Object.values(e.palette).filter((v) => typeof v === 'string');
    }
}
