/**
 * Input for the voxel game: mouse look (pointer lock where the browser
 * allows it — Chromium, Firefox and Safari — with drag-to-look as the
 * fallback), WASD / arrows, Space (double-tap toggles creative flight),
 * Shift sneak, Ctrl or double-tap W sprint, left button break/attack,
 * right button place/use, 1–9 and the wheel for the hotbar, E inventory,
 * Q drop, F5 / V third-person view. Fills a reused {@link GameInput}; taps
 * between two fixed steps are latched so none is lost. Keys typed into
 * text fields are ignored and everything is released on blur.
 */
import type { GameInput } from '@aether/voxel/game';
import { isTypingTarget } from '../engine/input';

/** Radians of look per pixel of mouse movement. */
export const LOOK_PER_PX = 0.0024;
/** Double-tap window (ms). */
const DOUBLE_TAP_MS = 280;
/** Most keys tracked at once. */
const MAX_KEYS = 32;

/** One-shot UI commands produced by the keyboard (consumed by the session). */
export interface VoxelCommands {
  inventory: boolean;
  drop: boolean;
  view: boolean;
  /** Hotbar slot picked by a digit key (−1: none). */
  slot: number;
  /** Wheel steps since the last read (+ next, − previous). */
  scroll: number;
}

/** Blur a focused text field (prompt box, search) so game keys are not typed into it. */
function releaseTextFocus(): void {
  if (typeof document === 'undefined') return;
  const active = document.activeElement;
  if (active instanceof HTMLElement && isTypingTarget(active)) active.blur();
}

/** See the module docs. */
export class VoxelInput {
  private readonly held = new Set<string>();
  private readonly tapped = new Set<string>();
  private el: HTMLElement | null = null;
  private yaw = 0;
  private pitch = 0;
  private dragging = false;
  private primaryDown = false;
  private secondaryDown = false;
  private attackTap = false;
  private useTap = false;
  private lastSpace = -1e9;
  private lastForward = -1e9;
  private sprintLatch = false;
  private flyTap = false;
  /** Pointer lock was refused (headless, iframe, permissions): clicks act directly and drags look. */
  private lockFailed = false;
  /** The player clicked "Click to play" at least once this session. */
  private engaged = false;
  private virtualForward = 0;
  private virtualRight = 0;
  /** True while the UI (inventory screen) owns the mouse. */
  uiOpen = false;
  readonly commands: VoxelCommands = { inventory: false, drop: false, view: false, slot: -1, scroll: 0 };

  /** Pointer is locked to the canvas. */
  get locked(): boolean {
    return this.el !== null && typeof document !== 'undefined' && document.pointerLockElement === this.el;
  }

  /**
   * The "click to play" overlay should show: the mouse is not captured and
   * capturing is still possible. Once the player has engaged and the browser
   * refused pointer lock (iframes without the permission, some mobile
   * browsers), the overlay stays away and drag-to-look / direct clicks work
   * on the canvas instead of an overlay that could never be dismissed.
   */
  get needsCapture(): boolean {
    if (this.locked) return false;
    if (!this.engaged) return true;
    return !this.lockFailed && typeof this.el?.requestPointerLock === 'function';
  }

  /** Look direction (radians). */
  setLook(yaw: number, pitch: number): void {
    if (Number.isFinite(yaw)) this.yaw = yaw;
    if (Number.isFinite(pitch)) this.pitch = Math.max(-1.55, Math.min(1.55, pitch));
  }

  /** Current yaw. */
  get yawRad(): number {
    return this.yaw;
  }

  attach(el: HTMLElement): void {
    this.detach();
    this.el = el;
    releaseTextFocus();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    el.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', this.onContextMenu);
    document.addEventListener('pointerlockerror', this.onLockError);
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockerror', this.onLockError);
    if (this.el) {
      this.el.removeEventListener('mousedown', this.onMouseDown);
      this.el.removeEventListener('wheel', this.onWheel);
      this.el.removeEventListener('contextmenu', this.onContextMenu);
      if (this.locked) document.exitPointerLock();
    }
    this.el = null;
    this.onBlur();
  }

  /** Request mouse capture (must run inside a user gesture). */
  lock(): void {
    const el = this.el;
    this.engaged = true;
    // Keys must reach the game, not a chat box that still holds the focus.
    releaseTextFocus();
    if (!el || this.locked || typeof el.requestPointerLock !== 'function') return;
    try {
      const p = el.requestPointerLock() as unknown;
      if (p instanceof Promise) {
        p.catch(() => {
          this.lockFailed = true;
        });
      }
    } catch {
      /* pointer lock unsupported: drag to look */
      this.lockFailed = true;
    }
  }

  /** Release mouse capture (inventory screen). */
  unlock(): void {
    if (this.locked) document.exitPointerLock();
  }

  /** Touch stick (−1…1). */
  setVirtualStick(forward: number, right: number): void {
    this.virtualForward = Number.isFinite(forward) ? Math.max(-1, Math.min(1, forward)) : 0;
    this.virtualRight = Number.isFinite(right) ? Math.max(-1, Math.min(1, right)) : 0;
  }

  /** Touch buttons: jump or place. */
  tap(code: 'Space' | 'KeyE'): void {
    if (code === 'Space') this.tapped.add('Space');
    else this.useTap = true;
  }

  /** Touch look (degrees of yaw). */
  turnBy(deg: number): void {
    if (Number.isFinite(deg)) this.yaw -= (deg * Math.PI) / 180;
  }

  /** Held or tapped since the last step (bound once: sampling allocates nothing). */
  private readonly key = (code: string): boolean => this.held.has(code) || this.tapped.has(code);

  /** Fill `out` for one fixed step; latched taps are consumed. */
  sample(out: GameInput): GameInput {
    const k = this.key;
    const ui = this.uiOpen;
    const f = ui ? 0 : (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
    const r = ui ? 0 : (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
    out.forward = Math.abs(this.virtualForward) > Math.abs(f) ? this.virtualForward : f;
    out.right = Math.abs(this.virtualRight) > Math.abs(r) ? this.virtualRight : r;
    out.jump = !ui && k('Space');
    out.sneak = !ui && (k('ShiftLeft') || k('ShiftRight'));
    if (out.forward <= 0) this.sprintLatch = false;
    out.sprint = !ui && (k('ControlLeft') || k('ControlRight') || this.sprintLatch);
    out.yaw = this.yaw;
    out.pitch = this.pitch;
    out.primary = !ui && this.primaryDown;
    out.attack = !ui && this.attackTap;
    out.use = !ui && (this.secondaryDown || this.useTap);
    out.toggleFly = this.flyTap;
    this.attackTap = false;
    this.useTap = false;
    this.flyTap = false;
    this.tapped.clear();
    return out;
  }

  /** Read and reset the one-shot commands. */
  takeCommands(): VoxelCommands {
    return this.commands;
  }

  /** Clear the one-shot commands after handling them. */
  clearCommands(): void {
    const c = this.commands;
    c.inventory = false;
    c.drop = false;
    c.view = false;
    c.slot = -1;
    c.scroll = 0;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (isTypingTarget(e.target) || e.metaKey || e.altKey) return;
    const code = e.code;
    if (code === 'Space' || code.startsWith('Arrow') || code === 'F5' || code === 'Tab') e.preventDefault();
    // Ctrl+W must not close the tab while sprinting: swallow browser shortcuts on movement keys.
    if (e.ctrlKey && (code === 'KeyW' || code === 'KeyS' || code === 'KeyA' || code === 'KeyD')) e.preventDefault();
    if (e.repeat) return;
    if (code === 'KeyE') {
      this.commands.inventory = true;
      return;
    }
    if (this.uiOpen) return;
    if (code === 'KeyQ') this.commands.drop = true;
    else if (code === 'F5' || code === 'KeyV') this.commands.view = true;
    else if (code.startsWith('Digit') && code.length === 6) {
      const d = Number(code.slice(5));
      if (d >= 1 && d <= 9) this.commands.slot = d - 1;
    }
    const now = performance.now();
    if (code === 'Space') {
      if (now - this.lastSpace < DOUBLE_TAP_MS) this.flyTap = true;
      this.lastSpace = now;
    }
    if (code === 'KeyW' || code === 'ArrowUp') {
      if (now - this.lastForward < DOUBLE_TAP_MS) this.sprintLatch = true;
      this.lastForward = now;
    }
    if (this.held.size < MAX_KEYS) {
      this.held.add(code);
      this.tapped.add(code);
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.held.delete(e.code);
  };

  private readonly onBlur = (): void => {
    this.held.clear();
    this.tapped.clear();
    this.primaryDown = false;
    this.secondaryDown = false;
    this.dragging = false;
    this.sprintLatch = false;
    this.virtualForward = 0;
    this.virtualRight = 0;
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (this.uiOpen) return;
    if (!this.locked) {
      this.dragging = true;
      // A click that captures the mouse is not an action (unless capture is impossible here).
      if (!this.lockFailed && typeof this.el?.requestPointerLock === 'function') {
        this.lock();
        if (e.button === 0) return;
      }
    }
    if (e.button === 0) {
      this.primaryDown = true;
      this.attackTap = true;
    } else if (e.button === 2) {
      this.secondaryDown = true;
      this.useTap = true;
    }
  };

  private readonly onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) {
      this.primaryDown = false;
      this.dragging = false;
    } else if (e.button === 2) this.secondaryDown = false;
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    if (this.uiOpen) return;
    if (!this.locked && !this.dragging) return;
    const dx = Number.isFinite(e.movementX) ? e.movementX : 0;
    const dy = Number.isFinite(e.movementY) ? e.movementY : 0;
    // Browsers occasionally report a huge jump right after locking: ignore it.
    if (Math.abs(dx) > 400 || Math.abs(dy) > 400) return;
    this.yaw -= dx * LOOK_PER_PX;
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - dy * LOOK_PER_PX));
  };

  private readonly onWheel = (e: WheelEvent): void => {
    if (this.uiOpen) return;
    e.preventDefault();
    if (e.deltaY !== 0) this.commands.scroll += e.deltaY > 0 ? 1 : -1;
  };

  private readonly onLockError = (): void => {
    this.lockFailed = true;
  };

  private readonly onContextMenu = (e: Event): void => {
    e.preventDefault();
  };
}
