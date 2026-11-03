/**
 * A human-like player for game worlds: the physics bot on the real character controller, logic runtime and weapon,
 * with a skill profile. A novice reacts late, turns its aim slowly, misses by several degrees, wanders and only goes for a
 * medkit when nearly dead; an average player reacts faster, aims within a couple of degrees, holds its ground and picks
 * up what it needs. Runs are seeded, so the same world and seed play the same game.
 *
 * Every run records what a balance review needs: how long the player lived, the wave it reached, how it ended, and who
 * did the damage (per template and per wave), to the player and to whatever it must keep alive.
 */
import type { Entity, EntityId, Vec3, WorldDoc } from '@aether/core';
import type { FeedbackEvent, LogicHost } from '@aether/logic';
import { Session } from '../session';
import { gameShape, templateOf, type GameShape } from './shape';

export interface SkillProfile {
  name: string;
  /** Spread of the aim around the target's chest (degrees, one standard deviation). */
  aimErrorDeg: number;
  /** Seconds from a new target in range to the first shot. */
  reaction: number;
  /** How fast the aim follows a target (degrees per second). */
  turnRate: number;
  /** Engages targets closer than this (m). */
  engageRange: number;
  /** Wanders off in a random direction now and then: [min, max] seconds between, null for never. */
  wander: [number, number] | null;
  /** Goes for a health pickup below this health; for ammunition below this many magazines in reserve. */
  healAt: number;
  ammoAt: number;
  /** Never fires (a player who stands and watches: the lose screen must still come). */
  passive?: boolean;
}

export const SKILL_PROFILES = Object.freeze({
  passive: { name: 'passive', aimErrorDeg: 0, reaction: 0, turnRate: 0, engageRange: 0, wander: null, healAt: 0, ammoAt: 0, passive: true } as SkillProfile,
  novice: { name: 'novice', aimErrorDeg: 4.5, reaction: 0.7, turnRate: 140, engageRange: 28, wander: [3, 6], healAt: 30, ammoAt: 0.5 } as SkillProfile,
  average: { name: 'average', aimErrorDeg: 2.2, reaction: 0.35, turnRate: 320, engageRange: 40, wander: null, healAt: 60, ammoAt: 2 } as SkillProfile,
  strong: { name: 'strong', aimErrorDeg: 1, reaction: 0.2, turnRate: 700, engageRange: 60, wander: null, healAt: 70, ammoAt: 3 } as SkillProfile,
});

export interface GameRun {
  profile: string;
  seed: number;
  outcome: 'win' | 'lose' | null;
  endText: string;
  /** Simulated seconds played (to the end, or to the cap). */
  seconds: number;
  /** Highest wave reached (0 without waves). */
  wave: number;
  /** Seconds each wave started at (index = wave). */
  waveStarts: number[];
  /** Why it was lost: the player went down, an objective fell, or something else. */
  cause: 'player' | 'objective' | 'other' | null;
  /** The objective that fell, when that lost it. */
  fallen: string | null;
  /** Damage to the player per wave and template ("1" → { "raider-n": 40 }). */
  damage: Record<string, Record<string, number>>;
  /** Damage to the objectives per wave and template. */
  objectiveDamage: Record<string, Record<string, number>>;
  kills: number;
  shots: number;
  hits: number;
  pickups: number;
  minHealth: number;
  /** The run hit the wall-clock cap before the game ended or reached its game-time cap. */
  cut: boolean;
}

export interface PlayOptions {
  /** Game seconds before the run stops (default 360). */
  maxSeconds?: number;
  /** Wall-clock time (ms since epoch) the run must stop by. */
  deadline?: number;
  /** Hold the session behind the title card and begin on the first tick (default: when the world has an intro). */
  held?: boolean;
  shape?: GameShape;
}

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const DEG = Math.PI / 180;

function bump(rec: Record<string, Record<string, number>>, wave: number, who: string, amount: number): void {
  const w = (rec[String(wave)] ??= {});
  w[who] = (w[who] ?? 0) + amount;
}

/** Play `world` once with `profile` and `seed`. */
export async function playGame(world: WorldDoc, profile: SkillProfile, seed: number, opts: PlayOptions = {}): Promise<GameRun> {
  const shape = opts.shape ?? gameShape(world);
  const maxSeconds = opts.maxSeconds ?? 360;
  const s = await Session.create(world, { trace: false, held: opts.held ?? world.intro !== undefined });
  const run: GameRun = { profile: profile.name, seed, outcome: null, endText: '', seconds: 0, wave: 0, waveStarts: [0], cause: null, fallen: null, damage: {}, objectiveDamage: {}, kills: 0, shots: 0, hits: 0, pickups: 0, minHealth: Infinity, cut: false };
  try {
    const rt = s.runtime;
    const rand = rng(seed * 2654435761 + 7);
    const gauss = (): number => (rand() + rand() + rand() + rand() - 2) * 1.73;
    const waveNow = (): number => {
      const v = shape.waveKey ? rt.readState(shape.waveKey) : 0;
      return typeof v === 'number' ? v : 0;
    };
    const objectives = new Set(shape.objectives);
    // Pickups on the ground: placed ones and those dropped or spawned during play.
    const pickupKeys = new Map<string, string>();
    for (const p of shape.pickups) pickupKeys.set(p.id, p.key);
    const live = new Map<EntityId, { at: Vec3; key: string }>();
    for (const p of shape.pickups) {
      const e = world.entities[p.id];
      if (e && !e.template) live.set(p.id, { at: [...e.transform.position] as Vec3, key: p.key });
    }
    const host = s.host as PlaytestHostLike;
    const spawn = host.spawn.bind(host);
    host.spawn = (e: Entity): void => {
      spawn(e);
      const key = pickupKeys.get(templateOf(world, e.id));
      if (key) live.set(e.id, { at: [...e.transform.position] as Vec3, key });
    };
    const destroy = host.destroy.bind(host);
    host.destroy = (id: EntityId): void => {
      destroy(id);
      if (live.delete(id)) run.pickups++;
    };
    const setVisible = host.onVisible;
    host.onVisible = (id, visible) => {
      setVisible?.(id, visible);
      const key = pickupKeys.get(id);
      if (!key) return;
      const e = world.entities[id];
      if (!visible) {
        if (live.delete(id)) run.pickups++;
      } else if (e) live.set(id, { at: [...e.transform.position] as Vec3, key });
    };
    host.feedback = (ev: FeedbackEvent): void => {
      if (ev.kind === 'damage' && ev.source && typeof ev.amount === 'number') bump(run.damage, waveNow(), templateOf(world, ev.source), -ev.amount);
      else if (ev.kind === 'hit' && ev.source && ev.target && objectives.has(ev.target) && typeof ev.amount === 'number') bump(run.objectiveDamage, waveNow(), templateOf(world, ev.source), -ev.amount);
    };
    const spawnAt = world.player.spawn;
    const home: Vec3 = [spawnAt[0], spawnAt[1], spawnAt[2]];
    let aimYaw = (world.player.yaw ?? 0) * DEG;
    let aimPitch = 0;
    let target: string | null = null;
    let seenFor = 0;
    let wanderLeft = 0;
    let wanderDir = 0;
    let nextWander = profile.wander ? profile.wander[0] + rand() * (profile.wander[1] - profile.wander[0]) : Infinity;
    let reloadTap = false;
    let lastWave = 0;
    const magazine = world.player.weapon?.magazine ?? 30;
    while (s.time < maxSeconds && !s.over) {
      if (opts.deadline !== undefined && (s.steps & 31) === 0 && Date.now() > opts.deadline) {
        run.cut = true;
        break;
      }
      const p = s.position;
      const eye: Vec3 = [p[0], p[1] + 1.6, p[2]];
      // The nearest live NPC that hunts the player, in range.
      let best: { id: string; x: number; y: number; z: number; d: number } | null = null;
      if (!profile.passive) {
        for (const b of rt.npcs.brains) {
          if (b.dead || !b.eff.enemies.has('player')) continue;
          const d = Math.hypot(b.x - p[0], b.z - p[2]);
          if (d < profile.engageRange && (!best || d < best.d)) best = { id: b.id, x: b.x, y: b.feetY + b.spec.height * 0.62, z: b.z, d };
        }
      }
      if (best && best.id === target) seenFor += 1 / 60;
      else {
        target = best ? best.id : null;
        seenFor = 0;
      }
      const health = Number(rt.readState('health') ?? 100);
      const reserve = shape.reserveKey ? Number(rt.readState(shape.reserveKey) ?? 0) : Infinity;
      const ammo = shape.ammoKey ? Number(rt.readState(shape.ammoKey) ?? 0) : Infinity;
      run.minHealth = Math.min(run.minHealth, health);
      // Where to go: a pickup it needs, a wander, or back to where it started.
      let goal: Vec3 = home;
      if (!profile.passive) {
        const wantHeal = health < profile.healAt;
        const wantAmmo = reserve < profile.ammoAt * magazine;
        if (wantHeal || wantAmmo) {
          let bd = Infinity;
          for (const it of live.values()) {
            if (!((wantHeal && it.key === 'health') || (wantAmmo && it.key !== 'health'))) continue;
            const d = Math.hypot(it.at[0] - p[0], it.at[2] - p[2]);
            if (d < bd && d < 30) {
              bd = d;
              goal = it.at;
            }
          }
        }
      }
      let forward = 0;
      let moveYaw = (Math.atan2(-(goal[0] - p[0]), -(goal[2] - p[2])) * 180) / Math.PI;
      if (Math.hypot(goal[0] - p[0], goal[2] - p[2]) > 1.2) forward = 1;
      if (profile.wander && s.time >= nextWander) {
        wanderLeft = 0.6 + rand() * 0.9;
        wanderDir = rand() * 360;
        nextWander = s.time + profile.wander[0] + rand() * (profile.wander[1] - profile.wander[0]);
      }
      if (wanderLeft > 0) {
        wanderLeft -= 1 / 60;
        moveYaw = wanderDir;
        forward = 1;
      }
      // Aim: follow the target at the profile's turn rate, with its error; fire once it has reacted.
      let aim: { origin: Vec3; dir: Vec3 } | undefined;
      let fire = false;
      if (best) {
        const dx = best.x - eye[0];
        const dy = best.y - eye[1];
        const dz = best.z - eye[2];
        const wantYaw = Math.atan2(dx, dz);
        const wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
        const step = (profile.turnRate * DEG) / 60;
        let dYaw = wantYaw - aimYaw;
        while (dYaw > Math.PI) dYaw -= 2 * Math.PI;
        while (dYaw < -Math.PI) dYaw += 2 * Math.PI;
        aimYaw += Math.max(-step, Math.min(step, dYaw));
        aimPitch += Math.max(-step, Math.min(step, wantPitch - aimPitch));
        const ey = aimYaw + gauss() * profile.aimErrorDeg * DEG;
        const ep = aimPitch + gauss() * profile.aimErrorDeg * 0.6 * DEG;
        aim = { origin: eye, dir: [Math.sin(ey) * Math.cos(ep), Math.sin(ep), Math.cos(ey) * Math.cos(ep)] };
        fire = seenFor >= profile.reaction && Math.abs(dYaw) < 8 * DEG && ammo > 0;
      }
      const wantReload = !profile.passive && shape.hasWeapon && reserve > 0 && (ammo <= 0 || (ammo < magazine / 4 && !best));
      const keys = wantReload && !reloadTap ? ['KeyR'] : [];
      reloadTap = wantReload;
      s.tick({ forward, right: 0, jump: false, yawDeg: moveYaw, fire, ...(aim ? { aim } : {}), keys });
      const w = waveNow();
      if (w > lastWave) {
        for (let i = lastWave + 1; i <= w; i++) run.waveStarts[i] = Math.round(s.time * 10) / 10;
        lastWave = w;
      }
    }
    run.outcome = s.host.seen.outcome;
    run.endText = s.host.seen.endText;
    run.seconds = Math.round(s.time * 10) / 10;
    run.wave = lastWave;
    const kills = rt.readState('kills');
    run.kills = typeof kills === 'number' ? kills : rt.npcs.brains.filter((b) => b.dead && b.eff.enemies.has('player')).length;
    run.shots = rt.weapon?.shots ?? 0;
    run.hits = rt.weapon?.hits ?? 0;
    if (run.minHealth === Infinity) run.minHealth = 100;
    if (run.outcome === 'lose') {
      const hp = Number(rt.readState('health') ?? 100);
      const fallen = rt.npcs.brains.find((b) => b.dead && objectives.has(b.id));
      run.cause = hp <= 0 ? 'player' : fallen ? 'objective' : 'other';
      run.fallen = fallen ? fallen.id : null;
    }
    return run;
  } finally {
    s.dispose();
  }
}

/** The parts of the playtest host the bot wraps. */
type PlaytestHostLike = Session['host'] & Pick<LogicHost, 'feedback'>;
