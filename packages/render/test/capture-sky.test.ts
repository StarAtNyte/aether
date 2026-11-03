import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, type Camera } from 'three';
import { WorldRenderer } from '../src/world-renderer';
import { SKY_RADIUS, SkyDome } from '../src/environment/sky-dome';

type Pose = { position: [number, number, number]; target: [number, number, number]; up: [number, number, number]; fov: number };
const aimCapture = (WorldRenderer.prototype as unknown as { aimCapture(this: unknown, pose: Pose, aspect: number): void }).aimCapture;

/** Farthest point of the sky dome from the camera: the dome is drawn whole only while this stays inside the far plane. */
function farthestSky(sky: SkyDome, cam: PerspectiveCamera): number {
  return sky.group.position.distanceTo(cam.position) + SKY_RADIUS * sky.group.scale.x;
}

describe('capture poses and the camera-centred sky', () => {
  it('re-centres the sky on a pose far from the live camera, so no part of the dome falls past the far plane', () => {
    const sky = new SkyDome();
    const live = new PerspectiveCamera(60, 16 / 9, 0.1, 3000);
    live.position.set(117, 109, 292);
    sky.update(live);
    const state = { perspective: new PerspectiveCamera(), env: { update: (_dt: number, cam: Camera) => sky.update(cam) } };
    // The kart canyon's rooftops shot: 350 m from where the editor camera stood. The dome left on the live camera reached
    // ~2400 m from this pose against a 2250 m far plane, and the sky past it drew as a black dome over the canyon's end.
    aimCapture.call(state, { position: [74.7, 68, -55.1], target: [24.34, 0.05, 124], up: [0, 1, 0], fov: 55 }, 16 / 9);
    const cam = state.perspective;
    expect(cam.position.toArray()).toEqual([74.7, 68, -55.1]);
    expect(sky.group.position.distanceTo(cam.position)).toBe(0);
    expect(farthestSky(sky, cam)).toBeLessThanOrEqual(cam.far);
    sky.dispose();
  });
});
