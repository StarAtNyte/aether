/** Degrees of yaw per pixel of horizontal mouse movement. */
export const MOUSE_YAW_PER_PX = 0.18;
/** Steepest first-person look up / down (degrees). */
export const MAX_PITCH_DEG = 80;
/** Degrees per second of yaw from the arrow keys. */
export const KEY_YAW_SPEED = 120;
/** Most simultaneously held keys tracked (bounds hostile/odd input). */
const MAX_KEYS = 32;
/** Movement axes derived from held key codes (pure; exported for tests). */
export function axesFromKeys(keys) {
    const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0) + (keys.has('ArrowUp') ? 1 : 0) - (keys.has('ArrowDown') ? 1 : 0);
    const r = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const t = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0);
    return {
        forward: Math.max(-1, Math.min(1, f)),
        right: r,
        turn: t,
        jump: keys.has('Space'),
        action: keys.has('KeyE') || keys.has('Enter'),
    };
}
/** True when keyboard focus is in an editable element (inputs keep their keys). */
export function isTypingTarget(target) {
    if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement))
        return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}
function clampUnit(v) {
    return Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
}
/** Wrap an angle in degrees to (-180, 180]. */
export function wrapDeg(d) {
    if (!Number.isFinite(d))
        return 0;
    let x = d % 360;
    if (x > 180)
        x -= 360;
    else if (x <= -180)
        x += 360;
    return x;
}
/** Game input source bound to a canvas while play mode is active. */
export class InputController {
    held = new Set();
    latched = new Set();
    merged = new Set();
    state;
    yaw = 0;
    /** First-person pitch in degrees (negative looks down), clamped to ±{@link MAX_PITCH_DEG}. */
    pitch = 0;
    dragging = false;
    attached = null;
    pointerLock = false;
    /** On-screen (touch) stick: forward/right in [-1, 1]. */
    virtualForward = 0;
    /** Mouse look multiplier (player settings; 0.25–3). */
    sensitivity = 1;
    virtualRight = 0;
    constructor() {
        this.state = { forward: 0, right: 0, jump: false, action: false, keys: this.merged, pointerYawDeg: 0 };
    }
    /** Camera/player yaw in degrees (0 faces −Z). */
    get yawDeg() {
        return this.yaw;
    }
    /** First-person pitch in degrees (0 level, negative looks down). */
    get pitchDeg() {
        return this.pitch;
    }
    /** Set the pitch in degrees (clamped). */
    setPitch(deg) {
        this.pitch = Number.isFinite(deg) ? Math.max(-MAX_PITCH_DEG, Math.min(MAX_PITCH_DEG, deg)) : 0;
    }
    /** Set the yaw (e.g. from the camera when play starts). */
    setYaw(deg) {
        this.yaw = wrapDeg(deg);
    }
    /**
     * Feed the on-screen touch stick. Values are clamped to [-1, 1] and
     * combined with the keyboard (the larger magnitude wins per axis).
     */
    setVirtualStick(forward, right) {
        this.virtualForward = clampUnit(forward);
        this.virtualRight = clampUnit(right);
    }
    /**
     * A tap on an on-screen button: latched like a key tap so a short press is
     * never missed between two fixed steps. Only `Space` (jump) and `KeyE`
     * (action) are accepted.
     */
    tapVirtual(code) {
        if (code === 'Space' || code === 'KeyE')
            this.latched.add(code);
    }
    /** Turn the camera/player by a number of degrees (touch look). */
    turnBy(deg) {
        if (Number.isFinite(deg))
            this.yaw = wrapDeg(this.yaw + deg);
    }
    /** Release every held key and the virtual stick (pause menus, focus loss). */
    releaseAll() {
        this.onBlur();
        this.latched.clear();
    }
    /** Start listening. `pointerLock` requests mouse capture on canvas click. */
    attach(canvas, opts) {
        this.detach();
        this.attached = canvas;
        this.pointerLock = opts.pointerLock;
        window.addEventListener('keydown', this.onKeyDown);
        window.addEventListener('keyup', this.onKeyUp);
        window.addEventListener('blur', this.onBlur);
        canvas.addEventListener('pointerdown', this.onPointerDown);
        window.addEventListener('pointerup', this.onPointerUp);
        window.addEventListener('pointermove', this.onPointerMove);
    }
    /** Stop listening and release everything. */
    detach() {
        window.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('keyup', this.onKeyUp);
        window.removeEventListener('blur', this.onBlur);
        window.removeEventListener('pointerup', this.onPointerUp);
        window.removeEventListener('pointermove', this.onPointerMove);
        if (this.attached) {
            this.attached.removeEventListener('pointerdown', this.onPointerDown);
            if (typeof document !== 'undefined' && document.pointerLockElement === this.attached)
                document.exitPointerLock();
        }
        this.attached = null;
        this.onBlur();
    }
    /**
     * Sample input for one fixed step of `dt` seconds. The returned object is
     * reused — read it before the next call. Latched taps are consumed.
     */
    sample(dt) {
        this.merged.clear();
        for (const k of this.held)
            this.merged.add(k);
        for (const k of this.latched)
            this.merged.add(k);
        this.latched.clear();
        const a = axesFromKeys(this.merged);
        if (a.turn !== 0)
            this.yaw = wrapDeg(this.yaw - a.turn * KEY_YAW_SPEED * dt);
        this.state.forward = Math.abs(this.virtualForward) > Math.abs(a.forward) ? this.virtualForward : a.forward;
        this.state.right = Math.abs(this.virtualRight) > Math.abs(a.right) ? this.virtualRight : a.right;
        this.state.jump = a.jump;
        this.state.action = a.action;
        this.state.pointerYawDeg = this.yaw;
        return this.state;
    }
    onKeyDown = (e) => {
        if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey)
            return;
        if (e.code === 'Space' || e.code.startsWith('Arrow'))
            e.preventDefault();
        if (this.held.size < MAX_KEYS && e.code) {
            this.held.add(e.code);
            this.latched.add(e.code);
        }
    };
    onKeyUp = (e) => {
        this.held.delete(e.code);
    };
    onBlur = () => {
        this.held.clear();
        this.dragging = false;
        this.virtualForward = 0;
        this.virtualRight = 0;
    };
    onPointerDown = (e) => {
        if (e.button !== 0)
            return;
        this.dragging = true;
        if (this.pointerLock && this.attached && document.pointerLockElement !== this.attached) {
            try {
                const p = this.attached.requestPointerLock();
                if (p instanceof Promise)
                    p.catch(() => undefined);
            }
            catch {
                /* pointer lock unsupported: dragging still works */
            }
        }
    };
    onPointerUp = () => {
        this.dragging = false;
    };
    onPointerMove = (e) => {
        const locked = this.attached !== null && document.pointerLockElement === this.attached;
        if (!locked && !this.dragging)
            return;
        if (Number.isFinite(e.movementX))
            this.yaw = wrapDeg(this.yaw - e.movementX * MOUSE_YAW_PER_PX * this.sensitivity);
        if (Number.isFinite(e.movementY))
            this.setPitch(this.pitch - e.movementY * MOUSE_YAW_PER_PX * this.sensitivity);
    };
}
