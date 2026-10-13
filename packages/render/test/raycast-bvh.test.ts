import { describe, expect, it } from 'vitest';
import { BackSide, BufferAttribute, BufferGeometry, DoubleSide, FrontSide, Mesh, MeshBasicMaterial, PlaneGeometry, Raycaster, SphereGeometry, Vector3, type Intersection, type Side } from 'three';
import { accelerateRaycast, bvhEligible, BVH_MIN_TRIANGLES, triangleBvh } from '../src/geometry/raycast-bvh';

/** Seeded PRNG (mulberry32). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bumpy terrain: a subdivided plane laid flat with sine hills. */
function terrain(segments: number): BufferGeometry {
  const g = new PlaneGeometry(40, 40, segments, segments);
  g.rotateX(-Math.PI / 2);
  const p = g.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setY(i, Math.sin(p.getX(i) * 0.4) * 2 + Math.cos(p.getZ(i) * 0.3) * 1.5);
  g.computeBoundingSphere();
  return g;
}

function nearestBrute(mesh: Mesh, ray: Raycaster): Intersection | undefined {
  const hits: Intersection[] = [];
  Mesh.prototype.raycast.call(mesh, ray, hits);
  hits.sort((a, b) => a.distance - b.distance);
  return hits[0];
}

function nearestBvh(mesh: Mesh, ray: Raycaster): Intersection | undefined {
  const hits: Intersection[] = [];
  mesh.raycast(ray, hits);
  return hits[0];
}

function randomRay(r: () => number, target = 18): Raycaster {
  const origin = new Vector3((r() - 0.5) * 60, 5 + r() * 30, (r() - 0.5) * 60);
  const aim = new Vector3((r() - 0.5) * target * 2, (r() - 0.5) * 4, (r() - 0.5) * target * 2);
  return new Raycaster(origin, aim.sub(origin).normalize());
}

describe('BVH raycast', () => {
  it('only accelerates large single-material meshes', () => {
    expect(bvhEligible(new Mesh(new SphereGeometry(1, 8, 6), new MeshBasicMaterial()))).toBe(false);
    const big = new Mesh(terrain(32), new MeshBasicMaterial());
    expect(bvhEligible(big)).toBe(true);
    const multi = new Mesh(terrain(32), [new MeshBasicMaterial(), new MeshBasicMaterial()]);
    expect(bvhEligible(multi)).toBe(false);
    const grouped = terrain(32);
    grouped.addGroup(0, 6, 0);
    expect(bvhEligible(new Mesh(grouped, new MeshBasicMaterial()))).toBe(false);
    expect(BVH_MIN_TRIANGLES).toBeGreaterThan(100);
  });

  for (const [label, side] of [['front', FrontSide], ['back', BackSide], ['double', DoubleSide]] as Array<[string, Side]>) {
    it(`returns three.js's nearest hit (${label} side, transformed mesh)`, () => {
      const mesh = new Mesh(terrain(48), new MeshBasicMaterial({ side }));
      mesh.position.set(3, -1, 2);
      mesh.rotation.set(0.1, 0.7, -0.05);
      mesh.scale.set(1.5, 0.8, 1.2);
      mesh.updateMatrixWorld(true);
      expect(accelerateRaycast(mesh)).toBe(true);
      const r = rng(side + 7);
      let hits = 0;
      for (let i = 0; i < 300; i++) {
        const ray = randomRay(r);
        const a = nearestBrute(mesh, ray);
        const b = nearestBvh(mesh, ray);
        expect(b === undefined, `ray ${i}`).toBe(a === undefined);
        if (!a || !b) continue;
        hits++;
        expect(b.distance).toBeCloseTo(a.distance, 4);
        expect(b.point.distanceTo(a.point)).toBeLessThan(1e-3);
        expect(b.faceIndex).toBe(a.faceIndex);
        expect([b.face?.a, b.face?.b, b.face?.c]).toEqual([a.face?.a, a.face?.b, a.face?.c]);
        expect(b.face?.normal.distanceTo(a.face?.normal ?? new Vector3())).toBeLessThan(1e-5);
        expect(b.object).toBe(mesh);
      }
      if (side !== BackSide) expect(hits).toBeGreaterThan(100);
    });
  }

  it('honours near/far and invisible materials', () => {
    const mesh = new Mesh(terrain(32), new MeshBasicMaterial());
    accelerateRaycast(mesh);
    mesh.updateMatrixWorld(true);
    const ray = new Raycaster(new Vector3(0, 30, 0), new Vector3(0, -1, 0));
    const full = nearestBvh(mesh, ray);
    expect(full).toBeDefined();
    ray.far = (full?.distance ?? 0) - 0.5;
    expect(nearestBvh(mesh, ray)).toBeUndefined();
    ray.far = Infinity;
    ray.near = (full?.distance ?? 0) + 0.5;
    expect(nearestBvh(mesh, ray)).toBeUndefined();
    ray.near = 0;
    (mesh.material as MeshBasicMaterial).visible = false;
    expect(nearestBvh(mesh, ray)).toBeUndefined();
  });

  it('refits after vertices move (mesh editing) and rebuilds when the index changes', () => {
    const g = terrain(32);
    const mesh = new Mesh(g, new MeshBasicMaterial());
    accelerateRaycast(mesh);
    mesh.updateMatrixWorld(true);
    const ray = new Raycaster(new Vector3(0.3, 50, 0.2), new Vector3(0, -1, 0));
    const before = nearestBvh(mesh, ray);
    const tree = triangleBvh(g);
    const p = g.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + 10);
    p.needsUpdate = true;
    g.computeBoundingSphere();
    const after = nearestBvh(mesh, ray);
    expect(triangleBvh(g)).toBe(tree); // refitted in place
    expect((before?.distance ?? 0) - (after?.distance ?? 0)).toBeCloseTo(10, 4);
    expect(after?.distance).toBeCloseTo(nearestBrute(mesh, ray)?.distance ?? -1, 4);
    const index = g.getIndex() as BufferAttribute;
    index.needsUpdate = true;
    expect(triangleBvh(g)).not.toBe(tree);
  });

  it('handles non-indexed geometry', () => {
    const g = terrain(24).toNonIndexed();
    g.computeBoundingSphere();
    const mesh = new Mesh(g, new MeshBasicMaterial());
    expect(accelerateRaycast(mesh)).toBe(true);
    mesh.updateMatrixWorld(true);
    const r = rng(3);
    for (let i = 0; i < 100; i++) {
      const ray = randomRay(r);
      const a = nearestBrute(mesh, ray);
      const b = nearestBvh(mesh, ray);
      expect(b === undefined).toBe(a === undefined);
      if (a && b) expect(b.distance).toBeCloseTo(a.distance, 4);
    }
  });

  it('is much faster than brute force on a 130k-triangle terrain', () => {
    const mesh = new Mesh(terrain(256), new MeshBasicMaterial());
    mesh.updateMatrixWorld(true);
    const rays = Array.from({ length: 60 }, ((r) => () => randomRay(r))(rng(11)));
    let t0 = performance.now();
    for (const ray of rays) nearestBrute(mesh, ray);
    const brute = performance.now() - t0;
    accelerateRaycast(mesh);
    t0 = performance.now();
    nearestBvh(mesh, rays[0] as Raycaster); // includes the lazy build
    const build = performance.now() - t0;
    t0 = performance.now();
    for (const ray of rays) nearestBvh(mesh, ray);
    const bvh = performance.now() - t0;
    // Recorded in docs/REVIEW_LOG.md; the assertion only guards against regressions.
    console.info(`raycast 131k tris: brute ${(brute / rays.length).toFixed(2)} ms/ray, bvh ${(bvh / rays.length).toFixed(3)} ms/ray, build ${build.toFixed(1)} ms`);
    expect(bvh * 10).toBeLessThan(brute);
  });
});
