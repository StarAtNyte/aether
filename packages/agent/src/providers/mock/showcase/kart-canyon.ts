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
import { finish, flagshipBuilder, onCircle, segment } from './kit';

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
function acrossYaw(track: readonly V3[], i: number): number {
  const a = track[(i - 1 + track.length) % track.length] as V3;
  const c = track[(i + 1) % track.length] as V3;
  return r2((Math.atan2(-(c[0] - a[0]), -(c[2] - a[2])) * 180) / Math.PI);
}

/** A checkpoint gate across the track at `p` (invisible sensor + two glowing posts). */
function gate(b: Builder, n: number, p: V3, heading: number, color: string, label: string): string {
  const id = b.prim(`checkpoint-${n}`, 'box', [14, 5, 2], [p[0], 2.5, p[2]], { name: label, yaw: heading, visible: false, physics: { body: 'static', sensor: true }, tags: ['checkpoint-gate'] });
  const ux = Math.cos((heading * Math.PI) / 180);
  const uz = -Math.sin((heading * Math.PI) / 180);
  for (const side of [-1, 1]) {
    b.prim('gate-post', 'cylinder', [0.5, 5, 0.5], [r2(p[0] + ux * 7 * side), 2.5, r2(p[2] + uz * 7 * side)], { material: { preset: 'neon', color, emissive: color, emissiveIntensity: 1.8 }, physics: 'static', tags: ['gate-post'] });
  }
  b.prim('gate-banner', 'box', [14, 0.8, 0.2], [p[0], 5.2, p[2]], { yaw: heading, material: { preset: 'neon', color, emissive: color, emissiveIntensity: 1.2 }, castShadow: false });
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
  for (let i = 0; i < n; i++) {
    const a = track[i] as V3;
    const c = track[(i + 1) % n] as V3;
    segment(b, 'asphalt', a, c, 10, 0.06, { preset: 'concrete', color: '#45474d', roughness: 0.75 }, { y: 0.03 });
    // Red/white curbs on both edges, alternating.
    const dx = c[0] - a[0];
    const dz = c[2] - a[2];
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len;
    const nz = dx / len;
    const curb = i % 2 === 0 ? '#d7263d' : '#f5f3ee';
    for (const side of [-1, 1]) {
      segment(b, 'curb', [r2(a[0] + nx * 5.3 * side), 0, r2(a[2] + nz * 5.3 * side)], [r2(c[0] + nx * 5.3 * side), 0, r2(c[2] + nz * 5.3 * side)], 0.7, 0.12, { preset: 'plastic', color: curb, roughness: 0.6 }, { y: 0.06 });
    }
  }
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
  b.prim('grandstand', 'box', [6, 3, 24], [standX, 1.5, r2(start[2] - 2)], { material: { preset: 'concrete', color: '#c9c3b8' }, physics: 'static', name: 'Grandstand' });
  for (let s = 0; s < 4; s++) b.prim('stand-step', 'box', [1.4, 0.5, 24], [r2(standX - 2.3 + s * 1.5), r2(3.25 + s * 0.5), r2(start[2] - 2)], { material: { preset: 'plastic', color: ['#d7263d', '#f5f3ee', '#1b98e0', '#ffd23f'][s] as string }, physics: 'static' });
  b.prim('stand-roof', 'box', [8, 0.3, 26], [standX, 7.8, r2(start[2] - 2)], { material: { preset: 'metal', color: '#2b2f3a' }, castShadow: true });
  for (const dz of [-12, 12]) b.prim('stand-pillar', 'box', [0.3, 4.4, 0.3], [r2(standX + 3.6), 5.6, r2(start[2] - 2 + dz)], { material: { preset: 'metal', color: '#2b2f3a' }, physics: 'static' });
  // Crowd: animated people on the stand.
  const shirts = ['#d7263d', '#f5f3ee', '#1b98e0', '#ffd23f', '#2f7d4a', '#e8742a'] as const;
  for (let k = 0; k < 10; k++) {
    // Real people from the cast (the capsule is only the collider; the standing figure replaces it).
    b.prim('fan', 'capsule', [0.56, 1.7, 0.56], [r2(standX - 2.3 + (k % 4) * 1.5), r2(3.5 + 0.85 + (k % 4) * 0.5), r2(start[2] - 12 + k * 2.2)], {
      yaw: -90,
      castShadow: true,
      character: { wardrobe: 'casual', gender: k % 2 ? 'female' : 'male', age: k % 5 === 4 ? 'old' : k % 3 === 0 ? 'young' : 'adult', mood: 'cheerful', top: b.pick(shirts), scale: r2(b.rand(0.94, 1.06)) },
      tags: ['crowd'],
    });
  }

  // --- Boost pads on both straights ------------------------------------------------------
  for (const [i, dir] of [[Math.round(n * 0.12), -1], [Math.round(n * 0.62), 1]] as const) {
    const p = track[i] as V3;
    b.prim('boost-pad', 'box', [6, 0.08, 7], [p[0], 0.07, p[2]], {
      name: 'Boost pad',
      material: { preset: 'neon', color: '#00f5d4', emissive: '#00f5d4', emissiveIntensity: 2.2 },
      castShadow: false,
      behaviors: [{ type: 'pulseLight', params: { min: 1, max: 3, period: 0.6, property: 'material.emissiveIntensity' } }],
    });
    b.prim('boost-zone', 'box', [6, 2, 7], [p[0], 1, p[2]], { visible: false, physics: { body: 'static', sensor: true }, behaviors: [{ type: 'windZone', params: { direction: [0, 0, dir], strength: 26, who: '*', player: true } }], tags: ['boost'] });
  }

  // --- Karts ---------------------------------------------------------------------------------
  const kart = b.asset('kart', 'go-kart', [r2(start[0] - 2.2), 0.05, r2(start[2] + 4)], {
    name: 'Your kart',
    yaw: 0,
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
      behaviors: [{ type: 'patrol', params: { waypoints: line, speed, mode: 'loop', face: true } }],
      tags: ['rival'],
      fallback: { kind: 'procedural', generator: 'car', params: { length: 2.6, color } },
    });
  }

  // --- Canyon dressing ----------------------------------------------------------------------
  for (let i = 0; i < 26; i++) {
    const z = r2(b.rand(-200, 200));
    const side = b.chance(0.5) ? -1 : 1;
    const x = r2(mx(z) + side * b.rand(26, 38));
    if (b.chance(0.55)) b.gen('saguaro', 'saguaro-cactus', {}, [x, 0, z], { yaw: r2(b.rand(0, 360)), physics: 'static', castShadow: true });
    else b.gen('boulder', 'rock', { size: r2(b.rand(2, 5)), color: '#b0603a', variant: b.int(0, 2) }, [x, 0, z], { yaw: r2(b.rand(0, 360)), physics: 'static' });
  }
  for (const side of [-1, 1]) b.scatter('desert-brush', 'bush', { size: 1.1, color: '#9a9a52' }, 420, [16, 440], [r2(mx(0) + side * 31), 0, 0], { minSpacing: 2, scaleRange: [0.6, 1.3], onSurface: canyon });
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
