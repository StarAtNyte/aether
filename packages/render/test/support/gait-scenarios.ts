/**
 * Scenarios that drive a headless rig the way the player does (input speed, a ground height under the feet, a jump
 * arc, named clips) and call back after every update. Used by the skirt-clearance test, the foot-slide check and the
 * contact-sheet / screenshot scripts.
 */
import type { CharacterRig } from '../../src/characters/rig';

export const DT = 1 / 60;
/** The rig's forward is -z (a body at the identity yaw walks toward -z). */
export const FWD = -1;

export interface Scenario {
  name: string;
  /** Seconds simulated after the settle. */
  seconds: number;
  /** Prepare the rig before the first step. */
  start?: (rig: CharacterRig) => void;
  /** Called before every update (t seconds since the start): set input, move the root. */
  step: (rig: CharacterRig, t: number, dt: number) => void;
}

const STAIR_RISE = 0.18;
const STAIR_RUN = 0.29;

/** A straight stair climbing (or descending) along +z from z = 0. */
export function stairHeight(z: number, dir: 1 | -1 = 1): number {
  const k = Math.floor(Math.max(0, z) / STAIR_RUN);
  return dir * Math.min(k, 12) * STAIR_RISE;
}

function walker(speed: number, sprint = false): Scenario['step'] {
  return (rig, _t, dt) => {
    rig.input.speed = speed;
    rig.input.sprinting = sprint;
    rig.root.position.z += FWD * speed * dt;
  };
}

function stairs(speed: number, dir: 1 | -1, name = dir > 0 ? 'stair-up' : 'stair-down'): Scenario {
  let y = 0;
  return {
    name,
    seconds: 6,
    start: (rig) => {
      rig.root.position.set(0, dir > 0 ? 0 : 12 * STAIR_RISE, FWD * (dir > 0 ? -0.5 : 0.2));
      y = rig.root.position.y;
      rig.ground = (_x, z) => (dir > 0 ? stairHeight(FWD * z, 1) : 12 * STAIR_RISE - Math.min(12, Math.max(0, Math.floor(Math.max(0, FWD * z) / STAIR_RUN))) * STAIR_RISE);
    },
    step: (rig, _t, dt) => {
      rig.input.speed = speed;
      rig.root.position.z += FWD * speed * dt;
      const want = rig.ground ? (rig.ground(0, rig.root.position.z, y) ?? y) : y;
      y += (want - y) * (1 - Math.exp(-dt / 0.18));
      rig.root.position.y = y;
    },
  };
}

function oneShot(name: string, clip: string, seconds: number, speed = 0): Scenario {
  return {
    name,
    seconds,
    step: (rig, t, dt) => {
      rig.input.speed = speed;
      rig.input.sprinting = speed > 3;
      if (speed > 0) rig.root.position.z += FWD * speed * dt;
      if (t < dt * 0.5) rig.playClip(clip);
    },
  };
}

function jump(): Scenario {
  let y = 0;
  let vy = 0;
  return {
    name: 'jump',
    seconds: 1.6,
    step: (rig, t, dt) => {
      rig.input.speed = 1.4;
      rig.root.position.z += FWD * 1.4 * dt;
      if (t < dt * 0.5) {
        vy = 4.2;
        rig.playClip('jump_start');
      }
      vy -= 9.81 * dt;
      y = Math.max(0, y + vy * dt);
      if (y === 0 && vy < 0) vy = 0;
      rig.root.position.y = y;
      rig.input.grounded = y === 0;
      rig.input.vy = vy;
    },
  };
}

/** The player's gaits and the clips of the Cloudwatch film. */
export const SCENARIOS: Scenario[] = [
  { name: 'idle', seconds: 6, step: (rig) => void (rig.input.speed = 0) },
  { name: 'walk', seconds: 6, step: walker(1.4) },
  { name: 'walk-fast', seconds: 5, step: walker(2.2) },
  { name: 'run', seconds: 5, step: walker(4.5, true) },
  stairs(1.2, 1),
  stairs(1.2, -1),
  // (running up a stair, as Kaho does near the end of the Cloudwatch film: the knees lift highest here)
  stairs(3.5, 1, 'stair-run-up'),
  stairs(3.5, -1, 'stair-run-down'),
  oneShot('turn-left', 'turn_left', 2.4),
  oneShot('turn-right', 'turn_right', 2.4),
  oneShot('turn-around', 'turn_around', 2),
  jump(),
  oneShot('walk-start', 'walk_start', 1.4, 1.4),
  oneShot('run-start', 'run_start', 1.4, 3.5),
  oneShot('run-stop', 'run_stop', 1.5),
  oneShot('look-up', 'look_up', 2.5),
  oneShot('hand-to-chest', 'hand_to_chest', 2.6),
  oneShot('two-fingers', 'two_fingers', 2.3),
];

/** Run one scenario on a fresh pose; `each` is called after every update with the rig and the time. */
export function runScenario(rig: CharacterRig, sc: Scenario, each: (rig: CharacterRig, t: number) => void, settle = 0.8): void {
  rig.autoMotion = false;
  rig.ground = null;
  rig.root.position.set(0, 0, 0);
  rig.input.speed = 0;
  rig.input.grounded = true;
  rig.input.vy = 0;
  rig.input.sprinting = false;
  rig.stopClip();
  for (let i = 0; i < Math.round(settle / DT); i++) {
    rig.update(DT, 2);
    rig.root.updateMatrixWorld(true);
  }
  sc.start?.(rig);
  // (a placed body: the secondary motion starts at rest, as after a teleport)
  rig.springs?.reset();
  const n = Math.round(sc.seconds / DT);
  for (let i = 0; i < n; i++) {
    sc.step(rig, i * DT, DT);
    rig.update(DT, 2);
    rig.root.updateMatrixWorld(true);
    each(rig, i * DT);
  }
}
