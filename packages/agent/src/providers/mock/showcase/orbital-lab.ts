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
import { finish, flagshipBuilder, onCircle, pickup } from './kit';

const GRAVITY = -3.2;
const DECK = 0.6;

/** A cylindrical module pod with glowing bands; returns its roof height. */
function pod(b: Builder, x: number, z: number, h: number, name: string, color: string): number {
  const id = b.prim('pod', 'cylinder', [6, h, 6], [x, r2(DECK + h / 2), z], { name, material: { preset: 'metal', color: '#d9dde3', roughness: 0.35, metalness: 0.6 }, physics: 'static', tags: ['pod'] });
  for (const y of [-h / 2 + 0.8, h / 2 - 0.5]) b.prim('pod-band', 'cylinder', [6.08, 0.25, 6.08], [0, r2(y), 0], { parent: id, material: { preset: 'neon', color, emissive: color, emissiveIntensity: 1.6 }, castShadow: false });
  b.prim('pod-window', 'box', [2.2, 0.8, 0.2], [0, 0.4, 3.02], { parent: id, material: { preset: 'emissive', color: '#bfe8ff', emissive: '#7fd4ff', emissiveIntensity: 1.2 }, castShadow: false });
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
    fog: null,
    weather: 'clear',
    bloom: 1.1,
    exposure: 1.05,
    ground: null,
    gravity: [0, GRAVITY, 0],
  });

  // --- The deck: a ring station around the reactor -------------------------------------------
  b.prim('deck', 'cylinder', [44, 1.2, 44], [0, 0, 0], { name: 'Main deck', material: { preset: 'metal', color: '#8a929e', roughness: 0.45, metalness: 0.7 }, physics: 'static', tags: ['deck'] });
  b.prim('deck-ring', 'torus', [46, 1.2, 46], [0, 0.1, 0], { rot: [90, 0, 0], material: { preset: 'neon', color: '#4cc9f0', emissive: '#4cc9f0', emissiveIntensity: 1.2 }, castShadow: false });
  for (let i = 0; i < 16; i++) {
    const [x, , z] = onCircle(0, 0, 18, (i / 16) * Math.PI * 2);
    b.prim('deck-light', 'box', [0.5, 0.06, 1.6], [x, r2(DECK + 0.03), z], { yaw: r2((-i / 16) * 360), material: { preset: 'emissive', color: '#e9f6ff', emissive: '#bfe8ff', emissiveIntensity: 1.5 }, castShadow: false });
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
  const podDefs: Array<[number, number, string, string]> = [[0, 2.2, 'Habitat', '#ff8fab'], [Math.PI * 0.5, 4.2, 'Greenhouse', '#3ddc97'], [Math.PI, 3, 'Workshop', '#ffd166'], [Math.PI * 1.5, 4, 'Observatory', '#9b5dff']];
  for (const [a, h, name, color] of podDefs) {
    const [x, , z] = onCircle(0, 0, 13, a);
    roofs.push({ x, z, y: pod(b, x, z, h, name, color) });
  }
  // Greenhouse plants glow behind its window.
  b.scatter('greenhouse-plants', 'bush', { size: 0.9, color: '#3ddc97' }, 10, [4, 4], [roofs[1]?.x ?? 0, roofs[1]?.y ?? 0, roofs[1]?.z ?? 0], { minSpacing: 0.9 });

  // --- Machines driven by joint motors ----------------------------------------------------------------
  // A slewing crane: a long arm on a revolute joint with a motor (its far end sweeps the deck).
  const mast = b.prim('crane-mast', 'cylinder', [0.8, 8.2, 0.8], [-17, r2(DECK + 4.1), 6], { material: { preset: 'metal', color: '#f2b84b', roughness: 0.4, metalness: 0.5 }, physics: 'static' });
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
  b.prim('gantry', 'box', [6, 0.5, 3], [17.6, r2(DECK + 9.25), 9], { name: 'Gantry', material: { preset: 'metal', color: '#8a929e' }, physics: 'static' });
  b.prim('gantry-post', 'box', [0.4, 9, 0.4], [20.2, r2(DECK + 4.5), 9], { material: { preset: 'metal', color: '#3a404a' }, physics: 'static' });

  // --- Robot guide and the power cells ----------------------------------------------------------------
  b.gen('robot', 'robot', { color: '#4f91a8', eyeColor: '#7dffda', height: 2.2 }, [3, DECK, 9], {
    name: 'Unit K-7',
    yaw: 200,
    physics: 'kinematic',
    behaviors: [{ type: 'npc', params: { name: 'K-7', persona: 'a cheerful maintenance robot', lines: ['Hello, engineer! The reactor tripped and five power cells floated off.', 'Gravity is low up here — hold Space and you will bound like a moon rabbit.', 'One cell sits on the gantry. Ride the cargo lift.', 'Bring all five home, then touch the reactor.'], greetRadius: 5, talkInterval: 4.5, wander: false } }],
    tags: ['npc', 'focus'],
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
  b.prim('planet', 'sphere', [520, 520, 520], [180, -340, -420], { name: 'Planet', material: { preset: 'plastic', color: '#2d63c8', roughness: 0.8, emissive: '#16346e', emissiveIntensity: 0.5 }, castShadow: false, tags: ['backdrop'] });
  b.prim('planet-ring', 'torus', [760, 6, 760], [180, -340, -420], { rot: [72, 0, 18], material: { preset: 'plastic', color: '#d9c7a1', emissive: '#6b5a3a', emissiveIntensity: 0.4, opacity: 0.7 }, castShadow: false, tags: ['backdrop'] });
  b.prim('moon', 'sphere', [60, 60, 60], [-260, 120, -380], { name: 'Moon', material: { preset: 'stone', color: '#b8b4ae', emissive: '#3a3836', emissiveIntensity: 0.4 }, castShadow: false, tags: ['backdrop'] });
  for (let i = 0; i < 14; i++) {
    const [x, , z] = onCircle(0, 0, b.rand(60, 110), b.rand(0, Math.PI * 2));
    b.gen('asteroid', 'rock', { size: r2(b.rand(2, 7)), color: '#7d746a', variant: b.int(0, 3) }, [x, r2(b.rand(-30, 30)), z], { castShadow: false, tags: ['backdrop'], behaviors: [{ type: 'spin', params: { axis: [0.3, 1, 0.2], speed: r2(b.rand(4, 14)) } }] });
  }
  b.prim('void-catch', 'box', [400, 2, 400], [0, -8, 0], { visible: false, physics: { body: 'static', sensor: true }, behaviors: [{ type: 'hazard', params: { mode: 'respawn', cooldown: 0.5 } }] });

  // --- Rules ------------------------------------------------------------------------------------------
  b.player({ mode: 'thirdPerson', spawn: [0, r2(DECK + 0.4), 8.5], moveSpeed: 5.5, jumpSpeed: 6 });
  b.state('cells', 0);
  b.hud('cells', 'Power cells / 5');
  b.rule({ id: 'hint', when: { on: 'start' }, then: [{ do: 'message', text: 'Low gravity! Talk to K-7, then find the five power cells.', duration: 4 }] });
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
    plan: 'Plan: a ring station deck in low gravity with a reactor (goal unlocked by a rule), four module pods, motor-driven machines on revolute joints (slewing crane, centrifuge, solar array), a spinning dish, a cargo lift, a robot guide, five power cells, a planet with a ring, a moon and asteroids.',
    message: 'Built Orbital Lab: a low-gravity station above a blue planet with motor-driven machines. Press Play, talk to K-7, bound across the pods and the cargo lift to recover five power cells, then touch the reactor.',
  });
}
