import { describe, expect, it } from 'vitest';
import { createRouteFollower, type FollowRoute, type RouteFollower } from '../src/route';

/** An L-shaped walk: 12 m toward −Z, then 12 m toward +X, a point every 0.5 m. */
function lRoute(): FollowRoute {
  const points: Array<[number, number, number]> = [];
  for (let i = 0; i <= 24; i++) points.push([0, 0, -i * 0.5]);
  for (let i = 1; i <= 24; i++) points.push([i * 0.5, 0, -12]);
  return { points, visits: [], pressAtEnd: false };
}

interface Run {
  reachedEnd: boolean;
  gameSeconds: number;
  maxOffCourse: number;
  follower: RouteFollower;
}

/**
 * A browser at a low frame rate: each rendered frame advances the game by `frameDt` and moves a walker at 4 m/s along the
 * control heading; between frames the page polls the follower `pollsPerFrame` times. With `staleHeading` the follower is
 * shown the heading of the last rendered frame (what a camera-fed driver sees), not the control heading.
 */
function simulate(route: FollowRoute, opts: { frameDt: number; pollsPerFrame: number; staleHeading: boolean; maxSeconds: number }): Run {
  const follower = createRouteFollower(route);
  const end = route.points[route.points.length - 1] as readonly [number, number, number];
  const pos: [number, number, number] = [0, 0, 0];
  let heading = 90; // facing +X, away from the first leg
  let shown = heading;
  let stick = 0;
  let time = 0;
  let maxOffCourse = 0;
  while (time < opts.maxSeconds) {
    for (let k = 0; k < opts.pollsPerFrame; k++) {
      const cmd = follower.step({ pos, heading: opts.staleHeading ? shown : heading, time });
      heading += cmd.turn;
      stick = cmd.stick;
    }
    time += opts.frameDt;
    const rad = (heading * Math.PI) / 180;
    pos[0] += Math.sin(rad) * 4 * stick * opts.frameDt;
    pos[2] -= Math.cos(rad) * 4 * stick * opts.frameDt;
    shown = heading;
    // Distance from the L: the walk should never wander off it.
    const off = Math.min(Math.hypot(pos[0], Math.max(0, pos[2] - 0, -12 - pos[2])), Math.hypot(pos[2] + 12, Math.max(0, -pos[0], pos[0] - 12)));
    if (time > 1) maxOffCourse = Math.max(maxOffCourse, off);
    if (Math.hypot(pos[0] - end[0], pos[2] - end[2]) < 0.8) return { reachedEnd: true, gameSeconds: time, maxOffCourse, follower };
  }
  return { reachedEnd: false, gameSeconds: time, maxOffCourse, follower };
}

describe('route follower', () => {
  it('walks the route at 60 fps', () => {
    const run = simulate(lRoute(), { frameDt: 1 / 60, pollsPerFrame: 1, staleHeading: false, maxSeconds: 30 });
    expect(run.reachedEnd).toBe(true);
    expect(run.gameSeconds).toBeLessThan(9);
    expect(run.follower.stuck).toBe(0);
  });

  it('walks the route at 2 fps when polled many times per frame against a heading that only updates per frame', () => {
    // The gameplay e2e failure: software GL rendered Highland Trail at about 2 fps and the driver, polling every 40 ms, stacked
    // up to 30 degrees of turn per poll on a heading that had not moved yet, so the player spun in place by the spawn.
    const run = simulate(lRoute(), { frameDt: 5 / 60, pollsPerFrame: 12, staleHeading: true, maxSeconds: 30 });
    expect(run.reachedEnd).toBe(true);
    expect(run.gameSeconds).toBeLessThan(12);
    expect(run.maxOffCourse).toBeLessThan(1.5);
    expect(run.follower.stuck).toBe(0);
  });

  it('counts game seconds, not polls: a page that polls while the game does not tick is never stuck', () => {
    const follower = createRouteFollower(lRoute());
    const first = follower.step({ pos: [0, 0, 0], heading: 0, time: 3 });
    expect(first.stick).toBe(1);
    for (let i = 0; i < 5000; i++) {
      const cmd = follower.step({ pos: [0, 0, 0], heading: 0, time: 3 });
      expect(cmd).toEqual({ turn: 0, stick: first.stick, jump: false, press: false });
    }
    expect(follower.stuck).toBe(0);
    expect(follower.elapsed).toBe(0);
    // Standing still while the game runs for 3 s is stuck: one nudge (a jump and a skip of two points).
    let jumped = false;
    for (let t = 3; t <= 6.01; t += 1 / 60) jumped = follower.step({ pos: [0, 0, 0], heading: 0, time: t }).jump || jumped;
    expect(follower.stuck).toBe(1);
    expect(jumped).toBe(true);
  });

  it('adds no time when the logic clock goes back (a reset)', () => {
    const follower = createRouteFollower(lRoute());
    follower.step({ pos: [0, 0, 0], heading: 0, time: 10 });
    follower.step({ pos: [0, 0, -0.1], heading: 0, time: 11 });
    follower.step({ pos: [0, 0, -0.2], heading: 0, time: 0 });
    follower.step({ pos: [0, 0, -0.3], heading: 0, time: 0.5 });
    expect(follower.elapsed).toBeCloseTo(1.5, 6);
  });

  it('is self-contained: a page can rebuild it from its source text', () => {
    (globalThis as { __name?: unknown }).__name ??= (f: unknown) => f;
    const rebuilt = new Function(`return (${createRouteFollower.toString()});`)() as typeof createRouteFollower;
    const route = lRoute();
    const a = createRouteFollower(route);
    const b = rebuilt(route);
    for (let i = 0; i < 50; i++) {
      const obs = { pos: [0.01 * i, 0, -0.1 * i] as const, heading: i, time: i / 60 };
      expect(b.step(obs)).toEqual(a.step(obs));
    }
  });
});
