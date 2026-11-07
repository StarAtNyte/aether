/**
 * The terrain sheet (its plan rectangle and relief) and the light fallback for views hanging past its rim. Pure math (no three.js).
 */
import type { Vec3 } from '@aether/core';

/** The terrain sheet: its plan rectangle and the heights of its relief. */
export interface GroundSheet {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY: number;
  maxY: number;
  /** The terrain's colour (its generator's `color`), what the skirt takes at the rim. */
  color?: string;
}

/** How far past the rim (share of the sheet's size) a camera may hang before it is nudged in. */
const HANG = 0.12;

/**
 * The light fallback: a view whose camera hangs well past the terrain's rim is moved horizontally, target with it, back to
 * the margin (composition and pitch unchanged). The distant skirt (`environment/terrain-skirt.ts`) hides the rim itself.
 */
export function edgeNudge(pos: Vec3, target: Vec3, sheet: GroundSheet): { pos: Vec3; target: Vec3 } {
  if (!pos.every(Number.isFinite) || !target.every(Number.isFinite)) return { pos, target };
  const mx = (sheet.maxX - sheet.minX) * HANG;
  const mz = (sheet.maxZ - sheet.minZ) * HANG;
  const nx = Math.min(sheet.maxX + mx, Math.max(sheet.minX - mx, pos[0]));
  const nz = Math.min(sheet.maxZ + mz, Math.max(sheet.minZ - mz, pos[2]));
  if (nx === pos[0] && nz === pos[2]) return { pos, target };
  const dx = nx - pos[0];
  const dz = nz - pos[2];
  return { pos: [nx, pos[1], nz], target: [target[0] + dx, target[1], target[2] + dz] };
}
