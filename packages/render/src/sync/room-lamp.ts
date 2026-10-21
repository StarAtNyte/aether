/**
 * A point light that can be confined to the room it hangs in. Lamps have no shadow maps (six renders each would be
 * far too dear for a house full of them), so without a limit a pendant in the bedroom lit the corridor and the
 * kitchen through the walls, and every room came out evenly, flatly lit. A {@link clip} box (the room's footprint
 * from floor to ceiling, set by the renderer) fades the lamp's direct light out at the room's walls; the light node
 * that does it is `gpu/room-lamp-node.ts`. Without a clip the lamp behaves as an ordinary point light.
 */
import { Box3, PointLight, type ColorRepresentation } from 'three';

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
    if (!box || box.isEmpty()) {
      this.clip.makeEmpty();
      return;
    }
    const { min, max } = box;
    if (![min.x, min.y, min.z, max.x, max.y, max.z].every(Number.isFinite)) return;
    this.clip.copy(box);
  }

  override copy(source: this, recursive?: boolean): this {
    super.copy(source, recursive);
    this.clip.copy(source.clip);
    return this;
  }
}
