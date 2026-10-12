/**
 * The default world shown on first visit: a dusk glade with a campfire,
 * tents, pine forests, distant mountains, a crate pyramid for physics and
 * five glowing gems to collect — so a judge can press Play immediately.
 * Built only from built-in generators and primitives (no external assets).
 */
import { createWorld, type EntityInput, type RuleInput, type WorldDoc, type WorldDocInput } from '@aether/core';

const GEM_SPOTS: ReadonlyArray<[number, number]> = [
  [-9, 6],
  [10, -4],
  [-3, -12],
  [14, 10],
  [-15, -6],
];

function gems(): EntityInput[] {
  return GEM_SPOTS.map(([x, z], i) => ({
    id: `gem-${i + 1}`,
    name: `Gem ${i + 1}`,
    description: 'Floating crystal shard — walk into it to collect',
    tags: ['gem', 'collectible'],
    transform: { position: [x, 1.1, z], rotation: [0, i * 37, 0], scale: [0.45, 0.45, 0.45] },
    shape: { kind: 'procedural', generator: 'crystal', params: { variant: 1, size: 1.6, color: '#8fe3ff', glow: 2.5 }, seed: 11 + i },
    behaviors: [
      { type: 'spin', params: { speed: 70 } },
      { type: 'bob', params: { amplitude: 0.18, period: 2.4, phase: i / GEM_SPOTS.length } },
      { type: 'collectible', params: { scoreKey: 'gems', value: 1, sound: 'pickup' } },
    ],
    castShadow: false,
  }));
}

function cratePyramid(): EntityInput[] {
  const out: EntityInput[] = [];
  const size = 0.8;
  const rows = [3, 2, 1];
  let n = 0;
  rows.forEach((count, row) => {
    for (let i = 0; i < count; i++) {
      n++;
      const x = 7 + (i - (count - 1) / 2) * (size + 0.02);
      out.push({
        id: `crate-${n}`,
        name: `Crate ${n}`,
        tags: ['crate'],
        transform: { position: [x, size / 2 + row * size, 4], rotation: [0, 0, 0], scale: [1, 1, 1] },
        shape: { kind: 'primitive', primitive: 'box', size: [size, size, size] },
        material: { preset: 'wood', color: '#a8794a' },
        physics: { body: 'dynamic', mass: 6, friction: 0.7, restitution: 0.05 },
      });
    }
  });
  return out;
}

const RULES: RuleInput[] = [
  {
    id: 'welcome',
    description: 'Greet the player',
    when: { on: 'start' },
    then: [{ do: 'message', text: 'Find the 5 glowing gems hidden around the glade', duration: 4 }],
  },
  {
    id: 'all-gems',
    description: 'Win once every gem is collected',
    when: { on: 'state', key: 'gems', op: '>=', value: 5 },
    then: [
      { do: 'sound', sound: 'win' },
      { do: 'win', text: 'All gems found — the glade is yours!' },
    ],
    once: true,
  },
];

const WORLD: WorldDocInput = {
  id: 'aether-glade',
  name: 'Aether Glade',
  description: 'A dusk glade with a campfire, tents, pine forests, a crate pyramid and five gems to collect.',
  seed: 7,
  environment: {
    sky: 'sunset',
    timeOfDay: 18.2,
    fog: { color: '#d9a07a', density: 0.008 },
    weather: 'fireflies',
    ambientIntensity: 0.45,
    sunIntensity: 2.2,
    ground: { material: { preset: 'grass', color: '#5f7f3a' }, size: 400 },
    bloom: 0.6,
    exposure: 1.05,
  },
  player: { mode: 'thirdPerson', spawn: [0, 1, 12], moveSpeed: 6, jumpSpeed: 6 },
  state: { gems: 0 },
  hud: [{ key: 'gems', label: 'Gems' }],
  entities: Object.fromEntries(
    (
      [
      {
        id: 'mountain-north',
        name: 'North peak',
        transform: { position: [-45, 0, -85], rotation: [0, 20, 0], scale: [1, 1, 1] },
        shape: { kind: 'procedural', generator: 'mountain', params: { size: 90, height: 42, variant: 0 }, seed: 3 },
        physics: { body: 'static' },
      },
      {
        id: 'mountain-east',
        name: 'East ridge',
        transform: { position: [60, 0, -70], rotation: [0, -35, 0], scale: [1, 1, 1] },
        shape: { kind: 'procedural', generator: 'mountain', params: { size: 80, height: 30, variant: 1 }, seed: 9 },
        physics: { body: 'static' },
      },
      {
        id: 'forest-west',
        name: 'West pines',
        tags: ['forest'],
        transform: { position: [-30, 0, -10], rotation: [0, 0, 0], scale: [1, 1, 1] },
        shape: { kind: 'scatter', of: { kind: 'procedural', generator: 'tree-pine', params: {} }, count: 46, area: [26, 60], seed: 4, scaleRange: [0.8, 1.4], minSpacing: 3.2 },
        physics: { body: 'static' },
      },
      {
        id: 'forest-east',
        name: 'East pines',
        tags: ['forest'],
        transform: { position: [32, 0, -8], rotation: [0, 0, 0], scale: [1, 1, 1] },
        shape: { kind: 'scatter', of: { kind: 'procedural', generator: 'tree-pine', params: {} }, count: 46, area: [26, 60], seed: 5, scaleRange: [0.8, 1.4], minSpacing: 3.2 },
        physics: { body: 'static' },
      },
      {
        id: 'meadow-grass',
        name: 'Meadow grass',
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        shape: { kind: 'scatter', of: { kind: 'procedural', generator: 'grass-tuft', params: {} }, count: 500, area: [44, 44], seed: 8, scaleRange: [0.7, 1.3] },
        castShadow: false,
      },
      {
        id: 'camp-clearing',
        name: 'Camp clearing',
        description: 'Trampled earth around the fire; tagged #focus so the camera frames the camp on open',
        tags: ['focus'],
        transform: { position: [2, 0.01, 1], rotation: [0, 0, 0], scale: [1, 1, 1] },
        shape: { kind: 'primitive', primitive: 'cylinder', size: [24, 0.02, 24] },
        material: { preset: 'dirt', color: '#6b5a3e', roughness: 1 },
        castShadow: false,
      },
      {
        id: 'campfire',
        name: 'Campfire',
        tags: ['fire'],
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        shape: { kind: 'procedural', generator: 'campfire', params: {}, seed: 2 },
        physics: { body: 'static' },
      },
      {
        id: 'campfire-light',
        name: 'Fire glow',
        parent: 'campfire',
        transform: { position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        light: { type: 'point', color: '#ff9a4a', intensity: 6, range: 16, castShadow: true },
        behaviors: [{ type: 'pulseLight', params: { min: 4, max: 7.5, period: 0.9 } }],
      },
      {
        id: 'tent-1',
        name: 'Canvas tent',
        tags: ['tent'],
        transform: { position: [-5, 0, -3.5], rotation: [0, 32, 0], scale: [1, 1, 1] },
        shape: { kind: 'procedural', generator: 'tent', params: {}, seed: 1 },
        physics: { body: 'static' },
      },
      {
        id: 'tent-2',
        name: 'Dome tent',
        tags: ['tent'],
        transform: { position: [5, 0, -4.5], rotation: [0, -28, 0], scale: [1, 1, 1] },
        shape: { kind: 'procedural', generator: 'tent', params: { variant: 1 }, seed: 6 },
        physics: { body: 'static' },
      },
      {
        id: 'boulder-1',
        name: 'Mossy boulder',
        tags: ['rock'],
        transform: { position: [-8, 0, 2], rotation: [0, 40, 0], scale: [1.4, 1.1, 1.3] },
        shape: { kind: 'procedural', generator: 'rock', params: {}, seed: 21 },
        physics: { body: 'static' },
      },
      {
        id: 'boulder-2',
        name: 'Boulder',
        tags: ['rock'],
        transform: { position: [11, 0, -9], rotation: [0, 110, 0], scale: [2, 1.6, 1.8] },
        shape: { kind: 'procedural', generator: 'rock', params: {}, seed: 22 },
        physics: { body: 'static' },
      },
      {
        id: 'ball',
        name: 'Heavy ball',
        description: 'Push it into the crates',
        tags: ['ball'],
        transform: { position: [7, 0.5, 9], rotation: [0, 0, 0], scale: [1, 1, 1] },
        shape: { kind: 'primitive', primitive: 'sphere', size: [1, 1, 1] },
        material: { preset: 'metal', color: '#c9ccd6', roughness: 0.25 },
        physics: { body: 'dynamic', mass: 40, friction: 0.5, restitution: 0.2 },
      },
      ...cratePyramid(),
      ...gems(),
      ] satisfies EntityInput[]
    ).map((e): [string, EntityInput] => [e.id, e]),
  ),
  rules: RULES,
  tests: [
    { id: 'crates-stable', kind: 'stable', target: '#crate', seconds: 3, maxDrift: 0.15 },
    { id: 'ball-stays', kind: 'staysAbove', target: 'ball', y: -1, within: 6 },
  ],
};

/** A fresh copy of the starter world (validated). */
export function createStarterWorld(): WorldDoc {
  return createWorld(WORLD);
}
