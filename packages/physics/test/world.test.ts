import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Entity, EntityInput, WorldDoc } from '@aether/core';
import { applyPatches, diffWorlds } from '@aether/core';
import type { ColliderDesc } from '@aether/procgen';
import { generateBuiltinSync } from '@aether/procgen';
import { GROUND_ID, initPhysics, isPhysicsReady, PhysicsWorld, type PhysicsEvent } from '../src/index';
import { ball, box, world } from './helpers';

const live: PhysicsWorld[] = [];
async function make(doc: WorldDoc, opts?: Parameters<typeof PhysicsWorld.create>[1]): Promise<PhysicsWorld> {
  const pw = await PhysicsWorld.create(doc, opts);
  live.push(pw);
  return pw;
}
function run(pw: PhysicsWorld, seconds: number): PhysicsEvent[] {
  const events: PhysicsEvent[] = [];
  const n = Math.round(seconds / pw.dt);
  for (let i = 0; i < n; i++) events.push(...pw.stepFixed());
  return events;
}

beforeAll(async () => {
  await Promise.all([initPhysics(), initPhysics()]);
});
afterEach(() => {
  for (const pw of live.splice(0)) pw.dispose();
});

describe('initialization', () => {
  it('is idempotent', async () => {
    await initPhysics();
    expect(isPhysicsReady()).toBe(true);
  });
});

describe('building and resting', () => {
  it('drops primitives onto the ground at the right height', async () => {
    const pw = await make(world([
      box('crate', [0, 3, 0], [1, 1, 1]),
      ball('marble', [3, 2, 0], 0.25),
      { id: 'can', shape: { kind: 'primitive', primitive: 'cylinder', size: [0.6, 0.8, 0.6] }, transform: { position: [-3, 2, 0] }, physics: { body: 'dynamic' } },
      { id: 'pill', shape: { kind: 'primitive', primitive: 'capsule', size: [0.5, 1.5, 0.5] }, transform: { position: [6, 3, 0] }, physics: { body: 'dynamic', lockRotation: true } },
      box('big', [-6, 4, 0], [1, 1, 1], { body: 'dynamic' }, { transform: { position: [-6, 4, 0], scale: [2, 2, 2] } }),
      box('wall', [0, 1, 5], [4, 2, 0.2], { body: 'static' }),
    ]));
    expect(pw.stats().bodies).toBe(6);
    expect(pw.dynamicIds().sort()).toEqual(['big', 'can', 'crate', 'marble', 'pill']);
    run(pw, 3);
    expect(pw.getState('crate')?.position[1]).toBeCloseTo(0.5, 1);
    expect(pw.getState('marble')?.position[1]).toBeCloseTo(0.25, 1);
    expect(pw.getState('can')?.position[1]).toBeCloseTo(0.4, 1);
    expect(pw.getState('pill')?.position[1]).toBeCloseTo(0.75, 1);
    expect(pw.getState('big')?.position[1]).toBeCloseTo(1, 1);
    expect(pw.getState('wall')?.position).toEqual([0, 1, 5]);
    expect(pw.getState('nope')).toBeUndefined();
    expect(pw.getAllStates().size).toBe(6);
  });

  it('honors gravity, null ground and templates', async () => {
    const pw = await make(world([box('a', [0, 1, 0], [1, 1, 1]), box('tpl', [0, 1, 0], [1, 1, 1], { body: 'dynamic' }, { template: true }), { id: 'tpl-child', parent: 'tpl', physics: { body: 'dynamic' }, shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] } }], {
      environment: { ground: null, gravity: [0, -1, 0] },
    }));
    expect(pw.has('tpl')).toBe(false);
    expect(pw.has('tpl-child')).toBe(false);
    run(pw, 1);
    // y = 1 - 0.5 * g * t² = 0.5 with no ground to stop it.
    expect(pw.getState('a')?.position[1]).toBeCloseTo(0.5, 1);
    expect(pw.raycast([0, 10, 0], [0, -1, 0], 100, 'a')).toBeNull();
  });

  it('places children by world transform and adds physics-less children as compound colliders', async () => {
    const doc = world([
      { id: 'table', shape: { kind: 'primitive', primitive: 'box', size: [2, 0.1, 1] }, transform: { position: [0, 1, 0] }, physics: { body: 'static' } },
      { id: 'leg', parent: 'table', shape: { kind: 'primitive', primitive: 'box', size: [0.1, 1, 0.1] }, transform: { position: [0.9, -0.5, 0] } },
      { id: 'cup', parent: 'table', shape: { kind: 'primitive', primitive: 'box', size: [0.2, 0.2, 0.2] }, transform: { position: [0, 0.5, 0] }, physics: { body: 'dynamic' } },
    ]);
    const pw = await make(doc);
    expect(pw.has('leg')).toBe(false);
    expect(pw.getState('cup')?.position).toEqual([0, 1.5, 0]);
    const hit = pw.raycast([0.9, 0.7, 2], [0, 0, -1], 10);
    expect(hit?.id).toBe('table'); // the leg collider belongs to the table body
    run(pw, 1.5);
    expect(pw.getState('cup')?.position[1]).toBeCloseTo(1.15, 1);
  });

  it('maps materials, mass and initial velocities', async () => {
    const pw = await make(world([
      box('heavy', [0, 0.5, 0], [1, 1, 1], { body: 'dynamic', mass: 50 }),
      box('light', [3, 0.5, 0], [1, 1, 1], { body: 'dynamic', density: 0.5 }),
      box('stone', [6, 0.5, 0], [1, 1, 1], { body: 'dynamic' }, { material: { preset: 'stone' } }),
      box('thrown', [-3, 2, 0], [0.2, 0.2, 0.2], { body: 'dynamic', initialVelocity: [5, 0, 0], ccd: true }),
      box('floaty', [-6, 2, 0], [0.2, 0.2, 0.2], { body: 'dynamic', gravityScale: 0 }),
    ]));
    const recs = pw._records();
    pw.stepFixed();
    expect(recs.get('heavy')?.body.mass()).toBeCloseTo(50, 3);
    expect(recs.get('light')?.body.mass()).toBeCloseTo(0.5, 3);
    expect(recs.get('stone')?.body.mass()).toBeCloseTo(2.4, 3);
    expect(pw.getVelocity('thrown')?.[0]).toBeCloseTo(5, 1);
    run(pw, 1);
    expect(pw.getState('floaty')?.position[1]).toBeCloseTo(2, 3);
  });
});

describe('heightfields', () => {
  // 4 cells along x (cols), 2 along z (rows): plateau of 0.75 * 2m between x = -2 and 2, ramps at the x edges.
  const rows = 2;
  const cols = 4;
  const heights = new Float32Array((rows + 1) * (cols + 1));
  for (let ix = 0; ix <= cols; ix++) for (let iz = 0; iz <= rows; iz++) heights[ix * (rows + 1) + iz] = ix === 0 || ix === cols ? 0 : 0.75;
  const hf: ColliderDesc = { kind: 'heightfield', rows, cols, heights, size: [8, 2, 4] };
  const terrain: EntityInput = { id: 'land', shape: { kind: 'procedural', generator: 'my-land' }, transform: { position: [10, 0, 0] }, physics: { body: 'static' } };

  it('lands a ball at the exact terrain height (row/col layout and scale)', async () => {
    const provider = (e: Entity): ColliderDesc[] | undefined => (e.id === 'land' ? [hf] : undefined);
    const pw = await make(world([terrain, ball('b', [10.5, 4, 0.3], 0.1)], { environment: { ground: null } }), { colliders: provider });
    run(pw, 2.5);
    const p = pw.getState('b')?.position;
    expect(p?.[1]).toBeCloseTo(1.5 + 0.1, 2);
    expect(p?.[0]).toBeCloseTo(10.5, 1);
    // Ramp along x (cols) only: halfway up the first cell at x = -3.
    const ramp = pw.raycast([10 - 3, 10, 1.5], [0, -1, 0], 20);
    expect(ramp?.point[1]).toBeCloseTo(0.75, 3);
    expect(ramp?.id).toBe('land');
    // Footprint is 8 (x) by 4 (z): nothing beyond z = ±2.
    expect(pw.raycast([10, 10, 2.5], [0, -1, 0], 20)).toBeNull();
    expect(pw.raycast([10 + 3.9, 10, 0], [0, -1, 0], 20)).not.toBeNull();
  });

  it('builds built-in terrain colliders through the default provider', async () => {
    const out = generateBuiltinSync('terrain', {}, 1);
    const desc = out.colliders.find((c) => c.kind === 'heightfield');
    expect(desc).toBeDefined();
    if (desc?.kind !== 'heightfield') return;
    const pw = await make(world([{ id: 'hills', shape: { kind: 'procedural', generator: 'terrain' }, physics: { body: 'static' } }], { environment: { ground: null } }));
    for (const [ix, iz] of [[0, 0], [Math.floor(desc.cols / 2), Math.floor(desc.rows / 3)], [desc.cols, desc.rows]] as const) {
      const x = -desc.size[0] / 2 + (ix * desc.size[0]) / desc.cols;
      const z = -desc.size[2] / 2 + (iz * desc.size[2]) / desc.rows;
      const expected = (desc.heights[ix * (desc.rows + 1) + iz] as number) * desc.size[1];
      const hit = pw.raycast([x * 0.999, 1000, z * 0.999], [0, -1, 0], 2000);
      expect(hit?.id).toBe('hills');
      expect(hit?.point[1]).toBeCloseTo(expected, 0);
    }
  });
});

describe('stepping and events', () => {
  it('uses a fixed-step accumulator with a substep clamp', async () => {
    const pw = await make(world([box('a', [0, 5, 0], [1, 1, 1])]));
    pw.step(1 / 120);
    expect(pw.time).toBe(0);
    expect(pw.alpha).toBeCloseTo(0.5, 5);
    pw.step(1 / 120);
    expect(pw.time).toBeCloseTo(1 / 60, 9);
    pw.step(10); // clamped to 0.25 s and at most 5 substeps
    expect(pw.time).toBeCloseTo(6 / 60, 9);
    expect(pw.alpha).toBeLessThan(1);
    pw.step(Number.NaN);
    pw.step(-1);
    expect(pw.time).toBeCloseTo(6 / 60, 9);
    expect(pw.stats().stepMs).toBeGreaterThan(0);
  });

  it('reports collision start with impulse, and end', async () => {
    const pw = await make(world([ball('b', [0, 2, 0], 0.25, { body: 'dynamic', restitution: 0.9 })]));
    const events = run(pw, 3);
    const start = events.find((e) => e.type === 'collisionStart');
    expect(start).toBeDefined();
    expect([start?.a, start?.b].sort()).toEqual([GROUND_ID, 'b'].sort());
    expect(start?.impulse ?? 0).toBeGreaterThan(0.1);
    expect(events.some((e) => e.type === 'collisionEnd')).toBe(true); // it bounces
  });

  it('reports sensor enter/exit once per entity pair', async () => {
    const pw = await make(world([
      { id: 'zone', shape: { kind: 'primitive', primitive: 'box', size: [2, 2, 2] }, transform: { position: [0, 5, 0] }, physics: { body: 'static', sensor: true } },
      ball('b', [0, 9, 0], 0.25),
    ]));
    const events = run(pw, 2);
    const enter = events.filter((e) => e.type === 'sensorEnter');
    const exit = events.filter((e) => e.type === 'sensorExit');
    expect(enter).toEqual([{ type: 'sensorEnter', a: 'zone', b: 'b' }]);
    expect(exit).toEqual([{ type: 'sensorExit', a: 'zone', b: 'b' }]);
    expect(pw.overlapsSphere([0, 5, 0], 0.5)).toEqual(['zone']);
  });

  it('delivers initial sensor overlaps but not resting contacts on the first step', async () => {
    const pw = await make(world([
      { id: 'zone', shape: { kind: 'primitive', primitive: 'box', size: [2, 2, 2] }, transform: { position: [0, 1, 0] }, physics: { body: 'static', sensor: true } },
      box('crate', [0, 0.5, 0], [1, 1, 1]),
    ]));
    const first = pw.step(1 / 60);
    expect(first).toContainEqual({ type: 'sensorEnter', a: 'zone', b: 'crate' });
    expect(first.some((e) => e.type === 'collisionStart')).toBe(false);
  });
});

describe('joints', () => {
  it('drives a revolute door with a velocity motor around a fixed hinge', async () => {
    const pw = await make(world([{
      id: 'door',
      shape: { kind: 'primitive', primitive: 'box', size: [1, 2, 0.1] },
      transform: { position: [0.5, 1.05, 0] },
      physics: { body: 'dynamic' },
      joint: { type: 'revolute', target: 'world', anchor: [-0.5, 0, 0], axis: [0, 1, 0], motor: { targetVelocity: 90, damping: 50, maxForce: 500 } },
    }]));
    expect(pw.stats().joints).toBe(1);
    run(pw, 0.5);
    const s = pw.getState('door');
    const yaw = (2 * Math.atan2(s?.quaternion[1] ?? 0, s?.quaternion[3] ?? 1) * 180) / Math.PI;
    expect(Math.abs(yaw)).toBeGreaterThan(20);
    // Hinge stays put: center is 0.5m from the hinge at (0, y, 0).
    expect(Math.hypot(s?.position[0] ?? 0, s?.position[2] ?? 0)).toBeCloseTo(0.5, 2);
    expect(s?.position[1]).toBeCloseTo(1.05, 1);
  });

  it('respects revolute limits and supports servo targets', async () => {
    const pw = await make(world([
      {
        id: 'flap',
        shape: { kind: 'primitive', primitive: 'box', size: [1, 0.1, 1] },
        transform: { position: [0.5, 2, 0] },
        physics: { body: 'dynamic' },
        joint: { type: 'revolute', target: 'world', anchor: [-0.5, 0, 0], axis: [0, 0, 1], limits: [-30, 30] },
      },
      {
        id: 'servo',
        shape: { kind: 'primitive', primitive: 'box', size: [1, 0.1, 0.2] },
        transform: { position: [10, 3, 0] },
        physics: { body: 'dynamic' },
        joint: { type: 'revolute', target: 'world', axis: [0, 1, 0], motor: { targetVelocity: 0, targetPosition: 45, stiffness: 200, damping: 20, maxForce: 1000 } },
      },
    ]));
    run(pw, 2);
    const flap = pw.getState('flap');
    const tilt = (2 * Math.asin(Math.abs(flap?.quaternion[2] ?? 0)) * 180) / Math.PI;
    expect(tilt).toBeLessThan(33);
    expect(tilt).toBeGreaterThan(20);
    const servo = pw.getState('servo');
    const yaw = (2 * Math.atan2(servo?.quaternion[1] ?? 0, servo?.quaternion[3] ?? 1) * 180) / Math.PI;
    expect(yaw).toBeCloseTo(45, -1);
  });

  it('builds prismatic, fixed and spherical joints between bodies', async () => {
    const pw = await make(world([
      box('rail-car', [0, 3, 0], [0.5, 0.5, 0.5], { body: 'dynamic' }, { joint: { type: 'prismatic', target: 'world', axis: [1, 0, 0], limits: [-1, 1], motor: { targetVelocity: 2, damping: 100, maxForce: 1000 } } }),
      box('anchor', [5, 3, 0], [0.5, 0.5, 0.5], { body: 'static' }),
      ball('bob', [5, 1, 0], 0.2, { body: 'dynamic', initialVelocity: [2, 0, 0] }, { joint: { type: 'spherical', target: 'anchor' } }),
      box('base', [-5, 0.5, 0], [1, 1, 1], { body: 'dynamic' }),
      box('glued', [-5, 1.25, 0], [0.5, 0.5, 0.5], { body: 'dynamic' }, { joint: { type: 'fixed', target: 'base' } }),
    ]));
    expect(pw.stats().joints).toBe(3);
    expect(pw.diagnostics()).toEqual([]);
    run(pw, 2);
    const car = pw.getState('rail-car')?.position;
    expect(car?.[0]).toBeCloseTo(1, 1); // driven to the upper limit
    expect(car?.[1]).toBeCloseTo(3, 2); // no sagging off the rail
    const bob = pw.getState('bob')?.position ?? [0, 0, 0];
    expect(Math.hypot(bob[0] - 5, bob[1] - 3, bob[2])).toBeCloseTo(2, 1); // rope length preserved
    const base = pw.getState('base')?.position ?? [0, 0, 0];
    const glued = pw.getState('glued')?.position ?? [0, 0, 0];
    expect(glued[1] - base[1]).toBeCloseTo(0.75, 2);
  });

  it('turns bad joints into diagnostics instead of crashing', async () => {
    const doc = world([
      box('a', [0, 1, 0], [1, 1, 1]),
      box('b', [2, 1, 0], [1, 1, 1], { body: 'dynamic' }, { joint: { type: 'revolute', target: 'world', axis: [0, 0, 0] } }),
      box('c', [4, 1, 0], [1, 1, 1], { body: 'dynamic' }, { joint: { type: 'fixed', target: 'deco' } }),
      { id: 'deco', shape: { kind: 'primitive', primitive: 'box' }, transform: { position: [4, 3, 0] } },
      box('d', [6, 1, 0], [1, 1, 1], { body: 'static' }, { joint: { type: 'fixed', target: 'world' } }),
      box('e', [8, 1, 0], [1, 1, 1], { body: 'dynamic' }, { joint: { type: 'spherical', target: 'world', anchor: [0, 0.5, 0], targetAnchor: [8, 5, 0] } }),
      box('f', [10, 1, 0], [1, 1, 1], { body: 'dynamic' }, { joint: { type: 'revolute', target: 'world', limits: [0, 1] } }),
    ]);
    // Bypass core validation to simulate stale/untrusted documents.
    const a = doc.entities.a as Entity;
    a.joint = { type: 'revolute', target: 'ghost', anchor: [0, 0, 0], targetAnchor: [0, 0, 0], axis: [0, 1, 0] };
    (doc.entities.f as Entity).joint!.limits = [Number.NaN, 1];
    const pw = await make(doc);
    const diags = pw.diagnostics();
    const byId = (id: string) => diags.find((d) => d.entities[0] === id);
    expect(byId('a')?.message).toMatch(/does not exist/);
    expect(byId('b')?.message).toMatch(/axis is zero/);
    expect(byId('c')?.message).toMatch(/has no physics body/);
    expect(byId('d')?.message).toMatch(/static/);
    expect(byId('e')?.severity).toBe('warning');
    expect(byId('e')?.message).toMatch(/apart/);
    expect(byId('f')?.message).toMatch(/finite/);
    expect(diags.every((d) => d.code === 'jointInvalid')).toBe(true);
    run(pw, 0.2);
  });
});

describe('control and queries', () => {
  it('applies impulses, velocities, teleports and kinematic targets', async () => {
    const pw = await make(world([
      box('a', [0, 0.5, 0], [1, 1, 1]),
      box('lift', [5, 0.25, 0], [2, 0.5, 2], { body: 'kinematic' }),
      box('rider', [5, 1, 0], [0.5, 0.5, 0.5]),
      box('platform', [-5, 1, 0], [1, 0.2, 1], { body: 'static' }),
    ]));
    pw.applyImpulse('a', [0, 10, 0]);
    pw.stepFixed();
    expect(pw.getVelocity('a')?.[1]).toBeGreaterThan(5);
    pw.setVelocity('a', [1, 0, 0]);
    pw.setAngularVelocity('a', [0, 1, 0]);
    pw.applyImpulse('a', [Number.NaN, 0, 0]);
    expect(pw.getState('a')?.angvel[1]).toBeCloseTo(1, 3);
    pw.teleport('a', [20, 5, 0]);
    expect(pw.getState('a')?.position).toEqual([20, 5, 0]);
    expect(pw.getState('a')?.linvel).toEqual([0, 0, 0]);
    run(pw, 0.5);
    for (let i = 1; i <= 60; i++) {
      pw.setKinematicTarget('lift', [5, 0.25 + i * 0.02, 0], [0, 0, 0, 1]);
      pw.stepFixed();
    }
    expect(pw.getState('lift')?.position[1]).toBeCloseTo(1.45, 2);
    expect(pw.getState('rider')?.position[1]).toBeGreaterThan(1.6); // carried up
    pw.setKinematicTarget('platform', [-5, 2, 0], [0, 0, 0, 1]); // static → promoted to kinematic
    pw.stepFixed();
    expect(pw.getState('platform')?.position[1]).toBeCloseTo(2, 5);
    pw.setKinematicTarget('a', [0, 0, 0], [0, 0, 0, 1]); // dynamic: ignored
  });

  it('explodes nearby bodies outward and wakes them', async () => {
    const pw = await make(world([box('near', [1, 0.25, 0], [0.5, 0.5, 0.5]), box('far', [30, 0.25, 0], [0.5, 0.5, 0.5])]));
    run(pw, 2);
    pw.explode([0, 0.25, 0], 10, 5);
    pw.explode([0, 0, 0], Number.NaN, 5);
    pw.stepFixed();
    expect(pw.getVelocity('near')?.[0]).toBeGreaterThan(5);
    expect(pw.getVelocity('far')?.[0]).toBeCloseTo(0, 3);
  });

  it('raycasts with exclusion and writes packed transforms', async () => {
    const pw = await make(world([box('a', [0, 0.5, 0], [1, 1, 1], { body: 'static' }), box('b', [0, 3, 0], [1, 1, 1], { body: 'static' })]));
    const hit = pw.raycast([0, 10, 0], [0, -2, 0], 100);
    expect(hit?.id).toBe('b');
    expect(hit?.distance).toBeCloseTo(6.5, 4);
    expect(hit?.normal[1]).toBeCloseTo(1, 4);
    expect(pw.raycast([0, 10, 0], [0, -1, 0], 100, 'b')?.id).toBe('a');
    expect(pw.raycast([5, 10, 0], [0, -1, 0], 100)?.id).toBeNull(); // ground
    expect(pw.raycast([0, 10, 0], [0, 0, 0], 100)).toBeNull();
    const buf = new Float32Array(21).fill(-1);
    pw.writeTransforms(buf, ['a', 'missing', 'b']);
    expect([...buf.subarray(0, 7)]).toEqual([0, 0.5, 0, 0, 0, 0, 1]);
    expect([...buf.subarray(7, 14)]).toEqual(new Array(7).fill(-1));
    expect(buf[15]).toBe(3);
    expect(() => pw.writeTransforms(new Float32Array(6), ['a'])).toThrow(RangeError);
  });

  it('spawns and removes runtime entities', async () => {
    const pw = await make(world([box('a', [0, 0.5, 0], [1, 1, 1], { body: 'static' })]));
    const baseColliders = pw.stats().colliders;
    const spawned = { ...world([box('drop', [0, 5, 0], [0.5, 0.5, 0.5])]).entities.drop } as Entity;
    pw.addEntity(spawned);
    expect(pw.has('drop')).toBe(true);
    pw.addEntity({ ...spawned, id: '__proto__' } as Entity); // invalid id → ignored
    pw.addEntity({ ...spawned, physics: undefined });
    expect(pw.stats().bodies).toBe(2);
    run(pw, 2);
    expect(pw.getState('drop')?.position[1]).toBeCloseTo(1.25, 1);
    pw.removeEntity('drop');
    pw.removeEntity('drop');
    expect(pw.has('drop')).toBe(false);
    expect(pw.stats().colliders).toBe(baseColliders);
  });

  it('becomes inert after dispose', async () => {
    const pw = await PhysicsWorld.create(world([box('a', [0, 1, 0], [1, 1, 1])]));
    pw.dispose();
    pw.dispose();
    expect(pw.isDisposed).toBe(true);
    expect(pw.getState('a')).toBeUndefined();
    expect(pw.raycast([0, 5, 0], [0, -1, 0], 10)).toBeNull();
    expect(pw.stats()).toEqual({ bodies: 0, colliders: 0, joints: 0, stepMs: 0 });
    expect(() => pw.step(1 / 60)).toThrow(/disposed/);
    pw.applyImpulse('a', [0, 1, 0]);
  });
});

describe('scatter', () => {
  it('builds one static compound body when small enough, skips huge scatters', async () => {
    const pw = await make(world([
      { id: 'rocks', shape: { kind: 'scatter', of: { kind: 'primitive', primitive: 'box', size: [0.5, 0.5, 0.5] }, count: 50, area: [10, 10], seed: 3 }, physics: { body: 'dynamic' } },
      { id: 'grass', shape: { kind: 'scatter', of: { kind: 'primitive', primitive: 'box', size: [0.1, 0.1, 0.1] }, count: 5000, area: [10, 10] }, physics: { body: 'static' } },
    ]));
    expect(pw.has('rocks')).toBe(true);
    expect(pw.has('grass')).toBe(false);
    expect(pw.dynamicIds()).toEqual([]);
    expect(pw._records().get('rocks')?.colliders.length).toBe(50);
    expect(pw.notes().some((n) => n.includes('grass'))).toBe(true);
  });

  it('projects instances onto an onSurface terrain', async () => {
    const pw = await make(world([
      box('mesa', [0, 1, 0], [20, 2, 20], { body: 'static' }),
      { id: 'pebbles', shape: { kind: 'scatter', of: { kind: 'primitive', primitive: 'sphere', size: [0.2, 0.2, 0.2] }, count: 10, area: [8, 8], scaleRange: [1, 1], onSurface: 'mesa' }, physics: { body: 'static' } },
    ]));
    const ys = pw._records().get('pebbles')?.colliders.map((c) => c.translation().y) ?? [];
    expect(ys).toHaveLength(10);
    for (const y of ys) expect(y).toBeCloseTo(2.1, 3);
  });
});

describe('snapshots', () => {
  function pile(): WorldDoc {
    const list: EntityInput[] = [];
    for (let i = 0; i < 12; i++) list.push(box(`c${i}`, [(i % 3) * 0.3, 1 + i * 0.6, (i % 2) * 0.2], [0.5, 0.5, 0.5]));
    list.push(box('lid', [0, 12, 0], [0.4, 0.4, 0.4], { body: 'dynamic' }, { joint: { type: 'spherical', target: 'world', anchor: [0, 0.5, 0] } }));
    return world(list);
  }

  it('fork continues bit-identically with the original', async () => {
    const a = await make(pile());
    run(a, 0.5);
    const b = await a.fork();
    live.push(b);
    expect(b.time).toBeCloseTo(a.time, 9);
    expect(b.stats().joints).toBe(1);
    run(a, 1);
    run(b, 1);
    for (const id of a.dynamicIds()) expect(b.getState(id)).toEqual(a.getState(id));
  });

  it('restores runtime spawns and rejects bad snapshots', async () => {
    const doc = pile();
    const a = await make(doc);
    const spawn = { ...world([box('extra', [3, 2, 0], [0.5, 0.5, 0.5])]).entities.extra } as Entity;
    a.addEntity(spawn);
    run(a, 0.3);
    const snap = a.snapshot();
    const b = await PhysicsWorld.restore(snap, doc);
    live.push(b);
    expect(b.has('extra')).toBe(true);
    expect(b.getState('extra')).toEqual(a.getState('extra'));
    await expect(PhysicsWorld.restore(new Uint8Array([1, 2, 3]), doc)).rejects.toThrow(/invalid physics snapshot/);
    const otherDoc = world([]);
    await expect(PhysicsWorld.restore(snap, otherDoc)).rejects.toThrow(/missing from the world/);
  });
});

describe('incremental sync', () => {
  it('adds, removes, moves and rebuilds only what changed', async () => {
    const doc0 = world([box('a', [0, 0.5, 0], [1, 1, 1], { body: 'static' }), box('b', [3, 0.5, 0], [1, 1, 1], { body: 'static' })]);
    const pw = await make(doc0);
    const handleA = pw._records().get('a')?.body.handle;
    const handleB = pw._records().get('b')?.body.handle;

    const r1 = applyPatches(doc0, [{ op: 'add', entity: box('c', [6, 0.5, 0], [1, 1, 1], { body: 'static' }) }]);
    pw.sync(r1.world, diffWorlds(doc0, r1.world));
    expect(pw.has('c')).toBe(true);
    expect(pw._records().get('a')?.body.handle).toBe(handleA);

    const r2 = applyPatches(r1.world, [{ op: 'update', id: 'a', set: { transform: { position: [0, 2, 0] } } }, { op: 'update', id: 'b', set: { material: { color: '#ff0000' } } }]);
    pw.sync(r2.world);
    expect(pw._records().get('a')?.body.handle).toBe(handleA); // moved, not rebuilt
    expect(pw.getState('a')?.position).toEqual([0, 2, 0]);
    expect(pw._records().get('b')?.body.handle).toBe(handleB); // cosmetic change ignored

    const r3 = applyPatches(r2.world, [{ op: 'update', id: 'b', set: { shape: { size: [2, 2, 2] } } }, { op: 'remove', id: 'c' }]);
    pw.sync(r3.world);
    expect(pw._records().get('b')?.body.handle).not.toBe(handleB);
    expect(pw.has('c')).toBe(false);
    pw.refreshQueries();
    expect(pw.raycast([3, 10, 0], [0, -1, 0], 20)?.point[1]).toBeCloseTo(1.5, 4);

    const r4 = applyPatches(r3.world, [{ op: 'update', id: 'a', set: { physics: { body: 'dynamic' } } }, { op: 'setEnvironment', set: { gravity: [0, 0, 0], ground: null } }]);
    pw.sync(r4.world);
    expect(pw.dynamicIds()).toEqual(['a']);
    expect(pw.getGravity()).toEqual([0, 0, 0]);
    expect(pw._ground()).toBeNull();

    const r5 = applyPatches(r4.world, [{ op: 'update', id: 'a', set: { template: true } }]);
    pw.sync(r5.world);
    expect(pw.has('a')).toBe(false);
  });

  it('rebuilds joints when their target is rebuilt and moves children with parents', async () => {
    const doc0 = world([
      box('frame', [0, 1, 0], [0.2, 2, 0.2], { body: 'static' }),
      box('door', [0.6, 1, 0], [1, 2, 0.1], { body: 'dynamic' }, { joint: { type: 'revolute', target: 'frame', anchor: [-0.5, 0, 0] } }),
      box('cart', [5, 0.5, 0], [1, 1, 1], { body: 'kinematic' }),
      box('flag', [5, 2, 0], [0.1, 1, 0.1], { body: 'kinematic' }, { parent: 'cart', transform: { position: [0, 1.5, 0] } }),
    ]);
    const pw = await make(doc0);
    expect(pw.stats().joints).toBe(1);
    const r1 = applyPatches(doc0, [{ op: 'update', id: 'frame', set: { shape: { size: [0.3, 2, 0.3] } } }, { op: 'update', id: 'cart', set: { transform: { position: [8, 0.5, 0] } } }]);
    pw.sync(r1.world);
    expect(pw.stats().joints).toBe(1);
    expect(pw._records().get('door')?.joint?.isValid()).toBe(true);
    expect(pw.getState('flag')?.position).toEqual([8, 2, 0]);
    // Removing the target also strips the joint from the door (core referential integrity).
    const r2 = applyPatches(r1.world, [{ op: 'remove', id: 'frame' }]);
    pw.sync(r2.world);
    expect(pw.stats().joints).toBe(0);
    expect(pw.diagnostics()).toEqual([]);
    run(pw, 0.1);
  });
});

describe('performance', () => {
  it('steps 1000 dynamic boxes within the per-step budget (8 ms locally, looser on shared CI runners)', async () => {
    const list: EntityInput[] = [];
    for (let i = 0; i < 1000; i++) {
      const x = (i % 10) * 1.2 - 6;
      const z = (Math.floor(i / 10) % 10) * 1.2 - 6;
      const y = 0.5 + Math.floor(i / 100) * 1.05;
      list.push(box(`box-${i}`, [x, y, z], [1, 1, 1]));
    }
    const pw = await make(world(list));
    for (let i = 0; i < 10; i++) pw.stepFixed(); // warm-up
    const n = 60;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) pw.stepFixed();
    const avg = (performance.now() - t0) / n;
    console.info(`[physics perf] 1000 dynamic boxes: ${avg.toFixed(2)} ms/step`);
    expect(avg).toBeLessThan(process.env.CI ? 30 : 8);
  });
});
