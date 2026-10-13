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
  wantsSetting: true,
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
    const lo: [number, number] = [x, z];
    const hi: [number, number] = [x, z];
    for (let i = 0; i < n; i++) {
      heading = Math.sin(phase + i * wiggle) * 0.9;
      dir = [Math.cos(heading), -Math.sin(heading)];
      const physics: PhysicsOpt =
        i === 0 ? { body: 'dynamic', mass: 0.6, friction: 0.5, initialAngularVelocity: [r2(dir[1] * 2.2), 0, r2(-dir[0] * 2.2)] } : { body: 'dynamic', mass: 0.6, friction: 0.5 };
      last = b.prim('domino', 'box', [0.2, 1.4, 0.7], [r2(x), 0.7, r2(z)], {
        yaw: yawAlongX(dir[0], dir[1]),
        material: { preset: 'plastic', color: RAINBOW[i % RAINBOW.length] as string, roughness: 0.35 },
        physics,
        tags: i === 0 || i === n - 1 ? ['domino', 'focus'] : ['domino'],
      });
      if (i === 0) first = last;
      lo[0] = Math.min(lo[0], x);
      lo[1] = Math.min(lo[1], z);
      hi[0] = Math.max(hi[0], x);
      hi[1] = Math.max(hi[1], z);
      x += dir[0] * spacing;
      z += dir[1] * spacing;
    }
    const bx = r2(x + dir[0] * 0.25);
    const bz = r2(z + dir[1] * 0.25);
    const bell = b.prim('bell', 'cone', [0.9, 1.1, 0.9], [bx, 0.55, bz], { name: 'Bell', material: { preset: 'gold', emissive: '#ffb703', emissiveIntensity: 0.3 }, physics: { body: 'dynamic', mass: 0.5 }, tags: ['bell', 'focus'] });
    // "…knocks over a bell tower": a little belfry stands right behind the bell.
    if (/\btower\b/.test(c.request ?? '')) {
      b.gen('bell-tower', 'tower', { height: 6.5, radius: 1.3, color: '#d8c8aa', roofColor: '#9b2c2c' }, [r2(bx + dir[0] * 2.6), 0, r2(bz + dir[1] * 2.6)], { physics: 'static', name: 'Bell tower', tags: ['focus'] });
    }
    // A low wooden display deck under the run makes it read as a built set-piece.
    b.prim('domino-deck', 'box', [r2(Math.max(hi[0], bx) - Math.min(lo[0], bx) + 4), 0.02, r2(Math.max(hi[1], bz) - Math.min(lo[1], bz) + 4)], [r2((Math.max(hi[0], bx) + Math.min(lo[0], bx)) / 2), 0.01, r2((Math.max(hi[1], bz) + Math.min(lo[1], bz)) / 2)], { name: 'Display deck', material: { preset: 'wood', color: '#8a5d3b', roughness: 0.6 }, castShadow: false });
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
      b.prim('coin', 'cylinder', [1, 0.14, 1], [p[0], 1.1, p[1]], {
        name: 'Coin',
        rot: [90, 0, 0],
        material: { preset: 'gold', emissive: '#ffb703', emissiveIntensity: 1.1 },
        behaviors: [{ type: 'spin', params: { axis: [0, 0, 1], speed: 150 } }, { type: 'bob', params: { amplitude: 0.2, period: 1.6, phase: r2(b.rand(0, 1)) } }, { type: 'collectible', params: { scoreKey: 'score', value: 1 } }],
        tags: ['coin', 'focus'],
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
      tags: ['hazard', 'lava', 'focus'],
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
      tags: ['goal', 'focus'],
    });
    b.light(portal, [0, 1.5, 0.6], '#ffd166', 1.6, 12, [{ type: 'pulseLight', params: { min: 1.2, max: 2.2, period: 1.8 } }]);
    b.rule({ id: 'intro', when: { on: 'start' }, then: [{ do: 'message', text: 'Climb the platforms to the golden portal. Avoid the lava!', duration: 5 }] });
    b.test({ id: 'lift-moves', kind: 'moves', target: lift, distance: 0.8, within: 6 });
    b.test({ id: 'course-solid', kind: 'stable', target: '#platform', seconds: 2, maxDrift: 0.05 });
    b.test({ id: 'goal-in-place', kind: 'staysAbove', target: goalPad, y: 5, within: 3 });
    b.meta('Sky Parkour', 'Spiral platform climb over lava');
  },
};

/** Neon colors of the three bowling lanes (left, player, right). */
const NEON = ['#00f5d4', '#ff006e', '#fee440'];

/** Ten decorative (static, physics-free) pins of a neighbouring lane. */
function decoPins(b: Builder, x: number, headZ: number): void {
  for (let row = 0; row < 4; row++) {
    for (let j = 0; j <= row; j++) {
      b.prim('deco-pin', 'cylinder', [0.26, 0.8, 0.26], [r2(x + (j - row / 2) * 0.5), 0.5, r2(headZ - row * 0.45)], { material: { preset: 'plastic', color: '#f8f9fa', roughness: 0.3 } });
    }
  }
}

const bowling: Theme = {
  id: 'bowling',
  kind: 'activity',
  title: 'Bowling Lane',
  match: /\b(bowl(?:ing)?|pins?|strike|skittles)\b/,
  radius: 13,
  absorbs: ['tower'],
  blurb: 'a neon night bowling alley with ten pins — press SPACE to bowl (it rolls by itself after a few seconds), R to reset',
  env(b) {
    b.env({ sky: 'night', timeOfDay: 22, bloom: 1.1, ambientIntensity: 0.9, sunIntensity: 1.2, fog: null, weather: 'clear', ground: { material: { preset: 'concrete', color: '#2b2d42' }, size: 200 } });
  },
  player(b) {
    b.player({ mode: 'orbit', spawn: [0, 3.5, 13] });
  },
  build(c) {
    const { b } = c;
    const laneZ = c.z - 2;
    const headZ = laneZ - 7;
    // "…knock down a pyramid of crates": the lane ends at a crate pyramid instead of pins.
    const crates = c.with?.has('tower') === true;
    b.prim('hall-floor', 'box', [12, 0.04, 30], [c.x, 0.02, r2(laneZ - 1)], { name: 'Alley floor', material: { preset: 'wood', color: '#3a2a22', roughness: 0.3 }, castShadow: false });
    b.prim('lane', 'box', [2.6, 0.1, 22], [c.x, 0.05, r2(laneZ)], { name: 'Lane', material: { preset: 'wood', color: '#d4a373', roughness: 0.38 }, physics: { body: 'static', friction: 0.3 }, tags: ['focus'] });
    for (const side of [-1, 1]) {
      b.prim('lane-rail', 'box', [0.2, 0.3, 22], [r2(c.x + side * 1.4), 0.15, r2(laneZ)], { material: { preset: 'neon', color: NEON[1] as string, emissive: NEON[1] as string, emissiveIntensity: 1.2 }, physics: 'static' });
      // Neighbouring lanes (set dressing only).
      const nx = r2(c.x + side * 3.6);
      const neon = NEON[side < 0 ? 0 : 2] as string;
      b.prim('side-lane', 'box', [2.6, 0.1, 22], [nx, 0.05, r2(laneZ)], { material: { preset: 'wood', color: '#c99566', roughness: 0.3 } });
      for (const rail of [-1, 1]) b.prim('side-rail', 'box', [0.16, 0.24, 22], [r2(nx + rail * 1.38), 0.12, r2(laneZ)], { material: { preset: 'neon', color: neon, emissive: neon, emissiveIntensity: 1 }, castShadow: false });
      decoPins(b, nx, headZ);
    }
    // Back wall with neon trim and a glowing marquee above every lane.
    const wallZ = r2(headZ - 3);
    b.prim('back-wall', 'box', [12, 3.4, 0.4], [c.x, 1.7, wallZ], { name: 'Back wall', material: { preset: 'concrete', color: '#1d1b33', roughness: 0.6 }, physics: 'static' });
    b.prim('wall-trim', 'box', [12, 0.12, 0.12], [c.x, 3.35, r2(wallZ + 0.24)], { material: { preset: 'neon', color: '#9b5de5', emissive: '#9b5de5', emissiveIntensity: 2 }, castShadow: false });
    NEON.forEach((color, i) => {
      b.prim('marquee', 'box', [2.2, 0.16, 0.08], [r2(c.x + (i - 1) * 3.6), 2.6, r2(wallZ + 0.24)], { material: { preset: 'neon', color, emissive: color, emissiveIntensity: 2.5 }, castShadow: false });
    });
    let head = '';
    let top = '';
    if (crates) {
      const wanted = Math.max(3, Math.min(28, c.count ?? 15));
      let rows = 1;
      while (rows < 6 && ((rows + 1) * (rows + 2)) / 2 <= wanted) rows++;
      const size = rows > 5 ? 0.4 : 0.45;
      for (let level = 0; level < rows; level++) {
        const count = rows - level;
        for (let j = 0; j < count; j++) {
          top = b.prim('crate', 'box', [size, size, size], [r2(c.x + (j - (count - 1) / 2) * size * 1.02), r2(0.1 + size / 2 + level * size), r2(headZ)], {
            material: { preset: 'wood', color: RAINBOW[(level + j) % RAINBOW.length] as string },
            physics: { body: 'dynamic', mass: 1.5, friction: 0.6 },
            tags: level === rows - 1 ? ['crate', 'focus'] : ['crate'],
          });
        }
      }
    } else {
      for (let row = 0; row < 4; row++) {
        for (let j = 0; j <= row; j++) {
          const id = b.prim('pin', 'cylinder', [0.26, 0.8, 0.26], [r2(c.x + (j - row / 2) * 0.5), 0.5, r2(headZ - row * 0.45)], {
            material: { preset: 'plastic', color: '#f8f9fa', roughness: 0.3 },
            physics: { body: 'dynamic', mass: 1.5, friction: 0.4 },
            tags: row === 0 ? ['pin', 'focus'] : ['pin'],
          });
          if (row === 0) head = id;
        }
      }
    }
    const ballSize = crates ? 0.7 : 0.55;
    const ball = b.prim('bowling-ball', 'sphere', [ballSize, ballSize, ballSize], [c.x, r2(0.1 + ballSize / 2), r2(laneZ + 8)], {
      name: crates ? 'Heavy ball' : 'Bowling ball',
      material: { preset: 'plastic', color: '#3a0ca3', roughness: 0.15 },
      physics: { body: 'dynamic', mass: crates ? 14 : 7, friction: 0.3, ccd: true },
      tags: ['ball', 'focus'],
    });
    launchRules(b, ball, [0, 0, -11], 3, 'bowl');
    const key = crates ? 'cratesHit' : 'pinsHit';
    b.state(key, 0);
    b.hud(key, crates ? 'Crate hits' : 'Pin hits');
    b.rule({ id: crates ? 'crate-hit' : 'pin-hit', when: { on: 'collision', a: ball, b: crates ? '#crate' : '#pin', minImpulse: 1 }, then: [{ do: 'add', key, amount: 1 }, { do: 'sound', sound: 'hit' }] });
    if (crates) b.test({ id: 'pyramid-falls', kind: 'moves', target: top, distance: 0.8, within: 8 });
    else b.test({ id: 'head-pin-falls', kind: 'topples', target: head, within: 8 });
    // Ball rack beside the approach, benches behind it.
    b.prim('ball-rack', 'box', [0.6, 0.7, 2], [r2(c.x + 5.6), 0.35, r2(laneZ + 8)], { material: { preset: 'metal', color: '#3c3c4a' }, physics: 'static' });
    ['#ff006e', '#00f5d4', '#fee440'].forEach((color, i) => {
      b.prim('spare-ball', 'sphere', [0.5, 0.5, 0.5], [r2(c.x + 5.6), 0.95, r2(laneZ + 7.4 + i * 0.6)], { material: { preset: 'plastic', color, roughness: 0.15 }, physics: 'static' });
    });
    for (const side of [-1, 1]) {
      b.gen('bench', 'bench', { length: 2.4, color: '#5a189a' }, [r2(c.x + side * 3), 0, r2(laneZ + 13.5)], { yaw: 180, physics: 'static' });
      // Lit lamp posts flank the entrance (the alley is a night scene).
      lamp(b, r2(c.x + side * 6.4), r2(laneZ + 12), '#ffc8dd', 3.6, true);
    }
    // Warm overhead lights along the lane, plus the neon glow at the pins.
    for (const dz of [-8, 0, 8]) b.light(b.empty('lane-light', [c.x, 4.6, r2(laneZ + dz)]), [0, 0, 0], '#ffe1c4', 2, 12);
    b.light(b.empty('pinsetter-glow', [c.x, 2.2, r2(headZ + 1)]), [0, 0, 0], '#ff4fa3', 2.4, 9);
    b.meta(crates ? 'Bowling Smash' : 'Bowling Night', crates ? 'A heavy ball versus a crate pyramid' : 'Ten-pin bowling lane');
  },
};

const tower: Theme = {
  id: 'tower',
  kind: 'activity',
  wantsSetting: true,
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
          tags: level === levels - 1 ? ['block', 'focus'] : ['block'],
        });
      }
    }
    const ball = b.prim('cannonball', 'sphere', [0.9, 0.9, 0.9], [c.x, 0.45, r2(tz + 9)], { name: 'Cannonball', material: { preset: 'metal', color: '#2b2d42', metalness: 0.8, roughness: 0.3 }, physics: { body: 'dynamic', mass: 40, ccd: true }, tags: ['ball', 'focus'] });
    // Lobbed into the middle levels: a flat shot just punches out the bottom-center
    // block and can leave the top standing (verified robust for vy 2.8–3.5).
    launchRules(b, ball, [0, 3, -16], 3, 'fire the cannonball');
    b.test({ id: 'tower-falls', kind: 'moves', target: topId, distance: 1, within: 8 });
    b.meta('Tower Smash', 'Knock down a crate pyramid');
  },
};

/** Activities (order = tie-break priority). */
export const GAME_THEMES: readonly Theme[] = [domino, coins, parkour, bowling, tower];
