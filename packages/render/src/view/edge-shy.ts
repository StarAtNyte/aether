/**
 * Keeps an aerial view from showing where the ground ends. A terrain is a finite sheet: from above its hills, a high camera
 * (a title card's backdrop, a tour's reveals, the framed overview) sees past the rim into the void, or the fog bank and
 * the gaps between a few backdrop ranges. {@link edgeShy} tilts such a view down until every ray of the frame lands on the
 * sheet, and walks the camera in over it when it hangs outside the rim. Eye-level views are left alone: the relief hides the
 * rim there. Pure math (no three.js).
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
}

/** Rim margin: the frame must land this share of the sheet's size inside its edge. */
export const EDGE_MARGIN = 0.06;
/** Steepest pitch (radians below the horizon) the view may take. */
const MAX_PITCH = (72 * Math.PI) / 180;
const STEP = (2 * Math.PI) / 180;
/** Frame sample columns and rows (NDC). */
const GRID = [-1, -0.5, 0, 0.5, 1];

/** Whether the camera is above the relief: nothing of the terrain can hide the rim from it. */
export function aboveRelief(pos: Vec3, sheet: GroundSheet): boolean {
  return pos[1] > sheet.maxY + 0.5;
}

/** Every ray of the frame lands inside the sheet (and none looks at or above the horizon). */
function frameOnSheet(pos: Vec3, yaw: number, pitch: number, tanV: number, tanH: number, sheet: GroundSheet): boolean {
  const planeY = sheet.minY + (sheet.maxY - sheet.minY) * 0.5;
  const h = pos[1] - planeY;
  if (h <= 0) return false;
  const mx = (sheet.maxX - sheet.minX) * EDGE_MARGIN;
  const mz = (sheet.maxZ - sheet.minZ) * EDGE_MARGIN;
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);
  for (const ny of GRID) {
    for (const nx of GRID) {
      // Camera space: x right, y up, z forward; pitched down, then yawed (yaw 0 looks along +z).
      const rx = nx * tanH;
      const ry = ny * tanV;
      const fwd = cp - ry * sp;
      const dy = -sp - ry * cp;
      if (dy > -0.03) return false;
      const wx = fwd * sy - rx * cy;
      const wz = fwd * cy + rx * sy;
      const t = h / -dy;
      const x = pos[0] + wx * t;
      const z = pos[2] + wz * t;
      if (x < sheet.minX + mx || x > sheet.maxX - mx || z < sheet.minZ + mz || z > sheet.maxZ - mz) return false;
    }
  }
  return true;
}

/**
 * The view (camera `pos` looking at `target`) kept off the rim of `sheet`: tilted down, then walked inward, until the whole
 * frame lies on the sheet. A view that is not above the relief, or that no tilt and walk can save, comes back unchanged.
 */
export function edgeShy(pos: Vec3, target: Vec3, sheet: GroundSheet, fovDeg: number, aspect: number): { pos: Vec3; target: Vec3 } {
  const same = { pos, target };
  if (!pos.every(Number.isFinite) || !target.every(Number.isFinite) || !aboveRelief(pos, sheet)) return same;
  const dx = target[0] - pos[0];
  const dy = target[1] - pos[1];
  const dz = target[2] - pos[2];
  const horiz = Math.hypot(dx, dz);
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-6 || horiz < 1e-6) return same;
  const yaw = Math.atan2(dx, dz);
  const pitch0 = Math.atan2(-dy, horiz);
  const tanV = Math.tan((fovDeg * Math.PI) / 360);
  const tanH = tanV * (aspect > 0 ? aspect : 1);
  const cx = (sheet.minX + sheet.maxX) / 2;
  const cz = (sheet.minZ + sheet.maxZ) / 2;
  // The least change that works: tilt, walk toward the sheet's middle (a share of the way each time) and come down toward
  // the relief; a shallow view from a lower, nearer spot beats a map seen straight down.
  let best: { cost: number; pos: Vec3; pitch: number } | null = null;
  const floor = sheet.maxY + 4;
  for (let walk = 0; walk <= 6; walk++) {
    for (const drop of [1, 0.8, 0.65, 0.5]) {
      const y = Math.max(Math.min(pos[1], floor), pos[1] * drop);
      const k = walk * 0.12;
      const p: Vec3 = [pos[0] + (cx - pos[0]) * k, y, pos[2] + (cz - pos[2]) * k];
      for (let pitch = pitch0; pitch <= MAX_PITCH; pitch += STEP) {
        if (!frameOnSheet(p, yaw, pitch, tanV, tanH, sheet)) continue;
        const cost = (pitch - pitch0) + walk * 0.1 + (1 - drop) * 0.4;
        if (!best || cost < best.cost) best = { cost, pos: p, pitch };
        break;
      }
    }
  }
  if (!best) return same;
  const p = best.pos;
  const ch = Math.cos(best.pitch) * dist;
  return { pos: p, target: [p[0] + Math.sin(yaw) * ch, p[1] - Math.sin(best.pitch) * dist, p[2] + Math.cos(yaw) * ch] };
}
