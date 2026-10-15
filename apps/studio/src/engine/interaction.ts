/**
 * Use what you aim at, in play mode: a crosshair ray from the eye finds the
 * entity under it; if it carries `interact` (a drawer, a cabinet or fridge door,
 * a tap, a window, a prop to pick up) the HUD shows "E · Open drawer" and E acts:
 *
 * - drawers, doors, windows, appliances: `logic.use(id)` (an `operable` behavior
 *   slides or swings it, or drives its physics joint);
 * - taps and switches: `logic.use(id)` (a `toggle` behavior);
 * - props (`pickup`, dynamic bodies): E carries the prop in front of you (it
 *   follows the aim point and is stopped by walls), E again drops it and a click
 *   throws it with the aim direction.
 *
 * The decisions are pure functions (unit-tested); the controller only reads the
 * physics world, applies velocities and reports the prompt.
 */
import type { Entity, EntityId, InteractSpec, Vec3, WorldDoc } from '@aether/core';

/** Default reach of a use (metres from the eye). */
export const DEFAULT_REACH = 2.4;
/** Distance in front of the eye at which a carried prop is held. */
export const HOLD_DISTANCE = 1.15;
/** Throw speed (m/s) along the aim direction. */
export const THROW_SPEED = 8.5;
/** Fastest a carried prop is pulled toward the hold point (m/s). */
export const CARRY_MAX_SPEED = 9;
/** A usable entity this close behind the first thing the ray hits still counts (a drawer front sits inside its cabinet's collider). */
export const HIT_TOLERANCE = 0.14;
/** The ray starts this far ahead of the eye (the player's own capsule is filtered out by the session). */
export const RAY_START = 0.05;

/** Seat surface height (metres above the floor) by furniture kind; kinds without an entry cannot be sat on. */
export const SEAT_HEIGHT: Readonly<Record<string, number>> = Object.freeze({ sofa: 0.42, armchair: 0.42, chair: 0.45, 'office-chair': 0.46, 'bar-stool': 0.65, bench: 0.45 });
/** Eye height above the seat surface while sitting (metres). */
export const SEATED_EYE = 0.72;

/** Where a player sits on a piece and where they stand up to. */
export interface SeatPose {
  /** Feet position (the seat surface). */
  feet: Vec3;
  /** Camera / body yaw in degrees (0 faces −Z): facing out of the front of the piece. */
  yawDeg: number;
  /** Where standing up puts the feet: in front of the piece, on the floor. */
  stand: Vec3;
  /** Eye height above the feet while seated. */
  eye: number;
}

/**
 * Seat pose on a piece at `piece` (its floor point) turned `yawDeg` (the
 * front, local +Z, faces world (sin yaw, cos yaw)). Sofas seat the player
 * where they approached (clamped to the cushions of a `width` m piece); other
 * seats are centred. Null for kinds that are not seats.
 */
export function seatPose(kind: string, piece: Readonly<Vec3>, yawDeg: number, player: Readonly<Vec3>, width = 1): SeatPose | null {
  const h = SEAT_HEIGHT[kind];
  if (h === undefined || !Number.isFinite(yawDeg + piece[0] + piece[1] + piece[2])) return null;
  const t = (yawDeg * Math.PI) / 180;
  const fx = Math.sin(t);
  const fz = Math.cos(t);
  // Local +X in the world: front rotated by −90°.
  const rx = Math.cos(t);
  const rz = -Math.sin(t);
  let lateral = 0;
  if (kind === 'sofa' || kind === 'bench') {
    const reach = Math.max(0, Math.min(1.4, width / 2 - 0.4));
    lateral = Math.max(-reach, Math.min(reach, (player[0] - piece[0]) * rx + (player[2] - piece[2]) * rz));
  }
  const forward = kind === 'sofa' ? 0.06 : 0.02;
  const x = piece[0] + rx * lateral + fx * forward;
  const z = piece[2] + rz * lateral + fz * forward;
  const out = 0.85;
  return { feet: [x, piece[1] + h, z], yawDeg: yawDeg + 180, stand: [x + fx * out, piece[1] + 0.02, z + fz * out], eye: SEATED_EYE };
}

/** What the HUD shows for the aimed entity. */
export interface InteractPrompt {
  id: EntityId;
  /** Key to press ("E"). */
  key: string;
  /** "Open", "Close", "Turn on", "Pick up", "Drop". */
  verb: string;
  /** What it acts on ("drawer", "fridge door"). */
  noun: string;
  /** Ready-made line: "E · Open drawer". */
  text: string;
  /** A second action line while carrying ("Click · Throw"), else null. */
  hint: string | null;
}

/** The entity (or its parent) carrying `interact` that a ray hit resolves to. */
export function usableEntity(world: WorldDoc, hitId: EntityId | null): Entity | null {
  if (hitId === null) return null;
  const e = world.entities[hitId];
  if (!e) return null;
  if (e.interact) return e;
  const parent = e.parent !== null ? world.entities[e.parent] : undefined;
  return parent?.interact ? parent : null;
}

/** Verb and noun for an interactable in its current state. */
export function describeInteraction(spec: InteractSpec, name: string, state: Readonly<Record<string, unknown>>, carried: boolean): { verb: string; noun: string } {
  const noun = (spec.label ?? name ?? spec.kind).toLowerCase();
  switch (spec.kind) {
    case 'pickup':
      return { verb: carried ? 'Drop' : 'Pick up', noun };
    case 'tap':
    case 'switch':
      return { verb: state['on'] === true ? 'Turn off' : 'Turn on', noun };
    case 'seat':
      return { verb: 'Sit on', noun };
    default:
      return { verb: state['open'] === true ? 'Close' : 'Open', noun };
  }
}

/** The prompt for an aimed entity (null when it is out of reach). */
export function promptFor(entity: Entity, state: Readonly<Record<string, unknown>>, distance: number, carried: boolean): InteractPrompt | null {
  const spec = entity.interact;
  if (!spec) return null;
  if (distance > (spec.reach ?? DEFAULT_REACH)) return null;
  const { verb, noun } = describeInteraction(spec, entity.name, state, carried);
  return { id: entity.id, key: 'E', verb, noun, text: `E · ${verb} ${noun}`, hint: carried ? 'Click · Throw' : null };
}

/**
 * Where a carried prop is held: `HOLD_DISTANCE` ahead of the eye along `dir`,
 * pulled back when a wall (`wallDistance` along the ray) is closer so props
 * never go through geometry, and never below `floorY + 0.15`.
 */
export function holdPoint(eye: Readonly<Vec3>, dir: Readonly<Vec3>, wallDistance: number | null, floorY: number): Vec3 {
  const reach = wallDistance === null ? HOLD_DISTANCE : Math.max(0.5, Math.min(HOLD_DISTANCE, wallDistance - 0.25));
  const y = Math.max(floorY + 0.15, eye[1] + dir[1] * reach - 0.15);
  return [eye[0] + dir[0] * reach, y, eye[2] + dir[2] * reach];
}

/** Velocity that moves a carried prop from `pos` toward `target` within one frame, capped. */
export function carryVelocity(pos: Readonly<Vec3>, target: Readonly<Vec3>, gain = 14): Vec3 {
  const vx = (target[0] - pos[0]) * gain;
  const vy = (target[1] - pos[1]) * gain;
  const vz = (target[2] - pos[2]) * gain;
  const len = Math.hypot(vx, vy, vz);
  if (len <= CARRY_MAX_SPEED || len === 0) return [vx, vy, vz];
  const k = CARRY_MAX_SPEED / len;
  return [vx * k, vy * k, vz * k];
}

/** Velocity of a thrown prop: the aim direction at {@link THROW_SPEED}, a little lift, plus the player's own motion. */
export function throwVelocity(dir: Readonly<Vec3>, playerVelocity: Readonly<Vec3> = [0, 0, 0]): Vec3 {
  const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  return [(dir[0] / len) * THROW_SPEED + playerVelocity[0], (dir[1] / len) * THROW_SPEED + 1.2 + playerVelocity[1], (dir[2] / len) * THROW_SPEED + playerVelocity[2]];
}

/** What the controller needs from the running session (kept narrow so tests can fake it). */
export interface InteractionSession {
  readonly world: WorldDoc;
  raycastAll(origin: Vec3, dir: Vec3, maxDist: number, exclude?: EntityId): Array<{ id: EntityId | null; distance: number; point: Vec3 }>;
  position(id: EntityId): Vec3 | null;
  setVelocity(id: EntityId, v: Vec3): void;
  setAngularVelocity(id: EntityId, v: Vec3): void;
  isDynamic(id: EntityId): boolean;
  entityState(id: EntityId): Readonly<Record<string, unknown>>;
  use(id: EntityId): void;
  /** Sit on a seat entity (false when it cannot be sat on). */
  sit(id: EntityId): boolean;
  /** The player is sitting. */
  isSitting(): boolean;
  /** Stand up in front of the seat. */
  stand(): void;
}

/** View of the camera and the player. */
export interface AimSource {
  /** Eye position and unit aim direction, or null when unknown. */
  aim(): { eye: Vec3; dir: Vec3 } | null;
  playerVelocity(): Vec3;
  floorY(): number;
}

/** Callbacks of the controller. */
export interface InteractionEvents {
  prompt(p: InteractPrompt | null): void;
  sound(name: string): void;
  toast(text: string): void;
}

/** The aim-and-use controller of one play session. */
export class PlayInteraction {
  private carried: EntityId | null = null;
  private last: string | null = null;
  private disposed = false;

  constructor(
    private readonly session: InteractionSession,
    private readonly aim: AimSource,
    private readonly events: InteractionEvents,
  ) {}

  /** The prop being carried, if any. */
  get carrying(): EntityId | null {
    return this.carried;
  }

  /** Look at what the crosshair is on (call once per frame): updates the prompt and moves a carried prop. */
  frame(): void {
    if (this.disposed) return;
    if (this.session.isSitting()) return this.report({ id: 'seat', key: 'E', verb: 'Stand up', noun: '', text: 'E · Stand up', hint: null });
    const a = this.aim.aim();
    if (!a) return this.report(null);
    if (this.carried !== null) {
      this.moveCarried(a);
      const e = this.session.world.entities[this.carried];
      return this.report(e ? promptFor(e, this.session.entityState(e.id), 0, true) : null);
    }
    const { target, distance } = this.cast(a);
    this.report(target ? promptFor(target, this.session.entityState(target.id), distance, false) : null);
  }

  /** The use key was pressed. Returns true when it acted (the key must not also reach the game). */
  use(): boolean {
    if (this.disposed) return false;
    if (this.session.isSitting()) {
      this.session.stand();
      return true;
    }
    if (this.carried !== null) {
      this.drop();
      return true;
    }
    const a = this.aim.aim();
    if (!a) return false;
    const { target, distance } = this.cast(a);
    if (!target || !promptFor(target, this.session.entityState(target.id), distance, false)) return false;
    if (target.interact?.kind === 'pickup') {
      if (!this.session.isDynamic(target.id)) {
        this.events.toast('Too heavy to lift');
        return true;
      }
      this.carried = target.id;
      this.events.sound('pickup');
      return true;
    }
    if (target.interact?.kind === 'seat') {
      if (!this.session.sit(target.id)) this.events.toast('Nowhere to sit there');
      return true;
    }
    this.session.use(target.id);
    return true;
  }

  /** A click while carrying throws the prop. Returns true when it did. */
  throwCarried(): boolean {
    if (this.disposed || this.carried === null) return false;
    const a = this.aim.aim();
    const id = this.carried;
    this.carried = null;
    if (a) {
      this.session.setVelocity(id, throwVelocity(a.dir, this.aim.playerVelocity()));
      this.session.setAngularVelocity(id, [(a.dir[2] ?? 0) * 6, 2, -(a.dir[0] ?? 0) * 6]);
      this.events.sound('whoosh');
    }
    return true;
  }

  /** Let go of the carried prop. */
  drop(): void {
    if (this.carried === null) return;
    this.session.setVelocity(this.carried, [0, 0, 0]);
    this.carried = null;
  }

  dispose(): void {
    this.disposed = true;
    this.carried = null;
    this.report(null);
  }

  /**
   * What the crosshair is on: the nearest solid hit (distance from the eye, for
   * walls) and the usable entity at or just behind it, if any.
   */
  private cast(a: { eye: Vec3; dir: Vec3 }): { wall: number | null; target: Entity | null; distance: number } {
    const origin: Vec3 = [a.eye[0] + a.dir[0] * RAY_START, a.eye[1] + a.dir[1] * RAY_START, a.eye[2] + a.dir[2] * RAY_START];
    const hits = this.session.raycastAll(origin, a.dir, 4, this.carried ?? undefined);
    const first = hits[0];
    if (!first) return { wall: null, target: null, distance: 0 };
    for (const h of hits) {
      if (h.distance > first.distance + HIT_TOLERANCE) break;
      const target = usableEntity(this.session.world, h.id);
      if (target) return { wall: first.distance + RAY_START, target, distance: h.distance + RAY_START };
    }
    return { wall: first.distance + RAY_START, target: null, distance: first.distance + RAY_START };
  }

  private moveCarried(a: { eye: Vec3; dir: Vec3 }): void {
    const id = this.carried;
    if (id === null) return;
    const pos = this.session.position(id);
    if (!pos) {
      this.carried = null;
      return;
    }
    const target = holdPoint(a.eye, a.dir, this.cast(a).wall, this.aim.floorY());
    // Too far from the hand (the player walked away or the prop snagged): let go.
    if (Math.hypot(pos[0] - target[0], pos[1] - target[1], pos[2] - target[2]) > 3.5) {
      this.drop();
      return;
    }
    this.session.setVelocity(id, carryVelocity(pos, target));
    this.session.setAngularVelocity(id, [0, 0, 0]);
  }

  private report(p: InteractPrompt | null): void {
    const key = p ? `${p.id}|${p.text}|${p.hint ?? ''}` : null;
    if (key === this.last) return;
    this.last = key;
    this.events.prompt(p);
  }
}
