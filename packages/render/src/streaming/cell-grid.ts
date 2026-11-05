/**
 * World Partition grid (docs/ARCHITECTURE-STREAMING.md, section 3.1): square cells on the XZ plane, keyed
 * `(level, ix, iz)`. Level 0 is the base cell; levels 1 and 2 are 2x2 and 4x4 groups of base cells. An entity goes to the
 * cell holding the centre of its bounds, at the lowest level whose cell is at least half its larger side; anything bigger
 * than a level-2 cell goes to the persistent layer (always resident: whole-world terrain, the backdrop).
 *
 * Stage 4a uses the grid for per-cell static batches; stage 4b streams the same cells in and out. The partition is fixed
 * per world (the cell size comes from the world's extent once), so keys stay stable across edits; the index is updated
 * per entity, so an edit re-buckets only what it touched.
 */

/** Cell size and origin of one world's grid (metres). */
export interface CellPartition {
  readonly cellSize: number;
  /** World XZ of the corner of cell (0, 0) at every level. */
  readonly origin: readonly [number, number];
}

/** Highest grid level (4x4 base cells); larger entities are persistent. */
export const MAX_CELL_LEVEL = 2;
/** Key of the persistent layer. */
export const PERSISTENT_CELL = 'p';

/**
 * Base cell edge for a world whose larger side is `extent` metres: 16 m for a room or house (< 64 m), 32 m for a village
 * or block (< 256 m), 64 m for a town (< 1.5 km), 128 m for a landscape.
 */
export function cellSizeFor(extent: number): number {
  if (!(extent >= 64)) return 16;
  if (extent < 256) return 32;
  if (extent < 1500) return 64;
  return 128;
}

/** The partition of a world whose content spans `min`..`max` on X and Z. Origin snapped to the cell size. */
export function partitionFor(min: readonly [number, number], max: readonly [number, number]): CellPartition {
  const extent = Math.max(max[0] - min[0], max[1] - min[1], 0);
  const cellSize = cellSizeFor(extent);
  const big = cellSize << MAX_CELL_LEVEL;
  // Snapped to the coarsest level, so every level's cells nest exactly.
  return { cellSize, origin: [Math.floor(min[0] / big) * big, Math.floor(min[1] / big) * big] };
}

/** Edge of a cell at `level`. */
export function cellEdge(p: CellPartition, level: number): number {
  return p.cellSize * (1 << level);
}

/** The key of cell `(level, ix, iz)`. */
export function cellKey(level: number, ix: number, iz: number): string {
  return `${level}:${ix},${iz}`;
}

/** Parse a key made by {@link cellKey} (null for the persistent layer or a foreign key). */
export function parseCellKey(key: string): { level: number; ix: number; iz: number } | null {
  const m = /^(\d+):(-?\d+),(-?\d+)$/.exec(key);
  return m ? { level: Number(m[1]), ix: Number(m[2]), iz: Number(m[3]) } : null;
}

/** Cell indices of world point (x, z) at `level`. */
export function cellAt(p: CellPartition, x: number, z: number, level = 0): { ix: number; iz: number } {
  const e = cellEdge(p, level);
  return { ix: Math.floor((x - p.origin[0]) / e), iz: Math.floor((z - p.origin[1]) / e) };
}

/** The level an entity whose bounds' larger XZ side is `size` belongs to (MAX_CELL_LEVEL + 1: persistent). */
export function levelFor(p: CellPartition, size: number): number {
  for (let level = 0; level <= MAX_CELL_LEVEL; level++) if (cellEdge(p, level) >= size / 2) return level;
  return MAX_CELL_LEVEL + 1;
}

/** Cell key of an entity whose bounds are centred on (cx, cz) with larger XZ side `size`. */
export function assignCell(p: CellPartition, cx: number, cz: number, size: number): string {
  if (!Number.isFinite(cx) || !Number.isFinite(cz)) return PERSISTENT_CELL;
  const level = levelFor(p, Number.isFinite(size) ? Math.max(0, size) : Number.POSITIVE_INFINITY);
  if (level > MAX_CELL_LEVEL) return PERSISTENT_CELL;
  const { ix, iz } = cellAt(p, cx, cz, level);
  return cellKey(level, ix, iz);
}

/** The cell at `level` (>= the key's own) containing cell `key` (the key itself for the persistent layer). */
export function ancestorCell(key: string, level: number): string {
  const c = parseCellKey(key);
  if (!c || level <= c.level) return key;
  const shift = level - c.level;
  return cellKey(level, c.ix >> shift, c.iz >> shift);
}

/** World XZ bounds of a cell: [minX, minZ, maxX, maxZ] (infinite for the persistent layer). */
export function cellBounds(p: CellPartition, key: string): [number, number, number, number] {
  const c = parseCellKey(key);
  if (!c) return [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const e = cellEdge(p, c.level);
  const x = p.origin[0] + c.ix * e, z = p.origin[1] + c.iz * e;
  return [x, z, x + e, z + e];
}

/**
 * Entity to cell index. Incremental: {@link assign} moves one entity (and reports the cells it left and joined), so a patch
 * re-buckets only the entities it touched.
 */
export class CellIndex {
  private readonly cellOf = new Map<string, string>();
  private readonly members = new Map<string, Set<string>>();

  constructor(readonly partition: CellPartition) {}

  /** Put entity `id` (bounds centred on cx, cz; larger XZ side `size`) in its cell. Returns the cells changed (0–2). */
  assign(id: string, cx: number, cz: number, size: number): string[] {
    const next = assignCell(this.partition, cx, cz, size);
    const prev = this.cellOf.get(id);
    if (prev === next) return [];
    if (prev !== undefined) this.members.get(prev)?.delete(id);
    this.cellOf.set(id, next);
    let set = this.members.get(next);
    if (!set) this.members.set(next, (set = new Set()));
    set.add(id);
    return prev === undefined ? [next] : [prev, next];
  }

  /** Drop entity `id`; returns the cell it left (or null). */
  remove(id: string): string | null {
    const prev = this.cellOf.get(id);
    if (prev === undefined) return null;
    this.cellOf.delete(id);
    const set = this.members.get(prev);
    set?.delete(id);
    if (set && set.size === 0) this.members.delete(prev);
    return prev;
  }

  /** Cell of entity `id` (undefined when not indexed). */
  cell(id: string): string | undefined {
    return this.cellOf.get(id);
  }

  /** Entities in cell `key`. */
  entities(key: string): ReadonlySet<string> {
    return this.members.get(key) ?? new Set();
  }

  /** Every non-empty cell key. */
  cells(): IterableIterator<string> {
    return this.members.keys();
  }

  get size(): number {
    return this.cellOf.size;
  }
}
