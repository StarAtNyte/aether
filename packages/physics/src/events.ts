/**
 * Turns Rapier's per-collider event stream into per-ENTITY events.
 * Compound bodies touch with several colliders at once, so contacts are
 * reference-counted per entity pair: `collisionStart` fires on 0 → 1 and
 * `collisionEnd` on 1 → 0. Impulses come from contact-force events of the
 * same step (force × dt).
 */
import type { EventQueue, TempContactForceEvent } from '@dimforge/rapier3d-compat';
import type { EntityId } from '@aether/core';
import type { PhysicsEvent } from './types';

/** Lookup tables owned by the PhysicsWorld. */
export interface EventMaps {
  owner: ReadonlyMap<number, EntityId>;
  sensors: ReadonlySet<number>;
}

const SEP = '\u0000';

function pairKey(a: EntityId, b: EntityId): string {
  return a < b ? a + SEP + b : b + SEP + a;
}

/** Stateful collector; one per PhysicsWorld. */
export class EventCollector {
  /** Active contact counts per entity pair ("a\0b" with a < b). */
  private readonly counts = new Map<string, number>();
  private readonly impulses = new Map<string, number>();

  /**
   * Drain `queue` and append entity-level events to `out`.
   * When `emit` is false (priming step) contact counts are updated silently,
   * except sensor overlaps, which are still reported.
   */
  drain(queue: EventQueue, maps: EventMaps, dt: number, out: PhysicsEvent[], emit = true): void {
    const impulses = this.impulses;
    impulses.clear();
    queue.drainContactForceEvents((ev: TempContactForceEvent) => {
      const a = maps.owner.get(ev.collider1());
      const b = maps.owner.get(ev.collider2());
      if (a === undefined || b === undefined || a === b) return;
      const key = pairKey(a, b);
      const j = ev.totalForceMagnitude() * dt;
      if (j > (impulses.get(key) ?? 0)) impulses.set(key, j);
    });
    queue.drainCollisionEvents((h1: number, h2: number, started: boolean) => {
      const a = maps.owner.get(h1);
      const b = maps.owner.get(h2);
      if (a === undefined || b === undefined || a === b) return;
      const s1 = maps.sensors.has(h1);
      const sensor = s1 || maps.sensors.has(h2);
      const key = (sensor ? 's' : 'c') + SEP + pairKey(a, b);
      const prev = this.counts.get(key) ?? 0;
      const next = started ? prev + 1 : Math.max(0, prev - 1);
      if (next === 0) this.counts.delete(key);
      else this.counts.set(key, next);
      if (started ? prev !== 0 : prev !== 1) return;
      if (!emit && !sensor) return;
      if (sensor) {
        out.push({ type: started ? 'sensorEnter' : 'sensorExit', a: s1 ? a : b, b: s1 ? b : a });
      } else if (started) {
        const impulse = impulses.get(pairKey(a, b));
        out.push(impulse !== undefined ? { type: 'collisionStart', a, b, impulse } : { type: 'collisionStart', a, b });
      } else {
        out.push({ type: 'collisionEnd', a, b });
      }
    });
  }

  /** Forget every contact involving `id` (called when an entity is removed). */
  forget(id: EntityId): void {
    for (const key of this.counts.keys()) {
      const parts = key.split(SEP);
      if (parts[1] === id || parts[2] === id) this.counts.delete(key);
    }
  }

  /** Serializable contact state (for snapshots). */
  entries(): Array<[string, number]> {
    return [...this.counts.entries()];
  }

  /** Restore contact state from {@link entries}. */
  load(entries: ReadonlyArray<readonly [string, number]>): void {
    this.counts.clear();
    for (const [k, v] of entries) if (v > 0) this.counts.set(k, v);
  }
}
