/**
 * Kestrel Outpost — a third-person arena shooter. A mountain relay station
 * in a ring of limestone cliffs at golden hour; raiders come through three
 * passes in five escalating waves. Hold the outpost: keep the relay standing
 * and yourself alive until the last wave falls.
 *
 * Everything is plain World IR built from the framework's own parts:
 *
 * - the player carries a carbine (`player.weapon`: hitscan, magazine,
 *   reserve, reload) and aims over the shoulder;
 * - raiders are human characters (`entity.npc` + `entity.character` holding
 *   a rifle) cloned from templates by `spawn` rules at the passes. They walk
 *   toward the relay, shoot at what they see (`attack.ranged`), leave
 *   ammunition and medkits behind (`npc.drops`) and are cleared away a few
 *   seconds after they fall (`npc.corpse`);
 * - the relay is itself a character of the outpost's faction, allied with
 *   the player: raiders target it, the player's shots pass it by, and its
 *   death (`relay-died`) ends the game;
 * - waves, the raider count, the score and both endings are rules over world
 *   state, so the HUD shows them and the agent can change them by chat.
 */
import type { EntityInput, Json, NpcSpecInput, RuleInput } from '@aether/core';
import { r2, type Builder, type V3 } from '../builder';
import type { MockPlan } from '../planner';
import { finish, flagshipBuilder } from './kit';

/** Centre of the outpost (the relay stands here). */
const CX = 0;
const CZ = -4;
/** Radius of the cliff ring. */
const RING = 40;
/** Number of waves. */
export const KESTREL_WAVES = 5;

/** The three passes: where raiders gather (outside the ring) and the way they walk in. */
const PASSES = {
  n: { name: 'north pass', at: [0, 0, -48] as V3, path: [[0, 0, -30], [2, 0, -14]] as V3[] },
  e: { name: 'east pass', at: [48, 0, -4] as V3, path: [[30, 0, -4], [12, 0, -3]] as V3[] },
  w: { name: 'west pass', at: [-48, 0, -4] as V3, path: [[-30, 0, -5], [-12, 0, -2]] as V3[] },
} as const;
type Pass = keyof typeof PASSES;

/** Kinds of raider. */
interface RaiderKind {
  id: 'raider' | 'heavy' | 'rusher';
  name: string;
  health: number;
  speed: number;
  runSpeed: number;
  attack: NonNullable<NpcSpecInput['attack']>;
  drops: Array<{ template: string; chance: number }>;
  look: NonNullable<EntityInput['character']>;
  score: number;
}

const KINDS: readonly RaiderKind[] = [
  {
    id: 'raider',
    name: 'Raider',
    health: 70,
    speed: 2.2,
    runSpeed: 4.1,
    attack: { range: 24, damage: 6, cooldown: 1.5, ranged: true, accuracy: 0.5, farAccuracy: 0.1 },
    drops: [{ template: 'ammo-drop', chance: 0.45 }, { template: 'medkit-drop', chance: 0.1 }],
    look: { wardrobe: 'bandit', gender: 'male', top: '#4a4237', bottom: '#2f2d29', hold: 'rifle', mood: 'angry' },
    score: 100,
  },
  {
    id: 'heavy',
    name: 'Heavy raider',
    health: 240,
    speed: 1.7,
    runSpeed: 3.1,
    attack: { range: 20, damage: 9, cooldown: 1.8, ranged: true, accuracy: 0.5, farAccuracy: 0.15 },
    drops: [{ template: 'medkit-drop', chance: 0.7 }, { template: 'ammo-drop', chance: 0.85 }],
    look: { wardrobe: 'guard', gender: 'male', top: '#5b2a22', bottom: '#2b2622', hold: 'rifle', mood: 'angry', scale: 1.12 },
    score: 300,
  },
  {
    id: 'rusher',
    name: 'Rusher',
    health: 75,
    speed: 3,
    runSpeed: 6.2,
    attack: { range: 1.9, damage: 24, cooldown: 1.1, windup: 0.45 },
    drops: [{ template: 'medkit-drop', chance: 0.15 }, { template: 'ammo-drop', chance: 0.2 }],
    // A face scarf and a cap: no rifle and no chest rig, so a rusher reads apart from the riflemen at a glance.
    look: { wardrobe: 'bandit', gender: 'male', top: '#6b5a3a', bottom: '#3a3226', hold: 'axe', mood: 'angry', scale: 0.95, gear: ['scarf', 'cap'] },
    score: 150,
  },
];

/** The raider template for a kind at a pass (`raider-n`, `heavy-e`, …). */
function raiderTemplate(b: Builder, kind: RaiderKind, pass: Pass): string {
  const id = `${kind.id}-${pass}`;
  const p = PASSES[pass];
  const npc: NpcSpecInput = {
    role: kind.name.toLowerCase(),
    faction: 'raiders',
    archetype: 'guard',
    // Rushers go for the player; riflemen shoot whatever is nearer, the relay or the player.
    enemies: kind.id === 'rusher' ? ['player'] : ['player', 'outpost'],
    speed: kind.speed,
    runSpeed: kind.runSpeed,
    turnRate: 540,
    health: kind.health,
    fleeAt: 0,
    leash: 400,
    perception: { sight: 60, fov: 220, hearing: 30, memory: 10, alert: 30 },
    attack: kind.attack,
    // In through the pass toward the relay; they turn on anything they see on the way.
    waypoints: [...p.path, [CX, 0, CZ + 3]],
    patrol: { mode: 'loop', wait: 0.2 },
    drops: kind.drops,
    corpse: 6,
    barks: kind.id === 'rusher' ? { spot: ['There!', 'Get them!'] } : { spot: ['Contact!', 'Movement at the relay!', 'Take the mast!'], hurt: ['Agh!', "I'm hit!"] },
  };
  b.add({
    id,
    name: `${kind.name} (${p.name})`,
    description: `Template: a ${kind.name.toLowerCase()} entering by the ${p.name}.`,
    template: true,
    tags: ['npc', 'raider', kind.id],
    transform: { position: [p.at[0], 0.85, p.at[2]], rotation: [0, 0, 0], scale: [1, 1, 1] },
    shape: { kind: 'primitive', primitive: 'capsule', size: [0.56, 1.7, 0.56] },
    material: { preset: 'fabric', color: kind.look.top ?? '#4a4237' },
    physics: { body: 'kinematic' },
    npc,
    character: kind.look,
  });
  return id;
}

/** A pickup template dropped by raiders (single entity: spawns do not clone children). */
function pickupTemplate(b: Builder, id: string, o: { name: string; key: string; value: number; size: V3; color: string; glow: string; message: string; sound?: string; beacon?: { vfx: 'heal' | 'sparkle'; light: string } }): void {
  b.add({
    id,
    name: o.name,
    template: true,
    tags: ['pickup'],
    transform: { position: [0, 0.6, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    shape: { kind: 'primitive', primitive: 'box', size: o.size },
    material: { preset: 'plastic', color: o.color, roughness: 0.55, emissive: o.glow, emissiveIntensity: o.beacon ? 0.7 : 0.35 },
    castShadow: false,
    // A beacon pickup (health) glows and pulses so it reads from across the arena, even in a firefight.
    ...(o.beacon ? { light: { type: 'point' as const, color: o.beacon.light, intensity: 1.4, range: 5, castShadow: false } } : {}),
    behaviors: [
      { type: 'spin', params: { axis: [0, 1, 0], speed: 90 } },
      { type: 'bob', params: { amplitude: 0.12, period: 1.6 } },
      { type: 'collectible', params: { scoreKey: o.key, value: o.value, margin: 0.9, message: o.message, sound: o.sound ?? 'pickup' } },
      { type: 'lifetime', params: { seconds: 30 } },
      ...(o.beacon ? [{ type: 'pulseLight' as const, params: { min: 0.6, max: 1.8, period: 0.9 } }] : []),
    ],
    vfx: o.beacon ? { preset: o.beacon.vfx, rate: 12, color: o.glow, scale: 1.1 } : { preset: 'sparkle', rate: 5, color: o.glow, scale: 0.7 },
  });
}

/**
 * A sandbag wall: the sandbag-wall generator, double thick with header courses, `bags` bag-lengths long. Six courses
 * stand 0.68 m; the wall is drawn 1.38 times as tall (fat, well-filled bags) so it covers to 0.94 m like the old
 * blockout, and its box collider (scaled with it) stops raiders and bullets.
 */
function sandbags(b: Builder, x: number, z: number, yaw: number, bags = 5): void {
  b.gen('sandbags', 'sandbag-wall', { length: r2(bags * 0.66), courses: 6, color: '#a8976f', variant: 1 }, [x, 0, z], { yaw, name: 'Sandbag wall', scale: [1, 1.38, 1], physics: 'static', tags: ['cover'] });
}

/** A weathered 20 ft shipping container (doors at +X) from the shipping-container generator; `y` stacks it on another. */
function container(b: Builder, x: number, z: number, yaw: number, color: string, y = 0): string {
  return b.gen('container', 'shipping-container', { length: 6.06, color, wear: 0.45, variant: 0 }, [x, y, z], { yaw, name: 'Shipping container', physics: 'static', tags: ['cover', 'container'], footprint: 3.4 });
}

/** An industrial floodlight pole (two lamp heads on a crossarm, facing along `yaw`) with a warm light for the evening. */
function floodlight(b: Builder, x: number, z: number, yaw: number, y = 0): void {
  // The heads face the generator's +Z; the old mast lit its -Z, so it turns half a turn and the light stays where it was.
  const pole = b.gen('floodlight', 'lamp-post', { height: 6, variant: 3, lightColor: '#ffe2b8' }, [x, y, z], { yaw: yaw + 180, name: 'Floodlight mast', physics: 'static' });
  b.light(pole, [0, 5.4, 1.6], '#ffd7a0', 2.4, 16);
}

/**
 * The relay mast: a tapered self-supporting lattice tower from the radio-mast generator (dishes, panel antennas, a
 * beacon, a cable bridge to its equipment shelter, which stands 4.35 m along the mast's +X), with a pulsing red light.
 * `yaw` -90 puts the shelter to the south of the tower.
 */
function relayMast(b: Builder, x: number, z: number, yaw: number): void {
  const mast = b.gen('relay-mast', 'radio-mast', { height: 15, variant: 2, color: '#8b8f8a' }, [x, 0, z], { yaw, name: 'Relay mast', physics: 'static' });
  b.light(mast, [0, 15.4, 0], '#ff4020', 1.4, 12, [{ type: 'pulseLight', params: { min: 0.2, max: 1.6, period: 1.4 } }]);
}

/** The relay itself: the equipment cabinet raiders want to destroy (a character of the outpost, allied with the player). */
function relay(b: Builder): string {
  const id = 'relay';
  b.add({
    id,
    name: 'Relay',
    description: 'The relay station the outpost exists to protect. Raiders shoot at it; if it falls, the outpost is lost.',
    tags: ['relay', 'objective'],
    transform: { position: [CX + 2.2, 1.35, CZ + 1.8], rotation: [0, -20, 0], scale: [1, 1, 1] },
    shape: { kind: 'primitive', primitive: 'box', size: [1.9, 2.2, 1.1] },
    material: { preset: 'metal', finish: 'paint', color: '#7b8266', metalness: 0.15, roughness: 0.6 },
    physics: { body: 'kinematic' },
    npc: {
      role: 'relay',
      faction: 'outpost',
      archetype: 'sentinel',
      allies: ['player'],
      speed: 0,
      runSpeed: 0,
      health: 700,
      radius: 0.9,
      height: 2.2,
      perception: { sight: 0, fov: 10, hearing: 0, memory: 0, alert: 0 },
    },
  });
  // Front panel: status lamps, a vent grille and a cable run to the mast.
  b.prim('relay-panel', 'box', [1.5, 1.2, 0.04], [0, 0.25, 0.57], { parent: id, material: { preset: 'metal', color: '#3c3f38', roughness: 0.5, metalness: 0.5 } });
  for (let i = 0; i < 4; i++) {
    b.prim('relay-lamp', 'box', [0.12, 0.08, 0.03], [r2(-0.5 + i * 0.33), 0.72, 0.6], { parent: id, material: { preset: 'emissive', color: i === 3 ? '#ffb347' : '#9cff7a', emissive: i === 3 ? '#ff9a20' : '#5aff40', emissiveIntensity: 2.2 }, castShadow: false });
  }
  for (let k = 0; k < 5; k++) b.prim('relay-vent', 'box', [1.2, 0.03, 0.03], [0, r2(-0.65 + k * 0.08), 0.6], { parent: id, material: { preset: 'metal', color: '#2a2b28' } });
  b.prim('relay-roof', 'box', [2.1, 0.08, 1.3], [0, 1.14, 0], { parent: id, material: { preset: 'metal', color: '#4b4e46', metalness: 0.6 } });
  return id;
}

/** Spawn `count` of a template at its pass, and count them in. */
function spawnAt(template: string, pass: Pass, count: number): Array<NonNullable<RuleInput['then']>[number]> {
  return [
    { do: 'spawn', template, at: `pass-${pass}`, count, spread: 3.2 },
    { do: 'add', key: 'alive', amount: count },
  ];
}

/** One group of a wave: which kind, which pass, how many, and seconds after the wave starts. */
interface Group {
  kind: RaiderKind['id'];
  pass: Pass;
  count: number;
  at: number;
}

/** The five waves: more raiders, more passes, heavies from wave 3, rushers to flush the player out of cover. */
const WAVES: ReadonlyArray<{ text: string; groups: Group[] }> = [
  // Wave 1 teaches: a few riflemen from one side, then a pair from another, with time to find cover between them.
  { text: 'Wave 1: raiders at the north pass. Get behind the sandbags and pick them off.', groups: [{ kind: 'raider', pass: 'n', count: 2, at: 0 }, { kind: 'raider', pass: 'e', count: 2, at: 10 }] },
  { text: 'Wave 2: east and west. Rushers charge in with axes; back off when you hear them swing.', groups: [{ kind: 'raider', pass: 'e', count: 3, at: 0 }, { kind: 'rusher', pass: 'w', count: 4, at: 6 }, { kind: 'raider', pass: 'w', count: 3, at: 10 }, { kind: 'raider', pass: 'n', count: 3, at: 14 }] },
  { text: 'Wave 3: a heavy is with them. Aim for the head.', groups: [{ kind: 'raider', pass: 'n', count: 4, at: 0 }, { kind: 'heavy', pass: 'n', count: 1, at: 4 }, { kind: 'rusher', pass: 'e', count: 4, at: 10 }, { kind: 'raider', pass: 'w', count: 3, at: 16 }, { kind: 'heavy', pass: 'e', count: 1, at: 20 }, { kind: 'rusher', pass: 'w', count: 4, at: 24 }] },
  { text: 'Wave 4: all three passes at once.', groups: [{ kind: 'raider', pass: 'w', count: 3, at: 0 }, { kind: 'raider', pass: 'e', count: 3, at: 0 }, { kind: 'heavy', pass: 'e', count: 1, at: 6 }, { kind: 'rusher', pass: 'n', count: 3, at: 10 }, { kind: 'raider', pass: 'n', count: 3, at: 16 }, { kind: 'heavy', pass: 'w', count: 1, at: 20 }] },
  { text: 'Final wave: everything they have left. Hold the relay!', groups: [{ kind: 'raider', pass: 'n', count: 4, at: 0 }, { kind: 'raider', pass: 'e', count: 3, at: 0 }, { kind: 'heavy', pass: 'w', count: 1, at: 2 }, { kind: 'heavy', pass: 'e', count: 1, at: 6 }, { kind: 'rusher', pass: 'e', count: 3, at: 9 }, { kind: 'rusher', pass: 'w', count: 3, at: 13 }, { kind: 'raider', pass: 'w', count: 3, at: 18 }, { kind: 'raider', pass: 'n', count: 3, at: 24 }, { kind: 'heavy', pass: 'n', count: 1, at: 28 }, { kind: 'rusher', pass: 'n', count: 3, at: 30 }, { kind: 'heavy', pass: 'w', count: 1, at: 34 }, { kind: 'rusher', pass: 'w', count: 3, at: 38 }] },
];

/** Wave, kill and ending rules. */
function waveRules(b: Builder): void {
  b.rule({ id: 'begin', when: { on: 'start' }, then: [{ do: 'message', text: 'Raiders are moving on the outpost. Get to cover near the relay.', duration: 5 }, { do: 'emit', event: 'next-wave', delay: 6 }] });
  b.rule({ id: 'next-wave', when: { on: 'event', name: 'next-wave' }, then: [{ do: 'add', key: 'wave', amount: 1 }, { do: 'emit', event: 'wave-start' }] });
  WAVES.forEach((w, i) => {
    const n = i + 1;
    const later = w.groups.filter((g) => g.at > 0);
    const now = w.groups.filter((g) => g.at === 0);
    b.rule({
      id: `wave-${n}`,
      description: `Wave ${n} of ${WAVES.length}`,
      when: { on: 'event', name: 'wave-start' },
      if: [{ key: 'wave', op: '==', value: n }],
      then: [
        { do: 'message', text: w.text, duration: 4 },
        { do: 'sound', sound: 'alarm' },
        { do: 'set', key: 'pending', value: later.length },
        ...now.flatMap((g) => spawnAt(`${g.kind}-${g.pass}`, g.pass, g.count)),
        ...later.map((_, k) => ({ do: 'emit' as const, event: `wave-${n}-group-${k + 1}`, delay: (later[k] as Group).at })),
      ],
    });
    later.forEach((g, k) => {
      b.rule({ id: `wave-${n}-group-${k + 1}`, when: { on: 'event', name: `wave-${n}-group-${k + 1}` }, then: [...spawnAt(`${g.kind}-${g.pass}`, g.pass, g.count), { do: 'add', key: 'pending', amount: -1 }] });
    });
  });
  // Every raider down: the count, the kill tally and the score (heavies and rushers are worth more, see the per-kind rules).
  b.rule({ id: 'raider-down', when: { on: 'event', name: 'npc-died' }, then: [{ do: 'add', key: 'alive', amount: -1 }, { do: 'add', key: 'kills', amount: 1 }, { do: 'add', key: 'score', amount: 100 }] });
  // A wave is over when nothing is left alive and nothing is still on its way.
  b.rule({
    id: 'wave-cleared',
    when: { on: 'state', key: 'alive', op: '<=', value: 0 },
    if: [{ key: 'wave', op: '>=', value: 1 }, { key: 'wave', op: '<', value: WAVES.length }, { key: 'pending', op: '<=', value: 0 }],
    then: [{ do: 'message', text: 'Wave cleared. Reload and pick up what they dropped.', duration: 4 }, { do: 'add', key: 'score', amount: 500 }, { do: 'sound', sound: 'bell' }, { do: 'emit', event: 'next-wave', delay: 7 }],
    once: false,
  });
  // Late groups arriving after the field was cleared re-arm the check: `pending` reaching 0 with nobody alive ends the wave too.
  b.rule({
    id: 'wave-cleared-late',
    when: { on: 'state', key: 'pending', op: '<=', value: 0 },
    if: [{ key: 'alive', op: '<=', value: 0 }, { key: 'wave', op: '>=', value: 1 }, { key: 'wave', op: '<', value: WAVES.length }],
    then: [{ do: 'emit', event: 'next-wave', delay: 7 }],
    once: false,
  });
  b.rule({
    id: 'victory',
    when: { on: 'state', key: 'alive', op: '<=', value: 0 },
    if: [{ key: 'wave', op: '>=', value: WAVES.length }, { key: 'pending', op: '<=', value: 0 }],
    then: [{ do: 'add', key: 'score', amount: 2000 }, { do: 'sound', sound: 'win' }, { do: 'win', text: 'The last raider is down and the relay still stands. Kestrel Outpost holds.' }],
  });
  b.rule({ id: 'relay-lost', when: { on: 'event', name: 'relay-died' }, then: [{ do: 'sound', sound: 'lose' }, { do: 'lose', text: 'The relay was destroyed. The outpost is lost.' }] });
  b.rule({ id: 'relay-warning', when: { on: 'state', key: 'relay.health', op: '<', value: 600 }, then: [{ do: 'message', text: 'The relay is badly damaged! Clear the raiders around it!', duration: 4 }, { do: 'sound', sound: 'alarm' }], once: true });
  // Medkits heal; health never goes above 100.
  b.rule({ id: 'health-cap', when: { on: 'state', key: 'health', op: '>', value: 100 }, then: [{ do: 'set', key: 'health', value: 100 }], once: false });
  // The bigger threats are worth more: every character's death also emits `<tag>-died` for each of its tags.
  for (const k of KINDS) {
    if (k.score > 100) b.rule({ id: `${k.id}-bounty`, when: { on: 'event', name: `${k.id}-died` }, then: [{ do: 'add', key: 'score', amount: k.score - 100 }] });
  }
}

/** Plan Kestrel Outpost. */
export function kestrelOutpost(): MockPlan {
  const b = flagshipBuilder(0x6b35, { dusk: true });
  b.env({
    sky: 'day',
    hdri: 'sky-golden-sunset',
    hdriIntensity: 0.85,
    hdriBackground: true,
    timeOfDay: 17.6,
    sunIntensity: 3.3,
    ambientIntensity: 0.3,
    fog: { color: '#e9c9a4', density: 0.0012, visibility: 600 },
    weather: 'dust',
    bloom: 0.55,
    exposure: 1.08,
    wind: { speed: 4, direction: 250 },
    grade: { temperature: 0.12, tint: 0.01, saturation: 1.08, contrast: 1.18, exposureEv: 0.1 },
    look: { sunTint: '#ffcf96', ambientTint: '#c9cbe0', foliageTint: '#ffe0a8', vignette: 0.28, intent: { key: 'moderate', text: 'golden-hour mountain outpost: warm low sun on limestone and steel, long shadows, dust in the air' } },
    surroundings: { preset: 'alpine', clearRadius: 70, trees: 0.6, species: 'conifer', seed: 4242 },
    ground: { material: { preset: 'dirt', finish: 'dry-earth', color: '#8d7a5c' }, size: 320 },
  });
  b.player({
    mode: 'thirdPerson',
    spawn: [CX, 1, CZ + 11],
    yaw: 0,
    moveSpeed: 5.6,
    jumpSpeed: 5,
    character: { wardrobe: 'worker', gender: 'female', top: '#4d5338', bottom: '#33322c', hair: '#2a1d14', hold: 'rifle' },
    weapon: { name: 'Carbine', damage: 34, fireRate: 8.5, automatic: true, magazine: 30, reserve: 150, reloadTime: 1.7, range: 120, spread: 1.3, headshot: 2.2, noise: 35, impulse: 4 } as Json,
  });
  b.state('health', 100);
  b.state('wave', 0);
  b.state('alive', 0);
  b.state('pending', 0);
  b.state('kills', 0);
  b.state('score', 0);
  b.hud('wave', `Wave (of ${WAVES.length})`);
  b.hud('alive', 'Raiders');
  b.hud('relay.health', 'Relay');
  b.hud('health', 'Health');
  b.hud('score', 'Score');

  // --- The cliff ring, open at three passes ----------------------------------------------------------
  const cliff = { color: '#a39580', depth: 14, variant: 1 };
  const GAP = 13;
  const arcs: Array<[number, number]> = [[90 + GAP, 180 - GAP], [180 + GAP, 270 - GAP], [270 + GAP, 450 - GAP]];
  let seg = 0;
  for (const [a0, a1] of arcs) {
    const n = Math.max(2, Math.round((a1 - a0) / 21));
    for (let i = 0; i < n; i++) {
      const a = a0 + ((i + 0.5) * (a1 - a0)) / n;
      const rad = (a * Math.PI) / 180;
      const height = r2(15 + ((seg * 7) % 5) * 2.2);
      b.gen('cliff', 'cliff-face', { width: 19, height, depth: cliff.depth, color: cliff.color, variant: cliff.variant }, [r2(CX + Math.sin(rad) * RING), 0, r2(CZ + Math.cos(rad) * RING)], { yaw: r2(a + 180), physics: 'static', tags: ['cliff'] });
      seg++;
    }
  }
  // Boulders at the cliff feet and at the pass mouths (cover for the raiders as they come in).
  const boulders: Array<[number, number, number]> = [[-9, -33, 2.4], [8, -32, 2], [31, 6, 2.2], [32, -14, 1.8], [-31, 7, 2.3], [-32, -14, 2], [-22, 22, 2.6], [20, 24, 2.4], [0, 31, 2.8], [-26, -25, 2.2], [25, -26, 2.4]];
  for (const [x, z, s] of boulders) b.gen('boulder', 'boulder', { size: s, color: '#9a8d78', lichen: 0.3 }, [x, 0, z], { yaw: r2(b.rand(0, 360)), physics: 'static', tags: ['rock', 'cover'] });
  b.scatter('scree', 'rock', { size: 0.6, color: '#94887a' }, 60, [70, 70], [CX, 0, CZ], { scaleRange: [0.4, 1.3], minSpacing: 3 });
  // Dry grass and a few hardy spruces along the cliff feet; pines on the ridges beyond.
  b.scatter('dry-grass', 'grass-tuft', { size: 0.45, color: '#a39a5e', blades: 10 }, 420, [74, 74], [CX, 0, CZ], { scaleRange: [0.6, 1.4], minSpacing: 1.1 });
  for (const [x, z] of [[-24, -20], [23, -21], [-25, 17], [26, 15], [-12, 27], [14, 28], [-30, 0], [30, -3]] as const) {
    b.gen('spruce', 'tree-spruce', { height: r2(b.rand(9, 13)) }, [x, 0, z], { yaw: r2(b.rand(0, 360)), physics: 'static', tags: ['tree'] });
  }
  b.scatter('ridge-pines', 'tree-pine', { height: 11 }, 70, [150, 30], [CX, 16, CZ - 62], { scaleRange: [0.8, 1.4], minSpacing: 5 });
  b.scatter('ridge-pines-s', 'tree-pine', { height: 11 }, 70, [150, 30], [CX, 16, CZ + 62], { scaleRange: [0.8, 1.4], minSpacing: 5 });

  // --- The passes: worn tracks in, a marker where raiders gather ---------------------------------------
  for (const pass of Object.keys(PASSES) as Pass[]) {
    const p = PASSES[pass];
    b.add({ id: `pass-${pass}`, name: `The ${p.name}`, description: `Where raiders gather before they enter by the ${p.name}.`, tags: ['pass'], transform: { position: [p.at[0], 0.85, p.at[2]], rotation: [0, 0, 0], scale: [1, 1, 1] }, shape: { kind: 'none' } });
    const [ax, , az] = p.at;
    const len = Math.hypot(ax - CX, az - CZ);
    const yaw = (Math.atan2(ax - CX, az - CZ) * 180) / Math.PI;
    b.prim('track', 'box', [4.2, 0.04, r2(len - 4)], [r2((ax + CX) / 2), 0.02, r2((az + CZ) / 2)], { yaw: r2(yaw), name: 'Worn track', material: { preset: 'dirt', finish: 'gravel', color: '#9b8a6c' }, castShadow: false });
    // Concrete barriers half-block each pass mouth.
    const ux = (ax - CX) / len;
    const uz = (az - CZ) / len;
    for (const side of [-1, 1]) {
      const d = RING - 9;
      b.asset('barrier', 'barrier-concrete', [r2(CX + ux * d - uz * side * 3.4), 0, r2(CZ + uz * d + ux * side * 3.4)], { yaw: r2(yaw + 90 + side * 12), physics: 'static', tags: ['cover'], fallback: { kind: 'primitive', primitive: 'box', size: [2, 0.9, 0.6] } });
    }
  }

  // --- The outpost --------------------------------------------------------------------------------------
  b.prim('pad', 'box', [13, 0.25, 13], [CX, 0.125, CZ], { name: 'Concrete pad', material: { preset: 'concrete', finish: 'concrete', color: '#a7a093' }, physics: 'static', castShadow: false, footprint: 7 });
  // The mast and its shelter stand south-west of the pad, behind the defenders: the tower and the shelter are solid, and
  // in front of the relay they blocked the lines of fire to the passes (a third of the wins went with them).
  relayMast(b, CX - 6, CZ + 12, -90);
  relay(b);
  b.asset('generator', 'generator-portable', [CX - 3.6, 0.25, CZ + 2.6], { yaw: 30, physics: 'static', fallback: { kind: 'primitive', primitive: 'box', size: [0.8, 0.6, 0.6] } });
  b.asset('power-box', 'power-box', [CX + 4.4, 0.25, CZ - 3.8], { yaw: -90, physics: 'static', fallback: { kind: 'primitive', primitive: 'box', size: [0.8, 1.2, 0.4] } });
  b.asset('utility-box', 'utility-box', [CX - 4.6, 0.25, CZ - 4.2], { yaw: 90, physics: 'static', fallback: { kind: 'primitive', primitive: 'box', size: [0.8, 1.2, 0.4] } });
  // One stands off the pad on the ground, one on the pad.
  floodlight(b, CX - 6.1, CZ - 9.8, 45);
  floodlight(b, CX + 6.2, CZ + 1.6, -135, 0.25);
  // Sandbag ring: six short walls with gaps, the player's main cover.
  for (let i = 0; i < 6; i++) {
    const a = ((i + 0.5) / 6) * Math.PI * 2;
    sandbags(b, r2(CX + Math.sin(a) * 9.5), r2(CZ + Math.cos(a) * 9.5), r2((a * 180) / Math.PI + 90), 6);
  }

  // Mid-field cover: shipping containers (one stacked), crates, barrels and tyres.
  container(b, 15, -15, 32, '#7e3a24');
  container(b, -16, 7, -18, '#3f5a44');
  container(b, -16.2, 7.1, -14, '#9a7a34', 2.6);
  container(b, 16, 9, 74, '#7d7f78');
  for (const [x, z, s] of [[7, -17, 1.1], [8.2, -17.4, 0.9], [-12, -14, 1.2], [-13.1, -13.2, 1], [12, 18, 1.1], [-5, 19, 1]] as const) {
    b.gen('crate', 'crate', { size: s, color: '#7a6040' }, [x, 0, z], { yaw: r2(b.rand(0, 90)), physics: 'static', tags: ['cover'], footprint: 0.8 });
  }
  // Two clusters of dented, rusting steel drums, one red fuel drum in each.
  for (const [cx, cz, turn] of [[-20, -7, 20], [21, -3, -40]] as const) {
    const t = (turn * Math.PI) / 180;
    for (const [dx, dz, variant, color] of [[-0.32, -0.12, 1, '#4f5a3c'], [0.3, -0.18, 1, '#365066'], [0.02, 0.42, 2, '#a3271c']] as const) {
      const px = r2(cx + dx * Math.cos(t) + dz * Math.sin(t));
      const pz = r2(cz - dx * Math.sin(t) + dz * Math.cos(t));
      b.gen('drum', 'barrel', { height: 0.88, color, variant }, [px, 0, pz], { yaw: r2(b.rand(0, 360)), name: variant === 2 ? 'Fuel drum' : 'Steel drum', physics: 'static', tags: ['cover'] });
    }
  }
  for (const [x, z] of [[4, 16], [4.8, 16.6], [-21, -9]] as const) b.asset('tyre', 'tyre-old', [x, 0, z], { yaw: r2(b.rand(0, 360)), physics: 'static', fallback: { kind: 'primitive', primitive: 'cylinder', size: [0.8, 0.3, 0.8] } });
  b.asset('stove', 'stove-barrel', [CX + 5, 0.25, CZ + 4.5], { physics: 'static', fallback: { kind: 'primitive', primitive: 'cylinder', size: [0.6, 0.9, 0.6] } });
  b.gen('campfire', 'campfire', { size: 0.9, lit: true }, [CX + 6.2, 0.25, CZ + 5.4], { physics: 'static' });

  // A watch hut on the south side: plank walls, a tin roof, an open front (a place to fall back to).
  const hut = b.empty('watch-hut', [CX - 1, 0, CZ + 22], { name: 'Watch hut', yaw: 180 });
  const plank = { preset: 'wood' as const, finish: 'cladding' as const, color: '#7a5f43' };
  b.prim('hut-back', 'box', [5, 2.6, 0.15], [0, 1.3, -1.9], { parent: hut, material: plank, physics: 'static' });
  for (const sx of [-1, 1]) b.prim('hut-side', 'box', [0.15, 2.6, 3.8], [sx * 2.5, 1.3, 0], { parent: hut, material: plank, physics: 'static' });
  b.prim('hut-roof', 'box', [5.6, 0.08, 4.6], [0, 2.75, 0.1], { parent: hut, rot: [-6, 0, 0], material: { preset: 'metal', finish: 'metal-roof', color: '#8a7d6c', roughness: 0.7 }, physics: 'static' });
  b.prim('hut-shelf', 'box', [3.4, 0.9, 0.6], [0, 0.45, -1.5], { parent: hut, material: { preset: 'wood', finish: 'oak', color: '#6c5236' }, physics: 'static' });
  // A chain-link compound fence with barbed wire behind the hut, on the side no raider comes from.
  for (const [x0, x1] of [[-13, -4.5], [3, 12]] as const) {
    b.gen('fence', 'fence', { length: r2(x1 - x0), height: 2.2, color: '#9aa0a2', variant: 3 }, [r2((x0 + x1) / 2), 0, CZ + 26.5], { name: 'Chain-link fence', physics: 'static' });
  }

  // --- Raiders and their drops (templates; spawned by the wave rules) ------------------------------------
  pickupTemplate(b, 'ammo-drop', { name: 'Ammunition', key: 'reserve', value: 45, size: [0.55, 0.32, 0.36], color: '#55603a', glow: '#ffd27a', message: '+45 rounds' });
  pickupTemplate(b, 'medkit-drop', { name: 'Medkit', key: 'health', value: 35, size: [0.66, 0.44, 0.4], color: '#c8241b', glow: '#ff4a3a', message: '+35 health', beacon: { vfx: 'heal', light: '#ff5a48' } });
  for (const kind of KINDS) for (const pass of Object.keys(PASSES) as Pass[]) raiderTemplate(b, kind, pass);
  // Two ammunition crates by the relay to start with.
  for (const [x, z, yaw] of [[CX - 2.5, CZ + 5.9, 8], [CX + 3.5, CZ - 6.6, -12]] as const) {
    b.add({
      id: b.id('ammo-crate'),
      name: 'Ammunition crate',
      tags: ['pickup'],
      // A military ammunition crate (0.95 x 0.4 x 0.48 m: olive plywood on skids, rope handles, latches, stencilled lot) on the pad.
      transform: { position: [x, 0.25, z], rotation: [0, yaw, 0], scale: [1, 1, 1] },
      shape: { kind: 'procedural', generator: 'crate', params: { size: 0.95, color: '#56603a', variant: 3 }, seed: 4100 + Math.round(x * 10) },
      behaviors: [{ type: 'collectible', params: { scoreKey: 'reserve', value: 60, margin: 0.9, message: '+60 rounds', respawn: 45 } }],
      vfx: { preset: 'sparkle', rate: 4, color: '#ffd27a', scale: 0.7 },
    });
  }

  waveRules(b);
  b.test({ id: 'waves-start', kind: 'eventually', condition: { key: 'wave', op: '>=', value: 1 }, within: 10 });
  b.test({ id: 'raiders-arrive', kind: 'eventually', condition: { key: 'alive', op: '>=', value: 1 }, within: 12 });

  return finish(b, {
    name: 'Kestrel Outpost',
    description: `A third-person shooter at a mountain relay outpost at golden hour: hold off ${WAVES.length} waves of raiders coming through three passes and keep the relay standing.`,
    intro: {
      title: 'Kestrel Outpost',
      tagline: 'A relay station in a ring of cliffs. The sun is going down, and the raiders are coming through the passes.',
      objective: `Survive ${WAVES.length} waves and keep the relay standing. Raiders drop ammunition and medkits.`,
      controls: ['WASD — move', 'Shift — sprint', 'C — crouch', 'Mouse — aim', 'Click — fire', 'R — reload'],
      accent: '#f0a64a',
      button: 'Play',
    },
    feel: {
      preset: 'normal',
      events: {
        hit: { hitStop: 0, shake: 0.04, fovKick: 0, flash: 0, vfx: 'none', text: true },
        shoot: { shake: 0.12 },
        damage: { hitStop: 0.03, shake: 0.32, vignette: 0.5 },
        kill: { hitStop: 0.03, vfx: 'debris', vfxScale: 0.7 },
        pickup: { hitStop: 0 },
      },
    },
    plan: `Plan: Kestrel Outpost — a cliff-ringed relay outpost at golden hour, a carbine, ${WAVES.length} waves of raiders through three passes, drops, a relay to defend.`,
    message: `Built Kestrel Outpost: hold the relay against ${WAVES.length} waves of raiders. Aim with the mouse, click to fire, R to reload; raiders drop ammunition and medkits.`,
  });
}
