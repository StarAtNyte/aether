/**
 * Pure motion shaping for people: how far a body is seated, how the legs and arms read in the air, how deep a landing
 * absorbs. No three.js: the numbers are unit-tested, the rig applies them to bones.
 */

export const DEG = Math.PI / 180;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Height of the pelvis joint above the seat surface when seated (m, for a 1.8 m person). */
export const PELVIS_ABOVE_SEAT = 0.11;

/**
 * How much of the seat placement applies (0 standing, 1 seated) for a machine state and the clip time (seconds into the
 * captured clip). The pelvis settles onto the seat over the middle of the sit-down clip and leaves it as the stand-up
 * clip rises.
 */
export function seatBlendOf(state: string, clipTime: number): number {
  if (state === 'sit') return 1;
  if (state === 'sit_down') return smoothstep(0.3, 1.5, clipTime);
  if (state === 'stand_up') return 1 - smoothstep(0.3, 1.25, clipTime);
  return 0;
}

/** Seconds of the push-off during which the feet stay on the ground while the body leaves it. */
export const PUSH_OFF = 0.14;

/** What the legs and arms do in the air, all in radians (flexion positive) except the weights. */
export interface AirPose {
  /** 0..1 how tucked the legs are. */
  tuck: number;
  hipFlex: number;
  kneeFlex: number;
  /** Shoulder flexion of both arms: positive swings the arms forward and up, negative back. */
  armSwing: number;
  /** 0..1 weight of keeping the feet on the launch point (the push-off). */
  plant: number;
}

/**
 * Air pose from the physics: `vy` the vertical speed now, `peak` the greatest upward speed of this jump, `t` seconds
 * since leaving the ground, `kick` 0..1 of a second (double) jump burst. Rising tucks the legs up towards the apex, falling
 * reaches them down for the ground, with the arms swinging up and then out.
 */
export function airPoseOf(vy: number, peak: number, t: number, kick: number): AirPose {
  const up = Math.max(3, peak);
  const rising = vy >= 0;
  // 0 at take-off, 1 at the apex, back down to 0.3 as the fall speeds up (the legs reach for the floor).
  const tuck = rising ? smoothstep(0, 1, 1 - vy / up) : 1 - 0.7 * smoothstep(0, 6, -vy);
  const k = Math.max(tuck, kick);
  const push = 1 - smoothstep(0, PUSH_OFF, t);
  const plant = rising ? push : 0;
  const hipFlex = (8 + 52 * k) * DEG * (1 - push);
  const kneeFlex = (10 + 62 * k) * DEG * (1 - push) + 38 * DEG * push;
  const armSwing = rising ? (-20 + 65 * smoothstep(0, 0.5, t) - 30 * smoothstep(0.5, 1, 1 - vy / up)) * DEG : (25 - 25 * smoothstep(0, 5, -vy)) * DEG;
  return { tuck: k, hipFlex, kneeFlex, armSwing, plant };
}

/** Share of the captured landing crouch to keep for an impact speed (m/s): a hop barely bends, a drop absorbs fully. */
export function landKeep(impact: number): number {
  return clamp(0.22 + Math.max(0, impact) / 9, 0.25, 1);
}

/** Human joint ranges (radians) the animation must stay within: [min, max] of the flexion angle between the two segments. */
export const JOINT_RANGE = {
  knee: [0, 155 * DEG],
  elbow: [0, 160 * DEG],
  hip: [0, 135 * DEG],
  neckYaw: 80 * DEG,
  neckPitch: 55 * DEG,
} as const;

/** Arm pose of a lively jump: `swing` shoulder flexion (radians, positive forward and up), `tuck` how far the upper arms are brought in from the authored out-stretched pose. */
export interface ArmTarget {
  swing: number;
  tuck: number;
}

/**
 * Where the arms want to be in a jump: wound back for the push-off, thrown forward and up on take-off, held high while
 * rising, then opened out for balance while falling, and down at the sides once on the ground. Continuous in `t`, `vy`
 * and `peak` (no branch jumps), so a spring following it never snaps.
 */
export function jumpArmTarget(airborne: boolean, vy: number, peak: number, t: number): ArmTarget {
  if (!airborne) return { swing: 0, tuck: 0 };
  const up = Math.max(3, peak);
  const wind = 1 - smoothstep(0, 0.1, t);
  const throwUp = smoothstep(0.02, 0.3, t);
  // 0 while rising at full speed, 1 at the apex, and on to 2 as the fall speeds up.
  const arc = clamp(1 - vy / up, 0, 3);
  const fall = smoothstep(0.7, 1.4, arc);
  const swing = (-18 * wind + 72 * throwUp - 52 * fall) * DEG;
  const tuck = (30 + 4 * smoothstep(0, 1, arc) - 14 * fall) * DEG;
  return { swing, tuck };
}

/** Critically damped follower: moves towards a target with no overshoot and no jump, whatever the target does. */
export class ArmSpring {
  swing = 0;
  tuck = 0;
  private vs = 0;
  private vt = 0;

  /** `omega` stiffness (rad/s): about 12 settles in 0.3 s. */
  step(target: ArmTarget, dt: number, omega = 12): ArmTarget {
    this.swing = follow(this.swing, target.swing, omega, dt, (v) => (this.vs = v), this.vs);
    this.tuck = follow(this.tuck, target.tuck, omega, dt, (v) => (this.vt = v), this.vt);
    return { swing: this.swing, tuck: this.tuck };
  }

  get speed(): number {
    return Math.hypot(this.vs, this.vt);
  }
}

function follow(x: number, target: number, omega: number, dt: number, setV: (v: number) => void, v: number): number {
  const d = Math.min(dt, 0.05);
  const e = Math.exp(-omega * d);
  const dx = x - target;
  const tmp = (v + omega * dx) * d;
  setV((v - omega * tmp) * e);
  return target + (dx + tmp) * e;
}

/**
 * Position in the jump clip (0..1) from the physics: 0 at take-off, 0.5 at the apex, 1 on reaching the ground. Never
 * runs backwards (`prev`), so the clip plays once through the arc whatever the jump height or duration.
 */
export function jumpClipPhase(vy: number, peak: number, prev: number): number {
  const up = Math.max(3, peak);
  const p = clamp(0.5 * (1 - vy / up), 0, 1);
  return Math.max(prev, p);
}
