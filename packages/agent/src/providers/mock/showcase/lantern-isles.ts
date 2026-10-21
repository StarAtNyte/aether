/**
 * Lantern Isles — a third-person exploration game on floating islands at
 * golden hour. A guide on the home island explains the goal; wooden bridges
 * and rune lifts link seven islands climbing into the sky; twelve paper
 * lanterns hang among the trees; every island is a checkpoint, and a fall
 * returns you to the last one. Light all twelve and the Great Lantern on
 * the summit awakens — touch it to win.
 */
import { r2, type Builder, type V3 } from '../builder';
import type { MockPlan } from '../planner';
import { faceToward, finish, flagshipBuilder, glowLantern, onCircle, pickup } from './kit';
import { addLife } from './life';

/** One floating island: a flat grassy top at `top` with radius `r`. */
interface Isle {
  x: number;
  z: number;
  r: number;
  top: number;
  id: string;
}

/** How an island is reached from the previous one. */
type Link = 'bridge' | 'lift';

/** The island chain: radius, link from the previous island, height gain, heading change (radians). */
const CHAIN: ReadonlyArray<{ r: number; link: Link; rise: number; turn: number }> = [
  { r: 8, link: 'bridge', rise: 0, turn: -0.55 },
  { r: 8, link: 'lift', rise: 6, turn: -0.75 },
  { r: 9, link: 'bridge', rise: 0, turn: -0.65 },
  { r: 7, link: 'lift', rise: 6, turn: -0.7 },
  { r: 8, link: 'bridge', rise: 0, turn: -0.6 },
  { r: 10, link: 'lift', rise: 6, turn: -0.7 },
];

const BRIDGE_GAP = 7;
const LIFT_GAP = 2.6;
const LIFT_SIZE = 2.2;

/** Grass cap, soil band and a rock cone hanging below: a floating island with a flat top at `top`. */
function island(b: Builder, name: string, x: number, z: number, r: number, top: number): Isle {
  const id = b.prim('isle', 'cylinder', [r2(r * 2), 0.7, r2(r * 2)], [x, r2(top - 0.35), z], { name, material: { preset: 'grass', color: '#86b35a', roughness: 0.95 }, physics: 'static', tags: ['island'] });
  b.prim(`${id}-soil`, 'cylinder', [r2(r * 1.9), 1.8, r2(r * 1.9)], [x, r2(top - 1.6), z], { material: { preset: 'dirt', color: '#7a5636' }, physics: 'static' });
  b.prim(`${id}-rock`, 'cone', [r2(r * 1.8), r2(r * 1.5), r2(r * 1.8)], [x, r2(top - 2.5 - r * 0.75), z], { rot: [180, r2(b.rand(0, 360)), 0], material: { preset: 'stone', color: '#8a7f72', flatShading: true }, physics: 'static' });
  // Boulders clinging to the underside.
  for (let i = 0; i < 3; i++) {
    const [rx, , rz] = onCircle(x, z, r * b.rand(0.35, 0.7), b.rand(0, Math.PI * 2));
    // The boulders cling upside down under the island, away from the sun: a plain rock reads better there than a lichen-topped one.
    b.realisticNature = false;
    b.gen('isle-boulder', 'rock', { size: r2(r * b.rand(0.35, 0.55)), color: '#7b7166', mossy: true, variant: 2 }, [rx, r2(top - 3 - r * b.rand(0.3, 0.9)), rz], { rot: [180, r2(b.rand(0, 360)), 0], castShadow: false });
    b.realisticNature = true;
  }
  return { x, z, r, top, id };
}

/** Grass, flowers and a couple of trees on an island (keeping a clear walking ring). */
function dress(b: Builder, isle: Isle, trees: number, palette: { leaf: string; flower: string }): void {
  b.scatter('isle-grass', 'grass-tuft', { size: 0.7, color: '#9cc76a', blades: 10 }, Math.round(isle.r * isle.r * 2.2), [r2(isle.r * 1.6), r2(isle.r * 1.6)], [isle.x, isle.top, isle.z], { minSpacing: 0.45, scaleRange: [0.7, 1.4] });
  b.scatter('isle-flowers', 'flowers', { size: 0.6, color: palette.flower, centerColor: '#fff2b0', count: 6 }, Math.round(isle.r * 2), [r2(isle.r * 1.4), r2(isle.r * 1.4)], [isle.x, isle.top, isle.z], { minSpacing: 1.2, scaleRange: [0.8, 1.3] });
  for (let i = 0; i < trees; i++) {
    const [tx, , tz] = onCircle(isle.x, isle.z, isle.r * b.rand(0.45, 0.72), b.rand(0, Math.PI * 2));
    if (!b.claim(tx, tz, 1.6)) continue;
    b.gen('isle-tree', 'tree-oak', { height: r2(b.rand(4.5, 6.5)), color: palette.leaf, density: 7, variant: b.int(0, 2) }, [tx, isle.top, tz], { yaw: r2(b.rand(0, 360)), physics: 'static', tags: ['tree'] });
  }
}

/** Plan Lantern Isles. */
export function lanternIsles(): MockPlan {
  const b = flagshipBuilder(0x1a7e, { dusk: true });
  b.env({
    sky: 'sunset',
    timeOfDay: 17.35,
    sunIntensity: 3,
    ambientIntensity: 0.55,
    fog: { color: '#f6cfa6', density: 0.0026, visibility: 600 },
    weather: 'dust',
    bloom: 0.9,
    exposure: 1.05,
    wind: { speed: 4.5, direction: 250 },
    ground: null,
  });

  // --- The island chain ------------------------------------------------------------
  const home = island(b, 'Home island', 0, 0, 12, 20);
  b.reserve(home.x, home.z, 3);
  const isles: Isle[] = [home];
  let heading = -0.2;
  for (let i = 0; i < CHAIN.length; i++) {
    const step = CHAIN[i] as (typeof CHAIN)[number];
    const prev = isles[isles.length - 1] as Isle;
    heading += step.turn;
    const gap = step.link === 'bridge' ? BRIDGE_GAP : LIFT_GAP + LIFT_SIZE;
    const d = prev.r + gap + step.r;
    const x = r2(prev.x + Math.cos(heading) * d);
    const z = r2(prev.z + Math.sin(heading) * d);
    const isle = island(b, i === CHAIN.length - 1 ? 'Summit' : `Isle ${i + 2}`, x, z, step.r, prev.top + step.rise);
    isles.push(isle);
    // Rim points facing each other.
    const ux = (x - prev.x) / d;
    const uz = (z - prev.z) / d;
    const a: V3 = [r2(prev.x + ux * prev.r), prev.top, r2(prev.z + uz * prev.r)];
    const c: V3 = [r2(x - ux * step.r), isle.top, r2(z - uz * step.r)];
    if (step.link === 'bridge') {
      b.gen('bridge', 'bridge', { length: r2(BRIDGE_GAP + 3), width: 2.6, height: 1.1, color: '#8b5a2b', variant: 0 }, [r2((a[0] + c[0]) / 2), prev.top, r2((a[2] + c[2]) / 2)], { yaw: r2((Math.atan2(-uz, ux) * 180) / Math.PI), physics: 'static', name: 'Rope bridge', tags: ['bridge'] });
    } else {
      // A rune lift in the gap: rides from the lower rim up to the higher one and back.
      const lx = r2(a[0] + ux * (LIFT_GAP / 2 + LIFT_SIZE / 2));
      const lz = r2(a[2] + uz * (LIFT_GAP / 2 + LIFT_SIZE / 2));
      const lift = b.prim('rune-lift', 'box', [LIFT_SIZE, 0.45, LIFT_SIZE], [lx, r2(prev.top - 0.22), lz], {
        name: 'Rune lift',
        material: { preset: 'stone', color: '#c9c0ae', emissive: '#7fe0ff', emissiveIntensity: 0.35 },
        physics: 'kinematic',
        behaviors: [{ type: 'patrol', params: { waypoints: [[0, 0, 0], [0, step.rise, 0]], relative: true, speed: 1.5, mode: 'pingpong', wait: 1.6, face: false } }],
        tags: ['lift'],
      });
      b.prim(`${lift}-glow`, 'cylinder', [1.6, 0.04, 1.6], [0, 0.25, 0], { parent: lift, material: { preset: 'emissive', color: '#8fe8ff', emissive: '#6fdcff', emissiveIntensity: 2.4 }, castShadow: false });
    }
  }

  // --- Life: birds in the golden sky, butterflies on the grass (measured against each island's top) -----------------
  const isleAt = (x: number, z: number): Isle | undefined => isles.find((s) => Math.hypot(x - s.x, z - s.z) <= s.r - 0.5);
  const nearest = (x: number, z: number): Isle => isles.reduce((best, s) => (Math.hypot(x - s.x, z - s.z) < Math.hypot(x - best.x, z - best.z) ? s : best), isles[0] as Isle);
  const mid = isles[Math.min(3, isles.length - 1)] as Isle;
  const high = isles[Math.min(5, isles.length - 1)] as Isle;
  const top = isles[isles.length - 1] as Isle;
  addLife(b, { height: (x, z) => isleAt(x, z)?.top ?? null, floor: (x, z) => nearest(x, z).top }, [
    { id: 'home-butterflies', species: 'butterfly', count: 5, x: home.x - 3, z: home.z + 6, radius: 5 },
    { id: 'mid-butterflies', species: 'butterfly', count: 4, x: mid.x, z: mid.z, radius: 5 },
    { id: 'isle-birds', species: 'bird', count: 6, x: mid.x, z: mid.z, radius: 18 },
    { id: 'high-birds', species: 'bird', count: 5, x: high.x, z: high.z, radius: 16 },
    { id: 'summit-parrots', species: 'parrot', count: 3, x: top.x, z: top.z, radius: 12 },
    { id: 'sky-hawk', species: 'hawk', count: 1, x: mid.x, z: mid.z, radius: 55 },
  ]);

  // --- Home island: the guide, a cottage and a campfire -----------------------------
  b.gen('cottage', 'house', { width: 6, depth: 5, color: '#efe2c4', roofColor: '#9a4a35', trimColor: '#5a3a22', lights: true, variant: 0 }, [-5, home.top, -3], { yaw: 35, physics: 'static', name: 'Keeper’s cottage', footprint: 4 });
  const fire = b.gen('campfire', 'campfire', { size: 1.1 }, [3.5, home.top, -1], { physics: 'static', name: 'Campfire', footprint: 1.6 });
  b.light(fire, [0, 0.8, 0], '#ff8a3d', 2.4, 10, [{ type: 'pulseLight', params: { min: 1.8, max: 2.8, period: 0.4 } }]);
  b.prim('guide', 'capsule', [0.56, 1.7, 0.56], [1.5, home.top + 0.85, 3.5], {
    character: { wardrobe: 'traveller', gender: 'female', age: 'adult', top: '#a8541f', bottom: '#3b3f4a', mood: 'cheerful', hold: 'lantern' },
    name: 'Mira the lamplighter',
    yaw: 200,
    physics: 'kinematic',
    behaviors: [{ type: 'npc', params: {
      name: 'Mira',
      persona: 'a warm, unhurried lamplighter who has tended the isles for years',
      lines: [
        'Welcome to the Lantern Isles, traveller!',
        'Twelve paper lanterns drifted off in the storm. Find them on the islands above.',
        'Cross the rope bridges, and ride the glowing rune lifts up the cliffs.',
        'Bring every lantern home and the Great Lantern on the summit will wake.',
        'If you fall, the wind carries you back to the last island you touched.',
      ],
      greetRadius: 5,
      talkInterval: 4.5,
      farewell: 'Mind the edges — and look up!',
      wander: false,
    } }],
    tags: ['npc', 'focus'],
  });
  for (const [x, z] of [[-1, 9], [6, 6], [-8, 5]] as const) glowLantern(b, [x, home.top, z], '#ffb35c', { lit: false });
  dress(b, home, 4, { leaf: '#9cb84a', flower: '#f6a6c1' });

  // --- Lanterns, checkpoints and dressing on the other islands ------------------------
  const lanternCount = 12;
  let placed = 0;
  const palettes = [
    { leaf: '#a5c25a', flower: '#ffd36e' },
    { leaf: '#d9a441', flower: '#f6a6c1' },
    { leaf: '#9cb84a', flower: '#b6a3ff' },
    { leaf: '#c97b3a', flower: '#ffd36e' },
    { leaf: '#a5c25a', flower: '#ff9f8a' },
    { leaf: '#e3b04b', flower: '#f6a6c1' },
  ];
  // The ruins (placed below) claim their ground before the islands are dressed, so no tree grows into them: a trunk
  // beside the statue's pedestal or the arch's legs would leave a gap narrower than a person on the way to a lift.
  const ruin = isles[3] as Isle;
  const arch = { x: r2(ruin.x + ruin.r * 0.2), z: r2(ruin.z - ruin.r * 0.3) };
  const watch = isles[5] as Isle;
  const statue = { x: r2(watch.x - watch.r * 0.3), z: r2(watch.z + watch.r * 0.2) };
  b.reserve(arch.x, arch.z, 2.4);
  b.reserve(statue.x, statue.z, 1.4);
  isles.slice(1).forEach((isle, i) => {
    dress(b, isle, i === isles.length - 2 ? 2 : 3, palettes[i % palettes.length] as { leaf: string; flower: string });
    b.prim('checkpoint', 'cylinder', [2.2, 0.06, 2.2], [isle.x, r2(isle.top + 0.03), isle.z], {
      name: `Waystone ${i + 2}`,
      material: { preset: 'emissive', color: '#ffe3a3', emissive: '#ffcf6b', emissiveIntensity: 1.2 },
      behaviors: [{ type: 'checkpoint', params: { message: `Waystone ${i + 2} — the wind will bring you back here`, offset: [0, 1, 0] } }],
      tags: ['checkpoint'],
      castShadow: false,
    });
    for (let k = 0; k < 2 && placed < lanternCount; k++) {
      const [lx, , lz] = onCircle(isle.x, isle.z, isle.r * 0.55, b.rand(0, Math.PI * 2) + k * Math.PI);
      pickup(b, 'paper-lantern', [lx, r2(isle.top + 1.3), lz], { scoreKey: 'lanterns', color: '#ffb35c', size: 0.75, shape: 'box', name: 'Paper lantern', message: 'Lantern found!', tags: ['lantern'] });
      placed++;
    }
  });
  // Ruins on the way up.
  b.gen('ruin-arch', 'arch', { width: 3.4, height: 4.6, thickness: 0.9, color: '#cbbfa6', variant: 0 }, [arch.x, ruin.top, arch.z], { yaw: faceToward(ruin.x, ruin.z, home.x, home.z), physics: 'static', name: 'Old arch' });
  b.gen('ruin-statue', 'statue', { height: 3.4, color: '#d7cfbf', pedestalColor: '#9a917f', variant: 0 }, [statue.x, watch.top, statue.z], { yaw: faceToward(watch.x, watch.z, home.x, home.z), physics: 'static', name: 'Watcher statue' });

  // --- The summit: the Great Lantern ------------------------------------------------
  const summit = isles[isles.length - 1] as Isle;
  b.gen('summit-torii', 'arch', { width: 4, height: 5, thickness: 0.5, accentColor: '#d9482f', variant: 2 }, [summit.x, summit.top, r2(summit.z + summit.r * 0.55)], { yaw: faceToward(summit.x, summit.z + summit.r * 0.55, summit.x, summit.z), physics: 'static', name: 'Summit gate' });
  const great = b.gen('great-lantern', 'hero-lantern', { height: 6, glowColor: '#ffcf6b', brassColor: '#c8963c' }, [summit.x, summit.top, summit.z], {
    name: 'The Great Lantern',
    physics: 'static',
    behaviors: [{ type: 'goal', enabled: false, params: { text: 'The Great Lantern blazes over the isles. Every lantern is home!', margin: 1.4 } }],
    tags: ['goal', 'landmark'],
  });
  const glow = b.light(great, [0, 5.4, 0], '#ffcf6b', 0.4, 26);

  // --- Below the islands: a sea of clouds, and drifting rocks far off -------------------
  // Two layers: a low stratus floor and, nearer the horizon, tall cumulus banks lit from the side, so the sea has depth.
  for (let i = 0; i < 26; i++) {
    const [x, , z] = onCircle(18, -18, b.rand(22, 135), (i / 26) * Math.PI * 2 + b.rand(-0.2, 0.2));
    b.gen('cloud-sea', 'cloud', { size: r2(b.rand(26, 44)), color: '#ffe6d2', variant: 1 }, [x, r2(b.rand(2, 9)), z], { castShadow: false, tags: ['sky'], material: { emissive: '#ffd8b8', emissiveIntensity: 0.25 }, behaviors: [{ type: 'bob', params: { amplitude: 0.8, period: r2(b.rand(8, 12)) } }] });
  }
  for (let i = 0; i < 14; i++) {
    const [x, , z] = onCircle(18, -18, b.rand(105, 175), (i / 14) * Math.PI * 2 + b.rand(-0.3, 0.3));
    b.gen('cloud-bank', 'cloud', { size: r2(b.rand(34, 60)), color: '#fff0e0', variant: 0 }, [x, r2(b.rand(6, 24)), z], { castShadow: false, tags: ['sky'], material: { emissive: '#ffd0a8', emissiveIntensity: 0.3 }, behaviors: [{ type: 'bob', params: { amplitude: 1, period: r2(b.rand(10, 15)) } }] });
  }
  for (let i = 0; i < 9; i++) {
    const [x, , z] = onCircle(18, -18, b.rand(80, 140), (i / 9) * Math.PI * 2 + 0.3);
    b.gen('far-rock', 'rock', { size: r2(b.rand(5, 11)), color: '#8a7f72', mossy: true, variant: 2 }, [x, r2(b.rand(14, 48)), z], { rot: [180, r2(b.rand(0, 360)), 0], castShadow: false, tags: ['backdrop'], behaviors: [{ type: 'bob', params: { amplitude: 1.2, period: r2(b.rand(9, 14)), phase: r2(b.rand(0, 1)) } }] });
  }
  // The wind that returns fallen travellers to their last waystone.
  b.prim('updraft', 'box', [600, 2, 600], [18, -4, -18], { name: 'Updraft', visible: false, physics: { body: 'static', sensor: true }, behaviors: [{ type: 'hazard', params: { mode: 'respawn', cooldown: 0.5 } }] });

  // --- Game rules --------------------------------------------------------------------
  b.player({ mode: 'thirdPerson', spawn: [0, r2(home.top + 1), 8], moveSpeed: 6.5, jumpSpeed: 6.5 });
  b.state('lanterns', 0);
  b.hud('lanterns', `Lanterns / ${lanternCount}`);
  b.rule({ id: 'welcome', when: { on: 'start' }, then: [{ do: 'message', text: 'Talk to Mira by the campfire.', duration: 4 }] });
  b.rule({ id: 'halfway', when: { on: 'state', key: 'lanterns', op: '>=', value: 6 }, then: [{ do: 'message', text: 'Halfway! The summit is glowing brighter.', duration: 3 }, { do: 'setProperty', target: glow, path: 'light.intensity', value: 1.6 }], once: true });
  b.rule({
    id: 'awaken',
    description: 'All lanterns found: the Great Lantern wakes and becomes the goal',
    when: { on: 'state', key: 'lanterns', op: '>=', value: lanternCount },
    then: [
      { do: 'enableBehavior', target: great, behavior: 'goal', enabled: true },
      { do: 'setProperty', target: glow, path: 'light.intensity', value: 4 },
      { do: 'message', text: 'The Great Lantern awakens! Climb to the summit and touch it.', duration: 5 },
      { do: 'sound', sound: 'bell' },
    ],
    once: true,
  });
  b.rule({ id: 'reset-key', when: { on: 'key', key: 'r' }, then: [{ do: 'reset' }] });

  b.test({ id: 'lifts-run', kind: 'moves', target: '#lift', distance: 2, within: 8 });
  b.test({ id: 'islands-hold', kind: 'stable', target: '#island', seconds: 2, maxDrift: 0.01 });
  b.test({ id: 'lanterns-hang', kind: 'staysAbove', target: '#lantern', y: 15, within: 3 });
  b.test({ id: 'no-overlap', kind: 'noOverlap' });

  return finish(b, {
    name: 'Lantern Isles',
    description: 'Gather twelve lost lanterns across floating islands at golden hour.',
    intro: {
      title: 'Lantern Isles',
      tagline: 'Seven floating islands, twelve lost lanterns, one sky on fire.',
      objective: `Find all ${lanternCount} paper lanterns, then wake the Great Lantern on the summit.`,
      controls: ['WASD — move', 'Space — jump', 'Mouse — look', 'R — restart', 'Esc — editor'],
      accent: '#ffb35c',
    },
    plan: 'Plan: seven floating islands (grass cap, soil, rock cone) linked by rope bridges and rune lifts, a guide NPC, 12 lantern pickups, waystone checkpoints, an updraft respawn, the Great Lantern goal unlocked by a rule, golden-hour sky over a sea of clouds.',
    message: 'Built Lantern Isles: seven floating islands at golden hour linked by rope bridges and rune lifts. Talk to Mira, find the 12 paper lanterns, then touch the Great Lantern on the summit. WASD to move, Space to jump.',
  });
}
