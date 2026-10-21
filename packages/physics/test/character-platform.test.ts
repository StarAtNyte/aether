import { afterEach, describe, expect, it } from 'vitest';
import { CHARACTER_FEEL, CharacterController, PhysicsWorld } from '../src/index';
import { box, world } from './helpers';
import type { Vec3 } from '@aether/core';

const DT = 1 / 60;
const live: Array<{ dispose(): void }> = [];
afterEach(() => {
  for (const x of live.splice(0).reverse()) x.dispose();
});
const IDLE = { forward: 0, right: 0, jump: false, yawDeg: 0 };
const PLUS_X = { forward: 1, right: 0, jump: false, yawDeg: 270 };
const MINUS_X = { forward: 1, right: 0, jump: false, yawDeg: 90 };
const PLUS_Z = { forward: 1, right: 0, jump: false, yawDeg: 180 };
const SPEED = 3;
const IDENTITY: [number, number, number, number] = [0, 0, 0, 1];

type Input = typeof IDLE;

/** A deck (kinematic or static) with its top at y = 0.6, x from 0 to 8, z from -1.5 to 1.5, on the default ground. */
async function setup(kind: 'kinematic' | 'static', spawn: Vec3 = [1.5, 0.7, 0], extra: Parameters<typeof world>[0] = []) {
  const pw = await PhysicsWorld.create(world([box('deck', [4, 0.5, 0], [8, 0.2, 3], { body: kind }), ...extra]));
  live.push(pw);
  const cc = new CharacterController(pw, { radius: 0.3, height: 1.8, spawn });
  live.push(cc);
  return { pw, cc };
}

/** One fixed step; `deck` places the platform for the step like a logic-driven one. */
function tick(pw: PhysicsWorld, cc: CharacterController, input: Input, deck?: { position: Vec3; quaternion?: [number, number, number, number] }): void {
  cc.move(input, DT, SPEED, 6);
  if (deck) pw.setKinematicTarget('deck', deck.position, deck.quaternion ?? IDENTITY);
  pw.stepFixed();
}

function run(pw: PhysicsWorld, cc: CharacterController, n: number, input: Input): void {
  for (let i = 0; i < n; i++) tick(pw, cc, input);
}

describe('character on kinematic platforms', () => {
  it('walks across a resting kinematic deck without stalling, as it does on a static one', async () => {
    const a = await setup('kinematic');
    const b = await setup('static');
    run(a.pw, a.cc, 30, IDLE);
    run(b.pw, b.cc, 30, IDLE);
    expect(a.cc.grounded).toBe(true);
    for (let i = 0; i < 100; i++) {
      run(a.pw, a.cc, 1, PLUS_X);
      run(b.pw, b.cc, 1, PLUS_X);
    }
    expect(a.cc.position[0] - 1.5).toBeGreaterThan(4.8);
    // (100 frames at 3 m/s is 5 m; the fixed deck loses a little to the controller's per-frame contact.)
    expect(a.cc.position[0]).toBeGreaterThanOrEqual(b.cc.position[0] - 0.01);
    expect(a.cc.position[1]).toBeCloseTo(0.62, 2);
    expect(a.cc.grounded).toBe(true);
  });

  it('a human-feel character reaches full speed and keeps it across a resting deck', async () => {
    const pw = await PhysicsWorld.create(world([box('deck', [4, 0.5, 0], [8, 0.2, 3], { body: 'kinematic' })]));
    live.push(pw);
    const cc = new CharacterController(pw, { radius: 0.3, height: 1.8, spawn: [0.8, 0.7, 0], feel: CHARACTER_FEEL });
    live.push(cc);
    run(pw, cc, 30, IDLE);
    const x0 = cc.position[0];
    run(pw, cc, 90, PLUS_X);
    // 1.5 s at 3 m/s less the 0.06 s it takes to get up to speed.
    expect(cc.position[0] - x0).toBeGreaterThan(4.2);
    expect(cc.grounded).toBe(true);
  });

  it('keeps walking along a resting deck in other directions and diagonals', async () => {
    const { pw, cc } = await setup('kinematic', [4, 0.7, -1]);
    run(pw, cc, 30, IDLE);
    run(pw, cc, 40, PLUS_Z);
    expect(cc.position[2] - -1).toBeGreaterThan(1.9);
    const before = cc.position;
    run(pw, cc, 40, { forward: 1, right: 1, jump: false, yawDeg: 270 });
    expect(Math.hypot(cc.position[0] - before[0], cc.position[2] - before[2])).toBeGreaterThan(1.9);
    expect(cc.grounded).toBe(true);
  });

  it('stops at a wall on a kinematic deck', async () => {
    const { pw, cc } = await setup('kinematic', [6, 0.7, 0], [box('wall', [7.5, 1.2, 0], [0.2, 1.2, 3], { body: 'static' })]);
    run(pw, cc, 30, IDLE);
    run(pw, cc, 120, PLUS_X);
    expect(cc.position[0]).toBeLessThan(7.45);
    expect(cc.position[0]).toBeGreaterThan(7.0);
  });

  it('walks off the deck edge and falls to the ground', async () => {
    const { pw, cc } = await setup('kinematic', [6, 0.7, 0]);
    run(pw, cc, 30, IDLE);
    run(pw, cc, 60, PLUS_X);
    expect(cc.position[0]).toBeGreaterThan(8.3);
    run(pw, cc, 40, IDLE);
    expect(cc.position[1]).toBeLessThan(0.1);
    expect(cc.grounded).toBe(true);
  });

  it('climbs stairs beside the deck and walks on across it', async () => {
    // Four steps of 0.15 m ending level with the deck's top, along the deck's end at x = 0.
    const steps: Parameters<typeof world>[0] = [];
    for (let i = 0; i < 4; i++) steps.push(box(`step-${i}`, [-0.4 * (4 - i) + 0.2, (0.15 * (i + 1)) / 2, 0], [0.4, 0.15 * (i + 1), 2], { body: 'static' }));
    const { pw, cc } = await setup('kinematic', [-3, 0.1, 0], steps);
    run(pw, cc, 30, IDLE);
    run(pw, cc, 160, PLUS_X);
    expect(cc.position[1]).toBeGreaterThan(0.55);
    expect(cc.position[0]).toBeGreaterThan(2);
  });

  it('is carried by a deck moving sideways, and walks on it relative to the deck', async () => {
    const { pw, cc } = await setup('kinematic');
    run(pw, cc, 30, IDLE);
    const x0 = cc.position[0];
    const speed = 1.5;
    let t = 0;
    for (let i = 0; i < 120; i++) {
      t += DT;
      tick(pw, cc, IDLE, { position: [4 + speed * t, 0.5, 0] });
    }
    expect(Math.abs(cc.position[0] - x0 - speed * t)).toBeLessThan(0.08);
    expect(cc.position[1]).toBeCloseTo(0.62, 1);
    expect(cc.grounded).toBe(true);
    // Walking forward while the deck moves the same way adds the two.
    const x1 = cc.position[0];
    const t1 = t;
    for (let i = 0; i < 60; i++) {
      t += DT;
      tick(pw, cc, PLUS_X, { position: [4 + speed * t, 0.5, 0] });
    }
    expect(cc.position[0] - x1).toBeGreaterThan((SPEED + speed) * (t - t1) - 0.3);
  });

  it('rides a lift up and down, staying grounded on the deck', async () => {
    const { pw, cc } = await setup('kinematic');
    run(pw, cc, 30, IDLE);
    let t = 0;
    let worst = 0;
    for (let i = 0; i < 180; i++) {
      t += DT;
      const y = 0.5 + 2 * Math.sin((t / 3) * Math.PI); // up 2 m and back down in 3 s
      tick(pw, cc, IDLE, { position: [4, y, 0] });
      worst = Math.max(worst, Math.abs(cc.position[1] - (y + 0.1 + 0.02)));
    }
    expect(worst).toBeLessThan(0.08);
    expect(cc.grounded).toBe(true);
  });

  it('walks across a deck that is rising', async () => {
    const { pw, cc } = await setup('kinematic');
    run(pw, cc, 30, IDLE);
    let t = 0;
    const x0 = cc.position[0];
    for (let i = 0; i < 90; i++) {
      t += DT;
      tick(pw, cc, PLUS_X, { position: [4, 0.5 + 0.8 * t, 0] });
    }
    expect(cc.position[0] - x0).toBeGreaterThan(SPEED * t - 0.3);
    expect(cc.position[1]).toBeCloseTo(0.62 + 0.8 * t, 1);
    expect(cc.grounded).toBe(true);
  });

  it('turns with a rotating deck', async () => {
    const { pw, cc } = await setup('kinematic', [5.5, 0.7, 0]);
    run(pw, cc, 30, IDLE);
    let t = 0;
    const rate = 0.5; // rad/s about the deck's centre (4, _, 0); the character stands 1.5 m out
    for (let i = 0; i < 60; i++) {
      t += DT;
      const a = rate * t;
      tick(pw, cc, IDLE, { position: [4, 0.5, 0], quaternion: [0, Math.sin(a / 2), 0, Math.cos(a / 2)] });
    }
    const a = rate * t;
    // Rotation about +y by `a` takes (1.5, 0, 0) to (1.5 cos a, 0, -1.5 sin a).
    expect(cc.position[0]).toBeCloseTo(4 + 1.5 * Math.cos(a), 1);
    expect(cc.position[2]).toBeCloseTo(-1.5 * Math.sin(a), 1);
  });

  it('jumps from a resting deck and is not carried while in the air', async () => {
    const { pw, cc } = await setup('kinematic');
    run(pw, cc, 30, IDLE);
    tick(pw, cc, { ...IDLE, jump: true });
    run(pw, cc, 5, IDLE);
    expect(cc.position[1]).toBeGreaterThan(0.9);
    let t = 0;
    const xAir = cc.position[0];
    for (let i = 0; i < 20; i++) {
      t += DT;
      tick(pw, cc, IDLE, { position: [4 + 2 * t, 0.5, 0] });
    }
    expect(Math.abs(cc.position[0] - xAir)).toBeLessThan(0.01);
  });

  it('is deterministic: the same inputs give the same positions on a driven deck', async () => {
    const trace = async (): Promise<number[]> => {
      const { pw, cc } = await setup('kinematic');
      const out: number[] = [];
      let t = 0;
      for (let i = 0; i < 200; i++) {
        t += DT;
        tick(pw, cc, i % 50 < 30 ? PLUS_X : MINUS_X, { position: [4 + Math.sin(t), 0.5 + 0.3 * Math.sin(t * 2), 0] });
        out.push(...cc.position);
      }
      return out;
    };
    expect(await trace()).toEqual(await trace());
  });
});
