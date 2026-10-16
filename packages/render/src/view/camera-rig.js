/**
 * Camera behaviors: orbit (OrbitControls with damping), follow (smooth
 * third-person chase that moves in front of obstacles), first-person, and an
 * eased fly-to used by `focus`.
 * Everything per-frame uses module scratch objects (no allocations).
 */
import { Euler, PerspectiveCamera, Vector3 } from 'three';
/** Cubic ease-in-out on [0, 1]. */
export function easeInOutCubic(t) {
    const x = Math.max(0, Math.min(1, t));
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}
/** Frame-rate independent smoothing factor for an exponential approach at `rate` per second. */
export function damp(rate, dt) {
    return 1 - Math.exp(-rate * Math.max(0, dt));
}
/** Lowest view elevation {@link CameraRig.focusOn} keeps (20°). */
export const MIN_FOCUS_ELEVATION = 20;
const MIN_FOCUS_SIN = Math.sin((MIN_FOCUS_ELEVATION * Math.PI) / 180);
const MIN_FOCUS_COS = Math.cos((MIN_FOCUS_ELEVATION * Math.PI) / 180);
const FOLLOW_DISTANCE = 5.5;
/** Closest the chase camera gets to its target when pulled in by an obstacle (m). */
export const MIN_FOLLOW_DISTANCE = 1.2;
/** Gap kept between the pulled-in chase camera and the obstacle surface (m). */
const OCCLUSION_PADDING = 0.35;
const FOLLOW_HEIGHT = 2.4;
const LOOK_HEIGHT = 1.3;
const EYE_HEIGHT = 1.6;
const _target = new Vector3();
const _lookAt = new Vector3();
const _dir = new Vector3();
const _desired = new Vector3();
const _euler = new Euler(0, 0, 0, 'YXZ');
/** Owns the main perspective camera and its behaviors. */
export class CameraRig {
    camera;
    controls;
    mode = 'orbit';
    follow = null;
    look = new Vector3(0, 1, 0);
    fromPos = new Vector3();
    fromTarget = new Vector3();
    toPos = new Vector3();
    toTarget = new Vector3();
    focusT = 1;
    focusDuration = 0.9;
    /** First-person pitch in radians (clamped ±85°). */
    pitch = 0;
    /** Eye height above the player's feet in first person (lowered while sitting). */
    eyeHeight = EYE_HEIGHT;
    /**
     * Lowest camera height in orbit mode (ground + clearance), or -Infinity
     * when the world has no ground. Keeps orbiting and fly-tos above ground.
     */
    floorY = Number.NEGATIVE_INFINITY;
    /** Optional obstacle query for the chase camera (see {@link OcclusionQuery}). */
    occlusion = null;
    constructor(camera, controls) {
        this.camera = camera;
        this.controls = controls;
        if (controls) {
            controls.enableDamping = true;
            controls.dampingFactor = 0.08;
            this.look.copy(controls.target);
        }
    }
    /** Running fly-through (see {@link startTour}). */
    tour = null;
    /** True while a fly-to animation runs. */
    get focusing() {
        return this.focusT < 1;
    }
    /** True while a fly-through plays. */
    get touring() {
        return this.tour !== null && this.tour.active;
    }
    /** Play a fly-through (orbit mode); user input or any camera command stops it. */
    startTour(tour) {
        if (this.mode !== 'orbit')
            this.setMode('orbit', null);
        this.focusT = 1;
        this.tour = tour;
    }
    /** Stop a running fly-through where it is (orbiting continues around its current target). */
    stopTour() {
        if (!this.tour)
            return;
        this.tour = null;
        if (this.controls)
            this.controls.target.copy(this.look);
    }
    /** Pending host pose in `manual` mode (set by {@link setPose}). */
    poseDirty = false;
    /**
     * Manual mode: place the camera at `x, y, z` with a yaw (radians, 0 looks
     * along −Z) and pitch (radians, clamped ±89°). Allocation-free.
     */
    setPose(x, y, z, yaw, pitch) {
        if (!Number.isFinite(x + y + z + yaw + pitch))
            return;
        this.camera.position.set(x, y, z);
        _euler.set(Math.max(-1.553, Math.min(1.553, pitch)), yaw, 0, 'YXZ');
        this.camera.quaternion.setFromEuler(_euler);
        this.look.set(x - Math.sin(yaw) * 4, y + Math.tan(pitch) * 4, z - Math.cos(yaw) * 4);
        this.poseDirty = true;
    }
    /** Switch mode. `source` provides the follow/first-person target. */
    setMode(mode, source) {
        this.tour = null;
        this.mode = mode;
        this.follow = mode === 'orbit' || mode === 'manual' ? null : source;
        if (this.controls) {
            this.controls.enabled = mode === 'orbit';
            if (mode === 'orbit')
                this.controls.target.copy(this.look);
        }
        this.focusT = 1;
    }
    /**
     * Smoothly fly to frame a sphere (switches to orbit mode). The current
     * horizontal viewing direction is kept, but the view is lifted to at least
     * {@link MIN_FOCUS_ELEVATION} above the horizon so a camera that sat low
     * (or below a raised target) never ends up looking from under the ground.
     */
    focusOn(center, radius, duration = 0.9) {
        const r = Math.max(0.25, Number.isFinite(radius) ? radius : 1);
        const vHalf = (this.camera.fov * Math.PI) / 360;
        const half = Math.min(vHalf, Math.atan(Math.tan(vHalf) * (this.camera.aspect > 0 ? this.camera.aspect : 1)));
        const dist = Math.min(2000, (r / Math.sin(half)) * 1.1);
        // Keep the current viewing direction; avoid a degenerate direction when the camera is at the center.
        _desired.copy(this.camera.position).sub(center);
        if (_desired.lengthSq() < 1e-6)
            _desired.set(0.6, 0.5, 1);
        _desired.normalize();
        if (_desired.y < MIN_FOCUS_SIN) {
            const horizontal = Math.hypot(_desired.x, _desired.z);
            if (horizontal < 1e-6)
                _desired.set(0, 0, 1);
            else
                _desired.set(_desired.x / horizontal, 0, _desired.z / horizontal);
            _desired.multiplyScalar(MIN_FOCUS_COS).setY(MIN_FOCUS_SIN);
        }
        _desired.multiplyScalar(dist).add(center);
        this.flyTo(_desired, center, duration);
    }
    /** Current look-at point (orbit target) written into `out`. */
    getTarget(out) {
        return out.copy(this.controls ? this.controls.target : this.look);
    }
    /** Fly (or jump when `duration` ≤ 0) to a camera position looking at `target`. Switches to orbit mode. */
    flyTo(position, target, duration = 0.9) {
        this.tour = null;
        if (this.mode !== 'orbit')
            this.setMode('orbit', null);
        this.fromPos.copy(this.camera.position);
        this.fromTarget.copy(this.controls ? this.controls.target : this.look);
        this.toPos.copy(position);
        if (this.toPos.y < this.floorY)
            this.toPos.y = this.floorY;
        this.toTarget.copy(target);
        const d = Number.isFinite(duration) ? duration : 0;
        this.focusDuration = Math.max(0.01, d);
        this.focusT = d <= 0 ? 1 : 0;
        if (d <= 0)
            this.place(this.toPos, this.toTarget);
    }
    place(pos, target) {
        this.camera.position.copy(pos);
        this.look.copy(target);
        if (this.controls)
            this.controls.target.copy(target);
        this.camera.lookAt(target);
    }
    /** Advance the camera one frame. Zero allocations. Returns true when the view may have changed. */
    update(dt) {
        if (this.tour) {
            this.tour.io[2] = dt;
            this.tour.io[3] = this.floorY;
            if (this.tour.step(this.camera, this.look))
                return true;
            this.stopTour();
        }
        if (this.focusT < 1) {
            this.focusT = Math.min(1, this.focusT + dt / this.focusDuration);
            const e = easeInOutCubic(this.focusT);
            this.camera.position.lerpVectors(this.fromPos, this.toPos, e);
            this.look.lerpVectors(this.fromTarget, this.toTarget, e);
            if (this.controls)
                this.controls.target.copy(this.look);
            this.camera.lookAt(this.look);
            return true;
        }
        if (this.mode === 'manual') {
            const moved = this.poseDirty;
            this.poseDirty = false;
            return moved;
        }
        if (this.mode === 'orbit') {
            if (!this.controls)
                return false;
            let changed = this.controls.update(dt);
            if (this.camera.position.y < this.floorY) {
                this.camera.position.y = this.floorY;
                this.camera.lookAt(this.controls.target);
                changed = true;
            }
            this.look.copy(this.controls.target);
            return changed;
        }
        const yaw = this.follow ? this.follow(_target) : Number.NaN;
        if (!Number.isFinite(yaw))
            return false;
        if (this.mode === 'firstPerson') {
            this.camera.position.set(_target.x, _target.y + this.eyeHeight, _target.z);
            this.pitch = Math.max(-1.48, Math.min(1.48, this.pitch));
            _euler.set(this.pitch, yaw, 0, 'YXZ');
            this.camera.quaternion.setFromEuler(_euler);
            this.look.set(_target.x - Math.sin(yaw) * 4, _target.y + this.eyeHeight, _target.z - Math.cos(yaw) * 4);
            return true;
        }
        // Follow: chase from behind the target's heading.
        _desired.set(_target.x + Math.sin(yaw) * FOLLOW_DISTANCE, _target.y + FOLLOW_HEIGHT, _target.z + Math.cos(yaw) * FOLLOW_DISTANCE);
        let rate = 6;
        if (this.occlusion) {
            // Something solid between the target and the camera (a tree trunk, a wall): move in front of it, fast.
            _lookAt.set(_target.x, _target.y + LOOK_HEIGHT, _target.z);
            _dir.subVectors(_desired, _lookAt);
            const full = _dir.length();
            const free = full > 1e-4 ? this.occlusion(_lookAt, _desired) : Number.POSITIVE_INFINITY;
            if (free < full) {
                _dir.multiplyScalar(1 / full);
                _desired.copy(_lookAt).addScaledVector(_dir, Math.max(MIN_FOLLOW_DISTANCE, free - OCCLUSION_PADDING));
                rate = 14;
            }
        }
        // Inline exponential damping (same as damp()): no boxed return values per frame.
        this.camera.position.lerp(_desired, 1 - Math.exp(-rate * Math.max(0, dt)));
        _desired.set(_target.x, _target.y + LOOK_HEIGHT, _target.z);
        this.look.lerp(_desired, 1 - Math.exp(-10 * Math.max(0, dt)));
        this.camera.lookAt(this.look);
        return true;
    }
    /**
     * Dispose controls. three's OrbitControls registers its Ctrl-key interceptors on `getRootNode()` and removes them the
     * same way, so once the canvas has left the page it removes them from the detached canvas and the ones on `document`
     * stay forever, keeping the controls (and through their change listeners, the whole renderer) alive across world
     * switches. They are removed from `document` here.
     */
    dispose() {
        const c = this.controls;
        if (!c)
            return;
        c.dispose();
        const k = c;
        if (typeof document === 'undefined')
            return;
        if (typeof k._interceptControlDown === 'function')
            document.removeEventListener('keydown', k._interceptControlDown, { capture: true });
        if (typeof k._interceptControlUp === 'function')
            document.removeEventListener('keyup', k._interceptControlUp, { capture: true });
    }
}
