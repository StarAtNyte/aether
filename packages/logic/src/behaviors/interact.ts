/**
 * Gameplay object behaviors: collectible, door, pressurePlate, spawner,
 * lifetime, explosive, checkpoint, goal, hazard, launcher.
 */
import { rotateVec3, type EntityId, type Json, type Vec3 } from '@aether/core';
import type { QuatTuple } from '../types';
import { normalize3, yawQuat } from '../vec';
import { Occupancy } from './occupancy';
import type { BehaviorDef, BehaviorEnv } from './types';

const SOUNDS = ['', 'pickup', 'hit', 'explosion', 'win', 'lose', 'click', 'whoosh', 'bell'];

/** Truthiness for state-driven behaviors: true, non-zero numbers, and non-empty strings other than "false"/"closed"/"off". */
export function truthy(v: Json | undefined): boolean {
  if (v === true) return true;
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
  if (typeof v === 'string') return v !== '' && v !== 'false' && v !== 'closed' && v !== 'off' && v !== '0';
  return false;
}

/** Candidate ids for a "who" selector: "*" means everything that moves (dynamic bodies + player). */
function candidates(env: BehaviorEnv, who: string): readonly EntityId[] {
  return who === '*' ? env.movers() : env.resolve(who);
}

export const collectible: BehaviorDef = {
  type: 'collectible',
  description: 'Pickup (coin, gem, key): when the player touches it, adds `value` to a state key, plays a sound and disappears (or respawns).',
  params: {
    scoreKey: { type: 'string', default: 'score', description: 'state key to increase, e.g. "score", "keys", "player.gems"' },
    value: { type: 'number', default: 1, min: -1e6, max: 1e6, description: 'amount added per pickup' },
    by: { type: 'selector', default: 'player', description: 'who can collect it' },
    sound: { type: 'enum', default: 'pickup', options: SOUNDS, description: 'sound on pickup ("" = silent)' },
    message: { type: 'string', default: '', description: 'optional on-screen text on pickup' },
    event: { type: 'string', default: '', description: 'optional event emitted on pickup (for rules)' },
    respawn: { type: 'number', default: 0, min: 0, max: 3600, description: 'seconds until it reappears (0 = gone for good)' },
    margin: { type: 'number', default: 0.5, min: 0, max: 20, description: 'extra pickup reach in meters' },
  },
  create(self, p) {
    const key = p.str('scoreKey') || 'score';
    const value = p.num('value');
    const by = p.str('by');
    const sound = p.str('sound');
    const message = p.str('message');
    const event = p.str('event');
    const respawn = p.num('respawn');
    const margin = p.num('margin');
    const occ = new Occupancy();
    let hiddenFor = 0;
    let envRef: BehaviorEnv | undefined;
    const inside = (id: EntityId): boolean => id !== self.id && envRef !== undefined && envRef.touching(self, id, margin);
    const onEnter = (id: EntityId): void => {
      const env = envRef;
      if (!env || hiddenFor > 0) return;
      const change = env.addState(key, value);
      env.log(`${self.id} collected by ${id} → ${change}`);
      if (sound) env.host.sound(sound);
      if (message) env.host.message(message, 2);
      if (event) env.emit(event);
      if (respawn > 0) {
        hiddenFor = respawn;
        self.state['collected'] = true;
        env.host.setProperty(self.id, 'visible', false);
      } else {
        env.destroy(self.id);
      }
    };
    return {
      update(env, dt) {
        envRef = env;
        if (hiddenFor > 0) {
          hiddenFor -= dt;
          if (hiddenFor <= 0) {
            hiddenFor = 0;
            self.state['collected'] = false;
            env.host.setProperty(self.id, 'visible', true);
            occ.clear();
          }
          return;
        }
        occ.update(candidates(env, by), inside, onEnter);
      },
    };
  },
};

const pivotScratch: Vec3 = [0, 0, 0];
const yawScratch: QuatTuple = [0, 0, 0, 1];

export const door: BehaviorDef = {
  type: 'door',
  description:
    'Opens and closes smoothly by sliding or swinging. Opens when the player is near (proximity), when a state key is truthy (state), or toggles with a key press near it (key). Writes "<id>.open".',
  requires: 'physics.body = kinematic or no physics',
  params: {
    trigger: { type: 'enum', default: 'proximity', options: ['proximity', 'state', 'key'], description: 'what opens the door' },
    stateKey: { type: 'string', default: '', description: 'for trigger=state: key that opens it while truthy, e.g. "unlocked" or "lever-1.on"' },
    key: { type: 'string', default: 'e', description: 'for trigger=key: key that toggles it' },
    radius: { type: 'number', default: 3, min: 0, max: 100, description: 'proximity/key range in meters' },
    who: { type: 'selector', default: 'player', description: 'for trigger=proximity: who opens it' },
    motion: { type: 'enum', default: 'slide', options: ['slide', 'swing'], description: 'slide along `slide` or swing around a hinge' },
    slide: { type: 'vec3', default: [0, 0, 0], description: 'slide offset when open; [0,0,0] = up by its own height' },
    swingAngle: { type: 'number', default: 90, min: -180, max: 180, description: 'degrees to swing open' },
    hinge: { type: 'enum', default: 'left', options: ['left', 'right', 'center'], description: 'hinge edge for swing' },
    duration: { type: 'number', default: 1, min: 0.01, max: 60, description: 'seconds to fully open/close' },
    startOpen: { type: 'boolean', default: false, description: 'initially open' },
  },
  create(self, p) {
    const trigger = p.str('trigger');
    const stateKey = p.str('stateKey');
    const key = p.str('key').toLowerCase();
    const radius = p.num('radius');
    const who = p.str('who');
    const swing = p.str('motion') === 'swing';
    const slide = p.vec3('slide');
    if (slide[0] === 0 && slide[1] === 0 && slide[2] === 0) slide[1] = self.zone.half[1] * 2;
    const swingAngle = p.num('swingAngle');
    const hinge = p.str('hinge');
    const duration = p.num('duration');
    let open = p.bool('startOpen');
    let progress = open ? 1 : 0;
    let lastProgress = progress;
    let announced: boolean | undefined;
    const hingeX = hinge === 'center' ? 0 : (hinge === 'right' ? 1 : -1) * self.zone.half[0];

    const someoneNear = (env: BehaviorEnv, sel: string): boolean => {
      for (const id of candidates(env, sel)) {
        if (id === self.id) continue;
        const q = env.positionOf(id);
        if (!q) continue;
        const dx = q[0] - self.basePos[0], dy = q[1] - self.basePos[1], dz = q[2] - self.basePos[2];
        if (dx * dx + dy * dy + dz * dz <= radius * radius) return true;
      }
      return false;
    };

    return {
      update(env, dt) {
        if (self.dynamic) return;
        if (trigger === 'state') open = stateKey !== '' && truthy(env.readState(stateKey));
        else if (trigger === 'key') {
          if (env.pressed.has(key) && (radius <= 0 || someoneNear(env, 'player'))) open = !open;
        } else open = someoneNear(env, who);
        if (announced !== open) {
          if (announced !== undefined) {
            env.log(`${self.id} ${open ? 'opens' : 'closes'} (${trigger})`);
            env.host.sound('click');
          }
          announced = open;
          self.state['open'] = open;
        }
        const target = open ? 1 : 0;
        const step = dt / duration;
        progress = progress < target ? Math.min(target, progress + step) : Math.max(target, progress - step);
        if (progress === 0 && lastProgress === 0) return;
        lastProgress = progress;
        const e = progress * progress * (3 - 2 * progress); // smoothstep easing
        env.pose(self);
        if (!swing) {
          self.offset[0] += slide[0] * e;
          self.offset[1] += slide[1] * e;
          self.offset[2] += slide[2] * e;
          return;
        }
        // Rotate around the hinge: pos' = pivot + R(θ)(base − pivot), rot' = R(θ)·base.
        const theta = swingAngle * e;
        pivotScratch[0] = hingeX;
        pivotScratch[1] = 0;
        pivotScratch[2] = 0;
        rotateVec3(self.baseRot, pivotScratch, pivotScratch); // hinge offset in world space (base − pivot = −offset)
        pivotScratch[0] = -pivotScratch[0];
        pivotScratch[1] = -pivotScratch[1];
        pivotScratch[2] = -pivotScratch[2];
        const bx = pivotScratch[0], by = pivotScratch[1], bz = pivotScratch[2];
        rotateVec3(yawQuat(yawScratch, theta), pivotScratch, pivotScratch);
        self.offset[0] += pivotScratch[0] - bx;
        self.offset[1] += pivotScratch[1] - by;
        self.offset[2] += pivotScratch[2] - bz;
        self.yawDeg = theta;
      },
    };
  },
};

export const pressurePlate: BehaviorDef = {
  type: 'pressurePlate',
  description: 'Floor switch: pressed while any body (or the player) stands on it. Writes "<id>.pressed" (and optional stateKey), emits events, sinks slightly.',
  requires: 'kinematic/no physics for the sink animation; detection works for any body',
  params: {
    who: { type: 'selector', default: '*', description: 'what can press it ("*" = any dynamic body or the player)' },
    stateKey: { type: 'string', default: '', description: 'extra state key set true/false, e.g. "gate-open"' },
    event: { type: 'string', default: '', description: 'event emitted when pressed' },
    releaseEvent: { type: 'string', default: '', description: 'event emitted when released' },
    height: { type: 'number', default: 1.2, min: 0.05, max: 10, description: 'detection height above the plate in meters' },
    depth: { type: 'number', default: 0.05, min: 0, max: 2, description: 'how far it sinks when pressed' },
  },
  create(self, p) {
    const who = p.str('who');
    const stateKey = p.str('stateKey');
    const event = p.str('event');
    const releaseEvent = p.str('releaseEvent');
    const height = p.num('height');
    const depth = p.num('depth');
    const occ = new Occupancy();
    let envRef: BehaviorEnv | undefined;
    let pressed: boolean | undefined;
    let sunk = false;
    const inside = (id: EntityId): boolean => id !== self.id && envRef !== undefined && envRef.onTopOf(self, id, height);
    return {
      update(env) {
        envRef = env;
        occ.update(candidates(env, who), inside);
        const now = occ.count > 0;
        if (now !== pressed) {
          const first = pressed === undefined;
          pressed = now;
          self.state['pressed'] = now;
          if (stateKey) env.setState(stateKey, now);
          if (!first || now) {
            env.log(`${self.id} ${now ? 'pressed' : 'released'}`);
            env.host.sound('click');
            if (now && event) env.emit(event);
            if (!now && releaseEvent) env.emit(releaseEvent);
          }
        }
        if (now && depth > 0 && !self.dynamic) {
          env.pose(self);
          self.offset[1] -= depth;
          sunk = true;
        } else if (sunk) {
          env.pose(self); // one final write to restore the raised pose
          sunk = false;
        }
      },
    };
  },
};

export const spawner: BehaviorDef = {
  type: 'spawner',
  description: 'Periodically spawns copies of a template entity at (or near) itself, keeping at most `max` alive.',
  requires: 'a template entity (template: true) whose id is given in `template`',
  params: {
    template: { type: 'string', default: '', description: 'id of the template entity to clone' },
    interval: { type: 'number', default: 3, min: 0.05, max: 3600, description: 'seconds between spawns' },
    max: { type: 'int', default: 5, min: 1, max: 200, description: 'maximum alive at once' },
    count: { type: 'int', default: 1, min: 1, max: 20, description: 'spawned per interval' },
    spread: { type: 'number', default: 0, min: 0, max: 100, description: 'random horizontal scatter radius' },
    offset: { type: 'vec3', default: [0, 1, 0], description: 'spawn point relative to the spawner' },
    delay: { type: 'number', default: 0, min: 0, max: 3600, description: 'seconds before the first spawn' },
  },
  create(self, p) {
    const template = p.str('template');
    const interval = p.num('interval');
    const max = p.num('max');
    const count = p.num('count');
    const spread = p.num('spread');
    const offset = p.vec3('offset');
    let timer = interval - p.num('delay');
    let alive: EntityId[] = [];
    const at: Vec3 = [0, 0, 0];
    return {
      update(env, dt) {
        if (!template) return;
        timer += dt;
        if (timer < interval) return;
        timer = 0;
        alive = alive.filter((id) => env.entity(id)?.alive === true);
        const n = Math.min(count, max - alive.length);
        if (n <= 0) return;
        const pos = env.positionOf(self.id) ?? self.basePos;
        at[0] = pos[0] + offset[0];
        at[1] = pos[1] + offset[1];
        at[2] = pos[2] + offset[2];
        const ids = env.spawn(template, [at[0], at[1], at[2]], n, spread);
        for (const id of ids) alive.push(id);
        if (ids.length > 0) env.log(`${self.id} spawned ${ids.join(', ')}`);
      },
    };
  },
};

export const lifetime: BehaviorDef = {
  type: 'lifetime',
  description: 'Destroys the entity after a number of seconds (projectiles, debris, temporary effects).',
  params: {
    seconds: { type: 'number', default: 5, min: 0, max: 86400, description: 'time to live' },
    event: { type: 'string', default: '', description: 'optional event emitted when it expires' },
  },
  create(self, p) {
    const seconds = p.num('seconds');
    const event = p.str('event');
    let age = 0;
    return {
      update(env, dt) {
        age += dt;
        if (age + 1e-9 < seconds) return;
        if (event) env.emit(event);
        env.log(`${self.id} expired after ${seconds}s`);
        env.destroy(self.id);
      },
    };
  },
};

export const explosive: BehaviorDef = {
  type: 'explosive',
  description: 'Explodes (radial impulse + sound) and is destroyed when hit harder than `threshold`, or when the player touches it.',
  requires: 'physics (collision impulses come from physics events); the blast pushes dynamic bodies',
  params: {
    threshold: { type: 'number', default: 5, min: 0, max: 1e6, description: 'minimum collision impulse (N·s) to detonate; 0 = any hit' },
    force: { type: 'number', default: 20, min: 0, max: 1e5, description: 'blast impulse strength' },
    radius: { type: 'number', default: 5, min: 0.1, max: 200, description: 'blast radius in meters' },
    byPlayer: { type: 'boolean', default: false, description: 'also detonate when the player touches it' },
    fuse: { type: 'number', default: 0, min: 0, max: 60, description: 'seconds between trigger and blast' },
    event: { type: 'string', default: '', description: 'optional event emitted on detonation' },
  },
  create(self, p) {
    const threshold = p.num('threshold');
    const force = p.num('force');
    const radius = p.num('radius');
    const byPlayer = p.bool('byPlayer');
    const fuse = p.num('fuse');
    const event = p.str('event');
    let armed = -1;
    let cause = '';
    return {
      update(env, dt) {
        if (armed < 0) {
          for (const c of env.contactsOf(self.id)) {
            if (c.kind === 'collision' && c.impulse >= threshold) {
              cause = `hit by ${c.other} (impulse ${Math.round(c.impulse * 10) / 10})`;
              armed = fuse;
              break;
            }
          }
          const pid = env.playerId();
          if (armed < 0 && byPlayer && pid !== undefined && env.touching(self, pid, 0.3)) {
            cause = `touched by ${pid}`;
            armed = fuse;
          }
          if (armed < 0) return;
        }
        armed -= dt;
        if (armed > 0) return;
        const pos = env.positionOf(self.id) ?? self.basePos;
        const center: Vec3 = [pos[0], pos[1], pos[2]];
        env.explode(center, force, radius);
        env.host.sound('explosion');
        if (event) env.emit(event);
        env.log(`${self.id} exploded: ${cause}`);
        env.destroy(self.id);
      },
    };
  },
};

export const checkpoint: BehaviorDef = {
  type: 'checkpoint',
  description: 'Touching it makes it the respawn point (used by hazards in respawn mode and falling players). Sets state "checkpoint" to its id.',
  params: {
    offset: { type: 'vec3', default: [0, 1, 0], description: 'respawn position relative to the checkpoint' },
    message: { type: 'string', default: 'Checkpoint!', description: 'text shown on activation ("" = none)' },
    margin: { type: 'number', default: 0.5, min: 0, max: 20, description: 'extra trigger reach in meters' },
  },
  create(self, p) {
    const offset = p.vec3('offset');
    const message = p.str('message');
    const margin = p.num('margin');
    const occ = new Occupancy();
    let envRef: BehaviorEnv | undefined;
    const inside = (id: EntityId): boolean => envRef !== undefined && envRef.touching(self, id, margin);
    const onEnter = (): void => {
      const env = envRef;
      if (!env || env.readState('checkpoint') === self.id) return;
      const pos = env.positionOf(self.id) ?? self.basePos;
      env.respawnPoint = [pos[0] + offset[0], pos[1] + offset[1], pos[2] + offset[2]];
      env.setState('checkpoint', self.id);
      self.state['active'] = true;
      env.log(`checkpoint ${self.id} reached`);
      if (message) env.host.message(message, 2);
      env.host.sound('bell');
    };
    return {
      update(env) {
        envRef = env;
        const pid = env.playerId();
        occ.update(pid === undefined ? [] : [pid], inside, onEnter);
      },
    };
  },
};

export const goal: BehaviorDef = {
  type: 'goal',
  description: 'Finish line / treasure: the game is won when the player (or `who`) reaches it.',
  params: {
    who: { type: 'selector', default: 'player', description: 'who must reach it' },
    text: { type: 'string', default: 'You win!', description: 'victory text' },
    margin: { type: 'number', default: 0.5, min: 0, max: 20, description: 'extra reach in meters' },
  },
  create(self, p) {
    const who = p.str('who');
    const text = p.str('text') || 'You win!';
    const margin = p.num('margin');
    return {
      update(env) {
        for (const id of candidates(env, who)) {
          if (id !== self.id && env.touching(self, id, margin)) {
            env.gameOver('win', text, `${id} reached goal ${self.id}`);
            return;
          }
        }
      },
    };
  },
};

export const hazard: BehaviorDef = {
  type: 'hazard',
  description: 'Lava, spikes, water: touching it loses the game, deals damage to a health key, or respawns the player at the last checkpoint.',
  params: {
    mode: { type: 'enum', default: 'lose', options: ['lose', 'damage', 'respawn'], description: 'consequence of touching it' },
    damage: { type: 'number', default: 1, min: 0, max: 1e6, description: 'mode=damage: health removed per hit' },
    healthKey: { type: 'string', default: 'health', description: 'mode=damage: state key holding health (lose at ≤ 0)' },
    startHealth: { type: 'number', default: 3, min: 1, max: 1e6, description: 'health assumed when the key is unset' },
    cooldown: { type: 'number', default: 1, min: 0.05, max: 60, description: 'seconds between repeated hits while touching' },
    who: { type: 'selector', default: 'player', description: 'who gets hurt' },
    text: { type: 'string', default: 'Game over', description: 'defeat text' },
    margin: { type: 'number', default: 0.25, min: 0, max: 20, description: 'extra reach in meters' },
  },
  create(self, p) {
    const mode = p.str('mode');
    const damage = p.num('damage');
    const healthKey = p.str('healthKey') || 'health';
    const startHealth = p.num('startHealth');
    const cooldown = p.num('cooldown');
    const who = p.str('who');
    const text = p.str('text') || 'Game over';
    const margin = p.num('margin');
    const lastHit = new Map<EntityId, number>();
    return {
      update(env) {
        for (const id of candidates(env, who)) {
          if (id === self.id || !env.touching(self, id, margin)) continue;
          const last = lastHit.get(id);
          if (last !== undefined && env.time - last < cooldown) continue;
          lastHit.set(id, env.time);
          env.host.sound('hit');
          if (mode === 'lose') {
            env.gameOver('lose', text, `${id} touched hazard ${self.id}`);
            return;
          }
          if (mode === 'respawn') {
            const to = env.respawnPoint ?? env.playerSpawn;
            env.teleport(id, to);
            env.log(`${id} touched hazard ${self.id} → respawned`);
            continue;
          }
          if (typeof env.readState(healthKey) !== 'number') env.setState(healthKey, startHealth);
          const change = env.addState(healthKey, -damage);
          env.log(`${id} hurt by ${self.id} → ${change}`);
          const hp = env.readState(healthKey);
          if (typeof hp === 'number' && hp <= 0) {
            env.gameOver('lose', text, `${healthKey} reached ${hp}`);
            return;
          }
        }
      },
    };
  },
};

const launchVel: Vec3 = [0, 0, 0];

export const launcher: BehaviorDef = {
  type: 'launcher',
  description: 'Jump pad / cannon: anything stepping on it is launched with a fixed velocity.',
  requires: 'targets must be dynamic bodies or the player',
  params: {
    direction: { type: 'vec3', default: [0, 1, 0], description: 'launch direction (normalized)' },
    speed: { type: 'number', default: 12, min: 0, max: 500, description: 'launch speed in m/s' },
    who: { type: 'selector', default: '*', description: 'what gets launched ("*" = dynamic bodies and the player)' },
    height: { type: 'number', default: 1.2, min: 0.05, max: 10, description: 'detection height above the pad' },
    cooldown: { type: 'number', default: 0.5, min: 0, max: 60, description: 'seconds before the same thing can be launched again' },
  },
  create(self, p) {
    const dir = normalize3([0, 0, 0], p.vec3('direction'));
    if (dir[0] === 0 && dir[1] === 0 && dir[2] === 0) dir[1] = 1;
    const speed = p.num('speed');
    const who = p.str('who');
    const height = p.num('height');
    const cooldown = p.num('cooldown');
    const occ = new Occupancy();
    const last = new Map<EntityId, number>();
    let envRef: BehaviorEnv | undefined;
    const inside = (id: EntityId): boolean => id !== self.id && envRef !== undefined && envRef.onTopOf(self, id, height);
    const onEnter = (id: EntityId): void => {
      const env = envRef;
      if (!env) return;
      const prev = last.get(id);
      if (prev !== undefined && env.time - prev < cooldown) return;
      last.set(id, env.time);
      launchVel[0] = dir[0] * speed;
      launchVel[1] = dir[1] * speed;
      launchVel[2] = dir[2] * speed;
      env.setVelocity(id, launchVel);
      env.host.sound('whoosh');
      env.log(`${self.id} launched ${id}`);
    };
    return {
      update(env) {
        envRef = env;
        occ.update(candidates(env, who), inside, onEnter);
      },
    };
  },
};

/** All interaction behaviors. */
export const INTERACT_BEHAVIORS: readonly BehaviorDef[] = [
  collectible, door, pressurePlate, spawner, lifetime, explosive, checkpoint, goal, hazard, launcher,
];
