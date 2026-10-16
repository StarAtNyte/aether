/**
 * Voxel grid constants and coordinate helpers.
 *
 * A chunk is a 16 × 16 column of the full world height (128). Blocks inside
 * a chunk are stored x-fastest, then z, then y: `index = x + z·16 + y·256`,
 * so a horizontal layer is 256 consecutive cells and a column steps by 256.
 */
import { VOXEL_CHUNK_SIZE, VOXEL_SEA_LEVEL, VOXEL_WORLD_HEIGHT } from '@aether/core';
/** Chunk edge (x and z), blocks. */
export const CHUNK = VOXEL_CHUNK_SIZE;
/** World height, blocks. */
export const HEIGHT = VOXEL_WORLD_HEIGHT;
/** Cells in one horizontal layer of a chunk. */
export const LAYER = CHUNK * CHUNK;
/** Cells in a chunk. */
export const CHUNK_VOLUME = LAYER * HEIGHT;
/** Water surface level of generated terrain (top water block is SEA_LEVEL − 1). */
export const SEA_LEVEL = VOXEL_SEA_LEVEL;
/** Air. Numeric block id 0. */
export const AIR = 0;
/** Index of local cell (x, y, z) inside a chunk (no bounds check). */
export function cellIndex(x, y, z) {
    return x + z * CHUNK + y * LAYER;
}
/** Offset that makes chunk coordinates non-negative inside a key. */
const KEY_OFFSET = 0x4000;
/** Key stride (15 bits per coordinate). */
const KEY_STRIDE = 0x8000;
/**
 * Numeric key of chunk (cx, cz), usable as a Map key. Keys stay below 2³⁰,
 * so V8 keeps them as small integers: lookups in the hot paths (collision,
 * ray casts, streaming) never box a number.
 */
export function chunkKey(cx, cz) {
    return (cx + KEY_OFFSET) * KEY_STRIDE + (cz + KEY_OFFSET);
}
/** Chunk x of a key. */
export function keyX(key) {
    return Math.floor(key / KEY_STRIDE) - KEY_OFFSET;
}
/** Chunk z of a key. */
export function keyZ(key) {
    return (key % KEY_STRIDE) - KEY_OFFSET;
}
/** Largest chunk coordinate magnitude (±16 383 chunks = ±262 000 blocks; keys stay unique). */
export const MAX_CHUNK_COORD = 0x3fff;
