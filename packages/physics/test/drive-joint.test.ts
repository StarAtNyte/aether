import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { EntityInput, WorldDoc } from '@aether/core';
import { initPhysics, PhysicsWorld } from '../src/index';
import { world } from './helpers';

const live: PhysicsWorld[] = [];
async function make(doc: WorldDoc): Promise<PhysicsWorld> {
  const pw = await PhysicsWorld.create(doc);
  live.push(pw);
  return pw;
}
function run(pw: PhysicsWorld, seconds: number): void {
  const n = Math.round(seconds / pw.dt);
  for (let i = 0; i < n; i++) pw.stepFixed();
}
function yawDeg(pw: PhysicsWorld, id: string): number {
  const q = pw.getState(id)?.quaternion ?? [0, 0, 0, 1];
  return (2 * Math.atan2(q[1], q[3]) * 180) / Math.PI;
}

beforeAll(async () => {
  await initPhysics();
});
afterEach(() => {
  for (const pw of live.splice(0)) pw.dispose();
});

const DOOR: EntityInput = {
  id: 'door',
  shape: { kind: 'primitive', primitive: 'box', size: [0.9, 2, 0.04] },
  transform: { position: [0.45, 1.01, 0] },
  physics: { body: 'dynamic', mass: 12 },
  joint: { type: 'revolute', target: 'world', anchor: [-0.45, 0, 0], axis: [0, 1, 0], limits: [0, 100], motor: { targetVelocity: 0, targetPosition: 0, stiffness: 60, damping: 12, maxForce: 400 } },
};

const DRAWER: EntityInput = {
  id: 'drawer',
  shape: { kind: 'primitive', primitive: 'box', size: [0.5, 0.2, 0.45] },
  transform: { position: [3, 0.5, 0] },
  physics: { body: 'dynamic', mass: 3, gravityScale: 0 },
  joint: { type: 'prismatic', target: 'world', axis: [0, 0, 1], limits: [0, 0.4], motor: { targetVelocity: 0, targetPosition: 0, stiffness: 80, damping: 14, maxForce: 200 } },
};

describe('driveJoint', () => {
  it('swings a hinged door open to its limit and closes it again', async () => {
    const pw = await make(world([DOOR]));
    run(pw, 1);
    expect(Math.abs(yawDeg(pw, 'door'))).toBeLessThan(2);
    expect(pw.driveJoint('door', 90)).toBe(true);
    run(pw, 2.5);
    const open = Math.abs(yawDeg(pw, 'door'));
    expect(open).toBeGreaterThan(80);
    expect(open).toBeLessThan(101);
    // The hinge edge stays on its axis: the door centre is half a leaf from the hinge.
    const s = pw.getState('door');
    expect(Math.hypot(s?.position[0] ?? 0, s?.position[2] ?? 0)).toBeCloseTo(0.45, 1);
    expect(pw.driveJoint('door', 0)).toBe(true);
    run(pw, 2.5);
    expect(Math.abs(yawDeg(pw, 'door'))).toBeLessThan(4);
  });

  it('never opens past its limit even when driven far beyond it', async () => {
    const pw = await make(world([DOOR]));
    pw.driveJoint('door', 170);
    run(pw, 3);
    expect(Math.abs(yawDeg(pw, 'door'))).toBeLessThan(102);
  });

  it('pulls a drawer out along its rail and pushes it back', async () => {
    const pw = await make(world([DRAWER]));
    pw.driveJoint('drawer', 0.38);
    run(pw, 2);
    const out = pw.getState('drawer')?.position ?? [0, 0, 0];
    expect(out[2]).toBeGreaterThan(0.33);
    expect(out[2]).toBeLessThanOrEqual(0.41);
    expect(out[0]).toBeCloseTo(3, 2);
    pw.driveJoint('drawer', 0);
    run(pw, 2);
    expect(pw.getState('drawer')?.position[2]).toBeLessThan(0.05);
  });

  it('refuses entities without a drivable joint and non-finite targets', async () => {
    const pw = await make(world([DOOR, { id: 'crate', shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] }, transform: { position: [8, 1, 0] }, physics: { body: 'dynamic' } }]));
    expect(pw.driveJoint('crate', 10)).toBe(false);
    expect(pw.driveJoint('missing', 10)).toBe(false);
    expect(pw.driveJoint('door', Number.NaN)).toBe(false);
  });
});

describe('raycastAll', () => {
  it('reports overlapping colliders nearest first and respects the limit and exclusion', async () => {
    const pw = await make(
      world([
        { id: 'carcass', shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] }, transform: { position: [0, 1, 0] }, physics: { body: 'static' } },
        { id: 'front', shape: { kind: 'primitive', primitive: 'box', size: [0.8, 0.5, 0.05] }, transform: { position: [0, 1, 0.4] }, physics: { body: 'kinematic' } },
      ]),
    );
    const hits = pw.raycastAll([0, 1, 3], [0, 0, -1], 5);
    expect(hits.map((h) => h.id)).toEqual(['carcass', 'front']);
    expect(hits[0]?.distance).toBeLessThan(hits[1]?.distance ?? 0);
    expect(pw.raycastAll([0, 1, 3], [0, 0, -1], 5, 1).length).toBe(1);
    expect(pw.raycastAll([0, 1, 3], [0, 0, -1], 5, 8, 'carcass').map((h) => h.id)).not.toContain('carcass');
    expect(pw.raycastAll([0, 1, 3], [0, 0, 0], 5)).toEqual([]);
    expect(pw.raycastAll([0, 1, 3], [0, 0, -1], 0)).toEqual([]);
  });
});
