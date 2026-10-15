/**
 * The NPC behaviour graph: archetype defaults expressed as prioritised
 * transitions, the condition evaluator, and effective-parameter resolution.
 *
 * Evaluation is allocation-free: conditions are walked in place over the
 * (frozen) parsed spec, with a depth guard so a hostile document cannot
 * recurse deeply.
 */
import { compare, type NpcCond, type NpcMode, type NpcSpec, type NpcTransition } from '@aether/core';

/** Most nesting levels of a condition tree that are evaluated. */
export const MAX_COND_DEPTH = 6;

/** What a brain senses and knows this tick (filled by the brain, read by conditions). */
export interface Senses {
  seesFoe: boolean;
  hearsFoe: boolean;
  remembersFoe: boolean;
  /** Distance to the current target (Infinity when none). */
  foeDist: number;
  fearNear: boolean;
  playerDist: number;
  /** 0..1 */
  healthFrac: number;
  /** Seconds in the current state. */
  timeInState: number;
  arrived: boolean;
  /** Hours 0..24. */
  hour: number;
  talkRequested: boolean;
  following: boolean;
  /** Distance from home (m). */
  homeDist: number;
  /** World/entity state reader for `flag` conditions. */
  read(key: string): string | number | boolean | null | undefined;
}

/** Fresh senses (a brain keeps one and refills it). */
export function newSenses(read: Senses['read']): Senses {
  return {
    seesFoe: false,
    hearsFoe: false,
    remembersFoe: false,
    foeDist: Infinity,
    fearNear: false,
    playerDist: Infinity,
    healthFrac: 1,
    timeInState: 0,
    arrived: false,
    hour: 12,
    talkRequested: false,
    following: false,
    homeDist: 0,
    read,
  };
}

/** True when `hour` lies in the (possibly midnight-wrapping) range from..to. */
export function inHours(hour: number, from: number, to: number): boolean {
  if (from === to) return true;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

/** Evaluate a condition against the current senses. */
export function evalCond(c: NpcCond, s: Senses, depth = 0): boolean {
  if (depth > MAX_COND_DEPTH) return false;
  switch (c.k) {
    case 'seesFoe': return s.seesFoe;
    case 'hearsFoe': return s.hearsFoe;
    case 'remembersFoe': return s.remembersFoe;
    case 'foeWithin': return s.foeDist <= c.r;
    case 'foeBeyond': return s.foeDist > c.r;
    case 'healthBelow': return s.healthFrac < c.frac;
    case 'fearNear': return s.fearNear;
    case 'playerWithin': return s.playerDist <= c.r;
    case 'playerBeyond': return s.playerDist > c.r;
    case 'timer': return s.timeInState >= c.t;
    case 'arrived': return s.arrived;
    case 'time': return inHours(s.hour, c.from, c.to);
    case 'flag': {
      const v = s.read(c.key);
      return v !== undefined && v !== null && compare(v, c.op, c.value);
    }
    case 'talkRequested': return s.talkRequested;
    case 'following': return s.following;
    case 'farFromHome': return s.homeDist > c.r;
    case 'always': return true;
    case 'not': return !evalCond(c.c, s, depth + 1);
    case 'all':
      for (let i = 0; i < c.cs.length; i++) if (!evalCond(c.cs[i] as NpcCond, s, depth + 1)) return false;
      return true;
    case 'any':
      for (let i = 0; i < c.cs.length; i++) if (evalCond(c.cs[i] as NpcCond, s, depth + 1)) return true;
      return false;
  }
}

/** Parameters after applying the archetype's defaults. */
export interface NpcEff {
  spec: NpcSpec;
  /** Hostile factions (may include "player"). */
  enemies: ReadonlySet<string>;
  allies: ReadonlySet<string>;
  /** Cannot walk (sentinels, or speed 0). */
  stationary: boolean;
  fleeAt: number;
  alert: number;
  attackRange: number;
  /** Transitions, highest priority first (ties keep list order: custom edges first). */
  edges: readonly NpcTransition[];
  /** Mode a brain starts and falls back to. */
  home: NpcMode;
  /** Treats NPCs that hunt its faction as threats (prey, villagers, merchants, followers). */
  timid: boolean;
}

const HOSTILE_TO_PLAYER = new Set(['guard', 'predator', 'sentinel']);

/** Edges shorthand. */
function e(from: NpcTransition['from'], to: NpcMode, when: NpcCond, priority: number, say?: string): NpcTransition {
  return say === undefined ? { from, to, when, priority } : { from, to, when, priority, say };
}

/** The archetype's default behaviour graph. */
export function defaultTransitions(spec: NpcSpec, fleeAt: number, attackRange: number): NpcTransition[] {
  const out: NpcTransition[] = [];
  const flee: NpcCond = { k: 'healthBelow', frac: fleeAt };
  const settle = (from: NpcMode, to: NpcMode, t: number): NpcTransition => e(from, to, { k: 'all', cs: [{ k: 'timer', t }, { k: 'not', c: { k: 'seesFoe' } }] }, 10);
  const calmDown: NpcCond = { k: 'all', cs: [{ k: 'not', c: { k: 'fearNear' } }, { k: 'not', c: { k: 'remembersFoe' } }, { k: 'timer', t: 3 }] };
  const hunts: NpcCond = { k: 'seesFoe' };
  switch (spec.archetype) {
    case 'guard': {
      const post: NpcMode = spec.waypoints.length > 0 ? 'patrol' : 'idle';
      if (fleeAt > 0) out.push(e('*', 'flee', flee, 90));
      out.push(
        e('*', 'flee', { k: 'fearNear' }, 85),
        e('attack', 'chase', { k: 'foeBeyond', r: attackRange * 1.3 }, 75),
        e('*', 'attack', { k: 'all', cs: [hunts, { k: 'foeWithin', r: attackRange }] }, 78),
        e('*', 'chase', hunts, 70),
        e('chase', 'chase', { k: 'remembersFoe' }, 69),
        e('chase', 'investigate', { k: 'not', c: { k: 'remembersFoe' } }, 60),
        e('chase', 'investigate', { k: 'farFromHome', r: spec.leash }, 65),
        e('attack', 'investigate', { k: 'not', c: { k: 'remembersFoe' } }, 60),
        e('idle', 'investigate', { k: 'hearsFoe' }, 50),
        e('patrol', 'investigate', { k: 'hearsFoe' }, 50),
        e('investigate', 'investigate', { k: 'hearsFoe' }, 49),
        e('investigate', post, { k: 'all', cs: [{ k: 'timer', t: 3 }, { k: 'arrived' }] }, 20),
        e('investigate', post, { k: 'timer', t: 12 }, 19),
        e('flee', post, calmDown, 15),
      );
      break;
    }
    case 'predator': {
      if (fleeAt > 0) out.push(e('*', 'flee', flee, 90));
      out.push(
        e('*', 'flee', { k: 'fearNear' }, 95),
        e('attack', 'chase', { k: 'foeBeyond', r: attackRange * 1.25 }, 75),
        e('*', 'attack', { k: 'all', cs: [hunts, { k: 'foeWithin', r: attackRange }] }, 78),
        e('*', 'chase', hunts, 70),
        e('chase', 'chase', { k: 'remembersFoe' }, 69),
        e('chase', 'investigate', { k: 'not', c: { k: 'remembersFoe' } }, 60),
        e('chase', 'idle', { k: 'farFromHome', r: spec.leash }, 65),
        e('attack', 'investigate', { k: 'not', c: { k: 'remembersFoe' } }, 60),
        e('idle', 'investigate', { k: 'hearsFoe' }, 50),
        e('patrol', 'investigate', { k: 'hearsFoe' }, 50),
        e('investigate', 'idle', { k: 'timer', t: 4 }, 20),
        e('flee', 'idle', { k: 'all', cs: [{ k: 'not', c: { k: 'fearNear' } }, { k: 'timer', t: 4 }] }, 15),
      );
      break;
    }
    case 'prey': {
      out.push(
        e('*', 'flee', { k: 'fearNear' }, 95),
        e('*', 'flee', { k: 'any', cs: [hunts, { k: 'hearsFoe' }] }, 80),
        e('flee', 'idle', calmDown, 15),
      );
      break;
    }
    case 'villager': {
      if (fleeAt > 0) out.push(e('*', 'flee', flee, 90));
      out.push(e('*', 'flee', { k: 'fearNear' }, 85), e('*', 'flee', hunts, 80), e('flee', 'idle', calmDown, 15));
      break;
    }
    case 'merchant': {
      out.push(e('*', 'flee', { k: 'fearNear' }, 85), e('*', 'flee', hunts, 80), e('flee', 'idle', calmDown, 15));
      break;
    }
    case 'follower': {
      out.push(
        e('*', 'flee', { k: 'fearNear' }, 85),
        e('flee', 'idle', calmDown, 15),
      );
      break;
    }
    case 'sentinel': {
      out.push(
        e('*', 'attack', { k: 'all', cs: [hunts, { k: 'foeWithin', r: attackRange }] }, 78),
        e('attack', 'investigate', { k: 'foeBeyond', r: attackRange * 1.3 }, 70),
        e('idle', 'investigate', { k: 'any', cs: [hunts, { k: 'hearsFoe' }] }, 50),
        settle('investigate', 'idle', 3),
      );
      break;
    }
  }
  // Common: settle back after a fight or an alarm.
  if (spec.archetype !== 'sentinel') out.push(settle('attack', 'idle', 2));
  // Anyone can be recruited to follow the player (a dialogue effect, or `follow: true`).
  if (spec.archetype !== 'sentinel') {
    out.push(e('idle', 'follow', { k: 'following' }, 60), e('patrol', 'follow', { k: 'following' }, 60), e('follow', 'idle', { k: 'not', c: { k: 'following' } }, 60));
  }
  // Anyone with a route walks it while nothing else is going on.
  if (spec.waypoints.length > 0 && spec.archetype !== 'sentinel' && spec.archetype !== 'merchant') out.push(e('idle', 'patrol', { k: 'always' }, 5));
  return out;
}

/** Resolve a spec's effective parameters (archetype defaults, sorted edges). */
export function resolveNpc(spec: NpcSpec): NpcEff {
  const enemies = new Set<string>(spec.enemies);
  const allies = new Set<string>(spec.allies);
  if (HOSTILE_TO_PLAYER.has(spec.archetype) && !allies.has('player') && spec.faction !== 'player') enemies.add('player');
  const attackRange = spec.attack?.range ?? 1.7;
  const fleeAt = spec.fleeAt ?? (spec.archetype === 'predator' ? 0.3 : spec.archetype === 'guard' ? 0 : spec.archetype === 'villager' ? 0.4 : 0);
  const alert = Math.max(spec.perception.alert, spec.archetype === 'predator' ? 22 : spec.archetype === 'guard' ? 14 : 0);
  const stationary = spec.archetype === 'sentinel' || spec.speed <= 0;
  // Custom edges first so they win ties against defaults of equal priority.
  const all = [...spec.transitions, ...defaultTransitions(spec, fleeAt, attackRange)];
  const edges = all.map((t, i) => ({ t, i })).sort((a, b) => b.t.priority - a.t.priority || a.i - b.i).map((x) => x.t);
  const home: NpcMode = spec.waypoints.length > 0 && spec.archetype !== 'sentinel' && spec.archetype !== 'merchant' ? 'patrol' : 'idle';
  const timid = spec.archetype === 'prey' || spec.archetype === 'villager' || spec.archetype === 'merchant' || spec.archetype === 'follower';
  return { spec, enemies, allies, stationary, fleeAt, alert, attackRange, edges, home, timid };
}
