/**
 * Keyboard + pointer input for play mode. Produces a reused `InputState`
 * (no per-step allocation). Keys typed into text fields are ignored, short
 * taps are latched until the next fixed step consumes them, and all held
 * keys are released when the window loses focus.
 */
import type { InputState } from '@aether/logic';

/** Degrees of yaw per pixel of horizontal mouse movement. */
export const MOUSE_YAW_PER_PX = 0.18;
/** Steepest first-person look up / down (degrees). */
export const MAX_PITCH_DEG = 80;
/** Degrees per second of yaw from the arrow keys. */
export const KEY_YAW_SPEED = 120;
/** Most simultaneously held keys tracked (bounds hostile/odd input). */
const MAX_KEYS = 32;

/** Movement axes derived from held key codes (pure; exported for tests). */
export function axesFromKeys(keys: ReadonlySet<string>): { forward: number; right: number; turn: number; jump: boolean; action: boolean } {
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
export function isTypingTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function clampUnit(v: number): number {
  return Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
}

/** Wrap an angle in degrees to (-180, 180]. */
export function wrapDeg(d: number): number {
  if (!Number.isFinite(d)) return 0;
  let x = d % 360;
  if (x > 180) x -= 360;
  else if (x <= -180) x += 360;
  return x;
}

/** Game input source bound to a canvas while play mode is active. */
export class InputController {
  private readonly held = new Set<string>();
  private readonly latched = new Set<string>();
  private readonly merged = new Set<string>();
  private readonly state: { forward: number; right: number; jump: boolean; action: boolean; keys: ReadonlySet<string>; pointerYawDeg: number; fire: boolean; pitchDeg: number; aim?: { origin: [number, number, number]; dir: [number, number, number] } };
  /** Weapon worlds: the left button fires (once the pointer is captured) instead of only dragging the view. */
  private fireMode = false;
  /** The left button is held as a trigger. */
  private firing = false;
  /** Pointer capture was refused (headless, embedded frames): presses fire while dragging the view. */
  private lockRefused = false;
  /** On-screen (touch) fire button, or a test driver. */
  private virtualFire = false;
  private readonly aimRay: { origin: [number, number, number]; dir: [number, number, number] } = { origin: [0, 0, 0], dir: [0, 0, -1] };
  private aimSet = false;
  private yaw = 0;
  /** First-person pitch in degrees (negative looks down), clamped to ±{@link MAX_PITCH_DEG}. */
  private pitch = 0;
  private dragging = false;
  private attached: HTMLElement | null = null;
  private pointerLock = false;
  /** On-screen (touch) stick: forward/right in [-1, 1]. */
  private virtualForward = 0;
  /** Mouse look multiplier (player settings; 0.25–3). */
  sensitivity = 1;
  private virtualRight = 0;

  constructor() {
    this.state = { forward: 0, right: 0, jump: false, action: false, keys: this.merged, pointerYawDeg: 0, fire: false, pitchDeg: 0 };
  }

  /** Camera/player yaw in degrees (0 faces −Z). */
  get yawDeg(): number {
    return this.yaw;
  }

  /** First-person pitch in degrees (0 level, negative looks down). */
  get pitchDeg(): number {
    return this.pitch;
  }

  /** Set the pitch in degrees (clamped). */
  setPitch(deg: number): void {
    this.pitch = Number.isFinite(deg) ? Math.max(-MAX_PITCH_DEG, Math.min(MAX_PITCH_DEG, deg)) : 0;
  }

  /** Set the yaw (e.g. from the camera when play starts). */
  setYaw(deg: number): void {
    this.yaw = wrapDeg(deg);
  }

  /**
   * Feed the on-screen touch stick. Values are clamped to [-1, 1] and
   * combined with the keyboard (the larger magnitude wins per axis).
   */
  setVirtualStick(forward: number, right: number): void {
    this.virtualForward = clampUnit(forward);
    this.virtualRight = clampUnit(right);
  }

  /**
   * A tap on an on-screen button: latched like a key tap so a short press is
   * never missed between two fixed steps. Only `Space` (jump), `KeyE`
   * (action) and `KeyR` (reload) are accepted.
   */
  tapVirtual(code: 'Space' | 'KeyE' | 'KeyR'): void {
    if (code === 'Space' || code === 'KeyE' || code === 'KeyR') this.latched.add(code);
  }

  /** Hold or release the trigger from an on-screen button (or a test driver). */
  setVirtualFire(on: boolean): void {
    this.virtualFire = on === true;
  }

  /** The crosshair ray for the next samples (camera position and unit view direction); null clears it. */
  setAim(origin: readonly [number, number, number] | null, dir?: readonly [number, number, number]): void {
    if (!origin || !dir) {
      this.aimSet = false;
      return;
    }
    const r = this.aimRay;
    r.origin[0] = origin[0];
    r.origin[1] = origin[1];
    r.origin[2] = origin[2];
    r.dir[0] = dir[0];
    r.dir[1] = dir[1];
    r.dir[2] = dir[2];
    this.aimSet = true;
  }

  /** True while the trigger is held (mouse or on-screen). */
  get trigger(): boolean {
    return this.firing || this.virtualFire;
  }

  /** Turn the camera/player by a number of degrees (touch look). */
  turnBy(deg: number): void {
    if (Number.isFinite(deg)) this.yaw = wrapDeg(this.yaw + deg);
  }

  /** Release every held key and the virtual stick (pause menus, focus loss). */
  releaseAll(): void {
    this.onBlur();
    this.latched.clear();
  }

  /** Start listening. `pointerLock` requests mouse capture on canvas click. */
  attach(canvas: HTMLElement, opts: { pointerLock: boolean; fire?: boolean }): void {
    this.detach();
    this.attached = canvas;
    this.pointerLock = opts.pointerLock;
    this.fireMode = opts.fire === true;
    this.lockRefused = false;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointermove', this.onPointerMove);
  }

  /** Stop listening and release everything. */
  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointermove', this.onPointerMove);
    if (this.attached) {
      this.attached.removeEventListener('pointerdown', this.onPointerDown);
      if (typeof document !== 'undefined' && document.pointerLockElement === this.attached) document.exitPointerLock();
    }
    this.attached = null;
    this.onBlur();
  }

  /**
   * Sample input for one fixed step of `dt` seconds. The returned object is
   * reused — read it before the next call. Latched taps are consumed.
   */
  sample(dt: number): InputState {
    this.merged.clear();
    for (const k of this.held) this.merged.add(k);
    for (const k of this.latched) this.merged.add(k);
    this.latched.clear();
    const a = axesFromKeys(this.merged);
    if (a.turn !== 0) this.yaw = wrapDeg(this.yaw - a.turn * KEY_YAW_SPEED * dt);
    this.state.forward = Math.abs(this.virtualForward) > Math.abs(a.forward) ? this.virtualForward : a.forward;
    this.state.right = Math.abs(this.virtualRight) > Math.abs(a.right) ? this.virtualRight : a.right;
    this.state.jump = a.jump;
    this.state.action = a.action;
    this.state.pointerYawDeg = this.yaw;
    this.state.fire = this.firing || this.virtualFire;
    this.state.pitchDeg = this.pitch;
    if (this.aimSet) this.state.aim = this.aimRay;
    else delete this.state.aim;
    return this.state;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (this.held.size < MAX_KEYS && e.code) {
      this.held.add(e.code);
      this.latched.add(e.code);
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.held.delete(e.code);
  };

  private readonly onBlur = (): void => {
    this.held.clear();
    this.dragging = false;
    this.firing = false;
    this.virtualFire = false;
    this.virtualForward = 0;
    this.virtualRight = 0;
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.dragging = true;
    const locked = this.attached !== null && document.pointerLockElement === this.attached;
    // With a weapon the press that captures the mouse does not shoot; every press after it does.
    // A finger on the view looks around; touch fires with its own button.
    if (this.fireMode && e.pointerType !== 'touch' && (locked || this.lockRefused || !this.pointerLock)) this.firing = true;
    if (this.pointerLock && this.attached && !locked) {
      try {
        const p = this.attached.requestPointerLock() as unknown;
        if (p instanceof Promise)
          p.catch(() => {
            this.lockRefused = true;
          });
      } catch {
        /* pointer lock unsupported: dragging still works */
        this.lockRefused = true;
      }
    }
  };

  private readonly onPointerUp = (): void => {
    this.dragging = false;
    this.firing = false;
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const locked = this.attached !== null && document.pointerLockElement === this.attached;
    if (!locked && !this.dragging) return;
    if (Number.isFinite(e.movementX)) this.yaw = wrapDeg(this.yaw - e.movementX * MOUSE_YAW_PER_PX * this.sensitivity);
    if (Number.isFinite(e.movementY)) this.setPitch(this.pitch - e.movementY * MOUSE_YAW_PER_PX * this.sensitivity);
  };
}
