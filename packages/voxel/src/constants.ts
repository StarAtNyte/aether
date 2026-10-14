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
export function cellIndex(x: number, y: number, z: number): number {
  return x + z * CHUNK + y * LAYER;
}

/** Numeric key of chunk (cx, cz) — a safe integer, usable as a Map key. */
export function chunkKey(cx: number, cz: number): number {
  return (cx + 0x8000) * 0x10000 + (cz + 0x8000);
}

/** Chunk x of a key. */
export function keyX(key: number): number {
  return Math.floor(key / 0x10000) - 0x8000;
}

/** Chunk z of a key. */
export function keyZ(key: number): number {
  return (key % 0x10000) - 0x8000;
}

/** Largest chunk coordinate magnitude (keys stay unique within ±32767). */
export const MAX_CHUNK_COORD = 0x7fff;
