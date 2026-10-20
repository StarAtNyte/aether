import { describe, expect, it } from 'vitest';
import { openestYaw } from '../src/raycast';

const hits = (b: number): boolean => b !== 0;
/** A wall of stone one block north of the origin (z = -2), open everywhere else. */
const wallNorth = (x: number, y: number, z: number): number => (z === -2 && y >= 0 && y < 4 ? 1 : 0);

describe('openestYaw', () => {
  it('keeps the preferred heading when it is open', () => {
    // Facing south (+z, yaw = pi) is open.
    expect(openestYaw(wallNorth, hits, 0.5, 0, 0.5, Math.PI)).toBe(Math.PI);
  });

  it('turns away from a wall in the face', () => {
    // Facing north (yaw 0, forward -z) stares at the wall 2.5 blocks away.
    const yaw = openestYaw(wallNorth, hits, 0.5, 0, 0.5, 0);
    const fz = -Math.cos(yaw);
    expect(fz).toBeGreaterThan(-0.5);
  });

  it('prefers the smaller turn when several headings are equally open', () => {
    const fully = (x: number, y: number, z: number): number => (z === -2 || x === 3 || x === -3 ? 1 : 0);
    const yaw = openestYaw(fully, hits, 0.5, 0, 0.5, 0.2);
    // Both east and west are walled at 3.5 blocks; south is open to the range.
    expect(Math.cos(yaw)).toBeLessThan(-0.7);
  });

  it('survives an enclosed spawn and bad options', () => {
    const closed = (): number => 1;
    expect(Number.isFinite(openestYaw(closed, hits, 0.5, 0, 0.5, 1, { steps: 1, range: 4 }))).toBe(true);
  });
});
