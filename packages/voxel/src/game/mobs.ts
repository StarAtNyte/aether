/**
 * Mobs: data-driven specs (size, speed, health, drops, temperament) and a
 * small behaviour machine using the same vocabulary as the logic
 * runtime's behaviours — `wander` (idle, then walk to a random nearby
 * spot), `flee` (run from whatever hurt it), `follow`/chase (hostile mobs
 * close in on the player at night) and an attack with knockback. Mobs
 * move with the voxel collision sweep, hop up one-block ledges, avoid
 * cliffs and liquids while wandering, and swim up in water.
 */
import type { VoxelMobKind } from '@aether/core';
import { createBody, moveBody, type SolidQuery, type VoxelBody } from '../collide';

/** Static data of a mob kind. */
export interface MobSpec {
  kind: VoxelMobKind;
  hostile: boolean;
  health: number;
  /** Walk speed (blocks / s). */
  speed: number;
  halfWidth: number;
  height: number;
  /** Damage per hit (hostile mobs). */
  damage: number;
  /** Item drops on death: [item, min, max]. */
  drops: ReadonlyArray<readonly [string, number, number]>;
  /** Sound when hurt. */
  sound: string;
}

/** Mob table. */
export const MOB_SPECS: Readonly<Record<VoxelMobKind, MobSpec>> = {
  sheep: { kind: 'sheep', hostile: false, health: 8, speed: 1.6, halfWidth: 0.45, height: 1.3, damage: 0, drops: [['white_wool', 1, 1], ['raw_mutton', 1, 2]], sound: 'baa' },
  pig: { kind: 'pig', hostile: false, health: 10, speed: 1.7, halfWidth: 0.45, height: 0.9, damage: 0, drops: [['raw_porkchop', 1, 3]], sound: 'oink' },
  chicken: { kind: 'chicken', hostile: false, health: 4, speed: 1.5, halfWidth: 0.2, height: 0.7, damage: 0, drops: [['raw_chicken', 1, 1], ['feather', 0, 2]], sound: 'cluck' },
  zombie: { kind: 'zombie', hostile: true, health: 20, speed: 2.4, halfWidth: 0.3, height: 1.95, damage: 3, drops: [['rotten_flesh', 0, 2]], sound: 'groan' },
  spider: { kind: 'spider', hostile: true, health: 16, speed: 3.1, halfWidth: 0.6, height: 0.9, damage: 2, drops: [['string', 0, 2]], sound: 'hiss' },
};

/** Behaviour state. */
export type MobState = 'idle' | 'wander' | 'flee' | 'chase' | 'attack';

/** A live mob. */
export interface Mob {
  readonly id: number;
  readonly spec: MobSpec;
  readonly body: VoxelBody;
  health: number;
  state: MobState;
  /** Seconds left in the current state. */
  timer: number;
  /** Wander target. */
  tx: number;
  tz: number;
  /** Body yaw (radians, 0 faces −Z). */
  yaw: number;
  /** Walk-cycle phase (radians) and amount (0…1) for rendering. */
  phase: number;
  walk: number;
  /** Seconds of red hurt flash left. */
  hurt: number;
  /** Seconds until the next attack. */
  cooldown: number;
  /** Fall start height (fall damage). */
  fallFrom: number;
  dead: boolean;
}

/** The world as mobs see it. */
export interface MobWorld extends SolidQuery {
  /** True when the block at the cell is dangerous to step into (lava). */
  isHazard(x: number, y: number, z: number): boolean;
}

/** Create a mob standing at (x, y, z). */
export function createMob(id: number, spec: MobSpec, x: number, y: number, z: number, yaw: number): Mob {
  return {
    id, spec, body: createBody(x, y, z, spec.halfWidth, spec.height), health: spec.health, state: 'idle', timer: 1, tx: x, tz: z, yaw,
    phase: 0, walk: 0, hurt: 0, cooldown: 0, fallFrom: y, dead: false,
  };
}

const GRAVITY = 28;
const JUMP = 8.4;
/** Hostile mobs notice the player within this range (blocks). */
export const AGGRO_RANGE = 18;
/** Melee reach of a hostile mob (blocks, centre to centre, horizontal). */
export const ATTACK_RANGE = 1.3;

/** What a mob tick wants from the game (attacks on the player). */
export interface MobTickResult {
  /** Damage dealt to the player this tick (0: none). */
  hit: number;
  /** Knockback direction of the hit. */
  kx: number;
  kz: number;
}

function angleTo(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

function turn(m: Mob, target: number, rate: number, dt: number): void {
  let d = target - m.yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const step = rate * dt;
  m.yaw += Math.abs(d) <= step ? d : Math.sign(d) * step;
}

/** True when stepping into column (x, z) from height y is safe (no cliff > 3, no lava, no deep water) — wander only. */
function safeStep(w: MobWorld, x: number, y: number, z: number): boolean {
  const fx = Math.floor(x);
  const fz = Math.floor(z);
  const fy = Math.floor(y);
  for (let d = 0; d <= 3; d++) {
    const cy = fy - d - 1;
    if (w.isHazard(fx, cy + 1, fz) || w.isHazard(fx, cy, fz)) return false;
    if (w.isLiquid(fx, cy, fz)) return d === 0 && !w.isLiquid(fx, cy - 1, fz);
    if (w.isSolid(fx, cy, fz)) return true;
  }
  return false;
}

/**
 * Advance one mob by `dt`. `px/py/pz` is the player's feet position,
 * `night` enables hostile chasing, `rand()` is the game's seeded RNG.
 * Returns the damage the mob deals to the player this tick (reused object).
 */
export function tickMob(m: Mob, w: MobWorld, dt: number, px: number, py: number, pz: number, playerAlive: boolean, night: boolean, rand: () => number, out: MobTickResult): MobTickResult {
  out.hit = 0;
  out.kx = 0;
  out.kz = 0;
  if (m.dead) return out;
  const b = m.body;
  m.timer -= dt;
  m.hurt = Math.max(0, m.hurt - dt);
  m.cooldown = Math.max(0, m.cooldown - dt);
  const dx = px - b.x;
  const dz = pz - b.z;
  const dist = Math.hypot(dx, dz);
  // Decide.
  if (m.spec.hostile && playerAlive && dist < AGGRO_RANGE && Math.abs(py - b.y) < 8 && (night || m.state === 'chase' || m.state === 'attack' || dist < 6)) {
    m.state = dist < ATTACK_RANGE + m.spec.halfWidth ? 'attack' : 'chase';
  } else if (m.state === 'chase' || m.state === 'attack') {
    m.state = 'idle';
    m.timer = 1 + rand() * 2;
  } else if (m.state === 'flee' && m.timer <= 0) {
    m.state = 'idle';
    m.timer = 1 + rand() * 3;
  } else if (m.state === 'idle' && m.timer <= 0) {
    const a = rand() * Math.PI * 2;
    const r = 3 + rand() * 7;
    m.tx = b.x + Math.cos(a) * r;
    m.tz = b.z + Math.sin(a) * r;
    m.state = 'wander';
    m.timer = 4 + rand() * 6;
  } else if (m.state === 'wander' && (m.timer <= 0 || Math.hypot(m.tx - b.x, m.tz - b.z) < 0.6)) {
    m.state = 'idle';
    m.timer = 2 + rand() * 5;
  }
  // Steer.
  let speed = 0;
  let heading = m.yaw;
  if (m.state === 'wander') {
    heading = angleTo(m.tx - b.x, m.tz - b.z);
    speed = m.spec.speed;
  } else if (m.state === 'flee') {
    heading = angleTo(-dx, -dz);
    speed = m.spec.speed * 2;
  } else if (m.state === 'chase') {
    heading = angleTo(dx, dz);
    speed = m.spec.speed;
  } else if (m.state === 'attack') {
    heading = angleTo(dx, dz);
    speed = m.spec.speed * 0.4;
    if (m.cooldown <= 0 && dist < ATTACK_RANGE + m.spec.halfWidth + 0.3 && Math.abs(py - b.y) < 1.6) {
      m.cooldown = 1;
      out.hit = m.spec.damage;
      const inv = dist > 1e-6 ? 1 / dist : 0;
      out.kx = dx * inv;
      out.kz = dz * inv;
    }
  }
  turn(m, heading, 6, dt);
  let vx = -Math.sin(m.yaw) * speed;
  let vz = -Math.cos(m.yaw) * speed;
  // Wandering never walks off cliffs or into lava.
  if ((m.state === 'wander' || m.state === 'flee') && speed > 0 && b.onGround) {
    const ahead = b.halfWidth + 0.4;
    if (!safeStep(w, b.x - Math.sin(m.yaw) * ahead, b.y, b.z - Math.cos(m.yaw) * ahead)) {
      vx = 0;
      vz = 0;
      if (m.state === 'wander') {
        m.state = 'idle';
        m.timer = 0.5 + rand();
      }
    }
  }
  // Knockback decays into the walking velocity.
  const blend = b.onGround ? Math.min(1, dt * 10) : Math.min(1, dt * 1.5);
  b.vx += (vx - b.vx) * blend;
  b.vz += (vz - b.vz) * blend;
  if (b.liquid > 0) {
    b.vy = Math.min(b.vy + 14 * dt, 2.2);
    b.vx *= 0.9;
    b.vz *= 0.9;
  } else {
    b.vy = Math.max(-50, b.vy - GRAVITY * dt);
  }
  const wasGround = b.onGround;
  moveBody(w, b, dt, false);
  // Hop up a one-block step when walking into it.
  if ((b.hitX || b.hitZ) && b.onGround && speed > 0) b.vy = JUMP;
  if (!wasGround && b.onGround && b.liquid === 0) {
    const fall = m.fallFrom - b.y;
    if (fall > 3.5) hurtMob(m, Math.floor(fall - 3), 0, 0, rand);
  }
  if (b.onGround || b.liquid > 0) m.fallFrom = b.y;
  else m.fallFrom = Math.max(m.fallFrom, b.y);
  const moving = Math.hypot(b.vx, b.vz);
  m.walk += ((moving > 0.2 ? 1 : 0) - m.walk) * Math.min(1, dt * 8);
  m.phase += moving * dt * 4.2;
  return out;
}

/** Damage a mob (knockback along kx/kz); passive mobs flee. Returns true when it died. */
export function hurtMob(m: Mob, amount: number, kx: number, kz: number, rand: () => number): boolean {
  if (m.dead || amount <= 0) return false;
  m.health -= amount;
  m.hurt = 0.35;
  m.body.vx += kx * 6;
  m.body.vz += kz * 6;
  m.body.vy = Math.max(m.body.vy, 5);
  if (!m.spec.hostile) {
    m.state = 'flee';
    m.timer = 3 + rand() * 2;
  } else {
    m.state = 'chase';
  }
  if (m.health <= 0) {
    m.dead = true;
    return true;
  }
  return false;
}

/**
 * Slab test of a ray against a mob's box; returns the hit distance or
 * Infinity. Used for melee targeting.
 */
export function rayMob(m: Mob, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): number {
  const b = m.body;
  let t0 = 0;
  let t1 = max;
  const lo = [b.x - b.halfWidth, b.y, b.z - b.halfWidth];
  const hi = [b.x + b.halfWidth, b.y + b.height, b.z + b.halfWidth];
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  for (let a = 0; a < 3; a++) {
    const da = d[a] as number;
    const oa = o[a] as number;
    if (Math.abs(da) < 1e-9) {
      if (oa < (lo[a] as number) || oa > (hi[a] as number)) return Infinity;
      continue;
    }
    let ta = ((lo[a] as number) - oa) / da;
    let tb = ((hi[a] as number) - oa) / da;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return Infinity;
  }
  return t0;
}
