/**
 * Racing activity of the offline planner: "a desert canyon racing game", "a kart race", "a rally in the forest".
 * A closed circuit (two straights joined by hairpins) laid as one asphalt ribbon with curbs, a start gantry and three
 * ordered checkpoints, a grandstand with a crowd, tyre walls, the player's kart and two rival karts lapping the racing
 * line, and lap rules to a chequered flag. In a canyon or desert the circuit follows the canyon floor's meander, so the
 * desert setting can carve a real canyon round it (the same layout the Kart Canyon flagship uses).
 */
import { canyonMeander, type Json } from '@aether/core';
import { r2, type Builder, type V3 } from './builder';
import type { ThemeCtx } from './decor';
import type { Theme } from './theme';
import { acrossYaw, gate } from './showcase/kart-canyon';
import { roadRibbon } from './showcase/kit';

/** Edge length of the canyon terrain a desert circuit runs through (its floor is 0.06 of it: about 31 m each side). */
export const RACE_CANYON_SIZE = 520;
/** The straights run between these z values (relative to the circuit centre). */
const Z_END = 62;
/** Hairpin radius: half the distance between the straights. */
const HALF = 14;
const LAPS = 3;
const ROAD_WIDTH = 10;

/** The racing line round (cx, cz): east straight toward −Z, north hairpin, west straight, south hairpin. */
export function raceLoop(cx: number, cz: number, axis: (z: number) => number, samples = 64): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const straight = Math.round(samples * 0.36);
  const turn = Math.round(samples * 0.14);
  const ax = (z: number): number => cx + axis(z - cz);
  for (let i = 0; i < straight; i++) {
    const z = cz + Z_END - (i / straight) * (2 * Z_END);
    pts.push([r2(ax(z) + HALF), r2(z)]);
  }
  for (let i = 0; i < turn; i++) {
    const a = (i / turn) * Math.PI;
    pts.push([r2(ax(cz - Z_END) + Math.cos(a) * HALF), r2(cz - Z_END - Math.sin(a) * HALF)]);
  }
  for (let i = 0; i < straight; i++) {
    const z = cz - Z_END + (i / straight) * (2 * Z_END);
    pts.push([r2(ax(z) - HALF), r2(z)]);
  }
  for (let i = 0; i < turn; i++) {
    const a = Math.PI + (i / turn) * Math.PI;
    pts.push([r2(ax(cz + Z_END) + Math.cos(a) * HALF), r2(cz + Z_END - Math.sin(a) * HALF)]);
  }
  return pts;
}

const STEEL = { preset: 'metal' as const, finish: 'brushed-metal' as const, color: '#59606b' };

/** A covered concrete grandstand with seats and a cheering crowd beside the start line (its front faces −X). */
function grandstand(b: Builder, x: number, z: number): void {
  const TIERS = 5;
  const CONC = { preset: 'concrete' as const, finish: 'concrete' as const, color: '#b4afa5' };
  for (let t = 0; t < TIERS; t++) {
    const h = 0.55 * (t + 1);
    const tx = r2(x - 2.4 + t * 1.6);
    b.prim(t === 0 ? 'grandstand' : 'stand-tier', 'box', [1.6, r2(h), 20], [tx, r2(h / 2), z], { material: CONC, physics: 'static', ...(t === 0 ? { name: 'Grandstand' } : {}) });
    b.prim('stand-seats', 'box', [0.62, 0.1, 19.2], [r2(tx + 0.15), r2(h + 0.05), z], { material: { preset: 'plastic', color: ['#d7263d', '#f5f3ee', '#1b98e0', '#d7263d', '#f5f3ee'][t] as string, roughness: 0.55 }, castShadow: false });
  }
  const topX = x - 2.4 + (TIERS - 1) * 1.6;
  b.prim('stand-back-wall', 'box', [0.4, 6.4, 20], [r2(topX + 1.2), 3.2, z], { material: CONC, physics: 'static' });
  b.prim('stand-roof', 'box', [9, 0.28, 22], [r2(x + 1.8), 6.3, z], { rot: [0, 0, 3], material: { preset: 'metal', finish: 'metal-roof', color: '#e4e2dc' }, castShadow: true });
  for (let k = 0; k < 4; k++) b.prim('stand-pillar', 'box', [0.28, 6.1, 0.28], [r2(x - 2.5), 3.05, r2(z - 9.6 + k * 6.4)], { material: STEEL, physics: 'static' });
  const shirts = ['#d7263d', '#f5f3ee', '#1b98e0', '#ffd23f', '#2f7d4a', '#e8742a'] as const;
  for (let k = 0; k < 16; k++) {
    const tier = k % TIERS;
    b.prim('fan', 'capsule', [0.56, 1.7, 0.56], [r2(x - 2.4 + tier * 1.6 + 0.2), r2(0.55 * (tier + 1) + 0.9), r2(z - 8.5 + ((k * 7) % 18) * 0.95)], {
      yaw: -90,
      character: { wardrobe: 'casual', gender: k % 2 ? 'female' : 'male', age: k % 5 === 4 ? 'old' : k % 3 === 0 ? 'young' : 'adult', mood: 'cheerful', top: b.pick(shirts) },
      tags: ['crowd'],
    });
  }
}

export const race: Theme = {
  id: 'race',
  kind: 'activity',
  wantsSetting: true,
  title: 'Grand Prix',
  titleFor(request) {
    return /\bkart/.test(request) ? 'Kart Race' : /\brally\b/.test(request) ? 'Rally' : 'Grand Prix';
  },
  match: /\b(rac(?:e|es|ing)|racetrack|race ?track|kart(?:s|ing)?|go-?karts?|circuit|grand prix|rally|time trial|laps?)\b/,
  radius: 0,
  blurb: `a ${LAPS}-lap race on an asphalt circuit: three checkpoints in order, two rival karts and a grandstand (W/S throttle and brake, A/D steer)`,
  env(b) {
    b.env({ sky: 'day', timeOfDay: 15.5, bloom: 0.5, fog: { color: '#dfe6ee', density: 0.003 }, ground: { material: { preset: 'grass', color: '#6a9a45' }, size: 400 } });
  },
  prepare(c) {
    const { b } = c;
    const canyon = /\b(canyon|desert|mesa|gorge|badlands|dunes?)\b/.test(c.request ?? '');
    const axis = canyon ? (z: number): number => canyonMeander(z, RACE_CANYON_SIZE) : (): number => 0;
    const loop = raceLoop(c.x, c.z, axis);
    b.track = { loop, extent: Z_END + HALF + 16, axis: (z) => c.x + axis(z - c.z), canyonSize: RACE_CANYON_SIZE };
    // Settings leave the road, its run-off and the infield alone.
    for (const [x, z] of loop) b.reserve(x, z, ROAD_WIDTH / 2 + 3);
    for (let z = c.z - Z_END; z <= c.z + Z_END; z += 4) b.reserve(r2(c.x + axis(z - c.z)), z, HALF - ROAD_WIDTH / 2);
    let x0 = Infinity;
    let x1 = -Infinity;
    for (const [x] of loop) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
    }
    b.keepClearRect(x0 - ROAD_WIDTH / 2 - 1.5, c.z - Z_END - HALF - ROAD_WIDTH / 2 - 1.5, x1 + ROAD_WIDTH / 2 + 1.5, c.z + Z_END + HALF + ROAD_WIDTH / 2 + 1.5);
    // The grandstand beside the start line.
    const start = loop[0] as [number, number];
    b.reserve(r2(start[0] + 13), r2(start[1] - 2), 12);
  },
  build(c) {
    const { b } = c;
    const track = b.track;
    if (!track) return;
    const loop = track.loop;
    const pts: V3[] = loop.map(([x, z]) => [x, 0, z]);
    const n = pts.length;
    roadRibbon(b, { id: b.id('circuit'), name: 'Circuit', loop, width: ROAD_WIDTH, lift: 0.03, lineHalf: 1.7, curbWidth: 0.7, tags: ['road'] });
    // A centre wall of red and white barriers between the straights.
    for (let z = c.z - Z_END + 6; z <= c.z + Z_END - 6; z += 6) {
      const x = track.axis(z);
      b.prim('barrier', 'box', [1, 1, 5.6], [r2(x), 0.5, r2(z)], { yaw: r2((Math.atan2(track.axis(z + 1) - x, 1) * 180) / Math.PI), material: { preset: 'concrete', finish: 'concrete', color: Math.round((z - c.z) / 6) % 2 === 0 ? '#e9e4da' : '#c8323a' }, physics: 'static', tags: ['barrier'] });
    }
    const start = pts[0] as V3;
    for (let k = 0; k < 10; k++) {
      for (let row = 0; row < 2; row++) b.prim('chequer', 'box', [1, 0.06, 0.6], [r2(start[0] - 4.5 + k), 0.05, r2(start[2] - 2 + row * 0.6)], { material: { preset: 'plastic', color: (k + row) % 2 ? '#111111' : '#f5f5f5' }, castShadow: false });
    }
    const finishGate = gate(b, 0, [start[0], 0, r2(start[2] - 2)], 0, '#ffd23f', 'Start / finish');
    const at = (f: number): number => Math.round(n * f) % n;
    const cps = [0.43, 0.68, 0.93].map((f, i) => gate(b, i + 1, pts[at(f)] as V3, acrossYaw(pts, at(f)), ['#00f5d4', '#ff006e', '#9b5de5'][i] as string, `Checkpoint ${i + 1}`));
    grandstand(b, r2(start[0] + 13), r2(start[2] - 2));
    // Tyre walls round the outside of both hairpins.
    for (const [hz, sgn] of [[c.z - Z_END, -1], [c.z + Z_END, 1]] as const) {
      const hx = track.axis(hz);
      for (let k = 0; k <= 11; k++) {
        const a = (k / 11) * Math.PI;
        const rad = HALF + 7.4;
        const px = r2(hx + Math.cos(a + (sgn < 0 ? 0 : Math.PI)) * rad);
        const pz = r2(hz + sgn * Math.sin(a) * rad);
        b.prim('tyre-stack', 'cylinder', [0.8, 0.8, 0.8], [px, 0.4, pz], { material: { preset: 'rubber', color: '#1b1c1f', roughness: 0.85 }, physics: 'static', tags: ['barrier'] });
        b.prim('tyre-band', 'cylinder', [0.82, 0.16, 0.82], [px, 0.43, pz], { material: { preset: 'plastic', color: k % 2 ? '#c8323a' : '#f5f3ee' }, castShadow: false });
      }
    }
    // The player's kart behind the line, and two rivals lapping the racing line (pace ghosts: no collisions).
    const kart = b.asset('kart', 'go-kart', [r2(start[0] - 2.2), 0.05, r2(start[2] + 4)], {
      name: 'Your kart',
      yaw: 0,
      scale: 1.3,
      physics: { body: 'dynamic', mass: 160, friction: 0.02, linearDamping: 0.2, angularDamping: 3 },
      behaviors: [{ type: 'vehicle', params: { maxSpeed: 26, acceleration: 14, brake: 26, drag: 3, turnRate: 115, grip: 7 } }],
      tags: ['kart', 'focus'],
      fallback: { kind: 'procedural', generator: 'car', params: { length: 2.4, color: '#d7263d' } },
    });
    b.player({ mode: 'vehicle', controls: kart, spawn: [r2(start[0] - 2.2), 1, r2(start[2] + 9)] });
    const rivalLine = (offset: number): Json[] => pts.filter((_, i) => i % 3 === 0).map((p) => [r2(p[0] + offset), 0.05, p[2]] as Json);
    for (const [k, id, color, speed] of [[0, 'go-kart-blue', '#1b98e0', 15], [1, 'go-kart-yellow', '#ffd23f', 17]] as const) {
      const line = rivalLine(k === 0 ? 2 : -2);
      b.asset('rival', id, line[k * 6] as V3, {
        name: k === 0 ? 'Rival: Blue Comet' : 'Rival: Yellow Jacket',
        physics: { body: 'kinematic', sensor: true },
        scale: 1.3,
        behaviors: [{ type: 'patrol', params: { waypoints: line, speed, mode: 'loop', face: true } }],
        tags: ['rival'],
        fallback: { kind: 'procedural', generator: 'car', params: { length: 2.6, color } },
      });
    }
    b.state('lap', 0);
    b.state('cp', 0);
    b.hud('lap', `Lap / ${LAPS}`);
    b.rule({ id: 'race-start', when: { on: 'start' }, then: [{ do: 'message', text: `${LAPS} laps through every checkpoint. Go!`, duration: 3 }, { do: 'sound', sound: 'bell' }] });
    cps.forEach((g, i) => b.rule({ id: `cp-${i}`, description: `Checkpoint ${i + 1}`, when: { on: 'enter', zone: g, who: kart }, if: [{ key: 'cp', op: '==', value: i }], then: [{ do: 'set', key: 'cp', value: i + 1 }, { do: 'sound', sound: 'click' }] }));
    b.rule({ id: 'lap', description: 'Crossing the line after all checkpoints completes a lap', when: { on: 'enter', zone: finishGate, who: kart }, if: [{ key: 'cp', op: '==', value: 3 }], then: [{ do: 'set', key: 'cp', value: 0 }, { do: 'add', key: 'lap', amount: 1 }, { do: 'message', text: 'Lap complete!', duration: 2 }, { do: 'sound', sound: 'pickup' }] });
    b.rule({ id: 'last-lap', when: { on: 'state', key: 'lap', op: '==', value: LAPS - 1 }, then: [{ do: 'message', text: 'Final lap!', duration: 2.5 }], once: true });
    b.rule({ id: 'checkered', when: { on: 'state', key: 'lap', op: '>=', value: LAPS }, then: [{ do: 'sound', sound: 'win' }, { do: 'win', text: `Chequered flag! ${LAPS} laps done.` }], once: true });
    b.rule({ id: 'reset-key', when: { on: 'key', key: 'r' }, then: [{ do: 'reset' }] });
    b.test({ id: 'rivals-race', kind: 'moves', target: '#rival', distance: 20, within: 6 });
    b.test({ id: 'kart-on-track', kind: 'staysAbove', target: kart, y: -1, within: 4 });
    b.test({ id: 'barriers-hold', kind: 'stable', target: '#barrier', seconds: 2, maxDrift: 0.01 });
    b.meta('Grand Prix', `A ${LAPS}-lap race through three checkpoints`);
  },
};

/** Whether a theme context's world has a circuit laid out (the desert carves its canyon round it). */
export function hasTrack(c: ThemeCtx): boolean {
  return c.b.track !== null;
}
