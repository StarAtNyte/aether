/**
 * {@link OpeningProbe} over a synced scene: what the topmost surface at a point in plan is (open ground, water or
 * something not to stand on) and the line of sight (see `sightline.ts`). Used to choose the opening view.
 */
import { Box3, Raycaster, Vector3, type Intersection, type Mesh, type Object3D } from 'three';
import { findWaterBodies, isWaterEntity, waterAt, type Entity, type EntityId, type Vec3 } from '@aether/core';
import type { SceneSync } from '../sync/scene-sync';
import { BATCHED_LAYER } from '../sync/static-batches';
import { SCENERY_GENERATORS } from './content-items';
import type { OpeningProbe, OpeningSurface } from './opening-view';
import { sceneSightTest } from './sightline';

/** Tags of entities that are ground to stand on. */
const GROUND_TAGS: ReadonlySet<string> = new Set([
  'ground', 'terrain', 'land', 'hill', 'island', 'road', 'roads', 'street', 'plaza', 'square', 'path', 'paths', 'floor', 'deck', 'beach',
  'sand', 'grass', 'lawn', 'park', 'garden', 'courtyard', 'terrace', 'pavement', 'sidewalk', 'bridge', 'dock', 'pier', 'quay', 'steps', 'stairs',
]);
/** Building roles one never opens on (a roof, a wall top, inside a room). */
const STANDABLE_ARCH_ROLES: ReadonlySet<string> = new Set(['site']);
/** Below this height an entity is a slab (a plaza, a platform, a road): a place to stand. */
const SLAB_HEIGHT = 1.5;
/** Above this horizontal extent an entity is landscape. */
const LAND_EXTENT = 40;

/**
 * The probe for `sync`'s current content. `ground` is the environment's ground plane (outside the synced root), if
 * any. The caller keeps world matrices current and the content at its full grown scale.
 */
export function sceneOpeningProbe(sync: SceneSync, ground: Object3D | null, top: number, bottom: number): OpeningProbe {
  const ray = new Raycaster();
  ray.layers.enable(BATCHED_LAYER);
  const hits: Intersection[] = [];
  const down = new Vector3(0, -1, 0);
  const from = new Vector3();
  const normal = new Vector3();
  const box = new Box3();
  const world = sync.world;
  const water = world ? findWaterBodies(world) : [];
  const kinds = new Map<EntityId, 'ground' | 'blocked' | 'size'>();
  const sized = new Map<EntityId, boolean>();
  const kindOf = (id: EntityId, e: Entity): 'ground' | 'blocked' | 'size' => {
    let k = kinds.get(id);
    if (k) return k;
    k = 'size';
    if (e.arch) k = STANDABLE_ARCH_ROLES.has(e.arch.role) ? 'ground' : 'blocked';
    else if (e.tags.some((t) => GROUND_TAGS.has(t)) || (e.shape.kind === 'procedural' && SCENERY_GENERATORS.has(e.shape.generator))) k = 'ground';
    // A piece of a building (a part under it) is never ground.
    for (let p = e.parent && world ? world.entities[e.parent] : undefined, hops = 0; p && hops < 8 && k !== 'blocked'; p = p.parent && world ? world.entities[p.parent] : undefined, hops++) {
      if (p.arch && !STANDABLE_ARCH_ROLES.has(p.arch.role)) k = 'blocked';
    }
    kinds.set(id, k);
    return k;
  };
  const flatOrWide = (id: EntityId, o: Object3D): boolean => {
    let v = sized.get(id);
    if (v !== undefined) return v;
    box.setFromObject(o);
    v = box.isEmpty() || box.max.y - box.min.y <= SLAB_HEIGHT || Math.max(box.max.x - box.min.x, box.max.z - box.min.z) >= LAND_EXTENT;
    sized.set(id, v);
    return v;
  };
  const surface = (x: number, z: number): OpeningSurface | null => {
    from.set(x, top, z);
    ray.set(from, down);
    ray.near = 0;
    ray.far = top - bottom;
    hits.length = 0;
    ray.intersectObject(sync.root, true, hits);
    if (ground) ray.intersectObject(ground, false, hits);
    hits.sort((a, b) => a.distance - b.distance);
    let out: OpeningSurface | null = null;
    for (const hit of hits) {
      if (!visible(hit.object) || hit.object.name === 'edit:components') continue;
      const y = hit.point.y;
      if (hit.object === ground) {
        out = { y, kind: 'ground' };
        break;
      }
      const id = sync.idOf(hit.object);
      const node = id ? sync.node(id) : undefined;
      const e = node?.entity;
      if (e && (isWaterEntity(e) || e.arch?.role === 'pool')) {
        out = { y, kind: 'water' };
        break;
      }
      const material = (hit.object as Partial<Mesh>).material;
      const first = Array.isArray(material) ? material[0] : material;
      // See-through surfaces (generated water, glass): not a place to stand.
      if (first && first.transparent && first.opacity <= 0.9) {
        out = { y, kind: 'water' };
        break;
      }
      if (hit.face) normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
      else normal.set(0, 1, 0);
      if (normal.y < 0.75) {
        out = { y, kind: 'blocked' };
        break;
      }
      const k = id && e ? kindOf(id, e) : 'size';
      out = { y, kind: k === 'ground' || (k === 'size' && (!node || flatOrWide(id as EntityId, node.object))) ? 'ground' : 'blocked' };
      break;
    }
    hits.length = 0;
    // Ground under a water surface (a riverbed, a sea floor) is in the water.
    const w = out && out.kind === 'ground' ? waterAt(water, x, z, out.y) : null;
    if (out && w && w.y > out.y + 0.05) out = { y: out.y, kind: 'water' };
    return out;
  };
  const underWater = (p: Vec3): boolean => {
    const w = waterAt(water, p[0], p[2], p[1]);
    return !!w && w.y > p[1];
  };
  return { surface, sight: sceneSightTest(sync), near: sceneSightTest(sync, new Set(), { scatter: false }), underWater };
}

function visible(object: Object3D): boolean {
  for (let o: Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}
