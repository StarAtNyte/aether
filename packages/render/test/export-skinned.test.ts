import { Bone, BoxGeometry, Float32BufferAttribute, Group, MeshStandardMaterial, Skeleton, SkinnedMesh, Uint16BufferAttribute } from 'three';
import { describe, expect, it } from 'vitest';
import { buildExportScene } from '../src/view/gltf-export';

describe('export of posed people', () => {
  it('bakes the current pose into skinned meshes instead of exporting the bind pose', () => {
    const geometry = new BoxGeometry(1, 1, 1);
    const n = geometry.getAttribute('position').count;
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Array(n * 4).fill(0), 4));
    geometry.setAttribute('skinWeight', new Float32BufferAttribute(Array.from({ length: n * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0)), 4));
    const bone = new Bone();
    const mesh = new SkinnedMesh(geometry, new MeshStandardMaterial());
    mesh.add(bone);
    mesh.bind(new Skeleton([bone]));
    const root = new Group();
    root.add(mesh);
    bone.position.set(0, 5, 0);
    root.updateMatrixWorld(true);
    const out = buildExportScene(root, null);
    const exported = out.root.children[0] as SkinnedMesh;
    expect(out.meshes).toBe(1);
    const ys = exported.geometry.getAttribute('position');
    let min = Infinity;
    for (let i = 0; i < ys.count; i++) min = Math.min(min, ys.getY(i));
    expect(min).toBeCloseTo(4.5, 3);
    out.dispose();
  });
});
