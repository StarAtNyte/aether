/**
 * Painterly Meadow — a summer morning in rolling wildflower country: a
 * steam train with three carriages circles the valley on its line, puffing
 * steam; a windmill turns, sheep graze, poppies and daisies sway in the
 * wind, height fog lies in the hollows.
 *
 * You walk it from the station platform: stop at the windmill, the sheep meadow and the cottage garden (each with someone to
 * talk to), then come back to the platform for the next train. F blows the engine's whistle from anywhere.
 */
import type { Json } from '@aether/core';
import { r2, type V3 } from '../builder';
import type { MockPlan } from '../planner';
import { faceToward, finish, flagshipBuilder, loopPoints, onCircle } from './kit';
import { railTrack } from './track';
import { addLife } from './life';

const RX = 46;
const RZ = 30;

/** Plan Painterly Meadow. */
export function meadowTrain(): MockPlan {
  const b = flagshipBuilder(0x3ead, {});
  b.env({
    sky: 'dawn',
    timeOfDay: 7.6,
    sunIntensity: 3,
    ambientIntensity: 0.55,
    fog: { color: '#f3dcc0', density: 0.0045, visibility: 480 },
    weather: 'dust',
    bloom: 0.7,
    exposure: 1.08,
    // A warm, soft grade: the "painterly" look is in the light and colour, not in cartoon geometry.
    grade: { temperature: 0.12, saturation: 1.1, contrast: 0.94 },
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

  // --- The line: ballast, sleepers and rails on an oval (two draped meshes) -----------------------------------------
  const line = loopPoints(0, 0, RX, RZ, 64, 0.04);
  railTrack(b, { id: 'line', loop: line.map((p) => [p[0], p[2]] as const) });
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
    // A wooden coach: panelled body in the livery colour, a dark skirt and bogies, a rolled roof, framed windows down both sides.
    b.prim('carriage-body', 'box', [2.3, 1.9, 5.8], [0, 1.45, 0], { parent: car, material: { preset: 'wood', finish: 'paint', color, roughness: 0.45 } });
    b.prim('carriage-band', 'box', [2.34, 0.14, 5.84], [0, 0.82, 0], { parent: car, material: { preset: 'wood', color: '#d9b25c', roughness: 0.5 }, castShadow: false });
    b.prim('carriage-skirt', 'box', [2.0, 0.42, 5.4], [0, 0.55, 0], { parent: car, material: { preset: 'metal', color: '#26231f', roughness: 0.6 } });
    b.prim('carriage-roof', 'cylinder', [2.7, 5.9, 2.7], [0, 2.38, 0], { parent: car, rot: [90, 0, 0], scale: [1, 1, 0.3], material: { finish: 'metal-roof', color: '#4c4d50', roughness: 0.55 } });
    for (const side of [-1, 1]) {
      for (let w = 0; w < 5; w++) {
        const z = -2.2 + w * 1.1;
        b.prim('carriage-window-frame', 'box', [0.05, 0.84, 0.78], [side * 1.16, 1.78, z], { parent: car, material: { preset: 'wood', color: '#e8dcc0', roughness: 0.5 }, castShadow: false });
        b.prim('carriage-window', 'box', [0.06, 0.68, 0.62], [side * 1.175, 1.78, z], { parent: car, material: { preset: 'glass', color: '#9fb8c6', roughness: 0.05, emissive: '#ffd9a0', emissiveIntensity: 0.35 }, castShadow: false });
      }
    }
    for (const z of [-1.9, 1.9]) {
      for (const x of [-0.8, 0.8]) b.prim('wheel', 'cylinder', [0.84, 0.16, 0.84], [x, 0.44, z], { parent: car, rot: [0, 0, 90], material: { preset: 'metal', color: '#202020', roughness: 0.4, metalness: 0.7 } });
      b.prim('bogie', 'box', [2.0, 0.16, 0.5], [0, 0.5, z], { parent: car, material: { preset: 'metal', color: '#1c1c1c', roughness: 0.6 }, castShadow: false });
    }
  });

  // --- The valley: a station, a windmill, cottages, sheep, wildflowers ---------------------------------
  b.prim('platform', 'box', [3, 0.9, 14], [r2(RX + 4), 0.45, 0], { name: 'Station platform', material: { finish: 'limestone', preset: 'stone', color: '#b3aa9a' }, physics: 'static' });
  // A yellow safety edge, a bench, lamps and a name board make it a station rather than a slab.
  b.prim('platform-edge', 'box', [0.12, 0.02, 14], [r2(RX + 2.45), 0.91, 0], { material: { preset: 'plastic', color: '#e0b92c', roughness: 0.6 }, castShadow: false });
  b.gen('platform-bench', 'bench', {}, [r2(RX + 5), 0.9, -4], { yaw: 90, physics: 'static', footprint: 1.4 });
  for (const z of [-6, 6]) b.gen('platform-lamp', 'lamp-post', { height: 3.2 }, [r2(RX + 5.2), 0.9, z], { physics: 'static', footprint: 0.5 });
  b.prim('station-sign', 'box', [0.08, 0.5, 2.2], [r2(RX + 5.5), 2.0, 3], { name: 'Station name board', material: { preset: 'wood', color: '#1f3b2e', roughness: 0.6 }, castShadow: false });
  b.gen('station-house', 'house', { width: 6, depth: 5, color: '#efe2c4', roofColor: '#8a3b2e', variant: 2 }, [r2(RX + 10), 0, 0], { yaw: -90, physics: 'static', name: 'Station' });
  b.gen('windmill', 'windmill', { height: 11, color: '#efe6d6', roofColor: '#7a3b2a', bladeColor: '#f5f0e6', variant: 0 }, [-12, 0, -8], { physics: 'static', name: 'Windmill', tags: ['landmark'] });
  for (const [x, z, yaw] of [[14, 6, 200], [-20, 10, 160], [6, -12, 20]] as const) b.gen('cottage', 'house', { width: 5.5, depth: 4.5, color: '#f2e8d2', roofColor: '#a0442c', variant: 0 }, [x, 0, z], { yaw, physics: 'static' });
  for (let i = 0; i < 26; i++) {
    const p = b.spot(0, 0, 4, 26, 2.4);
    if (!p) continue;
    b.gen('meadow-tree', b.chance(0.7) ? 'tree-oak' : 'tree-pine', { height: r2(b.rand(5, 8)), color: b.pick(['#5f8f3a', '#6f9a3f', '#4f7d35']), density: 8 }, [p[0], 0, p[1]], { yaw: r2(b.rand(0, 360)), physics: 'static', tags: ['tree'] });
  }
  // Grazing and flying life, placed by the same measured planner as the level tools (the valley floor is flat).
  addLife(b, { height: (x, z) => (Math.abs(x) < 200 && Math.abs(z) < 200 ? 0 : null) }, [
    { id: 'sheep', species: 'sheep', count: 12, x: -34, z: 26, radius: 11 },
    { id: 'cows', species: 'cow', count: 5, x: 64, z: -48, radius: 9 },
    { id: 'songbirds', species: 'bird', count: 8, x: -20, z: 14, radius: 22 },
    { id: 'butterflies', species: 'butterfly', count: 10, x: 64, z: 27, radius: 10 },
    { id: 'hawk', species: 'hawk', count: 1, x: 0, z: 0, radius: 60 },
  ]);
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

  // --- The walk: three stops, then the platform --------------------------------------------------------
  b.player({ mode: 'thirdPerson', spawn: [r2(RX + 4), 1.1, 5], moveSpeed: 4.8, jumpSpeed: 5.2, character: { wardrobe: 'casual', gender: 'male', age: 'young', top: '#e8d9b8', bottom: '#4b5668' } });
  const person = (base: string, name: string, pos: V3, look: Record<string, Json>, lines: string[], persona: string, face: [number, number], wander = false): void => {
    b.prim(base, 'capsule', [0.56, 1.7, 0.56], [pos[0], r2(pos[1] + 0.85), pos[2]], {
      name,
      character: look as never,
      yaw: faceToward(pos[0], pos[2], face[0], face[1]),
      physics: { body: 'kinematic', sensor: true },
      behaviors: [{ type: 'npc' as const, params: { name, persona, lines, greetRadius: 4, talkInterval: 5, wander } }],
      tags: ['npc'],
    });
  };
  person('station-master', 'Mr Alder', [r2(RX + 4), 0.9, -3.5], { wardrobe: 'formal', gender: 'male', age: 'adult', top: '#2d3a4f', bottom: '#23272f', hold: 'book', mood: 'calm' }, ['The next train is on its way round. Take a turn about the valley first: the windmill, the sheep, the cottage garden. Then come back here.', 'F blows the whistle, if you want the driver to wave.'], 'a courteous station master with a pocket watch', [RX + 4, 6]);
  person('miller', 'Miller Odd', [-9, 0, -4], { wardrobe: 'worker', gender: 'male', age: 'old', top: '#d9d2c2', bottom: '#5b4d3d', mood: 'cheerful' }, ['Flour on everything, and I would not have it any other way. The wind is good today.'], 'a flour-dusted old miller', [-12, 0]);
  person('shepherd', 'Tomas', [-27, 0, 22], { wardrobe: 'villager', gender: 'male', age: 'adult', top: '#7b6a4a', bottom: '#3f3a2e', hold: 'staff', mood: 'calm' }, ['Twelve sheep, and not one of them has ever come when called.'], 'a patient shepherd', [-34, 26]);
  person('gardener', 'Elsa', [r2(14 - 3.8), 0, 11], { wardrobe: 'villager', gender: 'female', age: 'adult', top: '#9b4a52', bottom: '#4a4e5a', mood: 'cheerful' }, ['The poppies came up by themselves. I only keep the paths clear.'], 'a cheerful cottage gardener', [14, 6]);

  b.state('stops', 0);
  b.hud('stops', 'Stops / 3');
  const stops: Array<{ id: string; at: V3; r: number; text: string }> = [
    { id: 'windmill', at: [-12, 1, -3], r: 6, text: 'The windmill: the sails turn slowly in the morning wind.' },
    { id: 'sheep', at: [-31, 1, 24], r: 7, text: 'The sheep meadow: a dozen sheep and one patient shepherd.' },
    { id: 'cottage', at: [14, 1, 10], r: 6, text: 'The cottage garden: poppies, daisies and a clean path.' },
  ];
  for (const st of stops) {
    const zone = b.prim('stop-zone', 'cylinder', [st.r * 2, 4, st.r * 2], st.at, { name: `Stop: ${st.id}`, visible: false, physics: { body: 'static', sensor: true }, tags: ['stop-zone'], castShadow: false });
    b.rule({ id: `stop-${st.id}`, description: `Walking to the ${st.id} counts as a stop`, when: { on: 'enter', zone }, then: [{ do: 'message', text: st.text, duration: 4 }, { do: 'add', key: 'stops', amount: 1 }, { do: 'sound', sound: 'bell' }], once: true });
  }
  const home = b.prim('platform-goal', 'box', [3.2, 3, 7], [r2(RX + 4), 2.2, 4], { name: 'Platform', visible: false, physics: { body: 'static', sensor: true }, behaviors: [{ type: 'goal', enabled: false, params: { text: 'The little train pulls in, steaming. A good morning in the valley.' } }], tags: ['goal'], castShadow: false });
  b.rule({ id: 'platform-open', description: 'Three stops made: the platform is the goal', when: { on: 'state', key: 'stops', op: '>=', value: 3 }, then: [{ do: 'enableBehavior', target: home, behavior: 'goal', enabled: true }, { do: 'message', text: 'That is the valley. The next train is due: back to the platform.', duration: 5 }, { do: 'sound', sound: 'win' }], once: true });
  b.rule({ id: 'hint', when: { on: 'start' }, then: [{ do: 'message', text: 'Morning at the station. Talk to Mr Alder (E), then walk the valley: windmill, sheep, cottage garden. F blows the whistle.', duration: 7 }] });
  b.rule({ id: 'whistle', when: { on: 'key', key: 'f' }, then: [{ do: 'sound', sound: 'whoosh' }, { do: 'message', text: 'Toot toot!', duration: 1.5 }] });
  b.rule({ id: 'reset-key', when: { on: 'key', key: 'r' }, then: [{ do: 'reset' }] });

  b.test({ id: 'train-runs', kind: 'moves', target: engine, distance: 8, within: 4 });
  b.test({ id: 'carriages-follow', kind: 'moves', target: '#train', distance: 8, within: 4 });

  return finish(b, {
    name: 'Painterly Meadow',
    description: 'A steam train circles a wildflower valley on a summer morning.',
    intro: {
      title: 'Painterly Meadow',
      tagline: 'A summer morning, a little steam train and fifty thousand wildflowers.',
      objective: 'Walk the valley from the station: the windmill, the sheep meadow and the cottage garden, then be back on the platform for the train.',
      controls: ['WASD — walk', 'Mouse — look', 'E — talk', 'F — whistle', 'R — restart'],
      accent: '#f2b450',
    },
    plan: 'Plan: a flat valley ringed by rolling hills and mountains, an oval railway (ballast, rails), a steam engine and three carriages on patrol with a steam-puff spawner, a station, windmill, cottages, grazing sheep and cows, four people to talk to, three stops to walk to and the platform as the goal, instanced wildflowers and tall grass, morning haze.',
    message: 'Built Painterly Meadow: a steam train circling a wildflower valley on a summer morning, with a windmill, cottages and grazing animals. Press Play, walk from the station to the windmill, the sheep and the cottage garden, then back for the train; F blows the whistle.',
  });
}
