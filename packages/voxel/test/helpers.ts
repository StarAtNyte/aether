import { VoxelTerrain, type VoxelTerrainInput } from '@aether/core';
import { BlockRegistry } from '../src/blocks';
import { ChunkData } from '../src/chunk';
import { CHUNK, CHUNK_VOLUME, LAYER } from '../src/constants';
import { VoxelWorld } from '../src/world';

/** A registry with the built-in blocks. */
export const reg = new BlockRegistry();

/** Numeric id of a block name (throws when unknown). */
export function id(name: string): number {
  const n = reg.id(name);
  if (n === undefined) throw new Error(`unknown block ${name}`);
  return n;
}

/** A world of flat ground: `ground` fills y ≤ groundTop in chunks within ±r. */
export function flatWorld(r = 1, groundTop = 9, ground = 'stone'): VoxelWorld {
  const w = new VoxelWorld(reg);
  const g = id(ground);
  for (let cz = -r; cz <= r; cz++) {
    for (let cx = -r; cx <= r; cx++) {
      const dense = new Uint16Array(CHUNK_VOLUME);
      dense.fill(g, 0, (groundTop + 1) * LAYER);
      w.put(cx, cz, ChunkData.fromDense(dense), groundTop);
    }
  }
  return w;
}

/** Parsed terrain settings. */
export function terrain(input: VoxelTerrainInput = {}): VoxelTerrain {
  return VoxelTerrain.parse(input);
}

export { CHUNK };
