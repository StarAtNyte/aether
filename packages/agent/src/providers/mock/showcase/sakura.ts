/**
 * Sakura River Journey — paddle a canoe down a meandering river valley
 * through four seasons: a blossom tunnel of cherry trees, a green summer
 * reach with a waterfall, flaming autumn maples under a pagoda, and snowy
 * pines at the winter shrine. Floating lanterns to collect, chapter cards
 * as each season begins, petals drifting over everything.
 *
 * Built from the framework's own parts: the terrain generator's river
 * valley (riverbed along `riverMeander`), one water surface, instanced
 * scatter with hand-placed points projected onto the terrain, library
 * generators (cherry tree, torii gate, pagoda, waterfall), the vehicle
 * behaviour, collectibles, enter-zone rules and a goal.
 */
import { riverHalfWidth, riverMeander, type Json } from '@aether/core';
import { r2, type Builder, type V3 } from '../builder';
import type { MockPlan } from '../planner';
import { faceToward, finish, flagshipBuilder, glowLantern, pickup, terrainHeight } from './kit';
import { addLife } from './life';

/** Valley size (metres). */
const SIZE = 520;
/** Water surface height above the riverbed. */
const WATER_Y = 0.38;
/** Where the journey starts (z) and ends. */
const START_Z = 205;
const END_Z = -212;

const HALF = riverHalfWidth(SIZE);

function riverX(z: number): number {
  return r2(riverMeander(z, SIZE));
}

/** Points along both banks between z0 and z1 (z0 > z1), `step` metres apart, `inset`..`inset+spread` from the water. */
function bankPoints(b: Builder, z0: number, z1: number, step: number, inset: number, spread: number): V3[] {
  const pts: V3[] = [];
  for (let z = z0; z > z1; z -= step) {
    for (const side of [-1, 1]) {
      const zz = z + b.rand(-step * 0.35, step * 0.35);
      const d = HALF + inset + b.rand(0, spread);
      pts.push([r2(riverX(zz) + side * d), 0, r2(zz)]);
    }
  }
  return pts;
}

/** An instanced grove of one generator on hand-placed points, projected onto the valley. */
function grove(b: Builder, base: string, generatorId: string, params: Record<string, Json>, points: V3[], terrain: string, scale: [number, number], name: string): string {
  const { generator, params: p } = b.nature(generatorId, params);
  return b.add({
    id: b.id(base),
    name,
    transform: { position: [0, 0, 0] },
    shape: { kind: 'scatter', of: { kind: 'procedural', generator, params: p }, count: points.length, area: [SIZE, SIZE], seed: b.subSeed() % 100_000, scaleRange: scale, onSurface: terrain, points },
    tags: ['grove'],
  });
}

/** A stone plinth hiding the bank slope under a riverside building. */
function plinth(b: Builder, x: number, z: number, w: number, d: number, yaw: number): void {
  b.prim('plinth', 'box', [w, 2.2, d], [x, -0.1, z], { yaw, material: { preset: 'stone', color: '#9a948a', roughness: 0.9 }, physics: 'static' });
}

/** Plan the Sakura River Journey. */
export function sakuraRiver(): MockPlan {
  const b = flagshipBuilder(0x5a4a, { dusk: true, water: true });
  b.env({
    sky: 'sunset',
    timeOfDay: 17.25,
    sunIntensity: 2.8,
    ambientIntensity: 0.5,
    fog: { color: '#f2d3c9', density: 0.0035, visibility: 520 },
    weather: 'petals',
    bloom: 0.75,
    exposure: 1.05,
    wind: { speed: 2.4, direction: 90 },
    ground: null,
  });
  const TERRAIN: Record<string, Json> = { size: SIZE, height: 34, resolution: 220, roughness: 0.45, color: '#7aa457', variant: 4 };
  const TERRAIN_SEED = b.subSeed() % 100_000;
  const ground = terrainHeight(TERRAIN, TERRAIN_SEED, SIZE);
  const terrain = b.add({ id: b.id('valley'), name: 'River valley', shape: { kind: 'procedural', generator: 'terrain', params: TERRAIN, seed: TERRAIN_SEED }, transform: { position: [0, 0, 0] }, physics: { body: 'static', friction: 0.12 }, tags: ['terrain'] });
  b.prim('river', 'plane', [SIZE, 0.1, SIZE], [0, WATER_Y, 0], { name: 'River', material: { preset: 'water', waterKind: 'river', waterFlow: [0, -0.85], color: '#6fa9b9', opacity: 0.84, roughness: 0.03 }, castShadow: false, tags: ['water', 'river'] });

  // The canoe the player paddles (vehicle mode; it faces −Z, downstream).
  const sx = riverX(START_Z);
  const canoe = b.asset('canoe', 'canoe', [sx, 0.05, START_Z], {
    name: 'Canoe',
    yaw: faceToward(sx, START_Z, riverX(START_Z - 10), START_Z - 10) + 180,
    physics: { body: 'dynamic', mass: 120, friction: 0, linearDamping: 0.3, angularDamping: 2, lockRotation: false }, // A slippery hull on a smooth riverbed: the vehicle behaviour supplies the water's grip.
    behaviors: [{ type: 'vehicle', params: { maxSpeed: 11, acceleration: 4, brake: 6, drag: 1.2, turnRate: 70, grip: 3.5 } }],
    tags: ['canoe', 'focus'],
    fallback: { kind: 'procedural', generator: 'boat', params: { length: 4.5, variant: 0, color: '#9a6a3c' } },
  });
  b.player({ mode: 'vehicle', controls: canoe, spawn: [sx, 1, START_Z + 6], moveSpeed: 6 });

  // A lantern ferry drifting the whole river (ambient life + a verified mover).
  const ferryPath: V3[] = [];
  for (let z = START_Z - 30; z > END_Z + 20; z -= 26) ferryPath.push([r2(riverX(z) + HALF * 0.45), 0.2, z]);
  // The patrol turns its carrier's −Z axis along the river; the boat (long axis +X) rides on it turned 90°.
  const ferry = b.empty('ferry', ferryPath[0] as V3, {
    name: 'Lantern ferry',
    physics: 'kinematic',
    behaviors: [{ type: 'patrol', params: { waypoints: ferryPath, speed: 2.2, mode: 'pingpong', face: true } }],
    tags: ['ferry'],
  });
  b.gen('ferry-hull', 'boat', { length: 5.5, variant: 0, color: '#6b3f2a', accentColor: '#c0392b' }, [0, 0, 0], { parent: ferry, yaw: 90 });
  b.prim('ferry-lamp', 'sphere', [0.5, 0.5, 0.5], [0, 1.4, 0], { parent: ferry, material: { preset: 'emissive', color: '#ffd59e', emissive: '#ffb35c', emissiveIntensity: 3 }, castShadow: false });
  b.light(ferry, [0, 1.6, 0], '#ffb35c', 2, 12);

  // --- Life: measured groups along the river ----------------------------------------------------------------------
  const riverBody = { id: 'river', y: WATER_Y, minX: -SIZE / 2, maxX: SIZE / 2, minZ: -SIZE / 2, maxZ: SIZE / 2, round: false, area: SIZE * SIZE };
  addLife(b, { height: (x, z) => (Math.abs(x) < SIZE / 2 - 4 && Math.abs(z) < SIZE / 2 - 4 ? ground(x, z) : null), water: [riverBody] }, [
    { id: 'ducks', species: 'duck', count: 4, x: riverX(150), z: 150, radius: 5 },
    { id: 'ducks-far', species: 'duck', count: 3, x: riverX(20), z: 20, radius: 5 },
    { id: 'trout', species: 'fish', count: 8, x: riverX(60), z: 60, radius: 8 },
    { id: 'trout-late', species: 'fish', count: 6, x: riverX(-110), z: -110, radius: 8 },
    { id: 'songbirds', species: 'bird', count: 9, x: riverX(150) + 26, z: 150, radius: 28 },
    { id: 'blossom-birds', species: 'bird', count: 6, x: riverX(110) - 26, z: 110, radius: 22 },
    { id: 'crows', species: 'crow', count: 4, x: riverX(-170) + 20, z: -170, radius: 22 },
    { id: 'hawk', species: 'hawk', count: 1, x: 0, z: -40, radius: 90 },
    { id: 'butterflies', species: 'butterfly', count: 8, x: riverX(130) + 14, z: 130, radius: 9 },
    { id: 'deer', species: 'deer', count: 3, x: riverX(-70) - 40, z: -70, radius: 14 },
  ]);

  // --- Spring: the blossom tunnel ------------------------------------------------
  grove(b, 'cherry-grove', 'hero-cherry-tree', { height: 6.2, spread: 7.5 }, bankPoints(b, START_Z + 30, 95, 13, 2.5, 9), terrain, [0.85, 1.2], 'Cherry blossom grove');
  grove(b, 'cherry-hill', 'hero-cherry-tree', { height: 7, spread: 8 }, bankPoints(b, START_Z + 20, 110, 24, 22, 30), terrain, [0.9, 1.3], 'Cherry trees on the hills');
  // Start dock with a vermilion torii and stone lanterns.
  const dx = r2(sx + HALF + 1);
  b.gen('start-dock', 'dock', { length: 9, width: 3, height: 0.7, variant: 1 }, [dx, 0, START_Z + 2], { yaw: 180, physics: 'static', name: 'Start dock' });
  b.gen('torii', 'torii-gate', { height: 6.5 }, [r2(sx + HALF + 7), 0, START_Z + 2], { yaw: 90, physics: 'static', name: 'Torii gate' });
  for (let i = 0; i < 4; i++) glowLantern(b, [r2(sx + HALF + 4 + (i % 2) * 6), 0.3, r2(START_Z - 4 + Math.floor(i / 2) * 12)], '#ffb35c', { lit: i < 2 });
  // A tiny riverside village.
  for (let i = 0; i < 3; i++) {
    const z = 168 - i * 14;
    const x = r2(riverX(z) - HALF - 8);
    plinth(b, x, z, 8.6, 7.4, 90);
    b.gen('machiya', 'house', { width: 7, depth: 6, color: '#efe2c8', roofColor: '#3d4a52', trimColor: '#4a2f22', lights: true, variant: 2 }, [x, 1, z], { yaw: 90, physics: 'static', name: 'Riverside house' });
  }

  // Riverbanks the whole way down: grass, pebbles at the waterline, blossom flowers in spring.
  grove(b, 'bank-grass', 'grass-tuft', { size: 0.9, color: '#7fae4f', blades: 11 }, bankPoints(b, START_Z + 30, END_Z - 20, 2.6, 0.2, 7), terrain, [0.8, 1.6], 'Bank grass');
  grove(b, 'bank-stones', 'rock', { size: 1.3, color: '#8d8a80', mossy: true, variant: 3 }, bankPoints(b, START_Z + 30, END_Z - 20, 8, -1.4, 1.6), terrain, [0.6, 1.5], 'Waterline stones');
  grove(b, 'spring-flowers', 'flowers', { size: 0.7, color: '#ffd0df', centerColor: '#ffe9a8', count: 7 }, bankPoints(b, START_Z + 30, 95, 3.2, 0.6, 6), terrain, [0.8, 1.3], 'Spring flowers');

  // --- Summer: green reach and a waterfall ----------------------------------------
  grove(b, 'summer-oaks', 'tree-oak', { height: 8, color: '#4f8a3b', density: 8 }, bankPoints(b, 95, 5, 11, 3, 12), terrain, [0.8, 1.3], 'Summer oaks');
  grove(b, 'summer-bush', 'bush', { size: 1.6, color: '#5c8f3c', berries: true, berryColor: '#f4a3c0' }, bankPoints(b, 100, 0, 6, 0.8, 4), terrain, [0.8, 1.4], 'Riverside shrubs');
  const wz = 52;
  b.gen('waterfall', 'waterfall', { height: 7, waterColor: '#8cc7d8' }, [r2(riverX(wz) + HALF + 3), 0, wz], { yaw: -90, physics: 'static', name: 'Waterfall' });
  b.gen('summer-bridge', 'bridge', { length: r2(HALF * 2 + 14), width: 3.2, height: 5.5, color: '#8b5a2b', variant: 0 }, [riverX(28), 0, 28], { physics: 'static', name: 'Wooden bridge' });

  // --- Autumn: maples under the pagoda --------------------------------------------
  grove(b, 'maples', 'tree-oak', { height: 7.5, color: '#d9622b', density: 7, variant: 2 }, bankPoints(b, 0, -95, 11, 3, 12), terrain, [0.8, 1.25], 'Autumn maples');
  grove(b, 'maples-gold', 'tree-oak', { height: 6.5, color: '#e3a83a', density: 6 }, bankPoints(b, -5, -100, 17, 14, 22), terrain, [0.8, 1.2], 'Golden maples');
  const pz = -42;
  const px = r2(riverX(pz) - HALF - 12);
  plinth(b, px, pz, 15, 15, 0);
  b.gen('pagoda', 'pagoda', { tiers: 5, roofColor: '#3a4d4a', wallColor: '#e9d9bb' }, [px, 1, pz], { physics: 'static', name: 'Pagoda', tags: ['landmark'] });
  glowLantern(b, [r2(px + 7), 1, r2(pz + 7)], '#ff9d4a');
  glowLantern(b, [r2(px + 7), 1, r2(pz - 7)], '#ff9d4a');
  b.gen('autumn-bridge', 'bridge', { length: r2(HALF * 2 + 14), width: 3.6, height: 6, color: '#9a948a', variant: 1 }, [riverX(-74), 0, -74], { physics: 'static', name: 'Stone bridge' });

  // --- Winter: snowy pines and the shrine -----------------------------------------
  grove(b, 'winter-pines', 'tree-pine', { height: 9, color: '#2f5d44', snow: true, tiers: 5 }, bankPoints(b, -100, -235, 9, 2.5, 14), terrain, [0.8, 1.35], 'Snowy pines');
  grove(b, 'winter-snow', 'rock', { size: 2.2, color: '#f4f6f8', variant: 3 }, bankPoints(b, -105, -230, 7, 0.5, 6), terrain, [0.6, 1.4], 'Snow drifts');
  const gz = END_Z;
  const gx = riverX(gz);
  // The landing reaches out from the east bank, leaving the channel open to the shrine.
  b.gen('shrine-dock', 'dock', { length: 10, width: 4, height: 0.7, variant: 1 }, [r2(gx + HALF - 4), 0, r2(gz - 4)], { yaw: 180, physics: 'static', name: 'Shrine dock' });
  b.gen('shrine-torii', 'torii-gate', { height: 7.5, color: '#c8402c' }, [gx, 0, r2(gz - 8)], { physics: 'static', name: 'Shrine gate', tags: ['landmark'] });
  glowLantern(b, [r2(gx - 4), 0.3, r2(gz - 6)], '#ffcf8a');
  glowLantern(b, [r2(gx + 4), 0.3, r2(gz - 6)], '#ffcf8a');
  b.prim('journey-end', 'box', [r2(HALF * 2), 4, 8], [gx, 2, r2(gz + 4)], { name: 'Journey end', visible: false, physics: { body: 'static', sensor: true }, behaviors: [{ type: 'goal', params: { text: 'You reached the winter shrine. The river carried you through every season.' } }], tags: ['goal'] });

  // Floating lanterns to gather on the way (one every ~30 m, weaving across the river).
  const lanterns = 12;
  for (let i = 0; i < lanterns; i++) {
    const z = r2(START_Z - 24 - i * 33);
    const x = r2(riverX(z) + Math.sin(i * 1.7) * HALF * 0.55);
    pickup(b, 'river-lantern', [x, 1.1, z], { scoreKey: 'lanterns', color: '#ffb35c', size: 0.7, shape: 'box', name: 'Floating lantern', message: 'Lantern gathered', tags: ['lantern'] });
  }

  // Season chapter cards: invisible gates across the river.
  const chapters: Array<[number, string]> = [
    [START_Z - 8, 'Spring — the blossom tunnel'],
    [92, 'Summer — the green reach'],
    [-2, 'Autumn — maples under the pagoda'],
    [-98, 'Winter — the snow shrine'],
  ];
  chapters.forEach(([z, text], i) => {
    const gate = b.prim(`chapter-${i + 1}`, 'box', [r2(HALF * 2.4), 6, 3], [riverX(z), 3, r2(z)], { name: `Chapter ${i + 1}`, visible: false, physics: { body: 'static', sensor: true }, tags: ['chapter'] });
    b.rule({ id: `chapter-${i + 1}`, description: `Chapter card: ${text}`, when: { on: 'enter', zone: gate }, then: [{ do: 'message', text, duration: 4 }, { do: 'sound', sound: 'bell' }], once: true });
  });

  b.state('lanterns', 0);
  b.hud('lanterns', `Lanterns / ${lanterns}`);
  b.rule({ id: 'all-lanterns', when: { on: 'state', key: 'lanterns', op: '>=', value: lanterns }, then: [{ do: 'message', text: 'Every lantern is lit. Paddle on to the shrine.', duration: 4 }, { do: 'sound', sound: 'win' }], once: true });
  b.rule({ id: 'reset-key', when: { on: 'key', key: 'r' }, then: [{ do: 'reset' }] });

  b.test({ id: 'ferry-drifts', kind: 'moves', target: ferry, distance: 3, within: 6 });
  b.test({ id: 'canoe-afloat', kind: 'staysAbove', target: canoe, y: -0.5, within: 4 });
  b.test({ id: 'lanterns-float', kind: 'staysAbove', target: '#lantern', y: 0.6, within: 3 });
  b.test({ id: 'no-overlap', kind: 'noOverlap' });

  return finish(b, {
    name: 'Sakura River Journey',
    description: 'Paddle a canoe down a cherry-blossom river through four seasons.',
    intro: {
      title: 'Sakura River Journey',
      tagline: 'Paddle downstream through spring blossom, summer green, autumn fire and winter snow.',
      objective: `Gather the ${lanterns} floating lanterns and reach the winter shrine.`,
      controls: ['W / S — paddle', 'A / D — steer', 'R — restart', 'Esc — editor'],
      accent: '#ffb7c9',
    },
    plan: 'Plan: river valley terrain with one water surface, four seasonal groves on hand-placed instanced points, canoe vehicle, lantern ferry, 12 lantern pickups, chapter gates and a goal shrine.',
    message: 'Built Sakura River Journey: a meandering river valley through four seasons — cherry blossom, summer green with a waterfall, autumn maples under a pagoda and a snowy shrine. Press Play and paddle with W/S, steer with A/D; gather the floating lanterns on the way.',
  });
}
