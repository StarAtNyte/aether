import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { captureNeedsResize, pixelsAreBlank } from '../src/view/capture';
import { BOOM_RADIUS, boomFreeDistance, CameraRig, MIN_FOLLOW_DISTANCE } from '../src/view/camera-rig';

/** A wall plane at world z = `z`: a segment crossing it hits it. */
function wallAtZ(z: number) {
  return (from: Vector3, to: Vector3): number => {
    if (!((from.z < z && to.z >= z) || (from.z > z && to.z <= z))) return Number.POSITIVE_INFINITY;
    return (Math.abs(z - from.z) / Math.abs(to.z - from.z)) * from.distanceTo(to);
  };
}

describe('boomFreeDistance', () => {
  it('is infinite in open space', () => {
    expect(boomFreeDistance(() => Number.POSITIVE_INFINITY, new Vector3(0, 1, 0), new Vector3(0, 3, 5))).toBe(Number.POSITIVE_INFINITY);
  });

  it('sees a wall that only the offset rays touch (a corner beside the boom)', () => {
    // A pillar covering x > 0.1: the centre ray at x = 0 passes, the rays offset by the lens radius hit it.
    const query = (from: Vector3, to: Vector3): number => (from.x > 0.1 || to.x > 0.1 ? 2 : Number.POSITIVE_INFINITY);
    expect(query(new Vector3(0, 0, 0), new Vector3(0, 0, 5))).toBe(Number.POSITIVE_INFINITY);
    expect(boomFreeDistance(query, new Vector3(0, 0, 0), new Vector3(0, 0, 5))).toBeLessThan(5);
    expect(BOOM_RADIUS).toBeGreaterThan(0.1);
  });

  it('compares offset hits after projecting them onto the boom axis', () => {
    let rays = 0;
    const radius = 1;
    const axisLength = 1;
    const rawOffset = 0.52;
    const projected = rawOffset * axisLength / Math.sqrt(axisLength * axisLength + (radius * 0.4) ** 2);
    const distance = boomFreeDistance(() => ++rays === 1 ? 0.5 : rawOffset, new Vector3(), new Vector3(0, 0, axisLength), radius);
    expect(projected).toBeLessThan(0.5);
    expect(distance).toBeCloseTo(projected, 12);
    expect(rays).toBe(5);
  });

  it.each([[0, 0.01, 0], [1, 2, 3], [-5, 1, 0.2], [0, 0, 5]])('projects ring distances consistently for boom direction %j', (x, y, z) => {
    const from = new Vector3(10, 20, -30);
    const to = from.clone().add(new Vector3(x, y, z));
    const fractions = [0.5, 0.25, 0.7, 0.5, 0.6];
    let ray = 0;
    const free = boomFreeDistance((a, b) => a.distanceTo(b) * fractions[ray++]!, from, to, 1);
    expect(free).toBeCloseTo(from.distanceTo(to) * 0.25, 11);
    expect(ray).toBe(5);
  });

  it('handles a vertical boom', () => {
    expect(boomFreeDistance(wallAtZ(0.5), new Vector3(0, 0, 0), new Vector3(0, 6, 0))).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('CameraRig chase against a wall', () => {
  function chase(wallZ: number) {
    const cam = new PerspectiveCamera();
    const rig = new CameraRig(cam, null);
    rig.occlusion = wallAtZ(wallZ);
    // yaw 0: the chase camera sits behind the player, at +z.
    rig.setMode('follow', (out) => {
      out.set(0, 0, 0);
      return 0;
    });
    return { cam, rig };
  }

  it('never ends a frame behind the wall', () => {
    const { cam, rig } = chase(3);
    for (let i = 0; i < 120; i++) {
      rig.update(1 / 60);
      expect(cam.position.z).toBeLessThan(3 + 1e-6);
    }
    expect(cam.position.distanceTo(new Vector3(0, 1.3, 0))).toBeGreaterThanOrEqual(MIN_FOLLOW_DISTANCE - 1e-6);
  });

  it('is in front of the wall on the very first frame (no ease-in through it)', () => {
    const { cam, rig } = chase(2.5);
    cam.position.set(0, 2.4, 5.5);
    rig.update(1 / 60);
    expect(cam.position.z).toBeLessThan(2.5);
  });
});

describe('captureNeedsResize', () => {
  it('uses the off-screen path only for captures of the viewport aspect that are not an upscale', () => {
    expect(captureNeedsResize(784, 836, 784, 836)).toBe(false);
    expect(captureNeedsResize(392, 418, 784, 836)).toBe(false);
    expect(captureNeedsResize(1568, 1672, 784, 836)).toBe(true);
    expect(captureNeedsResize(1600, 900, 784, 836)).toBe(true);
    expect(captureNeedsResize(800, 800, 784, 836)).toBe(true);
    expect(captureNeedsResize(0, 0, 784, 836)).toBe(false);
  });
});

describe('pixelsAreBlank', () => {
  it('flags transparent and black buffers and passes any frame with a lit pixel', () => {
    expect(pixelsAreBlank(new Uint8Array(64 * 64 * 4))).toBe(true);
    const black = new Uint8Array(64 * 64 * 4);
    for (let i = 3; i < black.length; i += 4) black[i] = 255;
    expect(pixelsAreBlank(black)).toBe(true);
    const night = black.slice();
    for (let i = 0; i < night.length; i += 4 * 7) night[i + 2] = 40;
    expect(pixelsAreBlank(night)).toBe(false);
    expect(pixelsAreBlank(new Uint8Array(0))).toBe(true);
  });
});

describe('CameraRig first-person step smoothing', () => {
  function fp() {
    const cam = new PerspectiveCamera();
    const rig = new CameraRig(cam, null);
    const target = new Vector3(0, 0, 0);
    rig.setMode('firstPerson', (out) => {
      out.copy(target);
      return 0;
    });
    return { cam, rig, target };
  }

  it('eases a stair step and settles on the new eye height', () => {
    const { cam, rig, target } = fp();
    rig.update(1 / 60);
    const y0 = cam.position.y;
    target.y = 0.3;
    rig.update(1 / 60);
    expect(cam.position.y).toBeGreaterThan(y0);
    expect(cam.position.y).toBeLessThan(y0 + 0.3);
    for (let i = 0; i < 60; i++) rig.update(1 / 60);
    expect(cam.position.y).toBeCloseTo(y0 + 0.3, 2);
  });

  it('passes a large vertical change through at once', () => {
    const { cam, rig, target } = fp();
    rig.update(1 / 60);
    target.y = 5;
    rig.update(1 / 60);
    expect(cam.position.y).toBeCloseTo(5 + rig.eyeHeight, 5);
  });
});
