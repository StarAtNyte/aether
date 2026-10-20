/**
 * Orbital Lab — a research station drifting above a blue planet. Low
 * gravity turns every step into a bound; motor-driven machines keep the lab
 * alive (a slewing crane, a spinning centrifuge, solar wings that track the
 * sun, a satellite dish, a lift). Five power cells have broken loose: bound
 * between the pods and the lift, bring them all back, then touch the
 * reactor to restart the station.
 */
import { r2, type Builder, type V3 } from '../builder';
import type { MockPlan } from '../planner';
import { finish, flagshipBuilder, onCircle, pickup, planetMesh } from './kit';

const GRAVITY = -3.2;
const DECK = 0.6;

// Painted composite plating (satin white), not chrome: a chrome-looking sphere reads as a toy ball.
const HULL = { preset: 'metal' as const, finish: 'brushed-metal' as const, color: '#dde1e6', roughness: 0.52, metalness: 0.22 };
const DARK = { preset: 'metal' as const, finish: 'black-metal' as const, color: '#2c323b', roughness: 0.45 };

/** A cylindrical module pod: plated hull, glowing bands, a ring of portholes, a roof dome with an antenna and a hatch. Returns its roof height. */
function pod(b: Builder, x: number, z: number, h: number, name: string, color: string): number {
  // The hatch (local +z) faces the reactor.
  const id = b.prim('pod', 'cylinder', [6, h, 6], [x, r2(DECK + h / 2), z], { yaw: r2((Math.atan2(-x, -z) * 180) / Math.PI), name, material: HULL, physics: 'static', tags: ['pod'] });
  for (const y of [-h / 2 + 0.8, h / 2 - 0.5]) b.prim('pod-band', 'cylinder', [6.08, 0.25, 6.08], [0, r2(y), 0], { parent: id, material: { preset: 'neon', color, emissive: color, emissiveIntensity: 1.6 }, castShadow: false });
  // A plating seam every metre of height.
  for (let y = -h / 2 + 1.6; y < h / 2 - 0.9; y += 1.1) b.prim('pod-seam', 'cylinder', [6.03, 0.04, 6.03], [0, r2(y), 0], { parent: id, material: DARK, castShadow: false });
  // Portholes around the hull (a ring at head height), one wide viewport on the hatch side.
  const ph = Math.min(h / 2 - 1.2, 0.9);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    if (Math.abs(Math.sin(a)) < 0.45 && Math.cos(a) > 0) continue;
    b.prim('porthole', 'box', [0.7, 0.7, 0.12], [r2(Math.sin(a) * 3.0), r2(ph), r2(Math.cos(a) * 3.0)], { parent: id, yaw: r2((a * 180) / Math.PI), material: { preset: 'emissive', color: '#bfe8ff', emissive: '#7fd4ff', emissiveIntensity: 1.1 }, castShadow: false });
  }
  const hatch = b.prim('pod-hatch', 'box', [1.5, 2.1, 0.22], [0, r2(-h / 2 + 1.05), 3.02], { parent: id, material: DARK });
  b.prim('pod-hatch-light', 'box', [1.1, 0.14, 0.05], [0, 0.82, 0.13], { parent: hatch, material: { preset: 'neon', color, emissive: color, emissiveIntensity: 2.2 }, castShadow: false });
  b.prim('pod-dome', 'sphere', [5.4, 0.7, 5.4], [0, r2(h / 2 + 0.1), 0], { parent: id, material: HULL });
  b.prim('pod-antenna', 'cylinder', [0.08, 2.4, 0.08], [1.4, r2(h / 2 + 1.5), 0.4], { parent: id, material: DARK, castShadow: false });
  b.prim('pod-beacon', 'sphere', [0.22, 0.22, 0.22], [1.4, r2(h / 2 + 2.7), 0.4], { parent: id, material: { preset: 'emissive', color, emissive: color, emissiveIntensity: 3 }, castShadow: false, behaviors: [{ type: 'pulseLight', params: { min: 0.4, max: 3.4, period: 1.6, property: 'material.emissiveIntensity' } }] });
  return r2(DECK + h);
}

/** Plan Orbital Lab. */
export function orbitalLab(): MockPlan {
  const b = flagshipBuilder(0x0b17, { lowGravity: true });
  b.env({
    sky: 'space',
    timeOfDay: 10,
    sunIntensity: 3.4,
    ambientIntensity: 0.35,
    fog: { color: '#141c3a', density: 0.0014 },
    weather: 'clear',
    bloom: 1.1,
    exposure: 1.05,
    ground: null,
    gravity: [0, GRAVITY, 0],
  });

  // --- The deck: a ring station around the reactor -------------------------------------------
  b.prim('deck', 'cylinder', [44, 1.2, 44], [0, 0, 0], { name: 'Main deck', material: { preset: 'metal', finish: 'brushed-metal', color: '#6b7380', roughness: 0.55, metalness: 0.5 }, physics: 'static', tags: ['deck'] });
  // Deck plating: radial seams, two inlaid rings, hazard-yellow lift pads and a safety rail around the rim.
  for (let i = 0; i < 24; i++) b.prim('deck-seam', 'box', [0.07, 0.02, 21.4], [0, r2(DECK + 0.005), 0], { yaw: r2((i / 24) * 360), material: DARK, castShadow: false });
  for (const r of [7.5, 15.5]) b.prim('deck-inlay', 'torus', [r * 2, 0.12, r * 2], [0, r2(DECK + 0.01), 0], { rot: [90, 0, 0], material: DARK, castShadow: false });
  for (let i = 0; i < 48; i++) {
    const [x, , z] = onCircle(0, 0, 21.4, (i / 48) * Math.PI * 2);
    b.prim('rail-post', 'cylinder', [0.1, 1.1, 0.1], [x, r2(DECK + 0.55), z], { material: { preset: 'metal', color: '#e8b830', roughness: 0.4 }, castShadow: false });
  }
  b.prim('rail', 'torus', [42.8, 0.07, 42.8], [0, r2(DECK + 1.1), 0], { rot: [90, 0, 0], material: { preset: 'metal', color: '#e8b830', roughness: 0.4 }, castShadow: false });
  b.prim('lift-pad-hazard', 'box', [4.4, 0.03, 4.4], [13, r2(DECK + 0.015), 9], { material: { preset: 'plastic', color: '#e8b830', roughness: 0.5 }, castShadow: false });
  b.prim('deck-ring', 'torus', [45.4, 0.5, 45.4], [0, 0.1, 0], { rot: [90, 0, 0], material: { preset: 'neon', color: '#4cc9f0', emissive: '#4cc9f0', emissiveIntensity: 1.0 }, castShadow: false });
  for (let i = 0; i < 16; i++) {
    const [x, , z] = onCircle(0, 0, 18, (i / 16) * Math.PI * 2);
    b.prim('deck-light', 'box', [0.22, 0.04, 1.1], [x, r2(DECK + 0.02), z], { yaw: r2((-i / 16) * 360), material: { preset: 'emissive', color: '#e9f6ff', emissive: '#bfe8ff', emissiveIntensity: 0.9 }, castShadow: false });
  }
  // The reactor in the middle: a crystal core inside a ring frame.
  const reactor = b.prim('reactor', 'cylinder', [4.4, 1.2, 4.4], [0, r2(DECK + 0.6), 0], {
    name: 'Reactor',
    material: { preset: 'metal', color: '#3a404a', roughness: 0.3, metalness: 0.8 },
    physics: 'static',
    behaviors: [{ type: 'goal', enabled: false, params: { text: 'Reactor online. The station hums back to life — welcome home.', margin: 1.2 } }],
    tags: ['reactor', 'landmark'],
  });
  const core = b.gen('reactor-core', 'crystal', { size: 3, color: '#7fd4ff', glow: 0.6, count: 5, variant: 0 }, [0, 0.6, 0], { parent: reactor, castShadow: false });
  const coreLight = b.light(reactor, [0, 2.6, 0], '#7fd4ff', 0.6, 22);
  b.gen('reactor-halo', 'portal', { size: 5.2, color: '#5a6170', glowColor: '#4cc9f0', variant: 1 }, [0, r2(DECK + 1.2), 0], { rot: [90, 0, 0], castShadow: false, behaviors: [{ type: 'spin', params: { axis: [0, 0, 1], speed: 25 } }] });

  // --- Pods (the cells hide on and between them) ----------------------------------------------------
  const roofs: Array<{ x: number; z: number; y: number }> = [];
  const podDefs: Array<[number, number, string, string]> = [[0, 2.2, 'Habitat', '#ff8fab'], [Math.PI * 0.5 + 0.62, 4.2, 'Greenhouse', '#3ddc97'], [Math.PI, 3, 'Workshop', '#ffd166'], [Math.PI * 1.5, 4, 'Observatory', '#9b5dff']];
  for (const [a, h, name, color] of podDefs) {
    const [x, , z] = onCircle(0, 0, 13, a);
    roofs.push({ x, z, y: pod(b, x, z, h, name, color) });
  }
  // Greenhouse plants glow behind its window.
  b.scatter('greenhouse-plants', 'bush', { size: 0.9, color: '#3ddc97' }, 10, [4, 4], [roofs[1]?.x ?? 0, roofs[1]?.y ?? 0, roofs[1]?.z ?? 0], { minSpacing: 0.9 });

  // --- Machines driven by joint motors ----------------------------------------------------------------
  // A slewing crane: a long arm on a revolute joint with a motor (its far end sweeps the deck).
  const mast = b.prim('crane-mast', 'cylinder', [0.8, 8.85, 0.8], [-17, r2(DECK + 4.425), 6], { material: { preset: 'metal', color: '#f2b84b', roughness: 0.4, metalness: 0.5 }, physics: 'static' });
  void mast;
  b.prim('crane-arm', 'box', [10, 0.6, 0.6], [-12, r2(DECK + 9.2), 6], {
    name: 'Crane arm',
    material: { preset: 'metal', color: '#f2b84b', roughness: 0.4, metalness: 0.5 },
    physics: { body: 'dynamic', mass: 200, gravityScale: 0, angularDamping: 0.2 },
    joint: { type: 'revolute', target: 'world', anchor: [-5, 0, 0], targetAnchor: [-17, r2(DECK + 9.2), 6], axis: [0, 1, 0], motor: { targetVelocity: 12, maxForce: 50000, damping: 10 } },
    tags: ['machine', 'crane'],
  });
  // A centrifuge: a ring on a vertical axle spinning fast.
  const centrifuge = b.prim('centrifuge', 'torus', [7, 0.5, 7], [17, r2(DECK + 3), -6], {
    name: 'Centrifuge',
    rot: [90, 0, 0],
    material: { preset: 'metal', color: '#c9ced6', roughness: 0.3, metalness: 0.8 },
    physics: { body: 'dynamic', mass: 80, gravityScale: 0, angularDamping: 0.05 },
    joint: { type: 'revolute', target: 'world', anchor: [0, 0, 0], targetAnchor: [17, r2(DECK + 3), -6], axis: [0, 0, 1], motor: { targetVelocity: 90, maxForce: 20000, damping: 5 } },
    tags: ['machine'],
  });
  b.prim('centrifuge-pod', 'sphere', [1, 1, 1], [3.4, 0, 0], { parent: centrifuge, material: { preset: 'neon', color: '#ff8fab', emissive: '#ff8fab', emissiveIntensity: 2 }, castShadow: false });
  b.prim('centrifuge-axle', 'cylinder', [0.5, 3, 0.5], [17, r2(DECK + 1.5), -6], { material: { preset: 'metal', color: '#3a404a' }, physics: 'static' });
  // Solar wings on a slowly turning mast.
  const wings = b.prim('solar-hub', 'box', [1.2, 1.2, 1.2], [6, r2(DECK + 12), -20], {
    name: 'Solar array',
    material: { preset: 'metal', color: '#3a404a' },
    physics: { body: 'dynamic', mass: 120, gravityScale: 0, angularDamping: 0.5 },
    joint: { type: 'revolute', target: 'world', anchor: [0, 0, 0], targetAnchor: [6, r2(DECK + 12), -20], axis: [0, 1, 0], motor: { targetVelocity: 6, maxForce: 30000, damping: 10 } },
    tags: ['machine'],
  });
  for (const side of [-1, 1]) b.prim('solar-wing', 'box', [9, 0.12, 3.4], [r2(side * 5.4), 0, 0], { parent: wings, material: { preset: 'glass', color: '#1d3a8a', roughness: 0.15, metalness: 0.6, emissive: '#10204a', emissiveIntensity: 0.4 } });
  b.prim('solar-mast', 'cylinder', [0.6, 11.4, 0.6], [6, r2(DECK + 5.7), -20], { material: { preset: 'metal', color: '#c9ced6' }, physics: 'static' });
  b.gen('dish', 'satellite-dish', { diameter: 7, tilt: 40, color: '#e6e9ee' }, [-12, DECK, -15], { physics: 'static', name: 'Deep-space dish', behaviors: [{ type: 'spin', params: { axis: [0, 1, 0], speed: 6 } }] });
  // The cargo lift: up to a gantry where one cell waits.
  const lift = b.prim('cargo-lift', 'box', [3, 0.4, 3], [13, r2(DECK + 0.2), 9], { name: 'Cargo lift', material: { preset: 'metal', color: '#3a404a', emissive: '#4cc9f0', emissiveIntensity: 0.3 }, physics: 'kinematic', behaviors: [{ type: 'patrol', params: { waypoints: [[0, 0, 0], [0, 9, 0]], relative: true, speed: 1.8, mode: 'pingpong', wait: 2, face: false } }], tags: ['lift'] });
  void lift;
  const YELLOW = { preset: 'metal' as const, color: '#e8b830', roughness: 0.42, metalness: 0.45 };
  b.prim('gantry', 'box', [6, 0.5, 3], [17.6, r2(DECK + 9.25), 9], { name: 'Gantry', material: { preset: 'metal', finish: 'brushed-metal', color: '#aab3be' }, physics: 'static' });
  b.prim('gantry-edge', 'box', [6.1, 0.08, 3.1], [17.6, r2(DECK + 9.52), 9], { material: { preset: 'plastic', color: '#e8b830' }, castShadow: false });
  for (const [px, pz] of [[20.2, 7.7], [20.2, 10.3], [15.2, 7.7], [15.2, 10.3]] as const) b.prim('gantry-post', 'box', [0.26, 9, 0.26], [px, r2(DECK + 4.5), pz], { material: { preset: 'metal', finish: 'black-metal', color: '#4b5360', roughness: 0.5 }, physics: 'static' });
  for (const pz of [7.7, 10.3]) {
    b.prim('gantry-brace', 'box', [0.1, 0.1, 5.6], [17.7, r2(DECK + 4.6), pz], { rot: [0, 0, 36], material: { preset: 'metal', color: '#4b5360' }, castShadow: false });
    b.prim('gantry-brace', 'box', [0.1, 0.1, 5.6], [17.7, r2(DECK + 4.6), pz], { rot: [0, 0, -36], material: { preset: 'metal', color: '#4b5360' }, castShadow: false });
  }
  for (const pz of [7.55, 10.45]) b.prim('gantry-rail', 'box', [6, 0.06, 0.06], [17.6, r2(DECK + 10.35), pz], { material: YELLOW, castShadow: false });
  b.prim('gantry-beacon', 'sphere', [0.3, 0.3, 0.3], [20.2, r2(DECK + 9.7), 9], { material: { preset: 'emissive', color: '#ff7a2b', emissive: '#ff7a2b', emissiveIntensity: 3 }, castShadow: false, behaviors: [{ type: 'pulseLight', params: { min: 0.4, max: 3.4, period: 1.2, property: 'material.emissiveIntensity' } }] });

  // --- The crew and the power cells ----------------------------------------------------------------
  // The station's crew are people: Chief Okafor (engineer, in white coveralls) greets you at the airlock, Dr. Lin keeps the observatory.
  const crewLook = (gender: 'male' | 'female', top: string): NonNullable<Parameters<Builder['prim']>[4]>['character'] => ({ wardrobe: 'worker', gender, top, bottom: '#dfe4ea', mood: 'cheerful', scale: 1 });
  b.prim('crew-okafor', 'capsule', [0.56, 1.7, 0.56], [3, r2(DECK + 0.85), 9], {
    name: 'Chief Okafor',
    yaw: 200,
    character: { ...crewLook('male', '#f1f3f5'), hold: 'book' },
    physics: 'kinematic',
    behaviors: [{ type: 'npc', params: { name: 'Chief Okafor', persona: 'a cheerful station engineer in white coveralls', lines: ['Welcome aboard! The reactor tripped and five power cells floated off.', 'Gravity is low up here: hold Space and you will bound like a moon rabbit.', 'One cell sits on the gantry. Ride the cargo lift.', 'Bring all five home, then touch the reactor.'], greetRadius: 5, talkInterval: 4.5, wander: false } }],
    tags: ['npc', 'focus'],
  });
  const lin = onCircle(0, 0, 9.5, Math.PI * 1.5 + 0.55);
  b.prim('crew-lin', 'capsule', [0.56, 1.7, 0.56], [lin[0], r2(DECK + 0.85), lin[2]], {
    name: 'Dr. Lin',
    yaw: r2((Math.atan2(-lin[0], -lin[2]) * 180) / Math.PI),
    character: crewLook('female', '#cfe3f2'),
    physics: 'kinematic',
    behaviors: [{ type: 'npc', params: { name: 'Dr. Lin', persona: 'a calm astronomer who keeps the observatory', lines: ['The planet below is why we are here. Look at it for a moment.', 'The cells glow green: you can spot them from the pod roofs.'], greetRadius: 4, talkInterval: 5, wander: false } }],
    tags: ['npc'],
  });
  const cells: V3[] = [
    [-6, r2(DECK + 1.3), 8],
    [roofs[0]?.x ?? 0, r2((roofs[0]?.y ?? 0) + 1.3), roofs[0]?.z ?? 0],
    [roofs[3]?.x ?? 0, r2((roofs[3]?.y ?? 0) + 1.3), roofs[3]?.z ?? 0],
    [18.6, r2(DECK + 10.8), 9],
    [roofs[2]?.x ?? 0, r2((roofs[2]?.y ?? 0) + 1.3), roofs[2]?.z ?? 0],
  ];
  cells.forEach((p) => pickup(b, 'power-cell', p, { scoreKey: 'cells', color: '#7dffda', size: 0.8, shape: 'cylinder', name: 'Power cell', message: 'Power cell recovered', tags: ['cell'] }));

  // --- Space: the planet, its ring, a moon and drifting rocks ------------------------------------------
  planetMesh(b, { id: 'planet', name: 'Planet', center: [180, -340, -420], radius: 260, seed: 0x0b17, tags: ['backdrop'] });
  b.prim('planet-atmosphere', 'sphere', [548, 548, 548], [180, -340, -420], { material: { preset: 'emissive', color: '#5fa8ff', emissive: '#4f9bff', emissiveIntensity: 0.9, opacity: 0.12 }, castShadow: false, tags: ['backdrop'] });
  b.prim('planet-ring', 'torus', [760, 6, 760], [180, -340, -420], { rot: [72, 0, 18], material: { preset: 'plastic', color: '#d9c7a1', emissive: '#6b5a3a', emissiveIntensity: 0.4, opacity: 0.7 }, castShadow: false, tags: ['backdrop'] });
  b.prim('moon', 'sphere', [60, 60, 60], [-260, 120, -380], { name: 'Moon', material: { preset: 'plastic', color: '#aaa6a0', roughness: 0.95, emissive: '#34322f', emissiveIntensity: 0.4 }, castShadow: false, tags: ['backdrop'] });
  for (let i = 0; i < 14; i++) {
    const [x, , z] = onCircle(0, 0, b.rand(60, 110), b.rand(0, Math.PI * 2));
    b.gen('asteroid', 'rock', { size: r2(b.rand(2, 7)), color: '#7d746a', variant: b.int(0, 3) }, [x, r2(b.rand(-30, 30)), z], { castShadow: false, tags: ['backdrop'], behaviors: [{ type: 'spin', params: { axis: [0.3, 1, 0.2], speed: r2(b.rand(4, 14)) } }] });
  }
  b.prim('void-catch', 'box', [400, 2, 400], [0, -8, 0], { visible: false, physics: { body: 'static', sensor: true }, behaviors: [{ type: 'hazard', params: { mode: 'respawn', cooldown: 0.5 } }] });

  // --- Rules ------------------------------------------------------------------------------------------
  b.player({ mode: 'thirdPerson', spawn: [0, r2(DECK + 0.4), 8.5], moveSpeed: 5.5, jumpSpeed: 6 });
  b.state('cells', 0);
  b.hud('cells', 'Power cells / 5');
  b.rule({ id: 'hint', when: { on: 'start' }, then: [{ do: 'message', text: 'Low gravity! Talk to Chief Okafor, then find the five power cells.', duration: 4 }] });
  b.rule({
    id: 'reactor-ready',
    when: { on: 'state', key: 'cells', op: '>=', value: 5 },
    then: [
      { do: 'enableBehavior', target: reactor, behavior: 'goal', enabled: true },
      { do: 'setProperty', target: coreLight, path: 'light.intensity', value: 4 },
      { do: 'setProperty', target: core, path: 'material.emissiveIntensity', value: 4 },
      { do: 'message', text: 'All cells loaded. Touch the reactor!', duration: 4 },
      { do: 'sound', sound: 'bell' },
    ],
    once: true,
  });
  b.rule({ id: 'reset-key', when: { on: 'key', key: 'r' }, then: [{ do: 'reset' }] });

  b.test({ id: 'crane-slews', kind: 'moves', target: '#crane', distance: 2, within: 6 });
  b.test({ id: 'lift-runs', kind: 'moves', target: '#lift', distance: 2, within: 6 });
  b.test({ id: 'cells-float', kind: 'staysAbove', target: '#cell', y: 1, within: 3 });
  b.test({ id: 'machines-hold', kind: 'staysAbove', target: '#machine', y: 1, within: 6 });

  return finish(b, {
    name: 'Orbital Lab',
    description: 'A low-gravity research station above a blue planet: recover five power cells.',
    intro: {
      title: 'Orbital Lab',
      tagline: 'Low gravity, humming machines and a blue planet filling the sky.',
      objective: 'Bound across the station, recover the five power cells and restart the reactor.',
      controls: ['WASD — move', 'Space — bound', 'Mouse — look', 'R — restart', 'Esc — editor'],
      accent: '#4cc9f0',
    },
    plan: 'Plan: a ring station deck in low gravity with a reactor (goal unlocked by a rule), four module pods, motor-driven machines on revolute joints (slewing crane, centrifuge, solar array), a spinning dish, a cargo lift, two crew members, five power cells, a planet with a ring, a moon and asteroids.',
    message: 'Built Orbital Lab: a low-gravity station above a blue planet with motor-driven machines. Press Play, talk to Chief Okafor, bound across the pods and the cargo lift to recover five power cells, then touch the reactor.',
  });
}
