/**
 * Route follower: plays a recorded route (the verified bot's walk) through human controls — a turn, a forward
 * stick, jump and action taps — the way the in-browser gameplay check drives the studio.
 *
 * It runs on the game's own clock and acts once per game tick. A real browser renders a heavy scene at a few
 * frames per second under load, and a controller polled on a wall-clock timer then sees the same position and
 * heading many times per frame: it would stack one turn on top of another before the first one shows (the player
 * spins in place) and count wall seconds as time spent stuck (skipping route points the player never walked).
 * Steps whose `time` has not advanced since the last one therefore hold the last stick and issue no new turn,
 * jump or press, and every timeout counts game seconds.
 *
 * `createRouteFollower` is self-contained (no imports, no module-level helpers) so a page can rebuild it from its
 * source text (`createRouteFollower.toString()`) and run it next to the simulation.
 */

/** A route: feet positions along a verified run and the stops on it. */
export interface FollowRoute {
  /** Feet positions along the run, in order. */
  points: ReadonlyArray<readonly [number, number, number]>;
  /** Pickups and the goal: route index and the thing's position; the follower walks right up to these. */
  visits: ReadonlyArray<{ idx: number; at: readonly [number, number, number] }>;
  /** Press the action key at the end of the route. */
  pressAtEnd: boolean;
}

/** What the follower sees each step. */
export interface FollowObservation {
  /** The player's feet position. */
  pos: readonly [number, number, number];
  /** Where the player faces in degrees, 0 = toward −Z, 90 = toward +X: the current control yaw, not a camera that eases after it. */
  heading: number;
  /** Game seconds (the logic clock); a step at the same time as the previous one is the same tick. */
  time: number;
}

/** What the follower asks for. */
export interface FollowCommand {
  /** Degrees to add to the heading (same convention as {@link FollowObservation.heading}). */
  turn: number;
  /** Forward stick, 0..1. */
  stick: number;
  /** Tap jump. */
  jump: boolean;
  /** Tap the action key. */
  press: boolean;
}

/** A running follower. */
export interface RouteFollower {
  step(obs: FollowObservation): FollowCommand;
  /** Index of the route point the follower is heading past. */
  readonly idx: number;
  /** Game seconds since the first step. */
  readonly elapsed: number;
  /** Times the follower was stuck (hardly moved for 2.5 game seconds) and skipped ahead. */
  readonly stuck: number;
  /** Progress lines (every 15 game seconds and at stops). */
  readonly log: readonly string[];
}

/** Build a follower for `route`. Self-contained on purpose: see the module comment. */
export function createRouteFollower(route: FollowRoute): RouteFollower {
  const points = route.points;
  const visits = route.visits;
  const last = points.length - 1;
  const wrap = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;
  const fmt = (v: readonly number[]): string => v.map((x) => x.toFixed(1)).join(',');
  let idx = 0;
  let clock = 0;
  let lastTime: number | null = null;
  let lastJump = -1e9;
  let lastPress = -1e9;
  let stuck = 0;
  let watchT = 0;
  let watchP: readonly number[] | null = null;
  let lastLog = -1e9;
  let lastVisitLog = -1e9;
  let stick = 0;
  const done = new Set<number>();
  const stopSince = new Map<number, number>();
  const log: string[] = [];

  const step = (obs: FollowObservation): FollowCommand => {
    const p = obs.pos;
    if (lastTime !== null && obs.time === lastTime) return { turn: 0, stick, jump: false, press: false };
    // A clock that went backwards (a logic reset) is a new tick that adds no time.
    if (lastTime !== null) clock += Math.max(0, obs.time - lastTime);
    lastTime = obs.time;
    if (watchP === null) watchP = [p[0], p[1], p[2]];
    const now = clock;
    let jump = false;
    let press = false;
    // Stops on the route (pickups, the goal): walk right up to the thing itself, hopping, until it is taken or 4 s pass.
    const stop = visits.find((v) => Math.abs(v.idx - idx) <= 1 && !done.has(v.idx));
    if (stop) {
      if (!stopSince.has(stop.idx)) stopSince.set(stop.idx, now);
      const near = Math.hypot(stop.at[0] - p[0], stop.at[2] - p[2]);
      if (near < 0.45 || now - (stopSince.get(stop.idx) as number) > 4) done.add(stop.idx);
    }
    const target = stop !== undefined && !done.has(stop.idx) ? stop.at : null;
    const visit = target !== null;
    if (target && now - lastVisitLog > 1.5) {
      lastVisitLog = now;
      log.push(`visit idx=${idx} t=${now.toFixed(1)}s at ${fmt(p)} thing ${fmt(target)}`);
    }
    // Advance past points we are close to, then aim a little ahead.
    const radius = 0.7;
    for (;;) {
      const q = points[idx];
      if (visit || idx >= last || !q || Math.hypot(q[0] - p[0], q[2] - p[2]) >= radius || Math.abs(q[1] - p[1]) >= 2.5) break;
      idx++;
    }
    const aim = target ?? (points[Math.min(last, idx + 1)] ?? p);
    const dx = aim[0] - p[0];
    const dz = aim[2] - p[2];
    const dist = Math.hypot(dx, dz);
    const want = -(Math.atan2(-dx, -dz) * 180) / Math.PI;
    const diff = wrap(want - obs.heading);
    const turn = dist > 0.25 ? Math.max(-30, Math.min(30, diff)) : 0;
    stick = Math.abs(diff) > 70 ? 0.1 : dist < 0.8 && idx >= last ? 0 : 1;
    if ((aim[1] - p[1] > 0.55 || (visit && dist < 1.5)) && now - lastJump > 0.7) {
      jump = true;
      lastJump = now;
    }
    if (route.pressAtEnd && idx >= points.length - 3 && now - lastPress > 0.5) {
      press = true;
      lastPress = now;
    }
    // Stuck: hardly moved in 2.5 game seconds on a route that keeps going: jump and skip a point.
    if (now - watchT > 2.5) {
      if (Math.hypot(p[0] - (watchP[0] as number), p[2] - (watchP[2] as number)) < 0.4 && idx < last) {
        stuck++;
        jump = true;
        lastJump = now;
        idx = Math.min(last, idx + 2);
      }
      watchT = now;
      watchP = [p[0], p[1], p[2]];
    }
    if (now - lastLog >= 15) {
      lastLog = now;
      log.push(`t=${Math.round(now)}s idx=${idx}/${points.length} pos=${p.map((v) => Math.round(v)).join(',')}`);
    }
    return { turn, stick, jump, press };
  };

  return {
    step,
    get idx() {
      return idx;
    },
    get elapsed() {
      return clock;
    },
    get stuck() {
      return stuck;
    },
    get log() {
      return log;
    },
  };
}
