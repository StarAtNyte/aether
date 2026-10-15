import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CharacterController, initPhysics, PhysicsWorld } from '../src/index';
import { box, world } from './helpers';

const live: PhysicsWorld[] = [];
beforeAll(async () => {
  await initPhysics();
});
afterEach(() => {
  for (const pw of live.splice(0)) pw.dispose();
});

describe('CharacterController.setEnabled (sitting in a sofa)', () => {
  it('a disabled capsule has no collisions: rays pass through it and it can overlap furniture; enabling restores them', async () => {
    const pw = await PhysicsWorld.create(world([box('sofa', [0, 0.45, 0], [2, 0.9, 1], { body: 'static' })]));
    live.push(pw);
    const c = new CharacterController(pw, { radius: 0.3, height: 1.8, spawn: [5, 0, 0], id: 'player' });
    const ids = (): Array<string | null> => pw.raycastAll([5, 1, 3], [0, 0, -1], 6).map((h) => h.id);
    pw.stepFixed();
    expect(ids()).toContain('player');
    c.setEnabled(false);
    pw.stepFixed();
    expect(ids()).not.toContain('player');
    // Sit inside the sofa's volume: no depenetration, the position holds.
    c.teleport([0, 0.42, 0]);
    for (let i = 0; i < 30; i++) pw.stepFixed();
    expect(c.position[0]).toBeCloseTo(0, 5);
    expect(c.position[1]).toBeCloseTo(0.42, 5);
    c.setEnabled(true);
    c.teleport([5, 0, 0]);
    pw.stepFixed();
    expect(ids()).toContain('player');
    c.dispose();
    expect(() => c.setEnabled(false)).not.toThrow();
  });
});
