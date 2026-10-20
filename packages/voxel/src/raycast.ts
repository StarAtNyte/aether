/**
 * Voxel ray casting by grid traversal (Amanatides & Woo DDA): the ray
 * visits every cell it passes through, in order, so a hit is exact and the
 * cost is proportional to the distance travelled (≤ 3 × range cells), with
 * no allocation.
 */

/** Result of {@link raycastVoxels} (reused by the caller). */
export interface VoxelHit {
  /** Hit cell. */
  x: number;
  y: number;
  z: number;
  /** Outward normal of the face that was entered (the cell to place into is hit + normal). */
  nx: number;
  ny: number;
  nz: number;
  /** Distance along the (normalised) ray to the entry point. */
  distance: number;
  /** Block id of the hit cell. */
  block: number;
}

/** A fresh, reusable hit record. */
export function createHit(): VoxelHit {
  return { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, distance: 0, block: 0 };
}

/**
 * Cast a ray from `origin` along `dir` (need not be normalised) for at most
 * `maxDistance`. `get(x, y, z)` returns the block of a cell and `hits(id)`
 * decides whether that block stops the ray. The starting cell itself counts
 * (with a zero normal) when it is a target. Returns true and fills `out` on
 * a hit.
 */
export function raycastVoxels(
  get: (x: number, y: number, z: number) => number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDistance: number,
  hits: (id: number) => boolean,
  out: VoxelHit,
): boolean {
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(len > 1e-12) || !Number.isFinite(ox + oy + oz) || !(maxDistance > 0)) return false;
  dx /= len;
  dy /= len;
  dz /= len;
  let x = Math.floor(ox);
  let y = Math.floor(oy);
  let z = Math.floor(oz);
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dz) : Infinity;
  let tMaxX = stepX > 0 ? (x + 1 - ox) * tDeltaX : stepX < 0 ? (ox - x) * tDeltaX : Infinity;
  let tMaxY = stepY > 0 ? (y + 1 - oy) * tDeltaY : stepY < 0 ? (oy - y) * tDeltaY : Infinity;
  let tMaxZ = stepZ > 0 ? (z + 1 - oz) * tDeltaZ : stepZ < 0 ? (oz - z) * tDeltaZ : Infinity;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let t = 0;
  // Bound the walk: never more cells than the range can cross.
  const maxSteps = Math.ceil(maxDistance) * 3 + 3;
  for (let i = 0; i <= maxSteps; i++) {
    const id = get(x, y, z);
    if (hits(id)) {
      out.x = x;
      out.y = y;
      out.z = z;
      out.nx = nx;
      out.ny = ny;
      out.nz = nz;
      out.distance = t;
      out.block = id;
      return true;
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      t = tMaxX;
      if (t > maxDistance) return false;
      x += stepX;
      tMaxX += tDeltaX;
      nx = -stepX;
      ny = 0;
      nz = 0;
    } else if (tMaxY < tMaxZ) {
      t = tMaxY;
      if (t > maxDistance) return false;
      y += stepY;
      tMaxY += tDeltaY;
      nx = 0;
      ny = -stepY;
      nz = 0;
    } else {
      t = tMaxZ;
      if (t > maxDistance) return false;
      z += stepZ;
      tMaxZ += tDeltaZ;
      nx = 0;
      ny = 0;
      nz = -stepZ;
    }
  }
  return false;
}

/**
 * The way to face at a spawn: the heading closest to `preferred` (radians, forward is `(-sin yaw, -cos yaw)`) whose view is
 * open. Each of `steps` evenly spaced headings is sampled at knee, chest and eye height up to `range` blocks; its open
 * distance is the shortest of the three. The preferred heading is kept when it is open for at least `enough` blocks;
 * otherwise the best heading wins (openness is the harmonic mean of nine rays spread over about 70 degrees (a thin post a metre away still lands between two of them)), a small penalty for turning away breaking near-ties. Pure and allocation-light.
 */
export function openestYaw(
  get: (x: number, y: number, z: number) => number,
  hits: (id: number) => boolean,
  x: number,
  y: number,
  z: number,
  preferred: number,
  options: { steps?: number; range?: number; enough?: number; eye?: number } = {},
): number {
  const steps = Math.max(4, Math.min(72, options.steps ?? 24));
  const range = options.range ?? 24;
  const enough = options.enough ?? 10;
  const eye = options.eye ?? 1.6;
  const out = createHit();
  const ray = (yaw: number): number => {
    const dx = -Math.sin(yaw);
    const dz = -Math.cos(yaw);
    let d = range;
    for (const h of [0.5, 1.0, eye]) if (raycastVoxels(get, x, y + h, z, dx, 0, dz, range, hits, out)) d = Math.min(d, out.distance);
    return d;
  };
  // A heading is as open as the harmonic mean of a fan of nine rays around it (the centre counts double): a near wall on
  // either side drags it down, so a lane that is clear dead ahead but brushes a wall a block away reads as a corridor.
  const open = (yaw: number): number => {
    let inv = 0;
    let weight = 0;
    for (let k = -4; k <= 4; k++) {
      const w = k === 0 ? 2 : 1;
      inv += w / Math.max(0.5, ray(yaw + k * 0.15));
      weight += w;
    }
    return weight / inv;
  };
  if (open(preferred) >= enough) return preferred;
  let best = preferred;
  let bestScore = -Infinity;
  for (let i = 0; i < steps; i++) {
    const yaw = preferred + (i / steps) * Math.PI * 2;
    const turn = Math.abs(((i / steps + 0.5) % 1) - 0.5) * 2; // 0 at the preferred heading, 1 straight behind
    const score = open(yaw) - turn * 2;
    if (score > bestScore) {
      bestScore = score;
      best = yaw;
    }
  }
  return best;
}
