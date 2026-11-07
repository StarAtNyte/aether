/**
 * Collects the per-entity world bounds that camera framing, fog scaling and
 * shadow fitting care about, from a {@link SceneSync}. Ground, sky, backdrop
 * scenery, terrain generators (mountains, islands, heightfields — even when a
 * world forgets to tag them) and huge entities are left out; decorative
 * layers (scatter patches, wide flat planes such as roads or lakes) get a
 * small weight so they do not drag the camera away from the set-pieces. A
 * world made only of scenery ("a mountain range") frames that scenery.
 */
import { Box3, type Object3D } from 'three';
import type { EntityId, Vec3 } from '@aether/core';
import type { SceneSync } from '../sync/scene-sync';
import type { EntityNode } from '../sync/entity-node';

type EntityNodeView = Pick<Readonly<EntityNode>, 'id' | 'entity' | 'instances'>;

/**
 * The feature a tile entity belongs to (a procedural shape with `tile1 > tile0`: its generator, seed and other parameters),
 * or null for an entity that is not a tile.
 */
export function tileFeatureKey(e: Readonly<EntityNode['entity']>): string | null {
  const shape = e.shape;
  if (shape.kind !== 'procedural') return null;
  const { tile0, tile1, extent: _extent, ...rest } = shape.params as Record<string, unknown>;
  if (typeof tile0 !== 'number' || typeof tile1 !== 'number' || !(tile1 > tile0)) return null;
  const keys = Object.keys(rest).sort();
  return `${shape.generator}|${shape.seed ?? ''}|${e.parent ?? ''}|${JSON.stringify(keys.map((k) => [k, rest[k]]))}`;
}
import type { FramingItem } from './framing';

/** Entities with any of these tags never drive framing (unless explicitly focused). */
export const FRAMING_EXCLUDED_TAGS: ReadonlySet<string> = new Set(['backdrop', 'background', 'terrain', 'ground', 'sky', 'skybox']);
/** Tag that marks the entity a world wants the camera on. */
export const FOCUS_TAG = 'focus';
/** Built-in generators that make landscape scenery rather than set-pieces. */
export const SCENERY_GENERATORS: ReadonlySet<string> = new Set(['mountain', 'terrain', 'island']);
/** Horizontal extent (m) above which an unfocused entity counts as terrain and is ignored. */
export const HUGE_EXTENT = 120;
/** Wide (≥ this many metres) but low entities count as decorative ground cover. */
const FLAT_EXTENT = 25;
const FLAT_HEIGHT = 1.2;

const _box = new Box3();

/**
 * Framing items for every visible, non-template document entity. `focus`
 * marks additional entities as focused (e.g. the ones an edit just changed).
 */
/** Tags of the sights a viewpoint looks for (see `FramingItem.landmark`). */
const LANDMARK_TAGS: ReadonlySet<string> = new Set(['landmark', 'waterfall', 'temple', 'statue', 'monument', 'tower', 'lighthouse', 'castle', 'cathedral', 'church', 'shrine', 'pagoda', 'fountain', 'bridge']);

export function collectFramingItems(sync: SceneSync, focus: ReadonlySet<EntityId> = new Set()): FramingItem[] {
  const items: FramingItem[] = [];
  const scenery: FramingItem[] = [];
  sync.root.updateMatrixWorld(true);
  // A parametric building frames as one whole (its hundreds of walls and pieces would
  // otherwise pull the camera into the furniture).
  const buildings = new Set<Object3D>();
  sync.forEachNode((node) => {
    if (node.entity.arch?.role === 'building' && node.object.visible && !node.entity.template) buildings.add(node.object);
  });
  const inBuilding = (o: Object3D): boolean => {
    for (let p = o.parent; p; p = p.parent) if (buildings.has(p)) return true;
    return false;
  };
  for (const b of buildings) {
    _box.setFromObject(b);
    if (!_box.isEmpty()) items.push({ min: _box.min.toArray() as Vec3, max: _box.max.toArray() as Vec3, focus: true });
  }
  const add = (node: EntityNodeView, box: Box3): void => {
    const focused = focus.has(node.id) || node.entity.tags.includes(FOCUS_TAG);
    const shape = node.entity.shape;
    const isScenery = !focused && (node.entity.tags.some((t) => FRAMING_EXCLUDED_TAGS.has(t)) || (shape.kind === 'procedural' && SCENERY_GENERATORS.has(shape.generator)));
    const sx = box.max.x - box.min.x;
    const sy = box.max.y - box.min.y;
    const sz = box.max.z - box.min.z;
    const wide = Math.max(sx, sz);
    const item: FramingItem = { min: box.min.toArray() as Vec3, max: box.max.toArray() as Vec3 };
    if (isScenery || (!focused && wide > HUGE_EXTENT)) {
      scenery.push(item);
      return;
    }
    if (node.entity.tags.some((t) => LANDMARK_TAGS.has(t))) item.landmark = true;
    if (focused) item.focus = true;
    else if (node.instances > 0) {
      item.weight = 0.4;
      item.extent = 0.25;
    } else if (wide > FLAT_EXTENT && sy < FLAT_HEIGHT) {
      item.weight = 1;
      item.extent = 0.3;
    }
    items.push(item);
  };
  // The tiles of one long feature (a row of houses, a street: `tile0`/`tile1` parameters) frame as the feature they make.
  const tiles = new Map<string, { node: EntityNodeView; box: Box3 }>();
  sync.forEachNode((node) => {
    if (node.transient || node.entity.template || !node.object.visible) return;
    if (buildings.size > 0 && (buildings.has(node.object) || inBuilding(node.object))) return;
    _box.setFromObject(node.content);
    if (_box.isEmpty()) return;
    const key = tileFeatureKey(node.entity);
    if (key !== null) {
      const t = tiles.get(key);
      if (t) t.box.union(_box);
      else tiles.set(key, { node, box: _box.clone() });
      return;
    }
    add(node, _box);
  });
  for (const t of tiles.values()) add(t.node, t.box);
  return items.length > 0 ? items : scenery;
}
