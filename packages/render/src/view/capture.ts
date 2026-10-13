/**
 * Pure helpers for image capture: orthographic view poses that frame the
 * scene for VLM critique (top/front/side/iso) and output size/format
 * sanitizing.
 */
import type { Vec3 } from '@aether/core';
import type { Bounds } from '../types';

/** Named critique view. */
export type CaptureView = 'top' | 'front' | 'side' | 'iso';

/** Camera pose for one orthographic view. */
export interface ViewPose {
  position: Vec3;
  target: Vec3;
  up: Vec3;
  /** Half extent of the orthographic frustum (square). */
  halfSize: number;
  near: number;
  far: number;
}

/** Max capture dimension in pixels. */
export const MAX_CAPTURE_SIZE = 4096;
/** Max views per `renderViews` call. */
export const MAX_VIEWS = 8;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Clamp a capture dimension to [16, MAX_CAPTURE_SIZE] (fallback when invalid). */
export function captureSize(v: number | undefined, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : Math.round(fallback);
  return Math.max(16, Math.min(MAX_CAPTURE_SIZE, n));
}

/** Allowlisted image mime type (default JPEG). */
export function captureMime(mime: string | undefined): string {
  return mime && ALLOWED_MIME.has(mime) ? mime : 'image/jpeg';
}

/** Orthographic pose framing `bounds` (null/empty → a 10 m area at the origin). */
export function viewPose(bounds: Bounds | null, view: CaptureView): ViewPose {
  let c: Vec3 = [0, 0, 0];
  let r = 5;
  if (bounds && bounds.max[0] >= bounds.min[0]) {
    c = [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2, (bounds.min[2] + bounds.max[2]) / 2];
    r = Math.max(1, Math.hypot(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]) / 2);
  }
  const dist = r * 3;
  let dir: Vec3;
  let up: Vec3 = [0, 1, 0];
  switch (view) {
    case 'top':
      dir = [0, 1, 0];
      up = [0, 0, -1];
      break;
    case 'front':
      dir = [0, 0, 1];
      break;
    case 'side':
      dir = [1, 0, 0];
      break;
    default: {
      const l = Math.hypot(1, 0.8, 1);
      dir = [1 / l, 0.8 / l, 1 / l];
    }
  }
  return {
    position: [c[0] + dir[0] * dist, c[1] + dir[1] * dist, c[2] + dir[2] * dist],
    target: c,
    up,
    halfSize: r * 1.08,
    near: 0.05,
    far: dist + r * 2 + 1,
  };
}

/**
 * Where to render a `px`-pixel critique view inside a `bw`×`bh` drawing
 * buffer without resizing it: a square at the top-left corner (three.js
 * viewports use a top-left origin on both backends). Null when the buffer is
 * too small (callers then resize temporarily).
 */
export function viewRegion(bw: number, bh: number, px: number): { x: number; y: number; size: number } | null {
  if (!(px >= 16) || !(bw >= px) || !(bh >= px)) return null;
  return { x: 0, y: 0, size: Math.floor(px) };
}

/** Field of view (degrees) of critique captures: narrow enough to read as orthographic. */
export const CAPTURE_FOV_DEG = 12;

/** A perspective camera pose equivalent to an orthographic {@link ViewPose}. */
export interface TelephotoPose {
  position: Vec3;
  target: Vec3;
  up: Vec3;
  fov: number;
  near: number;
  far: number;
}

/**
 * Convert an orthographic view into a narrow-field perspective view that
 * frames the same square (`halfSize` at the target), looking from the same
 * direction. Captures then reuse the main perspective camera: a second
 * camera would make the renderer build a second set of per-object GPU state
 * (render objects, uniform buffers) for every world, which some browsers
 * reclaim only lazily.
 */
export function telephotoPose(pose: ViewPose, fovDeg: number = CAPTURE_FOV_DEG): TelephotoPose {
  const fov = Math.max(1, Math.min(60, Number.isFinite(fovDeg) ? fovDeg : CAPTURE_FOV_DEG));
  const dx = pose.position[0] - pose.target[0];
  const dy = pose.position[1] - pose.target[1];
  const dz = pose.position[2] - pose.target[2];
  const len = Math.hypot(dx, dy, dz) || 1;
  const half = Math.max(0.01, pose.halfSize);
  const dist = half / Math.tan((fov * Math.PI) / 360);
  // The scene spans about ±half around the target along the view axis (halfSize ≈ 1.08 × radius).
  const depth = half * 1.5 + 1;
  return {
    position: [pose.target[0] + (dx / len) * dist, pose.target[1] + (dy / len) * dist, pose.target[2] + (dz / len) * dist],
    target: [pose.target[0], pose.target[1], pose.target[2]],
    up: [pose.up[0], pose.up[1], pose.up[2]],
    fov,
    near: Math.max(0.05, dist - depth),
    far: dist + depth,
  };
}
