import { describe, expect, it } from 'vitest';
import { BackSide, BoxGeometry, Group, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import { modelColliderDescs } from '../src/geometry/model-colliders';

describe('model colliders', () => {
  it('collects solid triangles in the entity frame and skips outline shells and transparent cards', () => {
    const entity = new Group();
    entity.position.set(10, 0, 0);
    const floor = new Mesh(new PlaneGeometry(4, 4), new MeshBasicMaterial());
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 2;
    const outline = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ side: BackSide }));
    const card = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ transparent: true }));
    entity.add(floor, outline, card);
    const descs = modelColliderDescs(entity);
    expect(descs).toHaveLength(1);
    const d = descs[0]!;
    if (d.kind !== 'trimesh') throw new Error('not a trimesh');
    expect(d.indices.length).toBe(6);
    // Entity-local: the plane lies flat at y = 2, centred on the entity (its world offset is the entity's own).
    for (let i = 0; i < d.positions.length; i += 3) {
      expect(d.positions[i + 1]).toBeCloseTo(2);
      expect(Math.abs(d.positions[i] as number)).toBeCloseTo(2);
    }
  });

  it('is empty before the model loads', () => {
    expect(modelColliderDescs(new Group())).toEqual([]);
  });
});
