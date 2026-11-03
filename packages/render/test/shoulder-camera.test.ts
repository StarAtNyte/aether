/**
 * The aiming camera of shooter worlds (`shoulder` mode) and the long gun people hold at the ready.
 */
import { Box3, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { buildProp } from '../src/characters/props';
import { CameraRig, SHOULDER_DISTANCE, SHOULDER_HEIGHT, SHOULDER_SIDE } from '../src/view/camera-rig';

function shoulder(yaw: number, pitch = 0): { cam: PerspectiveCamera; rig: CameraRig } {
  const cam = new PerspectiveCamera(60, 16 / 9, 0.1, 500);
  const rig = new CameraRig(cam, null);
  rig.setMode('shoulder', (out) => {
    out.set(0, 0, 0);
    return yaw;
  });
  rig.pitch = pitch;
  rig.update(1 / 60);
  cam.updateMatrixWorld(true);
  return { cam, rig };
}

describe('shoulder camera', () => {
  it('sits behind and to the right of the player at head height, looking along the heading', () => {
    const { cam } = shoulder(0);
    expect(cam.position.x).toBeCloseTo(SHOULDER_SIDE, 5);
    expect(cam.position.y).toBeCloseTo(SHOULDER_HEIGHT, 5);
    expect(cam.position.z).toBeCloseTo(SHOULDER_DISTANCE, 5);
    const dir = cam.getWorldDirection(new Vector3());
    expect(dir.z).toBeCloseTo(-1, 5);
  });

  it('turns with the yaw and pitches with the look (the screen centre is the aim)', () => {
    const { cam } = shoulder(Math.PI / 2, -0.3);
    const dir = cam.getWorldDirection(new Vector3());
    // Yaw 90 degrees faces -X; pitch down tilts the view down.
    expect(dir.x).toBeLessThan(-0.9);
    expect(dir.y).toBeCloseTo(Math.sin(-0.3), 4);
    // Looking down raises the camera behind the pivot.
    expect(cam.position.y).toBeGreaterThan(SHOULDER_HEIGHT);
  });

  it('is pulled in by a wall behind the player', () => {
    const cam = new PerspectiveCamera(60, 16 / 9, 0.1, 500);
    const rig = new CameraRig(cam, null);
    // A wall 1.2 m behind the player (at z = 1.2).
    rig.occlusion = (from, to) => ((from.z < 1.2 && to.z >= 1.2) ? ((1.2 - from.z) / (to.z - from.z)) * from.distanceTo(to) : Number.POSITIVE_INFINITY);
    rig.setMode('shoulder', (out) => {
      out.set(0, 0, 0);
      return 0;
    });
    rig.update(1 / 60);
    expect(cam.position.z).toBeLessThan(1.2);
    expect(cam.position.z).toBeGreaterThan(0.3);
  });
});

describe('rifle prop', () => {
  it('is a long gun held at the ready in both hands, muzzle forward (−Z)', () => {
    const prop = buildProp('rifle');
    expect(prop).not.toBeNull();
    expect(prop?.shouldered).toBeDefined();
    const box = new Box3().setFromObject(prop!.group);
    const size = box.getSize(new Vector3());
    expect(size.z).toBeGreaterThan(0.8);
    expect(size.z).toBeLessThan(1.2);
    expect(size.x).toBeLessThan(0.1);
    // The muzzle is far ahead of the grip, the stock a little behind it.
    expect(box.min.z).toBeLessThan(-0.6);
    expect(box.max.z).toBeLessThan(0.4);
    const s = prop!.shouldered!;
    expect(s.fore[2]).toBeLessThan(s.grip[2]);
    prop?.dispose();
  });
});
