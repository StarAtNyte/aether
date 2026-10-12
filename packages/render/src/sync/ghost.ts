/**
 * Ghost preview: the subset of a proposed world that differs from the current
 * one (added or changed entities), flattened to world space so it can be drawn
 * translucently on top of the live scene without duplicating unchanged
 * entities.
 */
import { diffWorlds, quatToEulerDeg, worldTransform, type Entity, type EntityId, type WorldDoc } from '@aether/core';
import { renderableIds } from './renderable';

/** Max entities shown in a ghost preview. */
export const MAX_GHOST_ENTITIES = 2000;

/**
 * Build the preview world: entities of `proposed` that are new or changed
 * relative to `current` (all renderable entities when `current` is null),
 * re-parented to the root with their world transforms, without lights or
 * physics. Environment and generators come from `proposed`.
 */
export function ghostWorld(current: WorldDoc | null, proposed: WorldDoc): WorldDoc {
  const renderable = renderableIds(proposed);
  let ids: EntityId[];
  if (current) {
    const d = diffWorlds(current, proposed);
    ids = [...d.added, ...d.changed];
  } else {
    ids = Object.keys(proposed.entities);
  }
  const entities: Record<EntityId, Entity> = {};
  let n = 0;
  for (const id of ids) {
    if (n >= MAX_GHOST_ENTITIES) break;
    const e = proposed.entities[id];
    if (!e || !renderable.has(id)) continue;
    let transform = e.transform;
    if (e.parent !== null) {
      try {
        const wt = worldTransform(proposed, id);
        transform = { position: wt.position, rotation: quatToEulerDeg(wt.quaternion), scale: wt.scale };
      } catch {
        continue;
      }
    }
    const flat: Entity = { ...e, parent: null, transform };
    delete flat.light;
    delete flat.physics;
    entities[id] = flat;
    n++;
  }
  return { ...proposed, entities };
}
