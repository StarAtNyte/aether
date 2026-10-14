/**
 * Controller support through the Gamepad API (standard mapping: Xbox,
 * PlayStation, Switch Pro and most USB pads). The left stick or D-pad
 * moves, the right stick turns, A / Cross jumps, X / Square or B / Circle
 * acts, Start / Options pauses. Polled once per animation frame, only after
 * a pad was connected; the returned state object is reused (no per-frame
 * allocation on our side). Firefox and Chromium expose a pad only after its
 * first button press, which is also what makes it "connected" here.
 */

/** Stick dead zone (fraction of full deflection). */
export const DEAD_ZONE = 0.18;
/** Degrees per second the right stick turns the view at full deflection. */
export const STICK_TURN_SPEED = 150;

/** Per-frame controller state (reused object). */
export interface PadState {
  /** A pad is connected and was used. */
  active: boolean;
  forward: number;
  right: number;
  /** Right stick, −1..1 (positive turns right). */
  lookX: number;
  lookY: number;
  /** Pressed this frame (edges). */
  jump: boolean;
  action: boolean;
  pause: boolean;
}

/** Scaled dead zone: 0 inside, then rising linearly from 0 to ±1. */
export function deadZone(v: number, zone = DEAD_ZONE): number {
  if (!Number.isFinite(v)) return 0;
  const a = Math.abs(v);
  if (a <= zone) return 0;
  return Math.sign(v) * Math.min(1, (a - zone) / (1 - zone));
}

/** Minimal gamepad shape (the DOM `Gamepad`, or a test fake). */
export interface PadLike {
  readonly connected: boolean;
  readonly mapping: string;
  readonly axes: readonly number[];
  readonly buttons: ReadonlyArray<{ readonly pressed: boolean; readonly value: number }>;
}

const B_A = 0;
const B_B = 1;
const B_X = 2;
const B_START = 9;
const B_UP = 12;
const B_DOWN = 13;
const B_LEFT = 14;
const B_RIGHT = 15;

function pressed(pad: PadLike, i: number): boolean {
  const b = pad.buttons[i];
  return b !== undefined && (b.pressed || b.value > 0.5);
}

/** Polls the first usable gamepad. */
export class GamepadPoller {
  private readonly state: PadState = { active: false, forward: 0, right: 0, lookX: 0, lookY: 0, jump: false, action: false, pause: false };
  private prevJump = false;
  private prevAction = false;
  private prevPause = false;
  private seen = false;
  private readonly onConnect = (): void => {
    this.seen = true;
  };

  constructor(private readonly source: (() => ReadonlyArray<PadLike | null>) | null = defaultSource()) {
    if (typeof window !== 'undefined') window.addEventListener('gamepadconnected', this.onConnect);
  }

  /** Read the pad (call once per frame). */
  poll(): PadState {
    const s = this.state;
    s.jump = false;
    s.action = false;
    s.pause = false;
    if (!this.source || !this.seen) {
      s.active = false;
      return s;
    }
    let pad: PadLike | null = null;
    let list: ReadonlyArray<PadLike | null>;
    try {
      list = this.source();
    } catch {
      list = [];
    }
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p && p.connected) {
        pad = p;
        break;
      }
    }
    if (!pad) {
      s.active = false;
      s.forward = 0;
      s.right = 0;
      s.lookX = 0;
      s.lookY = 0;
      return s;
    }
    const dpadY = (pressed(pad, B_UP) ? 1 : 0) - (pressed(pad, B_DOWN) ? 1 : 0);
    const dpadX = (pressed(pad, B_RIGHT) ? 1 : 0) - (pressed(pad, B_LEFT) ? 1 : 0);
    const lx = deadZone(pad.axes[0] ?? 0);
    const ly = deadZone(pad.axes[1] ?? 0);
    s.forward = Math.max(-1, Math.min(1, -ly + dpadY));
    s.right = Math.max(-1, Math.min(1, lx + dpadX));
    s.lookX = deadZone(pad.axes[2] ?? 0);
    s.lookY = deadZone(pad.axes[3] ?? 0);
    const jump = pressed(pad, B_A);
    const action = pressed(pad, B_X) || pressed(pad, B_B);
    const pause = pressed(pad, B_START);
    s.jump = jump && !this.prevJump;
    s.action = action && !this.prevAction;
    s.pause = pause && !this.prevPause;
    this.prevJump = jump;
    this.prevAction = action;
    this.prevPause = pause;
    s.active = true;
    return s;
  }

  dispose(): void {
    if (typeof window !== 'undefined') window.removeEventListener('gamepadconnected', this.onConnect);
  }

  /** Test hook: behave as if a pad had been connected. */
  markConnected(): void {
    this.seen = true;
  }
}

function defaultSource(): (() => ReadonlyArray<PadLike | null>) | null {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
  return () => navigator.getGamepads() as unknown as ReadonlyArray<PadLike | null>;
}
