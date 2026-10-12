/**
 * Pure fitting of the sun's orthographic shadow camera to the scene bounds,
 * so shadow texels are spent on the content and not on 400 m of empty ground.
 */
import type { Vec3 } from '@aether/core';
import type { Bounds } from '../types';

/** Shadow camera placement. */
export interface ShadowFit {
  /** Point the light aims at. */
  center: Vec3;
  /** Light position (center + direction × distance). */
  position: Vec3;
  /** Half size of the orthographic frustum (left = -half, right = half, …). */
  halfSize: number;
  near: number;
  far: number;
  /** Suggested shadow map resolution. */
  mapSize: number;
}

/** Options of {@link fitShadowCamera}. */
export interface ShadowFitOptions {
  /** Smallest half size (m). Default 12. */
  minHalf?: number;
  /** Largest half size (m). Default 160 (beyond that shadows get too blurry). */
  maxHalf?: number;
}

function finite(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}

/**
 * Fit a directional shadow camera around `bounds` (null/empty → a default
 * area around the origin) for a light coming FROM `direction` (unit vector
 * from the scene toward the light).
 */
export function fitShadowCamera(bounds: Bounds | null, direction: Vec3, opts: ShadowFitOptions = {}): ShadowFit {
  const minHalf = opts.minHalf ?? 12;
  const maxHalf = opts.maxHalf ?? 160;
  let center: Vec3 = [0, 0, 0];
  let radius = minHalf / 1.05;
  if (bounds && bounds.max[0] >= bounds.min[0] && bounds.max[1] >= bounds.min[1] && bounds.max[2] >= bounds.min[2]) {
    const cx = finite((bounds.min[0] + bounds.max[0]) / 2, 0);
    const cy = finite((bounds.min[1] + bounds.max[1]) / 2, 0);
    const cz = finite((bounds.min[2] + bounds.max[2]) / 2, 0);
    const dx = finite(bounds.max[0] - bounds.min[0], 0);
    const dy = finite(bounds.max[1] - bounds.min[1], 0);
    const dz = finite(bounds.max[2] - bounds.min[2], 0);
    radius = Math.hypot(dx, dy, dz) / 2;
    // Content larger than the cap: keep shadows sharp around the center.
    center = [Math.max(-1e4, Math.min(1e4, cx)), Math.max(-1e4, Math.min(1e4, cy)), Math.max(-1e4, Math.min(1e4, cz))];
  }
  const halfSize = Math.max(minHalf, Math.min(maxHalf, radius * 1.05));
  const len = Math.hypot(direction[0], direction[1], direction[2]) || 1;
  const dist = halfSize * 2 + 20;
  const position: Vec3 = [
    center[0] + (direction[0] / len) * dist,
    center[1] + (direction[1] / len) * dist,
    center[2] + (direction[2] / len) * dist,
  ];
  return { center, position, halfSize, near: 0.5, far: dist + halfSize * 2 + 20, mapSize: halfSize > 60 ? 4096 : 2048 };
}
