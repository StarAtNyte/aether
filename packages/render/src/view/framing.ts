/**
 * Automatic camera framing. Pure math (no three.js):
 *
 * 1. {@link contentFraming} finds the sphere of *meaningful* content from
 *    per-entity world bounds: a weighted per-axis median center (robust to
 *    outliers such as distant backdrop props) and a weighted 85th-percentile
 *    radius. `focus` items pull the center and must be fully inside.
 * 2. {@link framingPose} places an elevated three-quarter camera that fits
 *    that sphere for the viewport's aspect ratio, never below the ground,
 *    and tilts the view up a little ({@link DEFAULT_SKY_TILT}) so a band of
 *    sky and horizon stays in frame above the content — a composed shot
 *    rather than a top-down map.
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
/** With focus items, the rest of the content only needs this share of its reach in view (tighter hero shots). */
const FOCUS_REACH = 0.55;

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
  const radius = Math.min(hi, Math.max(lo, Math.max(focus.length > 0 ? reach * FOCUS_REACH : reach, focusReach * 1.1)));
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
  /** Elevation above the horizon in degrees. Default grows from 24° (small scenes) to 28° (large), see {@link ELEVATION_RANGE}. */
  elevationDeg?: number;
  /** Ground height the camera must stay above (null = no ground). Default 0. */
  groundY?: number | null;
  /** Extra distance factor (> 1 zooms out). Default 1. */
  margin?: number;
  /**
   * Degrees the view is tilted up from looking straight at the content
   * center, so the horizon shows. Default {@link DEFAULT_SKY_TILT} with a
   * ground, half of it without one; 30 % less for scenes larger than 60 m
   * (their distant haze already fills the top of the frame).
   */
  tiltDeg?: number;
}

/** Default horizontal camera direction: a three-quarter view from the +Z (player spawn) side. */
export const DEFAULT_FRAMING_AZIMUTH = 28;
/**
 * Horizontal viewing direction (the `azimuthDeg` of {@link framingPose}: the camera stands at sin/cos of it around
 * the content) that looks at a building's garden side: `dx, dz` point from the house toward its terrace or entrance,
 * and the camera is swung `swingDeg` aside for a three-quarter view. Null for a zero or non-finite direction.
 */
export function frontAzimuthDeg(dx: number, dz: number, swingDeg = 28): number | null {
  if (!Number.isFinite(dx + dz) || Math.hypot(dx, dz) < 0.5) return null;
  const a = (Math.atan2(dx, dz) * 180) / Math.PI + swingDeg;
  return ((((a + 180) % 360) + 360) % 360) - 180;
}

/** True when the segment from `a` to `b` passes through the axis-aligned box (slab test). */
export function segmentHitsBox(a: Vec3, b: Vec3, min: Vec3, max: Vec3): boolean {
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 3; i++) {
    const d = (b[i] as number) - (a[i] as number);
    if (Math.abs(d) < 1e-9) {
      if ((a[i] as number) < (min[i] as number) || (a[i] as number) > (max[i] as number)) return false;
      continue;
    }
    let ta = ((min[i] as number) - (a[i] as number)) / d;
    let tb = ((max[i] as number) - (a[i] as number)) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * Of the candidate azimuths (degrees, in order of preference) the one whose camera sees `target` with the
 * fewest tall things in the way (a tree trunk or crown in the foreground makes a poor first picture). Ties go
 * to the earlier candidate. `eye` gives the camera position for an azimuth.
 */
export function pickClearAzimuth(candidates: readonly number[], eye: (azimuthDeg: number) => Vec3, target: Vec3, obstacles: readonly FramingItem[]): number {
  let best = candidates[0] ?? DEFAULT_FRAMING_AZIMUTH;
  let bestBlocked = Number.POSITIVE_INFINITY;
  for (const az of candidates) {
    const from = eye(az);
    let blocked = 0;
    for (const o of obstacles) if (finiteBox(o) && segmentHitsBox(from, target, o.min, o.max)) blocked++;
    if (blocked < bestBlocked) {
      bestBlocked = blocked;
      best = az;
    }
  }
  return best;
}

/** Minimum camera height above the ground (metres). */
export const MIN_CAMERA_CLEARANCE = 1.2;
/** Default upward view tilt in degrees (see {@link FramingPoseOptions.tiltDeg}). */
export const DEFAULT_SKY_TILT = 8;
/** Share of the tilt that may crop the foreground instead of pushing the camera back. */
const TILT_CROP = 0.4;
/**
 * Default camera elevation (degrees) for small → large content. Kept low
 * enough that even a 60 m village leaves a band of sky above the horizon.
 */
export const ELEVATION_RANGE: readonly [number, number] = Object.freeze([24, 28]) as readonly [number, number];
/** Share of the sky tilt dropped for scenes larger than 60 m (their haze already fills the top of the frame). */
const LARGE_SCENE_TILT_CUT = 0.3;
/** Lowest view pitch (degrees below the horizon) a tilt may leave. */
const MIN_PITCH = 6;

/**
 * Elevated three-quarter camera that fits `framing` in a viewport of
 * `aspect` (the narrower of the horizontal and vertical field of view
 * decides the distance, so portrait viewports do not crop the content).
 */
export function framingPose(framing: Framing, opts: FramingPoseOptions): FramingPose {
  const radius = Math.max(0.25, Number.isFinite(framing.radius) ? framing.radius : 1);
  const center: Vec3 = framing.center.every(Number.isFinite) ? [framing.center[0], framing.center[1], framing.center[2]] : [0, 0, 0];
  const vHalf = ((Number.isFinite(opts.fovDeg) && opts.fovDeg > 1 ? Math.min(170, opts.fovDeg) : 55) * Math.PI) / 360;
  const aspect = Number.isFinite(opts.aspect) && opts.aspect > 0 ? opts.aspect : 1;
  const hHalf = Math.atan(Math.tan(vHalf) * aspect);
  const groundY = opts.groundY === undefined ? 0 : opts.groundY;
  const hasGround = groundY !== null && Number.isFinite(groundY);
  // Large scenes see far, hazy ground near the top of the frame already: tilt less.
  const tiltDefault = (hasGround ? DEFAULT_SKY_TILT : DEFAULT_SKY_TILT / 2) * (1 - LARGE_SCENE_TILT_CUT * Math.min(1, Math.max(0, (radius - 20) / 40)));
  const tiltDeg = opts.tiltDeg !== undefined && Number.isFinite(opts.tiltDeg) ? Math.max(0, Math.min(25, opts.tiltDeg)) : tiltDefault;
  const elevationDeg = opts.elevationDeg ?? ELEVATION_RANGE[0] + (ELEVATION_RANGE[1] - ELEVATION_RANGE[0]) * Math.min(1, Math.max(0, (radius - 8) / 50));
  const elevation = (elevationDeg * Math.PI) / 180;
  const pitch = (Math.max(Math.min(MIN_PITCH, elevationDeg), elevationDeg - tiltDeg) * Math.PI) / 180;
  const tilt = elevation - pitch;
  // The tilt moves the content down the frame: fit it against the smaller vertical half-angle
  // (minus the share that may crop the foreground).
  const vFit = Math.max(0.05, vHalf - tilt * (1 - TILT_CROP));
  const half = Math.min(vFit, hHalf);
  const margin = opts.margin !== undefined && Number.isFinite(opts.margin) && opts.margin > 0 ? opts.margin : 1;
  const distance = Math.min(2000, (radius / Math.sin(half)) * margin);
  const azimuth = ((opts.azimuthDeg ?? DEFAULT_FRAMING_AZIMUTH) * Math.PI) / 180;
  const h = Math.cos(elevation) * distance;
  const position: Vec3 = [center[0] + Math.sin(azimuth) * h, center[1] + Math.sin(elevation) * distance, center[2] + Math.cos(azimuth) * h];
  if (hasGround) position[1] = Math.max(position[1], (groundY as number) + MIN_CAMERA_CLEARANCE);
  // Look at the point above the content center where the tilted view ray crosses its vertical axis,
  // so orbiting still pivots around the content.
  const target: Vec3 = [center[0], position[1] - h * Math.tan(pitch), center[2]];
  return { position, target, distance: Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2]) };
}
