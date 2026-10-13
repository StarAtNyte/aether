/**
 * Turns Rapier's per-collider event stream into per-ENTITY events.
 * Compound bodies touch with several colliders at once, so contacts are
 * reference-counted per entity pair: `collisionStart` fires on 0 → 1 and
 * `collisionEnd` on 1 → 0. Impulses come from contact-force events of the
 * same step (force × dt).
 *
 * Hot path: entity ids are interned to small integers once, and pairs are
 * keyed by one number (`kind · 2^50 + lo · 2^25 + hi`), so draining events
 * never builds strings. Snapshots still use the readable `"c\0a\0b"` keys.
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
/** Interned ids stay below 2^25 so a pair key fits exactly in a double (< 2^53). */
const ID_SPACE = 2 ** 25;
const PAIR_SPACE = ID_SPACE * ID_SPACE;
/** Kind multiplier: 0 = solid contact, 1 = sensor overlap. */
const SENSOR_KIND = 1;

/** Readable snapshot key of a pair (`a < b`), kept for snapshot compatibility. */
function stringKey(sensor: boolean, a: EntityId, b: EntityId): string {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return (sensor ? 's' : 'c') + SEP + lo + SEP + hi;
}

/** Stateful collector; one per PhysicsWorld. */
export class EventCollector {
  /** Active contact counts per numeric pair key. */
  private readonly counts = new Map<number, number>();
  /** Strongest impulse per (solid) pair key in the current step. */
  private readonly impulses = new Map<number, number>();
  private readonly ids = new Map<EntityId, number>();
  private readonly names: Array<EntityId | undefined> = [];
  private nextIndex = 0;
  private drainOut: PhysicsEvent[] = [];
  private drainMaps: EventMaps | null = null;
  private drainDt = 0;
  private drainEmit = true;

  /** Interned index of an entity id (stable while the id is known). */
  private index(id: EntityId): number {
    const known = this.ids.get(id);
    if (known !== undefined) return known;
    const i = this.nextIndex++;
    this.ids.set(id, i);
    this.names[i] = id;
    return i;
  }

  /** Re-number the ids that still have contacts (only after 2^25 distinct ids). */
  private compact(): void {
    const live = this.entries();
    this.ids.clear();
    this.names.length = 0;
    this.nextIndex = 0;
    this.load(live);
  }

  private pairKey(sensor: boolean, a: EntityId, b: EntityId): number {
    // Compact before interning so both indices come from the same numbering.
    if (this.nextIndex >= ID_SPACE - 2) this.compact();
    const ia = this.index(a);
    const ib = this.index(b);
    const lo = ia < ib ? ia : ib;
    const hi = ia < ib ? ib : ia;
    return (sensor ? SENSOR_KIND : 0) * PAIR_SPACE + lo * ID_SPACE + hi;
  }

  private readonly onForce = (ev: TempContactForceEvent): void => {
    const maps = this.drainMaps as EventMaps;
    const a = maps.owner.get(ev.collider1());
    const b = maps.owner.get(ev.collider2());
    if (a === undefined || b === undefined || a === b) return;
    const key = this.pairKey(false, a, b);
    const j = ev.totalForceMagnitude() * this.drainDt;
    if (j > (this.impulses.get(key) ?? 0)) this.impulses.set(key, j);
  };

  private readonly onCollision = (h1: number, h2: number, started: boolean): void => {
    const maps = this.drainMaps as EventMaps;
    const a = maps.owner.get(h1);
    const b = maps.owner.get(h2);
    if (a === undefined || b === undefined || a === b) return;
    const s1 = maps.sensors.has(h1);
    const sensor = s1 || maps.sensors.has(h2);
    const key = this.pairKey(sensor, a, b);
    const prev = this.counts.get(key) ?? 0;
    const next = started ? prev + 1 : Math.max(0, prev - 1);
    if (next === 0) this.counts.delete(key);
    else this.counts.set(key, next);
    if (started ? prev !== 0 : prev !== 1) return;
    if (!this.drainEmit && !sensor) return;
    const out = this.drainOut;
    if (sensor) {
      out.push({ type: started ? 'sensorEnter' : 'sensorExit', a: s1 ? a : b, b: s1 ? b : a });
    } else if (started) {
      const impulse = this.impulses.get(key);
      out.push(impulse !== undefined ? { type: 'collisionStart', a, b, impulse } : { type: 'collisionStart', a, b });
    } else {
      out.push({ type: 'collisionEnd', a, b });
    }
  };

  /**
   * Drain `queue` and append entity-level events to `out`.
   * When `emit` is false (priming step) contact counts are updated silently,
   * except sensor overlaps, which are still reported.
   */
  drain(queue: EventQueue, maps: EventMaps, dt: number, out: PhysicsEvent[], emit = true): void {
    this.impulses.clear();
    this.drainMaps = maps;
    this.drainDt = dt;
    this.drainOut = out;
    this.drainEmit = emit;
    try {
      queue.drainContactForceEvents(this.onForce);
      queue.drainCollisionEvents(this.onCollision);
    } finally {
      this.drainMaps = null;
      this.drainOut = [];
    }
  }

  /** Forget every contact involving `id` (called when an entity is removed). */
  forget(id: EntityId): void {
    const i = this.ids.get(id);
    if (i === undefined) return;
    for (const key of this.counts.keys()) {
      const pair = key % PAIR_SPACE;
      if (Math.floor(pair / ID_SPACE) === i || pair % ID_SPACE === i) this.counts.delete(key);
    }
    this.ids.delete(id);
    this.names[i] = undefined;
  }

  /** Number of active contact pairs (diagnostics, tests). */
  get activePairs(): number {
    return this.counts.size;
  }

  /** Serializable contact state (for snapshots), keyed `"c\0a\0b"` / `"s\0a\0b"` with `a < b`. */
  entries(): Array<[string, number]> {
    const out: Array<[string, number]> = [];
    for (const [key, v] of this.counts) {
      const sensor = key >= PAIR_SPACE;
      const pair = key % PAIR_SPACE;
      const a = this.names[Math.floor(pair / ID_SPACE)];
      const b = this.names[pair % ID_SPACE];
      if (a === undefined || b === undefined) continue;
      out.push([stringKey(sensor, a, b), v]);
    }
    return out;
  }

  /** Restore contact state from {@link entries}. Malformed keys are skipped. */
  load(entries: ReadonlyArray<readonly [string, number]>): void {
    this.counts.clear();
    for (const [k, v] of entries) {
      if (!(v > 0)) continue;
      const parts = k.split(SEP);
      if (parts.length !== 3 || (parts[0] !== 'c' && parts[0] !== 's')) continue;
      const a = parts[1] as string;
      const b = parts[2] as string;
      this.counts.set(this.pairKey(parts[0] === 's', a, b), v);
    }
  }
}
