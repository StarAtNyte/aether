/**
 * The player's weapon (`world.player.weapon`): trigger, fire rate, magazine,
 * reserve and reload, and the hitscan shot itself.
 *
 * A shot follows the crosshair ray the host reports (`input.aim`, the
 * camera's eye and view direction) or, without one, leaves the player's eyes
 * along the input yaw and pitch. It is tested against every living NPC body
 * (a vertical capsule from the feet up, so a head shot is the top 15 %) and
 * against the host's solid geometry (`LogicHost.raycast`): the nearest wins,
 * so a wall stops a bullet and a body behind it is safe. Characters allied
 * with the player (`npc.allies` includes "player") stop shots without being
 * hurt.
 *
 * Ammunition lives in world state (`ammoKey`, `reserveKey`), written only when
 * it changes, so rules, the HUD and pickups (a `collectible` adding to the
 * reserve key) all work with it. Spread is drawn from a seeded stream: the
 * same inputs give the same shots. Everything shown (muzzle flash, impacts,
 * hit markers, sounds) goes through the presentation hooks and is never read
 * back.
 */
import type { EntityId, FeelEvent, Json, Vec3, VfxPreset, WeaponSpec } from '@aether/core';
import type { NpcBrain } from './npc/brain';
import type { NpcSystem } from './npc/system';
import type { InputState, LogicHost } from './types';

/** `source` of the feedback events a weapon sends (the studio draws hit markers for them). */
export const WEAPON_SOURCE = 'player-weapon';
/** Most ray hits asked of the host per shot. */
const RAY_LIMIT = 8;
/** Share of a character's height above which a hit is a head shot. */
const HEAD_FROM = 0.85;
/** Bodies are a little fatter for bullets than for walking (forgiving aim). */
const BODY_PAD = 1.2;
/** Eye height of the player above the feet (m) when no aim ray is given. */
const EYE = 1.6;

/** What the weapon needs from the logic engine. */
export interface WeaponEnv {
  readonly host: LogicHost;
  readonly npcs: NpcSystem;
  playerId(): EntityId | undefined;
  positionOf(id: EntityId): Readonly<Vec3> | undefined;
  readState(key: string): Json | undefined;
  setState(key: string, value: Json): string;
  isDynamic(id: EntityId): boolean;
  feedback(kind: FeelEvent, at: Readonly<Vec3> | undefined, opts?: { source?: EntityId; target?: EntityId; amount?: number; intensity?: number }): void;
  effect(vfx: VfxPreset | 'none', at: Readonly<Vec3> | undefined, feel: FeelEvent | undefined, color: string | undefined, scale: number | undefined): void;
  log(text: string): void;
}

/** Live weapon state for HUDs. */
export interface WeaponStatus {
  name: string;
  ammo: number;
  reserve: number;
  magazine: number;
  reloading: boolean;
  /** 0..1 while reloading. */
  reloadProgress: number;
  /** Shots fired and hits landed this session. */
  shots: number;
  hits: number;
  /** Simulation time of the last hit and the last kill (−1: none yet). */
  lastHit: number;
  lastKill: number;
  lastHitHead: boolean;
}

/** One player's gun. */
export class WeaponSystem {
  private cooldown = 0;
  private reloadLeft = 0;
  private triggerWas = false;
  private emptyClick = 0;
  private time = 0;
  readonly status: WeaponStatus;
  private readonly origin: Vec3 = [0, 0, 0];
  private readonly dir: Vec3 = [0, 0, -1];
  private readonly point: Vec3 = [0, 0, 0];

  constructor(
    private readonly env: WeaponEnv,
    readonly spec: WeaponSpec,
    private readonly random: () => number,
  ) {
    this.status = { name: spec.name, ammo: 0, reserve: 0, magazine: spec.magazine, reloading: false, reloadProgress: 0, shots: 0, hits: 0, lastHit: -1, lastKill: -1, lastHitHead: false };
  }

  /** Fill the magazine and the reserve (play start, reset), unless the world state already set them. */
  arm(): void {
    const s = this.spec;
    if (typeof this.env.readState(s.ammoKey) !== 'number') this.env.setState(s.ammoKey, s.magazine);
    if (typeof this.env.readState(s.reserveKey) !== 'number') this.env.setState(s.reserveKey, s.reserve);
    this.cooldown = 0;
    this.reloadLeft = 0;
    this.triggerWas = false;
    this.time = 0;
    this.readAmmo();
    this.status.reloading = false;
    this.status.reloadProgress = 0;
  }

  private readAmmo(): void {
    const a = this.env.readState(this.spec.ammoKey);
    const r = this.env.readState(this.spec.reserveKey);
    this.status.ammo = typeof a === 'number' && Number.isFinite(a) ? Math.max(0, Math.floor(a)) : 0;
    this.status.reserve = typeof r === 'number' && Number.isFinite(r) ? Math.max(0, Math.floor(r)) : 0;
  }

  /** One fixed step: reload timer, the R key, the trigger. `pressed` holds the keys that went down this step. */
  tick(dt: number, input: InputState, pressed: ReadonlySet<string>): void {
    this.time += dt;
    this.readAmmo();
    const s = this.spec;
    const st = this.status;
    this.cooldown = Math.max(-dt, this.cooldown - dt);
    this.emptyClick = Math.max(0, this.emptyClick - dt);
    if (this.reloadLeft > 0) {
      this.reloadLeft -= dt;
      st.reloadProgress = Math.min(1, 1 - this.reloadLeft / s.reloadTime);
      if (this.reloadLeft <= 0) this.finishReload();
    } else if (pressed.has('r') && st.ammo < s.magazine && st.reserve > 0) this.startReload();
    const fire = input.fire === true;
    const edge = fire && !this.triggerWas;
    this.triggerWas = fire;
    if (!fire || this.reloadLeft > 0 || (!s.automatic && !edge)) return;
    if (st.ammo <= 0) {
      if (st.reserve > 0) this.startReload();
      else if (this.emptyClick <= 0) {
        this.emptyClick = 0.35;
        this.env.host.sound('empty');
      }
      return;
    }
    if (this.cooldown > 0) return;
    // Keep the cadence exact at any step length: the remainder carries over to the next shot.
    this.cooldown += 1 / s.fireRate;
    if (this.cooldown < 0) this.cooldown = 1 / s.fireRate;
    st.ammo -= 1;
    this.env.setState(s.ammoKey, st.ammo);
    this.fire(input);
    if (st.ammo === 0 && st.reserve > 0) this.startReload();
  }

  private startReload(): void {
    if (this.reloadLeft > 0) return;
    this.reloadLeft = this.spec.reloadTime;
    this.status.reloading = true;
    this.status.reloadProgress = 0;
    this.env.host.sound('reload');
  }

  private finishReload(): void {
    const s = this.spec;
    const st = this.status;
    this.reloadLeft = 0;
    st.reloading = false;
    st.reloadProgress = 0;
    const move = Math.min(s.magazine - st.ammo, st.reserve);
    if (move <= 0) return;
    st.ammo += move;
    st.reserve -= move;
    this.env.setState(s.ammoKey, st.ammo);
    this.env.setState(s.reserveKey, st.reserve);
  }

  /** Aim ray of this shot into `origin` / `dir` (unit), with the weapon's spread. False without a player. */
  private aim(input: InputState, feet: Readonly<Vec3>): boolean {
    const a = input.aim;
    const o = this.origin;
    const d = this.dir;
    if (a && finite3(a.origin) && finite3(a.dir) && Math.hypot(a.dir[0], a.dir[1], a.dir[2]) > 1e-6) {
      o[0] = a.origin[0];
      o[1] = a.origin[1];
      o[2] = a.origin[2];
      d[0] = a.dir[0];
      d[1] = a.dir[1];
      d[2] = a.dir[2];
    } else {
      const yaw = (input.pointerYawDeg * Math.PI) / 180;
      const pitch = ((Number.isFinite(input.pitchDeg) ? (input.pitchDeg as number) : 0) * Math.PI) / 180;
      o[0] = feet[0];
      o[1] = feet[1] + EYE;
      o[2] = feet[2];
      d[0] = -Math.sin(yaw) * Math.cos(pitch);
      d[1] = Math.sin(pitch);
      d[2] = -Math.cos(yaw) * Math.cos(pitch);
    }
    normalize(d);
    const cone = (this.spec.spread * Math.PI) / 360;
    if (cone > 0) {
      // A uniform point in the cone's disc, on two axes perpendicular to the ray.
      const r = Math.sqrt(this.random()) * Math.tan(cone);
      const t = this.random() * Math.PI * 2;
      const ux = Math.abs(d[1]) < 0.99 ? -d[2] : 1;
      const uz = Math.abs(d[1]) < 0.99 ? d[0] : 0;
      const ul = Math.hypot(ux, uz) || 1;
      const u: Vec3 = [ux / ul, 0, uz / ul];
      const v: Vec3 = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
      const cx = Math.cos(t) * r;
      const cy = Math.sin(t) * r;
      d[0] += u[0] * cx + v[0] * cy;
      d[1] += u[1] * cx + v[1] * cy;
      d[2] += u[2] * cx + v[2] * cy;
      normalize(d);
    }
    return true;
  }

  private fire(input: InputState): void {
    const env = this.env;
    const s = this.spec;
    const st = this.status;
    st.shots++;
    const pid = env.playerId();
    const feet = pid !== undefined ? env.positionOf(pid) : undefined;
    if (!feet) return;
    this.aim(input, feet);
    const o = this.origin;
    const d = this.dir;
    // The shot starts level with the player (a camera behind the shoulder must not shoot the player's own back).
    const along = (feet[0] - o[0]) * d[0] + (feet[1] + 1.2 - o[1]) * d[1] + (feet[2] - o[2]) * d[2];
    const start = Math.max(0, along + 0.45);
    const range = s.range + start;
    // Muzzle: the right hand, ahead of the chest along the shot.
    const yaw = (input.pointerYawDeg * Math.PI) / 180;
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const muzzle: Vec3 = [feet[0] + d[0] * 0.85 + rx * 0.22, feet[1] + 1.35 + d[1] * 0.85, feet[2] + d[2] * 0.85 + rz * 0.22];
    env.feedback('shoot', muzzle, { source: WEAPON_SOURCE });
    env.host.sound('shot');
    env.npcs.makeNoise(feet[0], feet[2], s.noise, null, feet[1]);

    // Nearest body along the ray.
    let best: NpcBrain | null = null;
    let bestT = range;
    let bestY = 0;
    for (const b of env.npcs.brains) {
      if (b.dead) continue;
      const t = rayCapsule(o, d, b.x, b.feetY, b.z, b.spec.radius * BODY_PAD, b.spec.height, start - 0.5, bestT);
      if (t < bestT) {
        bestT = t;
        best = b;
        bestY = o[1] + d[1] * t;
      }
    }
    // Nearest solid thing along the ray (walls, crates, the ground); NPC colliders count as their bodies.
    let wallT = Number.POSITIVE_INFINITY;
    let wallId: EntityId | undefined;
    let wallNormal: Vec3 | undefined;
    const cast = env.host.raycast;
    if (typeof cast === 'function') {
      const from: Vec3 = [o[0] + d[0] * start, o[1] + d[1] * start, o[2] + d[2] * start];
      let hits: ReadonlyArray<{ id?: EntityId; distance: number; normal?: Vec3 }> = [];
      try {
        hits = cast.call(env.host, from, [d[0], d[1], d[2]], s.range, RAY_LIMIT) ?? [];
      } catch {
        hits = [];
      }
      for (const h of hits) {
        if (!h || !Number.isFinite(h.distance)) continue;
        const id = h.id;
        if (id !== undefined && (id === pid || id === 'player')) continue;
        const brain = id !== undefined ? env.npcs.brainOf(id) : undefined;
        if (brain) {
          if (brain.dead) continue;
          const t = start + h.distance;
          if (t < bestT) {
            bestT = t;
            best = brain;
            bestY = o[1] + d[1] * t;
          }
          continue;
        }
        wallT = start + h.distance;
        wallId = id;
        wallNormal = h.normal;
        break;
      }
    }
    const p = this.point;
    if (best && bestT <= wallT) {
      p[0] = o[0] + d[0] * bestT;
      p[1] = o[1] + d[1] * bestT;
      p[2] = o[2] + d[2] * bestT;
      this.strike(best, bestY, p);
      return;
    }
    if (Number.isFinite(wallT) && wallT <= range) {
      p[0] = o[0] + d[0] * wallT;
      p[1] = o[1] + d[1] * wallT;
      p[2] = o[2] + d[2] * wallT;
      if (wallNormal && finite3(wallNormal)) {
        // Lift the burst off the surface so it is not buried in it.
        p[0] += wallNormal[0] * 0.05;
        p[1] += wallNormal[1] * 0.05;
        p[2] += wallNormal[2] * 0.05;
      }
      env.effect('impact', p, undefined, '#d8c4a0', 0.55);
      if (wallId !== undefined && s.impulse > 0 && env.isDynamic(wallId)) {
        try {
          env.host.applyImpulse(wallId, [d[0] * s.impulse, d[1] * s.impulse, d[2] * s.impulse]);
        } catch {
          // A failing host must not stop the game.
        }
      }
    }
  }

  /** A bullet reaches a character. */
  private strike(b: NpcBrain, y: number, at: Readonly<Vec3>): void {
    const env = this.env;
    const s = this.spec;
    const st = this.status;
    if (b.spec.allies.includes('player')) {
      // A friend (the thing being defended, a companion): the shot stops at it and does nothing.
      env.effect('impact', at, undefined, '#d8c4a0', 0.4);
      return;
    }
    const head = y >= b.feetY + b.spec.height * HEAD_FROM;
    const dmg = s.damage * (head ? s.headshot : 1);
    const cur = b.self.state['health'];
    const hpBefore = typeof cur === 'number' && Number.isFinite(cur) ? cur : b.hp;
    if (!env.npcs.damage(b.id, dmg)) return;
    b.aggro(6);
    st.hits++;
    st.lastHit = this.time;
    st.lastHitHead = head;
    env.feedback('hit', at, { source: WEAPON_SOURCE, target: b.id, amount: -Math.round(dmg), intensity: head ? 1.3 : 0.7 });
    env.effect('blood', at, undefined, '#7a1a14', head ? 0.8 : 0.55);
    if (hpBefore - dmg <= 0) {
      st.lastKill = this.time;
      env.feedback('kill', [b.x, b.feetY + b.spec.height * 0.5, b.z], { source: WEAPON_SOURCE, target: b.id });
      env.log(`weapon: ${b.id} down${head ? ' (head shot)' : ''}`);
    }
  }
}

function finite3(v: unknown): v is Vec3 {
  return Array.isArray(v) && v.length >= 3 && Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);
}

function normalize(v: Vec3): void {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  v[0] /= l;
  v[1] /= l;
  v[2] /= l;
}

/**
 * Distance along a unit ray (`o`, `d`) to a vertical capsule standing on (x, feetY, z) with radius `r` and height
 * `h`, or +Infinity when the ray misses it within [tMin, tMax]. Exported for tests.
 */
export function rayCapsule(o: Readonly<Vec3>, d: Readonly<Vec3>, x: number, feetY: number, z: number, r: number, h: number, tMin: number, tMax: number): number {
  const half = Math.max(0, h / 2 - r);
  const cy = feetY + h / 2;
  // Closest approach between the ray and the capsule's core segment (y from cy-half to cy+half).
  const wx = o[0] - x;
  const wy = o[1] - cy;
  const wz = o[2] - z;
  const a = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  const b = d[1];
  const c = 1;
  const dd = d[0] * wx + d[1] * wy + d[2] * wz;
  const e = wy;
  const den = a * c - b * b;
  let sc = den > 1e-9 ? (b * e - c * dd) / den : 0;
  let tc = den > 1e-9 ? (a * e - b * dd) / den : e;
  if (tc < -half) {
    tc = -half;
    sc = (-dd + b * tc) / a;
  } else if (tc > half) {
    tc = half;
    sc = (-dd + b * tc) / a;
  }
  const px = wx + d[0] * sc;
  const py = wy + d[1] * sc - tc;
  const pz = wz + d[2] * sc;
  const dist2 = px * px + py * py + pz * pz;
  if (dist2 > r * r) return Number.POSITIVE_INFINITY;
  // Step back from the closest point to the surface (an approximation along the ray, exact for a sphere).
  const t = sc - Math.sqrt(Math.max(0, r * r - dist2));
  return t >= tMin && t <= tMax ? t : Number.POSITIVE_INFINITY;
}
