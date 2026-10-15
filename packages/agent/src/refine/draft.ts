/**
 * A copy-on-write draft of a world. Ops mutate the draft in plain code
 * ("entity.material.color = …"); the minimal patch list is then
 * `patchesBetween(before, draft.done())`, so a small edit is always exactly
 * the property-level difference, never a regeneration.
 */
import { hasOwn, isForbiddenKey, type Entity, type EntityId, type Json, type WorldDoc } from '@aether/core';

/** Deep clone of JSON-like data. */
export function clone<T>(v: T): T {
  return structuredClone(v);
}

/** Set a dotted path in an object, creating plain objects on the way (prototype-safe). */
export function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let cur: Record<string, unknown> = target;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i] as string;
    if (isForbiddenKey(k)) return;
    const next = hasOwn(cur, k) ? cur[k] : undefined;
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      const fresh: Record<string, unknown> = {};
      cur[k] = fresh;
      cur = fresh;
    } else cur = next as Record<string, unknown>;
  }
  const last = keys[keys.length - 1] as string;
  if (!isForbiddenKey(last)) cur[last] = value;
}

/** Leaves of a nested object as dotted paths (arrays and non-plain values are leaves). */
export function leafPaths(obj: Record<string, unknown>, prefix = '', out: Record<string, Json> = {}): Record<string, Json> {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const p = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) leafPaths(v as Record<string, unknown>, p, out);
    else out[p] = v as Json;
  }
  return out;
}

/** Copy-on-write world draft. */
export class Draft {
  /** The working world (entities map is private to the draft). */
  world: WorldDoc;
  private readonly owned = new Set<EntityId>();

  constructor(readonly base: WorldDoc) {
    this.world = { ...base, entities: { ...base.entities }, environment: base.environment, player: base.player, rules: base.rules, state: base.state, hud: base.hud };
  }

  /** Replace the whole working world (after an op that recompiled part of it). Entities stay copy-on-write. */
  replace(next: WorldDoc): void {
    this.world = { ...next, entities: { ...next.entities } };
    this.owned.clear();
  }

  /** A writable entity (cloned on first access). */
  entity(id: EntityId): Entity {
    const e = this.world.entities[id];
    if (!e) throw new RangeError(`unknown entity ${id}`);
    if (!this.owned.has(id)) {
      this.owned.add(id);
      this.world.entities[id] = clone(e);
    }
    return this.world.entities[id] as Entity;
  }

  /** Add a new entity. */
  add(e: Entity): void {
    this.owned.add(e.id);
    this.world.entities[e.id] = e;
  }

  /** Remove an entity (and optionally its descendants). */
  remove(id: EntityId, recursive = true): EntityId[] {
    const removed: EntityId[] = [];
    const stack = [id];
    while (stack.length > 0) {
      const cur = stack.pop() as EntityId;
      if (!hasOwn(this.world.entities, cur)) continue;
      removed.push(cur);
      delete this.world.entities[cur];
      if (recursive) for (const e of Object.values(this.world.entities)) if (e.parent === cur) stack.push(e.id);
    }
    return removed;
  }

  /** Edit the environment. */
  env(fn: (env: Record<string, unknown>) => void): void {
    const e = clone(this.world.environment) as unknown as Record<string, unknown>;
    fn(e);
    this.world.environment = e as unknown as WorldDoc['environment'];
  }

  /** Edit the player spec. */
  player(fn: (p: Record<string, unknown>) => void): void {
    const p = clone(this.world.player) as unknown as Record<string, unknown>;
    fn(p);
    this.world.player = p as unknown as WorldDoc['player'];
  }

  /** The finished world (a new object when anything changed). */
  done(): WorldDoc {
    return this.world;
  }
}
