/**
 * Voxel terrain for Rapier bodies without one collider per block: solid
 * blocks are merged into a few boxes per 8 × 8 × 8 "brick", and bricks are
 * built only around dynamic bodies (and dropped when no body is near).
 *
 * The merge is a 3D greedy box cover (x runs, grown along z, then y), so a
 * flat slab of 512 stone blocks is one collider. Bricks remember the
 * version of the chunk they were built from and rebuild when it changes
 * (blocks broken or placed). Work is bounded: at most
 * {@link MAX_TERRAIN_BRICKS} live bricks and {@link MAX_BRICK_BOXES} boxes
 * each.
 */
import type { Collider, World } from '@dimforge/rapier3d-compat';
import { rapier } from './rapier';

/** What terrain colliders need from a block world. */
export interface VoxelSolidSource {
  /** True when integer cell (x, y, z) is solid. */
  isSolid(x: number, y: number, z: number): boolean;
  /** Version of chunk (cx, cz) of 16 × 16 columns (−1: not loaded; changes whenever its blocks change). */
  chunkVersion(cx: number, cz: number): number;
  /** World height in blocks. */
  readonly height: number;
}

/** Brick edge (blocks); divides the 16-block chunk. */
export const BRICK = 8;
/** Most bricks kept at once. */
export const MAX_TERRAIN_BRICKS = 256;
/** Most boxes per brick (a pathological checkerboard is clipped). */
export const MAX_BRICK_BOXES = 256;
/** Bricks around a body: its cell's brick ± this many on each axis. */
const REACH = 1;
/** Seconds a brick survives without a body nearby. */
const BRICK_TTL = 2;

/** An axis-aligned box in cell coordinates (inclusive min, exclusive max). */
export interface CellBox {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
}

/**
 * Greedy box cover of the solid cells of a brick at (bx, by, bz) (cell
 * coordinates of its minimum corner). Cells fully enclosed by solid
 * neighbours are still covered (they keep boxes large); the result never
 * covers a non-solid cell.
 */
export function brickBoxes(src: Pick<VoxelSolidSource, 'isSolid'>, bx: number, by: number, bz: number, size = BRICK, max = MAX_BRICK_BOXES): CellBox[] {
  const n = size;
  const solid = new Uint8Array(n * n * n);
  let any = false;
  for (let y = 0; y < n; y++) {
    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        if (src.isSolid(bx + x, by + y, bz + z)) {
          solid[x + z * n + y * n * n] = 1;
          any = true;
        }
      }
    }
  }
  const out: CellBox[] = [];
  if (!any) return out;
  const at = (x: number, y: number, z: number): number => x + z * n + y * n * n;
  for (let y = 0; y < n; y++) {
    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        if (solid[at(x, y, z)] !== 1) continue;
        // Grow along x.
        let x1 = x + 1;
        while (x1 < n && solid[at(x1, y, z)] === 1) x1++;
        // Grow along z while every cell of the row is solid.
        let z1 = z + 1;
        grow: while (z1 < n) {
          for (let k = x; k < x1; k++) if (solid[at(k, y, z1)] !== 1) break grow;
          z1++;
        }
        // Grow along y while every cell of the slab is solid.
        let y1 = y + 1;
        growY: while (y1 < n) {
          for (let c = z; c < z1; c++) for (let k = x; k < x1; k++) if (solid[at(k, y1, c)] !== 1) break growY;
          y1++;
        }
        for (let yy = y; yy < y1; yy++) for (let c = z; c < z1; c++) for (let k = x; k < x1; k++) solid[at(k, yy, c)] = 2;
        out.push({ x0: bx + x, y0: by + y, z0: bz + z, x1: bx + x1, y1: by + y1, z1: bz + z1 });
        if (out.length >= max) return out;
      }
    }
  }
  return out;
}

interface Brick {
  colliders: Collider[];
  version: number;
  seen: number;
}

function brickKey(bx: number, by: number, bz: number): number {
  return ((bx + 0x8000) * 0x10000 + (bz + 0x8000)) * 32 + by;
}

/** Terrain colliders around moving bodies (see the module docs). */
export class VoxelTerrainColliders {
  private readonly bricks = new Map<number, Brick>();
  private time = 0;

  constructor(
    private readonly world: World,
    private readonly source: VoxelSolidSource,
  ) {}

  /** Live bricks and colliders (stats, tests). */
  get counts(): { bricks: number; colliders: number } {
    let c = 0;
    for (const b of this.bricks.values()) c += b.colliders.length;
    return { bricks: this.bricks.size, colliders: c };
  }

  /**
   * Make sure bricks around each point exist and are current; age out the
   * others. `points` is a flat [x, y, z, …] list (dynamic body positions).
   */
  update(points: ArrayLike<number>, dt: number): void {
    this.time += dt;
    const h = this.source.height;
    for (let i = 0; i + 2 < points.length; i += 3) {
      const px = points[i] as number;
      const py = points[i + 1] as number;
      const pz = points[i + 2] as number;
      if (!Number.isFinite(px + py + pz)) continue;
      const cbx = Math.floor(px / BRICK);
      const cby = Math.floor(py / BRICK);
      const cbz = Math.floor(pz / BRICK);
      for (let by = cby - REACH; by <= cby + REACH; by++) {
        if (by < 0 || by * BRICK >= h) continue;
        for (let bz = cbz - REACH; bz <= cbz + REACH; bz++) for (let bx = cbx - REACH; bx <= cbx + REACH; bx++) this.ensure(bx, by, bz);
      }
    }
    for (const [key, b] of this.bricks) {
      if (this.time - b.seen > BRICK_TTL) {
        this.drop(b);
        this.bricks.delete(key);
      }
    }
  }

  private ensure(bx: number, by: number, bz: number): void {
    const key = brickKey(bx, by, bz);
    const version = this.source.chunkVersion(Math.floor((bx * BRICK) / 16), Math.floor((bz * BRICK) / 16));
    const b = this.bricks.get(key);
    if (b) {
      b.seen = this.time;
      if (b.version === version) return;
      this.drop(b);
      b.colliders = this.build(bx, by, bz, version);
      b.version = version;
      return;
    }
    if (this.bricks.size >= MAX_TERRAIN_BRICKS) return;
    this.bricks.set(key, { colliders: this.build(bx, by, bz, version), version, seen: this.time });
  }

  private build(bx: number, by: number, bz: number, version: number): Collider[] {
    // Unloaded chunks get no colliders (bodies there are frozen by the host).
    if (version < 0) return [];
    const R = rapier();
    const out: Collider[] = [];
    for (const box of brickBoxes(this.source, bx * BRICK, by * BRICK, bz * BRICK)) {
      const hx = (box.x1 - box.x0) / 2;
      const hy = (box.y1 - box.y0) / 2;
      const hz = (box.z1 - box.z0) / 2;
      const desc = R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(box.x0 + hx, box.y0 + hy, box.z0 + hz).setFriction(0.8);
      out.push(this.world.createCollider(desc));
    }
    return out;
  }

  private drop(b: Brick): void {
    for (const c of b.colliders) this.world.removeCollider(c, false);
    b.colliders = [];
  }

  /** Remove every terrain collider. */
  dispose(): void {
    for (const b of this.bricks.values()) this.drop(b);
    this.bricks.clear();
  }
}
