import { describe, expect, it } from 'vitest';
import { BufferAttribute, DoubleSide, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Ray, Raycaster, Vector3, type Intersection } from 'three';
import { bvhNearest, bvhRaycast, triangleBvh } from '../src/geometry/raycast-bvh';

/** The previous unbounded traversal followed by its exact world-space distance filter. */
function reference(mesh: Mesh, raycaster: Raycaster): { distance: number; triangle: number } | null {
  const tree = triangleBvh(mesh.geometry)!;
  const ray = raycaster.ray.clone().applyMatrix4(mesh.matrixWorld.clone().invert()), out = new Int32Array(1);
  const local = bvhNearest(tree, tree.positions, tree.index, ray, DoubleSide, out);
  if (local === Infinity) return null;
  const distance = ray.at(local, new Vector3()).applyMatrix4(mesh.matrixWorld).distanceTo(raycaster.ray.origin);
  return distance < raycaster.near || distance > raycaster.far ? null : { distance, triangle: out[0]! };
}

describe('finite BVH traversal', () => {
  it('skips every triangle beyond the limit and keeps the unlimited traversal API', () => {
    const g = new PlaneGeometry(20, 20, 64, 64), tree = triangleBvh(g)!;
    let reads = 0;
    const positions = new Proxy(tree.positions, { get(target, key) { if (typeof key === 'string' && /^\d+$/.test(key)) reads++; return Reflect.get(target, key); } });
    const ray = new Ray(new Vector3(.123, .456, 100), new Vector3(0, 0, -1)), out = new Int32Array(1);
    expect(bvhNearest(tree, positions, tree.index, ray, DoubleSide, out, 2)).toBe(Infinity);
    expect(out[0]).toBe(-1); expect(reads).toBe(0);
    expect(bvhNearest(tree, positions, tree.index, ray, DoubleSide, out)).toBeCloseTo(100);
    expect(reads).toBeGreaterThan(0); g.dispose();
  });
  it('matches the previous traversal across finite ranges, nonuniform scale, shear and large translations', () => {
    let seed = 17;
    const random = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
    const geometry = new PlaneGeometry(20, 20, 40, 40), position = geometry.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < position.count; i++) position.setZ(i, Math.sin(position.getX(i)) * .1);
    geometry.computeBoundingSphere();
    const material = new MeshBasicMaterial({ side: DoubleSide }), mesh = new Mesh(geometry, material);
    let accepted = 0, rejected = 0;
    for (let i = 0; i < 400; i++) {
      const large = i % 4 === 0 ? 1e9 : 0;
      mesh.matrixWorld.makeShear((random() - .5) * 2, (random() - .5) * 2, 0, (random() - .5), 0, 0);
      mesh.matrixWorld.premultiply(new Matrix4().makeScale((i % 5 === 0 ? -1 : 1) * (.05 + random() * 4), .1 + random() * 3, .02 + random() * 2));
      mesh.matrixWorld.setPosition(large + random() * 10, -large + random() * 10, large);
      const target = new Vector3((random() - .5) * 8, (random() - .5) * 8, 0).applyMatrix4(mesh.matrixWorld);
      const origin = target.clone().add(new Vector3(0, 0, .1 + random() * 200));
      const ray = new Raycaster(origin, target.clone().sub(origin).normalize(), i % 3 === 0 ? 1 : 0, i % 7 === 0 ? Infinity : random() * 220);
      if (i % 11 === 0) {
        const unlimited = reference(mesh, new Raycaster(origin, ray.ray.direction, 0, Infinity));
        if (unlimited) ray.far = unlimited.distance;
      }
      const a = reference(mesh, ray), b: Intersection[] = []; bvhRaycast.call(mesh, ray, b);
      expect(b.length).toBe(a ? 1 : 0);
      if (a) { accepted++; expect(b[0]!.distance).toBe(a.distance); expect(b[0]!.faceIndex).toBe(a.triangle); }
      else rejected++;
    }
    expect(accepted).toBeGreaterThan(100); expect(rejected).toBeGreaterThan(100);
    geometry.dispose(); material.dispose();
  });
  it('keeps exact far-boundary hits and refitted geometry with stale display bounds', () => {
    const g = new PlaneGeometry(20, 20, 32, 32), material = new MeshBasicMaterial({ side: DoubleSide }), mesh = new Mesh(g, material);
    mesh.updateMatrixWorld(true); triangleBvh(g);
    for (const z of [0, 100]) {
      const p = g.getAttribute('position') as BufferAttribute;
      for (let i = 0; i < p.count; i++) p.setZ(i, z);
      p.needsUpdate = true;
      const ray = new Raycaster(new Vector3(.123, .456, z + 10), new Vector3(0, 0, -1), 0, 10);
      const a = reference(mesh, ray), b: Intersection[] = []; bvhRaycast.call(mesh, ray, b);
      expect(a?.distance).toBe(10); expect(b[0]?.distance).toBe(10);
    }
    g.dispose(); material.dispose();
  });
});
