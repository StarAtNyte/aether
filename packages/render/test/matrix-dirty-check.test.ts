import { describe, expect, it } from 'vitest';
import { Group, Mesh, Object3D, PerspectiveCamera, Vector3 } from 'three';
import { installMatrixDirtyCheck } from '../src/gpu/matrix-dirty-check';

installMatrixDirtyCheck();

describe('matrix dirty check', () => {
  it('gives the same world matrices as recomposing every frame', () => {
    const root = new Group();
    const a = new Group();
    const b = new Mesh();
    root.add(a);
    a.add(b);
    a.position.set(1, 2, 3);
    b.position.set(0, 1, 0);
    b.rotation.set(0.3, 0.2, 0.1);
    root.updateMatrixWorld();
    const first = b.matrixWorld.clone();
    // Nothing changed: same result.
    root.updateMatrixWorld();
    expect(b.matrixWorld.equals(first)).toBe(true);
    // A parent moves: the child follows.
    a.position.x = 5;
    root.updateMatrixWorld();
    const ref = new Object3D();
    ref.position.set(5, 2, 3);
    ref.updateMatrix();
    const child = new Object3D();
    child.position.set(0, 1, 0);
    child.rotation.set(0.3, 0.2, 0.1);
    child.updateMatrix();
    expect(b.matrixWorld.equals(ref.matrix.clone().multiply(child.matrix))).toBe(true);
    // The child itself turns.
    b.scale.set(2, 2, 2);
    root.updateMatrixWorld();
    child.scale.set(2, 2, 2);
    child.updateMatrix();
    expect(b.matrixWorld.equals(ref.matrix.clone().multiply(child.matrix))).toBe(true);
  });

  it('does not mark an unchanged object world-dirty', () => {
    const o = new Object3D();
    o.position.set(1, 1, 1);
    o.updateMatrixWorld();
    o.updateMatrixWorld();
    expect(o.matrixWorldNeedsUpdate).toBe(false);
  });
  it('recomposes a transform set back after a compose outside updateMatrixWorld (lookAt by orbit controls)', () => {
    // A capture sets the camera, orbit controls turn it (lookAt composes through updateWorldMatrix), the capture puts it back.
    const cam = new PerspectiveCamera();
    cam.position.set(15, 9, 14);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    const shot = cam.matrixWorld.clone();
    const pos = cam.position.clone(), quat = cam.quaternion.clone();
    cam.position.set(-20, 3, 5);
    cam.lookAt(new Vector3(40, 0, -30));
    cam.updateWorldMatrix(true, false);
    cam.position.copy(pos);
    cam.quaternion.copy(quat);
    cam.updateMatrixWorld();
    expect(cam.matrixWorld.equals(shot)).toBe(true);
  });
  it('keeps siblings in step after a parent chain was refreshed alone (a walking body\'s IK)', () => {
    const root = new Group();
    const body = new Group();
    const armBone = new Object3D();
    const legBone = new Object3D();
    root.add(body);
    body.add(armBone, legBone);
    legBone.position.set(0, -1, 0);
    root.updateMatrixWorld();
    // The body walks; IK reads the arm's world position before the frame's traversal (refreshes the chain, not its children).
    body.position.set(10, 0, 0);
    armBone.getWorldPosition(new Vector3());
    root.updateMatrixWorld();
    expect(new Vector3().setFromMatrixPosition(legBone.matrixWorld).x).toBeCloseTo(10);
  });
});
