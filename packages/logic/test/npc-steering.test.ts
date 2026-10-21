/**
 * Steering behaviours on the seeded stream (arrive, wander, separation, flocking), packs that keep together, roaming
 * that meanders inside its radius, and NPCs opening the doors they walk through.
 */
import { describe, expect, it } from 'vitest';
import { arriveSpeed, flockAdd, flockReset, flockSteer, separationPush, wanderDirection, type FlockSums, type WanderState } from '../src';
import { npcEntity, rig } from './npc-helpers';

/** A small seeded stream (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('steering behaviours', () => {
  it('arrive slows into the point and never exceeds the top speed', () => {
    expect(arriveSpeed(10, 1.5)).toBe(1.5);
    expect(arriveSpeed(0, 1.5)).toBe(0.5);
    expect(arriveSpeed(0.25, 1.5)).toBeCloseTo(0.9, 6);
    for (let d = 0; d < 2; d += 0.1) expect(arriveSpeed(d + 0.1, 3)).toBeGreaterThanOrEqual(arriveSpeed(d, 3));
  });

  it('wander turns a little at a time, the same way for the same seed', () => {
    const run = (seed: number): number[] => {
      const r = rng(seed);
      const s: WanderState = { theta: 0 };
      const out = new Float64Array(2);
      let hx = 1;
      let hz = 0;
      const headings: number[] = [];
      for (let i = 0; i < 600; i++) {
        wanderDirection(s, r, 1 / 60, hx, hz, out);
        // Unit directions, and no step turns more than a few degrees.
        expect(Math.hypot(out[0] as number, out[1] as number)).toBeCloseTo(1, 6);
        const turn = Math.abs(Math.atan2(hx * (out[1] as number) - hz * (out[0] as number), hx * (out[0] as number) + hz * (out[1] as number)));
        expect(turn).toBeLessThan(0.12);
        hx = out[0] as number;
        hz = out[1] as number;
        headings.push(Math.atan2(hz, hx));
      }
      return headings;
    };
    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
  });

  it('separation pushes apart within its radius, harder when closer; a flock pulls to its centre and its heading', () => {
    const out = new Float64Array(2);
    separationPush(0.5, 0, 1, out);
    const near = out[0] as number;
    separationPush(0.9, 0, 1, out);
    expect(near).toBeGreaterThan(out[0] as number);
    separationPush(1.2, 0, 1, out);
    expect(out[0]).toBe(0);
    const s: FlockSums = { n: 0, px: 0, pz: 0, hx: 0, hz: 0 };
    flockReset(s);
    flockSteer(s, 0, 0, out);
    expect([out[0], out[1]]).toEqual([0, 0]);
    flockAdd(s, 4, 0, 0, 1);
    flockAdd(s, 4, 2, 0, 1);
    flockSteer(s, 0, 0, out);
    // Toward the neighbours (+x) and along their heading (+z).
    expect(out[0]).toBeGreaterThan(0.5);
    expect(out[1]).toBeGreaterThan(0.5);
  });
});

describe('packs, roaming and doors', () => {
  /** Mean distance of a group from its centroid. */
  const spread = (pts: Array<[number, number]>): number => {
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    const cz = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    return pts.reduce((a, p) => a + Math.hypot(p[0] - cx, p[1] - cz), 0) / pts.length;
  };

  it('a herd with flock keeps closer together than the same herd without it', () => {
    const herd = (flock: number): number => {
      const ents = [];
      for (let i = 0; i < 6; i++) ents.push(npcEntity(`sheep${i}`, (i % 3) * 3 - 3, Math.floor(i / 3) * 3 - 1.5, { archetype: 'prey', faction: 'sheep', speed: 1.2, wander: 9, roam: true, flock }));
      const r = rig(ents);
      let total = 0;
      for (let k = 0; k < 12; k++) {
        r.run(2.5);
        total += spread(ents.map((e) => [r.at(e.id as string)[0], r.at(e.id as string)[2]] as [number, number]));
      }
      return total / 12;
    };
    expect(herd(0.9)).toBeLessThan(herd(0) * 0.85);
  });

  it('a roaming NPC meanders inside its radius without stopping', () => {
    const r = rig([npcEntity('fox', 0, 0, { archetype: 'villager', faction: 'wild', speed: 1.4, wander: 6, roam: true })]);
    let far = 0;
    let moving = 0;
    let prev = [...r.at('fox')] as [number, number, number];
    for (let i = 0; i < 120; i++) {
      r.run(0.25);
      const p = [...r.at('fox')] as [number, number, number];
      far = Math.max(far, Math.hypot(p[0], p[2]));
      if (Math.hypot(p[0] - prev[0], p[2] - prev[2]) > 0.05) moving++;
      prev = p;
    }
    expect(far).toBeGreaterThan(2);
    expect(far).toBeLessThan(6 * 1.25);
    expect(moving).toBeGreaterThan(100);
  });

  it('an NPC walking through a key-operated door opens it, and it closes behind', () => {
    const door = {
      id: 'door',
      shape: { kind: 'primitive', primitive: 'box', size: [1.4, 2.1, 0.05] },
      transform: { position: [0, 1.05, 0] },
      physics: { body: 'kinematic' },
      behaviors: [{ type: 'door', params: { trigger: 'key', key: 'e', radius: 1.8, motion: 'swing', swingAngle: 95, hinge: 'left', duration: 0.6 } }],
    };
    const walls = [
      { id: 'wl', shape: { kind: 'primitive', primitive: 'box', size: [4, 2.6, 0.12] }, transform: { position: [-2.7, 1.3, 0] }, physics: { body: 'static' } },
      { id: 'wr', shape: { kind: 'primitive', primitive: 'box', size: [4, 2.6, 0.12] }, transform: { position: [2.7, 1.3, 0] }, physics: { body: 'static' } },
    ];
    const r = rig([...walls, door, npcEntity('maid', 0, -4, { archetype: 'guard', faction: 'house', speed: 1.2, radius: 0.3, waypoints: [[0, 0, 4], [0, 0, -4]], patrol: { mode: 'loop', wait: 2 } })] as never);
    let opened = false;
    let crossed = false;
    for (let i = 0; i < 60 * 10; i++) {
      r.run(1 / 60);
      if (r.state('door.open') === true) opened = true;
      if (r.at('maid')[2] > 1) crossed = true;
      if (crossed && opened) break;
    }
    expect(opened).toBe(true);
    expect(crossed).toBe(true);
    // Once she is well past, the door swings shut again (it was closed before she came).
    r.run(3);
    expect(r.state('door.open')).toBe(false);
  });
});
