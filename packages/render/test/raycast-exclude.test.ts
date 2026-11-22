/**
 * raycastWorld's excluded entities are left out of the traversal, not tested and dropped afterwards: the guide's rays
 * (which skip her) used to test every triangle of her skinned body on the CPU.
 */
import { describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Raycaster, Vector3, type Intersection, type Object3D } from 'three';
import { WorldRenderer } from '../src/world-renderer';
import { ENTITY_ID_KEY } from '../src/sync/entity-node';

function entity(id: string, z: number, objects: Map<string, Object3D>): { group: Group; mesh: Mesh } {
  const group = new Group();
  group.userData[ENTITY_ID_KEY] = id;
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  mesh.position.z = z;
  group.add(mesh);
  objects.set(id, group);
  return { group, mesh };
}

describe('raycastWorld exclusions', () => {
  it('does not test an excluded entity, but tests an entity nested in it', () => {
    const objects = new Map<string, Object3D>();
    const root = new Group();
    const a = entity('guide', -2, objects);
    const b = entity('held', -4, objects);
    const c = entity('wall', -6, objects);
    a.group.add(b.group);
    root.add(a.group, c.group);
    root.updateMatrixWorld(true);
    const spy = vi.spyOn(a.mesh, 'raycast');
    const ray = new Raycaster(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
    const out: Intersection[] = [];
    const proto = WorldRenderer.prototype as unknown as { intersectExcept: (...a: unknown[]) => void };
    const self = { sync: { object: (id: string) => objects.get(id) }, intersectExcept: proto.intersectExcept };
    self.intersectExcept(ray, root, new Set(['guide']), false, out);
    expect(spy).not.toHaveBeenCalled();
    expect(new Set(out.map((h) => h.object))).toEqual(new Set([b.mesh, c.mesh]));
  });
});
