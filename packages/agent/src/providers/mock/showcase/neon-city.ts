/**
 * Neon Rain City — a rain-soaked downtown at night: wet asphalt mirroring
 * neon, towers lit window by window (window-grid facades whose panes glow at night, no instanced
 * layers), signs that flicker, taxis and buses running the avenues, people
 * under the rain, steam from the street. Five neon cats hide around the
 * blocks — find them all.
 */
import type { Json } from '@aether/core';
import { r2, type Builder, type V3 } from '../builder';
import type { MockPlan } from '../planner';
import { finish, flagshipBuilder, pickup } from './kit';

const NEON = ['#ff2e88', '#22e1ff', '#ffd23f', '#9b5dff', '#3dff9a', '#ff6b2e'] as const;
/** Avenue (along Z) and cross street (along X) half-widths. */
const AVE = 9;
const CROSS = 8;

interface Tower {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
}

/** Plan Neon Rain City. */
export function neonRainCity(): MockPlan {
  const b = flagshipBuilder(0x7e0c, { night: true, rain: true });
  b.env({
    sky: 'night',
    timeOfDay: 22.6,
    sunIntensity: 0.4,
    ambientIntensity: 0.55,
    fog: { color: '#1c1838', density: 0.011 },
    weather: 'rain',
    bloom: 1.5,
    exposure: 1.15,
    // Wet asphalt: dark and glossy so neon smears across it.
    ground: { material: { finish: 'asphalt', color: '#1d2028', roughness: 0.55 }, size: 360 },
  });

  // --- Streets ------------------------------------------------------------------------------
  b.prim('avenue', 'box', [AVE * 2, 0.04, 220], [0, 0.02, 0], { name: 'Avenue', material: { finish: 'asphalt', color: '#23262e', roughness: 0.5 }, castShadow: false });
  b.prim('cross-street', 'box', [200, 0.04, CROSS * 2], [0, 0.022, 0], { name: 'Cross street', material: { finish: 'asphalt', color: '#23262e', roughness: 0.5 }, castShadow: false });
  for (let z = -104; z <= 104; z += 8) {
    if (Math.abs(z) < CROSS + 2) continue;
    b.prim('lane-mark', 'box', [0.18, 0.05, 3.2], [0, 0.03, z], { material: { preset: 'emissive', color: '#e8e0c8', emissive: '#c9c2aa', emissiveIntensity: 0.25 }, castShadow: false });
  }
  for (let k = 0; k < 9; k++) {
    for (const [x, z] of [[r2(-AVE + 1 + k * 2), r2(CROSS + 1.6)], [r2(-AVE + 1 + k * 2), r2(-CROSS - 1.6)]] as const) b.prim('zebra', 'box', [1, 0.05, 2.6], [x, 0.03, z], { material: { preset: 'plastic', color: '#d8d4c8', roughness: 0.3 }, castShadow: false });
  }
  // Raised sidewalks along both streets.
  for (const side of [-1, 1]) {
    b.prim('sidewalk', 'box', [5, 0.22, 220], [r2(side * (AVE + 2.5)), 0.11, 0], { material: { finish: 'cobble', color: '#4b4f5a', roughness: 0.5 }, physics: 'static', castShadow: false });
    b.prim('sidewalk', 'box', [200, 0.22, 5], [0, 0.11, r2(side * (CROSS + 2.5))], { material: { finish: 'cobble', color: '#4b4f5a', roughness: 0.5 }, physics: 'static', castShadow: false });
  }

  // --- Towers with lit windows ------------------------------------------------------------------
  const towers: Tower[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      // Each quadrant: two rows of towers back from the street corners.
      for (let k = 0; k < 5; k++) {
        for (let row = 0; row < 2; row++) {
          // Footprints and heights on the facade's 3 m grid (bays and floors).
          const w = Math.round(b.rand(11, 16) / 3) * 3;
          const d = Math.round(b.rand(11, 16) / 3) * 3;
          const x = r2(sx * (AVE + 5 + w / 2 + row * 18 + b.rand(0, 2)));
          const z = r2(sz * (CROSS + 5 + d / 2 + k * 19 + b.rand(0, 2)));
          const near = row === 0 && k < 2;
          const h = Math.round((near ? b.rand(26, 48) : b.rand(34, 92)) / 3) * 3;
          towers.push({ x, z, w, d, h });
        }
      }
    }
  }
  towers.forEach((t, i) => {
    // A real facade: window grid with recessed glass that lights up at night (the finish owns the emission), a concrete
    // roof deck with plant rooms and a water tank, one box collider.
    const glass = i % 3 === 0;
    b.gen('tower', 'skyline-tower', { width: t.w, depth: t.d, height: t.h, setbacks: 0, variant: glass ? 0 : i % 3 === 1 ? 2 : 1, color: glass ? b.pick(['#46586a', '#566873', '#3f4f60']) : b.pick(['#6b6675', '#74747f', '#7d7380', '#5f6b78']) }, [t.x, 0, t.z], { name: 'Tower', physics: 'static', tags: ['tower'] });
    // A blinking mast and a glowing crown strip on some roofs against the glow.
    const mast = b.prim('mast', 'cylinder', [0.18, r2(b.rand(6, 11)), 0.18], [r2(t.x - t.w * 0.25), r2(t.h + 0.6 + 4), r2(t.z + t.d * 0.25)], { material: { preset: 'metal', color: '#555a63' }, physics: 'static' });
    b.prim('mast-light', 'sphere', [0.5, 0.5, 0.5], [0, 5.3, 0], { parent: mast, material: { preset: 'emissive', color: '#ff2a2a', emissive: '#ff2a2a', emissiveIntensity: 3 }, castShadow: false, behaviors: [{ type: 'pulseLight', params: { min: 0.1, max: 3.4, period: r2(b.rand(1.2, 2.4)), property: 'material.emissiveIntensity' } }] });
    if (i % 4 === 1) b.prim('crown-light', 'box', [r2(t.w * 0.72), 0.25, r2(t.d * 0.72)], [t.x, r2(t.h + 0.75), t.z], { material: { preset: 'neon', color: NEON[i % NEON.length] as string, emissive: NEON[i % NEON.length] as string, emissiveIntensity: 2.4 }, castShadow: false });
  });

  // --- Neon signs on the street-facing towers ---------------------------------------------------------
  towers.filter((t) => Math.abs(t.x) < AVE + 14 || Math.abs(t.z) < CROSS + 14).forEach((t, i) => {
    const color = NEON[(i * 2) % NEON.length] as string;
    const facingAve = Math.abs(t.x) < AVE + 14;
    const sx = Math.sign(t.x);
    const sz = Math.sign(t.z);
    const p: V3 = facingAve ? [r2(t.x - sx * (t.w / 2 + 0.9)), r2(b.rand(6, 11)), r2(t.z - sz * b.rand(0, t.d / 3))] : [r2(t.x - sx * b.rand(0, t.w / 3)), r2(b.rand(6, 11)), r2(t.z - sz * (t.d / 2 + 0.9))];
    const sign = b.prim('neon-sign', 'box', facingAve ? [0.35, 5.2, 1.4] : [1.4, 5.2, 0.35], p, {
      name: 'Neon sign',
      material: { preset: 'neon', color, emissive: color, emissiveIntensity: 3 },
      castShadow: false,
      behaviors: i % 3 === 0 ? [{ type: 'pulseLight', params: { min: 0.4, max: 3.2, period: r2(b.rand(0.25, 0.8)), property: 'material.emissiveIntensity' } }] : [],
      tags: ['sign'],
    });
    if (i < 6) b.light(sign, [facingAve ? -sx * 1.2 : 0, -2, facingAve ? 0 : -sz * 1.2], color, 3.2, 16);
    // A glowing strip under the sign's awning.
    b.prim('awning', 'box', facingAve ? [2, 0.12, 6] : [6, 0.12, 2], [r2(facingAve ? t.x - sx * (t.w / 2 + 1) : p[0]), 3.4, r2(facingAve ? p[2] : t.z - sz * (t.d / 2 + 1))], { material: { preset: 'neon', color: NEON[(i * 2 + 3) % NEON.length] as string, emissive: NEON[(i * 2 + 3) % NEON.length] as string, emissiveIntensity: 1.6 }, castShadow: false });
  });

  // --- Street furniture: lamps, puddles, steam ---------------------------------------------------------
  for (let z = -96; z <= 96; z += 24) {
    for (const side of [-1, 1]) {
      const lamp = b.asset('street-lamp', 'streetlight', [r2(side * (AVE + 0.6)), 0.22, z], { yaw: side > 0 ? -90 : 90, physics: 'static' });
      if (Math.abs(z) < 30) b.light(lamp, [r2(-side * 1.2), 4.6, 0], '#ffd9a8', 2.2, 14);
    }
  }
  // Puddles are the asphalt's own: rain fills the low spots of the finish (flat and mirror-like), no extra discs on the road.
  for (const [x, z] of [[3, 30], [-4, -42], [5, -70], [-2, 60]] as const) {
    b.gen('steam', 'cloud', { size: 3, color: '#d9d4ff', variant: 1 }, [x, 0.6, z], { castShadow: false, material: { opacity: 0.45, emissive: '#5a4f8a', emissiveIntensity: 0.4 }, behaviors: [{ type: 'bob', params: { amplitude: 0.6, period: 3.2 } }] });
  }

  // --- Traffic and people ----------------------------------------------------------------------------
  const lanes: Array<[number, number]> = [[3.2, -1], [-3.2, 1]];
  const cars = ['taxi', 'car', 'van', 'taxi', 'suv', 'hatchback', 'taxi', 'delivery-truck'] as const;
  cars.forEach((model, i) => {
    const [lx, dir] = lanes[i % 2] as [number, number];
    // A loop: up one lane of the avenue, across at the end, down the other.
    const loop: Json[] = dir < 0 ? [[lx, 0.04, -105], [-lx, 0.04, -105], [-lx, 0.04, 105], [lx, 0.04, 105]] : [[lx, 0.04, 105], [-lx, 0.04, 105], [-lx, 0.04, -105], [lx, 0.04, -105]];
    const z0 = r2(-100 + ((i * 53) % 200));
    const car = b.asset('car', model, [lx, 0.04, z0], {
      name: model === 'taxi' ? 'Taxi' : 'Car',
      yaw: dir < 0 ? 0 : 180,
      physics: { body: 'kinematic', sensor: true },
      behaviors: [{ type: 'patrol', params: { waypoints: loop, speed: r2(b.rand(7, 11)), mode: 'loop', face: true } }],
      tags: ['traffic'],
      fallback: { kind: 'procedural', generator: 'car', params: { length: 4.2, color: '#ffd23f' } },
    });
    // Headlights and tail lights.
    b.prim('headlights', 'box', [1.6, 0.18, 0.1], [0, 0.75, -2.3], { parent: car, material: { preset: 'emissive', color: '#fff6e0', emissive: '#fff6e0', emissiveIntensity: 4 }, castShadow: false });
    b.prim('taillights', 'box', [1.6, 0.16, 0.1], [0, 0.8, 2.3], { parent: car, material: { preset: 'emissive', color: '#ff2e3c', emissive: '#ff2e3c', emissiveIntensity: 3 }, castShadow: false });
  });
  const coats = ['#2b2f3a', '#8c2f39', '#2f5d8c', '#c9a227', '#3d6b4f', '#6b3f8c', '#1d1d24', '#b5651d'] as const;
  coats.forEach((coat, i) => {
    const side = i % 2 ? 1 : -1;
    // Real pedestrians from the cast in rain coats (the capsule is only the collider).
    b.prim('pedestrian', 'capsule', [0.56, 1.7, 0.56], [r2(side * (AVE + 2.5)), 0.22 + 0.85, r2(-60 + i * 16)], { character: { wardrobe: i % 4 === 3 ? 'worker' : 'casual', gender: i % 2 ? 'female' : 'male', top: coat, mood: i % 3 === 0 ? 'tired' : 'neutral', hold: i % 4 === 1 ? 'bag' : 'none' }, behaviors: [{ type: 'patrol', params: { waypoints: [[0, 0, -12], [0, 0, 12]], relative: true, speed: r2(b.rand(1.1, 1.5)), mode: 'pingpong', wait: 1, face: true } }], physics: { body: 'kinematic', sensor: true }, tags: ['pedestrian'] });
  });

  // --- The game: five neon cats -------------------------------------------------------------------------
  const cats: V3[] = [[r2(AVE + 3.5), 0.9, -38], [r2(-AVE - 3.5), 0.9, 52], [-34, 0.9, r2(CROSS + 3.5)], [41, 0.9, r2(-CROSS - 3.5)], [r2(AVE + 3.5), 0.9, 86]];
  cats.forEach((p, i) => {
    pickup(b, 'neon-cat', p, { scoreKey: 'cats', color: NEON[i] as string, size: 0.9, shape: 'sphere', name: 'Neon cat', message: 'Meow! A neon cat.', tags: ['cat'] });
    b.asset('cat-body', 'cat-statue', [p[0], 0.22, p[2]], { fitSize: 0.9, castShadow: false });
  });
  b.player({ mode: 'thirdPerson', spawn: [0, 0.3, 14], moveSpeed: 6 });
  b.state('cats', 0);
  b.hud('cats', 'Neon cats / 5');
  b.rule({ id: 'hint', when: { on: 'start' }, then: [{ do: 'message', text: 'Five neon cats are hiding on these blocks. Find them all.', duration: 4 }] });
  b.rule({ id: 'all-cats', when: { on: 'state', key: 'cats', op: '>=', value: 5 }, then: [{ do: 'sound', sound: 'win' }, { do: 'win', text: 'All five neon cats found. The city purrs.' }], once: true });
  b.rule({ id: 'reset-key', when: { on: 'key', key: 'r' }, then: [{ do: 'reset' }] });

  b.test({ id: 'traffic-flows', kind: 'moves', target: '#traffic', distance: 10, within: 5 });
  b.test({ id: 'towers-stand', kind: 'stable', target: '#tower', seconds: 1, maxDrift: 0.01 });
  b.test({ id: 'cats-float', kind: 'staysAbove', target: '#cat', y: 0.3, within: 3 });

  return finish(b, {
    name: 'Neon Rain City',
    description: 'A rain-soaked downtown at night, lit window by window — find the five neon cats.',
    intro: {
      title: 'Neon Rain City',
      tagline: 'Rain, wet asphalt and a thousand lit windows. The city never sleeps.',
      objective: 'Walk the blocks and find the five neon cats hiding by the street.',
      controls: ['WASD — walk', 'Space — jump', 'Mouse — look', 'R — restart', 'Esc — editor'],
      accent: '#ff2e88',
    },
    plan: 'Plan: a night downtown in the rain — avenue and cross street with wet asphalt, 40 towers with window-grid facades that light up at night, flickering neon signs with coloured lights, street lamps, rain puddles in the asphalt and steam, eight cars and eight pedestrians on patrol, five neon cat pickups and a win rule.',
    message: 'Built Neon Rain City: a rain-soaked downtown at night — towers lit window by window, flickering neon over wet asphalt, traffic and people. Press Play and find the five neon cats (WASD to walk).',
  });
}
