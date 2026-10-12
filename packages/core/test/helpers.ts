import { createWorld, type EntityInput, type WorldDoc, type WorldDocInput } from '../src/index';

/** Recursively freeze a value (proves functions never mutate their inputs). */
export function deepFreeze<T>(v: T): T {
  if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
}

/** Minimal entity input. */
export function ent(id: string, extra: Partial<EntityInput> = {}): EntityInput {
  return { id, ...extra };
}

/** A small but representative world used across tests (frozen). */
export function sampleWorld(extra: WorldDocInput = {}): WorldDoc {
  return deepFreeze(
    createWorld({
      name: 'Coin Run',
      state: { score: 0 },
      hud: [{ key: 'score', label: 'Score' }],
      entities: {
        floor: { id: 'floor', name: 'Floor', shape: { kind: 'primitive', primitive: 'box', size: [20, 1, 20] }, transform: { position: [0, -0.5, 0] }, physics: { body: 'static' } },
        car: { id: 'car', name: 'Red Car', tags: ['vehicle'], shape: { kind: 'primitive', primitive: 'box', size: [2, 1, 4] }, physics: { body: 'dynamic' }, transform: { position: [0, 1, 0] } },
        wheel: { id: 'wheel', parent: 'car', shape: { kind: 'primitive', primitive: 'cylinder', size: [0.6, 0.3, 0.6] }, joint: { type: 'revolute', target: 'car' } },
        hub: { id: 'hub', parent: 'wheel' },
        coin: { id: 'coin', tags: ['coin'], state: { value: 1 }, behaviors: [{ type: 'spin', params: { speed: 2 } }] },
        grass: { id: 'grass', shape: { kind: 'scatter', of: { kind: 'primitive', primitive: 'cone' }, count: 100, area: [10, 10], onSurface: 'floor' } },
      },
      player: { controls: 'car', mode: 'vehicle' },
      rules: [
        { id: 'pickup', when: { on: 'enter', zone: '#coin' }, if: [{ key: 'score', op: '<', value: 10 }], then: [{ do: 'add', key: 'score', amount: 1 }, { do: 'destroy', target: 'coin' }] },
        { id: 'crash', when: { on: 'collision', a: 'car', b: 'floor' }, then: [{ do: 'set', key: 'car.crashed', value: true }] },
      ],
      tests: [{ id: 'car-stays', kind: 'staysAbove', target: 'car' }],
      ...extra,
    }),
  );
}
