/**
 * Deterministic `Math.random` and `Date` for generator realms.
 *
 * Generated geometry is cached by its inputs (generator, params, seed, source), so a generator must be a pure
 * function of them. The sandbox hands generators a seeded API, but `Math.random` and `Date` are plain intrinsics:
 * a generator that used them would be cached as if it were pure, and a cached copy would differ from a fresh run
 * without any error. Inside a generator realm, before untrusted code runs:
 * - `Math.random` draws from a seeded generator (mulberry32) that is re-seeded from the run's seed before every run,
 * - the clock is frozen: `Date.now()` and `new Date()` give {@link FROZEN_TIME}, `Date()` its string.
 *
 * This function is self-contained (no imports, no closures over module scope): the Node sandbox injects its source
 * text into a `node:vm` context, so both realms share one implementation.
 */

/** The instant every generator realm sees as "now" (2000-01-01T00:00:00Z). */
export const FROZEN_TIME = 946_684_800_000;

/** Realm globals the determinism patch replaces. */
export interface DeterminismTarget {
  Math: Math;
  Date: DateConstructor;
}

/**
 * Replace `Math.random` and `Date` on `target` (a realm's global object). Returns the function that re-seeds
 * `Math.random` for a run. Call it before the realm's intrinsics are frozen.
 */
export function installDeterminism(target: DeterminismTarget): (seed: number) => void {
  const FROZEN = 946_684_800_000;
  let state = 0x9e3779b9;
  const random = function random(): number {
    // mulberry32
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Object.defineProperty(target.Math, 'random', { value: random, writable: false, configurable: false, enumerable: false });
  const RealDate = target.Date;
  const FrozenDate = function Date(this: unknown, ...args: unknown[]): unknown {
    if (!new.target) return new RealDate(FROZEN).toString();
    const d: Date = args.length === 0 ? new RealDate(FROZEN) : new (RealDate as unknown as new (...a: unknown[]) => Date)(...args);
    Object.setPrototypeOf(d, new.target.prototype as object);
    return d;
  } as unknown as DateConstructor;
  Object.defineProperty(FrozenDate, 'prototype', { value: RealDate.prototype, writable: false });
  Object.defineProperty(FrozenDate, 'now', { value: () => FROZEN, writable: false, configurable: false });
  Object.defineProperty(FrozenDate, 'parse', { value: RealDate.parse, writable: false, configurable: false });
  Object.defineProperty(FrozenDate, 'UTC', { value: RealDate.UTC, writable: false, configurable: false });
  // `new Date().constructor` and `Date.prototype.constructor` lead to the frozen clock too.
  Object.defineProperty(RealDate.prototype, 'constructor', { value: FrozenDate, writable: false, configurable: false, enumerable: false });
  Object.defineProperty(RealDate, 'now', { value: () => FROZEN, writable: false, configurable: false });
  Object.defineProperty(target, 'Date', { value: FrozenDate, writable: false, configurable: false, enumerable: false });
  return (seed: number): void => {
    const s = Number.isFinite(seed) ? Math.trunc(seed) : 0;
    state = (s ^ 0x5f3759df) | 0;
  };
}
