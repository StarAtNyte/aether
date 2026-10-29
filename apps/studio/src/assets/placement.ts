/**
 * Where a dragged asset lands: on the surface under the cursor, snapped to
 * floors, walls and ceilings by the asset's natural placement, facing the
 * camera (or out of the wall it is pushed against). Pure, unit-tested.
 */
import type { Vec3 } from '@aether/core';

/** Placement-relevant facts of an asset. */
export interface PlaceableAsset {
  size: Readonly<Vec3>;
  placement: 'floor' | 'wall' | 'ceiling' | 'surface';
  facing: '+z' | '-z';
  /** Wall models whose pivot is the back-centre mount point: its height above the floor (ceiling models 0, pivot at the top). */
  mountY?: number;
}

/** Inputs: the surface hit under the cursor (if any), the cursor ray and the camera. */
export interface PlacementInput {
  hit: { point: Readonly<Vec3>; normal: Readonly<Vec3> } | null;
  ray: { origin: Readonly<Vec3>; direction: Readonly<Vec3> };
  camera: Readonly<Vec3>;
  asset: PlaceableAsset;
  /** Floor height under a point (walls and ceilings drop floor items onto it). Default 0. */
  floorAt?: (x: number, z: number) => number;
  /** Overrides the mount height of a wall model that has a mount pivot (metres above the floor). */
  mountHeight?: number;
}

/** Result: position (base of the asset), yaw in degrees and what it snapped to. */
export interface Placement {
  position: Vec3;
  yaw: number;
  snapped: 'surface' | 'wall' | 'ceiling' | 'ground';
}

/** Distance along the ray used when it never meets the ground (looking at the sky). */
const FALLBACK_DISTANCE = 10;
const MAX_GROUND_DISTANCE = 250;
const YAW_STEP = 15;
/** Gap kept between a wall and an object pushed against it (metres). */
const WALL_GAP = 0.02;

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Yaw (degrees, snapped to 15°) that points the asset's front along (dx, dz). */
export function yawToward(dx: number, dz: number, facing: '+z' | '-z'): number {
  if (dx * dx + dz * dz < 1e-10) return 0;
  const yaw = (Math.atan2(facing === '+z' ? dx : -dx, facing === '+z' ? dz : -dz) * 180) / Math.PI;
  const snapped = Math.round(yaw / YAW_STEP) * YAW_STEP;
  return snapped <= -180 ? snapped + 360 : snapped > 180 ? snapped - 360 : snapped === 0 ? 0 : snapped;
}

/** Where the cursor ray meets the ground plane y = 0 (or a point in front of the camera). */
export function groundPoint(ray: PlacementInput['ray']): Vec3 {
  const [ox, oy, oz] = ray.origin;
  const [dx, dy, dz] = ray.direction;
  let t = FALLBACK_DISTANCE;
  if (dy < -1e-4) t = Math.min(MAX_GROUND_DISTANCE, -oy / dy);
  return [ox + dx * t, 0, oz + dz * t];
}

/** Compute the drop placement. */
export function placeAsset(input: PlacementInput): Placement {
  const { asset, camera } = input;
  const floorAt = input.floorAt ?? (() => 0);
  const toCamera = (p: Readonly<Vec3>): number => yawToward(camera[0] - p[0], camera[2] - p[2], asset.facing);
  const out = (p: Vec3, yaw: number, snapped: Placement['snapped']): Placement => ({ position: [round2(p[0]), round2(p[1]), round2(p[2])], yaw, snapped });
  const hit = input.hit;
  if (!hit) {
    const g = groundPoint(input.ray);
    return out(g, toCamera(g), 'ground');
  }
  const [nx, ny, nz] = hit.normal;
  const [hx, hy, hz] = hit.point;
  if (ny > 0.6) return out([hx, hy, hz], toCamera(hit.point), 'surface');
  if (ny < -0.6) {
    if (asset.placement === 'ceiling' && asset.mountY !== undefined) return out([hx, hy, hz], toCamera(hit.point), 'ceiling');
    if (asset.placement === 'ceiling') return out([hx, hy - asset.size[1], hz], toCamera(hit.point), 'ceiling');
    return out([hx, floorAt(hx, hz), hz], toCamera(hit.point), 'surface');
  }
  // A wall: the asset's front looks out along the wall normal.
  const len = Math.hypot(nx, nz) || 1;
  const ux = nx / len;
  const uz = nz / len;
  const yaw = yawToward(ux, uz, asset.facing);
  if (asset.placement === 'wall' && asset.mountY !== undefined) {
    // The pivot is the back-centre mount point: the back sits on the wall and the pivot at the mount height above the floor.
    const floor = floorAt(hx, hz);
    const h = input.mountHeight !== undefined && Number.isFinite(input.mountHeight) ? Math.min(4, Math.max(0, input.mountHeight)) : asset.mountY;
    return out([hx + ux * WALL_GAP, floor + h, hz + uz * WALL_GAP], yaw, 'wall');
  }
  if (asset.placement === 'wall') {
    // Depth along the normal is the asset's local Z extent (front faces out).
    const half = asset.size[2] / 2 + WALL_GAP;
    const floor = floorAt(hx, hz);
    const y = Math.max(floor, hy - asset.size[1] / 2);
    return out([hx + ux * half, y, hz + uz * half], yaw, 'wall');
  }
  const half = asset.size[2] / 2 + WALL_GAP;
  const x = hx + ux * half;
  const z = hz + uz * half;
  return out([x, floorAt(x, z), z], yaw, 'wall');
}
