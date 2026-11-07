/**
 * The hero view of a building, the way an architectural photographer takes it:
 *
 * - from the **front**: the facade with the entrance, the most glazing and doors, the one facing the approach (a path, a
 *   road) or the one the plan names; never a blank back wall;
 * - at a **three-quarter angle**, about 30–45° off the front's normal, so two facades show (the second one the richer of
 *   the two sides);
 * - from the **sunlit side** at the world's time of day: the front the sun falls on counts as more of a front, and a view
 *   into the sun (the facade in its own shadow, the sky blown out behind it) loses points;
 * - at the eye height of a standing person (1.65 m), or barely raised (2.2 m) where the grass needs it, with a near-level
 *   pitch (vertical lines stay vertical: a two-point perspective);
 * - with the building filling about 55–75 % of the frame width, some sky above it and ground before it;
 * - with nothing within a few metres of the lens, no grass filling the lower third, no trunk, crown or branch framing the
 *   edges or hanging into the picture, and preferably standing on a path, a terrace or open ground.
 *
 * Candidate spots (each facade as the front, both sides, three angles, three distances fitted to the frame share) pass the
 * opening view's safety checks (open dry ground, clearance round the eye, the near zone, not under water, the cover zone)
 * and are scored by {@link scoreArchHero}. Pure and deterministic (no three.js): the renderer supplies the building's
 * facts ({@link ArchBuilding}) and the probe.
 */
import type { Vec3 } from '@aether/core';
import { ARCH_COVER_ZONE, boxEntryDistance, crampedBy, frameClutter, MIN_DOWN, NEAR_ZONE, nearestInView, nearZone, standable, sunHorizontal, type OpeningInput, type OpeningPose, type OpeningProbe, type OpeningStats, type OpeningSun } from './opening-view';

/** A door or a window of a building's outside walls. */
export interface ArchOpening {
  /** Middle of the opening (world). */
  center: Vec3;
  /** Outward horizontal normal (x, z), unit. */
  normal: readonly [number, number];
  /** Width × height (m²). */
  area: number;
  /** `entrance`: the main door; `door`: another door to the outside (a terrace door, often glazed); `window`. */
  kind: 'entrance' | 'door' | 'window';
}

/** What the hero view needs to know of a building. */
export interface ArchBuilding {
  /** Box of its outside walls and roof (world). */
  min: Vec3;
  max: Vec3;
  /** Points of its outline (wall corners, top and bottom) for the frame share; default: the box corners. */
  outline?: readonly Vec3[];
  openings: readonly ArchOpening[];
  /** Points (x, z) of the approach: paths, roads and drives near the building. */
  approach?: ReadonlyArray<readonly [number, number]>;
  /** The front the plan names (outward x, z), if any. */
  front?: readonly [number, number];
}

/** One side of a building and how much it is its front. */
export interface ArchFacade {
  /** Outward normal (x, z), unit. */
  normal: [number, number];
  /** Front score (0 for a blank wall). */
  score: number;
  /** Detail on it (windows and doors, area-weighted, seen from outside). */
  richness: number;
  entrance: boolean;
}

/** Eye heights tried (m over the ground): a standing person, then barely raised (over tall grass, never a drone). */
export const ARCH_HERO_HEIGHTS: readonly number[] = Object.freeze([1.65, 2.2]);
/** A view whose edges meet trunks, crowns or branches on more than this share of their rays is used only when none is clear. */
export const ARCH_HERO_EDGE_CLUTTER = 0.2;
/** Angles off the front's normal tried (degrees). */
export const ARCH_HERO_ANGLES: readonly number[] = Object.freeze([35, 28, 44, 20, 52]);
/** A step back (m) from the farthest fitted distance, tried once and twice. */
export const ARCH_HERO_STEP_BACK = 3;
/** Shares of the frame width the building is fitted to (best first). */
export const ARCH_HERO_SHARES: readonly number[] = Object.freeze([0.65, 0.55, 0.75]);
/** A view's primary facade scores at least this share of the best front's to count as a view of the front. */
export const ARCH_HERO_FRONTNESS = 0.75;
/** Largest share of the frame height the building is fitted to. */
export const ARCH_HERO_HEIGHT_SHARE = 0.6;
/** Most opening points sampled per view for the facade richness (the largest). */
const MAX_SAMPLED = 28;
/** Free room (m) round the eye a hero spot needs. */
const CLEARANCE = 1.6;

const deg = Math.PI / 180;

/** The building's outline points (the box corners when none were given). */
function outlineOf(b: ArchBuilding): readonly Vec3[] {
  if (b.outline && b.outline.length >= 4) return b.outline;
  const out: Vec3[] = [];
  for (let i = 0; i < 8; i++) out.push([i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]]);
  return out;
}

const centerOf = (b: ArchBuilding): Vec3 => [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];

/** Weight of an opening in a facade's richness: glass and doors read as the front; the entrance most. */
export function openingWeight(o: ArchOpening): number {
  const a = Math.max(0.3, Math.min(12, Number.isFinite(o.area) ? o.area : 1));
  return o.kind === 'entrance' ? 4 + a : o.kind === 'door' ? a * 1.2 : a;
}

/**
 * The building's four sides (its main axes from the openings' normals), each with its front score: the entrance (+4), its
 * share of the outward-seen doors and glazing (×4), facing the approach (+1.5), the plan's front (+6), and with a `sun`, the
 * light on it (up to +2.5 facing the sun, down to −1.5 in its own shadow; a blank wall stays at 0). `outer(o)` says an
 * opening looks out of the building (not into a courtyard); default: all do.
 */
export function archFacades(b: ArchBuilding, outer: (o: ArchOpening) => boolean = () => true, sun?: OpeningSun): ArchFacade[] {
  // Main axis: the weighted circular mean of 4 × the normals' angle (a rectangle's four sides agree on it).
  let sx = 0;
  let sz = 0;
  for (const o of b.openings) {
    const a = Math.atan2(o.normal[0], o.normal[1]);
    const w = openingWeight(o);
    sx += Math.sin(4 * a) * w;
    sz += Math.cos(4 * a) * w;
  }
  const axis = Math.hypot(sx, sz) > 1e-6 ? Math.atan2(sx, sz) / 4 : 0;
  const sides: ArchFacade[] = [0, 1, 2, 3].map((k) => {
    const a = axis + (k * Math.PI) / 2;
    return { normal: [Math.sin(a), Math.cos(a)], score: 0, richness: 0, entrance: false };
  });
  let total = 0;
  for (const o of b.openings) {
    if (!outer(o)) continue;
    let best = sides[0] as ArchFacade;
    let bd = -2;
    for (const s of sides) {
      const d = s.normal[0] * o.normal[0] + s.normal[1] * o.normal[1];
      if (d > bd) {
        bd = d;
        best = s;
      }
    }
    if (bd < 0.6) continue;
    const w = openingWeight(o);
    best.richness += w;
    total += w;
    if (o.kind === 'entrance') best.entrance = true;
  }
  const c = centerOf(b);
  const half = Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]) / 2;
  for (const s of sides) {
    s.score = (s.entrance ? 4 : 0) + (total > 0 ? (s.richness / total) * 4 : 0);
    // The approach: a path or a road out in front of this side.
    if ((b.approach ?? []).some(([x, z]) => {
      const dx = x - c[0];
      const dz = z - c[2];
      const along = dx * s.normal[0] + dz * s.normal[1];
      return along > half * 0.6 && along < half + 40 && along > Math.abs(dx * s.normal[1] - dz * s.normal[0]) * 0.7;
    })) s.score += 1.5;
    if (b.front && s.normal[0] * b.front[0] + s.normal[1] * b.front[1] > Math.SQRT1_2) s.score += 6;
    // The light: a photographer shoots the front the sun falls on (a dusk sun low behind the entrance leaves it a
    // silhouette), so a well glazed side in the sun competes with an entrance in shadow.
    const toSun = sunHorizontal(sun);
    if (toSun && s.richness > 0) {
      const lit = s.normal[0] * toSun[0] + s.normal[1] * toSun[1];
      s.score = Math.max(0, s.score + (lit > 0 ? 2.5 * lit : 1.5 * lit) * (sun?.strength ?? 0));
    }
  }
  return sides;
}

/** Horizontal angular span (radians) of `pts` seen from `eye`, and the yaw of its middle. */
function span(eye: Vec3, pts: readonly Vec3[], yaw0: number): { width: number; mid: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pts) {
    const a = Math.atan2(p[0] - eye[0], p[2] - eye[2]) - yaw0;
    const w = Math.atan2(Math.sin(a), Math.cos(a));
    if (w < lo) lo = w;
    if (w > hi) hi = w;
  }
  return { width: hi - lo, mid: yaw0 + (lo + hi) / 2 };
}

/** Share of the frame width (`hHalf` the half angle) that a horizontal angular `width` fills. */
function frameShare(width: number, hHalf: number): number {
  // Planar projection: tan of the half widths, about the middle.
  const h = Math.min(Math.PI / 2 - 0.01, width / 2);
  return Math.tan(h) / Math.tan(hHalf);
}

/** Distance from the building's middle along `dir` (x, z unit) at which the building fills `share` of the frame width. */
function fitDistance(pts: readonly Vec3[], c: Vec3, dir: readonly [number, number], share: number, hHalf: number, eyeY: number): number {
  let lo = 2;
  let hi = 400;
  for (let i = 0; i < 30; i++) {
    const d = (lo + hi) / 2;
    const eye: Vec3 = [c[0] + dir[0] * d, eyeY, c[2] + dir[1] * d];
    const s = frameShare(span(eye, pts, Math.atan2(c[0] - eye[0], c[2] - eye[2])).width, hHalf);
    if (s > share) lo = d;
    else hi = d;
  }
  return (lo + hi) / 2;
}

/** The parts of a hero view's score (see {@link scoreArchHero}). */
export interface ArchHeroScore {
  total: number;
  front: number;
  angle: number;
  coverage: number;
  richness: number;
  occlusion: number;
  foliage: number;
  sky: number;
  footing: number;
  light: number;
  clutter: number;
}

/** What {@link scoreArchHero} measures of one view. */
export interface ArchHeroMeasure {
  /** The primary facade's front score over the best facade's (0–1). */
  frontness: number;
  /** Degrees between the view direction (building to eye) and the primary facade's normal. */
  offAngle: number;
  /** Share of the frame width the building fills. */
  share: number;
  /** The building's top is cut by the frame. */
  topCut: boolean;
  /** Share of the frame height the building fills. */
  height?: number;
  /** Weighted share (0–1) of the building's outward openings the view shows unblocked, facing the camera. */
  richness: number;
  /** Share (0–1) of the building's sample points hidden by something in between. */
  occluded: number;
  /** Share (0–1) of the lower third's rays that meet grass or shrubs first. */
  foliage: number;
  /** Share (0–1) of the frame that is open sky. */
  sky: number;
  /** Stands on a path, a terrace or a deck; stands in ground cover. */
  paved: boolean;
  inCover: boolean;
  /** The raised eye. */
  raised: boolean;
  /**
   * Cosine (−1–1) between the view direction (building to eye) and the way to the sun, times the sun's strength: 1 with the
   * sun at the photographer's back, −1 shooting into it. Absent without a sun.
   */
  sunlit?: number;
  /** Share (0–1) of the frame's edge rays (both sides, the top) that meet a trunk, a crown or a branch before the building. */
  edges?: number;
  /** Share (0–1) of all the frame's rays that do. */
  clutter?: number;
}

/**
 * Score of a hero view (higher is better): front facing (3), the three-quarter angle (2), the frame share (2), facade
 * richness (3, a blank wall −3), occlusion (−4), grass in the lower third (−3), sky (+1, none −1.5), footing (±0.7), the
 * light (+1.5 with the sun behind the camera, down to −3 shooting into it), trunks and branches at the edges (−5) or
 * anywhere in the frame (−3), and the raised eye (−1.5).
 */
export function scoreArchHero(m: ArchHeroMeasure): ArchHeroScore {
  const front = 3 * Math.max(0, Math.min(1, m.frontness));
  const off = Math.abs(m.offAngle);
  const angle = off >= 28 && off <= 46 ? 2 : off >= 18 && off <= 56 ? 1 : off < 12 ? -1 : 0;
  const coverage = m.share >= 0.55 && m.share <= 0.78 ? 2 : m.share >= 0.42 && m.share <= 0.9 ? 1 : m.share > 1 || m.share < 0.3 ? -2 : 0;
  const richness = m.richness < 0.08 ? -3 : 3 * Math.min(1, m.richness * 1.6);
  const occlusion = -6 * m.occluded;
  const foliage = -3 * m.foliage;
  const sky = m.sky <= 0.02 ? -1.5 : m.sky >= 0.1 && m.sky <= 0.45 ? 1 : 0.3;
  const footing = (m.paved ? 0.7 : 0) - (m.inCover ? 0.7 : 0);
  const tall = m.height !== undefined && m.height > 0.8 ? 1.5 : 0;
  const sun = m.sunlit ?? 0;
  const light = sun >= 0 ? 1.5 * sun : 1.5 * sun - (sun < -0.35 ? 1.5 * Math.min(1, (-sun - 0.35) / 0.35) : 0);
  const clutter = -5 * (m.edges ?? 0) - 3 * (m.clutter ?? 0);
  const total = front + angle + coverage + richness + occlusion + foliage + sky + footing + light + clutter - tall - (m.topCut ? 3 : 0) - (m.raised ? 1.5 : 0);
  return { total, front, angle, coverage, richness, occlusion, foliage, sky, footing, light, clutter };
}

/** The pose and measure of a view from `eye` at the building (null when the building does not fit the frame at all). */
function measure(eye: Vec3, b: ArchBuilding, pts: readonly Vec3[], primary: ArchFacade, best: number, probe: OpeningProbe, outer: readonly ArchOpening[], totalW: number, vHalf: number, hHalf: number, ground: number, raised: boolean, paved: boolean, sun: OpeningSun | undefined, fovDeg: number, aspect: number): { m: ArchHeroMeasure; target: Vec3 } | null {
  const c = centerOf(b);
  const flat = Math.hypot(c[0] - eye[0], c[2] - eye[2]);
  if (flat < 3) return null;
  const sp = span(eye, pts, Math.atan2(c[0] - eye[0], c[2] - eye[2]));
  const yaw = sp.mid;
  // Near level: the building's middle a little above the frame's centre line at most, never looking up (the orbit lifts
  // the eye over its pivot), at most about 7 degrees down.
  const toTop = Math.atan2(b.max[1] - eye[1], flat);
  const toBase = Math.atan2(Math.max(ground, b.min[1]) - eye[1], flat);
  const pitch = Math.min(-MIN_DOWN, Math.max(-0.12, (toTop + toBase) / 2 + vHalf * 0.15));
  const topCut = toTop - pitch > vHalf * 0.94;
  const target: Vec3 = [eye[0] + Math.sin(yaw) * flat, eye[1] + Math.tan(pitch) * flat, eye[2] + Math.cos(yaw) * flat];
  const share = frameShare(sp.width, hHalf);
  const dir = [(eye[0] - c[0]) / flat, (eye[2] - c[2]) / flat];
  const offAngle = Math.acos(Math.max(-1, Math.min(1, dir[0]! * primary.normal[0] + dir[1]! * primary.normal[1]))) / deg;
  // Richness and occlusion: the outward openings facing the camera, each tested for a clear line just off its glass.
  const sight = probe.sight;
  let seenW = 0;
  let tested = 0;
  let hidden = 0;
  for (const o of outer) {
    const to = [eye[0] - o.center[0], eye[2] - o.center[2]];
    const len = Math.hypot(to[0]!, to[1]!) || 1;
    const facing = (to[0]! * o.normal[0] + to[1]! * o.normal[1]) / len;
    if (facing < 0.12) continue;
    const p: Vec3 = [o.center[0] + o.normal[0] * 0.35, o.center[1], o.center[2] + o.normal[1] * 0.35];
    const d = Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]);
    tested++;
    if (sight(eye, p) < d - 0.4) {
      hidden++;
      continue;
    }
    seenW += openingWeight(o) * Math.min(1, facing * 1.4);
  }
  // The building's own corners (blocked by a hedge, a tree, a wall in front).
  for (const q of [0.25, 0.5, 0.75]) {
    const p: Vec3 = [b.min[0] + (b.max[0] - b.min[0]) * q, b.min[1] + (b.max[1] - b.min[1]) * 0.45, b.min[2] + (b.max[2] - b.min[2]) * q];
    // From the eye toward the building's middle band; a ray that ends at the building's face is clear.
    const d = Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]);
    const free = sight(eye, p);
    const face = boxEntryDistance(eye, p, b.min, b.max);
    tested++;
    if (free < (face ?? d) - 0.6) hidden++;
  }
  // The frame grid: sky in the upper part, grass or shrubs first in the lower third.
  const cover = probe.cover ?? probe.sight;
  const solid = probe.near ?? probe.sight;
  let sky = 0;
  let onHouse = 0;
  let blocked = 0;
  let cells = 0;
  let grass = 0;
  let lower = 0;
  for (const v of [0.9, 0.6, 0.3, 0, -0.35, -0.65, -0.9]) {
    for (const u of [-0.9, -0.55, -0.2, 0.2, 0.55, 0.9]) {
      const a = yaw + Math.atan(Math.tan(hHalf) * u);
      const e = pitch + Math.atan(Math.tan(vHalf) * v);
      const ce = Math.cos(e);
      const dir3: Vec3 = [Math.sin(a) * ce, Math.sin(e), Math.cos(a) * ce];
      cells++;
      // Rays at the building: something nearer than its face (a tree, a hedge, a wall) hides it.
      if (v > -0.7 && v < 0.7) {
        const far = flat * 2 + 20;
        const end: Vec3 = [eye[0] + dir3[0] * far, eye[1] + dir3[1] * far, eye[2] + dir3[2] * far];
        const face = boxEntryDistance(eye, end, b.min, b.max);
        if (face !== null && face > 0.5) {
          onHouse++;
          if (sight(eye, end) < face - 0.6) blocked++;
        }
      }
      if (v > 0 && e > 0.01) {
        const far = 400;
        if (!(sight(eye, [eye[0] + dir3[0] * far, eye[1] + dir3[1] * far, eye[2] + dir3[2] * far]) < far)) sky++;
      }
      if (v <= -0.34) {
        const len = Math.min(flat, 25);
        const end: Vec3 = [eye[0] + dir3[0] * len, eye[1] + dir3[1] * len, eye[2] + dir3[2] * len];
        const g = cover(eye, end);
        lower++;
        if (g < len && g < solid(eye, end) - 0.3) grass++;
      }
    }
  }
  const inCover = cover(eye, [eye[0], ground + 0.05, eye[2]]) < eye[1] - ground - 0.2 && solid(eye, [eye[0], ground + 0.05, eye[2]]) >= eye[1] - ground - 0.2;
  // Trunks, crowns and branches between the lens and the building: at the edges they frame the picture like a doorway.
  const fc = frameClutter(probe, eye, target, fovDeg, aspect, { near: Math.max(4, flat * 0.6), subject: { min: b.min, max: b.max } });
  const toSun = sunHorizontal(sun);
  const m: ArchHeroMeasure = {
    frontness: best > 0 ? primary.score / best : 0,
    offAngle,
    share,
    topCut,
    height: (toTop - toBase) / (2 * vHalf),
    richness: totalW > 0 ? Math.min(1, seenW / totalW) : 0,
    occluded: Math.max(tested > 0 ? hidden / tested : 0, onHouse > 0 ? blocked / onHouse : 0),
    foliage: lower > 0 ? grass / lower : 0,
    sky: sky / cells,
    paved,
    inCover,
    raised,
    edges: fc.edges,
    clutter: fc.overall,
    ...(toSun ? { sunlit: (dir[0]! * toSun[0] + dir[1]! * toSun[1]) * (sun?.strength ?? 0) } : {}),
  };
  return { m, target };
}

/** A ranked hero view with its score parts. */
export interface ArchHeroPose extends OpeningPose {
  parts: ArchHeroScore;
  measure: ArchHeroMeasure;
}

/**
 * The best `limit` hero views of the building (see the module comment), best first and at least 6 m apart; empty when no
 * spot passes the safety checks (the caller falls back on the general opening search). Yields after each spot.
 */
export function* archHeroViewsSteps(input: OpeningInput, b: ArchBuilding, probe: OpeningProbe, limit = 1, stats?: OpeningStats): Generator<void, ArchHeroPose[], void> {
  if (![...b.min, ...b.max].every(Number.isFinite) || b.max[0] - b.min[0] < 1 || b.max[2] - b.min[2] < 1) return [];
  const vHalf = (Math.max(10, Math.min(120, input.fovDeg || 50)) * deg) / 2;
  const hHalf = Math.atan(Math.tan(vHalf) * (input.aspect > 0 ? input.aspect : 16 / 9));
  const c = centerOf(b);
  const pts = outlineOf(b);
  // An opening looks out of the building when the way out along its normal is open (a courtyard's doors face the far wing).
  const solid = probe.near ?? probe.sight;
  const outerSet = new Set<ArchOpening>();
  for (const o of b.openings) {
    const from: Vec3 = [o.center[0] + o.normal[0] * 0.4, o.center[1], o.center[2] + o.normal[1] * 0.4];
    const to: Vec3 = [from[0] + o.normal[0] * 24, from[1], from[2] + o.normal[1] * 24];
    if (solid(from, to) >= 12) outerSet.add(o);
  }
  const facades = archFacades(b, (o) => outerSet.has(o), input.sun);
  const best = Math.max(0, ...facades.map((f) => f.score));
  const outer = [...outerSet].sort((p, q) => openingWeight(q) - openingWeight(p)).slice(0, MAX_SAMPLED);
  const totalW = outer.reduce((s, o) => s + openingWeight(o), 0);
  // Fronts best first; a blank side is never a front.
  const order = facades.map((f, i) => ({ f, i })).filter(({ f }) => f.richness > 0 || best === 0).sort((p, q) => q.f.score - p.f.score || p.i - q.i);
  const all: Array<ArchHeroPose & { covered: boolean }> = [];
  for (const { f } of order) {
    const k = facades.indexOf(f);
    const left = facades[(k + 3) % 4] as ArchFacade;
    const right = facades[(k + 1) % 4] as ArchFacade;
    // Toward the richer neighbour first: that side is the second facade of the picture.
    const signs = right.richness > left.richness ? [1, -1] : right.richness < left.richness ? [-1, 1] : [1, -1];
    const a0 = Math.atan2(f.normal[0], f.normal[1]);
    for (const sign of signs) {
      for (const off of ARCH_HERO_ANGLES) {
        // Swung far toward a blank side, the picture is mostly blank wall.
        if (off > 45 && (sign > 0 ? right : left).richness === 0) continue;
        const a = a0 + sign * off * deg;
        const dir: [number, number] = [Math.sin(a), Math.cos(a)];
        // Far enough for the width share, and for the height to fill at most about 60 % of the frame (a tall, narrow
        // house seen close fills the frame with one wall); then a step or two back, as a photographer clears a tree or a
        // planter between the lens and the house.
        const reach = Math.abs(dir[0]) * (b.max[0] - b.min[0]) * 0.5 + Math.abs(dir[1]) * (b.max[2] - b.min[2]) * 0.5;
        const tall = (b.max[1] - b.min[1]) / (2 * Math.tan(vHalf) * ARCH_HERO_HEIGHT_SHARE) + reach;
        const fitted = ARCH_HERO_SHARES.map((share) => Math.max(fitDistance(pts, c, dir, share, hHalf, b.min[1] + 1.65), tall));
        const far = Math.max(...fitted);
        const dists: number[] = [];
        for (const d of [...fitted, far + ARCH_HERO_STEP_BACK, far + 2 * ARCH_HERO_STEP_BACK]) if (dists.every((q) => Math.abs(q - d) > 1)) dists.push(d);
        for (const d of dists) {
          const x = c[0] + dir[0] * d;
          const z = c[2] + dir[1] * d;
          if (stats) stats.tried++;
          const ground = standable(probe, x, z, stats);
          if (ground === null) {
            yield;
            continue;
          }
          const surface = probe.surface(x, z);
          for (const [hi, h] of ARCH_HERO_HEIGHTS.entries()) {
            const eye: Vec3 = [x, ground + h, z];
            const cramped = crampedBy(probe, eye, ground, hi === 0 ? CLEARANCE : CLEARANCE * 0.8);
            if (cramped) {
              if (stats) {
                stats.cramped++;
                stats[cramped] = (stats[cramped] ?? 0) + 1;
              }
              continue;
            }
            const r = measure(eye, b, pts, f, best, probe, outer, totalW, vHalf, hHalf, ground, hi > 0, surface?.paved === true, input.sun, input.fovDeg, input.aspect);
            if (!r || probe.underWater?.(eye) || nearZone(probe.sight, eye, r.target, input.fovDeg, input.aspect) < NEAR_ZONE) {
              if (stats) stats.near = (stats.near ?? 0) + 1;
              continue;
            }
            const covered = nearestInView(probe.cover ?? probe.sight, eye, r.target, input.fovDeg, input.aspect, ARCH_COVER_ZONE) < ARCH_COVER_ZONE;
            if (covered && stats) stats.cover = (stats.cover ?? 0) + 1;
            const parts = scoreArchHero(r.m);
            all.push({ position: eye, target: r.target, landmark: c, score: parts.total, sees: r.m.occluded < 0.5, parts, measure: r.m, covered });
            if (stats) stats.kept++;
            // The raised eye only where standing height is not clear.
            if (!covered && r.m.foliage < 0.25 && r.m.occluded < 0.3 && (r.m.edges ?? 0) <= ARCH_HERO_EDGE_CLUTTER) break;
          }
          yield;
        }
      }
    }
  }
  // Clear spots first (no cover at the lens, no trunk or branch framing the edges); of them the views of the front itself
  // (its facade the best or close to it, mostly in sight), so a side or back view never wins on points alone (a tree beside
  // the front, grass not yet grown in when the search ran).
  const clear = all.filter((p) => !p.covered && (p.measure.edges ?? 0) <= ARCH_HERO_EDGE_CLUTTER);
  const uncovered = all.filter((p) => !p.covered);
  const open = clear.length > 0 ? clear : uncovered.length > 0 ? uncovered : all;
  const fronts = open.filter((p) => p.measure.frontness >= ARCH_HERO_FRONTNESS && p.measure.occluded < 0.5);
  const pool = fronts.length > 0 ? fronts : open;
  const ranked = pool.map((p, i) => ({ p, i })).sort((p, q) => q.p.score - p.p.score || p.i - q.i);
  const out: ArchHeroPose[] = [];
  for (const { p } of ranked) {
    if (out.length >= limit) break;
    if (out.some((q) => Math.hypot(q.position[0] - p.position[0], q.position[2] - p.position[2]) < 6)) continue;
    const { covered: _covered, ...pose } = p;
    out.push(pose);
  }
  return out;
}

