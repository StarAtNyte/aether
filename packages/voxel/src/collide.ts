/**
 * Swept AABB-vs-voxel collision for the player, mobs and dropped items —
 * no per-block colliders, no physics engine.
 *
 * A move is resolved one axis at a time (y, then x, then z). For each axis
 * every layer of cells between the box's leading face and its destination
 * is scanned in order, so the first blocking layer stops the box however
 * large the step (no tunnelling at any speed). Boxes keep a tiny clearance
 * ({@link SKIN}) from the faces they touch.
 *
 * Optional auto-step lifts a grounded box up a one-block ledge when that
 * lets it travel further (walking up terrain without jumping).
 */

/** What collision needs from the world. */
export interface SolidQuery {
  /** True when integer cell (x, y, z) blocks movement. */
  isSolid(x: number, y: number, z: number): boolean;
  /** True when the cell holds a liquid. */
  isLiquid(x: number, y: number, z: number): boolean;
}

/** A moving box: (x, z) is the centre of its footprint, y its bottom. */
export interface VoxelBody {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Half the footprint edge. */
  halfWidth: number;
  height: number;
  /** Resting on something solid (set by {@link moveBody}). */
  onGround: boolean;
  /** Hit something on each axis during the last move. */
  hitX: boolean;
  hitY: boolean;
  hitZ: boolean;
  /** Fraction (0, 0.5 or 1) of the body in liquid: feet and chest samples. */
  liquid: number;
  /** Eye level is inside a liquid. */
  submerged: boolean;
}

/** Clearance kept from touched faces (blocks). */
export const SKIN = 1e-4;
/** Largest ledge auto-step climbs. */
export const STEP_HEIGHT = 1;

/** A fresh body at rest. */
export function createBody(x: number, y: number, z: number, halfWidth: number, height: number): VoxelBody {
  return { x, y, z, vx: 0, vy: 0, vz: 0, halfWidth, height, onGround: false, hitX: false, hitY: false, hitZ: false, liquid: 0, submerged: false };
}

/** True when the box overlaps any solid cell. */
export function overlapsSolid(w: SolidQuery, x: number, y: number, z: number, hw: number, h: number): boolean {
  const x0 = Math.floor(x - hw + SKIN);
  const x1 = Math.floor(x + hw - SKIN);
  const y0 = Math.floor(y + SKIN);
  const y1 = Math.floor(y + h - SKIN);
  const z0 = Math.floor(z - hw + SKIN);
  const z1 = Math.floor(z + hw - SKIN);
  for (let cy = y0; cy <= y1; cy++) for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) if (w.isSolid(cx, cy, cz)) return true;
  return false;
}

/**
 * Largest movement (signed, |result| ≤ |d|) along `axis` (0 x, 1 y, 2 z)
 * before the box [min, max] hits a solid cell.
 */
export function sweepAxis(w: SolidQuery, axis: 0 | 1 | 2, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, d: number): number {
  if (d === 0 || !Number.isFinite(d)) return 0;
  // Cross-section cells on the two other axes.
  const ax0 = axis === 0 ? 0 : Math.floor(minX + SKIN);
  const ax1 = axis === 0 ? 0 : Math.floor(maxX - SKIN);
  const ay0 = axis === 1 ? 0 : Math.floor(minY + SKIN);
  const ay1 = axis === 1 ? 0 : Math.floor(maxY - SKIN);
  const az0 = axis === 2 ? 0 : Math.floor(minZ + SKIN);
  const az1 = axis === 2 ? 0 : Math.floor(maxZ - SKIN);
  const lo = axis === 0 ? minX : axis === 1 ? minY : minZ;
  const hi = axis === 0 ? maxX : axis === 1 ? maxY : maxZ;
  if (d > 0) {
    const target = hi + d;
    for (let c = Math.ceil(hi - SKIN); c < target; c++) {
      if (layerSolid(w, axis, c, ax0, ax1, ay0, ay1, az0, az1)) return Math.max(0, Math.min(d, c - hi - SKIN));
    }
    return d;
  }
  const target = lo + d;
  for (let c = Math.floor(lo + SKIN) - 1; c + 1 > target; c--) {
    if (layerSolid(w, axis, c, ax0, ax1, ay0, ay1, az0, az1)) return Math.min(0, Math.max(d, c + 1 - lo + SKIN));
  }
  return d;
}

function layerSolid(w: SolidQuery, axis: 0 | 1 | 2, c: number, ax0: number, ax1: number, ay0: number, ay1: number, az0: number, az1: number): boolean {
  if (axis === 0) {
    for (let y = ay0; y <= ay1; y++) for (let z = az0; z <= az1; z++) if (w.isSolid(c, y, z)) return true;
  } else if (axis === 1) {
    for (let z = az0; z <= az1; z++) for (let x = ax0; x <= ax1; x++) if (w.isSolid(x, c, z)) return true;
  } else {
    for (let y = ay0; y <= ay1; y++) for (let x = ax0; x <= ax1; x++) if (w.isSolid(x, y, c)) return true;
  }
  return false;
}

/** Move the box by (dx, dy, dz) with collision; updates position, hit flags and onGround (not velocity). */
function slide(w: SolidQuery, b: VoxelBody, dx: number, dy: number, dz: number): void {
  const hw = b.halfWidth;
  const my = sweepAxis(w, 1, b.x - hw, b.y, b.z - hw, b.x + hw, b.y + b.height, b.z + hw, dy);
  b.hitY = my !== dy;
  b.y += my;
  const mx = sweepAxis(w, 0, b.x - hw, b.y, b.z - hw, b.x + hw, b.y + b.height, b.z + hw, dx);
  b.hitX = mx !== dx;
  b.x += mx;
  const mz = sweepAxis(w, 2, b.x - hw, b.y, b.z - hw, b.x + hw, b.y + b.height, b.z + hw, dz);
  b.hitZ = mz !== dz;
  b.z += mz;
}

/**
 * Integrate the body's velocity over `dt` seconds with collision. Velocity
 * components that hit something are zeroed. With `autoStep`, a grounded
 * body blocked horizontally climbs a ledge of up to {@link STEP_HEIGHT}
 * when that lets it move further.
 */
export function moveBody(w: SolidQuery, b: VoxelBody, dt: number, autoStep = false): void {
  if (!(dt > 0)) return;
  const dx = b.vx * dt;
  const dy = b.vy * dt;
  const dz = b.vz * dt;
  const wasGround = b.onGround;
  const sx = b.x;
  const sy = b.y;
  const sz = b.z;
  slide(w, b, dx, dy, dz);
  if (autoStep && (b.hitX || b.hitZ) && (wasGround || b.liquid > 0) && dy <= 0.05) {
    const ex = b.x;
    const ey = b.y;
    const ez = b.z;
    const ehx = b.hitX;
    const ehy = b.hitY;
    const ehz = b.hitZ;
    // Try: up by a step, across, then back down onto the ledge.
    b.x = sx;
    b.y = sy;
    b.z = sz;
    const hw = b.halfWidth;
    const up = sweepAxis(w, 1, b.x - hw, b.y, b.z - hw, b.x + hw, b.y + b.height, b.z + hw, STEP_HEIGHT + SKIN * 2);
    b.y += up;
    slide(w, b, dx, 0, dz);
    const down = sweepAxis(w, 1, b.x - hw, b.y, b.z - hw, b.x + hw, b.y + b.height, b.z + hw, -(up + Math.max(0, -dy)));
    b.y += down;
    const gained = (b.x - sx) * (b.x - sx) + (b.z - sz) * (b.z - sz) - ((ex - sx) * (ex - sx) + (ez - sz) * (ez - sz));
    if (gained > 1e-6 && down !== -(up + Math.max(0, -dy))) {
      // Stepped onto something: keep it.
      b.hitY = true;
    } else {
      b.x = ex;
      b.y = ey;
      b.z = ez;
      b.hitX = ehx;
      b.hitY = ehy;
      b.hitZ = ehz;
    }
  }
  if (b.hitX) b.vx = 0;
  if (b.hitZ) b.vz = 0;
  b.onGround = b.hitY && dy <= 0;
  if (b.hitY) b.vy = 0;
  if (!b.onGround && dy === 0) {
    // At rest vertically: probe just below so standing still keeps `onGround`.
    const hw = b.halfWidth;
    b.onGround = sweepAxis(w, 1, b.x - hw, b.y, b.z - hw, b.x + hw, b.y + b.height, b.z + hw, -0.01) > -0.01;
  }
  sampleLiquid(w, b);
}

/** Update the body's liquid fraction and submerged flag. */
export function sampleLiquid(w: SolidQuery, b: VoxelBody): void {
  const fx = Math.floor(b.x);
  const fz = Math.floor(b.z);
  const feet = w.isLiquid(fx, Math.floor(b.y + 0.1), fz) ? 1 : 0;
  const chest = w.isLiquid(fx, Math.floor(b.y + b.height * 0.55), fz) ? 1 : 0;
  b.liquid = (feet + chest) / 2;
  b.submerged = w.isLiquid(fx, Math.floor(b.y + b.height * 0.9), fz);
}

/**
 * Push a body that ended up inside solid blocks (a block placed on it, a
 * bad spawn) up to the first free space, at most `maxRise` blocks. Returns
 * true when it had to move.
 */
export function resolvePenetration(w: SolidQuery, b: VoxelBody, maxRise = 64): boolean {
  if (!overlapsSolid(w, b.x, b.y, b.z, b.halfWidth, b.height)) return false;
  const base = Math.floor(b.y);
  for (let k = 1; k <= maxRise; k++) {
    if (!overlapsSolid(w, b.x, base + k, b.z, b.halfWidth, b.height)) {
      b.y = base + k + SKIN;
      b.vy = 0;
      return true;
    }
  }
  return false;
}
