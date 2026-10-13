/**
 * Automatic camera framing. Pure math (no three.js):
 *
 * 1. {@link contentFraming} finds the sphere of *meaningful* content from
 *    per-entity world bounds: a weighted per-axis median center (robust to
 *    outliers such as distant backdrop props) and a weighted 85th-percentile
 *    radius. `focus` items pull the center and must be fully inside.
 * 2. {@link framingPose} places an elevated three-quarter camera that fits
 *    that sphere for the viewport's aspect ratio, never below the ground.
 */
import type { Vec3 } from '@aether/core';

/** One entity's world-space bounds as seen by the framer. */
export interface FramingItem {
  min: Vec3;
  max: Vec3;
  /** Tagged `focus` (or explicitly requested): pulls the center and must stay in view. */
  focus?: boolean;
  /**
   * Relative importance (default: grows gently with size, 0.6–4, so one
   * huge prop cannot outvote many set-pieces). Decorative
   * layers (scatter patches, wide flat planes) pass a small weight.
   */
  weight?: number;
  /** Share of the item's own radius that counts toward the framing radius (default 0.6). */
  extent?: number;
}

/** A sphere to frame. */
export interface Framing {
  center: Vec3;
  radius: number;
}

/** Smallest / largest framing radius (metres). */
export const FRAMING_RADIUS_RANGE: readonly [number, number] = Object.freeze([3, 120]) as readonly [number, number];
/** Share of the (weighted) content the framing radius covers. */
export const FRAMING_COVERAGE = 0.8;
/** How far the center moves from the content median toward the focus items. */
const FOCUS_PULL = 0.7;

interface Sample {
  c: Vec3;
  r: number;
  w: number;
  extent: number;
  focus: boolean;
}

function finiteBox(it: FramingItem): boolean {
  for (let i = 0; i < 3; i++) {
    const lo = it.min[i] as number;
    const hi = it.max[i] as number;
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) return false;
  }
  return true;
}

function weightedMedian(values: Array<{ v: number; w: number }>, q = 0.5): number {
  values.sort((a, b) => a.v - b.v);
  let total = 0;
  for (const x of values) total += x.w;
  let acc = 0;
  for (const x of values) {
    acc += x.w;
    if (acc >= total * q) return x.v;
  }
  return values[values.length - 1]?.v ?? 0;
}

/**
 * Sphere of meaningful content, or null when there is nothing to frame.
 * Callers exclude ground, sky, backdrop and huge terrain before calling.
 */
export function contentFraming(items: readonly FramingItem[]): Framing | null {
  const samples: Sample[] = [];
  for (const it of items) {
    if (!finiteBox(it)) continue;
    const c: Vec3 = [(it.min[0] + it.max[0]) / 2, (it.min[1] + it.max[1]) / 2, (it.min[2] + it.max[2]) / 2];
    const r = Math.hypot(it.max[0] - it.min[0], it.max[1] - it.min[1], it.max[2] - it.min[2]) / 2;
    const w = it.weight !== undefined && Number.isFinite(it.weight) && it.weight > 0 ? it.weight : Math.min(4, Math.max(0.6, Math.sqrt(r) * 1.2));
    const extent = it.extent !== undefined && Number.isFinite(it.extent) ? Math.max(0, Math.min(1, it.extent)) : 0.6;
    samples.push({ c, r, w, extent, focus: it.focus === true });
  }
  if (samples.length === 0) return null;

  const center: Vec3 = [0, 1, 2].map((axis) => weightedMedian(samples.map((s) => ({ v: s.c[axis] as number, w: s.w })))) as Vec3;
  const focus = samples.filter((s) => s.focus);
  let focusReach = 0;
  if (focus.length > 0) {
    let fw = 0;
    const fc: Vec3 = [0, 0, 0];
    for (const s of focus) {
      fw += s.w;
      for (let i = 0; i < 3; i++) fc[i] = (fc[i] as number) + (s.c[i] as number) * s.w;
    }
    for (let i = 0; i < 3; i++) center[i] = (center[i] as number) + ((fc[i] as number) / fw - (center[i] as number)) * FOCUS_PULL;
    for (const s of focus) focusReach = Math.max(focusReach, dist(s.c, center) + s.r);
  }

  const reach = weightedMedian(
    samples.map((s) => ({ v: dist(s.c, center) + s.r * s.extent, w: s.w })),
    FRAMING_COVERAGE,
  );
  const [lo, hi] = FRAMING_RADIUS_RANGE;
  const radius = Math.min(hi, Math.max(lo, Math.max(focus.length > 0 ? reach * 0.8 : reach, focusReach * 1.1)));
  return { center, radius };
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Camera placement. */
export interface FramingPose {
  position: Vec3;
  target: Vec3;
  /** Camera-to-target distance. */
  distance: number;
}

/** Options of {@link framingPose}. */
export interface FramingPoseOptions {
  /** Vertical field of view in degrees. */
  fovDeg: number;
  /** Viewport width / height. */
  aspect: number;
  /** Horizontal viewing direction (degrees, 0 = camera on +Z looking toward −Z). Default 28. */
  azimuthDeg?: number;
  /** Elevation above the horizon in degrees. Default grows from 24° (small scenes) to 32° (large). */
  elevationDeg?: number;
  /** Ground height the camera must stay above (null = no ground). Default 0. */
  groundY?: number | null;
  /** Extra distance factor (> 1 zooms out). Default 1. */
  margin?: number;
}

/** Default horizontal camera direction: a three-quarter view from the +Z (player spawn) side. */
export const DEFAULT_FRAMING_AZIMUTH = 28;
/** Minimum camera height above the ground (metres). */
export const MIN_CAMERA_CLEARANCE = 1.2;

/**
 * Elevated three-quarter camera that fits `framing` in a viewport of
 * `aspect` (the narrower of the horizontal and vertical field of view
 * decides the distance, so portrait viewports do not crop the content).
 */
export function framingPose(framing: Framing, opts: FramingPoseOptions): FramingPose {
  const radius = Math.max(0.25, Number.isFinite(framing.radius) ? framing.radius : 1);
  const target: Vec3 = framing.center.every(Number.isFinite) ? [framing.center[0], framing.center[1], framing.center[2]] : [0, 0, 0];
  const vHalf = ((Number.isFinite(opts.fovDeg) && opts.fovDeg > 1 ? Math.min(170, opts.fovDeg) : 55) * Math.PI) / 360;
  const aspect = Number.isFinite(opts.aspect) && opts.aspect > 0 ? opts.aspect : 1;
  const hHalf = Math.atan(Math.tan(vHalf) * aspect);
  const half = Math.min(vHalf, hHalf);
  const margin = opts.margin !== undefined && Number.isFinite(opts.margin) && opts.margin > 0 ? opts.margin : 1;
  const distance = Math.min(2000, (radius / Math.sin(half)) * margin);
  const elevation = ((opts.elevationDeg ?? 24 + 8 * Math.min(1, Math.max(0, (radius - 8) / 50))) * Math.PI) / 180;
  const azimuth = ((opts.azimuthDeg ?? DEFAULT_FRAMING_AZIMUTH) * Math.PI) / 180;
  const h = Math.cos(elevation) * distance;
  const position: Vec3 = [target[0] + Math.sin(azimuth) * h, target[1] + Math.sin(elevation) * distance, target[2] + Math.cos(azimuth) * h];
  const groundY = opts.groundY === undefined ? 0 : opts.groundY;
  if (groundY !== null && Number.isFinite(groundY)) position[1] = Math.max(position[1], groundY + MIN_CAMERA_CLEARANCE);
  return { position, target, distance };
}
