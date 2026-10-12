/**
 * Few-shot examples embedded in the system prompt. They are plain data so the
 * test-suite can prove every example applies to an empty world with zero
 * patch errors (a wrong example teaches the model wrong IR).
 */
import type { PatchInput } from '@aether/core';

/** One worked example: a user request and the apply_patches call that fulfils it. */
export interface PromptExample {
  request: string;
  message: string;
  patches: PatchInput[];
}

function domino(i: number): PatchInput {
  return {
    op: 'add',
    entity: {
      id: `domino-${i}`,
      tags: ['domino'],
      transform: { position: [i * 0.55, 0.5, 0] },
      shape: { kind: 'primitive', primitive: 'box', size: [0.15, 1, 0.5] },
      material: { preset: 'plastic', color: i % 2 === 0 ? '#e63946' : '#f1faee' },
      physics: i === 1 ? { body: 'dynamic', mass: 0.4, initialAngularVelocity: [0, 0, -2.5] } : { body: 'dynamic', mass: 0.4 },
    },
  };
}

function coin(i: number, x: number, z: number): PatchInput {
  return {
    op: 'add',
    entity: {
      id: `coin-${i}`,
      name: 'Coin',
      tags: ['coin'],
      transform: { position: [x, 1, z], rotation: [90, 0, 0] },
      shape: { kind: 'primitive', primitive: 'cylinder', size: [0.8, 0.12, 0.8] },
      material: { preset: 'gold', emissive: '#ffb703', emissiveIntensity: 0.4 },
      behaviors: [{ type: 'spin', params: { axis: [0, 0, 1], speed: 120 } }, { type: 'bob', params: { amplitude: 0.2 } }, { type: 'collectible', params: { scoreKey: 'score' } }],
    },
  };
}

/** The worked examples shown to the planner. */
export const PROMPT_EXAMPLES: readonly PromptExample[] = [
  {
    request: 'a domino run that knocks over a bell',
    message: 'Domino run ringing a bell',
    patches: [
      { op: 'setMeta', name: 'Domino Run' },
      { op: 'setEnvironment', set: { sky: 'day', timeOfDay: 16, ground: { material: { preset: 'wood', color: '#c8a27a' } } } },
      { op: 'setPlayer', set: { mode: 'orbit', spawn: [2, 3, 7] } },
      ...[1, 2, 3, 4, 5, 6].map(domino),
      {
        op: 'add',
        entity: {
          id: 'bell',
          name: 'Bell',
          transform: { position: [3.85, 0.4, 0] },
          shape: { kind: 'primitive', primitive: 'cone', size: [0.6, 0.8, 0.6] },
          material: { preset: 'gold' },
          physics: { body: 'dynamic', mass: 0.3 },
        },
      },
      { op: 'setState', key: 'rang', value: false },
      {
        op: 'addRule',
        rule: { id: 'ring-bell', when: { on: 'collision', a: '#domino', b: 'bell' }, then: [{ do: 'sound', sound: 'bell' }, { do: 'set', key: 'rang', value: true }, { do: 'message', text: 'Ding!' }], once: true },
      },
      { op: 'addTest', test: { id: 'chain-falls', kind: 'topples', target: 'domino-6', within: 8 } },
      { op: 'addTest', test: { id: 'bell-rings', kind: 'eventually', condition: { key: 'rang', op: '==', value: true }, within: 10 } },
    ],
  },
  {
    request: 'collect 5 coins before time runs out',
    message: 'Coin hunt with a 45 s timer',
    patches: [
      { op: 'setMeta', name: 'Coin Hunt' },
      { op: 'setEnvironment', set: { sky: 'day', timeOfDay: 10, bloom: 0.6 } },
      { op: 'setPlayer', set: { mode: 'thirdPerson', spawn: [0, 1, 10] } },
      coin(1, -6, 0), coin(2, 6, 0), coin(3, 0, -8), coin(4, -9, -12), coin(5, 9, -12),
      { op: 'add', entity: { id: 'rock-1', transform: { position: [3, 0, -4] }, shape: { kind: 'procedural', generator: 'rock', params: { size: 2, mossy: true } }, physics: { body: 'static' } } },
      { op: 'setState', key: 'score', value: 0 },
      { op: 'setState', key: 'timeLeft', value: 45 },
      { op: 'setHud', hud: [{ key: 'score', label: 'Coins' }, { key: 'timeLeft', label: 'Time' }] },
      { op: 'addRule', rule: { id: 'countdown', when: { on: 'tick', every: 1 }, if: [{ key: 'timeLeft', op: '>', value: 0 }], then: [{ do: 'add', key: 'timeLeft', amount: -1 }] } },
      { op: 'addRule', rule: { id: 'win', when: { on: 'state', key: 'score', op: '>=', value: 5 }, then: [{ do: 'win', text: 'All coins collected!' }], once: true } },
      { op: 'addRule', rule: { id: 'lose', when: { on: 'state', key: 'timeLeft', op: '<=', value: 0 }, then: [{ do: 'lose', text: "Time's up!" }], once: true } },
      { op: 'addTest', test: { id: 'timer-runs', kind: 'eventually', condition: { key: 'timeLeft', op: '<=', value: 43 }, within: 5 } },
      { op: 'addTest', test: { id: 'coins-float', kind: 'staysAbove', target: '#coin', y: 0.5, within: 5 } },
    ],
  },
  {
    request: '(edit) make it a foggy night and light the lamps',
    message: 'Foggy night',
    patches: [
      { op: 'setEnvironment', set: { sky: 'night', timeOfDay: 22, fog: { color: '#0b1026', density: 0.025 }, weather: 'fireflies', bloom: 1.2 } },
      { op: 'update', id: 'lamp-1', set: { light: { type: 'point', color: '#ffd27a', intensity: 3, range: 12 } } },
    ],
  },
];
