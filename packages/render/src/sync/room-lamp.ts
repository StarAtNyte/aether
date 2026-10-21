/**
 * Point and spot lights that can be confined to the room they hang in. Lamps have no shadow maps (six renders each
 * would be far too dear for a house full of them), so without a limit a pendant in the bedroom lit the corridor and
 * the kitchen through the walls, and every room came out evenly, flatly lit; a downlight's cone went on through the
 * floor into the room below. A {@link RoomLamp.clip} box (the room's footprint from floor to ceiling, set by the
 * renderer) fades the light out at the room's walls; the light nodes that do it are in `gpu/room-lamp-node.ts`.
 * Without a clip the light behaves as an ordinary point or spot light.
 *
 * A confined light also knows the open apertures (archways, open doors) of its room, {@link LampPortal}: a fragment the
 * lamp sees through one is lit past the wall (soft at the edges and fading with distance), so the light of an open-plan
 * room reaches into the next one in the shape of the opening instead of stopping dead at the wall plane.
 */
import { Box3, PointLight, SpotLight, type ColorRepresentation, type Texture } from 'three';

/** Set `clip` to `box` (empty for null or an empty box; a non-finite box is ignored). */
function assignClip(clip: Box3, box: Box3 | null): void {
  if (!box || box.isEmpty()) {
    clip.makeEmpty();
    return;
  }
  const { min, max } = box;
  if (![min.x, min.y, min.z, max.x, max.y, max.z].every(Number.isFinite)) return;
  clip.copy(box);
}

/** Most apertures a lamp passes light through. */
export const MAX_LAMP_PORTALS = 3;

/** An opening in a wall of a lamp's room: a vertical rectangle the lamp's light passes through (world space). */
export interface LampPortal {
  /** Centre of the rectangle. */
  cx: number;
  cy: number;
  cz: number;
  /** Unit direction along the wall (horizontal). */
  tx: number;
  tz: number;
  halfWidth: number;
  halfHeight: number;
}

/** Keep at most {@link MAX_LAMP_PORTALS} finite apertures. */
function assignPortals(out: LampPortal[], list: readonly LampPortal[]): void {
  out.length = 0;
  for (const p of list) {
    if (out.length >= MAX_LAMP_PORTALS) break;
    const ok = [p.cx, p.cy, p.cz, p.tx, p.tz, p.halfWidth, p.halfHeight].every(Number.isFinite) && p.halfWidth > 0.05 && p.halfHeight > 0.05;
    if (ok) out.push({ ...p });
  }
}

/**
 * The apertures that belong to a room: those whose centre lies on or just inside the footprint of `room` (within 0.2 m,
 * the walls' own thickness) and between its floor and ceiling, nearest to `from` (the lamp) first.
 */
export function roomApertures(all: readonly LampPortal[], room: Box3, from: { x: number; z: number }): LampPortal[] {
  return all
    .filter((q) => q.cx >= room.min.x - 0.2 && q.cx <= room.max.x + 0.2 && q.cz >= room.min.z - 0.2 && q.cz <= room.max.z + 0.2 && q.cy >= room.min.y && q.cy <= room.max.y)
    .sort((p, q) => Math.hypot(p.cx - from.x, p.cz - from.z) - Math.hypot(q.cx - from.x, q.cz - from.z));
}

/** A point light with an optional world-space box it lights inside of. */
export class RoomLamp extends PointLight {
  readonly isRoomLamp = true;
  /** World box the light stays inside (empty: no limit). */
  readonly clip = new Box3();
  /** Openings of the room the light also passes through. */
  readonly portals: LampPortal[] = [];

  constructor(color?: ColorRepresentation, intensity?: number, distance?: number, decay?: number) {
    super(color, intensity, distance, decay);
  }

  /** The apertures of the lamp's room (at most {@link MAX_LAMP_PORTALS}; non-finite or tiny ones are dropped). */
  setPortals(list: readonly LampPortal[]): void {
    assignPortals(this.portals, list);
  }

  /** Confine the light to `box` (null: light everywhere). Non-finite boxes are ignored. */
  setClip(box: Box3 | null): void {
    assignClip(this.clip, box);
  }

  override copy(source: this, recursive?: boolean): this {
    super.copy(source, recursive);
    this.clip.copy(source.clip);
    assignPortals(this.portals, source.portals);
    return this;
  }
}

/**
 * A spot light (with an optional IES profile, `iesMap`) and an optional world-space box it lights inside of: the
 * node renderer shades it with an IES-aware spot node that fades it at the box's faces.
 */
export class RoomSpot extends SpotLight {
  readonly isRoomLamp = true;
  /** World box the light stays inside (empty: no limit). */
  readonly clip = new Box3();
  /** Openings of the room the light also passes through. */
  readonly portals: LampPortal[] = [];
  /** Photometric profile (angle → intensity), as three's IES spot reads it; null for a plain cone. */
  iesMap: Texture | null = null;

  constructor(color?: ColorRepresentation, intensity?: number, distance?: number, angle?: number, penumbra?: number, decay?: number) {
    super(color, intensity, distance, angle, penumbra, decay);
  }

  /** Confine the light to `box` (null: light everywhere). Non-finite boxes are ignored. */
  setClip(box: Box3 | null): void {
    assignClip(this.clip, box);
  }

  /** The apertures of the lamp's room (at most {@link MAX_LAMP_PORTALS}; non-finite or tiny ones are dropped). */
  setPortals(list: readonly LampPortal[]): void {
    assignPortals(this.portals, list);
  }

  override copy(source: this, recursive?: boolean): this {
    super.copy(source, recursive);
    this.clip.copy(source.clip);
    assignPortals(this.portals, source.portals);
    this.iesMap = source.iesMap;
    return this;
  }
}

/** A light the renderer can confine to a room. */
export type ConfinedLight = RoomLamp | RoomSpot;

/** Whether `l` can be confined to a room. */
export function isConfinedLight(l: unknown): l is ConfinedLight {
  return l instanceof RoomLamp || l instanceof RoomSpot;
}
