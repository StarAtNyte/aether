/**
 * Kart Canyon — an arcade kart race on a circuit laid along the floor of a
 * sandstone canyon: three laps through four checkpoints (in order), boost
 * pads on the straights, two rival karts lapping the circuit, a grandstand
 * at the start line and a clock that shows your lap times.
 *
 * Built from: the terrain generator's canyon (floor along `canyonMeander`),
 * the vehicle behaviour on a library go-kart, wind-zone boost pads, patrol
 * rivals lapping the racing line as pace ghosts (no collisions), enter-zone checkpoint rules and a goal state.
 */
import { canyonMeander, type Json } from '@aether/core';
import { r2, type Builder, type V3 } from '../builder';
import type { MockPlan } from '../planner';
import { finish, flagshipBuilder, onCircle, roadRibbon } from './kit';

const SIZE = 700;
/** Straights run between these z values; the hairpins are half circles beyond them. */
const Z_END = 120;
/** Half the distance between the two straights (the hairpin radius). */
const HALF = 15;
const LAPS = 3;

function mx(z: number): number {
  return r2(canyonMeander(z, SIZE));
}

/** The racing line: a closed loop (counter-clockwise from the start line, driving toward −Z on the east straight). */
export function kartTrack(samples = 72): V3[] {
  const pts: V3[] = [];
  const straight = Math.round(samples * 0.36);
  const turn = Math.round(samples * 0.14);
  // East straight, south → north (toward −Z).
  for (let i = 0; i < straight; i++) {
    const z = Z_END - (i / straight) * (2 * Z_END);
    pts.push([r2(mx(z) + HALF), 0, r2(z)]);
  }
  // North hairpin (around the centre at −Z_END), east → west.
  for (let i = 0; i < turn; i++) {
    const a = (i / turn) * Math.PI;
    pts.push([r2(mx(-Z_END) + Math.cos(a) * HALF), 0, r2(-Z_END - Math.sin(a) * HALF)]);
  }
  // West straight, north → south.
  for (let i = 0; i < straight; i++) {
    const z = -Z_END + (i / straight) * (2 * Z_END);
    pts.push([r2(mx(z) - HALF), 0, r2(z)]);
  }
  // South hairpin, west → east.
  for (let i = 0; i < turn; i++) {
    const a = Math.PI + (i / turn) * Math.PI;
    pts.push([r2(mx(Z_END) + Math.cos(a) * HALF), 0, r2(Z_END - Math.sin(a) * HALF)]);
  }
  return pts;
}

/** Yaw (degrees) that turns a gate's width (its local X) across the track at index `i`. */
export function acrossYaw(track: readonly V3[], i: number): number {
  const a = track[(i - 1 + track.length) % track.length] as V3;
  const c = track[(i + 1) % track.length] as V3;
  return r2((Math.atan2(-(c[0] - a[0]), -(c[2] - a[2])) * 180) / Math.PI);
}

const STEEL = { preset: 'metal' as const, finish: 'brushed-metal' as const, color: '#59606b' };
const WHITE_PAINT = { preset: 'plastic' as const, color: '#eeece6', roughness: 0.45 };

/** A gantry across the track: steel pylons on concrete feet, a painted box beam and (for the start) a chequered banner and start lights. */
function gantry(b: Builder, p: V3, heading: number, o: { width: number; height: number; color: string; start?: boolean }): void {
  const root = b.empty('gantry', [p[0], 0, p[2]], { yaw: heading, name: o.start ? 'Start gantry' : 'Checkpoint gantry' });
  const half = o.width / 2;
  for (const side of [-1, 1]) {
    b.prim('gantry-foot', 'box', [1.8, 0.5, 1.8], [side * half, 0.25, 0], { parent: root, material: { preset: 'concrete', finish: 'concrete', color: '#b9b4aa' } });
    b.prim('gantry-pylon', 'box', [o.start ? 0.9 : 0.5, o.height, o.start ? 0.9 : 0.5], [side * half, r2(o.height / 2 + 0.5), 0], { parent: root, material: STEEL, tags: ['gate-post'] });
  }
  const beamY = o.height + 0.6;
  b.prim('gantry-beam', 'box', [r2(o.width + 1.2), o.start ? 1.3 : 0.7, o.start ? 1.1 : 0.6], [0, beamY, 0], { parent: root, material: WHITE_PAINT, tags: ['gate-banner'] });
  b.prim('gantry-stripe', 'box', [r2(o.width + 1.25), 0.2, o.start ? 1.16 : 0.66], [0, r2(beamY + (o.start ? 0.5 : 0.25)), 0], { parent: root, material: { preset: 'plastic', color: o.color, roughness: 0.4 }, castShadow: false });
  if (o.start) {
    // A chequered banner under the beam, and five start lights (red) on its face.
    const cols = 20;
    const cw = o.width / cols;
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < 2; r++) b.prim('chequer-banner', 'box', [r2(cw), 0.5, 0.06], [r2(-half + cw / 2 + c * cw), r2(beamY - 1.0 - r * 0.5), 0], { parent: root, material: { preset: 'fabric', color: (c + r) % 2 ? '#15161a' : '#f2f0ea' }, castShadow: false });
    }
    for (let k = 0; k < 5; k++) b.prim('start-light', 'cylinder', [0.34, 0.12, 0.34], [r2(-2 + k), r2(beamY + 0.05), 0.6], { parent: root, rot: [90, 0, 0], material: { preset: 'emissive', color: '#ff2b2b', emissive: '#ff2b2b', emissiveIntensity: 2.2 }, castShadow: false });
  } else {
    // A pennant on each side in the checkpoint colour.
    for (const side of [-1, 1]) b.prim('pennant', 'box', [2.4, 0.9, 0.05], [r2(side * (half - 1.5)), r2(beamY - 0.85), 0], { parent: root, material: { preset: 'fabric', color: o.color, roughness: 0.7 }, castShadow: false });
  }
}

/** A checkpoint gate across the track at `p` (invisible sensor + a painted gantry). */
export function gate(b: Builder, n: number, p: V3, heading: number, color: string, label: string): string {
  const id = b.prim(`checkpoint-${n}`, 'box', [14, 5, 2], [p[0], 2.5, p[2]], { name: label, yaw: heading, visible: false, physics: { body: 'static', sensor: true }, tags: ['checkpoint-gate'] });
  gantry(b, p, heading, n === 0 ? { width: 16, height: 6.4, color, start: true } : { width: 14.5, height: 5, color });
  return id;
}

/** Plan Kart Canyon. */
export function kartCanyon(): MockPlan {
  const b = flagshipBuilder(0x4a27);
  b.env({
    sky: 'day',
    timeOfDay: 16.4,
    sunIntensity: 3.1,
    ambientIntensity: 0.5,
    fog: { color: '#f0c9a0', density: 0.0018, visibility: 900 },
    weather: 'dust',
    bloom: 0.55,
    exposure: 1.05,
    ground: null,
  });
  const canyon = b.gen('canyon', 'terrain', { size: SIZE, height: 70, resolution: 220, roughness: 0.55, color: '#9a8a4f', variant: 3 }, [0, 0, 0], { physics: { body: 'static', friction: 0.9 }, name: 'Canyon', tags: ['terrain'] });

  // --- The circuit -------------------------------------------------------------------
  const track = kartTrack();
  const n = track.length;
  // One continuous asphalt ribbon with the racing line blended into it, and red/white curbs in whole stripes (a row of boxes left
  // wedges of sand open at every bend).
  roadRibbon(b, { id: 'road', name: 'Circuit', loop: track.map((p) => [p[0], p[2]] as const), width: 10, lift: 0.03, lineHalf: 1.7, curbWidth: 0.7, tags: ['road'] });
  // A centre wall of stacked tyres and barriers between the straights.
  for (let z = -Z_END + 6; z <= Z_END - 6; z += 6) {
    b.prim('barrier', 'box', [1, 1, 5.6], [mx(z), 0.5, r2(z)], { yaw: r2((Math.atan2(canyonMeander(z + 1, SIZE) - canyonMeander(z, SIZE), 1) * 180) / Math.PI), material: { preset: 'concrete', color: (z / 6) % 2 === 0 ? '#e9e4da' : '#d7263d' }, physics: 'static', tags: ['barrier'] });
  }
  // Start / finish line with a chequered strip and a grandstand.
  const start = track[0] as V3;
  const startHeading = 90;
  for (let k = 0; k < 10; k++) {
    for (let row = 0; row < 2; row++) {
      b.prim('chequer', 'box', [1, 0.07, 0.6], [r2(start[0] - 4.5 + k), 0.045, r2(start[2] - 2 + row * 0.6)], { material: { preset: 'plastic', color: (k + row) % 2 ? '#111111' : '#f5f5f5' }, castShadow: false });
    }
  }
  const finishGate = gate(b, 0, [start[0], 0, r2(start[2] - 2)], startHeading - 90, '#ffd23f', 'Start / finish');
  const at = (f: number): number => Math.round(n * f) % n;
  const cp1 = gate(b, 1, track[at(0.43)] as V3, acrossYaw(track, at(0.43)), '#00f5d4', 'Checkpoint 1');
  const cp2 = gate(b, 2, track[at(0.68)] as V3, acrossYaw(track, at(0.68)), '#ff006e', 'Checkpoint 2');
  const cp3 = gate(b, 3, track[at(0.93)] as V3, acrossYaw(track, at(0.93)), '#9b5de5', 'Checkpoint 3');
  const standX = r2(start[0] + 14);
  const standZ = r2(start[2] - 2);
  const TIERS = 6;
  const CONC = { preset: 'concrete' as const, finish: 'concrete' as const, color: '#b4afa5' };
  // Stepped concrete terraces (each tier a solid block up to its tread), a coloured seat strip on every tread.
  for (let t = 0; t < TIERS; t++) {
    const h = 0.55 * (t + 1);
    const x = r2(standX - 3 + t * 1.6);
    b.prim(t === 0 ? 'grandstand' : 'stand-tier', 'box', [1.6, r2(h), 24], [x, r2(h / 2), standZ], { material: CONC, physics: 'static', ...(t === 0 ? { name: 'Grandstand' } : {}) });
    b.prim('stand-seats', 'box', [0.62, 0.1, 23.2], [r2(x + 0.15), r2(h + 0.05), standZ], { material: { preset: 'plastic', color: ['#d7263d', '#f5f3ee', '#1b98e0', '#d7263d', '#f5f3ee', '#1b98e0'][t] as string, roughness: 0.55 }, castShadow: false });
  }
  const topX = standX - 3 + (TIERS - 1) * 1.6;
  b.prim('stand-back-wall', 'box', [0.4, 7.4, 24], [r2(topX + 1.2), 3.7, standZ], { material: CONC, physics: 'static' });
  b.prim('stand-roof', 'box', [10.2, 0.28, 26], [r2(standX + 1.8), 7.3, standZ], { rot: [0, 0, 3], material: { preset: 'metal', finish: 'metal-roof', color: '#e4e2dc' }, castShadow: true });
  b.prim('stand-roof-edge', 'box', [0.2, 0.5, 26.1], [r2(standX - 3.2), 7.2, standZ], { material: { preset: 'plastic', color: '#d7263d' }, castShadow: false });
  for (let k = 0; k < 5; k++) b.prim('stand-pillar', 'box', [0.28, 7.1, 0.28], [r2(standX - 3.1), 3.55, r2(standZ - 11.6 + k * 5.8)], { material: STEEL, physics: 'static' });
  // Railing and advertising hoardings along the front, so the track side reads as a venue.
  b.prim('stand-rail', 'box', [0.06, 0.08, 24], [r2(standX - 3.7), 1.15, standZ], { material: STEEL, castShadow: false });
  for (let k = 0; k < 9; k++) b.prim('hoarding', 'box', [0.12, 1.0, 2.5], [r2(standX - 5.2), 0.5, r2(standZ - 10.5 + k * 2.6)], { material: { preset: 'plastic', color: ['#d7263d', '#f5f3ee', '#1b98e0', '#ffd23f', '#2b2f3a'][k % 5] as string, roughness: 0.4 }, physics: 'static' });
  // Crowd: animated people standing on the terraces.
  const shirts = ['#d7263d', '#f5f3ee', '#1b98e0', '#ffd23f', '#2f7d4a', '#e8742a'] as const;
  for (let k = 0; k < 22; k++) {
    const tier = k % TIERS;
    // Real people from the cast (the capsule is only the collider; the standing figure replaces it).
    b.prim('fan', 'capsule', [0.56, 1.7, 0.56], [r2(standX - 3 + tier * 1.6 + 0.2), r2(0.55 * (tier + 1) + 0.9), r2(standZ - 10.5 + ((k * 7) % 22) * 0.95)], {
      yaw: -90,
      castShadow: true,
      character: { wardrobe: 'casual', gender: k % 2 ? 'female' : 'male', age: k % 5 === 4 ? 'old' : k % 3 === 0 ? 'young' : 'adult', mood: 'cheerful', top: b.pick(shirts), scale: r2(b.rand(0.94, 1.06)) },
      tags: ['crowd'],
    });
  }

  // Tyre walls on the outside of both hairpins, and a marshal post at each.
  for (const [cz, sgn] of [[-Z_END, -1], [Z_END, 1]] as const) {
    const cx = mx(cz);
    const count = 13;
    for (let k = 0; k <= count; k++) {
      const a = (k / count) * Math.PI;
      const rad = HALF + 7.2;
      const px = r2(cx + Math.cos(a + (sgn < 0 ? 0 : Math.PI)) * rad);
      const pz = r2(cz + sgn * Math.sin(a) * rad);
      b.prim('tyre-stack', 'cylinder', [0.8, 0.8, 0.8], [px, 0.4, pz], { material: { preset: 'rubber', color: '#1b1c1f', roughness: 0.85 }, physics: 'static', tags: ['barrier'] });
      b.prim('tyre-band', 'cylinder', [0.82, 0.16, 0.82], [px, 0.43, pz], { material: { preset: 'plastic', color: k % 2 ? '#d7263d' : '#f5f3ee' }, castShadow: false });
    }
  }

  // --- Boost pads on both straights ------------------------------------------------------
  for (const [i, dir] of [[Math.round(n * 0.12), -1], [Math.round(n * 0.62), 1]] as const) {
    const p = track[i] as V3;
    b.prim('boost-pad', 'box', [6.4, 0.07, 7.4], [p[0], 0.07, p[2]], { name: 'Boost pad', material: { preset: 'plastic', color: '#10161c', roughness: 0.5 }, castShadow: false });
    // Three glowing chevrons pointing along the direction of the boost, lighting up one after the other.
    for (let c = 0; c < 3; c++) {
      const z0 = p[2] + dir * (c * 1.9 - 1.6);
      for (const side of [-1, 1]) {
        const yaw = r2((Math.atan2(side * 0.57, -dir * 0.82) * 180) / Math.PI);
        b.prim('boost-chevron', 'box', [0.5, 0.05, 2.5], [r2(p[0] + side * 1.05), 0.12, r2(z0 - dir * 0.6)], {
          yaw,
          material: { preset: 'neon', color: '#00f5d4', emissive: '#00f5d4', emissiveIntensity: 1.4 },
          castShadow: false,
          behaviors: [{ type: 'pulseLight', params: { min: 0.4, max: 2.8, period: 0.9, phase: r2(c / 3), property: 'material.emissiveIntensity' } }],
        });
      }
    }
    b.prim('boost-zone', 'box', [6, 2, 7], [p[0], 1, p[2]], { visible: false, physics: { body: 'static', sensor: true }, behaviors: [{ type: 'windZone', params: { direction: [0, 0, dir], strength: 26, who: '*', player: true } }], tags: ['boost'] });
  }

  // --- Karts ---------------------------------------------------------------------------------
  const kart = b.asset('kart', 'go-kart', [r2(start[0] - 2.2), 0.05, r2(start[2] + 4)], {
    name: 'Your kart',
    yaw: 0,
    scale: 1.3,
    // Near-frictionless contact: the vehicle behaviour removes sideways slip itself, and a grippy tall box would roll over in hairpins.
    physics: { body: 'dynamic', mass: 160, friction: 0.02, linearDamping: 0.2, angularDamping: 3 },
    behaviors: [{ type: 'vehicle', params: { maxSpeed: 26, acceleration: 14, brake: 26, drag: 3, turnRate: 115, grip: 7 } }],
    tags: ['kart', 'focus'],
    fallback: { kind: 'procedural', generator: 'car', params: { length: 2.4, color: '#d7263d' } },
  });
  b.player({ mode: 'vehicle', controls: kart, spawn: [r2(start[0] - 2.2), 1, r2(start[2] + 9)] });
  const rivalLine = (offset: number): Json[] => track.filter((_, i) => i % 3 === 0).map((p) => [r2(p[0] + offset), 0.05, p[2]] as Json);
  for (const [k, color, speed] of [[0, '#1b98e0', 15.5], [1, '#ffd23f', 17.5]] as const) {
    const line = rivalLine(k === 0 ? 2 : -2);
    b.asset('rival', k === 0 ? 'go-kart-blue' : 'go-kart-yellow', line[k * 6] as V3, {
      name: k === 0 ? 'Rival: Blue Comet' : 'Rival: Yellow Jacket',
      // Rivals are pace ghosts: sensor bodies lapping the racing line without colliding with you.
      physics: { body: 'kinematic', sensor: true },
      scale: 1.3,
      behaviors: [{ type: 'patrol', params: { waypoints: line, speed, mode: 'loop', face: true } }],
      tags: ['rival'],
      fallback: { kind: 'procedural', generator: 'car', params: { length: 2.6, color } },
    });
  }

  // --- Canyon dressing ----------------------------------------------------------------------
  for (let i = 0; i < 60; i++) {
    const z = r2(b.rand(-200, 200));
    const side = b.chance(0.5) ? -1 : 1;
    const x = r2(mx(z) + side * b.rand(26, 38));
    if (b.chance(0.55)) b.gen('saguaro', 'cactus', { height: r2(b.rand(3.5, 7.5)), arms: b.int(0, 4) }, [x, 0, z], { yaw: r2(b.rand(0, 360)), physics: 'static', castShadow: true });
    else b.gen('boulder', 'rock', { size: r2(b.rand(2, 5)), color: '#b0603a', variant: b.int(0, 2) }, [x, 0, z], { yaw: r2(b.rand(0, 360)), physics: 'static' });
  }
  // Scrub and dry grass in strips that follow the canyon's meander (a fixed strip crossed the road wherever the canyon bends).
  const CHUNK = 20;
  for (let zc = -210; zc <= 210; zc += CHUNK) {
    for (const side of [-1, 1]) {
      const cx = r2(mx(zc) + side * (HALF + 17));
      b.scatter('desert-brush', 'bush', { size: 0.9, color: '#8e9466' }, 34, [15, CHUNK], [r2(cx - side), 0, zc], { minSpacing: 1.8, scaleRange: [0.5, 1.2], onSurface: canyon });
      b.scatter('dry-grass', 'grass-tuft', { size: 0.6, color: '#bfa968', blades: 14 }, 60, [18, CHUNK], [r2(mx(zc) + side * (HALF + 17)), 0, zc], { minSpacing: 1, scaleRange: [0.7, 1.4], onSurface: canyon });
    }
  }
  for (const z of [-180, 175]) b.gen('rock-arch', 'arch', { width: 34, height: 26, thickness: 7, color: '#c07a4a', variant: 0 }, [mx(z), 0, z], { yaw: 0, physics: 'static', name: 'Sandstone arch', tags: ['landmark'] });
  for (let i = 0; i < 8; i++) {
    const [x, , z] = onCircle(mx(0), 0, b.rand(60, 120), b.rand(0, Math.PI * 2));
    b.gen('balloon', 'hot-air-balloon', { color: b.pick(['#d7263d', '#1b98e0', '#ffd23f', '#3ddc97']), stripeColor: '#f5f3ee', height: 9 }, [x, r2(b.rand(55, 90)), z], { castShadow: false, tags: ['sky'], behaviors: [{ type: 'bob', params: { amplitude: 2, period: r2(b.rand(10, 16)), phase: r2(b.rand(0, 1)) } }] });
  }

  // --- Race rules ----------------------------------------------------------------------------
  b.state('lap', 0);
  b.state('cp', 0);
  b.hud('lap', `Lap / ${LAPS}`);
  b.rule({ id: 'countdown', when: { on: 'start' }, then: [{ do: 'message', text: `Three laps through every checkpoint. Go!`, duration: 3 }, { do: 'sound', sound: 'bell' }] });
  const step = (gateId: string, from: number, to: number, label: string): void => {
    b.rule({ id: `cp-${from}`, description: label, when: { on: 'enter', zone: gateId, who: kart }, if: [{ key: 'cp', op: '==', value: from }], then: [{ do: 'set', key: 'cp', value: to }, { do: 'sound', sound: 'click' }] });
  };
  step(cp1, 0, 1, 'Checkpoint 1 (north hairpin)');
  step(cp2, 1, 2, 'Checkpoint 2 (back straight)');
  step(cp3, 2, 3, 'Checkpoint 3 (south hairpin)');
  b.rule({ id: 'lap', description: 'Crossing the line after all checkpoints completes a lap', when: { on: 'enter', zone: finishGate, who: kart }, if: [{ key: 'cp', op: '==', value: 3 }], then: [{ do: 'set', key: 'cp', value: 0 }, { do: 'add', key: 'lap', amount: 1 }, { do: 'message', text: 'Lap complete!', duration: 2 }, { do: 'sound', sound: 'pickup' }] });
  b.rule({ id: 'last-lap', when: { on: 'state', key: 'lap', op: '==', value: LAPS - 1 }, then: [{ do: 'message', text: 'Final lap!', duration: 2.5 }], once: true });
  b.rule({ id: 'checkered', when: { on: 'state', key: 'lap', op: '>=', value: LAPS }, then: [{ do: 'sound', sound: 'win' }, { do: 'win', text: 'Chequered flag! Three laps of Kart Canyon.' }], once: true });
  b.rule({ id: 'reset-key', when: { on: 'key', key: 'r' }, then: [{ do: 'reset' }] });

  b.test({ id: 'rivals-race', kind: 'moves', target: '#rival', distance: 20, within: 6 });
  b.test({ id: 'kart-on-track', kind: 'staysAbove', target: kart, y: -1, within: 4 });
  b.test({ id: 'barriers-hold', kind: 'stable', target: '#barrier', seconds: 2, maxDrift: 0.01 });
  b.test({ id: 'no-overlap', kind: 'noOverlap' });

  return finish(b, {
    name: 'Kart Canyon',
    description: 'A three-lap kart race along the floor of a sandstone canyon.',
    intro: {
      title: 'Kart Canyon',
      tagline: 'Sandstone, sunshine and two rivals who never brake.',
      objective: `Race ${LAPS} laps — hit every checkpoint in order and ride the boost pads.`,
      controls: ['W — throttle', 'S — brake', 'A / D — steer', 'R — restart', 'Esc — editor'],
      accent: '#ffd23f',
    },
    plan: 'Plan: canyon terrain, a 120-segment asphalt circuit with curbs along the canyon floor, centre barriers, start line, grandstand and crowd, boost pads, two patrolling rivals, a go-kart vehicle, ordered checkpoint rules and a three-lap goal.',
    message: `Built Kart Canyon: a circuit on the floor of a sandstone canyon with boost pads, a grandstand and two rival karts. Press Play: W/S throttle and brake, A/D steer; ${LAPS} laps through every checkpoint.`,
  });
}
