/**
 * Painterly Meadow — a summer morning in rolling wildflower country: a
 * steam train with three carriages circles the valley on its line, puffing
 * steam; a windmill turns, sheep graze, poppies and daisies sway in the
 * wind, height fog lies in the hollows. Press Space to blow the whistle.
 */
import type { Json } from '@aether/core';
import { r2, type V3 } from '../builder';
import type { MockPlan } from '../planner';
import { finish, flagshipBuilder, loopPoints, onCircle, segment } from './kit';

const RX = 46;
const RZ = 30;

/** Plan Painterly Meadow. */
export function meadowTrain(): MockPlan {
  const b = flagshipBuilder(0x3ead);
  b.env({
    sky: 'dawn',
    timeOfDay: 7.6,
    sunIntensity: 3,
    ambientIntensity: 0.55,
    fog: { color: '#f3dcc0', density: 0.0045 },
    weather: 'dust',
    bloom: 0.7,
    exposure: 1.08,
    ground: { material: { preset: 'grass', color: '#7fae4c' }, size: 420 },
  });
  // Rolling hills around the valley (the line runs on the flat floor).
  for (let i = 0; i < 9; i++) {
    const [x, , z] = onCircle(0, 0, b.rand(95, 130), (i / 9) * Math.PI * 2 + b.rand(-0.2, 0.2));
    b.gen('hill', 'mountain', { size: r2(b.rand(100, 140)), height: r2(b.rand(12, 22)), color: '#86b04f', snowLine: 1, groundColor: '#7fae4c', variant: 0 }, [x, 0, z], { tags: ['backdrop'] });
  }
  for (let i = 0; i < 5; i++) {
    const [x, , z] = onCircle(0, 0, b.rand(190, 230), Math.PI * 1.1 + (i / 5) * Math.PI * 0.8);
    b.gen('mountain', 'mountain', { size: r2(b.rand(110, 150)), height: r2(b.rand(45, 70)), color: '#8a93a8', snowLine: 0.75, groundColor: '#86b04f' }, [x, 0, z], { tags: ['backdrop'] });
  }

  // --- The line: ballast, sleepers and rails on an oval -----------------------------------------
  const line = loopPoints(0, 0, RX, RZ, 64, 0.04);
  for (let i = 0; i < line.length; i++) {
    const a = line[i] as V3;
    const c = line[(i + 1) % line.length] as V3;
    segment(b, 'ballast', a, c, 3, 0.18, { preset: 'stone', color: '#8c847a', roughness: 1 }, { y: 0.06 });
    const dx = c[0] - a[0];
    const dz = c[2] - a[2];
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len;
    const nz = dx / len;
    for (const side of [-1, 1]) segment(b, 'rail', [r2(a[0] + nx * 0.72 * side), 0, r2(a[2] + nz * 0.72 * side)], [r2(c[0] + nx * 0.72 * side), 0, r2(c[2] + nz * 0.72 * side)], 0.1, 0.12, { preset: 'metal', color: '#5d5550', roughness: 0.35, metalness: 0.8 }, { y: 0.24 });
  }
  // The train: an engine and three carriages riding the same loop, a little apart.
  const route = loopPoints(0, 0, RX, RZ, 96, 0.04, 0.2);
  const ride = (offset: number): Json[] => [...route.slice(offset), ...route.slice(0, offset)];
  const engine = b.empty('engine', route[0] as V3, { name: 'Steam engine', physics: { body: 'kinematic', sensor: true }, behaviors: [{ type: 'patrol', params: { waypoints: ride(1), speed: 6, mode: 'loop', face: true } }], tags: ['train'] });
  b.gen('engine-body', 'train-engine', { color: '#1e4d3a', trimColor: '#c69a3b' }, [0, 0, 0], { parent: engine, yaw: 90 });
  // Steam puffs: a spawner on the chimney releases drifting clouds that fade away.
  b.gen('steam-puff', 'cloud', { size: 1.6, color: '#ffffff', variant: 0 }, [0, -50, 0], {
    template: true,
    castShadow: false,
    material: { emissive: '#ffffff', emissiveIntensity: 0.35 },
    behaviors: [{ type: 'lifetime', params: { seconds: 2.6 } }, { type: 'patrol', params: { waypoints: [[0, 0, 0], [0, 5, 1.5]], relative: true, speed: 2, mode: 'once', face: false } }],
  });
  b.empty('chimney', [0, 3.4, -1.6], { parent: engine, behaviors: [{ type: 'spawner', params: { template: 'steam-puff-1', interval: 0.45, max: 7, offset: [0, 0, 0] } }] });
  const colors = ['#8a2b2b', '#2b4f8a', '#8a6a2b'] as const;
  colors.forEach((color, k) => {
    const car = b.empty('carriage', route[96 - (k + 1) * 3] as V3, { name: `Carriage ${k + 1}`, physics: { body: 'kinematic', sensor: true }, behaviors: [{ type: 'patrol', params: { waypoints: ride(96 - (k + 1) * 3 + 1), speed: 6, mode: 'loop', face: true } }], tags: ['train'] });
    b.prim('carriage-body', 'box', [2.3, 2.1, 5.6], [0, 1.55, 0], { parent: car, material: { preset: 'wood', color, roughness: 0.5 } });
    b.prim('carriage-roof', 'cylinder', [2.6, 5.8, 2.6], [0, 2.45, 0], { parent: car, rot: [90, 0, 0], scale: [1, 1, 0.32], material: { preset: 'metal', color: '#3a3a3a', roughness: 0.5 } });
    b.prim('carriage-windows', 'box', [2.36, 0.7, 4.6], [0, 1.9, 0], { parent: car, material: { preset: 'emissive', color: '#fff1cf', emissive: '#ffe2a8', emissiveIntensity: 0.6 } });
    for (const z of [-1.9, 1.9]) for (const x of [-0.85, 0.85]) b.prim('wheel', 'cylinder', [0.8, 0.2, 0.8], [x, 0.45, z], { parent: car, rot: [0, 0, 90], material: { preset: 'metal', color: '#2a2a2a' } });
  });

  // --- The valley: a station, a windmill, cottages, sheep, wildflowers ---------------------------------
  const station = b.prim('platform', 'box', [3, 0.9, 14], [r2(RX + 4), 0.45, 0], { name: 'Station platform', material: { preset: 'stone', color: '#b3aa9a' }, physics: 'static' });
  void station;
  b.gen('station-house', 'house', { width: 6, depth: 5, color: '#efe2c4', roofColor: '#8a3b2e', variant: 2 }, [r2(RX + 10), 0, 0], { yaw: -90, physics: 'static', name: 'Station' });
  b.gen('windmill', 'windmill', { height: 11, color: '#efe6d6', roofColor: '#7a3b2a', bladeColor: '#f5f0e6', variant: 0 }, [-12, 0, -8], { physics: 'static', name: 'Windmill', tags: ['landmark'] });
  for (const [x, z, yaw] of [[14, 6, 200], [-20, 10, 160], [6, -12, 20]] as const) b.gen('cottage', 'house', { width: 5.5, depth: 4.5, color: '#f2e8d2', roofColor: '#a0442c', variant: 0 }, [x, 0, z], { yaw, physics: 'static' });
  for (let i = 0; i < 26; i++) {
    const p = b.spot(0, 0, 4, 26, 2.4);
    if (!p) continue;
    b.gen('meadow-tree', b.chance(0.7) ? 'tree-oak' : 'tree-pine', { height: r2(b.rand(5, 8)), color: b.pick(['#5f8f3a', '#6f9a3f', '#4f7d35']), density: 8 }, [p[0], 0, p[1]], { yaw: r2(b.rand(0, 360)), physics: 'static', tags: ['tree'] });
  }
  for (let i = 0; i < 10; i++) {
    const [x, , z] = onCircle(0, 0, b.rand(52, 70), b.rand(0, Math.PI * 2));
    b.asset('animal', b.chance(0.7) ? 'cow' : 'pig', [x, 0, z], { yaw: r2(b.rand(0, 360)), behaviors: [{ type: 'wander', params: { radius: 5, speed: 0.6, pause: 3 } }], physics: { body: 'kinematic', sensor: true }, tags: ['animal'] });
  }
  // Painterly drifts of flowers and tall grass (instanced fields).
  const flowers: ReadonlyArray<[string, string]> = [['#e6402e', '#2b2b2b'], ['#ffffff', '#ffd23f'], ['#b388ff', '#ffe08a'], ['#ffd23f', '#a8641f']];
  flowers.forEach(([color, center], k) => {
    const [x, , z] = onCircle(0, 0, 70, (k / flowers.length) * Math.PI * 2 + 0.4);
    b.scatter('wildflowers', 'flowers', { size: 0.55, color, centerColor: center, count: 5 }, 2600, [60, 60], [x, 0, z], { minSpacing: 0.5, scaleRange: [0.7, 1.3] });
  });
  b.scatter('tall-grass', 'grass-tuft', { size: 0.8, color: '#93b85a', blades: 12, variant: 1 }, 24000, [260, 260], [0, 0, 0], { minSpacing: 0.6, scaleRange: [0.6, 1.4] });
  for (let i = 0; i < 12; i++) {
    const [x, , z] = onCircle(0, 0, b.rand(120, 170), b.rand(0, Math.PI * 2));
    b.gen('cloud', 'cloud', { size: r2(b.rand(22, 36)), color: '#fff6ea', variant: 0 }, [x, r2(b.rand(46, 66)), z], { castShadow: false, material: { emissive: '#fff1de', emissiveIntensity: 0.35 }, tags: ['sky'], behaviors: [{ type: 'bob', params: { amplitude: 0.8, period: r2(b.rand(7, 11)) } }] });
  }

  b.player({ mode: 'orbit', spawn: [r2(RX + 26), 9, 22] });
  b.rule({ id: 'hint', when: { on: 'start' }, then: [{ do: 'message', text: 'Press SPACE to blow the whistle.', duration: 4 }] });
  b.rule({ id: 'whistle', when: { on: 'key', key: 'space' }, then: [{ do: 'sound', sound: 'whoosh' }, { do: 'message', text: 'Toot toot!', duration: 1.5 }] });

  b.test({ id: 'train-runs', kind: 'moves', target: engine, distance: 8, within: 4 });
  b.test({ id: 'carriages-follow', kind: 'moves', target: '#train', distance: 8, within: 4 });

  return finish(b, {
    name: 'Painterly Meadow',
    description: 'A steam train circles a wildflower valley on a summer morning.',
    intro: {
      title: 'Painterly Meadow',
      tagline: 'A summer morning, a little steam train and fifty thousand wildflowers.',
      objective: 'Orbit the valley, follow the train, and blow its whistle.',
      controls: ['Drag — orbit', 'Scroll — zoom', 'Space — whistle', 'Esc — editor'],
      accent: '#f2b450',
    },
    plan: 'Plan: a flat valley ringed by rolling hills and mountains, an oval railway (ballast, rails), a steam engine and three carriages on patrol with a steam-puff spawner, a station, windmill, cottages, wandering animals, instanced wildflowers and tall grass, morning haze.',
    message: 'Built Painterly Meadow: a steam train circling a wildflower valley on a summer morning, with a windmill, cottages and grazing animals. Press Play and SPACE for the whistle.',
  });
}
