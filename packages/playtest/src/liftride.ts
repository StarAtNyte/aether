/**
 * Riding a lift by its clock: wait at the boarding point until the deck is level (or will be when a jump lands) and
 * stays so long enough to cross, get on (a walk over a narrow gap, a steered jump over a wide one), stand at the
 * centre, and step off at the destination while the deck is level with it. See lifts.ts for the model.
 *
 * The capsule walks over a deck at rest or in motion like any floor (the physics package's character controller
 * handles kinematic floors); jumps are used only to cross a gap that cannot be run, and to leave the deck.
 */
import type { Vec3 } from '@aether/core';
import { boardBand, EXIT_ABOVE, EXIT_BELOW, runGap, type RideInfo } from './lifts';
import type { NavParams } from './nav';
import { STEP, type Session } from './session';

/** What the ride needs from the bot. */
export interface RideHost {
  readonly session: Session;
  readonly params: NavParams;
  step(forward: number, right: number, jump: boolean, yawDeg: number): Promise<boolean>;
  yawTo(from: Readonly<Vec3>, x: number, z: number): number;
}

/** How a ride ended. */
export interface RideResult {
  result: 'arrived' | 'stuck' | 'fell' | 'ended' | 'stopped';
  /** Plain words for a failure. */
  reason?: string;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

type Hop = 'landed' | 'halt' | 'fell' | 'timeout';

/** Ride the lift from the boarding node `from` to the landing `to`. */
export async function rideLift(h: RideHost, info: RideInfo, from: Readonly<Vec3>, to: Readonly<Vec3>): Promise<RideResult> {
  const s = h.session;
  const p = h.params;
  const clock = info.clock;
  const top = (): number => (s.pw.getState(info.entity)?.position[1] ?? info.startY) + info.topOffset;
  const halt = (): RideResult => ({ result: s.over ? 'ended' : 'stopped' });
  const onDeck = (q: Readonly<Vec3>): boolean =>
    Math.abs(q[0] - info.centre[0]) <= info.half[0] - 0.03 && Math.abs(q[2] - info.centre[1]) <= info.half[1] - 0.03 && Math.abs(q[1] - top()) < 0.3;
  const fallY = Math.min(info.boardY, info.exitY) - 3;
  const horizon = (Number.isFinite(clock.period) ? clock.period * 3 : 60) + 30;
  let prevTop = top();
  let lastSync = -10;
  const tick = async (forward: number, jump: boolean, yawDeg: number): Promise<boolean> => {
    prevTop = top();
    return h.step(forward, 0, jump, yawDeg);
  };
  /** Line the clock up with the deck as it is now (after a step), when they differ. */
  const resync = (): void => {
    const live = top();
    if (Math.abs(clock.topAt(s.time) - live) <= Math.max(0.06, clock.maxRate * STEP * 2.5) || s.time - lastSync < 0.5) return;
    lastSync = s.time;
    clock.sync(s.time, prevTop, live, STEP);
  };
  /** Forward input that lands on `target` (x, z) at height `level`: in the air, or at take-off with `launch`. */
  const steer = (target: readonly [number, number], level: number, launch: boolean): number => {
    const pos = s.position;
    const dist = Math.hypot(target[0] - pos[0], target[1] - pos[2]);
    if (dist < 0.05) return 0;
    const vy = launch ? p.jumpSpeed : s.character.verticalSpeed;
    const disc = vy * vy + 2 * p.gravity * (pos[1] - level);
    const tl = disc > 0 ? (vy + Math.sqrt(disc)) / p.gravity : 0.05;
    return clamp01(dist / (p.speed * Math.max(tl, 0.05)));
  };
  /** Jump and fly to `target`, steering for a landing on it at `level`; returns when the feet touch down again. */
  const hop = async (target: readonly [number, number], level: number): Promise<Hop> => {
    const t0 = s.time;
    let first = true;
    let airborne = false;
    while (s.time - t0 < 3.5) {
      const pos = s.position;
      const yaw = h.yawTo(pos, target[0], target[1]);
      const launch = first && s.character.grounded;
      const forward = steer(target, level, launch);
      first = false;
      if (!(await tick(forward, launch, yaw))) return 'halt';
      if (s.position[1] < fallY) return 'fell';
      if (!s.character.grounded) airborne = true;
      else if (airborne) return 'landed';
    }
    return 'timeout';
  };
  /** Walk to a point on the deck for a moment; true when it is reached, false when it stalls or time runs out. */
  const walkTo = async (target: readonly [number, number], within: number, seconds: number): Promise<boolean | 'halt'> => {
    const t0 = s.time;
    let mark = s.position;
    let markT = s.time;
    while (s.time - t0 < seconds) {
      const pos = s.position;
      const d = Math.hypot(target[0] - pos[0], target[1] - pos[2]);
      if (d <= within) return true;
      if (s.time - markT > 0.3) {
        if (Math.hypot(pos[0] - mark[0], pos[2] - mark[2]) < 0.05) return false;
        mark = pos;
        markT = s.time;
      }
      if (!(await tick(Math.min(1, d / 0.5 + 0.15), false, h.yawTo(pos, target[0], target[1])))) return 'halt';
    }
    return false;
  };

  // 1. Wait for a window: the deck level with the boarding ground, for as long as the crossing takes.
  const { lo: boardLo, hi: boardHi } = boardBand(clock, info.boardY);
  const t0 = s.time;
  const centre: [number, number] = [info.centre[0], info.centre[1]];
  for (let attempt = 0; ; attempt++) {
    for (;;) {
      resync();
      const live = top();
      const inBand = live >= boardLo && live <= boardHi;
      const modelled = s.time - t0 < clock.period * 1.2 + 5;
      const rem = clock.stay(s.time, boardLo, boardHi);
      if (modelled ? rem >= info.boardNeed + 0.05 : inBand) break;
      if (s.time - t0 > horizon) return { result: 'stuck', reason: `the lift was never level with the ground at the boarding point (${info.boardY.toFixed(1)} m) for long enough in ${Math.round(horizon)} s` };
      if (!(await tick(0, false, s.yawDeg))) return halt();
    }
    // 2. Get on: run to the edge and jump for the centre, or walk over a narrow gap.
    let onboard = false;
    const dx = centre[0] - from[0];
    const dz = centre[1] - from[2];
    const dl = Math.hypot(dx, dz) || 1;
    const ux = dx / dl;
    const uz = dz / dl;
    if (info.boardGap > runGap(p)) {
      const c0 = s.time;
      for (;;) {
        const pos = s.position;
        const along = (pos[0] - from[0]) * ux + (pos[2] - from[2]) * uz;
        if (info.boardEdge - along <= 0.12 || s.time - c0 > 3) break;
        if (!(await tick(1, false, h.yawTo(pos, centre[0], centre[1])))) return halt();
      }
      const r = await hop(centre, info.boardY);
      if (r === 'halt') return halt();
      if (r === 'fell') return { result: 'fell', reason: 'fell off the edge while jumping onto the lift' };
      onboard = onDeck(s.position) && s.character.grounded;
    } else {
      const c0 = s.time;
      while (s.time - c0 < 3) {
        const pos = s.position;
        if (onDeck(pos) && s.character.grounded) {
          onboard = true;
          break;
        }
        if (pos[1] < fallY) return { result: 'fell', reason: 'fell off the edge while boarding the lift' };
        const live = top();
        // The deck left before the player was on it: wait for the next one.
        if (!onDeck(pos) && s.character.grounded && (live < boardLo - 0.1 || live > boardHi + 0.1)) break;
        const d = Math.hypot(centre[0] - pos[0], centre[1] - pos[2]);
        if (!(await tick(Math.min(1, d / 0.6 + 0.3), false, h.yawTo(pos, centre[0], centre[1])))) return halt();
      }
    }
    if (onboard) break;
    if (attempt >= 3) return { result: 'stuck', reason: 'could not get onto the lift' };
    // Not on it: back to the boarding point for another try.
    const back = s.position;
    if (Math.hypot(back[0] - from[0], back[2] - from[2]) > 0.3) {
      const w = await walkTo([from[0], from[2]], 0.15, 3);
      if (w === 'halt') return halt();
      if (s.position[1] < fallY) return { result: 'fell', reason: 'fell off the edge while boarding the lift' };
    }
  }

  // 3. To the centre of the deck.
  for (let i = 0; i < 3; i++) {
    const pos = s.position;
    if (Math.hypot(centre[0] - pos[0], centre[1] - pos[2]) < 0.3) break;
    const w = await walkTo(centre, 0.25, 1.5);
    if (w === 'halt') return halt();
    if (w) break;
    if (s.position[1] < fallY) return { result: 'fell', reason: 'fell off the lift while stepping to its centre' };
  }

  // 4. Stand still while it rises; 5. step off when the deck is level with the landing.
  const exitLo = info.exitY - EXIT_BELOW;
  const exitHi = info.exitY + EXIT_ABOVE;
  const arrivedLo = info.exitY - 0.12;
  const patient = clock.maxStay(arrivedLo, exitHi) >= info.exitNeed + 0.1;
  const r0 = s.time;
  const ex = to[0] - info.centre[0];
  const ez = to[2] - info.centre[1];
  const el = Math.hypot(ex, ez) || 1;
  const aim: [number, number] = [to[0] + (ex / el) * 0.2, to[2] + (ez / el) * 0.2];
  for (let attempt = 0; attempt < 5; attempt++) {
    for (;;) {
      resync();
      const live = top();
      const rem = clock.stay(s.time, exitLo, exitHi);
      const modelled = s.time - r0 < clock.period * 1.2 + 5;
      const ready = live >= (patient ? arrivedLo : exitLo) && live <= exitHi && (!modelled || rem >= info.exitNeed + 0.05);
      if (ready) break;
      if (s.time - r0 > horizon) return { result: 'stuck', reason: `the lift never reached the landing (${info.exitY.toFixed(1)} m) for long enough in ${Math.round(horizon)} s` };
      const pos = s.position;
      if (pos[1] < fallY) return { result: 'fell', reason: 'fell off the lift while riding it' };
      // Stand still; a small correction when the ride has pushed the player off the middle.
      const d = Math.hypot(centre[0] - pos[0], centre[1] - pos[2]);
      if (!(await tick(d > 0.6 ? Math.min(0.5, d / 1.5) : 0, false, d > 0.6 ? h.yawTo(pos, centre[0], centre[1]) : s.yawDeg))) return halt();
    }
    for (let hops = 0; hops < 4; hops++) {
      const pos = s.position;
      if (s.character.grounded && !onDeck(pos) && Math.hypot(to[0] - pos[0], to[2] - pos[2]) < 0.35 && Math.abs(to[1] - pos[1]) < 0.7) return { result: 'arrived' };
      if (pos[1] < fallY) return { result: 'fell', reason: 'fell off the lift while stepping off at the landing' };
      if (!onDeck(pos)) {
        // Landed beside the landing point (or short of it on firm ground): finish on foot.
        if (!s.character.grounded) {
          if (!(await tick(steer(aim, to[1], false), false, h.yawTo(pos, aim[0], aim[1])))) return halt();
          continue;
        }
        const w = await walkTo([to[0], to[2]], 0.3, 2);
        if (w === 'halt') return halt();
        if (w) return { result: 'arrived' };
        if (s.position[1] < info.exitY - 1.5) return { result: 'fell', reason: 'missed the landing and fell' };
        continue;
      }
      // The deck dropped away before the player left it: ride on and try the next time round.
      if (top() < exitLo - 0.1) break;
      const r = await hop(aim, to[1]);
      if (r === 'halt') return halt();
      if (r === 'fell') return { result: 'fell', reason: 'missed the landing and fell' };
    }
    const end = s.position;
    if (!onDeck(end) && s.character.grounded && end[1] < info.exitY - 1.5) return { result: 'fell', reason: 'missed the landing and fell' };
  }
  return { result: 'stuck', reason: 'could not step off the lift at the landing' };
}
