/**
 * The vehicle driver of the playtest bot: for a world where the player drives a vehicle around a circuit, it finds the racing
 * line the world itself draws (the looping route of a pace car or rival that passes by the start), then drives it on the real
 * vehicle behaviour, throttle and steering only, with the real gameplay logic running, until the game is won or lost.
 *
 * It does not know about laps or checkpoints: the rules decide when the race is won, and the bot only has to be able to get
 * the vehicle all the way round. A world without such a line stays "unsupported", as before.
 */
import type { Entity, EntityId, Vec3, WorldDoc } from '@aether/core';
import { Session, STEP } from './session';
import { hashWorld } from './proof';
import { PLAYTEST_LIMITS, type Finding, type PlaytestOptions, type PlaytestReport } from './types';

/** A route is a loop of at least this many absolute waypoints. */
const MIN_ROUTE_POINTS = 8;
/** The start of the vehicle may be at most this far (m) from the nearest waypoint of its route. */
const MAX_START_DISTANCE = 30;

const r1 = (n: number): number => Math.round(n * 10) / 10;

/** At most `max` evenly spaced items of `list` (first and last kept). */
function thin<T>(list: readonly T[], max: number): T[] {
  if (list.length <= max) return list.slice();
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(list[Math.round((i * (list.length - 1)) / (max - 1))] as T);
  return out;
}

/** The loops of the world that something patrols (waypoints in world space), longest first. */
export function patrolLoops(world: WorldDoc): Array<{ id: EntityId; points: Vec3[] }> {
  const out: Array<{ id: EntityId; points: Vec3[] }> = [];
  for (const id in world.entities) {
    const e = world.entities[id] as Entity;
    if (e.template) continue;
    for (const b of e.behaviors) {
      if (b.type !== 'patrol' || !b.enabled) continue;
      const p = b.params as { waypoints?: unknown; mode?: unknown; relative?: unknown };
      if (p.mode !== 'loop' || p.relative === true || !Array.isArray(p.waypoints) || p.waypoints.length < MIN_ROUTE_POINTS) continue;
      const pts: Vec3[] = [];
      for (const w of p.waypoints) {
        if (Array.isArray(w) && w.length === 3 && w.every((n) => typeof n === 'number' && Number.isFinite(n))) pts.push([w[0] as number, w[1] as number, w[2] as number]);
      }
      if (pts.length >= MIN_ROUTE_POINTS) out.push({ id, points: pts });
    }
  }
  return out.sort((a, b) => b.points.length - a.points.length);
}

/** Shortest signed angle `to - from` in degrees. */
function angleDiff(to: number, from: number): number {
  let d = (to - from) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/**
 * Drive the world's vehicle along its pace-car route. Returns `null` when the world has no vehicle or no route to follow (the
 * caller then reports the world as unsupported).
 */
export async function driveRace(world: WorldDoc, opts: PlaytestOptions, startedAt: number): Promise<PlaytestReport | null> {
  const vehicleId = world.player.controls;
  if (world.player.mode !== 'vehicle' || !vehicleId || !Object.hasOwn(world.entities, vehicleId)) return null;
  const startPose = (world.entities[vehicleId] as Entity).transform.position;
  const loops = patrolLoops(world).filter((l) => l.id !== vehicleId);
  let route: Vec3[] | null = null;
  for (const l of loops) {
    const d = Math.min(...l.points.map((p) => Math.hypot(p[0] - startPose[0], p[2] - startPose[2])));
    if (d <= MAX_START_DISTANCE) {
      route = l.points;
      break;
    }
  }
  if (!route) return null;
  const maxSim = Math.min(PLAYTEST_LIMITS.MAX_SIM_SECONDS, Math.max(5, opts.maxSimSeconds ?? PLAYTEST_LIMITS.DEFAULT_MAX_SIM_SECONDS));
  const session = await Session.create(world, { trace: opts.trace ?? true, traceHz: opts.traceHz ?? 12 });
  try {
    session.drive(vehicleId);
    session.note('start', 'start', startPose as Vec3);
    const n = route.length;
    // Start from the waypoint ahead of the vehicle, not the nearest one behind it.
    let idx = 0;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const p = route[i] as Vec3;
      const d = Math.hypot(p[0] - startPose[0], p[2] - startPose[2]);
      if (d < best) {
        best = d;
        idx = i;
      }
    }
    let reverseUntil = -1;
    let reverseSteer = 0;
    let slowSince = 0;
    let stuck = 0;
    let lastYield = performance.now();
    while (!session.over && session.time < maxSim) {
      const v = session.vehicle;
      if (!v) break;
      // Progress along the route: look only a few waypoints around the last one (no jumping across a barrier to the other straight).
      let bi = idx;
      let bd = Infinity;
      for (let k = -2; k <= 8; k++) {
        const i = (((idx + k) % n) + n) % n;
        const p = route[i] as Vec3;
        const d = Math.hypot(p[0] - v.position[0], p[2] - v.position[2]);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      idx = bi;
      const speed = Math.max(0, v.speed);
      const look = 6 + 0.5 * speed;
      let ti = idx;
      let acc = 0;
      let prev = route[idx] as Vec3;
      for (let k = 1; k <= n && acc < look; k++) {
        ti = (idx + k) % n;
        const p = route[ti] as Vec3;
        acc += Math.hypot(p[0] - prev[0], p[2] - prev[2]);
        prev = p;
      }
      const target = route[ti] as Vec3;
      const desired = (Math.atan2(-(target[0] - v.position[0]), -(target[2] - v.position[2])) * 180) / Math.PI;
      const err = angleDiff(desired, v.yawDeg);
      let throttle: number;
      let steer: number;
      if (session.time < reverseUntil) {
        throttle = -1;
        steer = reverseSteer;
      } else {
        // The vehicle turns left when its heading grows (a positive error), and `steer` > 0 is right.
        steer = Math.max(-1, Math.min(1, -err / 22));
        const want = 26 - 15 * Math.min(1, Math.abs(err) / 55);
        throttle = Math.max(-1, Math.min(1, (want - speed) / 3));
        if (speed < 0.6) {
          slowSince += STEP;
          if (slowSince > 2.5 && session.time > 1) {
            stuck++;
            reverseUntil = session.time + 1.1;
            reverseSteer = steer > 0 ? -1 : 1;
            slowSince = 0;
          }
        } else slowSince = 0;
      }
      session.driveTick(throttle, steer);
      if (performance.now() - lastYield > 12) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        lastYield = performance.now();
      }
      if (opts.signal?.aborted) break;
      if (stuck > 12) break;
    }
    const outcome = session.host.seen.outcome;
    const seconds = r1(session.time);
    const findings: Finding[] = [];
    if (outcome === 'lose') findings.push({ code: 'lost', severity: 'error', message: `the game was lost: "${session.host.seen.endText || 'game over'}"`, entities: [], hint: session.host.seen.endText || 'check what ends the game' });
    else if (outcome === null) {
      findings.push(
        stuck > 12
          ? { code: 'stuck', severity: 'error', message: `the vehicle kept getting stuck on the way round (${stuck} times)`, entities: [vehicleId], hint: 'check the course for walls or objects in the racing line' }
          : { code: 'budget', severity: 'warning', message: 'the vehicle did not finish within the time limit', entities: [vehicleId], hint: 'make the course shorter or the race easier to finish' },
      );
    }
    if (outcome) session.note(outcome === 'win' ? 'win' : 'lose', session.host.seen.endText || outcome);
    const trace = opts.trace === false ? undefined : session.finishTrace();
    const status: PlaytestReport['status'] = outcome === 'win' ? 'passed' : findings.some((f) => f.severity === 'error') ? 'failed' : 'inconclusive';
    const summary =
      status === 'passed'
        ? `Verified playable: the bot drove ${world.entities[vehicleId]?.name || vehicleId} round the circuit to the win in ${seconds} s, steering and throttle only.`
        : status === 'failed'
          ? `Could not verify: ${findings[0]?.message ?? 'the race could not be finished'}.`
          : `Not verified yet: ${findings[0]?.message ?? 'the race was not finished'}.`;
    return {
      v: 1,
      kind: 'game',
      status,
      won: outcome === 'win',
      outcome,
      seconds: session.time,
      steps: session.steps,
      wallMs: Math.round(performance.now() - startedAt),
      objectives: [],
      findings,
      falls: 0,
      stuckPoints: [],
      path: thin(session.sampledPath(), PLAYTEST_LIMITS.MAX_PATH_POINTS),
      ...(trace ? { trace } : {}),
      summary,
      worldHash: hashWorld(world),
      ...(session.host.seen.endText ? { endText: session.host.seen.endText } : {}),
    };
  } finally {
    session.dispose();
  }
}
