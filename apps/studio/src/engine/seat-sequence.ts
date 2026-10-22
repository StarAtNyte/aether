/**
 * The choreography of sitting down and standing up, as a pure function of time: walk to the approach point, turn to
 * face out of the seat, lower onto it (the body slides back onto the seat while the sit-down plays), stay seated,
 * rise and step out to the approach point again. The studio places the player's body from it; the capsule stays out
 * of the way (disabled) for the whole time, so it can never climb the furniture.
 */
import type { Vec3 } from '@aether/core';
import { SIT_RATE } from '@aether/assets';
import type { SeatPose } from './interaction';

/** Walking speed to the approach point (m/s). */
export const APPROACH_SPEED = 1.7;
/** Longest walk to the approach point (s); farther starts are brought in faster. */
export const APPROACH_MAX = 1.6;
/** Seconds to turn round to face out of the seat. */
export const TURN_TIME = 0.4;
/** Seconds the sit-down clip plays (the captured clip at its play rate). */
export const DOWN_TIME = 2.9 / SIT_RATE;
/** Seconds the stand-up clip plays. */
export const UP_TIME = 2.5 / SIT_RATE;

export type SeatPhase = 'approach' | 'turn' | 'down' | 'seated' | 'up' | 'done';

/** The body this frame. */
export interface SeatFrame {
  phase: SeatPhase;
  /** Where the body's feet stand (floor level). */
  position: Vec3;
  /** Body facing in degrees (0 faces −Z), or null while walking (the body turns toward its motion). */
  yawDeg: number | null;
  /** True from the start of the sit-down until the stand-up begins (drives the sit clips). */
  sitting: boolean;
  /** 0 standing .. 1 seated (camera height, collision-free window). */
  blend: number;
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function lerp3(a: Readonly<Vec3>, b: Readonly<Vec3>, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** One sit-down / stand-up of a body on a seat. */
export class SeatSequence {
  phase: SeatPhase = 'approach';
  private t = 0;
  private readonly walk: number;
  private standFrom: Vec3 = [0, 0, 0];
  private upT = 0;

  /** `from`: where the body stands when it starts (floor level). */
  constructor(
    readonly pose: SeatPose,
    private readonly from: Readonly<Vec3>,
    /** Where the stand-up ends (default: the pose's approach point). */
    private readonly exit: Readonly<Vec3> = pose.stand,
  ) {
    const dist = Math.hypot(pose.stand[0] - from[0], pose.stand[2] - from[2]);
    this.walk = Math.min(APPROACH_MAX, dist / APPROACH_SPEED);
    if (this.walk < 0.05) this.phase = 'turn';
  }

  get seated(): boolean {
    return this.phase === 'seated';
  }

  /** True once the stand-up has finished (the owner gives the body back to the capsule). */
  get finished(): boolean {
    return this.phase === 'done';
  }

  /** True while the body can be asked to stand up (seated or lowering). */
  get canStand(): boolean {
    return this.phase === 'seated' || this.phase === 'down';
  }

  /** Begin standing up (from seated; while lowering it waits until the lowering ends). */
  standUp(): void {
    if (this.phase === 'seated') this.begin();
    else if (this.phase === 'down') this.pendingStand = true;
    else if (this.phase === 'approach' || this.phase === 'turn') this.phase = 'done';
  }

  private pendingStand = false;

  private begin(): void {
    this.phase = 'up';
    this.upT = 0;
    this.standFrom = [this.pose.floor[0], this.pose.floor[1], this.pose.floor[2]];
  }

  /** Advance by `dt` seconds and return the body. */
  update(dt: number): SeatFrame {
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
    const p = this.pose;
    const stand: Vec3 = [p.stand[0], p.floor[1], p.stand[2]];
    switch (this.phase) {
      case 'approach': {
        this.t += step;
        const k = this.walk > 0 ? Math.min(1, this.t / this.walk) : 1;
        if (k >= 1) {
          this.phase = 'turn';
          this.t = 0;
        }
        return { phase: this.phase, position: lerp3([this.from[0], p.floor[1], this.from[2]], stand, k), yawDeg: null, sitting: false, blend: 0 };
      }
      case 'turn': {
        this.t += step;
        if (this.t >= TURN_TIME) {
          this.phase = 'down';
          this.t = 0;
        }
        return { phase: this.phase, position: stand, yawDeg: p.yawDeg, sitting: false, blend: 0 };
      }
      case 'down': {
        this.t += step;
        const slide = smooth(0.12, 0.7, this.t / DOWN_TIME);
        const seatFloor: Vec3 = [p.floor[0], p.floor[1], p.floor[2]];
        if (this.t >= DOWN_TIME) {
          if (this.pendingStand) this.begin();
          else this.phase = 'seated';
        }
        return { phase: this.phase, position: lerp3(stand, seatFloor, slide), yawDeg: p.yawDeg, sitting: true, blend: smooth(0.2, 0.75, this.t / DOWN_TIME) };
      }
      case 'seated':
        return { phase: this.phase, position: [p.floor[0], p.floor[1], p.floor[2]], yawDeg: p.yawDeg, sitting: true, blend: 1 };
      case 'up': {
        this.upT += step;
        const slide = smooth(0.25, 0.85, this.upT / UP_TIME);
        const exit: Vec3 = [this.exit[0], p.floor[1], this.exit[2]];
        if (this.upT >= UP_TIME) this.phase = 'done';
        return { phase: this.phase, position: lerp3(this.standFrom, exit, slide), yawDeg: p.yawDeg, sitting: false, blend: 1 - smooth(0.2, 0.8, this.upT / UP_TIME) };
      }
      default:
        return { phase: 'done', position: [this.exit[0], this.pose.floor[1], this.exit[2]], yawDeg: null, sitting: false, blend: 0 };
    }
  }
}
