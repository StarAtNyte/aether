/**
 * Lifts of every size and rhythm. The bot rides a lift by a clock read from its patrol (see src/lifts.ts): it waits
 * at the boarding point until the deck is level and will stay so long enough, steps or jumps on, stands at the
 * centre and steps off at the landing. Every feasible lift (decks 1.0-4.0 m wide, gaps 0.3-1.5 m on both sides,
 * slow to quick, short and tall travel) must be ridden to the top; a lift that cannot be used must be reported with
 * the reason instead of being tried until the clock runs out.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateWorld, type EntityInput } from '@aether/core';
import { initPhysics } from '@aether/physics';
import { LiftClock, Session, playtest } from '../src';
import { gameWorld, pickup, slab } from './helpers';

interface Lift {
  /** Deck side (m): the deck is square. */
  width: number;
  /** Gap between the ground and the deck, and between the deck and the landing (m). */
  gap: number;
  /** Travel (m). */
  rise: number;
  /** Speed (m/s). */
  speed: number;
  /** Pause at each end (s). */
  wait: number;
  /** Extra height the landing sits above where the lift tops out (m; negative = the lift overshoots). */
  short?: number;
}

/** A floor, a lift between it and a ledge at the lift's top, and a gem on the ledge. No ground plane: gaps are voids. */
function liftWorld(c: Lift) {
  const lx = c.gap + c.width / 2;
  const ledgeX = c.gap * 2 + c.width;
  const ledgeTop = c.rise + (c.short ?? 0);
  const lift: EntityInput = {
    id: 'lift',
    shape: { kind: 'primitive', primitive: 'box', size: [c.width, 0.4, c.width] },
    transform: { position: [lx, -0.2, 0] },
    physics: { body: 'kinematic' },
    behaviors: [{ type: 'patrol', params: { waypoints: [[0, 0, 0], [0, c.rise, 0]], relative: true, speed: c.speed, mode: 'pingpong', wait: c.wait, face: false } }],
  };
  return gameWorld(
    [slab('floor', [-6, -0.25, 0], [12, 0.5, 8]), slab('ledge', [ledgeX + 5, ledgeTop - 0.25, 0], [10, 0.5, 8]), lift, pickup('gem', [ledgeX + 3, ledgeTop + 0.8, 0], 'score')],
    { environment: { ground: null }, state: { score: 0 }, rules: [{ id: 'win', when: { on: 'state', key: 'score', op: '>=', value: 1 }, then: [{ do: 'win', text: 'Up!' }], once: true }] },
    [-4, 0.5, 0],
  );
}

const name = (c: Lift): string => `${c.width} m deck, ${c.gap} m gaps, ${c.rise} m at ${c.speed} m/s, pause ${c.wait} s${c.short ? `, landing ${c.short} m off` : ''}`;

describe('the clock matches the deck', () => {
  it('follows a pingpong patrol over several cycles, pauses included', async () => {
    await initPhysics();
    const c: Lift = { width: 2, gap: 0.9, rise: 4, speed: 2, wait: 1.2 };
    const s = await Session.create(liftWorld(c), { trace: false });
    // Deck top at the start is 0; legs: pause 1.2, rise 2 s, pause 1.2, fall 2 s.
    const clock = new LiftClock([0, 4], [4], 2, 1.2, 'pingpong');
    expect(clock.period).toBeCloseTo(6.4, 6);
    let worst = 0;
    for (let i = 0; i < 60 * 30; i++) {
      s.tick({ forward: 0, right: 0, jump: false, yawDeg: 0 });
      const top = (s.pw.getState('lift')?.position[1] ?? 0) + 0.2;
      worst = Math.max(worst, Math.abs(top - clock.topAt(s.time)));
    }
    expect(worst).toBeLessThan(0.08);
  });

  it('answers how long the deck stays within reach of a stop', () => {
    const clock = new LiftClock([0, 4], [4], 2, 1.2, 'pingpong');
    // At the bottom 1.2 s pause, plus the time the deck takes to rise 0.2 m and to come down it: 0.1 + 0.1 s.
    expect(clock.maxStay(-0.7, 0.2)).toBeCloseTo(1.2 + 0.2 / 2 + 0.2 / 2, 3);
    expect(clock.stay(0, -0.7, 0.2)).toBeCloseTo(1.2 + 0.1, 3);
    expect(clock.stay(2, -0.7, 0.2)).toBe(0);
    // Too quick to ever be level for a second.
    expect(new LiftClock([0, 4], [4], 8, 0, 'pingpong').maxStay(-0.7, 0.2)).toBeLessThan(0.1);
    // A one-way lift stays at the top.
    expect(new LiftClock([0, 4], [4], 2, 1, 'once').maxStay(3.9, 4.1)).toBe(Infinity);
  });
});

describe('lift sweep: feasible lifts are ridden to the top', () => {
  const widths = [1, 1.5, 2, 2.5, 3, 3.5, 4];
  const gaps = [0.3, 0.6, 0.9, 1.2, 1.5];
  const cases: Lift[] = [];
  for (const width of widths) for (const gap of gaps) cases.push({ width, gap, rise: 6, speed: 1.5, wait: 1.6 });
  // Motion: slow and quick, short and tall, long and short pauses.
  for (const rise of [1, 3, 6, 12]) for (const speed of [0.5, 1.5, 3]) for (const wait of [0.5, 2]) cases.push({ width: 2, gap: 0.9, rise, speed, wait });
  // A deck that does not stop at all, but is slow, and a gap narrow enough to walk across.
  cases.push({ width: 2, gap: 0.3, rise: 6, speed: 0.5, wait: 0 });
  cases.push({ width: 1.2, gap: 0.3, rise: 4, speed: 1, wait: 0.2 });
  // Wide gaps: a jump from the ground onto the deck and from it to the landing.
  for (const gap of [2, 3]) cases.push({ width: 2, gap, rise: 5, speed: 1.5, wait: 1.5 });

  it.each(cases.map((c) => [name(c), c] as const))('%s', async (_n, c) => {
    const r = await playtest(liftWorld(c), { trace: false });
    expect(r.summary, JSON.stringify(r.findings.map((f) => f.message))).toContain('Verified playable');
    expect(r.status).toBe('passed');
  }, 60_000);
});

describe('lift sweep: a lift that cannot be used is reported with the reason', () => {
  const cases: Array<[string, Lift, RegExp]> = [
    ['a gap wider than any jump', { width: 2, gap: 6, rise: 4, speed: 1.5, wait: 1.5 }, /gap between the ground and the lift is [\d.]+ m, wider than the [\d.]+ m the player can jump/],
    ['a deck that never pauses and is quick', { width: 2, gap: 0.9, rise: 6, speed: 8, wait: 0 }, /level with the ground for only [\d.]+ s at a time.*moves too fast/],
    ['a lift that stops short of the landing', { width: 2, gap: 0.9, rise: 4, speed: 1.5, wait: 1, short: 2.5 }, /never reaches a landing: it tops out at 4\.0 m/],
    ['a lift that overshoots the landing', { width: 2, gap: 0.9, rise: 4, speed: 1.5, wait: 1, short: -2.5 }, /never reaches a landing: it tops out at 4\.0 m/],
  ];
  it.each(cases)('%s', async (_n, c, reason) => {
    const r = await playtest(liftWorld(c), { trace: false });
    expect(r.status).not.toBe('passed');
    const f = r.findings.find((x) => x.code === 'lift_unusable');
    expect(f, JSON.stringify(r.findings.map((x) => x.message))).toBeDefined();
    expect(f?.message).toMatch(reason);
    expect(f?.entities).toEqual(['lift']);
    // Failed with a cause long before the simulated clock ran out.
    expect(r.seconds).toBeLessThan(60);
  }, 60_000);
});

describe('Lantern Isles with its rune lifts at other sizes', () => {
  // The shipped lifts are 3 m decks in a 4.8 m gap; the bot used to be sensitive to the size (2.8 and 3.4 m failed).
  const text = readFileSync(fileURLToPath(new URL('../../../apps/studio/public/templates/worlds/lantern-isles.json', import.meta.url)), 'utf8');
  it.each([1.5, 2.2, 2.6, 2.8, 3, 3.4, 4])('%s m decks', async (size) => {
    const parsed = validateWorld((JSON.parse(text) as { world: unknown }).world);
    if (!parsed.ok) throw new Error('lantern-isles is invalid');
    const world = parsed.world;
    for (const id of ['rune-lift-1', 'rune-lift-2', 'rune-lift-3']) {
      const e = world.entities[id];
      if (e?.shape.kind === 'primitive') e.shape = { ...e.shape, size: [size, 0.45, size] };
    }
    const r = await playtest(world, { trace: false });
    expect(r.summary, JSON.stringify(r.findings.map((f) => f.message))).toContain('Verified playable');
  }, 120_000);
});

describe('other lifts', () => {
  const shipped = (slug: string) => {
    const text = readFileSync(fileURLToPath(new URL(`../../../apps/studio/public/templates/worlds/${slug}.json`, import.meta.url)), 'utf8');
    const parsed = validateWorld((JSON.parse(text) as { world: unknown }).world);
    if (!parsed.ok) throw new Error(`${slug} is invalid`);
    return parsed.world;
  };

  it.each(['orbital-lab', 'obstacle-course'])('%s: the shipped lift is ridden, with no lift left unusable', async (slug) => {
    const r = await playtest(shipped(slug), { trace: false });
    expect(r.summary).toContain('Verified playable');
    expect(r.findings.filter((f) => f.code === 'lift_unusable')).toEqual([]);
  }, 120_000);

  it('the same lift run twice gives the same run', async () => {
    const world = liftWorld({ width: 3, gap: 0.9, rise: 6, speed: 1.5, wait: 1.6 });
    const a = await playtest(world, { trace: false });
    const b = await playtest(world, { trace: false });
    expect(b.seconds).toBe(a.seconds);
    expect(b.summary).toBe(a.summary);
  }, 60_000);

  it('a lift with a pause on the way up lets the player off at the middle stop', async () => {
    // Stops at 0, 3 and 6 m; the ledge is at 3 m.
    const lift: EntityInput = {
      id: 'lift',
      shape: { kind: 'primitive', primitive: 'box', size: [2, 0.4, 2] },
      transform: { position: [1.9, -0.2, 0] },
      physics: { body: 'kinematic' },
      behaviors: [{ type: 'patrol', params: { waypoints: [[0, 0, 0], [0, 3, 0], [0, 6, 0]], relative: true, speed: 2, mode: 'pingpong', wait: 2, face: false } }],
    };
    const world = gameWorld(
      [slab('floor', [-6, -0.25, 0], [12, 0.5, 8]), slab('ledge', [8.8, 2.75, 0], [10, 0.5, 8]), lift, pickup('gem', [7, 3.8, 0], 'score')],
      { environment: { ground: null }, state: { score: 0 }, rules: [{ id: 'win', when: { on: 'state', key: 'score', op: '>=', value: 1 }, then: [{ do: 'win', text: 'Up!' }], once: true }] },
      [-4, 0.5, 0],
    );
    const r = await playtest(world, { trace: false });
    expect(r.summary, JSON.stringify(r.findings.map((f) => f.message))).toContain('Verified playable');
  }, 60_000);
});
