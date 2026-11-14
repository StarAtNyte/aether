/**
 * Collects the per-entity world bounds that camera framing, fog scaling and
 * shadow fitting care about, from a {@link SceneSync}. Ground, sky, backdrop
 * scenery, terrain generators (mountains, islands, heightfields — even when a
 * world forgets to tag them) and huge entities are left out; decorative
 * layers (scatter patches, wide flat planes such as roads or lakes) get a
 * small weight so they do not drag the camera away from the set-pieces. A
 * world made only of scenery ("a mountain range") frames that scenery.
 */
import { Box3, Mesh, Vector3, type Object3D } from 'three';
import type { EntityId, Vec3 } from '@aether/core';
import type { SceneSync } from '../sync/scene-sync';
import type { FramingItem } from './framing';
import type { GroundSheet } from './edge-shy';

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

const _union = new Box3();
const isUnder = (o: Object3D, root: Object3D): boolean => {
  for (let p = o.parent; p; p = p.parent) if (p === root) return true;
  return false;
};

export function collectFramingItems(sync: SceneSync, focus: ReadonlySet<EntityId> = new Set(), opts: { buildingsOnly?: boolean } = {}): FramingItem[] {
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
  // Architecture's opening frames the buildings themselves: the valley or skyline around them would shrink them to a
  // dot, and so would a building's own site (garden, terrain), which hangs under it.
  if (opts.buildingsOnly && buildings.size > 0) {
    const own: FramingItem[] = [];
    for (const b of buildings) {
      _union.makeEmpty();
      sync.forEachNode((node) => {
        if (node.transient || !node.object.visible) return;
        if (node.object !== b && !isUnder(node.object, b)) return;
        const role = node.entity.arch?.role;
        if (role === 'site' || node.entity.tags.includes('terrain')) return;
        _box.setFromObject(node.content);
        if (!_box.isEmpty()) _union.union(_box);
      });
      if (!_union.isEmpty()) own.push({ min: _union.min.toArray() as Vec3, max: _union.max.toArray() as Vec3, focus: true });
    }
    if (own.length > 0) return own;
  }
  sync.forEachNode((node) => {
    if (node.transient || node.entity.template || !node.object.visible) return;
    if (buildings.size > 0 && (buildings.has(node.object) || inBuilding(node.object))) return;
    const focused = focus.has(node.id) || node.entity.tags.includes(FOCUS_TAG);
    const shape = node.entity.shape;
    const isScenery = !focused && (node.entity.tags.some((t) => FRAMING_EXCLUDED_TAGS.has(t)) || (shape.kind === 'procedural' && SCENERY_GENERATORS.has(shape.generator)));
    _box.setFromObject(node.content);
    if (_box.isEmpty()) return;
    const sx = _box.max.x - _box.min.x;
    const sy = _box.max.y - _box.min.y;
    const sz = _box.max.z - _box.min.z;
    const wide = Math.max(sx, sz);
    const item: FramingItem = { min: _box.min.toArray() as Vec3, max: _box.max.toArray() as Vec3 };
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
  });
  return items.length > 0 ? items : scenery;
}

/**
 * The terrain sheet of the world: the union of its terrain entities' boxes (tagged `terrain`, or the `terrain` generator),
 * or null without one. What an aerial view keeps its frame on (see `edge-shy.ts`).
 */
export function groundSheet(sync: SceneSync): GroundSheet | null {
  const sheet = new Box3();
  let color: string | undefined;
  sync.root.updateMatrixWorld(true);
  sync.forEachNode((node) => {
    if (node.transient || node.entity.template || !node.object.visible) return;
    const shape = node.entity.shape;
    if (!(node.entity.tags.includes('terrain') || (shape.kind === 'procedural' && shape.generator === 'terrain'))) return;
    _box.setFromObject(node.content);
    if (_box.isEmpty()) return;
    sheet.union(_box);
    const c = shape.kind === 'procedural' ? (shape.params as Record<string, unknown> | undefined)?.['color'] : undefined;
    if (color === undefined && typeof c === 'string') color = c;
  });
  if (sheet.isEmpty() || ![...sheet.min.toArray(), ...sheet.max.toArray()].every(Number.isFinite)) return null;
  return { minX: sheet.min.x, maxX: sheet.max.x, minZ: sheet.min.z, maxZ: sheet.max.z, minY: sheet.min.y, maxY: sheet.max.y, ...(color ? { color } : {}) };
}

/** World-space vertices of the terrain entities within 1.5 % of the sheet's rim (what the skirt reads its rim heights from). */
export function terrainRimVertices(sync: SceneSync, sheet: GroundSheet): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  const tx = (sheet.maxX - sheet.minX) * 0.015;
  const tz = (sheet.maxZ - sheet.minZ) * 0.015;
  const v = new Vector3();
  sync.forEachNode((node) => {
    if (node.transient || node.entity.template || !node.object.visible) return;
    const shape = node.entity.shape;
    if (!(node.entity.tags.includes('terrain') || (shape.kind === 'procedural' && shape.generator === 'terrain'))) return;
    node.content.traverse((o) => {
      const m = o as Mesh;
      const a = m.isMesh ? m.geometry.getAttribute('position') : undefined;
      if (!a) return;
      for (let i = 0; i < a.count; i++) {
        v.fromBufferAttribute(a, i).applyMatrix4(m.matrixWorld);
        if (v.x <= sheet.minX + tx || v.x >= sheet.maxX - tx || v.z <= sheet.minZ + tz || v.z >= sheet.maxZ - tz) out.push([v.x, v.y, v.z]);
      }
    });
  });
  return out;
}
