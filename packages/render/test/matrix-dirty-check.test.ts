import { describe, expect, it } from 'vitest';
import { Group, Mesh, Object3D } from 'three';
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
});
