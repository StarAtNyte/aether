/**
 * Renderer colliders a verification worker cannot rebuild by itself: shapes
 * from model-written (or library) generators, which only ever run in the
 * generator sandbox, and imported models. Built-in generators and editable
 * meshes are rebuilt inside the worker from the document, so they are not
 * copied. The list is capped by {@link MAX_COLLIDER_FLOATS}; entities beyond
 * the cap fall back to physics' placeholder colliders (with a warning).
 */
import type { Entity, WorldDoc } from '@aether/core';
import type { ColliderProvider } from '@aether/physics';
import type { ColliderDesc } from '@aether/procgen';
import { colliderNumbers, MAX_COLLIDER_ENTITIES, MAX_COLLIDER_FLOATS, MAX_COLLIDERS_PER_ENTITY } from './protocol';

/** True when physics cannot derive this entity's colliders from the document alone. */
export function needsRendererColliders(world: WorldDoc, e: Entity): boolean {
  if (e.template) return false;
  if (e.shape.kind === 'model') return true;
  return e.shape.kind === 'procedural' && Object.hasOwn(world.generators, e.shape.generator);
}

/** Collect `[entityId, colliders]` pairs for a worker request (never throws). */
export function workerColliders(world: WorldDoc, provider: ColliderProvider | undefined): Array<[string, ColliderDesc[]]> {
  const out: Array<[string, ColliderDesc[]]> = [];
  if (!provider) return out;
  let numbers = 0;
  for (const id of Object.keys(world.entities)) {
    if (out.length >= MAX_COLLIDER_ENTITIES) break;
    const e = world.entities[id];
    if (!e || !needsRendererColliders(world, e)) continue;
    let descs: ColliderDesc[] | undefined;
    try {
      descs = provider(e);
    } catch {
      descs = undefined;
    }
    if (!Array.isArray(descs) || descs.length === 0) continue;
    const list = descs.slice(0, MAX_COLLIDERS_PER_ENTITY);
    const n = colliderNumbers([[id, list]]);
    if (numbers + n > MAX_COLLIDER_FLOATS) continue;
    numbers += n;
    out.push([id, list]);
  }
  return out;
}
