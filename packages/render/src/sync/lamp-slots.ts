/**
 * Stand-in slots for the scene's shadowless point lamps, so the set of lights every lit material is built for stays the
 * same while a world plays.
 *
 * The node renderer keys each object's shading program on the exact lights in the scene (their ids and kinds). A light
 * that appears (a medkit with its red glow dropped by a raider), disappears (a pickup collected) or is switched off made
 * every lit object prepare again: on an integrated GPU that takes seconds, and the frames shown meanwhile lacked the
 * ground, the cliffs and every other lit surface, so the view showed the flat haze below the horizon in their place.
 *
 * The entity lamps keep their place and their meaning (the light volume, room exposure and the bake read them as before)
 * but move to {@link HIDDEN_LAMP_LAYER}, which no camera draws. A fixed pool of slot lamps, the ones the renderer
 * actually shades with, takes their colour, intensity, range, world position, room clip and apertures each frame. A
 * slot without a lamp shines at zero. The pool holds a slot for every lit lamp shown, plus a spare for each lamp of the
 * world's templates (whose copies a game spawns), and only grows, so the light set changes when more lamps are lit at once than
 * ever before, not each time one comes or goes. Lamps the forward budget cut (`userData.cut`) or switched off by
 * hiding the light itself take no slot.
 */
import { Group, type Light, type Object3D } from 'three';
import { RoomLamp, type LampPortal } from './room-lamp';

/** Layer of the entity lamps that the slots stand in for: no camera enables it, so the renderer does not shade with them. */
export const HIDDEN_LAMP_LAYER = 30;

/** Whether `l` is drawn through a slot: a point lamp without a shadow map (a shadow is owned by its own light). */
export function slottable(l: Light): l is RoomLamp {
  return l instanceof RoomLamp && !l.castShadow;
}

/** Visible all the way up to the root (a lamp under a hidden entity gives no light). */
function shown(o: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

function samePortal(a: LampPortal, b: LampPortal): boolean {
  return a.cx === b.cx && a.cy === b.cy && a.cz === b.cz && a.tx === b.tx && a.tz === b.tz && a.halfWidth === b.halfWidth && a.halfHeight === b.halfHeight;
}

function samePortals(a: readonly LampPortal[], b: readonly LampPortal[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!samePortal(a[i] as LampPortal, b[i] as LampPortal)) return false;
  return true;
}

/** The slot pool. Add {@link group} to the scene and call {@link sync} before each draw. */
export class LampSlots {
  readonly group = new Group();
  private readonly slots: RoomLamp[] = [];
  /** Lamp each slot stands in for (null: free). */
  private readonly owners: Array<RoomLamp | null> = [];
  private readonly live: RoomLamp[] = [];
  /** Spare slots added so far for {@link sync}'s `spares`. */
  private spared = 0;

  constructor() {
    this.group.name = 'aether:lamp-slots';
  }

  /** Number of slots (lights the shading programs are built for). */
  get size(): number {
    return this.slots.length;
  }

  /** Lamp a slot stands in for, by slot index (tests and diagnostics). */
  owner(i: number): RoomLamp | null {
    return this.owners[i] ?? null;
  }

  /**
   * Bring the slots up to date with `lamps` (every entity light; the shadowless point lamps among them are moved to
   * {@link HIDDEN_LAMP_LAYER} and drawn through a slot, the others are left as they are). `spares`: lamps that may
   * appear later (the shadowless point lamps of the world's templates, whose copies a game spawns); that many slots are
   * added once on top of those the lamps shown take, so the first copies take them without changing the light set.
   * Returns true when the pool grew.
   */
  sync(lamps: readonly Light[], spares = 0): boolean {
    const live = this.live;
    live.length = 0;
    let grew = false;
    for (let k = 0; k < lamps.length; k++) {
      const l = lamps[k];
      if (!(l instanceof RoomLamp)) continue;
      if (l.castShadow) {
        // A lamp that casts a shadow draws itself.
        if (l.layers.mask === 1 << HIDDEN_LAMP_LAYER) l.layers.set(0);
        continue;
      }
      if (l.layers.mask !== 1 << HIDDEN_LAMP_LAYER) l.layers.set(HIDDEN_LAMP_LAYER);
      if (l.parent === null || !l.visible || !(l.intensity > 0) || l.userData['cut'] === true) continue;
      if (shown(l)) live.push(l);
    }
    // A slot keeps its lamp while that lamp is lit (no change of slot, so nothing about the program changes either).
    for (let i = 0; i < this.owners.length; i++) {
      const o = this.owners[i];
      if (o && !live.includes(o)) this.owners[i] = null;
    }
    for (let k = 0; k < live.length; k++) {
      const l = live[k] as RoomLamp;
      if (this.owners.includes(l)) continue;
      let free = this.owners.indexOf(null);
      if (free < 0) {
        free = this.slots.length;
        this.slots.push(this.makeSlot());
        this.owners.push(null);
        grew = true;
      }
      this.owners[free] = l;
    }
    // Spares go on top of the slots the lamps shown now take, once each.
    for (; this.spared < spares; this.spared++) {
      this.slots.push(this.makeSlot());
      this.owners.push(null);
      grew = true;
    }
    for (let i = 0; i < this.slots.length; i++) this.copy(this.slots[i] as RoomLamp, this.owners[i] ?? null);
    live.length = 0;
    return grew;
  }

  /** Drop every slot (a new world: its lamps start a new pool). Returns true when there were any. */
  clear(): boolean {
    const had = this.slots.length > 0;
    for (const s of this.slots) {
      s.removeFromParent();
      s.dispose();
    }
    this.slots.length = 0;
    this.owners.length = 0;
    this.spared = 0;
    return had;
  }

  dispose(): void {
    this.clear();
    this.group.removeFromParent();
  }

  private makeSlot(): RoomLamp {
    const s = new RoomLamp(0xffffff, 0, 0, 2);
    s.name = 'aether:lamp-slot';
    s.castShadow = false;
    s.matrixAutoUpdate = false;
    this.group.add(s);
    return s;
  }

  private copy(slot: RoomLamp, lamp: RoomLamp | null): void {
    if (!lamp) {
      slot.intensity = 0;
      return;
    }
    slot.color.copy(lamp.color);
    slot.intensity = lamp.intensity;
    slot.distance = lamp.distance;
    slot.decay = lamp.decay;
    lamp.updateWorldMatrix(true, false);
    const e = lamp.matrixWorld.elements;
    slot.position.set(e[12] as number, e[13] as number, e[14] as number);
    slot.updateMatrix();
    slot.matrixWorldNeedsUpdate = true;
    if (!slot.clip.equals(lamp.clip)) slot.clip.copy(lamp.clip);
    if (!samePortals(slot.portals, lamp.portals)) slot.setPortals(lamp.portals);
  }
}
