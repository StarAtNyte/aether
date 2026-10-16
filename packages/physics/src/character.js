import { rapier } from './rapier';
import { isFiniteVec } from './vec';
/**
 * The feel the studio gives the player: quick to reach full speed (about 0.12 s), a firm stop, mostly
 * free control in the air, a forgiving ledge and a buffered jump.
 */
export const CHARACTER_FEEL = Object.freeze({ acceleration: 48, deceleration: 60, airControl: 0.55, coyoteTime: 0.11, jumpBuffer: 0.12, jumpCut: 0.55 });
const SKIN = 0.02;
const MAX_FALL_SPEED = 50;
const MAX_DT = 0.1;
function clampUnit(v) {
    return Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
}
/** Player capsule controller. Call {@link move} once per fixed step, then step the world. */
export class CharacterController {
    pw;
    world;
    body;
    collider;
    controller;
    halfTotal;
    pos;
    vy = 0;
    vx = 0;
    vz = 0;
    onGround = false;
    disposed = false;
    feel;
    sinceGround = 0;
    jumpWanted = 0;
    jumpHeld = false;
    constructor(pw, opts) {
        const R = rapier();
        this.pw = pw;
        this.world = pw._world();
        const radius = Number.isFinite(opts.radius) ? Math.min(5, Math.max(0.05, opts.radius)) : 0.35;
        const height = Number.isFinite(opts.height) ? Math.max(opts.height, radius * 2 + 0.01) : 1.8;
        this.halfTotal = height / 2;
        this.feel = opts.feel ? { ...opts.feel } : null;
        const spawn = isFiniteVec(opts.spawn) ? [opts.spawn[0], opts.spawn[1], opts.spawn[2]] : [0, 1, 0];
        this.pos = spawn;
        this.body = this.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn[0], spawn[1], spawn[2]));
        this.collider = this.world.createCollider(R.ColliderDesc.capsule(this.halfTotal - radius, radius)
            .setTranslation(0, this.halfTotal, 0)
            .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS)
            .setActiveCollisionTypes(1 | 2 | 12 | 8704 | 52224), this.body);
        this.controller = this.world.createCharacterController(SKIN);
        this.controller.setUp({ x: 0, y: 1, z: 0 });
        this.controller.setSlideEnabled(true);
        this.controller.setMaxSlopeClimbAngle(((opts.maxSlopeDeg ?? 50) * Math.PI) / 180);
        this.controller.setMinSlopeSlideAngle(((Math.min(opts.maxSlopeDeg ?? 50, 45) - 5) * Math.PI) / 180);
        this.controller.enableAutostep(opts.stepHeight ?? 0.35, Math.max(0.05, radius * 0.5), false);
        this.controller.enableSnapToGround(opts.snapDistance ?? 0.3);
        this.controller.setApplyImpulsesToDynamicBodies(true);
        pw._registerExternal(this.collider, opts.id ?? 'player');
    }
    /** Current feet position (copy). */
    get position() {
        return [this.pos[0], this.pos[1], this.pos[2]];
    }
    /** True when the last move ended on walkable ground. */
    get grounded() {
        return this.onGround;
    }
    /** Current vertical speed (m/s). */
    get verticalSpeed() {
        return this.vy;
    }
    /**
     * Move for one frame. `yawDeg` 0 faces −Z (three.js camera convention).
     * Returns the new feet position. Non-finite inputs are treated as zero.
     */
    move(input, dt, speed, jumpSpeed) {
        if (this.disposed || this.pw.isDisposed)
            return this.position;
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
        if (this.onGround && this.vy < 0)
            this.vy = 0;
        const canJump = Number.isFinite(jumpSpeed) && jumpSpeed > 0;
        const fl = this.feel;
        if (fl === null) {
            if (input.jump && this.onGround && canJump) {
                this.vy = jumpSpeed;
                this.onGround = false;
            }
            this.vx = mx * v;
            this.vz = mz * v;
        }
        else {
            // Coyote time and a buffered jump: the press is remembered, the ledge forgives.
            this.sinceGround = this.onGround ? 0 : this.sinceGround + step;
            if (input.jump && !this.jumpHeld)
                this.jumpWanted = fl.jumpBuffer;
            else
                this.jumpWanted = Math.max(0, this.jumpWanted - step);
            if (this.jumpWanted > 0 && canJump && (this.onGround || this.sinceGround < fl.coyoteTime) && this.vy <= 0.01) {
                this.vy = jumpSpeed;
                this.onGround = false;
                this.sinceGround = fl.coyoteTime;
                this.jumpWanted = 0;
            }
            // Releasing jump while rising cuts the hop short (a tap is a small jump, a hold the full one).
            if (this.jumpHeld && !input.jump && this.vy > 0)
                this.vy *= fl.jumpCut;
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
            }
            else {
                this.vx += (dx / d) * rate;
                this.vz += (dz / d) * rate;
            }
        }
        this.vy = Math.max(-MAX_FALL_SPEED, this.vy + gy * step);
        const desired = { x: this.vx * step, y: this.vy * step, z: this.vz * step };
        // Keep the collider where we believe the character is (several moves may happen between world steps).
        this.collider.setTranslation({ x: this.pos[0], y: this.pos[1] + this.halfTotal, z: this.pos[2] });
        this.controller.computeColliderMovement(this.collider, desired, R.QueryFilterFlags.EXCLUDE_SENSORS);
        const m = this.controller.computedMovement();
        this.onGround = this.controller.computedGrounded();
        if (this.onGround && this.vy < 0)
            this.vy = 0;
        if (this.vy > 0 && m.y < desired.y - 1e-4)
            this.vy = 0; // bumped a ceiling
        // A wall that stopped the character takes its speed along that axis too.
        if (this.feel !== null && step > 0) {
            if (Math.abs(m.x) < Math.abs(desired.x) * 0.5)
                this.vx *= 0.3;
            if (Math.abs(m.z) < Math.abs(desired.z) * 0.5)
                this.vz *= 0.3;
        }
        this.pos[0] += m.x;
        this.pos[1] += m.y;
        this.pos[2] += m.z;
        this.body.setNextKinematicTranslation({ x: this.pos[0], y: this.pos[1], z: this.pos[2] });
        return this.position;
    }
    /** Move instantly and reset vertical speed. */
    teleport(p) {
        if (this.disposed || this.pw.isDisposed || !isFiniteVec(p))
            return;
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
    setEnabled(on) {
        if (this.disposed || this.pw.isDisposed)
            return;
        this.collider.setEnabled(on);
    }
    /** Remove the capsule and controller from the world. */
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        if (this.pw.isDisposed)
            return;
        this.pw._unregisterExternal(this.collider);
        this.world.removeCharacterController(this.controller);
        this.world.removeRigidBody(this.body);
    }
}
