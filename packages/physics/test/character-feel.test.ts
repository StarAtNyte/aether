/**
 * The feel of a human-played character: acceleration and a firm stop, air control, coyote time, a buffered
 * jump and a shorter hop when jump is released early. Without `feel` the controller is unchanged (the
 * playtest bot and the proof replays rely on that).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { CHARACTER_FEEL, CharacterController, PhysicsWorld } from '../src/index';
import { box, world } from './helpers';

const DT = 1 / 60;
const live: Array<{ dispose(): void }> = [];
afterEach(() => {
  for (const x of live.splice(0).reverse()) x.dispose();
});

type In = { forward: number; right: number; jump: boolean; yawDeg: number };
const IDLE: In = { forward: 0, right: 0, jump: false, yawDeg: 0 };
const FORWARD: In = { ...IDLE, forward: 1 };

async function setup(feel: boolean, extra: Parameters<typeof world>[0] = []) {
  const pw = await PhysicsWorld.create(world(extra));
  live.push(pw);
  const cc = new CharacterController(pw, { radius: 0.3, height: 1.8, spawn: [0, 0.2, 0], ...(feel ? { feel: CHARACTER_FEEL } : {}) });
  live.push(cc);
  return { pw, cc };
}

function run(pw: PhysicsWorld, cc: CharacterController, n: number, input: In, speed = 5, jump = 6): void {
  for (let i = 0; i < n; i++) {
    cc.move(input, DT, speed, jump);
    pw.stepFixed();
  }
}

describe('acceleration', () => {
  it('ramps up to full speed in about a tenth of a second instead of at once', async () => {
    const plain = await setup(false);
    const felt = await setup(true);
    for (const t of [plain, felt]) run(t.pw, t.cc, 40, IDLE);
    const p0 = plain.cc.position[2];
    const f0 = felt.cc.position[2];
    run(plain.pw, plain.cc, 3, FORWARD);
    run(felt.pw, felt.cc, 3, FORWARD);
    const plainMoved = p0 - plain.cc.position[2];
    const feltMoved = f0 - felt.cc.position[2];
    expect(feltMoved).toBeGreaterThan(0.02);
    expect(feltMoved).toBeLessThan(plainMoved * 0.8);
    // A second later both cruise at the full speed.
    run(plain.pw, plain.cc, 60, FORWARD);
    run(felt.pw, felt.cc, 60, FORWARD);
    const a = felt.cc.position[2];
    run(felt.pw, felt.cc, 60, FORWARD);
    expect(a - felt.cc.position[2]).toBeCloseTo(5, 0);
  });

  it('stops within a few centimetres, not in a slide', async () => {
    const { pw, cc } = await setup(true);
    run(pw, cc, 40, IDLE);
    run(pw, cc, 60, FORWARD);
    const z = cc.position[2];
    run(pw, cc, 60, IDLE);
    expect(z - cc.position[2]).toBeLessThan(0.35);
    expect(z - cc.position[2]).toBeGreaterThan(0.02);
    const rest = cc.position[2];
    run(pw, cc, 30, IDLE);
    expect(Math.abs(cc.position[2] - rest)).toBeLessThan(1e-4);
  });

  it('the unfelt controller still stops dead', async () => {
    const { pw, cc } = await setup(false);
    run(pw, cc, 40, IDLE);
    run(pw, cc, 60, FORWARD);
    const z = cc.position[2];
    run(pw, cc, 3, IDLE);
    expect(Math.abs(cc.position[2] - z)).toBeLessThan(0.1);
  });
});

describe('jumping', () => {
  it('forgives a jump a moment after walking off a ledge, and not much later', async () => {
    // A 2 m high slab to stand on, ending at x = 2.
    const slab = box('slab', [0, 1, 0], [4, 2, 4]);
    const early = await setup(true, [slab]);
    early.cc.teleport([0, 2.05, 0]);
    run(early.pw, early.cc, 30, IDLE);
    // Walk off the +x edge (yaw −90 faces +x), then jump 4 frames after leaving the ground (66 ms < coyote 110 ms).
    const off: In = { ...FORWARD, yawDeg: -90 };
    let frames = 0;
    while (early.cc.grounded && frames++ < 200) run(early.pw, early.cc, 1, off);
    run(early.pw, early.cc, 3, off);
    const y0 = early.cc.position[1];
    run(early.pw, early.cc, 6, { ...off, jump: true });
    expect(early.cc.position[1]).toBeGreaterThan(y0 - 0.15);

    const late = await setup(true, [slab]);
    late.cc.teleport([0, 2.05, 0]);
    run(late.pw, late.cc, 30, IDLE);
    frames = 0;
    while (late.cc.grounded && frames++ < 200) run(late.pw, late.cc, 1, off);
    run(late.pw, late.cc, 14, off);
    const l0 = late.cc.position[1];
    run(late.pw, late.cc, 6, { ...off, jump: true });
    expect(late.cc.position[1]).toBeLessThan(l0 - 0.2);
  });

  it('remembers a jump pressed just before landing', async () => {
    const { pw, cc } = await setup(true);
    cc.teleport([0, 0.5, 0]);
    // Fall, press jump a few frames before touching down, release at once.
    let pressed = false;
    let rose = false;
    for (let i = 0; i < 120; i++) {
      const nearGround = cc.position[1] < 0.12 && !cc.grounded;
      const input: In = { ...IDLE, jump: nearGround && !pressed };
      if (input.jump) pressed = true;
      cc.move(input, DT, 5, 6);
      pw.stepFixed();
      if (pressed && cc.verticalSpeed > 1) rose = true;
    }
    expect(pressed).toBe(true);
    expect(rose).toBe(true);
  });

  it('a short tap hops lower than a held jump', async () => {
    const tap = await setup(true);
    const hold = await setup(true);
    for (const t of [tap, hold]) run(t.pw, t.cc, 40, IDLE);
    const peak = (t: { pw: PhysicsWorld; cc: CharacterController }, held: number): number => {
      let max = 0;
      for (let i = 0; i < 80; i++) {
        t.cc.move({ ...IDLE, jump: i < held }, DT, 5, 6);
        t.pw.stepFixed();
        max = Math.max(max, t.cc.position[1]);
      }
      return max;
    };
    const small = peak(tap, 3);
    const big = peak(hold, 40);
    expect(small).toBeGreaterThan(0.2);
    expect(small).toBeLessThan(big * 0.75);
  });

  it('keeps the full jump when no feel is set', async () => {
    const { pw, cc } = await setup(false);
    run(pw, cc, 40, IDLE);
    let max = 0;
    for (let i = 0; i < 80; i++) {
      cc.move({ ...IDLE, jump: i < 2 }, DT, 5, 6);
      pw.stepFixed();
      max = Math.max(max, cc.position[1]);
    }
    expect(max).toBeGreaterThan(1.5);
  });
});

describe('air control', () => {
  it('lets go of the stick in mid-air and the heading carries on further than on the ground', async () => {
    const ground = await setup(true);
    run(ground.pw, ground.cc, 40, IDLE);
    run(ground.pw, ground.cc, 40, FORWARD);
    const g0 = ground.cc.position[2];
    run(ground.pw, ground.cc, 20, IDLE);
    const groundStop = g0 - ground.cc.position[2];

    const air = await setup(true);
    run(air.pw, air.cc, 40, IDLE);
    run(air.pw, air.cc, 40, FORWARD);
    run(air.pw, air.cc, 1, { ...FORWARD, jump: true });
    run(air.pw, air.cc, 5, FORWARD);
    const a0 = air.cc.position[2];
    run(air.pw, air.cc, 12, IDLE);
    expect(air.cc.grounded).toBe(false);
    expect(a0 - air.cc.position[2]).toBeGreaterThan(groundStop * 1.4);
  });
});

describe('jump arc', () => {
  async function apex(jumpHeld: boolean): Promise<{ top: number; air: number }> {
    const { pw, cc } = await setup(true);
    run(pw, cc, 40, IDLE);
    const y0 = cc.position[1];
    let top = y0;
    let air = 0;
    for (let i = 0; i < 240; i++) {
      cc.move({ ...IDLE, jump: i === 0 || (jumpHeld && !cc.grounded) }, DT, 5, 6);
      pw.stepFixed();
      top = Math.max(top, cc.position[1]);
      if (i > 2 && cc.grounded) break;
      air++;
    }
    return { top: top - y0, air };
  }

  it('a held jump rises higher than a tap, and falls faster than it rises', async () => {
    const held = await apex(true);
    const tap = await apex(false);
    expect(held.top).toBeGreaterThan(tap.top + 0.2);
    // Fall gravity > 1: the whole hop lasts less than a symmetric one (2 * 6 / 9.81 = 1.22 s) and the hold rises ~1.5 m.
    expect(held.air / 60).toBeLessThan(1.2);
    expect(held.top).toBeLessThan(1.9);
  });

  it('holding jump does not retrigger on landing', async () => {
    const { pw, cc } = await setup(true);
    run(pw, cc, 40, IDLE);
    let jumps = 0;
    let was = true;
    for (let i = 0; i < 300; i++) {
      cc.move({ ...IDLE, jump: true }, DT, 5, 6);
      pw.stepFixed();
      if (was && !cc.grounded) jumps++;
      was = cc.grounded;
    }
    expect(jumps).toBe(1);
  });
});
