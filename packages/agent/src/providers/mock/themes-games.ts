/**
 * Playable activities for the mock planner. Each one adds a working mechanic
 * (physics and/or rules), a HUD where useful, and verification tests that
 * prove the mechanic without player input.
 */
import { r2, type Builder, type PhysicsOpt } from './builder';
import { lamp, yawAlongX, type ThemeCtx } from './decor';
import type { Theme } from './theme';

const RAINBOW = ['#e63946', '#f4a261', '#e9c46a', '#2a9d8f', '#457b9d', '#9b5de5'];

/** Ground-level showroom environment for activities without a setting. */
function studioEnv(b: Builder, floor: string, timeOfDay: number): void {
  b.env({ sky: 'day', timeOfDay, bloom: 0.6, fog: { color: '#dfe6ee', density: 0.006 }, ground: { material: { preset: 'wood', color: floor }, size: 200 } });
}

/** "Press SPACE (or wait) to launch": sets velocity once via key or an idle timer. */
function launchRules(b: Builder, target: string, velocity: [number, number, number], idleSeconds: number, verb: string): void {
  // Own state key per launcher, so two launchers in one world fire independently.
  const key = b.freshStateKey('launched');
  b.state(key, false);
  b.rule({ id: 'launch-hint', when: { on: 'start' }, then: [{ do: 'message', text: `Press SPACE to ${verb}!`, duration: 4 }] });
  const fire = [{ do: 'set' as const, key, value: true }, { do: 'setVelocity' as const, target, vector: velocity }, { do: 'sound' as const, sound: 'whoosh' as const }];
  b.rule({ id: 'launch-key', when: { on: 'key', key: 'space' }, if: [{ key, op: '==', value: false }], then: fire });
  b.rule({ id: 'launch-auto', description: 'Auto-launch if the player waits', when: { on: 'timer', at: idleSeconds }, if: [{ key, op: '==', value: false }], then: fire });
  b.rule({ id: 'reset-key', when: { on: 'key', key: 'r' }, then: [{ do: 'reset' }] });
  b.test({ id: 'launches', kind: 'eventually', condition: { key, op: '==', value: true }, within: idleSeconds + 2 });
}

const domino: Theme = {
  id: 'domino',
  kind: 'activity',
  title: 'Domino Run',
  match: /\b(domino(?:es|s)?|chain reaction|rube goldberg|toppl\w*)\b/,
  radius: 13,
  blurb: 'a curving rainbow domino run that topples by itself and rings a golden bell at the end (press R to reset)',
  env(b) {
    studioEnv(b, '#c8a27a', 16);
  },
  player(b) {
    b.player({ mode: 'orbit', spawn: [0, 7, 14] });
  },
  build(c) {
    const { b } = c;
    const n = Math.max(12, Math.min(60, c.count ?? 32));
    const spacing = 0.75;
    let x = c.x - (n * spacing) / 2.4;
    let z = c.z + 2;
    let heading = 0;
    const wiggle = b.rand(0.18, 0.26);
    const phase = b.rand(0, Math.PI * 2);
    let first = '';
    let last = '';
    let dir: [number, number] = [1, 0];
    for (let i = 0; i < n; i++) {
      heading = Math.sin(phase + i * wiggle) * 0.9;
      dir = [Math.cos(heading), -Math.sin(heading)];
      const physics: PhysicsOpt =
        i === 0 ? { body: 'dynamic', mass: 0.6, friction: 0.5, initialAngularVelocity: [r2(dir[1] * 2.2), 0, r2(-dir[0] * 2.2)] } : { body: 'dynamic', mass: 0.6, friction: 0.5 };
      last = b.prim('domino', 'box', [0.2, 1.4, 0.7], [r2(x), 0.7, r2(z)], {
        yaw: yawAlongX(dir[0], dir[1]),
        material: { preset: 'plastic', color: RAINBOW[i % RAINBOW.length] as string, roughness: 0.35 },
        physics,
        tags: ['domino'],
      });
      if (i === 0) first = last;
      x += dir[0] * spacing;
      z += dir[1] * spacing;
    }
    const bx = r2(x + dir[0] * 0.25);
    const bz = r2(z + dir[1] * 0.25);
    const bell = b.prim('bell', 'cone', [0.9, 1.1, 0.9], [bx, 0.55, bz], { name: 'Bell', material: { preset: 'gold', emissive: '#ffb703', emissiveIntensity: 0.3 }, physics: { body: 'dynamic', mass: 0.5 }, tags: ['bell'] });
    b.state('rang', false);
    b.rule({ id: 'ring-bell', description: 'The last domino rings the bell', when: { on: 'collision', a: '#domino', b: bell }, then: [{ do: 'sound', sound: 'bell' }, { do: 'set', key: 'rang', value: true }, { do: 'message', text: 'DING! Chain complete.', duration: 4 }], once: true });
    b.rule({ id: 'reset-key', when: { on: 'key', key: 'r' }, then: [{ do: 'reset' }] });
    b.test({ id: 'first-falls', kind: 'topples', target: first, within: 4 });
    b.test({ id: 'chain-completes', kind: 'topples', target: last, within: Math.ceil(n * 0.35 + 6) });
    b.test({ id: 'bell-rings', kind: 'eventually', condition: { key: 'rang', op: '==', value: true }, within: Math.ceil(n * 0.35 + 8) });
    b.meta('Domino Run', `${n} dominoes ending in a bell`);
  },
};

const coins: Theme = {
  id: 'coins',
  kind: 'activity',
  wantsSetting: true,
  title: 'Coin Hunt',
  match: /\b(coins?|collect(?:ing|ables?)?|treasure hunt|gems?|pick ?ups?|scavenger)\b/,
  radius: 0,
  blurb: 'a timed coin hunt: grab every spinning coin before the clock runs out (score and timer on the HUD)',
  env(b) {
    b.env({ sky: 'day', timeOfDay: 10, bloom: 0.8, ground: { material: { preset: 'grass', color: '#62a043' }, size: 300 } });
  },
  player(b) {
    b.player({ mode: 'thirdPerson', spawn: [0, 1, 12], moveSpeed: 7, jumpSpeed: 6 });
  },
  build(c) {
    const { b } = c;
    const n = Math.max(3, Math.min(40, c.count ?? 8));
    let placed = 0;
    for (let i = 0; i < n * 6 && placed < n; i++) {
      const p = b.spot(c.x, c.z, 4, 10 + n * 1.5, 0.8);
      if (!p) continue;
      b.prim('coin', 'cylinder', [0.8, 0.12, 0.8], [p[0], 1, p[1]], {
        name: 'Coin',
        rot: [90, 0, 0],
        material: { preset: 'gold', emissive: '#ffb703', emissiveIntensity: 0.5 },
        behaviors: [{ type: 'spin', params: { axis: [0, 0, 1], speed: 150 } }, { type: 'bob', params: { amplitude: 0.2, period: 1.6, phase: r2(b.rand(0, 1)) } }, { type: 'collectible', params: { scoreKey: 'score', value: 1 } }],
        tags: ['coin'],
      });
      placed++;
    }
    const time = c.seconds ?? Math.max(30, placed * 8);
    b.state('score', 0);
    b.state('timeLeft', time);
    b.hud('score', `Coins / ${placed}`);
    b.hud('timeLeft', 'Time left');
    b.rule({ id: 'intro', when: { on: 'start' }, then: [{ do: 'message', text: `Collect all ${placed} coins in ${time} seconds!`, duration: 4 }] });
    b.rule({ id: 'countdown', when: { on: 'tick', every: 1 }, if: [{ key: 'timeLeft', op: '>', value: 0 }], then: [{ do: 'add', key: 'timeLeft', amount: -1 }] });
    b.rule({ id: 'all-coins', when: { on: 'state', key: 'score', op: '>=', value: placed }, then: [{ do: 'sound', sound: 'win' }, { do: 'win', text: 'All coins collected!' }], once: true });
    b.rule({ id: 'times-up', when: { on: 'state', key: 'timeLeft', op: '<=', value: 0 }, if: [{ key: 'score', op: '<', value: placed }], then: [{ do: 'sound', sound: 'lose' }, { do: 'lose', text: "Time's up!" }], once: true });
    b.test({ id: 'timer-runs', kind: 'eventually', condition: { key: 'timeLeft', op: '<=', value: time - 2 }, within: 5 });
    b.test({ id: 'coins-float', kind: 'staysAbove', target: '#coin', y: 0.4, within: 5 });
    b.meta('Coin Hunt', `Collect ${placed} coins before time runs out`);
  },
};

const parkour: Theme = {
  id: 'parkour',
  kind: 'activity',
  title: 'Sky Parkour',
  match: /\b(parkour|obstacle course|obstacles?|platform(?:er|s|ing)?|jump(?:ing)? (?:course|challenge)|climb(?:ing)?|lava floor|the floor is lava|course)\b/,
  radius: 17,
  blurb: 'a spiral parkour climb over a lava pit with a checkpoint, a moving lift and a glowing goal portal at the top',
  env(b) {
    b.env({ sky: 'sunset', timeOfDay: 17.5, bloom: 1.1, fog: { color: '#f2b38a', density: 0.008 }, ground: { material: { preset: 'stone', color: '#6f6a64' }, size: 300 } });
  },
  player(b) {
    b.player({ mode: 'thirdPerson', spawn: [0, 1, 19], moveSpeed: 6.5, jumpSpeed: 6.5 });
  },
  build(c) {
    const { b } = c;
    b.prim('lava-pit', 'cylinder', [30, 0.1, 30], [c.x, 0.05, c.z], {
      name: 'Lava pit',
      material: { preset: 'lava', emissive: '#ff4d00', emissiveIntensity: 2.5 },
      physics: { body: 'static', sensor: true },
      behaviors: [{ type: 'hazard', params: { mode: 'respawn', text: 'Burned! Back to the checkpoint.' } }],
      tags: ['hazard', 'lava'],
    });
    const steps = 14;
    let lift = '';
    let top: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < steps; i++) {
      // The last step leaves extra room for the larger goal platform.
      const a = Math.PI / 2 + i * 0.3 + (i === steps - 1 ? 0.3 : 0);
      const radius = 12 - i * 0.25;
      const px = r2(c.x + Math.cos(a) * radius);
      const pz = r2(c.z + Math.sin(a) * radius);
      const py = r2(0.8 + i * 0.6);
      top = [px, py, pz];
      if (i === steps - 1) break;
      const isLift = i === 9;
      const id = b.prim(isLift ? 'lift' : 'platform', 'box', [2.6, 0.5, 2.6], [px, r2(py - 0.25), pz], {
        material: isLift ? { preset: 'neon', color: '#00b4d8', emissive: '#00b4d8', emissiveIntensity: 0.8 } : { preset: 'stone', color: i % 2 === 0 ? '#c9c3b5' : '#a39e93' },
        physics: isLift ? 'kinematic' : 'static',
        ...(isLift ? { behaviors: [{ type: 'patrol', params: { waypoints: [[0, 0, 0], [0, 1.4, 0]], relative: true, speed: 0.9, mode: 'pingpong', wait: 0.6 } }] } : {}),
        tags: [isLift ? 'lift' : 'platform'],
      });
      if (isLift) lift = id;
      if (i === 6) {
        b.prim('checkpoint', 'cylinder', [1.6, 0.08, 1.6], [px, r2(py + 0.04), pz], {
          material: { preset: 'neon', color: '#80ff72', emissive: '#80ff72', emissiveIntensity: 1.5 },
          behaviors: [{ type: 'checkpoint', params: { message: 'Checkpoint!' } }],
          tags: ['checkpoint'],
        });
      }
    }
    const goalPad = b.prim('goal-platform', 'box', [3.6, 0.6, 3.6], [top[0], r2(top[1] - 0.3), top[2]], { material: { preset: 'gold', color: '#e9c46a' }, physics: 'static', tags: ['platform'] });
    const portal = b.gen('goal-portal', 'portal', { size: 2.6, glowColor: '#ffd166' }, [top[0], top[1], r2(top[2] - 1.2)], {
      physics: { body: 'static', sensor: true },
      behaviors: [{ type: 'goal', params: { text: 'You reached the top!' } }],
      name: 'Goal portal',
    });
    b.light(portal, [0, 1.5, 0.6], '#ffd166', 3, 14, [{ type: 'pulseLight', params: { min: 2, max: 4, period: 1.8 } }]);
    b.rule({ id: 'intro', when: { on: 'start' }, then: [{ do: 'message', text: 'Climb the platforms to the golden portal. Avoid the lava!', duration: 5 }] });
    b.test({ id: 'lift-moves', kind: 'moves', target: lift, distance: 0.8, within: 6 });
    b.test({ id: 'course-solid', kind: 'stable', target: '#platform', seconds: 2, maxDrift: 0.05 });
    b.test({ id: 'goal-in-place', kind: 'staysAbove', target: goalPad, y: 5, within: 3 });
    b.meta('Sky Parkour', 'Spiral platform climb over lava');
  },
};

const bowling: Theme = {
  id: 'bowling',
  kind: 'activity',
  title: 'Bowling Lane',
  match: /\b(bowl(?:ing)?|pins?|strike|skittles)\b/,
  radius: 13,
  blurb: 'a polished bowling lane with ten pins — press SPACE to bowl (it rolls by itself after a few seconds), R to reset',
  env(b) {
    b.env({ sky: 'sunset', timeOfDay: 17.6, bloom: 1.2, ambientIntensity: 0.8, fog: null, ground: { material: { preset: 'concrete', color: '#3d405b' }, size: 200 } });
  },
  player(b) {
    b.player({ mode: 'orbit', spawn: [0, 3.5, 13] });
  },
  build(c) {
    const { b } = c;
    const laneZ = c.z - 2;
    b.prim('lane', 'box', [2.6, 0.1, 22], [c.x, 0.05, r2(laneZ)], { name: 'Lane', material: { preset: 'wood', color: '#d4a373', roughness: 0.25 }, physics: { body: 'static', friction: 0.3 } });
    for (const side of [-1, 1]) {
      b.prim('lane-rail', 'box', [0.2, 0.3, 22], [r2(c.x + side * 1.4), 0.15, r2(laneZ)], { material: { preset: 'neon', color: '#ff006e', emissive: '#ff006e', emissiveIntensity: 1.2 }, physics: 'static' });
    }
    const headZ = laneZ - 7;
    let head = '';
    for (let row = 0; row < 4; row++) {
      for (let j = 0; j <= row; j++) {
        const id = b.prim('pin', 'cylinder', [0.26, 0.8, 0.26], [r2(c.x + (j - row / 2) * 0.5), 0.5, r2(headZ - row * 0.45)], {
          material: { preset: 'plastic', color: '#f8f9fa', roughness: 0.3 },
          physics: { body: 'dynamic', mass: 1.5, friction: 0.4 },
          tags: ['pin'],
        });
        if (row === 0) head = id;
      }
    }
    const ball = b.prim('bowling-ball', 'sphere', [0.55, 0.55, 0.55], [c.x, 0.375, r2(laneZ + 8)], { name: 'Bowling ball', material: { preset: 'plastic', color: '#3a0ca3', roughness: 0.15 }, physics: { body: 'dynamic', mass: 7, friction: 0.3, ccd: true }, tags: ['ball'] });
    launchRules(b, ball, [0, 0, -11], 3, 'bowl');
    b.state('pinsHit', 0);
    b.hud('pinsHit', 'Pin hits');
    b.rule({ id: 'pin-hit', when: { on: 'collision', a: ball, b: '#pin', minImpulse: 1 }, then: [{ do: 'add', key: 'pinsHit', amount: 1 }, { do: 'sound', sound: 'hit' }] });
    b.test({ id: 'head-pin-falls', kind: 'topples', target: head, within: 8 });
    // Lamps along the whole lane so the night scene stays readable.
    for (const side of [-1, 1]) for (const dz of [-6, 4]) lamp(b, r2(c.x + side * 3), r2(laneZ + dz), '#ffc8dd', 4);
    b.meta('Bowling Night', 'Ten-pin bowling lane');
  },
};

const tower: Theme = {
  id: 'tower',
  kind: 'activity',
  title: 'Tower Smash',
  match: /\b(stack(?:ing|ed)?|jenga|block tower|tower of (?:blocks|crates|boxes)|knock(?:ing)? (?:down|over)|smash|wrecking|cannon(?:ball)?|demolish|crates? tower)\b/,
  radius: 10,
  blurb: 'a pyramid of crates and a heavy cannonball — press SPACE to fire (it fires itself after a few seconds), R to rebuild',
  env(b) {
    studioEnv(b, '#b08968', 15);
  },
  player(b) {
    b.player({ mode: 'orbit', spawn: [6, 5, 12] });
  },
  build(c) {
    const { b } = c;
    const tz = c.z - 3;
    const size = 1;
    const levels = 5;
    let topId = '';
    for (let level = 0; level < levels; level++) {
      const count = levels - level;
      for (let j = 0; j < count; j++) {
        topId = b.prim('block', 'box', [size, size, size], [r2(c.x + (j - (count - 1) / 2) * size * 1.01), r2(size / 2 + level * size), r2(tz)], {
          material: { preset: 'wood', color: RAINBOW[(level + j) % RAINBOW.length] as string },
          physics: { body: 'dynamic', mass: 2, friction: 0.7 },
          tags: ['block'],
        });
      }
    }
    const ball = b.prim('cannonball', 'sphere', [0.9, 0.9, 0.9], [c.x, 0.45, r2(tz + 9)], { name: 'Cannonball', material: { preset: 'metal', color: '#2b2d42', metalness: 0.8, roughness: 0.3 }, physics: { body: 'dynamic', mass: 40, ccd: true }, tags: ['ball'] });
    // Lobbed into the middle levels: a flat shot just punches out the bottom-center
    // block and can leave the top standing (verified robust for vy 2.8–3.5).
    launchRules(b, ball, [0, 3, -16], 3, 'fire the cannonball');
    b.test({ id: 'tower-falls', kind: 'moves', target: topId, distance: 1, within: 8 });
    b.meta('Tower Smash', 'Knock down a crate pyramid');
  },
};

/** Activities (order = tie-break priority). */
export const GAME_THEMES: readonly Theme[] = [domino, coins, parkour, bowling, tower];
