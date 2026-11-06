/**
 * The view a world opens on in the editor: a camera inside the world at eye height or a little above, not the far
 * aerial overview (the weakest picture and the heaviest to load: everything is in view at once).
 *
 * Pure (no three.js): the renderer supplies a {@link OpeningProbe} over its scene. {@link chooseOpeningView} picks
 * the landmark (focus-tagged content and buildings first, else the tallest set-piece near the middle), then walks
 * rings round it and keeps the best spot that is
 * - on open, walkable ground (not a roof, not in the water, not on a steep slope),
 * - clear of obstacles for a few metres round the eye and above it (not inside a building or under a tree crown),
 * - close to the content's middle,
 * and from which the landmark is in sight and the view is full of content with an open foreground. The camera faces
 * the landmark with the horizon in the upper third of the frame. Deterministic: the same world gives the same view.
 */
import type { Vec3 } from '@aether/core';
import type { Framing, FramingItem, SightTest } from './framing';

/** What lies at the top of the scene at a point in plan. */
export interface OpeningSurface {
  /** Height of the topmost surface. */
  y: number;
  /** `ground`: open, walkable (terrain, a street, a plaza); `water`: a water surface or ground under water; `blocked`: a roof, a wall top, a rock, a tree. */
  kind: 'ground' | 'water' | 'blocked';
}

/** The renderer's view of its scene for {@link chooseOpeningView}. */
export interface OpeningProbe {
  /** The topmost surface at (x, z), or null where there is nothing. */
  surface(x: number, z: number): OpeningSurface | null;
  /** Free distance along a segment before the first opaque content (see `sceneSightTest`). */
  sight: SightTest;
  /** The same for the short clearance tests round the eye (default `sight`): solid meshes only, no coarse scatter boxes. */
  near?: SightTest;
  /**
   * The same counting ground cover too (tall grass, shrubs, flowers): what an opening view of a building must not have
   * within {@link ARCH_COVER_ZONE} of the lens. Default `sight`.
   */
  cover?: SightTest;
  /** The point is below a water surface (an eye there sees the underside of the water). */
  underWater?(p: Vec3): boolean;
}

/** Inputs of {@link chooseOpeningView}. */
export interface OpeningInput {
  framing: Framing;
  items: readonly FramingItem[];
  /** Vertical field of view (degrees) and aspect ratio of the editor camera. */
  fovDeg: number;
  aspect: number;
  /** A parametric building: the view is from its garden at standing height. */
  arch?: boolean;
  /** Azimuth (degrees, the framing convention: the camera sits at `center + (sin a, ·, cos a)`) tried first. */
  azimuthDeg?: number;
}

/** A chosen opening view. */
export interface OpeningPose {
  position: Vec3;
  target: Vec3;
  /** What was looked at. */
  landmark: Vec3;
  score: number;
  /** The landmark's middle is in sight. */
  sees: boolean;
}

/** Eye height range of an opening view above the ground (m). */
export const OPENING_HEIGHT: readonly [number, number] = Object.freeze([1.6, 8]) as readonly [number, number];
/** Free room round the eye (m) a spot needs. */
const CLEARANCE = 1.8;
/** Free room above the eye (m): not under a roof, a ceiling or a tree crown. */
const HEADROOM = 5;
/** Largest rise (m) of the ground over the two metres round a spot: steeper is not a place to stand. */
const MAX_STEP = 1.3;
/** Rings round the landmark, as shares of the content radius. */
const RING_SHARES = [0.3, 0.45, 0.65, 0.9] as const;
/** Nothing may be closer to the lens than this (m) anywhere in the frame's centre and bottom band. */
export const NEAR_ZONE = 2;
/**
 * A building's opening view frames it from its garden: no grass, shrub or flower may be closer to the lens than this (m)
 * in the frame (tall grass a metre or two away filled half of Casa del Patio's first picture).
 */
export const ARCH_COVER_ZONE = 3;
/** Smallest downward pitch (radians) of an opening view: the orbit camera never looks level or up. */
const MIN_DOWN = 0.035;
/** Directions tried on each ring. */
const AZIMUTHS = 16;

const deg = Math.PI / 180;

/** The landmark of the content: the biggest focus item, else the tallest solid set-piece near the middle; null for no items. */
export function openingLandmark(framing: Framing, items: readonly FramingItem[]): { center: Vec3; top: number; base: number } | null {
  const c = framing.center;
  const r = Math.max(1, framing.radius);
  let best: { center: Vec3; top: number; base: number; score: number } | null = null;
  for (const it of items) {
    if (![...it.min, ...it.max].every(Number.isFinite)) continue;
    const sx = it.max[0] - it.min[0];
    const sy = it.max[1] - it.min[1];
    const sz = it.max[2] - it.min[2];
    const center: Vec3 = [(it.min[0] + it.max[0]) / 2, (it.min[1] + it.max[1]) / 2, (it.min[2] + it.max[2]) / 2];
    const off = Math.hypot(center[0] - c[0], center[2] - c[2]) / r;
    // Flat cover (roads, lawns, water) is never the landmark; nor is anything far out.
    if (sy < 1 || off > 1.2) continue;
    const size = Math.cbrt(Math.max(1e-3, sx * sy * sz));
    const score = (it.focus ? 1000 : 0) + (sy + size) * (it.weight ?? 1) * (1.2 - off);
    if (!best || score > best.score) best = { center, top: it.max[1], base: it.min[1], score };
  }
  return best ? { center: best.center, top: best.top, base: best.base } : null;
}

/** Eye height above the ground for content of radius `radius`: standing height for a house or a room, a little higher over a wide landscape. */
export function openingEyeHeight(radius: number, arch = false): number {
  if (arch) return 1.7;
  const r = Number.isFinite(radius) ? radius : 20;
  return Math.max(OPENING_HEIGHT[0], Math.min(4.5, 1.7 + 0.025 * r));
}

/** Downward pitch (radians) that puts a level horizon at the upper third of the frame. */
export function horizonPitch(fovDeg: number): number {
  const half = (Math.max(10, Math.min(120, Number.isFinite(fovDeg) ? fovDeg : 50)) * deg) / 2;
  return -Math.atan(Math.tan(half) / 3);
}

/** Why candidate spots were turned down (diagnostics: `stats` of {@link rankOpeningViews}). */
export interface OpeningStats {
  tried: number;
  notGround: number;
  steep: number;
  cramped: number;
  /** Of the cramped spots: no headroom, an obstacle at the eye, an obstacle at the waist. */
  headroom?: number;
  eye?: number;
  waist?: number;
  noAim: number;
  /** Turned down for something within {@link NEAR_ZONE} of the lens in the frame, or an eye under water. */
  near?: number;
  /** A building's spots with ground cover within {@link ARCH_COVER_ZONE} of the lens (kept only when no other spot is). */
  cover?: number;
  kept: number;
}

/**
 * The opening view of the content (see the module comment), or null when no spot qualifies (nothing to stand on:
 * an object on a void, a world of water).
 */
export function chooseOpeningView(input: OpeningInput, probe: OpeningProbe): OpeningPose | null {
  return rankOpeningViews(input, probe, 1)[0] ?? null;
}

/** The best `limit` opening views, best first, at least 6 m apart (see {@link chooseOpeningView}). */
export function rankOpeningViews(input: OpeningInput, probe: OpeningProbe, limit = 1, stats?: OpeningStats): OpeningPose[] {
  return drainSteps(rankOpeningViewsSteps(input, probe, limit, stats));
}

/** Run a stepped search ({@link rankOpeningViewsSteps}) to its end at once. */
export function drainSteps<T>(steps: Generator<void, T, void>): T {
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/**
 * {@link rankOpeningViews} in steps: it yields after each candidate spot, so a caller can spread the search over several
 * tasks (the scene tests take a second or more on a large world) and keep the page drawing.
 */
export function* rankOpeningViewsSteps(input: OpeningInput, probe: OpeningProbe, limit = 1, stats?: OpeningStats): Generator<void, OpeningPose[], void> {
  const { framing, items } = input;
  if (!framing.center.every(Number.isFinite) || !(framing.radius > 0)) return [];
  const r = Math.max(6, framing.radius);
  const vHalf = (Math.max(10, Math.min(120, input.fovDeg || 50)) * deg) / 2;
  const hHalf = Math.atan(Math.tan(vHalf) * (input.aspect > 0 ? input.aspect : 16 / 9));
  const mark = openingLandmark(framing, items);
  const lc: Vec3 = mark ? mark.center : [framing.center[0], framing.center[1], framing.center[2]];
  const eyeH = openingEyeHeight(r, input.arch);
  const heights = input.arch ? [eyeH, 3.2] : [eyeH, Math.min(OPENING_HEIGHT[1], eyeH + 3.5)];
  const az0 = Number.isFinite(input.azimuthDeg) ? (input.azimuthDeg as number) : 35;
  const totalWeight = items.reduce((s, it) => s + (it.weight ?? 1), 0) || 1;
  const markHeight = mark ? mark.top - mark.base : 0;
  // Rings round the landmark: shares of the content radius, and the distances at which a tall landmark fills about
  // half and a third of the frame height (never so far that the view is an overview again).
  const fit = markHeight > 0 ? markHeight / (2 * Math.tan(vHalf) * 0.5) : 0;
  const far = Math.min(120, r + 8);
  const rings = [...new Set([...RING_SHARES.map((f) => r * f), ...(fit > 0 ? [fit, fit * 1.5] : [])].map((d) => Math.round(Math.max(8, Math.min(far, d)))))].sort((a, b) => a - b);
  const all: Array<OpeningPose & { covered: boolean }> = [];
  for (const d of rings) {
    for (let k = 0; k < AZIMUTHS; k++) {
      // From the preferred side outward, alternating left and right.
      const step = Math.ceil(k / 2) * (k % 2 === 1 ? 1 : -1);
      const az = (az0 + (step * 360) / AZIMUTHS) * deg;
      const x = lc[0] + Math.sin(az) * d;
      const z = lc[2] + Math.cos(az) * d;
      if (stats) stats.tried++;
      const ground = standable(probe, x, z, stats);
      if (ground === null) continue;
      let placed = false;
      for (const [hi, h] of heights.entries()) {
        // The raised eye only where standing height does not work (cramped, or the landmark hidden).
        if (placed) break;
        const eye: Vec3 = [x, ground + h, z];
        const cramped = crampedBy(probe, eye, ground, hi === 0 ? CLEARANCE : CLEARANCE * 0.8);
        if (cramped) {
          if (stats) {
            stats.cramped++;
            stats[cramped] = (stats[cramped] ?? 0) + 1;
          }
          continue;
        }
        let pose = scoreView(eye, lc, mark, input, probe.sight, items, totalWeight, vHalf, hHalf, r);
        // Nothing in the near zone of the lens (a leaf, a branch, a wall edge a metre away fills the frame), never under water.
        if (pose && (probe.underWater?.(eye) || nearZone(probe.sight, pose.position, pose.target, input.fovDeg, input.aspect) < NEAR_ZONE)) {
          if (stats) stats.near = (stats.near ?? 0) + 1;
          pose = null;
        }
        if (!pose) {
          if (stats) stats.noAim++;
          continue;
        }
        // A building is framed over its garden, not through the grass at the camera's feet: a spot with ground cover close
        // to the lens tries the raised eye, and is kept only for when no spot is clear.
        const covered = input.arch === true && nearestInView(probe.cover ?? probe.sight, pose.position, pose.target, input.fovDeg, input.aspect, ARCH_COVER_ZONE) < ARCH_COVER_ZONE;
        if (covered && stats) stats.cover = (stats.cover ?? 0) + 1;
        // A raised eye is the second choice; a spot far from the middle is less of a place.
        const central = Math.hypot(x - framing.center[0], z - framing.center[2]) / r;
        placed = pose.sees && !covered;
        all.push({ ...pose, covered, score: pose.score - hi * 0.4 - central * 0.8 - Math.max(0, central - 1) * 1.5 - (d / r) * 0.2 });
        if (stats) stats.kept++;
      }
      yield;
    }
  }
  // Clear spots that see the landmark first, then spots that see it, if there are any; then best first, ties in the order
  // tried (deterministic).
  const clear = all.filter((p) => p.sees && !p.covered);
  const seeing = clear.length > 0 ? clear : all.some((p) => p.sees) ? all.filter((p) => p.sees) : all;
  const order = seeing.map((p, i) => ({ p, i })).sort((a, b) => b.p.score - a.p.score || a.i - b.i);
  const out: OpeningPose[] = [];
  for (const { p } of order) {
    if (out.length >= limit) break;
    if (out.some((q) => Math.hypot(q.position[0] - p.position[0], q.position[2] - p.position[2]) < 6)) continue;
    const { covered: _covered, ...pose } = p;
    out.push(pose);
  }
  return out;
}

/** The ground height at (x, z) when the spot is open, flat enough and dry; null otherwise. */
function standable(probe: OpeningProbe, x: number, z: number, stats?: OpeningStats): number | null {
  const s = probe.surface(x, z);
  if (!s || s.kind !== 'ground' || !Number.isFinite(s.y)) {
    if (stats) stats.notGround++;
    return null;
  }
  for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]] as const) {
    const n = probe.surface(x + dx, z + dz);
    if (!n || n.kind === 'water' || Math.abs(n.y - s.y) > MAX_STEP) {
      if (stats) stats.steep++;
      return null;
    }
  }
  return s.y;
}

/**
 * Nothing within `room` metres of the eye in eight directions, at the eye and at waist height over the ground (the
 * waist rays follow the slope, so a hillside street is not taken for a wall), and headroom above. Returns the reason
 * a spot fails, or null when it is clear.
 */
function crampedBy(probe: OpeningProbe, eye: Vec3, ground: number, room: number): 'headroom' | 'eye' | 'waist' | null {
  const sight = probe.near ?? probe.sight;
  // A roof or a canopy covers the spot; one thin overhead line (a tram wire, a cable) does not.
  let covered = 0;
  for (const [ox, oz] of [[0, 0], [1.2, 1.2], [-1.2, 1.2], [1.2, -1.2], [-1.2, -1.2]] as const) {
    if (sight([eye[0] + ox, eye[1], eye[2] + oz], [eye[0] + ox, eye[1] + HEADROOM, eye[2] + oz]) < HEADROOM * 0.98) covered++;
  }
  if (covered >= 4) return 'headroom';
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const dx = Math.sin(a) * room;
    const dz = Math.cos(a) * room;
    if (sight(eye, [eye[0] + dx, eye[1], eye[2] + dz]) < room * 0.98) return 'eye';
    const far = probe.surface(eye[0] + dx, eye[2] + dz);
    const farY = far && Number.isFinite(far.y) && far.y < ground + MAX_STEP * 2 ? far.y : ground;
    if (sight([eye[0], ground + 1, eye[2]], [eye[0] + dx, farY + 1, eye[2] + dz]) < room * 0.98) return 'waist';
  }
  return null;
}

/** Aim from `eye` at the landmark with the horizon in the upper third, and score what the view holds; null when the landmark is out of reach of the frame. */
function scoreView(eye: Vec3, lc: Vec3, mark: { top: number; base: number } | null, input: OpeningInput, sight: SightTest, items: readonly FramingItem[], total: number, vHalf: number, hHalf: number, r: number): Omit<OpeningPose, 'score'> & { score: number } | null {
  const dx = lc[0] - eye[0];
  const dz = lc[2] - eye[2];
  const flat = Math.hypot(dx, dz);
  if (flat < 4) return null;
  const yaw = Math.atan2(dx, dz);
  const toMark = Math.atan2(lc[1] - eye[1], flat);
  const top = mark?.top ?? lc[1];
  const toTop = Math.atan2(top - eye[1], flat);
  const toBase = Math.atan2((mark?.base ?? lc[1]) - eye[1], flat);
  // The upper-third horizon, bent toward the landmark when it stands high above or low below the eye.
  const ideal = horizonPitch(input.fovDeg);
  // Raised as far as needed to keep the landmark's top in the frame.
  const fitTop = toTop - vHalf * 0.9;
  // Never level or upward: the editor's orbit keeps the camera above the point it turns round (it would lift the eye).
  const pitch = Math.min(-MIN_DOWN, Math.max(toMark - vHalf * 0.55, Math.min(toMark + vHalf * 0.45, Math.max(ideal, fitTop))));
  let score = 0;
  // The landmark's top in the frame (a tower cut off at the top reads as a mistake), at a size that reads as the
  // subject: a fifth to two thirds of the frame height, never a wall of it.
  if (toTop - pitch > vHalf * 0.92) score -= 3;
  if (mark) {
    const share = (toTop - Math.max(toBase, pitch - vHalf)) / (2 * vHalf);
    if (share > 0.95) score -= 3;
    else if (share >= 0.2 && share <= 0.85) score += 2;
    else if (share < 0.08) score -= 1;
  }
  // The landmark itself in sight (its middle and its top).
  const sees = sight(eye, lc) >= Math.hypot(flat, lc[1] - eye[1]) * 0.9;
  if (sees) score += 4;
  if (sight(eye, [lc[0], top - 0.3, lc[2]]) >= Math.hypot(flat, top - 0.3 - eye[1]) * 0.9) score += 1.5;
  // An open foreground: five rays across the view at eye height (a wall or a trunk a few metres ahead is a poor first picture).
  let open = 0;
  for (let i = -2; i <= 2; i++) {
    const a = yaw + (i / 2) * hHalf * 0.8;
    const len = 14;
    open += Math.min(len, sight(eye, [eye[0] + Math.sin(a) * len, eye[1], eye[2] + Math.cos(a) * len])) / len;
  }
  score += (open / 5) * 3;
  // Content in the frame, in reach.
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  let seen = 0;
  for (const it of items) {
    const cx = (it.min[0] + it.max[0]) / 2 - eye[0];
    const cy = (it.min[1] + it.max[1]) / 2 - eye[1];
    const cz = (it.min[2] + it.max[2]) / 2 - eye[2];
    const fwd = cx * fx + cz * fz;
    if (fwd < 1 || fwd > r * 3) continue;
    const side = cx * fz - cz * fx;
    if (Math.abs(Math.atan2(side, fwd)) > hHalf || Math.abs(Math.atan2(cy, fwd) - pitch) > vHalf) continue;
    seen += it.weight ?? 1;
  }
  score += (seen / total) * 3;
  // The orbit pivot at the landmark's horizontal distance: orbiting turns round what is looked at.
  const target: Vec3 = [eye[0] + fx * flat, eye[1] + Math.tan(pitch) * flat, eye[2] + fz * flat];
  return { position: eye, target, landmark: [lc[0], lc[1], lc[2]], score, sees };
}

/**
 * The nearest content (m, up to `zone` + 1, default {@link NEAR_ZONE}) along rays through the frame of the view
 * `eye` → `target`: a grid over the centre and the bottom band (where a shrub, a leaf or a railing next to the camera
 * shows), at the field of view `fovDeg` and `aspect`. `sight` gives the free distance along a segment.
 */
export function nearestInView(sight: SightTest, eye: Vec3, target: Vec3, fovDeg: number, aspect: number, zone = NEAR_ZONE): number {
  const dx = target[0] - eye[0];
  const dy = target[1] - eye[1];
  const dz = target[2] - eye[2];
  const flat = Math.hypot(dx, dz);
  if (!(flat > 1e-6)) return Number.POSITIVE_INFINITY;
  const yaw = Math.atan2(dx, dz);
  const pitch = Math.atan2(dy, flat);
  const vHalf = (Math.max(10, Math.min(120, fovDeg || 50)) * deg) / 2;
  const hHalf = Math.atan(Math.tan(vHalf) * (aspect > 0 ? aspect : 16 / 9));
  const len = zone + 1;
  let nearest = len;
  // Rows: the centre, the lower half and the bottom edge; columns across the width.
  for (const v of [0, -0.5, -0.92]) {
    for (const u of [-0.92, -0.5, 0, 0.5, 0.92]) {
      const a = yaw + Math.atan(Math.tan(hHalf) * u);
      const b = pitch + Math.atan(Math.tan(vHalf) * v);
      const c = Math.cos(b);
      const free = sight(eye, [eye[0] + Math.sin(a) * c * len, eye[1] + Math.sin(b) * len, eye[2] + Math.cos(a) * c * len]);
      if (free < nearest) nearest = free;
    }
  }
  return nearest;
}

/**
 * The near zone of a view: {@link nearestInView} with `sight` (scatter crowns included), and 0 when the eye sits inside
 * something (a tree crown, a hedge): seen from three metres away in most directions, the eye is hidden.
 */
export function nearZone(sight: SightTest, eye: Vec3, target: Vec3, fovDeg: number, aspect: number): number {
  let hidden = 0;
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0.7, 0.7, 0], [-0.7, 0.7, 0]] as const) {
    if (sight([eye[0] + dx * 3, eye[1] + dy * 3, eye[2] + dz * 3], eye) < 2.9) hidden++;
  }
  if (hidden >= 4) return 0;
  return nearestInView(sight, eye, target, fovDeg, aspect);
}
