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
 * Scratch of the hot sweep: BOX = [minX, minY, minZ, maxX, maxY, maxZ, d],
 * SWEEP[0] = result. Doubles passed as call arguments (or returned) are
 * boxed on every call in V8; typed-array slots are not.
 */
const BOX = new Float64Array(7);
const SWEEP = new Float64Array(1);

/**
 * Largest movement (signed, |result| ≤ |d|) along `axis` (0 x, 1 y, 2 z)
 * before the box [min, max] hits a solid cell.
 */
export function sweepAxis(w: SolidQuery, axis: 0 | 1 | 2, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, d: number): number {
  BOX[0] = minX;
  BOX[1] = minY;
  BOX[2] = minZ;
  BOX[3] = maxX;
  BOX[4] = maxY;
  BOX[5] = maxZ;
  BOX[6] = d;
  sweepBox(w, axis);
  return SWEEP[0] as number;
}

/** Load the body's box and a delta into BOX. */
function loadBody(b: VoxelBody): void {
  const hw = b.halfWidth;
  BOX[0] = b.x - hw;
  BOX[1] = b.y;
  BOX[2] = b.z - hw;
  BOX[3] = b.x + hw;
  BOX[4] = b.y + b.height;
  BOX[5] = b.z + hw;
}

/** Sweep the box in BOX along `axis` by BOX[6]; result in SWEEP[0]. Allocation-free. */
function sweepBox(w: SolidQuery, axis: number): void {
  const d = BOX[6] as number;
  if (d === 0 || !Number.isFinite(d)) {
    SWEEP[0] = 0;
    return;
  }
  // Cross-section cells on the two other axes (int32: loop counters stay small integers).
  const x0 = Math.floor((BOX[0] as number) + SKIN) | 0;
  const x1 = Math.floor((BOX[3] as number) - SKIN) | 0;
  const y0 = Math.floor((BOX[1] as number) + SKIN) | 0;
  const y1 = Math.floor((BOX[4] as number) - SKIN) | 0;
  const z0 = Math.floor((BOX[2] as number) + SKIN) | 0;
  const z1 = Math.floor((BOX[5] as number) - SKIN) | 0;
  const lo = BOX[axis] as number;
  const hi = BOX[axis + 3] as number;
  if (d > 0) {
    const target = hi + d;
    for (let c = Math.ceil(hi - SKIN) | 0; c < target; c++) {
      if (layerSolid(w, axis, c, x0, x1, y0, y1, z0, z1)) {
        SWEEP[0] = Math.max(0, Math.min(d, c - hi - SKIN));
        return;
      }
    }
    SWEEP[0] = d;
    return;
  }
  const target = lo + d;
  for (let c = (Math.floor(lo + SKIN) | 0) - 1; c + 1 > target; c--) {
    if (layerSolid(w, axis, c, x0, x1, y0, y1, z0, z1)) {
      SWEEP[0] = Math.min(0, Math.max(d, c + 1 - lo + SKIN));
      return;
    }
  }
  SWEEP[0] = d;
}

function layerSolid(w: SolidQuery, axis: number, c: number, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): boolean {
  if (axis === 0) {
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) if (w.isSolid(c, y, z)) return true;
  } else if (axis === 1) {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (w.isSolid(x, c, z)) return true;
  } else {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (w.isSolid(x, y, c)) return true;
  }
  return false;
}

/** Sweep the body along `axis` by `BOX[6]` (set by the caller); result in SWEEP[0] (no boxed return). */
function sweepBodyAxis(w: SolidQuery, b: VoxelBody, axis: number): void {
  loadBody(b);
  sweepBox(w, axis);
}

/** Scratch delta of {@link slide}: MOVE = [dx, dy, dz] (doubles passed as arguments would be boxed). */
const MOVE = new Float64Array(3);

/** Move the box by MOVE = (dx, dy, dz) with collision; updates position and hit flags (not velocity). */
function slide(w: SolidQuery, b: VoxelBody): void {
  const dy = MOVE[1] as number;
  BOX[6] = dy;
  sweepBodyAxis(w, b, 1);
  b.hitY = SWEEP[0] !== dy;
  b.y += SWEEP[0] as number;
  const dx = MOVE[0] as number;
  BOX[6] = dx;
  sweepBodyAxis(w, b, 0);
  b.hitX = SWEEP[0] !== dx;
  b.x += SWEEP[0] as number;
  const dz = MOVE[2] as number;
  BOX[6] = dz;
  sweepBodyAxis(w, b, 2);
  b.hitZ = SWEEP[0] !== dz;
  b.z += SWEEP[0] as number;
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
  MOVE[0] = dx;
  MOVE[1] = dy;
  MOVE[2] = dz;
  slide(w, b);
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
    BOX[6] = STEP_HEIGHT + SKIN * 2;
    sweepBodyAxis(w, b, 1);
    const up = SWEEP[0] as number;
    b.y += up;
    MOVE[0] = dx;
    MOVE[1] = 0;
    MOVE[2] = dz;
    slide(w, b);
    BOX[6] = -(up + Math.max(0, -dy));
    sweepBodyAxis(w, b, 1);
    const down = SWEEP[0] as number;
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
    BOX[6] = -0.01;
    sweepBodyAxis(w, b, 1);
    b.onGround = (SWEEP[0] as number) > -0.01;
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
