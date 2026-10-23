/** Skinned assets are frustum culled by a widened pose-computed sphere (not drawn in every pass whatever the view). */
import { describe, expect, it } from 'vitest';
import { Bone, BoxGeometry, Float32BufferAttribute, Frustum, Group, Matrix4, MeshBasicMaterial, PerspectiveCamera, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3 } from 'three';
import { instantiateAsset } from '../src/geometry/model-loader';

function skinnedSource(): Group {
  const g = new BoxGeometry(1, 2, 1);
  const n = g.attributes['position']!.count;
  g.setAttribute('skinIndex', new Uint16BufferAttribute(new Array(n * 4).fill(0), 4));
  g.setAttribute('skinWeight', new Float32BufferAttribute(Array.from({ length: n * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0)), 4));
  const bone = new Bone();
  const mesh = new SkinnedMesh(g, new MeshBasicMaterial());
  mesh.add(bone);
  mesh.bind(new Skeleton([bone]));
  const root = new Group();
  root.add(mesh);
  return root;
}

describe('skinned asset bounds', () => {
  it('keeps frustum culling on with a widened sphere', () => {
    const asset = instantiateAsset(skinnedSource(), 1);
    const mesh = asset.children[0]!.children[0] as SkinnedMesh;
    expect(mesh.isSkinnedMesh).toBe(true);
    expect(mesh.frustumCulled).toBe(true);
    const b = mesh.boundingSphere!;
    // Bind-pose box of half-diagonal sqrt(0.25 + 1 + 0.25) = 1.22 m, widened by half plus half a metre.
    expect(b.radius).toBeGreaterThan(1.22 * 1.5);
  });

  it('is culled when behind the camera and kept when in view', () => {
    const asset = instantiateAsset(skinnedSource(), 1);
    const mesh = asset.children[0]!.children[0] as SkinnedMesh;
    const cam = new PerspectiveCamera(55, 1, 0.1, 100);
    cam.position.set(0, 0, 10);
    cam.updateMatrixWorld(true);
    const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    asset.position.set(0, 0, 0);
    asset.updateMatrixWorld(true);
    expect(frustum.intersectsObject(mesh)).toBe(true);
    asset.position.set(0, 0, 40);
    asset.updateMatrixWorld(true);
    expect(frustum.intersectsObject(mesh)).toBe(false);
    expect(new Vector3().setFromMatrixPosition(mesh.matrixWorld).z).toBe(40);
  });
});
