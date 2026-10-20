/**
 * The Hollow Gate — a walled hamlet at night with a locked gate, built to
 * show intelligent characters. Three archetypes share the compound:
 *
 * - Marek, a guard, patrols the road in front of the gate with a torch, hears
 *   boots on the gravel, chases what he sees and strikes;
 * - Mira, a shopkeeper, greets you and sells the gate key for five gold;
 * - a wolf pack hunts the west woods after dark and will not go near a fire.
 *
 * Two villagers know how it all works. Earn the gold scattered around the
 * hollow, buy the key, creep past Marek (hold Shift) and leave through the
 * gate. Every character is plain World IR: `entity.npc`.
 */
import type { NpcSpecInput } from '@aether/core';
import { r2, type Builder, type V3 } from '../builder';
import { campfire, lamp } from '../decor';
import { addTorch, guardDialogue, NPC_KINDS, placeNpc, shopDialogue, type NpcKind } from '../npc-kinds';
import { makeGate } from '../npc';
import type { MockPlan } from '../planner';
import { finish, flagshipBuilder, segment } from './kit';

const WALL = { preset: 'stone' as const, finish: 'limestone' as const, color: '#8c877c' };
const CAP = { preset: 'stone' as const, finish: 'limestone' as const, color: '#6e695f' };
const kind = (id: string): NpcKind => NPC_KINDS.find((k) => k.id === id) as NpcKind;

/** A stretch of the compound wall. */
function wall(b: Builder, from: V3, to: V3): void {
  segment(b, 'wall', from, to, 1.2, 4.2, WALL, { physics: 'static', tags: ['wall'], castShadow: true });
  // A coping stone along the top and a buttress every ~9 m break the flat slab into a built wall.
  segment(b, 'wall-cap', [from[0], 4.2, from[2]], [to[0], 4.2, to[2]], 1.6, 0.34, CAP, { castShadow: true, y: 4.37 });
  const len = Math.hypot(to[0] - from[0], to[2] - from[2]);
  const n = Math.max(1, Math.floor(len / 9));
  const yaw = (Math.atan2(to[0] - from[0], to[2] - from[2]) * 180) / Math.PI;
  for (let k = 1; k < n; k++) {
    const t = k / n;
    b.prim('buttress', 'box', [1.1, 3.6, 1.1], [r2(from[0] + (to[0] - from[0]) * t), 1.8, r2(from[2] + (to[2] - from[2]) * t)], { yaw: r2(yaw), material: WALL, physics: 'static', tags: ['wall'], castShadow: true });
  }
}

/** Mira's market stall: a plank counter with goods on it, two posts, a striped awning and a hanging lantern. */
function marketStall(b: Builder, x: number, z: number, yaw: number): void {
  const wood = { preset: 'wood' as const, finish: 'oak' as const, color: '#8a5a36' };
  const root = b.prim('stall-counter', 'box', [2.2, 0.95, 0.8], [x, 0.475, z], { yaw, name: 'Counter', material: wood, physics: 'static', tags: ['stall'] });
  b.prim('stall-top', 'box', [2.3, 0.07, 0.9], [0, 0.5, 0], { parent: root, material: { preset: 'wood', finish: 'walnut', color: '#6b4630' } });
  for (const sx of [-1, 1]) b.prim('stall-post', 'box', [0.1, 2.4, 0.1], [sx * 1.1, 0.7, 0.55], { parent: root, material: wood });
  // Awning: alternating red and cream strips sloping down toward the customer.
  for (let k = 0; k < 8; k++) b.prim('stall-awning', 'box', [0.29, 0.05, 1.5], [r2(-1.05 + k * 0.3), 1.88, 0.35], { parent: root, rot: [-16, 0, 0], material: { preset: 'fabric', color: k % 2 ? '#e8dcc0' : '#9d2f2a', roughness: 0.9 }, castShadow: true });
  // Goods: loaves, a cheese wheel, a crate of apples and a jug.
  for (let k = 0; k < 3; k++) b.prim('stall-loaf', 'sphere', [0.28, 0.16, 0.16], [r2(-0.8 + k * 0.22), 0.6, 0.05], { parent: root, material: { preset: 'wood', color: '#b8803e', roughness: 0.8 } });
  b.prim('stall-cheese', 'cylinder', [0.32, 0.12, 0.32], [0.1, 0.6, -0.05], { parent: root, material: { preset: 'plastic', color: '#e5c35a', roughness: 0.6 } });
  b.prim('stall-crate', 'box', [0.4, 0.2, 0.3], [0.7, 0.62, 0.05], { parent: root, material: wood });
  for (let k = 0; k < 4; k++) b.prim('stall-apple', 'sphere', [0.1, 0.1, 0.1], [r2(0.58 + (k % 2) * 0.14), 0.76, r2(-0.02 + (k >> 1) * 0.12)], { parent: root, material: { preset: 'plastic', color: '#b4262c', roughness: 0.4 } });
  b.prim('stall-jug', 'cylinder', [0.16, 0.3, 0.16], [-0.3, 0.68, -0.15], { parent: root, material: { preset: 'plastic', color: '#6d4a2e', roughness: 0.5 } });
  const lantern = b.prim('stall-lantern', 'box', [0.16, 0.22, 0.16], [0.9, 1.6, 0.6], { parent: root, material: { preset: 'emissive', color: '#ffe2b0', emissive: '#ffb25c', emissiveIntensity: 1.5 }, castShadow: false });
  b.light(lantern, [0, -0.8, 0.45], '#ffb25c', 0.7, 8, [{ type: 'pulseLight', params: { min: 0.55, max: 0.8, period: 2.6 } }]);
  b.reserve(x, z, 1.8);
}

/** Small-talk dialogue of a villager who knows the hollow's rules. */
function lore(hello: string, tips: ReadonlyArray<readonly [string, string]>): NpcSpecInput['dialogue'] {
  const nodes: Record<string, unknown> = {
    start: { text: hello, choices: [...tips.map(([q], i) => ({ text: q, next: `tip-${i}` })), { text: 'Goodbye.', next: null }] },
  };
  tips.forEach(([, a], i) => {
    nodes[`tip-${i}`] = { text: a, next: 'start' };
  });
  return { start: 'start', nodes } as NpcSpecInput['dialogue'];
}

/** Plan The Hollow Gate. */
export function hollowGate(): MockPlan {
  const b = flagshipBuilder(0x401a, { night: true, fog: true });
  b.env({
    sky: 'night',
    timeOfDay: 22,
    ambientIntensity: 0.62,
    sunIntensity: 0.9,
    fog: { color: '#0d1424', density: 0.014 },
    weather: 'fireflies',
    bloom: 1.2,
    exposure: 1.2,
    ground: { material: { preset: 'grass', finish: 'grass', color: '#34503c' }, size: 260 },
  });
  b.player({ mode: 'thirdPerson', spawn: [0, 1, 28], moveSpeed: 5.4, jumpSpeed: 6 });
  b.state('health', 100);
  b.state('coins', 0);
  b.state('key', 0);
  b.hud('health', 'Health');
  b.hud('coins', 'Gold');
  b.hud('key', 'Key');

  // --- The compound: a wall with one way out ------------------------------------------------------
  wall(b, [-34, 0, -14], [-2.9, 0, -14]);
  wall(b, [2.9, 0, -14], [34, 0, -14]);
  wall(b, [-34, 0, 34], [34, 0, 34]);
  wall(b, [-34, 0, -14], [-34, 0, 34]);
  wall(b, [34, 0, -14], [34, 0, 34]);
  const gate = makeGate(b, 0, -14, true);
  // Beyond the gate: the road out, and the way to win.
  b.prim('road-out', 'box', [3.4, 0.05, 14], [0, 0.025, -23], { material: { preset: 'dirt', finish: 'dry-earth', color: '#6a5642' }, castShadow: false });
  b.gen('exit', 'portal', { size: 3, glowColor: '#ffd166' }, [0, 0, -26], {
    name: 'The road out',
    physics: { body: 'static', sensor: true },
    behaviors: [{ type: 'goal', params: { text: 'Through the Hollow Gate. The wolves howl behind you; you are out.' } }],
    tags: ['goal'],
  });
  b.light(b.empty('exit-glow', [0, 1.5, -24], { name: 'Exit glow' }), [0, 0, 0], '#ffd166', 2.2, 14);
  b.scatter('pines-out', 'tree-pine', { height: 7 }, 90, [120, 36], [0, 0, -40], { scaleRange: [0.8, 1.35], minSpacing: 3 });
  b.scatter('pines-sides', 'tree-pine', { height: 7 }, 120, [30, 90], [-52, 0, 10], { scaleRange: [0.8, 1.35], minSpacing: 3 });
  b.scatter('pines-sides-e', 'tree-pine', { height: 7 }, 120, [30, 90], [52, 0, 10], { scaleRange: [0.8, 1.35], minSpacing: 3 });

  // --- The road and the lamps ---------------------------------------------------------------------------
  b.prim('road', 'box', [3.8, 0.06, 44], [0, 0.03, 10], { material: { preset: 'dirt', finish: 'cobble', color: '#76624d' }, castShadow: false });
  for (const [x, z] of [[-3.6, 24], [3.6, 24], [-3.6, 12], [3.6, 12], [-3.6, -4], [3.6, -4]] as const) lamp(b, x, z, '#ffcf8a', 3.4, true);

  // --- Houses ---------------------------------------------------------------------------------------------
  b.gen('house', 'house', { width: 6, depth: 5, floors: 1, lights: true, variant: 0 }, [24, 0, 22], { yaw: 90, physics: 'static', tags: ['house'], footprint: 5 });
  b.gen('house', 'house', { width: 6, depth: 5, floors: 2, lights: true, variant: 1 }, [25, 0, 3], { yaw: 90, physics: 'static', tags: ['house'], footprint: 5 });
  b.gen('house', 'house', { width: 6, depth: 5, floors: 1, lights: true, variant: 2 }, [-24, 0, 28], { yaw: -90, physics: 'static', tags: ['house'], footprint: 5 });

  // Grass and ferns between the paths: the compound is a lawn, not a bare plane.
  for (const [x0, w] of [[-18.5, 31], [18.5, 31]] as const) {
    b.scatter('lawn', 'grass-tuft', { size: 0.5, color: '#4c6b3c', blades: 12 }, 260, [w, 44], [x0, 0, 10], { minSpacing: 0.9, scaleRange: [0.7, 1.4] });
    b.scatter('ferns', 'fern', { size: 0.7, color: '#3d6a40' }, 40, [w, 44], [x0, 0, 10], { minSpacing: 2.2, scaleRange: [0.7, 1.3] });
  }

  // Village life: a cart, hay and a barrel by the east houses, a lantern at each gate pillar.
  b.asset('cart', 'cart', [19, 0, 12.5], { yaw: 25, physics: 'static', footprint: 2.4 });
  b.asset('hay', 'hay-bale', [18.2, 0, 9.4], { yaw: 10, physics: 'static', footprint: 1.2 });
  b.asset('hay', 'hay-bale', [19.6, 0, 9.1], { yaw: 40, physics: 'static', footprint: 1.2 });
  b.asset('barrel', 'barrel-realistic', [-20, 0, 24], { physics: 'static', footprint: 0.8 });
  for (const sx of [-1, 1]) lamp(b, sx * 3.4, -12.2, '#ffcf8a', 3.4, true);

  // --- The west woods, where the wolves live ------------------------------------------------------
  b.reserve(-28, 4, 4.4); // the pack's clearing
  for (let i = 0; i < 14; i++) {
    const p = b.spot(-28.5, 4, 1, 9.5, 1.6);
    if (p) b.gen('pine', 'tree-pine', { height: r2(b.rand(6, 9)) }, [p[0], 0, p[1]], { yaw: r2(b.rand(0, 360)), physics: 'static', tags: ['tree'] });
  }
  // Moonlight breaks through the canopy over the clearing, so the pack can be seen.
  b.light(b.empty('moon-shaft', [-28, 7, 4], { name: 'Moon shaft' }), [0, 0, 0], '#9db8ff', 3.2, 16);
  for (let i = 0; i < 5; i++) {
    const p = b.spot(-22, 4, 3, 12, 1.2);
    if (p) b.gen('rock', 'rock', { size: r2(b.rand(0.9, 1.7)), mossy: true }, [p[0], 0, p[1]], { yaw: r2(b.rand(0, 360)), physics: 'static', tags: ['rock'] });
  }

  // --- Fire: the one thing the wolves respect -----------------------------------------------------
  campfire(b, -5, 16);
  campfire(b, 7, -6);
  b.gen('barrel', 'barrel', {}, [-8.6, 0, 20], { physics: 'static', footprint: 0.7 });
  b.gen('crate', 'crate', { size: 1 }, [-9.6, 0, 20.4], { physics: 'static', footprint: 0.8 });

  // --- The characters ----------------------------------------------------------------------------------------
  // Marek the guard: patrols the road before the gate with a torch.
  const guard = placeNpc(b, kind('guard'), -9, -10.8, {
    name: 'Marek',
    yaw: -90,
    waypoints: [[-9, 0, -10.8], [9, 0, -10.8]],
    patrol: 'pingpong',
    carries: ['torch'],
    // His torch is in his hand (he patrols at night); the wardrobe's spear would take the hand.
    character: { hold: 'torch' },
    dialogue: guardDialogue(b, 'Marek', 'gate'),
    tags: ['guard-post'],
  });
  addTorch(b, guard.id, 1.7, true);

  // Mira the shopkeeper: a stall by the fire, the key for five gold.
  placeNpc(b, kind('merchant'), -12, 18.5, {
    name: 'Mira',
    yaw: -80,
    dialogue: shopDialogue('Mira', { item: 'key', price: 5, currency: 'coins', door: gate.id, greeting: 'Welcome to the hollow, traveller! Mira, at your service. Looking for the way out? Only one key opens that gate, and I sell it.' }),
  });
  marketStall(b, -10.9, 18.3, -80);

  // Three wolves hunt the west woods at night.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    placeNpc(b, kind('wolf'), r2(-28 + Math.cos(a) * 2.6), r2(4 + Math.sin(a) * 2.6), { name: `Wolf ${i + 1}`, yaw: r2((-a * 180) / Math.PI + 90), hours: [19, 6], wander: 8 });
  }

  // Two villagers who know how it all works.
  placeNpc(b, kind('villager'), 15, 14, {
    name: 'Ada',
    yaw: 90,
    wander: 4,
    dialogue: lore('Evening. You look like someone who wants out.', [
      ['How do I leave?', 'The gate answers to a key, and Mira sells it for five gold. There is gold lying about the hollow, if you are brave enough to pick it up.'],
      ['What about the guard?', 'Marek hears boots, not footsteps. Hold Shift to creep and he will not hear you at all. He does see well, though, in front of him.'],
    ]),
  });
  placeNpc(b, kind('villager'), 13, 25, {
    name: 'Bram',
    yaw: 180,
    wander: 3,
    dialogue: lore('Mind the west woods after dark.', [
      ['Why?', 'Wolves. Three of them, and they hunt as one. If one sees you, they all know.'],
      ['How do I stay safe?', 'Fire. The wolves will not come near a flame, not even the guard’s torch. Keep close to a campfire and they will circle at a distance.'],
    ]),
  });

  // --- Gold to pay for the key (a handful are close to the wolves) --------------------------------------
  const GOLD: V3[] = [[3, 0.9, 21], [-2, 0.9, 10], [11, 0.9, 7], [-8, 0.9, 6], [14, 0.9, -3], [-16, 0.9, 12]];
  for (const p of GOLD) {
    // A gold coin: a thick disc of warm gold that glows a little (it must read at night), with a darker milled rim.
    const coin = b.prim('gold', 'cylinder', [0.56, 0.08, 0.56], p, {
      name: 'Gold coin',
      rot: [90, 0, 0],
      material: { preset: 'gold', color: '#f0b838', roughness: 0.28, metalness: 0.95, emissive: '#b87a10', emissiveIntensity: 0.4 },
      behaviors: [
        { type: 'spin', params: { axis: [0, 0, 1], speed: 140 } },
        { type: 'bob', params: { amplitude: 0.15 } },
        { type: 'collectible', params: { scoreKey: 'coins', value: 2, margin: 1.1, message: 'Gold!' } },
      ],
      tags: ['coin'],
      castShadow: false,
    });
    b.prim('gold-rim', 'torus', [0.56, 0.05, 0.56], [0, 0, 0], { parent: coin, rot: [90, 0, 0], material: { preset: 'gold', color: '#b9852a', roughness: 0.35, metalness: 0.9, emissive: '#7a4e0c', emissiveIntensity: 0.4 }, castShadow: false });
  }

  // --- Rules and proof ----------------------------------------------------------------------------------------------
  b.rule({ id: 'welcome', when: { on: 'start' }, then: [{ do: 'message', text: 'The gate is locked. Mira sells the key, if you can pay.', duration: 5 }] });
  b.rule({ id: 'got-key', when: { on: 'state', key: 'key', op: '>=', value: 1 }, then: [{ do: 'message', text: 'You have the key. Get to the gate!', duration: 4 }], once: true });
  b.rule({ id: 'reset-key', when: { on: 'key', key: 'r' }, then: [{ do: 'reset' }] });
  b.test({ id: 'npcs-work', kind: 'npcs', target: '#npc', seconds: 16, stuckAfter: 5 });
  b.test({ id: 'gold-stays', kind: 'staysAbove', target: '#coin', y: 0.4, within: 5 });

  return finish(b, {
    name: 'The Hollow Gate',
    description: 'A walled hamlet at night: earn gold, buy the key from Mira, slip past Marek the guard, outwit the wolves and leave through the gate.',
    intro: {
      title: 'The Hollow Gate',
      tagline: 'A walled hamlet at night. A locked gate. A guard who listens, a shopkeeper who sells, wolves that fear fire.',
      objective: 'Collect gold (five buys the key), buy the key from Mira, slip past Marek and leave through the gate.',
      controls: ['WASD — walk', 'Shift — sneak', 'E — talk', '1–3 — choose', 'Esc — stop'],
      accent: '#f2c46d',
    },
    plan: 'Plan: The Hollow Gate — walled hamlet, locked gate, guard + shopkeeper + wolf pack + villagers.',
    message: 'Built The Hollow Gate: Marek patrols with a torch and chases what he sees or hears, Mira sells the gate key for five gold, three wolves hunt the west woods after dark and fear fire. Collect gold, press E to talk, hold Shift to sneak, and leave through the gate.',
  });
}
