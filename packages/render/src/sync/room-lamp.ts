/**
 * Point and spot lights that can be confined to the room they hang in. Lamps have no shadow maps (six renders each
 * would be far too dear for a house full of them), so without a limit a pendant in the bedroom lit the corridor and
 * the kitchen through the walls, and every room came out evenly, flatly lit; a downlight's cone went on through the
 * floor into the room below. A {@link RoomLamp.clip} box (the room's footprint from floor to ceiling, set by the
 * renderer) fades the light out at the room's walls; the light nodes that do it are in `gpu/room-lamp-node.ts`.
 * Without a clip the light behaves as an ordinary point or spot light.
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

/** A point light with an optional world-space box it lights inside of. */
export class RoomLamp extends PointLight {
  readonly isRoomLamp = true;
  /** World box the light stays inside (empty: no limit). */
  readonly clip = new Box3();

  constructor(color?: ColorRepresentation, intensity?: number, distance?: number, decay?: number) {
    super(color, intensity, distance, decay);
  }

  /** Confine the light to `box` (null: light everywhere). Non-finite boxes are ignored. */
  setClip(box: Box3 | null): void {
    assignClip(this.clip, box);
  }

  override copy(source: this, recursive?: boolean): this {
    super.copy(source, recursive);
    this.clip.copy(source.clip);
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
  /** Photometric profile (angle → intensity), as three's IES spot reads it; null for a plain cone. */
  iesMap: Texture | null = null;

  constructor(color?: ColorRepresentation, intensity?: number, distance?: number, angle?: number, penumbra?: number, decay?: number) {
    super(color, intensity, distance, angle, penumbra, decay);
  }

  /** Confine the light to `box` (null: light everywhere). Non-finite boxes are ignored. */
  setClip(box: Box3 | null): void {
    assignClip(this.clip, box);
  }

  override copy(source: this, recursive?: boolean): this {
    super.copy(source, recursive);
    this.clip.copy(source.clip);
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
