import { describe, expect, it } from 'vitest';
import { BACKPEDAL_SHARE, CROUCH_MAX_SPEED, CROUCH_SHARE, paceSpeed, playerPace, RUN_SHARE } from '../src/engine/playerPace';

const keys = (...k: string[]): ReadonlySet<string> => new Set(k);
const fwd = (...k: string[]) => ({ forward: 1, right: 0, keys: keys(...k) });

describe('player pace', () => {
  it('runs by default and sprints at the full move speed while Shift is held', () => {
    expect(playerPace(fwd(), false, false, false, true, false)).toMatchObject({ share: RUN_SHARE, sprinting: false, crouched: false });
    expect(playerPace(fwd('ShiftLeft'), false, false, false, true, false)).toMatchObject({ share: 1, sprinting: true });
    expect(playerPace(fwd('ShiftRight'), false, false, false, true, false).sprinting).toBe(true);
    // Shift alone, standing still, is not a sprint.
    expect(playerPace({ forward: 0, right: 0, keys: keys('ShiftLeft') }, false, false, false, true, false).sprinting).toBe(false);
  });

  it('toggles the crouch on the C press, not while it is held', () => {
    const down = playerPace(fwd('KeyC'), false, false, false, true, false);
    expect(down).toMatchObject({ crouched: true, crouchKey: true, share: CROUCH_SHARE });
    // Still held next step: stays crouched.
    expect(playerPace(fwd('KeyC'), false, true, true, true, false).crouched).toBe(true);
    // Released, then pressed again: stands.
    expect(playerPace(fwd(), false, true, true, true, false).crouched).toBe(true);
    expect(playerPace(fwd('KeyC'), false, true, false, true, false).crouched).toBe(false);
  });

  it('a sprint stands a crouched player up; Shift no longer crouches', () => {
    expect(playerPace(fwd('ShiftLeft'), false, true, false, true, false)).toMatchObject({ crouched: false, sprinting: true });
    expect(playerPace({ forward: 0, right: 0, keys: keys('ShiftLeft') }, false, false, false, true, false).crouched).toBe(false);
  });

  it('with a gun, sprints only forwards and backs off slower', () => {
    expect(playerPace({ forward: 0, right: 1, keys: keys('ShiftLeft') }, true, false, false, true, false).sprinting).toBe(false);
    expect(playerPace({ forward: -1, right: 0, keys: keys() }, true, false, false, true, false).share).toBeCloseTo(RUN_SHARE * BACKPEDAL_SHARE);
    expect(playerPace(fwd('ShiftLeft'), true, false, false, true, false).sprinting).toBe(true);
  });

  it('does not start a sprint in the air, and keeps one through a jump', () => {
    expect(playerPace(fwd('ShiftLeft'), false, false, false, false, false).sprinting).toBe(false);
    expect(playerPace(fwd('ShiftLeft'), false, false, false, false, true).sprinting).toBe(true);
  });

  it('caps the crouch walk speed', () => {
    const p = playerPace(fwd('KeyC'), false, false, false, true, false);
    expect(paceSpeed(6.5, p)).toBe(CROUCH_MAX_SPEED);
    expect(paceSpeed(4, p)).toBeCloseTo(4 * CROUCH_SHARE);
    expect(paceSpeed(5, playerPace(fwd(), false, false, false, true, false))).toBeCloseTo(5 * RUN_SHARE);
  });
});
