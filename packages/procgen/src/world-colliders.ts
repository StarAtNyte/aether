import type { Entity, WorldDoc } from '@aether/core';
import { generate } from './generate';
import type { GeneratorCache } from './cache';
import type { ColliderDesc, SandboxRunner } from './types';

/** Most custom-generator entities whose colliders are built for one provider (the rest keep physics' placeholder box). */
const MAX_ENTITIES = 400;

/**
 * Colliders of the world's custom-generator entities, built by running their generators in `sandbox`: what the studio's renderer
 * hands physics, for hosts with no renderer (Node, the CLI). A generator that fails keeps physics' placeholder for that entity.
 * Returns a sync lookup, ready for `PhysicsWorld.create({ colliders })` or the level tools.
 */
export async function worldColliderProvider(world: WorldDoc, sandbox: SandboxRunner, cache?: GeneratorCache): Promise<(entity: Entity) => ColliderDesc[] | undefined> {
  const byId = new Map<string, ColliderDesc[]>();
  let n = 0;
  for (const id of Object.keys(world.entities)) {
    const e = world.entities[id] as Entity;
    if (e.template || e.shape.kind !== 'procedural' || !Object.hasOwn(world.generators, e.shape.generator)) continue;
    if (++n > MAX_ENTITIES) break;
    try {
      const out = await generate(e.shape, world, { sandbox, ...(cache ? { cache } : {}) });
      if (out.colliders.length > 0) byId.set(id, out.colliders);
    } catch {
      /* placeholder box */
    }
  }
  return (entity) => byId.get(entity.id);
}
