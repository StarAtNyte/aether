/**
 * The two CPU-heavy jobs of the voxel engine, shared by the Web Worker and
 * the inline fallback: generating a chunk (terrain + document edits) and
 * meshing a chunk from its 3 × 3 neighbourhood (light + greedy mesh).
 *
 * A {@link VoxelJobContext} holds the compiled configuration of one terrain
 * (registry, generator, compiled edits) and the reusable scratch buffers,
 * so a worker processes job after job without allocating big arrays.
 */
import { stableStringify, type VoxelTerrain } from '@aether/core';
import { hashString } from '@aether/core';
import { BlockRegistry } from './blocks';
import { ChunkData, type PackedChunk } from './chunk';
import { AIR, CHUNK, CHUNK_VOLUME, HEIGHT, LAYER } from './constants';
import { applyEdits, compileEdits, type CompiledEdit } from './edits';
import { LightVolume, REGION, REGION_LAYER } from './light';
import { ChunkMesher, type ChunkMesh } from './mesher';
import { TerrainGenerator } from './terrain';

/** Everything that changes generated blocks (not game settings or view distance). */
export interface TerrainIdentity {
  preset: VoxelTerrain['preset'];
  seed: number;
  border: number;
  blocks: VoxelTerrain['blocks'];
  edits: VoxelTerrain['edits'];
}

/** The generation-relevant part of a terrain (its seed defaults to the world seed). */
export function terrainIdentity(t: VoxelTerrain, worldSeed: number): TerrainIdentity {
  return { preset: t.preset, seed: t.seed ?? worldSeed, border: t.border, blocks: t.blocks, edits: t.edits };
}

/** Stable key of a terrain identity (jobs carry it so stale replies are dropped). */
export function identityKey(id: TerrainIdentity): string {
  return `${id.preset}:${id.seed}:${id.border}:${hashString(stableStringify(id.blocks))}:${hashString(stableStringify(id.edits))}:${id.edits.length}`;
}

/** Key of what a player save belongs to: preset, seed and border (edits may change underneath a save). */
export function saveIdentity(id: Pick<TerrainIdentity, 'preset' | 'seed' | 'border'>): string {
  return `${id.preset}:${id.seed}:${id.border}`;
}

/** True when chunk (cx, cz) lies outside a finite world's border (generated empty). */
export function outsideBorder(border: number, cx: number, cz: number): boolean {
  if (border <= 0) return false;
  const x0 = cx * CHUNK;
  const z0 = cz * CHUNK;
  return x0 >= border || z0 >= border || x0 + CHUNK <= -border || z0 + CHUNK <= -border;
}

/** Compiled terrain configuration plus reusable buffers. */
export class VoxelJobContext {
  readonly key: string;
  readonly reg: BlockRegistry;
  readonly gen: TerrainGenerator;
  readonly edits: CompiledEdit[];
  readonly border: number;
  private readonly dense = new Uint16Array(CHUNK_VOLUME);
  private readonly scratch = new Uint16Array(CHUNK_VOLUME);
  private volume: LightVolume | null = null;
  private readonly tops = new Int32Array(9);
  private mesher: ChunkMesher | null = null;

  constructor(identity: TerrainIdentity) {
    this.key = identityKey(identity);
    this.reg = new BlockRegistry(identity.blocks);
    this.gen = new TerrainGenerator(identity.seed, identity.preset, this.reg);
    this.edits = compileEdits(identity.edits, this.reg, this.gen, identity.seed);
    this.border = identity.border;
  }

  /** Generate chunk (cx, cz): natural terrain, then the document edits that touch it. */
  generate(cx: number, cz: number): { chunk: ChunkData; top: number } {
    const dense = this.dense;
    if (outsideBorder(this.border, cx, cz)) dense.fill(AIR);
    else {
      this.gen.generate(cx, cz, dense);
      applyEdits(this.edits, cx, cz, dense);
      if (this.border > 0) clipBorder(dense, cx, cz, this.border);
    }
    return { chunk: ChunkData.fromDense(dense), top: denseTop(dense) };
  }

  /**
   * Mesh the centre of a 3 × 3 neighbourhood. `chunks[(dz + 1) * 3 + (dx + 1)]`;
   * missing neighbours count as air. `tops` (same order) are the chunks'
   * highest non-air y when known (saves a scan); −1 entries are computed.
   */
  mesh(chunks: ReadonlyArray<ChunkData | null>, tops?: ArrayLike<number>): ChunkMesh {
    const vol = (this.volume ??= new LightVolume());
    const mesher = (this.mesher ??= new ChunkMesher(this.reg));
    const scratch = this.scratch;
    const blocks = vol.blocks;
    const top9 = this.tops;
    let top = -1;
    for (let k = 0; k < 9; k++) {
      const c = chunks[k];
      const known = tops ? (tops[k] as number) : -1;
      top9[k] = c ? (known >= 0 && known < HEIGHT ? known : c.topY()) : -1;
      if ((top9[k] as number) > top) top = top9[k] as number;
    }
    vol.top = top;
    const rows = Math.min(HEIGHT, top + 2);
    blocks.fill(AIR, 0, Math.max(0, rows) * REGION_LAYER);
    let emitters = false;
    for (let k = 0; k < 9; k++) {
      const c = chunks[k];
      if (!c) continue;
      if (!emitters && c.hasAny(this.reg.emissive)) emitters = true;
      const crows = Math.min(rows, (top9[k] as number) + 1);
      if (crows <= 0) continue;
      c.toDenseRows(scratch, crows);
      const ox = (k % 3) * CHUNK;
      const oz = Math.floor(k / 3) * CHUNK;
      for (let y = 0; y < crows; y++) {
        for (let z = 0; z < CHUNK; z++) {
          const src = z * CHUNK + y * LAYER;
          const dst = ox + (oz + z) * REGION + y * REGION_LAYER;
          for (let x = 0; x < CHUNK; x++) blocks[dst + x] = scratch[src + x] as number;
        }
      }
    }
    vol.compute(this.reg, emitters);
    return mesher.mesh(vol);
  }
}

function denseTop(dense: Uint16Array): number {
  for (let i = CHUNK_VOLUME - 1; i >= 0; i--) if (dense[i] !== AIR) return Math.floor(i / LAYER);
  return -1;
}

function clipBorder(dense: Uint16Array, cx: number, cz: number, border: number): void {
  for (let z = 0; z < CHUNK; z++) {
    for (let x = 0; x < CHUNK; x++) {
      const wx = cx * CHUNK + x;
      const wz = cz * CHUNK + z;
      if (wx >= -border && wx < border && wz >= -border && wz < border) continue;
      for (let y = 0; y < HEIGHT; y++) dense[x + z * CHUNK + y * LAYER] = AIR;
    }
  }
}

/** Packed chunks of a neighbourhood (worker message payload). */
export type PackedNeighbourhood = Array<PackedChunk | null>;
