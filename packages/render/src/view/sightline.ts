/**
 * Line of sight through a synced scene, for choosing camera views: the distance along a segment before the
 * first visible, opaque document mesh (raycast, BVH-accelerated where the mesh has one) or the first tall
 * scatter instance (scattered trees are never raycast one by one; their coarse occluder boxes stand in, see
 * `occluders.ts`). See-through materials never block.
 */
import { Raycaster, Vector3, type Intersection, type Mesh, type Object3D } from 'three';
import type { Vec3 } from '@aether/core';
import type { SceneSync } from '../sync/scene-sync';
import { RAYCAST_LAYERS } from '../sync/static-batches';
import type { SightTest } from './framing';

/** Hits closer than this (m) to the segment start are ignored (the camera's own near plane). */
export const SIGHT_NEAR = 0.25;

/** A visible mesh whose material hides what is behind it. */
export function isOpaqueVisible(object: Object3D): boolean {
  for (let o: Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
  const material = (object as Partial<Mesh>).material;
  if (!material) return false;
  const first = Array.isArray(material) ? material[0] : material;
  return !first || !first.transparent || first.opacity > 0.9;
}

/**
 * {@link SightTest} over `sync`'s document content. `skip` makes objects (and everything under them) transparent
 * to the test: the subject of a shot does not hide itself. `scatter: false` leaves the coarse scatter occluders out
 * (they are boxes round whole patches: under them every short ray is blocked). `cover: true` counts ground cover as well
 * (tall grass, shrubs, flowers: see `SceneSync.coverOcclusion`), for what fills the foreground of a view from the ground.
 * The caller keeps world matrices current.
 */
export function sceneSightTest(sync: SceneSync, skip: ReadonlySet<Object3D> = new Set(), opts: { scatter?: boolean; cover?: boolean } = {}): SightTest {
  const scatter = opts.scatter !== false;
  const cover = opts.cover === true;
  const ray = new Raycaster();
  for (const l of RAYCAST_LAYERS) ray.layers.enable(l);
  const hits: Intersection[] = [];
  const a = new Vector3();
  const b = new Vector3();
  const dir = new Vector3();
  const skipped = (o: Object3D): boolean => {
    if (skip.size === 0) return false;
    for (let p: Object3D | null = o; p; p = p.parent) if (skip.has(p)) return true;
    return false;
  };
  return (from: Vec3, to: Vec3): number => {
    a.set(from[0], from[1], from[2]);
    b.set(to[0], to[1], to[2]);
    dir.subVectors(b, a);
    const length = dir.length();
    if (!(length > 1e-4)) return Number.POSITIVE_INFINITY;
    dir.multiplyScalar(1 / length);
    ray.set(a, dir);
    ray.near = SIGHT_NEAR;
    ray.far = length;
    hits.length = 0;
    ray.intersectObject(sync.root, true, hits);
    let free = Number.POSITIVE_INFINITY;
    for (const hit of hits) {
      if (!isOpaqueVisible(hit.object) || hit.object.name === 'edit:components' || skipped(hit.object)) continue;
      free = hit.distance;
      break;
    }
    hits.length = 0;
    if (!scatter) return free;
    const d = (cover ? sync.coverOcclusion(a, b) : sync.scatterOcclusion(a, b)) * length;
    if (d >= SIGHT_NEAR && d < free) free = d;
    return free;
  };
}
