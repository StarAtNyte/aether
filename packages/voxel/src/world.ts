/**
 * The block store of a running voxel world: loaded chunks by key, block
 * reads and writes in world coordinates, and the bookkeeping that turns a
 * write into remesh work (the chunk itself, plus the neighbours whose
 * light/AO border it touches).
 *
 * Reads are the hot path of collision, raycasts and mob AI: the last chunk
 * looked up is cached, so walking along a column or a ray costs one Map
 * lookup per chunk crossed, not per block. Nothing here allocates per read.
 */
import type { BlockRegistry } from './blocks';
import { ChunkData } from './chunk';
import { AIR, CHUNK, cellIndex, chunkKey, HEIGHT } from './constants';

/** One loaded chunk. */
export interface ChunkSlot {
  readonly cx: number;
  readonly cz: number;
  readonly key: number;
  data: ChunkData;
  /** Highest non-air y (−1 when empty). */
  top: number;
  /** Changed by the player since it was generated (saved). */
  modified: boolean;
  /** Bumped on every block change (stale mesh replies are dropped). */
  version: number;
}

/** What {@link VoxelWorld.isSolid} answers for chunks that are not loaded yet. */
export type UnloadedPolicy = 'solid' | 'air';

/** Floor division by the chunk size. */
export function chunkOf(v: number): number {
  return Math.floor(v / CHUNK);
}

/** See the module docs. */
export class VoxelWorld {
  readonly chunks = new Map<number, ChunkSlot>();
  /** Keys of chunks whose mesh is stale (edits), in insertion order. */
  readonly dirty = new Set<number>();
  /** Answer for unloaded chunks in {@link isSolid}: solid keeps players from falling through terrain still streaming in. */
  unloaded: UnloadedPolicy = 'solid';
  private lastKey = Number.NaN;
  private lastSlot: ChunkSlot | undefined = undefined;

  constructor(readonly reg: BlockRegistry) {}

  /** The slot of chunk (cx, cz), if loaded. */
  slot(cx: number, cz: number): ChunkSlot | undefined {
    const key = chunkKey(cx, cz);
    if (key === this.lastKey) return this.lastSlot;
    const s = this.chunks.get(key);
    this.lastKey = key;
    this.lastSlot = s;
    return s;
  }

  /** True when the chunk holding world column (x, z) is loaded. */
  isLoaded(x: number, z: number): boolean {
    return this.slot(chunkOf(x), chunkOf(z)) !== undefined;
  }

  /** Insert (or replace) a chunk. */
  put(cx: number, cz: number, data: ChunkData, top: number, modified = false): ChunkSlot {
    const key = chunkKey(cx, cz);
    const prev = this.chunks.get(key);
    const slot: ChunkSlot = { cx, cz, key, data, top, modified, version: (prev?.version ?? 0) + 1 };
    this.chunks.set(key, slot);
    if (key === this.lastKey) this.lastSlot = slot;
    return slot;
  }

  /** Drop a chunk (returns it). */
  remove(cx: number, cz: number): ChunkSlot | undefined {
    const key = chunkKey(cx, cz);
    const s = this.chunks.get(key);
    this.chunks.delete(key);
    this.dirty.delete(key);
    if (key === this.lastKey) this.lastSlot = undefined;
    return s;
  }

  /** Numeric block at integer world cell (x, y, z): air above/below the world and in unloaded chunks. */
  get(x: number, y: number, z: number): number {
    if (y < 0 || y >= HEIGHT) return AIR;
    const s = this.slot(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
    if (!s) return AIR;
    return s.data.get(cellIndex(x - s.cx * CHUNK, y, z - s.cz * CHUNK));
  }

  /** Block at a world position in metres (floors the coordinates). */
  at(x: number, y: number, z: number): number {
    return this.get(Math.floor(x), Math.floor(y), Math.floor(z));
  }

  /** True when the cell blocks movement (below the world is solid; unloaded follows {@link unloaded}). */
  isSolid(x: number, y: number, z: number): boolean {
    if (y < 0) return true;
    if (y >= HEIGHT) return false;
    const s = this.slot(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
    if (!s) return this.unloaded === 'solid';
    return this.reg.solid[s.data.get(cellIndex(x - s.cx * CHUNK, y, z - s.cz * CHUNK))] === 1;
  }

  /** True when the cell holds a liquid (render class 4). */
  isLiquid(x: number, y: number, z: number): boolean {
    return this.reg.render[this.get(x, y, z)] === 4;
  }

  /**
   * Write a block. Returns the previous id, or −1 when the chunk is not
   * loaded or y is outside the world (nothing changes). Marks the chunk and
   * any neighbour sharing the touched border as dirty.
   */
  set(x: number, y: number, z: number, id: number): number {
    if (y < 0 || y >= HEIGHT || id < 0 || id >= this.reg.size) return -1;
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    const s = this.slot(cx, cz);
    if (!s) return -1;
    const lx = x - cx * CHUNK;
    const lz = z - cz * CHUNK;
    const prev = s.data.set(cellIndex(lx, y, lz), id);
    if (prev === id) return prev;
    s.modified = true;
    s.version++;
    if (id !== AIR && y > s.top) s.top = y;
    this.markDirty(cx, cz);
    // Light and AO of neighbours read a border up to 15 cells wide for light; mesh the
    // direct neighbours always (AO/faces), and diagonals when the edit sits in a corner.
    const west = lx === 0;
    const east = lx === CHUNK - 1;
    const north = lz === 0;
    const south = lz === CHUNK - 1;
    const lightReach = this.reg.emissive[id] !== 0 || this.reg.emissive[prev] !== 0 || this.reg.opaque[id] !== this.reg.opaque[prev];
    if (lightReach) {
      // Light changes can travel up to 15 blocks: remesh the full ring.
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (dx !== 0 || dz !== 0) this.markDirty(cx + dx, cz + dz);
    } else {
      if (west) this.markDirty(cx - 1, cz);
      if (east) this.markDirty(cx + 1, cz);
      if (north) this.markDirty(cx, cz - 1);
      if (south) this.markDirty(cx, cz + 1);
      if (west && north) this.markDirty(cx - 1, cz - 1);
      if (east && north) this.markDirty(cx + 1, cz - 1);
      if (west && south) this.markDirty(cx - 1, cz + 1);
      if (east && south) this.markDirty(cx + 1, cz + 1);
    }
    return prev;
  }

  /** Flag a loaded chunk's mesh as stale. */
  markDirty(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    if (this.chunks.has(key)) this.dirty.add(key);
  }

  /**
   * Highest y (exclusive) of solid or liquid blocks in column (x, z), i.e.
   * the y a player standing on top would have; 0 when the column is empty or
   * unloaded.
   */
  surfaceY(x: number, z: number): number {
    const s = this.slot(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
    if (!s) return 0;
    const lx = x - s.cx * CHUNK;
    const lz = z - s.cz * CHUNK;
    const solid = this.reg.solid;
    const render = this.reg.render;
    for (let y = Math.min(HEIGHT - 1, s.top); y >= 0; y--) {
      const b = s.data.get(cellIndex(lx, y, lz));
      if (solid[b] === 1 || render[b] === 4) return y + 1;
    }
    return 0;
  }

  /** Total bytes of block storage held. */
  get byteLength(): number {
    let n = 0;
    for (const s of this.chunks.values()) n += s.data.byteLength;
    return n;
  }
}
