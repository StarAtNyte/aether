import { afterEach, describe, expect, it } from 'vitest';
import { CharacterController, PhysicsWorld, type PhysicsEvent } from '../src/index';
import { box, world } from './helpers';

const DT = 1 / 60;
const live: Array<{ dispose(): void }> = [];
afterEach(() => {
  for (const x of live.splice(0).reverse()) x.dispose();
});

async function setup(extra: Parameters<typeof world>[0] = []) {
  const pw = await PhysicsWorld.create(world(extra));
  live.push(pw);
  const cc = new CharacterController(pw, { radius: 0.3, height: 1.8, spawn: [0, 2, 0] });
  live.push(cc);
  return { pw, cc };
}

function frames(pw: PhysicsWorld, cc: CharacterController, n: number, input: { forward: number; right: number; jump: boolean; yawDeg: number }, events: PhysicsEvent[] = []): void {
  for (let i = 0; i < n; i++) {
    cc.move(input, DT, 5, 6);
    events.push(...pw.stepFixed());
  }
}

const IDLE = { forward: 0, right: 0, jump: false, yawDeg: 0 };

describe('CharacterController', () => {
  it('falls, lands on the ground and reports grounded', async () => {
    const { pw, cc } = await setup();
    expect(cc.grounded).toBe(false);
    frames(pw, cc, 90, IDLE);
    expect(cc.grounded).toBe(true);
    expect(cc.position[1]).toBeCloseTo(0, 1);
  });

  it('walks relative to the yaw (0° faces −Z) at the requested speed', async () => {
    const { pw, cc } = await setup();
    frames(pw, cc, 60, IDLE);
    const start = cc.position;
    frames(pw, cc, 60, { forward: 1, right: 0, jump: false, yawDeg: 0 });
    expect(cc.position[2] - start[2]).toBeCloseTo(-5, 0);
    expect(Math.abs(cc.position[0] - start[0])).toBeLessThan(0.05);
    const mid = cc.position;
    frames(pw, cc, 30, { forward: 0, right: 1, jump: false, yawDeg: 90 }); // facing −X, right is −Z
    expect(cc.position[2] - mid[2]).toBeCloseTo(-2.5, 0);
    // Diagonal input is normalized.
    const before = cc.position;
    frames(pw, cc, 60, { forward: 1, right: 1, jump: false, yawDeg: 0 });
    expect(Math.hypot(cc.position[0] - before[0], cc.position[2] - before[2])).toBeCloseTo(5, 0);
  });

  it('jumps, climbs small steps and is blocked by walls', async () => {
    const { pw, cc } = await setup([
      box('step', [0, 0.1, -3], [4, 0.2, 2], { body: 'static' }),
      box('wall', [0, 1.5, -8], [6, 3, 0.4], { body: 'static' }),
    ]);
    frames(pw, cc, 60, IDLE);
    cc.move({ ...IDLE, jump: true }, DT, 5, 6);
    pw.stepFixed();
    expect(cc.grounded).toBe(false);
    let peak = 0;
    for (let i = 0; i < 90; i++) {
      cc.move(IDLE, DT, 5, 6);
      pw.stepFixed();
      peak = Math.max(peak, cc.position[1]);
    }
    expect(peak).toBeGreaterThan(1.5); // v²/2g ≈ 1.83 m
    expect(cc.grounded).toBe(true);
    frames(pw, cc, 36, { forward: 1, right: 0, jump: false, yawDeg: 0 });
    expect(cc.position[1]).toBeCloseTo(0.2, 1); // on top of the step
    frames(pw, cc, 120, { forward: 1, right: 0, jump: false, yawDeg: 0 });
    expect(cc.position[2]).toBeGreaterThan(-8); // stopped by the wall
    expect(cc.position[2]).toBeLessThan(-7);
  });

  it('teleports, ignores bad input and triggers sensors as "player"', async () => {
    const { pw, cc } = await setup([{ id: 'goal', shape: { kind: 'primitive', primitive: 'box', size: [2, 2, 2] }, transform: { position: [0, 1, -4] }, physics: { body: 'static', sensor: true } }]);
    frames(pw, cc, 30, IDLE);
    cc.move({ forward: Number.NaN, right: Infinity, jump: false, yawDeg: Number.NaN }, Number.NaN, Number.NaN, Number.NaN);
    expect(cc.position.every(Number.isFinite)).toBe(true);
    const events: PhysicsEvent[] = [];
    frames(pw, cc, 60, { forward: 1, right: 0, jump: false, yawDeg: 0 }, events);
    expect(events).toContainEqual({ type: 'sensorEnter', a: 'goal', b: 'player' });
    cc.teleport([10, 5, 10]);
    expect(cc.position).toEqual([10, 5, 10]);
    expect(cc.verticalSpeed).toBe(0);
    cc.teleport([Number.NaN, 0, 0]);
    expect(cc.position).toEqual([10, 5, 10]);
  });

  it('disposes cleanly, even after the world', async () => {
    const pw = await PhysicsWorld.create(world([]));
    const cc = new CharacterController(pw, { radius: 0.3, height: 1.8, spawn: [0, 1, 0] });
    const before = pw.stats().colliders;
    cc.dispose();
    expect(pw.stats().colliders).toBe(before - 1);
    const cc2 = new CharacterController(pw, { radius: 0.3, height: 1.8, spawn: [0, 1, 0] });
    const standing = cc2.position;
    pw.dispose();
    cc2.dispose();
    expect(cc2.move(IDLE, DT, 5, 6)).toEqual(standing);
  });
});

describe('CharacterController spawn settling', () => {
  const make = async (y: number, extra: Parameters<typeof world>[0] = []) => {
    const pw = await PhysicsWorld.create(world(extra));
    live.push(pw);
    const cc = new CharacterController(pw, { radius: 0.3, height: 1.8, spawn: [0, y, 0], settleSpawn: true });
    live.push(cc);
    return { pw, cc };
  };

  it('does nothing unless asked: the headless spawn is exactly the document spawn', async () => {
    const pw = await PhysicsWorld.create(world([]));
    live.push(pw);
    const cc = new CharacterController(pw, { radius: 0.3, height: 1.8, spawn: [0, 1, 0] });
    live.push(cc);
    expect(cc.position).toEqual([0, 1, 0]);
  });

  it('stands a spawn point that hangs a little above the floor on the floor, so the game does not open with a drop', async () => {
    const { pw, cc } = await make(1);
    expect(cc.position[1]).toBeLessThan(0.1);
    frames(pw, cc, 2, IDLE);
    expect(cc.grounded).toBe(true);
    expect(cc.verticalSpeed).toBeGreaterThan(-1);
  });

  it('keeps a deliberately high drop', async () => {
    const { cc } = await make(4);
    expect(cc.position[1]).toBe(4);
  });

  it('settles onto a platform under the spawn, not through it to the floor', async () => {
    const { cc } = await make(1.2, [box('plat', [0, 0.5, 0], [4, 1, 4])]);
    expect(cc.position[1]).toBeGreaterThan(0.9);
    expect(cc.position[1]).toBeLessThan(1.1);
  });

  // An architecture world's spawn at 0.1 m with its floor slab's top at 0.22 m: the capsule started inside the slab and ground
  // in place under forward input until a jump lifted it out.
  it('lifts a spawn embedded a little under a floor slab onto its top, and it walks without a jump', async () => {
    const slab = box('slab', [0, 0.11, 0], [12, 0.22, 12], { body: 'static' });
    const { pw, cc } = await make(0.1, [slab]);
    expect(cc.position[1]).toBeGreaterThan(0.22);
    expect(cc.position[1]).toBeLessThan(0.26);
    const x0 = cc.position;
    frames(pw, cc, 60, { forward: 1, right: 0, jump: false, yawDeg: 0 });
    expect(x0[2] - cc.position[2]).toBeGreaterThan(3);
    expect(cc.grounded).toBe(true);
  });

  it('settles a spot handed over later (Play from a walk or a film) the same way, ignoring its own capsule', async () => {
    const slab = box('slab', [0, 0.11, 0], [12, 0.22, 12], { body: 'static' });
    const { pw, cc } = await make(0.3, [slab]);
    frames(pw, cc, 10, IDLE);
    const at = cc.settle([2, 0.1, 2]);
    expect(at[1]).toBeGreaterThan(0.22);
    expect(at[1]).toBeLessThan(0.26);
    expect(cc.settle(cc.position)[1]).toBeCloseTo(cc.position[1], 2);
  });

  it('does not lift a spawn standing under a low table onto it', async () => {
    const { cc } = await make(0, [box('table', [0, 0.45, 0], [1, 0.06, 1], { body: 'static' })]);
    expect(cc.position[1]).toBeLessThan(0.05);
  });

  it('moves a spawn inside furniture (a bed) to the nearest free floor beside it', async () => {
    const slab = box('slab', [0, 0.075, 0], [12, 0.15, 12], { body: 'static' });
    const bed = box('bed', [0, 0.4, 0], [1.6, 0.6, 2.1], { body: 'static' });
    const { pw, cc } = await make(0.1, [slab, bed]);
    const p = cc.position;
    expect(Math.abs(p[0]) > 0.8 + 0.3 || Math.abs(p[2]) > 1.05 + 0.3).toBe(true);
    expect(Math.hypot(p[0], p[2])).toBeLessThan(2.1);
    expect(p[1]).toBeGreaterThan(0.15);
    expect(p[1]).toBeLessThan(0.2);
    const x0 = cc.position;
    const away = (Math.atan2(-p[0], -p[2]) * 180) / Math.PI;
    frames(pw, cc, 60, { forward: 1, right: 0, jump: false, yawDeg: away });
    expect(Math.hypot(cc.position[0] - x0[0], cc.position[2] - x0[2])).toBeGreaterThan(2);
  });
});
