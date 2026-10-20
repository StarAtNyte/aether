/**
 * The bot drives circuits (the racing line the world draws for its pace cars) and lets self-running machines run: a small oval with a
 * pace car, the Kart Canyon flagship, a vehicle world with no line to follow, and the Chain Reaction flagship that wins by itself.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createWorld, validateWorld, type EntityInput, type WorldDoc } from '@aether/core';
import { patrolLoops, playtest } from '../src';

/** A bundled flagship (the exact file the studio ships). */
function template(slug: string): WorldDoc {
  const raw = JSON.parse(readFileSync(new URL(`../../../apps/studio/public/templates/worlds/${slug}.json`, import.meta.url), 'utf8')) as { world: unknown };
  const r = validateWorld(raw.world);
  if (!r.ok) throw new Error(`${slug}: invalid template`);
  return r.world;
}

/** A flat floor, a drivable box with the vehicle behaviour, an optional pace-car loop and a zone half way round that wins. */
function oval(withLine: boolean): WorldDoc {
  const radius = 20;
  const ring = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2;
    return [Math.round(Math.cos(a) * radius * 100) / 100, 0.5, Math.round(-Math.sin(a) * radius * 100) / 100];
  });
  const entities: Record<string, EntityInput> = {
    floor: { id: 'floor', shape: { kind: 'primitive', primitive: 'box', size: [120, 1, 120] }, transform: { position: [0, -0.5, 0] }, physics: { body: 'static', friction: 0.9 } },
    kart: {
      id: 'kart',
      name: 'Test kart',
      shape: { kind: 'primitive', primitive: 'box', size: [1.2, 0.6, 2.2] },
      transform: { position: [radius, 0.5, 0] },
      physics: { body: 'dynamic', mass: 100, friction: 0.02, linearDamping: 0.2, angularDamping: 3 },
      behaviors: [{ type: 'vehicle', params: { maxSpeed: 22, acceleration: 12, brake: 24, drag: 3, turnRate: 115, grip: 7 } }],
    },
    half: { id: 'half', shape: { kind: 'primitive', primitive: 'box', size: [10, 3, 10] }, transform: { position: [-radius, 1, 0] }, physics: { body: 'static', sensor: true } },
  };
  if (withLine) {
    entities['pace'] = {
      id: 'pace',
      shape: { kind: 'primitive', primitive: 'box', size: [1, 0.5, 2] },
      transform: { position: [radius, 0.5, 0] },
      physics: { body: 'kinematic', sensor: true },
      behaviors: [{ type: 'patrol', params: { waypoints: ring, speed: 10, mode: 'loop', face: true } }],
    };
  }
  return createWorld({
    player: { mode: 'vehicle', controls: 'kart', spawn: [radius, 1, 6], moveSpeed: 6, jumpSpeed: 6 },
    entities,
    rules: [{ id: 'there', when: { on: 'enter', zone: 'half', who: 'kart' }, then: [{ do: 'win', text: 'Half way round' }], once: true }],
  });
}

describe('the vehicle driver', () => {
  it('finds the loop of a pace car in world space and nothing else', () => {
    const loops = patrolLoops(oval(true));
    expect(loops).toHaveLength(1);
    expect(loops[0]?.id).toBe('pace');
    expect(loops[0]?.points.length).toBe(12);
    expect(patrolLoops(oval(false))).toHaveLength(0);
  });

  it('drives a circuit on throttle and steering only and wins', async () => {
    const report = await playtest(oval(true));
    expect(report.status, report.summary).toBe('passed');
    expect(report.won).toBe(true);
    expect(report.summary).toMatch(/drove Test kart/);
    expect(report.seconds).toBeGreaterThan(3);
    // The ghost replay follows the vehicle, not the parked capsule.
    expect(report.trace?.frames).toBeGreaterThan(10);
    const last = report.trace?.poses.slice(-4);
    expect(Math.hypot((last?.[0] ?? 0) + 20, last?.[2] ?? 0)).toBeLessThan(12);
    expect(report.trace?.poses[1]).toBeGreaterThan(-5);
  }, 60_000);

  it('stays unsupported when the world draws no line to follow', async () => {
    const report = await playtest(oval(false));
    expect(report.status).toBe('unsupported');
    expect(report.summary).toMatch(/vehicle/);
  });

  it('reports a race that cannot be finished instead of passing it', async () => {
    const world = oval(true);
    // Wall the half-way zone off from the road: the kart reaches the line but the zone never fires.
    const walled = createWorld({ ...JSON.parse(JSON.stringify(world)), entities: { ...JSON.parse(JSON.stringify(world.entities)), half: { ...(world.entities['half'] as EntityInput), transform: { position: [-20, 1, 40] } } } });
    const report = await playtest(walled, { maxSimSeconds: 30 });
    expect(report.status).not.toBe('passed');
    expect(report.won).toBe(false);
  }, 60_000);

  it('drives the Kart Canyon flagship all the way round to the chequered flag', async () => {
    const report = await playtest(template('kart-canyon'), { trace: false });
    expect(report.status, report.summary).toBe('passed');
    expect(report.summary).toMatch(/drove Your kart/);
    expect(report.seconds).toBeGreaterThan(40);
    expect(report.seconds).toBeLessThan(200);
  }, 120_000);
});

describe('a machine that runs itself', () => {
  it('is let run on until it wins (Chain Reaction has nothing for the player to collect)', async () => {
    const report = await playtest(template('chain-reaction'), { trace: false });
    expect(report.status, report.summary).toBe('passed');
    expect(report.objectives).toHaveLength(0);
    expect(report.seconds).toBeGreaterThan(5);
  }, 120_000);
});
