/**
 * Exposure of a room, from the room's own light. The eye of a camera is not a place to measure: one step along a room
 * the volume reads another sky visibility (a window beside the eye, a wall in front of it), and a camera outside the room
 * reads the light of a spot that is not in it at all. A room therefore gets one exposure, measured once over its floor
 * plan at eye height from the baked light volume and kept with it:
 *
 * - the points under or beside a window (the brightest ones) are left out of the average, so a bright window does not
 *   close the exposure and leave the room dark;
 * - the rest are averaged as stops (the eye adapts to log luminance), the way {@link volumeExposure} turns one spot into an
 *   exposure change;
 * - the answer is held to a believable range of interior exposure ({@link ROOM_MIN_EV}..{@link ROOM_MAX_EV}): a closed,
 *   windowless box does not ask for the eye's whole range.
 *
 * Which room the eye is in (or looks at) is decided with hysteresis, so crossing a doorway does not flip the exposure back
 * and forth. Pure decisions; the renderer owns the volume, the rooms and the smoothing.
 */
import { VOLUME_ADAPT_SHARE, interiorBalance } from './eye-adapt';

/** Largest exposure boost (stops) of a room. A photographer shoots a daylit interior two to three stops over the garden. */
export const ROOM_MAX_EV = 3;
/** Largest exposure cut (stops) of a room: lamps at dusk. */
export const ROOM_MIN_EV = -1.5;
/** Points per side of the grid a room is sampled on. */
export const ROOM_GRID = 5;
/** Metres kept clear of the walls: the volume's probes there read the wall, not the room. */
export const ROOM_MARGIN = 0.45;
/** Height above the floor the room is measured at (metres). */
export const ROOM_SAMPLE_HEIGHT = 1.5;
/** Share of the brightest points (windows) left out of the average. */
export const WINDOW_TRIM = 0.3;
/** Share of the darkest points (behind furniture, in alcoves) left out of the average. */
export const SHADOW_TRIM = 0.1;
/** A room counts fully from this far inside its edge and not at all this far outside it (metres): a doorway ramps over their sum. */
export const ROOM_FULL_INSIDE = 0.1;
export const ROOM_NONE_OUTSIDE = 0.35;
/** Metres the room the eye is already in keeps counting beyond its edge (hysteresis against a rival at a doorway). */
export const ROOM_HOLD = 0.25;
/** Metres a camera outside may be from the room it looks at before the room no longer sets the exposure, and the span it fades over. */
export const SUBJECT_REACH = 22;
export const SUBJECT_FADE = 12;
/** Half-angle (radians) of the cone around the view direction in which a room counts as looked at. */
export const SUBJECT_CONE = 0.62;

/** A room's footprint and the height of its floor and ceiling (world metres). */
export interface RoomBox {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  floorY: number;
  ceilY: number;
}

/** What the light volume gives a point, as `LightVolumeController.eyeSample` returns it. */
export interface PointLight {
  vis: number;
  bounce: number;
  lamps: number;
  r: number;
  b: number;
}

/** The light of a room as measured once. */
export interface RoomLight {
  /** Exposure change (stops) of an eye in the room. */
  ev: number;
  /** The same before it was held to the believable range. */
  raw: number;
  /** Grade temperature shift that balances the colour of the room's light, before the adaptation share. */
  balance: number;
  /** Points that took part, and how many were left out as windows. */
  used: number;
  trimmed: number;
}

/** Luminance a point gets, in the units of the outdoor reference (see `volumeExposure`). */
export function pointLuminance(s: Pick<PointLight, 'vis' | 'bounce' | 'lamps'>, ambient: number): number {
  return Math.max(0, s.vis) * Math.max(0, ambient) + Math.max(0, s.bounce) + Math.max(0, s.lamps);
}

/**
 * Exposure change (stops) of a room from the sample points over its floor plan. `outdoor` is the luminance of the sky
 * ambient and the sun on an open site. Null when too few points were readable (the caller falls back to the point read).
 */
export function roomLight(points: readonly PointLight[], outdoor: { ambient: number; sun: number }): RoomLight | null {
  const amb = Math.max(0, outdoor.ambient);
  const out = amb + 0.4 * Math.max(0, outdoor.sun);
  if (!Number.isFinite(out) || out <= 1e-6) return null;
  const lit = points
    .map((p) => ({ p, l: pointLuminance(p, amb) }))
    .filter((e) => Number.isFinite(e.l))
    .sort((a, b) => a.l - b.l);
  if (lit.length < 3) return null;
  const lo = Math.floor(lit.length * SHADOW_TRIM);
  const hi = lit.length - Math.floor(lit.length * WINDOW_TRIM);
  const kept = lit.slice(lo, Math.max(lo + 1, hi));
  let logSum = 0;
  let r = 0;
  let b = 0;
  for (const e of kept) {
    logSum += Math.log2(Math.max(1e-4, e.l / out));
    r += e.p.r;
    b += e.p.b;
  }
  const ev = -(logSum / kept.length) * VOLUME_ADAPT_SHARE;
  return {
    ev: Math.max(ROOM_MIN_EV, Math.min(ROOM_MAX_EV, ev)),
    raw: ev,
    balance: interiorBalance({ r: r / kept.length, b: b / kept.length }),
    used: kept.length,
    trimmed: lit.length - kept.length,
  };
}

/** Sample positions over a room's floor plan: a grid inside {@link ROOM_MARGIN}, at {@link ROOM_SAMPLE_HEIGHT} above the floor. */
export function roomSamplePoints(room: RoomBox): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  const w = room.maxX - room.minX;
  const d = room.maxZ - room.minZ;
  const mx = Math.min(ROOM_MARGIN, w * 0.25);
  const mz = Math.min(ROOM_MARGIN, d * 0.25);
  const y = Math.min(room.floorY + ROOM_SAMPLE_HEIGHT, room.ceilY - 0.2);
  for (let i = 0; i < ROOM_GRID; i++) {
    for (let k = 0; k < ROOM_GRID; k++) {
      out.push([room.minX + mx + ((w - 2 * mx) * i) / (ROOM_GRID - 1), y, room.minZ + mz + ((d - 2 * mz) * k) / (ROOM_GRID - 1)]);
    }
  }
  return out;
}

/**
 * Weight (0..1) of a room at an eye position: 1 from {@link ROOM_FULL_INSIDE} inside its edge, 0 from
 * {@link ROOM_NONE_OUTSIDE} outside it (`grow` pushes the edge out); 0 on another storey.
 */
export function roomWeight(room: RoomBox, x: number, y: number, z: number, grow = 0): number {
  if (!Number.isFinite(x + y + z)) return 0;
  if (y < room.floorY - 0.4 || y > room.ceilY + 0.1) return 0;
  const inside = Math.min(x - room.minX, room.maxX - x, z - room.minZ, room.maxZ - z) + grow;
  return Math.max(0, Math.min(1, (inside + ROOM_NONE_OUTSIDE) / (ROOM_FULL_INSIDE + ROOM_NONE_OUTSIDE)));
}

/** One room's share of the exposure of an eye. */
export interface RoomShare {
  room: RoomBox;
  weight: number;
}

/** The rooms an eye's exposure is made of: their shares add to at most 1, the rest is outdoors (no change). */
export interface RoomTarget {
  shares: RoomShare[];
  /** The eye is not in a room but looks at one from outside (a cutaway). */
  subject: boolean;
}

/** Which rooms set the exposure of a camera; the room it is in keeps counting a little past its edge. */
export class RoomSelector {
  private currentId: string | null = null;

  get current(): string | null {
    return this.currentId;
  }

  reset(): void {
    this.currentId = null;
  }

  /**
   * The rooms an eye at `x, y, z` stands in. Two rooms at a doorway share the eye between them (an eye halfway through
   * reads the mean of both), and the room the eye was in last keeps its weight {@link ROOM_HOLD} metres past its wall.
   * Outside every room, with `lookingIn` (the view cuts the walls open), the room the camera looks at along `dir` (a unit
   * vector) within {@link SUBJECT_REACH} metres.
   */
  select(rooms: readonly RoomBox[], x: number, y: number, z: number, dir: readonly [number, number, number] | null, lookingIn: boolean): RoomTarget {
    const shares: RoomShare[] = [];
    let total = 0;
    for (const r of rooms) {
      const w = roomWeight(r, x, y, z, r.id === this.currentId ? ROOM_HOLD : 0);
      if (w <= 0) continue;
      shares.push({ room: r, weight: w });
      total += w;
    }
    if (shares.length > 0) {
      if (total > 1) for (const s of shares) s.weight /= total;
      shares.sort((p, q) => q.weight - p.weight || (q.room.id === this.currentId ? 1 : 0) - (p.room.id === this.currentId ? 1 : 0));
      this.currentId = (shares[0] as RoomShare).room.id;
      return { shares, subject: false };
    }
    if (lookingIn && dir) {
      let subject: RoomBox | null = null;
      let subjectScore = 0;
      let subjectWeight = 0;
      for (const r of rooms) {
        const cx = (r.minX + r.maxX) / 2 - x;
        const cy = (r.floorY + r.ceilY) / 2 - y;
        const cz = (r.minZ + r.maxZ) / 2 - z;
        const dist = Math.hypot(cx, cy, cz);
        if (dist < 1e-3 || dist > SUBJECT_REACH) continue;
        const cos = (cx * dir[0] + cy * dir[1] + cz * dir[2]) / dist;
        const ang = Math.acos(Math.max(-1, Math.min(1, cos)));
        if (ang > SUBJECT_CONE) continue;
        // The weight falls with distance; the room nearest the view axis wins, and the room chosen last holds on.
        const near = Math.max(0, Math.min(1, (SUBJECT_REACH - dist) / SUBJECT_FADE));
        const score = (1 - ang / SUBJECT_CONE) + (r.id === this.currentId ? 0.25 : 0);
        if (score > subjectScore) {
          subject = r;
          subjectScore = score;
          subjectWeight = near;
        }
      }
      if (subject && subjectWeight > 0) {
        this.currentId = subject.id;
        return { shares: [{ room: subject, weight: subjectWeight }], subject: true };
      }
    }
    return { shares: [], subject: false };
  }
}
