/**
 * Slots for the scene's shadowless point lamps, so the set of lights every lit material is built for stays the same
 * while a world plays.
 *
 * The node renderer keys each object's shading program on the exact lights in the scene (their ids and kinds). A light
 * that appears (a medkit with its red glow dropped by a raider), disappears (a pickup collected) or is switched off made
 * every lit object prepare again: on an integrated GPU that takes seconds, and the frames shown meanwhile lacked the
 * ground, the cliffs and every other lit surface, so the view showed the flat haze below the horizon in their place.
 *
 * The entity lamps keep their place and their meaning (the light volume, room exposure and the bake read them as before)
 * but move to {@link HIDDEN_LAMP_LAYER}, which no camera draws. One {@link LampSet} light, the one the renderer actually
 * shades with, holds a slot for each and draws the lit ones in a loop (`gpu/lamp-set-node.ts`): their colour,
 * intensity, range, world position, room clip and apertures are read each frame. The set holds a slot for every lamp
 * shown, plus a spare for each lamp of the world's templates (whose copies a game spawns), and only grows, so the light
 * set changes when more lamps are shown at once than ever before, not each time one comes, goes or switches off. Lamps
 * the forward budget cut (`userData.cut`) or switched off by hiding the light itself take no slot. A lamp turned down to
 * zero (an architectural lamp in daylight) keeps its slot, so the slots a world needs at night are there from the first
 * frame, whatever the hour it loads at.
 */
import { Group, Light, type Object3D } from 'three';
import { RoomLamp } from './room-lamp';

/** Layer of the entity lamps that the slots stand in for: no camera enables it, so the renderer does not shade with them. */
export const HIDDEN_LAMP_LAYER = 30;

/** Whether `l` is drawn through a slot: a point lamp without a shadow map (a shadow is owned by its own light). */
export function slottable(l: Light): l is RoomLamp {
  return l instanceof RoomLamp && !l.castShadow;
}

/**
 * The light the renderer shades the slotted lamps with: one loop over {@link lit} (`LampSetNode`). Its program depends
 * on {@link capacity} only, not on how many lamps are lit or which.
 */
export class LampSet extends Light {
  readonly isLampSet = true;
  /** Lamps lit or at zero this frame, at most {@link capacity}; the node shades those with intensity. */
  readonly lit: RoomLamp[] = [];

  readonly capacity: number;

  constructor(capacity = 1) {
    super(0xffffff, 1);
    this.capacity = capacity;
    this.name = 'aether:lamp-set';
    this.castShadow = false;
    this.matrixAutoUpdate = false;
  }
}

/** Visible all the way up to the root (a lamp under a hidden entity gives no light). */
function shown(o: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

/** The slot pool. Add {@link group} to the scene and call {@link sync} before each draw. */
export class LampSlots {
  readonly group = new Group();
  private set: LampSet | null = null;
  /** Spare slots added so far for {@link sync}'s `spares`. */
  private spared = 0;

  constructor() {
    this.group.name = 'aether:lamp-slots';
  }

  /** Number of slots (lamps the shading programs are built for). */
  get size(): number {
    return this.set?.capacity ?? 0;
  }

  /** The light the slots are drawn with (null before any lamp). */
  get light(): LampSet | null {
    return this.set;
  }

  /** Lamp in slot `i` this frame (tests and diagnostics). */
  owner(i: number): RoomLamp | null {
    return this.set?.lit[i] ?? null;
  }

  /**
   * Bring the slots up to date with `lamps` (every entity light; the shadowless point lamps among them are moved to
   * {@link HIDDEN_LAMP_LAYER} and drawn through a slot, the others are left as they are). `spares`: lamps that may
   * appear later (the shadowless point lamps of the world's templates, whose copies a game spawns); that many slots are
   * added once on top of those the lamps shown take, so the first copies take them without changing the light set.
   * Returns true when the pool grew.
   */
  sync(lamps: readonly Light[], spares = 0): boolean {
    const lit: RoomLamp[] = this.set?.lit ?? [];
    lit.length = 0;
    for (let k = 0; k < lamps.length; k++) {
      const l = lamps[k];
      if (!(l instanceof RoomLamp)) continue;
      if (l.castShadow) {
        // A lamp that casts a shadow draws itself.
        if (l.layers.mask === 1 << HIDDEN_LAMP_LAYER) l.layers.set(0);
        continue;
      }
      if (l.layers.mask !== 1 << HIDDEN_LAMP_LAYER) l.layers.set(HIDDEN_LAMP_LAYER);
      if (l.parent === null || !l.visible || l.userData['cut'] === true) continue;
      if (shown(l)) lit.push(l);
    }
    // A slot for every lamp shown, and the spares once on top of those.
    let want = Math.max(this.size, lit.length);
    if (spares > this.spared) {
      want += spares - this.spared;
      this.spared = spares;
    }
    if (want <= this.size) {
      if (this.set && lit.length > this.set.capacity) lit.length = this.set.capacity;
      return false;
    }
    // More lamps than ever: a larger set (a new light, so one change of every lit program).
    const next = new LampSet(want);
    next.lit.push(...lit);
    this.set?.removeFromParent();
    this.set?.dispose();
    this.set = next;
    this.group.add(next);
    return true;
  }

  /** Drop the set (a new world: its lamps start a new pool). Returns true when there was one. */
  clear(): boolean {
    const had = this.set !== null;
    this.set?.removeFromParent();
    this.set?.dispose();
    this.set = null;
    this.spared = 0;
    return had;
  }

  dispose(): void {
    this.clear();
    this.group.removeFromParent();
  }
}
