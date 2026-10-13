import { describe, expect, it } from 'vitest';
import type { EventQueue, TempContactForceEvent } from '@dimforge/rapier3d-compat';
import { EventCollector, type EventMaps } from '../src/events';
import type { PhysicsEvent } from '../src/types';

/** Scripted stand-in for Rapier's EventQueue. */
function queue(collisions: Array<[number, number, boolean]>, forces: Array<[number, number, number]> = []): EventQueue {
  return {
    drainContactForceEvents(cb: (e: TempContactForceEvent) => void) {
      for (const [c1, c2, f] of forces) cb({ collider1: () => c1, collider2: () => c2, totalForceMagnitude: () => f } as unknown as TempContactForceEvent);
    },
    drainCollisionEvents(cb: (h1: number, h2: number, started: boolean) => void) {
      for (const [a, b, s] of collisions) cb(a, b, s);
    },
  } as unknown as EventQueue;
}

const maps: EventMaps = {
  // Colliders 1 and 2 belong to 'cart' (a compound body), 3 to 'wall', 4 is the sensor 'zone'.
  owner: new Map([
    [1, 'cart'],
    [2, 'cart'],
    [3, 'wall'],
    [4, 'zone'],
  ]),
  sensors: new Set([4]),
};

describe('EventCollector', () => {
  it('reference-counts compound contacts per entity pair (start on 0→1, end on 1→0)', () => {
    const c = new EventCollector();
    const out: PhysicsEvent[] = [];
    c.drain(queue([[1, 3, true], [2, 3, true]], [[1, 3, 300]]), maps, 1 / 60, out);
    expect(out).toEqual([{ type: 'collisionStart', a: 'cart', b: 'wall', impulse: 5 }]);
    out.length = 0;
    c.drain(queue([[1, 3, false]]), maps, 1 / 60, out);
    expect(out).toEqual([]);
    c.drain(queue([[3, 2, false]]), maps, 1 / 60, out);
    expect(out).toEqual([{ type: 'collisionEnd', a: 'wall', b: 'cart' }]);
    expect(c.activePairs).toBe(0);
  });

  it('reports sensors with the sensor entity first and keeps them apart from solid contacts', () => {
    const c = new EventCollector();
    const out: PhysicsEvent[] = [];
    c.drain(queue([[1, 4, true], [4, 3, true]]), maps, 1 / 60, out);
    expect(out).toEqual([
      { type: 'sensorEnter', a: 'zone', b: 'cart' },
      { type: 'sensorEnter', a: 'zone', b: 'wall' },
    ]);
    out.length = 0;
    // A solid contact between the same entities is a separate pair.
    c.drain(queue([[1, 3, true]]), maps, 1 / 60, out, false);
    expect(out).toEqual([]);
    expect(c.activePairs).toBe(3);
  });

  it('snapshots use the readable "c\\0a\\0b" keys and round-trip through load()', () => {
    const c = new EventCollector();
    c.drain(queue([[1, 3, true], [2, 3, true], [4, 1, true]]), maps, 1 / 60, []);
    const entries = c.entries().sort();
    expect(entries).toEqual([
      ['c\u0000cart\u0000wall', 2],
      ['s\u0000cart\u0000zone', 1],
    ]);
    const d = new EventCollector();
    d.load([...entries, ['bogus', 3], ['c\u0000x', 1], ['c\u0000a\u0000b', 0]]);
    expect(d.entries().sort()).toEqual(entries);
    const out: PhysicsEvent[] = [];
    d.drain(queue([[1, 3, false], [2, 3, false]]), maps, 1 / 60, out);
    expect(out).toEqual([{ type: 'collisionEnd', a: 'cart', b: 'wall' }]);
  });

  it('forget() drops every contact of a removed entity', () => {
    const c = new EventCollector();
    c.drain(queue([[1, 3, true], [4, 3, true], [4, 1, true]]), maps, 1 / 60, []);
    c.forget('wall');
    expect(c.entries()).toEqual([['s\u0000cart\u0000zone', 1]]);
    c.forget('unknown');
    expect(c.activePairs).toBe(1);
  });

  it('ignores self contacts and colliders without an owner', () => {
    const c = new EventCollector();
    const out: PhysicsEvent[] = [];
    c.drain(queue([[1, 2, true], [9, 3, true]]), maps, 1 / 60, out);
    expect(out).toEqual([]);
    expect(c.activePairs).toBe(0);
  });
});

describe('EventCollector allocation probe', () => {
  it('draining steady contacts (force events, no state change) builds no key strings', async () => {
    const { probeAllocations, describeSites } = await import('../../../tests/unit/alloc-probe');
    const c = new EventCollector();
    c.drain(queue([[1, 3, true]]), maps, 1 / 60, []);
    // 64 steady contact-force events per step between already-touching bodies.
    const forces: Array<[number, number, number]> = Array.from({ length: 64 }, (_, i) => [1 + (i % 2), 3, 100 + i]);
    const forceEvents = forces.map(([c1, c2, f]) => ({ collider1: () => c1, collider2: () => c2, totalForceMagnitude: () => f }) as unknown as TempContactForceEvent);
    const steady = {
      drainContactForceEvents(cb: (e: TempContactForceEvent) => void) {
        for (let i = 0; i < forceEvents.length; i++) cb(forceEvents[i] as TempContactForceEvent);
      },
      drainCollisionEvents() {},
    } as unknown as EventQueue;
    const out: PhysicsEvent[] = [];
    const r = await probeAllocations(() => c.drain(steady, maps, 1 / 60, out), { iterations: 400, warmup: 40_000, match: /packages\/physics\/src\/events\.ts/ });
    expect(out).toHaveLength(0);
    expect(r.bytesPerIteration, describeSites(r)).toBeLessThan(16);
  });
});
