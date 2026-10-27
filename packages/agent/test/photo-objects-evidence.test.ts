import { describe, expect, it } from 'vitest';
import { planDeltaOfWorld, planDelta, projectPoint, unprojectToPlane, type ReviewPose } from '@aether/arch';
import type { Vec3, WorldDoc } from '@aether/core';
import { worldShiftFor } from '../src/photo/objects-evidence';

const pose: ReviewPose = { name: 'cam', label: 'cam', kind: 'corner', position: [0.5, 1.4, 5], target: [2.5, 1.0, 0.5], up: [0, 1, 0], fov: 70, hideTops: false } as unknown as ReviewPose;
const ASPECT = 1.5;
const near = (a: Vec3, b: Vec3, tol = 0.01): void => {
  for (let i = 0; i < 3; i++) expect(Math.abs((a[i] as number) - (b[i] as number))).toBeLessThan(tol);
};

describe('unprojecting a photo box onto the piece\'s own plane', () => {
  it('recovers the shift of a standing piece on the floor from where its base appears', () => {
    const base: Vec3 = [2, 0, 2];
    const want: Vec3 = [0.35, 0, -0.1];
    const target = projectPoint(pose, ASPECT, [base[0] + want[0], base[1] + want[1], base[2] + want[2]])!;
    const shift = worldShiftFor(pose, ASPECT, base, [target.x, target.y], 'floor')!;
    near(shift, want);
  });

  it('recovers the shift of a wall piece inside its wall plane (along the wall and up)', () => {
    const centre: Vec3 = [2.5, 1.5, 0];
    const want: Vec3 = [-0.4, 0.2, 0];
    const target = projectPoint(pose, ASPECT, [centre[0] + want[0], centre[1] + want[1], centre[2]])!;
    const shift = worldShiftFor(pose, ASPECT, centre, [target.x, target.y], { normal: [0, 0, 1] })!;
    near(shift, want);
    // A suggestion on the wall plane never moves the piece off the wall.
    expect(Math.abs(shift[2])).toBeLessThan(1e-6);
  });

  it('gives no answer for a point behind the camera or a ray parallel to the plane', () => {
    expect(unprojectToPlane(pose, ASPECT, 0.5, 0.5, { point: [0, 0, 0], normal: [0, 1, 0] })).not.toBeNull();
    expect(unprojectToPlane(pose, ASPECT, 0.5, 0.9, { point: [0, 30, 0], normal: [0, 1, 0] })).toBeNull();
    expect(worldShiftFor(pose, ASPECT, [2, 2.5, 2], [0.5, 0.5], { normal: [0, 1, 0] })).toBeNull();
  });

  it('plan displacement of a world displacement is the inverse of planDelta, also for a turned building', () => {
    const world = (yaw: number): WorldDoc => ({ entities: { b: { id: 'b', transform: { position: [3, 0, 4], rotation: [0, yaw, 0], scale: [1, 1, 1] } } } }) as unknown as WorldDoc;
    // Without a readable scene both return null; the round trip is exercised end to end in photo-objects.test.ts.
    expect(planDelta(world(30), 'b', [1, 0])).toBeNull();
    expect(planDeltaOfWorld(world(30), 'b', [1, 0, 0])).toBeNull();
  });
});
