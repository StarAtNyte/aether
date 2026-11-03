import { describe, expect, it } from 'vitest';
import { Bone, BoxGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, Skeleton, SkinnedMesh, Vector3 } from 'three';
import { installRenderPatches } from '../src/three-patches';

/**
 * The render patches must leave three's matrix updates alone: a child added under a parent that already moved (a player
 * avatar spawned under its rig) is drawn where the parent is, not at the world origin.
 */
describe('matrix updates under the render patches', () => {
  installRenderPatches({} as never);

  it('a child mesh added under a moved parent takes the parent position', () => {
    const scene = new Group();
    const rig = new Group();
    scene.add(rig);
    scene.updateMatrixWorld();
    rig.position.set(12, 0, -7);
    scene.updateMatrixWorld();
    const body = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    rig.add(body);
    scene.updateMatrixWorld();
    expect(body.getWorldPosition(new Vector3()).toArray()).toEqual([12, 0, -7]);
  });

  it('a skinned mesh and its bones built elsewhere and added under a moved parent follow it', () => {
    const scene = new Group();
    const rig = new Group();
    scene.add(rig);
    rig.position.set(-3, 2, 5);
    scene.updateMatrixWorld();
    const avatar = new Group();
    const root = new Bone();
    const hip = new Bone();
    hip.position.y = 1;
    root.add(hip);
    const skin = new SkinnedMesh(new BoxGeometry(), new MeshBasicMaterial());
    avatar.add(root, skin);
    skin.bind(new Skeleton([root, hip]));
    // Updated once on its own (at the origin), before it joins the rig.
    avatar.updateMatrixWorld(true);
    rig.add(avatar);
    scene.updateMatrixWorld();
    expect(skin.getWorldPosition(new Vector3()).toArray()).toEqual([-3, 2, 5]);
    expect(hip.getWorldPosition(new Vector3()).toArray()).toEqual([-3, 3, 5]);
    expect(skin.matrixWorld.equals(new Matrix4().makeTranslation(-3, 2, 5))).toBe(true);
  });
});
