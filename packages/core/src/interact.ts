import type { Entity, InteractSpec } from './schema';

/**
 * How a player can use an entity by aiming at it and pressing E: its own `interact` spec, else the one a `toggle` behavior implies
 * (a switch that turns on and off). A world whose switch has the behavior but no spec is still usable by hand; before this a player
 * could not press it, though the logic worked when called directly.
 */
export function interactOf(entity: Pick<Entity, 'interact' | 'behaviors'>): InteractSpec | undefined {
  if (entity.interact) return entity.interact;
  return entity.behaviors.some((b) => b.enabled && b.type === 'toggle') ? { kind: 'switch' } : undefined;
}
