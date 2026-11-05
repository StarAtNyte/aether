/**
 * The walking player's pace from the held keys: Shift (held) sprints, C toggles a crouch.
 *
 * `moveSpeed` in a world is the player's top speed, so a sprint is the full `moveSpeed` and the normal pace is a run at
 * {@link RUN_SHARE} of it. A crouch moves at {@link CROUCH_SHARE} (slow enough for the crouch walk to keep its feet planted
 * and quiet enough for guards not to hear). With a gun the body faces the aim: it sprints only forward, and backs off
 * slower than it runs. Pure, so the key map is unit-tested.
 */

/** Share of `moveSpeed` of the normal pace (a run). */
export const RUN_SHARE = 0.7;
/** Share of `moveSpeed` while crouched. */
export const CROUCH_SHARE = 0.35;
/** Fastest crouch walk (m/s): the crouch walk clip is captured at about 1 m/s and looks hurried above about 1.7. */
export const CROUCH_MAX_SPEED = 1.7;
/** Share of the run kept when walking backwards with a gun. */
export const BACKPEDAL_SHARE = 0.7;
/** How far the camera sinks while crouched (m). */
export const CROUCH_CAMERA_DROP = 0.5;

/** The input the pace needs (a subset of the logic's `InputState`). */
export interface PaceInput {
  forward: number;
  right: number;
  keys: ReadonlySet<string>;
}

/** Pace of one fixed step. */
export interface Pace {
  /** Share of `moveSpeed` to move at. */
  share: number;
  crouched: boolean;
  sprinting: boolean;
  /** C is down this step (pass back as `crouchKeyWasDown` next step). */
  crouchKey: boolean;
}

/**
 * @param wasCrouched crouch state of the last step
 * @param crouchKeyWasDown C was down at the last step (the toggle acts on the press, not while held)
 * @param grounded on the ground (a sprint can only start on the ground; in the air it keeps what it had)
 * @param wasSprinting sprint state of the last step
 */
export function playerPace(input: PaceInput, armed: boolean, wasCrouched: boolean, crouchKeyWasDown: boolean, grounded: boolean, wasSprinting: boolean): Pace {
  const k = input.keys;
  const crouchKey = k.has('KeyC');
  const shift = k.has('ShiftLeft') || k.has('ShiftRight');
  const moving = Math.abs(input.forward) > 0.1 || Math.abs(input.right) > 0.1;
  let crouched = wasCrouched;
  if (crouchKey && !crouchKeyWasDown) crouched = !crouched;
  // Sprinting stands a crouched player up, as in most games.
  const wantSprint = shift && moving && (!armed || input.forward > 0.3);
  if (wantSprint && !(crouchKey && !crouchKeyWasDown)) crouched = false;
  const sprinting = crouched ? false : grounded ? wantSprint : wasSprinting && shift && moving;
  let share = sprinting ? 1 : RUN_SHARE;
  if (crouched) share = CROUCH_SHARE;
  if (armed && !sprinting && input.forward < -0.1) share *= BACKPEDAL_SHARE;
  return { share, crouched, sprinting, crouchKey };
}

/** The crouch share capped at {@link CROUCH_MAX_SPEED} for a world's `moveSpeed`. */
export function paceSpeed(moveSpeed: number, pace: Pace): number {
  const v = moveSpeed * pace.share;
  return pace.crouched ? Math.min(v, CROUCH_MAX_SPEED) : v;
}
