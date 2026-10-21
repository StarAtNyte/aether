/**
 * Kinematic capsule character built on Rapier's KinematicCharacterController:
 * slides along walls, climbs steps (autostep), snaps to the ground on the
 * way down, refuses slopes steeper than `maxSlopeDeg`, and integrates gravity
 * and jumps itself. `position` is the FEET point (bottom of the capsule), which
 * is where avatars are anchored.
 */
import type { Collider, KinematicCharacterController, RigidBody, World } from '@dimforge/rapier3d-compat';
import type { EntityId, Vec3 } from '@aether/core';
import { rapier } from './rapier';
import { isFiniteVec } from './vec';
import type { PhysicsWorld } from './world';

/** Construction options of {@link CharacterController}. */
export interface CharacterOptions {
  /** Capsule radius in meters (clamped to [0.05, 5]). */
  radius: number;
  /** Total capsule height in meters (at least 2 × radius). */
  height: number;
  /** Initial feet position. */
  spawn: Vec3;
  /** Entity id reported in physics events (default "player"). */
  id?: EntityId;
  /** Steepest walkable slope in degrees (default 50). */
  maxSlopeDeg?: number;
  /** Highest step climbed automatically in meters (default 0.35). */
  stepHeight?: number;
  /**
   * Stand the spawn point on the floor under it when it hangs up to 1.5 m above (the live game sets this so play does not open with a
   * visible drop; headless runs keep the exact document spawn so recorded proofs replay unchanged). Default false.
   */
  settleSpawn?: boolean;
  /** Ground snapping distance in meters (default 0.3). */
  snapDistance?: number;
  /**
   * Game feel for human play (see {@link CHARACTER_FEEL}): acceleration and deceleration, air control,
   * coyote time, jump buffering and a shorter hop when jump is released early. Absent (the default, and
   * what the playtest bot and the proof replays use): the character takes the input velocity instantly.
   */
  feel?: CharacterFeel;
}

/** Tunable feel of a human-played character. */
export interface CharacterFeel {
  /** Horizontal acceleration toward the input direction, m/s² on the ground. */
  acceleration: number;
  /** Deceleration with no input, m/s² on the ground. */
  deceleration: number;
  /** Share of the acceleration and deceleration available in the air (0 locks the jump's heading, 1 is full control). */
  airControl: number;
  /** Seconds after walking off a ledge in which a jump still works. */
  coyoteTime: number;
  /** Seconds a jump pressed just before landing is remembered. */
  jumpBuffer: number;
  /** Upward speed kept when jump is released while rising (0..1); 1 disables the shorter hop. */
  jumpCut: number;
}

/**
 * The feel the studio gives the player: quick to reach full speed (about 0.12 s), a firm stop, mostly
 * free control in the air, a forgiving ledge and a buffered jump.
 */
export const CHARACTER_FEEL: Readonly<CharacterFeel> = Object.freeze({ acceleration: 48, deceleration: 60, airControl: 0.55, coyoteTime: 0.11, jumpBuffer: 0.12, jumpCut: 0.55 });

/** Per-frame movement input (forward/right in [-1, 1], yaw of the camera in degrees). */
export interface CharacterInput {
  forward: number;
  right: number;
  jump: boolean;
  yawDeg: number;
}

const SKIN = 0.02;
const MAX_FALL_SPEED = 50;
const MAX_DT = 0.1;
interface Vec3Like {
  x: number;
  y: number;
  z: number;
}
/** Spawn settling: the probe starts this far above the spawn point, and a drop up to this far is snapped to the floor (m). */
const SPAWN_PROBE_UP = 0.3;
const SPAWN_SNAP_MAX = 1.5;
/**
 * Rapier's character controller reports a contact with a kinematic body (a resting deck or lift floor) again and again at time of
 * impact 0 when the capsule slides along it, until its iteration cap: a walk across it stalls after a few centimetres and the
 * platform's own motion is not applied either; the same box as a fixed body slides normally. Such a move is redone in two phases:
 * sideways with this small upward bias (which keeps the cast out of the contact), then the remaining vertical motion alone. Fixed
 * ground never takes this path.
 */
const KINEMATIC_SLIDE_LIFT = 0.001;
/** Ground steeper than this (normal's up component) is not a floor. */
const MIN_GROUND_NORMAL_Y = 0.5;
/** Collisions in one controller move from which it is judged to be looping on a contact. */
const LOOPING_COLLISIONS = 8;

function clampUnit(v: number): number {
  return Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
}

/** Player capsule controller. Call {@link move} once per fixed step, then step the world. */
export class CharacterController {
  private readonly pw: PhysicsWorld;
  private readonly world: World;
  private readonly body: RigidBody;
  private readonly collider: Collider;
  private readonly controller: KinematicCharacterController;
  private readonly halfTotal: number;
  private readonly pos: Vec3;
  private vy = 0;
  private vx = 0;
  private vz = 0;
  private onGround = false;
  private disposed = false;
  private readonly feel: CharacterFeel | null;
  private sinceGround = 0;
  private jumpWanted = 0;
  private jumpHeld = false;

  constructor(pw: PhysicsWorld, opts: CharacterOptions) {
    const R = rapier();
    this.pw = pw;
    this.world = pw._world();
    const radius = Number.isFinite(opts.radius) ? Math.min(5, Math.max(0.05, opts.radius)) : 0.35;
    const height = Number.isFinite(opts.height) ? Math.max(opts.height, radius * 2 + 0.01) : 1.8;
    this.halfTotal = height / 2;
    this.feel = opts.feel ? { ...opts.feel } : null;
    const spawn: Vec3 = isFiniteVec(opts.spawn) ? [opts.spawn[0], opts.spawn[1], opts.spawn[2]] : [0, 1, 0];
    // A spawn point a little above the floor would open the game with a visible drop, and the airborne pose throws the arms out
    // sideways (a T-pose from the chase camera, long on a slow frame rate). Stand on the floor instead; a deliberate higher drop is kept.
    const down = opts.settleSpawn !== true ? null : pw.raycast([spawn[0], spawn[1] + SPAWN_PROBE_UP, spawn[2]], [0, -1, 0], SPAWN_PROBE_UP + SPAWN_SNAP_MAX);
    if (down && down.point[1] <= spawn[1] + SKIN && spawn[1] - down.point[1] <= SPAWN_SNAP_MAX) spawn[1] = down.point[1] + SKIN;
    this.pos = spawn;
    this.body = this.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn[0], spawn[1], spawn[2]));
    this.collider = this.world.createCollider(
      R.ColliderDesc.capsule(this.halfTotal - radius, radius)
        .setTranslation(0, this.halfTotal, 0)
        .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS)
        .setActiveCollisionTypes(1 | 2 | 12 | 8704 | 52224),
      this.body,
    );
    this.controller = this.world.createCharacterController(SKIN);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.setSlideEnabled(true);
    this.controller.setMaxSlopeClimbAngle(((opts.maxSlopeDeg ?? 50) * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle(((Math.min(opts.maxSlopeDeg ?? 50, 45) - 5) * Math.PI) / 180);
    if (process.env.NOSTEP !== '1') this.controller.enableAutostep(opts.stepHeight ?? 0.35, Math.max(0.05, radius * 0.5), false);
    if (process.env.NOSNAP !== '1') this.controller.enableSnapToGround(opts.snapDistance ?? 0.3);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    pw._registerExternal(this.collider, opts.id ?? 'player');
  }

  /** Current feet position (copy). */
  get position(): Vec3 {
    return [this.pos[0], this.pos[1], this.pos[2]];
  }

  /** True when the last move ended on walkable ground. */
  get grounded(): boolean {
    return this.onGround;
  }

  /** Current vertical speed (m/s). */
  get verticalSpeed(): number {
    return this.vy;
  }

  /**
   * Move for one frame. `yawDeg` 0 faces −Z (three.js camera convention).
   * Returns the new feet position. Non-finite inputs are treated as zero.
   */
  move(input: CharacterInput, dt: number, speed: number, jumpSpeed: number): Vec3 {
    if (this.disposed || this.pw.isDisposed) return this.position;
    const R = rapier();
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, MAX_DT) : 0;
    const yaw = Number.isFinite(input.yawDeg) ? (input.yawDeg * Math.PI) / 180 : 0;
    const f = clampUnit(input.forward);
    const r = clampUnit(input.right);
    let mx = -Math.sin(yaw) * f + Math.cos(yaw) * r;
    let mz = -Math.cos(yaw) * f - Math.sin(yaw) * r;
    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }
    const v = Number.isFinite(speed) ? Math.max(0, speed) : 0;
    const gy = this.world.gravity.y;
    if (this.onGround && this.vy < 0) this.vy = 0;
    const canJump = Number.isFinite(jumpSpeed) && jumpSpeed > 0;
    const fl = this.feel;
    if (fl === null) {
      if (input.jump && this.onGround && canJump) {
        this.vy = jumpSpeed;
        this.onGround = false;
      }
      this.vx = mx * v;
      this.vz = mz * v;
    } else {
      // Coyote time and a buffered jump: the press is remembered, the ledge forgives.
      this.sinceGround = this.onGround ? 0 : this.sinceGround + step;
      if (input.jump && !this.jumpHeld) this.jumpWanted = fl.jumpBuffer;
      else this.jumpWanted = Math.max(0, this.jumpWanted - step);
      if (this.jumpWanted > 0 && canJump && (this.onGround || this.sinceGround < fl.coyoteTime) && this.vy <= 0.01) {
        this.vy = jumpSpeed;
        this.onGround = false;
        this.sinceGround = fl.coyoteTime;
        this.jumpWanted = 0;
      }
      // Releasing jump while rising cuts the hop short (a tap is a small jump, a hold the full one).
      if (this.jumpHeld && !input.jump && this.vy > 0) this.vy *= fl.jumpCut;
      this.jumpHeld = input.jump;
      // Horizontal velocity eases toward the input direction.
      const grip = this.onGround ? 1 : fl.airControl;
      const tx = mx * v;
      const tz = mz * v;
      const moving = Math.hypot(tx, tz) > 1e-6;
      const rate = (moving ? fl.acceleration : fl.deceleration) * grip * step;
      const dx = tx - this.vx;
      const dz = tz - this.vz;
      const d = Math.hypot(dx, dz);
      if (d <= rate || d < 1e-9) {
        this.vx = tx;
        this.vz = tz;
      } else {
        this.vx += (dx / d) * rate;
        this.vz += (dz / d) * rate;
      }
    }
    this.vy = Math.max(-MAX_FALL_SPEED, this.vy + gy * step);
    const desired = { x: this.vx * step, y: this.vy * step, z: this.vz * step };
    // Keep the collider where we believe the character is (several moves may happen between world steps).
    this.collider.setTranslation({ x: this.pos[0], y: this.pos[1] + this.halfTotal, z: this.pos[2] });
    this.controller.computeColliderMovement(this.collider, desired, R.QueryFilterFlags.EXCLUDE_SENSORS);
    let m: Vec3Like = this.controller.computedMovement();
    this.onGround = this.controller.computedGrounded();
    if (this.vy <= 0 && this.loopingOnKinematicFloor(desired, m)) {
      const retry = this.slideOnKinematic(desired);
      if (retry.grounded || !this.onGround) {
        m = retry.m;
        this.onGround = retry.grounded;
      }
    }
    if (this.onGround && this.vy < 0) this.vy = 0;
    if (this.vy > 0 && m.y < desired.y - 1e-4) this.vy = 0; // bumped a ceiling
    // A wall that stopped the character takes its speed along that axis too.
    if (this.feel !== null && step > 0) {
      if (Math.abs(m.x) < Math.abs(desired.x) * 0.5) this.vx *= 0.3;
      if (Math.abs(m.z) < Math.abs(desired.z) * 0.5) this.vz *= 0.3;
    }
    this.pos[0] += m.x;
    this.pos[1] += m.y;
    this.pos[2] += m.z;
    this.body.setNextKinematicTranslation({ x: this.pos[0], y: this.pos[1], z: this.pos[2] });
    return this.position;
  }

  /** True when the controller looped on a contact with the upward face of a kinematic body and lost the walk (see {@link KINEMATIC_SLIDE_LIFT}). */
  private loopingOnKinematicFloor(desired: Vec3Like, m: Vec3Like): boolean {
    const n = this.controller.numComputedCollisions();
    if (n === 0) return false;
    let kinematicFloor = false;
    for (let i = 0; i < n && !kinematicFloor; i++) {
      const c = this.controller.computedCollision(i);
      kinematicFloor = c !== null && c.collider !== null && c.normal1.y > MIN_GROUND_NORMAL_Y && c.collider.parent()?.isKinematic() === true;
    }
    if (!kinematicFloor) return false;
    if (n >= LOOPING_COLLISIONS) return true;
    const want = Math.hypot(desired.x, desired.z);
    return want > 1e-5 && (m.x * desired.x + m.z * desired.z) / want < want * 0.5;
  }

  /** The two-phase move used over kinematic floors. */
  private slideOnKinematic(desired: Vec3Like): { m: Vec3Like; grounded: boolean } {
    const flags = rapier().QueryFilterFlags.EXCLUDE_SENSORS;
    this.controller.computeColliderMovement(this.collider, { x: desired.x, y: KINEMATIC_SLIDE_LIFT, z: desired.z }, flags);
    const side = this.controller.computedMovement();
    const sx = side.x;
    const sy = side.y;
    const sz = side.z;
    this.collider.setTranslation({ x: this.pos[0] + sx, y: this.pos[1] + sy + this.halfTotal, z: this.pos[2] + sz });
    this.controller.computeColliderMovement(this.collider, { x: 0, y: desired.y - sy, z: 0 }, flags);
    const down = this.controller.computedMovement();
    const grounded = this.controller.computedGrounded();
    this.collider.setTranslation({ x: this.pos[0], y: this.pos[1] + this.halfTotal, z: this.pos[2] });
    return { m: { x: sx + down.x, y: sy + down.y, z: sz + down.z }, grounded };
  }

  /** Move instantly and reset vertical speed. */
  teleport(p: Vec3): void {
    if (this.disposed || this.pw.isDisposed || !isFiniteVec(p)) return;
    this.pos[0] = p[0];
    this.pos[1] = p[1];
    this.pos[2] = p[2];
    this.vy = 0;
    this.vx = 0;
    this.vz = 0;
    this.sinceGround = 0;
    this.jumpWanted = 0;
    this.onGround = false;
    this.body.setTranslation({ x: p[0], y: p[1], z: p[2] }, true);
    this.body.setNextKinematicTranslation({ x: p[0], y: p[1], z: p[2] });
    this.collider.setTranslation({ x: p[0], y: p[1] + this.halfTotal, z: p[2] });
  }

  /**
   * Switch the capsule's collisions on or off (sitting in a sofa: the capsule
   * would otherwise overlap it). A disabled character is moved only by
   * {@link teleport}.
   */
  setEnabled(on: boolean): void {
    if (this.disposed || this.pw.isDisposed) return;
    this.collider.setEnabled(on);
  }

  /** Remove the capsule and controller from the world. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.pw.isDisposed) return;
    this.pw._unregisterExternal(this.collider);
    this.world.removeCharacterController(this.controller);
    this.world.removeRigidBody(this.body);
  }
}
