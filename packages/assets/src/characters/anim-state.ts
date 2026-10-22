/**
 * The animation state machine of a person: what the simulation published
 * (speed, vertical speed, grounded, a hint such as "attack") in, which clip to
 * play and how fast out. Pure and deterministic (a function of the inputs and
 * `dt`), so it is unit-tested without a renderer and can never change the
 * game: it reads the simulation, it never writes to it.
 *
 * Locomotion picks the gait clip whose captured speed is nearest the actual
 * speed (with hysteresis) and sets the play rate to `speed / stride`, so feet
 * do not slide. Jumping, falling, landing, hits, attacks, sitting and death
 * are states with their own clips and fades; one-shot actions (wave, nod,
 * pick up, throw) interrupt locomotion and return to it.
 */
import type { CharacterMood } from '@aether/core';
import type { ClipInfo } from './library';

/** What the simulation says about the body this frame. */
export interface ActorInput {
  /** Horizontal speed (m/s). */
  speed: number;
  /** Vertical speed (m/s), positive up. */
  vy: number;
  grounded: boolean;
  crouching: boolean;
  sprinting: boolean;
  /** NPC runtime hint (`npcAnim`), when the body belongs to an NPC. */
  hint?: 'idle' | 'walk' | 'run' | 'attack' | 'talk' | 'hurt' | 'dead';
  /** In conversation: gestures while idle. */
  talking: boolean;
  /** Seated. */
  sitting: boolean;
  mood: CharacterMood;
}

/** A one-shot action a game or prompt can request. */
export type ActionName = 'wave' | 'nod' | 'shake_head' | 'shrug' | 'cheer' | 'clap' | 'pickup' | 'throw' | 'knock' | 'door' | 'drink' | 'laugh' | 'attack' | 'hit' | 'read' | 'take' | 'present' | 'think';

/** The clip to play now. `changed` is true on the frame the clip switches. */
export interface Plan {
  clip: string;
  timeScale: number;
  loop: boolean;
  /** Crossfade seconds into this clip (when it changed). */
  fade: number;
  changed: boolean;
  /** The state, for diagnostics and tests. */
  state: State;
}

/** States of the machine. */
export type State = 'loco' | 'crouch' | 'jump' | 'air' | 'fall' | 'land' | 'sit_down' | 'sit' | 'stand_up' | 'talk' | 'action' | 'hit' | 'attack' | 'dead';

/** Speeds (m/s) that separate stillness from motion. */
export const STILL_BELOW = 0.12;
const MOVE_ABOVE = 0.2;
/** Play-rate clamp of locomotion clips. */
const RATE_MIN = 0.6;
const RATE_MAX = 1.7;
/** Seconds of falling before the fall pose replaces the jump pose. */
const FALL_AFTER = 0.55;
/** Vertical speed below which an airborne body is falling, not rising. */
const FALL_VY = -2.5;
/** Seconds the take-off pose holds before the rising pose (the rig shapes the push-off and the tuck from the vertical speed). */
const TAKEOFF_TIME = 0.14;
/** Play rate of the sit down and stand up clips (the captured ones are slow, with a long settle). */
export const SIT_RATE = 1.4;
/** Shortest fall (s) that ends in a landing absorb. */
const LAND_AFTER = 0.18;

/** Clip for a mood when standing. */
export function idleClipFor(mood: CharacterMood): string {
  switch (mood) {
    case 'tired':
      return 'idle_breathe';
    case 'angry':
      return 'idle_angry';
    case 'nervous':
      return 'idle_nervous';
    case 'calm':
      return 'idle_wait';
    case 'cheerful':
      return 'idle_b';
    case 'hurt':
      return 'idle_breathe';
    default:
      return 'idle';
  }
}

/** Talking gesture clips for a mood, in the order they alternate. */
export function talkClipsFor(mood: CharacterMood): readonly string[] {
  switch (mood) {
    case 'cheerful':
      return ['talk_excited', 'talk_b'];
    case 'angry':
      return ['talk_angry', 'talk'];
    case 'tired':
    case 'calm':
    case 'hurt':
      return ['talk_calm', 'talk_b'];
    case 'nervous':
      return ['talk_b', 'talk'];
    default:
      return ['talk', 'talk_b', 'talk_calm'];
  }
}

/** The walking clip a mood prefers at walking speeds, or null for the plain gait ladder. */
export function walkClipFor(mood: CharacterMood): string | null {
  switch (mood) {
    case 'tired':
      return 'walk_slow';
    case 'hurt':
      return 'walk_hurt';
    case 'drunk':
      return 'walk_drunk';
    case 'calm':
      return 'stroll';
    case 'angry':
      return 'walk_fast';
    default:
      return null;
  }
}

/** Gait ladder: clips ordered by captured speed. */
const LADDER: readonly string[] = ['walk_slow', 'walk', 'walk_fast', 'jog', 'run', 'sprint'];

/** The ordered locomotion clips that exist in a motion set with their strides. */
export function gaitLadder(table: ReadonlyMap<string, ClipInfo>): Array<{ clip: string; stride: number }> {
  const out: Array<{ clip: string; stride: number }> = [];
  for (const name of LADDER) {
    const c = table.get(name);
    if (c && c.stride > 0.1) out.push({ clip: name, stride: c.stride });
  }
  return out.sort((a, b) => a.stride - b.stride);
}

/** Clip each action plays (falls back to nothing when the set lacks it). */
export const ACTION_CLIP: Readonly<Record<ActionName, string>> = {
  wave: 'wave',
  nod: 'nod',
  shake_head: 'shake_head',
  shrug: 'shrug',
  cheer: 'cheer',
  clap: 'clap',
  pickup: 'pickup',
  throw: 'throw',
  knock: 'knock',
  door: 'door',
  drink: 'drink',
  laugh: 'laugh',
  attack: 'attack',
  hit: 'hit',
  read: 'read',
  take: 'take',
  present: 'present',
  think: 'think',
};

/** The machine. One per body. */
export class LocomotionMachine {
  private readonly ladder: Array<{ clip: string; stride: number }>;
  private state: State = 'loco';
  private clip = '';
  private stateTime = 0;
  private airTime = 0;
  private gait = -1;
  private oneShot: { clip: string; left: number; state: State } | null = null;
  private talkIndex = 0;
  private talkLeft = 0;
  private wasGrounded = true;
  private sitPhase: 'none' | 'down' | 'sit' | 'up' = 'none';
  private dead = false;
  private lastHint: ActorInput['hint'] = 'idle';

  constructor(private readonly table: ReadonlyMap<string, ClipInfo>) {
    this.ladder = gaitLadder(table);
  }

  /** The state now. */
  get current(): State {
    return this.state;
  }

  /** True once the body died (terminal). */
  get isDead(): boolean {
    return this.dead;
  }

  private has(name: string): boolean {
    return this.table.has(name);
  }

  private dur(name: string): number {
    return this.table.get(name)?.duration ?? 1;
  }

  /** Ask for a one-shot action. Returns false when it is not available (dead, airborne, no clip). */
  trigger(action: ActionName): boolean {
    const clip = ACTION_CLIP[action];
    if (this.dead || !this.has(clip) || this.state === 'air' || this.state === 'fall' || this.state === 'jump') return false;
    const state: State = action === 'hit' ? 'hit' : action === 'attack' || action === 'throw' ? 'attack' : 'action';
    this.oneShot = { clip, left: this.dur(clip), state };
    return true;
  }

  /** Pick the gait clip for a speed (hysteresis keeps the choice from flickering at boundaries). */
  private pickGait(speed: number, mood: CharacterMood, sprinting: boolean): { clip: string; stride: number } | null {
    if (this.ladder.length === 0) return null;
    const preferred = speed < (this.ladder.find((g) => g.clip === 'jog')?.stride ?? 2.4) * 0.85 ? walkClipFor(mood) : null;
    if (preferred) {
      const c = this.table.get(preferred);
      if (c && c.stride > 0.1) {
        this.gait = -1;
        return { clip: preferred, stride: c.stride };
      }
    }
    let best = 0;
    let bestErr = Infinity;
    for (let i = 0; i < this.ladder.length; i++) {
      const g = this.ladder[i] as { clip: string; stride: number };
      let err = Math.abs(Math.log(Math.max(0.05, speed) / g.stride));
      if (i === this.gait) err *= 0.7;
      if (sprinting && g.clip === 'sprint') err *= 0.5;
      if (err < bestErr) {
        bestErr = err;
        best = i;
      }
    }
    this.gait = best;
    return this.ladder[best] as { clip: string; stride: number };
  }

  /** Advance by `dt` seconds. */
  update(dt: number, input: ActorInput): Plan {
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.25) : 0;
    this.stateTime += step;
    const prevState = this.state;
    let clip = this.clip;
    let timeScale = 1;
    let loop = true;
    let fade = 0.22;

    if (this.dead || input.hint === 'dead') {
      if (!this.dead && this.has('death')) {
        this.dead = true;
        this.state = 'dead';
        this.stateTime = 0;
      }
      if (this.dead) {
        return this.finish('death', 1, false, 0.12, prevState);
      }
    }

    // One-shot overrides: hit / attack hints from the NPC runtime, and requested actions.
    if (input.hint !== this.lastHint) {
      if (input.hint === 'hurt') this.trigger('hit');
      else if (input.hint === 'attack') this.trigger('attack');
      this.lastHint = input.hint;
    }
    if (this.oneShot) {
      this.oneShot.left -= step;
      if (this.oneShot.left <= 0) this.oneShot = null;
    }
    if (this.oneShot) {
      this.state = this.oneShot.state;
      return this.finish(this.oneShot.clip, 1, false, this.oneShot.state === 'hit' ? 0.06 : 0.14, prevState);
    }

    const moving = input.speed > (this.state === 'loco' && this.gait >= 0 ? STILL_BELOW : MOVE_ABOVE);

    // Airborne: jump, rise, fall, land.
    if (!input.grounded) {
      this.airTime += step;
      if (this.wasGrounded && input.vy > 1) {
        this.state = 'jump';
        this.stateTime = 0;
      }
      this.wasGrounded = false;
      if (this.state === 'jump' && this.stateTime > TAKEOFF_TIME) this.state = 'air';
      if (this.state !== 'jump' && (input.vy < FALL_VY || this.airTime > FALL_AFTER) && input.vy < -0.5) this.state = this.has('fall') ? 'fall' : 'air';
      if (this.state === 'loco' || this.state === 'crouch' || this.state === 'talk' || this.state === 'sit' || this.state === 'sit_down' || this.state === 'stand_up') this.state = input.vy > 0 ? 'air' : this.has('fall') ? 'fall' : 'air';
      const c = this.state === 'fall' ? 'fall' : 'jump_air';
      return this.finish(this.has(c) ? c : 'idle', 1, this.state !== 'jump', 0.12, prevState);
    }
    if (!this.wasGrounded) {
      this.wasGrounded = true;
      if ((this.state === 'air' || this.state === 'fall' || this.state === 'jump') && this.airTime > LAND_AFTER && this.has('land')) {
        this.state = 'land';
        this.stateTime = 0;
      } else this.state = 'loco';
      this.airTime = 0;
    }
    if (this.state === 'land') {
      if (this.stateTime < this.dur('land') * 0.9 && !(moving && input.speed > 2.2)) return this.finish('land', 1, false, 0.08, prevState);
      this.state = 'loco';
    }
    this.airTime = 0;

    // Sitting.
    if (input.sitting || this.sitPhase === 'down' || this.sitPhase === 'sit') {
      if (input.sitting) {
        if (this.sitPhase === 'none' || this.sitPhase === 'up') {
          this.sitPhase = this.has('sit_down') ? 'down' : 'sit';
          this.stateTime = 0;
        }
        if (this.sitPhase === 'down' && this.stateTime >= (this.dur('sit_down') / SIT_RATE) * 0.97) {
          this.sitPhase = 'sit';
          this.stateTime = 0;
        }
        if (this.sitPhase === 'down') {
          this.state = 'sit_down';
          return this.finish('sit_down', SIT_RATE, false, 0.2, prevState);
        }
        this.state = 'sit';
        const sitting = input.talking && this.has('sit_shrug') ? 'sit_shrug' : this.has('sit') ? 'sit' : 'idle';
        return this.finish(sitting, 1, true, 0.25, prevState);
      }
      this.sitPhase = this.has('stand_up') ? 'up' : 'none';
      this.stateTime = 0;
    }
    if (this.sitPhase === 'up') {
      if (this.stateTime < (this.dur('stand_up') / SIT_RATE) * 0.95) {
        this.state = 'stand_up';
        return this.finish('stand_up', SIT_RATE, false, 0.2, prevState);
      }
      this.sitPhase = 'none';
    }

    // Locomotion.
    if (moving) {
      this.state = input.crouching && this.has('crouch_walk') ? 'crouch' : 'loco';
      if (this.state === 'crouch') {
        const c = this.table.get('crouch_walk') as ClipInfo;
        timeScale = clamp(input.speed / Math.max(0.3, c.stride), RATE_MIN, RATE_MAX);
        return this.finish('crouch_walk', timeScale, true, 0.2, prevState);
      }
      const g = this.pickGait(input.speed, input.mood, input.sprinting);
      if (g) {
        timeScale = clamp(input.speed / g.stride, RATE_MIN, RATE_MAX);
        return this.finish(g.clip, timeScale, true, 0.25, prevState);
      }
    }
    this.gait = -1;

    // Standing: crouch, talk, or an idle that matches the mood.
    if (input.crouching && this.has('crouch')) {
      this.state = 'crouch';
      return this.finish('crouch', 1, true, 0.25, prevState);
    }
    if (input.talking || input.hint === 'talk') {
      this.state = 'talk';
      this.talkLeft -= step;
      const list = talkClipsFor(input.mood).filter((n) => this.has(n));
      if (list.length > 0) {
        if (this.talkLeft <= 0 || this.clip === '' || !list.includes(this.clip)) {
          this.talkIndex = (this.talkIndex + (this.talkLeft <= 0 ? 1 : 0)) % list.length;
          this.talkLeft = this.dur(list[this.talkIndex] as string) * 0.98;
        }
        return this.finish(list[this.talkIndex] as string, 1, true, 0.3, prevState);
      }
    } else this.talkLeft = 0;
    this.state = 'loco';
    clip = idleClipFor(input.mood);
    if (!this.has(clip)) clip = 'idle';
    fade = 0.3;
    loop = true;
    return this.finish(clip, timeScale, loop, fade, prevState);
  }

  private finish(clip: string, timeScale: number, loop: boolean, fade: number, prev: State): Plan {
    const changed = clip !== this.clip;
    this.clip = clip;
    if (this.state !== prev) this.stateTime = this.state === 'sit_down' || this.state === 'stand_up' ? this.stateTime : 0;
    return { clip, timeScale, loop, fade, changed, state: this.state };
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
