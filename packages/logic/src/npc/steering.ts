/**
 * Steering behaviours (after Reynolds' "Steering Behaviors for Autonomous Characters" and the formulas Yuka
 * implements, MIT: https://github.com/Mugen87/yuka; rewritten here, not copied): arrive, wander, separation, and the
 * cohesion and alignment of a flock. Pure, allocation-free functions on plain numbers; every random draw comes from
 * the caller's seeded stream, so a replay steers identically (Yuka's wander uses `Math.random`).
 */
import { hyp } from './math';

/**
 * Arrive: the speed to approach a point `dist` away so the character slows into it instead of overshooting. Linear
 * deceleration over the last stretch (`minSpeed + dist * gain`), never above `maxSpeed`.
 */
export function arriveSpeed(dist: number, maxSpeed: number, minSpeed = 0.5, gain = 1.6): number {
  return Math.min(maxSpeed, minSpeed + Math.max(0, dist) * gain);
}

/** State of a wandering character: the angle of its target on the wander circle (radians). */
export interface WanderState {
  theta: number;
}

/**
 * Wander: jitter the target on a circle `distance` ahead of the heading (`hx`, `hz`, unit) by up to `jitter`
 * radians per second, and write the resulting unit direction into `out[0]`, `out[1]`. Small steady changes of
 * direction instead of a new random heading every step.
 */
export function wanderDirection(state: WanderState, random: () => number, dt: number, hx: number, hz: number, out: Float64Array, jitter = 2.4, distance = 2, radius = 1): void {
  state.theta += (random() * 2 - 1) * jitter * dt;
  const tx = hx * distance + Math.cos(state.theta) * radius;
  const tz = hz * distance + Math.sin(state.theta) * radius;
  const l = hyp(tx, tz);
  out[0] = l > 1e-9 ? tx / l : hx;
  out[1] = l > 1e-9 ? tz / l : hz;
}

/**
 * Separation: the push away from one neighbour `(ox, oz)` from the character (offset character − neighbour) within
 * `radius`, stronger the closer it is; add these up over the neighbours. Zero outside the radius.
 */
export function separationPush(ox: number, oz: number, radius: number, out: Float64Array): void {
  const d = hyp(ox, oz);
  if (d >= radius) {
    out[0] = 0;
    out[1] = 0;
    return;
  }
  const k = (1 - d / radius) / Math.max(d, 0.05);
  out[0] = ox * k;
  out[1] = oz * k;
}

/** Running sums of a flock's neighbours: positions (cohesion) and headings (alignment). */
export interface FlockSums {
  n: number;
  px: number;
  pz: number;
  hx: number;
  hz: number;
}

/** Start a flock sum. */
export function flockReset(s: FlockSums): void {
  s.n = 0;
  s.px = 0;
  s.pz = 0;
  s.hx = 0;
  s.hz = 0;
}

/** Add a neighbour at (x, z) moving along (hx, hz) (unit, or zero when it stands). */
export function flockAdd(s: FlockSums, x: number, z: number, hx: number, hz: number): void {
  s.n++;
  s.px += x;
  s.pz += z;
  s.hx += hx;
  s.hz += hz;
}

/**
 * Cohesion and alignment for a character at (x, z) from its neighbours' sums: a pull toward their centre (full
 * strength `cohesionAt` metres away or more) plus their mean heading, written into `out`. Zero without neighbours.
 */
export function flockSteer(s: FlockSums, x: number, z: number, out: Float64Array, cohesionAt = 4): void {
  if (s.n === 0) {
    out[0] = 0;
    out[1] = 0;
    return;
  }
  const cx = s.px / s.n - x;
  const cz = s.pz / s.n - z;
  const cd = hyp(cx, cz);
  const pull = cd > 1e-6 ? Math.min(1, cd / cohesionAt) / cd : 0;
  out[0] = cx * pull + s.hx / s.n;
  out[1] = cz * pull + s.hz / s.n;
}
