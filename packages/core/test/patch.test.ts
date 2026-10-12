import { describe, expect, it } from 'vitest';
import {
  applyPatches,
  createWorld,
  LIMITS,
  validateWorld,
  type Entity,
  type PatchInput,
  type WorldDoc,
} from '../src/index';
import { deepFreeze, sampleWorld } from './helpers';

function apply(world: WorldDoc, patches: unknown[], atomic = false) {
  const r = applyPatches(world, patches, { atomic });
  // every resulting world must still be fully valid
  const v = validateWorld(JSON.parse(JSON.stringify(r.world)));
  if (!v.ok) throw new Error(`result invalid: ${JSON.stringify(v.issues)}`);
  return r;
}

function only(world: WorldDoc, patch: PatchInput | Record<string, unknown>): string {
  const r = applyPatches(world, [patch]);
  expect(r.applied).toHaveLength(0);
  expect(r.errors).toHaveLength(1);
  expect(r.world).toBe(world);
  return r.errors[0]!.message;
}

const e = (w: WorldDoc, id: string): Entity => w.entities[id]!;

describe('applyPatches: batch handling', () => {
  it('returns the same world for an empty batch and never throws on garbage', () => {
    const w = sampleWorld();
    expect(applyPatches(w, []).world).toBe(w);
    for (const bad of [null, 1, 'x', [], { op: 'nope' }, { op: 'add' }, { op: 'update', id: 'car' }]) {
      const r = applyPatches(w, [bad]);
      expect(r.world).toBe(w);
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]!.index).toBe(0);
    }
    expect(applyPatches(w, 'nope' as unknown as unknown[]).errors[0]!.index).toBe(-1);
  });

  it('reports invalid ops with the list of valid ones', () => {
    const msg = only(sampleWorld(), { op: 'explode' });
    expect(msg).toMatch(/^explode: op must be one of add\|update\|remove\|rename\|/);
  });

  it('rejects oversized batches', () => {
    const r = applyPatches(sampleWorld(), new Array(LIMITS.MAX_PATCHES_PER_CALL + 1).fill({ op: 'clear' }));
    expect(r.errors).toEqual([{ index: -1, op: 'batch', message: expect.stringContaining('too many patches') }]);
  });

  it('applies valid patches and reports invalid ones independently (non-atomic)', () => {
    const w = sampleWorld();
    const r = apply(w, [
      { op: 'add', entity: { id: 'a' } },
      { op: 'add', entity: { id: 'car' } },
      { op: 'setState', key: 'lives', value: 3 },
    ]);
    expect(r.applied.map((p) => p.op)).toEqual(['add', 'setState']);
    expect(r.errors.map((x) => x.index)).toEqual([1]);
    expect(r.world.entities['a']).toBeDefined();
    expect(r.world.state['lives']).toBe(3);
  });

  it('atomic: any failure returns the original world and all errors', () => {
    const w = sampleWorld();
    const r = applyPatches(w, [{ op: 'add', entity: { id: 'a' } }, { op: 'remove', id: 'ghost' }, { op: 'bad' }], { atomic: true });
    expect(r.world).toBe(w);
    expect(r.applied).toEqual([]);
    expect(r.errors.map((x) => x.index)).toEqual([1, 2]);
    const ok = applyPatches(w, [{ op: 'add', entity: { id: 'a' } }], { atomic: true });
    expect(ok.errors).toEqual([]);
    expect(ok.world.entities['a']).toBeDefined();
  });

  it('never mutates the input world or patches (deep-frozen)', () => {
    const w = sampleWorld(); // frozen
    const patches = deepFreeze([
      { op: 'add', entity: { id: 'n', parent: 'car' } },
      { op: 'update', id: 'car', set: { transform: { position: [1, 2, 3] }, state: { fuel: 1 } } },
      { op: 'remove', id: 'wheel' },
      { op: 'rename', id: 'coin', newId: 'gem' },
      { op: 'addRule', rule: { id: 'r2', when: { on: 'start' }, then: [{ do: 'reset' }] } },
      { op: 'updateRule', id: 'pickup', set: { once: true } },
      { op: 'removeRule', id: 'crash' },
      { op: 'setEnvironment', set: { sky: 'night', fog: { color: '#000000', density: 0.1 } } },
      { op: 'setPlayer', set: { moveSpeed: 9 } },
      { op: 'setState', key: 'score', value: 2 },
      { op: 'setHud', hud: [] },
      { op: 'defineGenerator', generator: { id: 'gen', description: 'd', source: 'return api.build()' } },
      { op: 'defineScript', script: { id: 'scr', description: 'd', source: 'return []' } },
      { op: 'addTest', test: { id: 't2', kind: 'noOverlap' } },
      { op: 'removeTest', id: 'car-stays' },
      { op: 'setMeta', name: 'New' },
    ]);
    const r = apply(w, patches);
    expect(r.errors).toEqual([]);
    expect(r.applied).toHaveLength(patches.length);
    expect(w.entities['wheel']).toBeDefined(); // original untouched
  });
});

describe('applyPatches: structural sharing', () => {
  it('keeps identity of untouched entities and containers', () => {
    const w = sampleWorld();
    const r = apply(w, [{ op: 'update', id: 'car', set: { name: 'Blue Car' } }]);
    expect(r.world).not.toBe(w);
    expect(r.world.entities).not.toBe(w.entities);
    expect(r.world.entities['car']).not.toBe(w.entities['car']);
    for (const id of ['floor', 'wheel', 'hub', 'coin', 'grass']) expect(r.world.entities[id]).toBe(w.entities[id]);
    expect(r.world.rules).toBe(w.rules);
    expect(r.world.environment).toBe(w.environment);
    expect(r.world.player).toBe(w.player);
    expect(r.world.state).toBe(w.state);
  });

  it('no-op updates keep the very same world object', () => {
    const w = sampleWorld();
    const r = apply(w, [
      { op: 'update', id: 'car', set: { name: 'Red Car' } },
      { op: 'setEnvironment', set: { sky: 'day' } },
      { op: 'setState', key: 'score', value: 0 },
      { op: 'updateRule', id: 'pickup', set: { once: false } },
      { op: 'setMeta', name: 'Coin Run' },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.applied).toHaveLength(5);
    expect(r.world).toBe(w);
  });
});

describe('add', () => {
  it('adds with defaults', () => {
    const r = apply(createWorld(), [{ op: 'add', entity: { id: 'box', shape: { kind: 'primitive', primitive: 'box' } } }]);
    expect(e(r.world, 'box')).toMatchObject({ parent: null, shape: { size: [1, 1, 1] }, transform: { position: [0, 0, 0] } });
  });

  it('rejects duplicates with a suggested free id', () => {
    expect(only(sampleWorld(), { op: 'add', entity: { id: 'car' } })).toBe(
      "add entity 'car': entity 'car' already exists — use 'update' to modify it, or add it with a new id, such as 'car-2'",
    );
  });

  it('rejects duplicates inside one batch', () => {
    const r = applyPatches(createWorld(), [{ op: 'add', entity: { id: 'a' } }, { op: 'add', entity: { id: 'a' } }]);
    expect(r.applied).toHaveLength(1);
    expect(r.errors[0]!.index).toBe(1);
  });

  it('validates ids and fields with precise messages', () => {
    expect(only(createWorld(), { op: 'add', entity: { id: 'Bad Id' } })).toMatch(/^add entity 'Bad Id': entity\.id must be a lowercase slug/);
    expect(only(createWorld(), { op: 'add', entity: { id: 'x', physics: { body: 'flying' } } })).toBe(
      "add entity 'x': entity.physics.body must be one of static|dynamic|kinematic",
    );
    expect(only(createWorld(), { op: 'add', entity: { id: 'x', transform: { position: [0, 1] } } })).toBe(
      "add entity 'x': entity.transform.position must have at least 3 item(s)",
    );
  });

  it('reports unknown (misspelled) fields instead of silently dropping them', () => {
    expect(only(createWorld(), { op: 'add', entity: { id: 'x', colour: '#ff0000' } })).toMatch(
      /^add entity 'x': entity\.colour is not a known field — did you mean 'color'\?|^add entity 'x': entity\.colour is not a known field/,
    );
    expect(only(createWorld(), { op: 'add', entity: { id: 'x', physics: { bodyType: 'dynamic' } } })).toMatch(
      /entity\.physics\.bodyType is not a known field — did you mean 'body'\? \(valid: body, collider/,
    );
    expect(only(createWorld(), { op: 'add', entitiy: { id: 'x' } })).toMatch(/entitiy is not a known field — did you mean 'entity'\?/);
  });

  it('checks references: parent, joint target, scatter surface, self references', () => {
    const w = sampleWorld();
    expect(only(w, { op: 'add', entity: { id: 'x', parent: 'cr' } })).toBe("add entity 'x': parent entity 'cr' does not exist — did you mean 'car'?");
    expect(only(w, { op: 'add', entity: { id: 'x', parent: 'x' } })).toBe("add entity 'x': parent cannot be the entity itself");
    expect(only(w, { op: 'add', entity: { id: 'x', joint: { type: 'fixed', target: 'nobody' } } })).toMatch(/joint\.target entity 'nobody' does not exist .*"world"/);
    expect(only(w, { op: 'add', entity: { id: 'x', joint: { type: 'fixed', target: 'x' } } })).toMatch(/joint\.target cannot be the entity itself/);
    expect(only(w, { op: 'add', entity: { id: 'x', shape: { kind: 'scatter', of: { kind: 'primitive', primitive: 'box' }, count: 1, area: [1, 1], onSurface: 'nope' } } })).toMatch(
      /shape\.onSurface entity 'nope' does not exist/,
    );
    expect(apply(w, [{ op: 'add', entity: { id: 'x', joint: { type: 'fixed', target: 'world' } } }]).errors).toEqual([]);
  });

  it('supports forward references within a batch (child before parent, joints both ways)', () => {
    const r = apply(createWorld(), [
      { op: 'add', entity: { id: 'child', parent: 'parent' } },
      { op: 'add', entity: { id: 'grandchild', parent: 'child' } },
      { op: 'setPlayer', set: { controls: 'parent' } },
      { op: 'add', entity: { id: 'parent' } },
    ]);
    expect(r.errors).toEqual([]);
    expect(Object.keys(r.world.entities).sort()).toEqual(['child', 'grandchild', 'parent']);
    expect(r.world.player.controls).toBe('parent');
    expect(r.applied.map((p) => (p.op === 'add' ? p.entity.id : p.op))).toEqual(['parent', 'child', 'grandchild', 'setPlayer']);
  });

  it('reports forward references that never resolve', () => {
    const r = applyPatches(createWorld(), [
      { op: 'add', entity: { id: 'child', parent: 'parent' } },
      { op: 'add', entity: { id: 'parent', physics: { body: 'nope' } } },
    ]);
    expect(r.errors.map((x) => x.index)).toEqual([0, 1]);
    expect(r.errors[0]!.message).toMatch(/parent entity 'parent' does not exist/);
  });

  it('reports mutual joint deadlocks instead of looping', () => {
    const r = applyPatches(createWorld(), [
      { op: 'add', entity: { id: 'a', joint: { type: 'fixed', target: 'b' } } },
      { op: 'add', entity: { id: 'b', joint: { type: 'fixed', target: 'a' } } },
    ]);
    expect(r.errors).toHaveLength(2);
    expect(r.applied).toHaveLength(0);
  });

  it('rejects reserved ids', () => {
    // 'constructor' is a valid slug syntactically but reserved
    const r = applyPatches(createWorld(), [{ op: 'add', entity: { id: 'prototype' } }]);
    expect(r.errors[0]!.message).toMatch(/reserved/);
  });
});

describe('update', () => {
  it('deep-merges objects and replaces arrays', () => {
    const w = sampleWorld();
    const r = apply(w, [{ op: 'update', id: 'car', set: { transform: { position: [5, 1, 0] }, tags: ['fast'], physics: { mass: 1200 } } }]);
    const car = e(r.world, 'car');
    expect(car.transform.position).toEqual([5, 1, 0]);
    expect(car.transform.scale).toEqual([1, 1, 1]);
    expect(car.tags).toEqual(['fast']);
    expect(car.physics).toMatchObject({ body: 'dynamic', mass: 1200 });
  });

  it('re-validates the entity and returns actionable messages', () => {
    const w = sampleWorld();
    expect(only(w, { op: 'update', id: 'car', set: { physics: { body: 'flying' } } })).toBe(
      "entity 'car' update: physics.body must be one of static|dynamic|kinematic",
    );
    expect(only(w, { op: 'update', id: 'car', set: { physics: { friction: 99 } } })).toBe("entity 'car' update: physics.friction must be <= 5");
    expect(only(w, { op: 'update', id: 'car', set: { material: { color: 'blue' } } })).toBe("entity 'car' update: material.color must be a hex color \"#rrggbb\"");
    expect(only(w, { op: 'update', id: 'car', set: { colr: '#ffffff' } })).toMatch(/^entity 'car' update: colr is not a known field/);
    expect(only(w, { op: 'update', id: 'car', set: { shape: { primitive: 'blob' } } })).toMatch(/shape\.primitive must be one of box\|sphere/);
  });

  it('null deletes optional fields; parent null un-parents', () => {
    const w = sampleWorld();
    const r = apply(w, [
      { op: 'update', id: 'car', set: { physics: null } },
      { op: 'update', id: 'wheel', set: { parent: null, joint: null } },
      { op: 'update', id: 'coin', set: { state: { value: null, extra: 2 } } },
    ]);
    expect(e(r.world, 'car').physics).toBeUndefined();
    expect(e(r.world, 'wheel').parent).toBeNull();
    expect(e(r.world, 'wheel').joint).toBeUndefined();
    expect(e(r.world, 'coin').state).toEqual({ extra: 2 });
  });

  it('replaces the shape when its kind changes (no stale fields)', () => {
    const w = sampleWorld();
    const r = apply(w, [{ op: 'update', id: 'car', set: { shape: { kind: 'procedural', generator: 'car', params: { length: 4 } } } }]);
    expect(e(r.world, 'car').shape).toEqual({ kind: 'procedural', generator: 'car', params: { length: 4 } });
  });

  it('rejects id changes, unknown entities (with hints) and cycles', () => {
    const w = sampleWorld();
    expect(only(w, { op: 'update', id: 'car', set: { id: 'truck' } })).toMatch(/use \{"op":"rename"/);
    expect(only(w, { op: 'update', id: 'cars', set: { name: 'x' } })).toBe("entity 'cars' update: entity 'cars' does not exist — did you mean 'car'?");
    expect(only(w, { op: 'update', id: 'car', set: { parent: 'hub' } })).toBe("entity 'car' update: parent 'hub' would create a cycle ('hub' is inside 'car')");
    expect(only(w, { op: 'update', id: 'car', set: { parent: 'car' } })).toBe("entity 'car' update: parent cannot be the entity itself");
    expect(only(w, { op: 'update', id: 'car', set: { joint: { type: 'fixed', target: 'ghost' } } })).toMatch(/joint\.target entity 'ghost' does not exist/);
    expect(apply(w, [{ op: 'update', id: 'car', set: { id: 'car', name: 'same id ok' } }]).errors).toEqual([]);
  });

  it('does not resolve prototype members as entities', () => {
    expect(only(sampleWorld(), { op: 'update', id: 'tostring', set: { name: 'x' } })).toMatch(/does not exist/);
    expect(only(sampleWorld(), { op: 'remove', id: 'valueof' })).toMatch(/does not exist/);
  });

  it('enforces hierarchy depth on reparenting', () => {
    const patches: PatchInput[] = [];
    for (let i = 0; i <= LIMITS.MAX_HIERARCHY_DEPTH; i++) patches.push({ op: 'add', entity: { id: `n${i}`, parent: i === 0 ? null : `n${i - 1}` } });
    patches.push({ op: 'add', entity: { id: 'a' } }, { op: 'add', entity: { id: 'b', parent: 'a' } });
    const w = apply(createWorld(), patches).world;
    expect(only(w, { op: 'add', entity: { id: 'too-deep', parent: `n${LIMITS.MAX_HIERARCHY_DEPTH}` } })).toMatch(/hierarchy would exceed 64 levels/);
    expect(apply(w, [{ op: 'add', entity: { id: 'deepest', parent: `n${LIMITS.MAX_HIERARCHY_DEPTH - 1}` } }]).errors).toEqual([]);
    expect(only(w, { op: 'update', id: 'a', set: { parent: `n${LIMITS.MAX_HIERARCHY_DEPTH - 1}` } })).toMatch(/hierarchy would exceed/);
    expect(apply(w, [{ op: 'update', id: 'a', set: { parent: `n${LIMITS.MAX_HIERARCHY_DEPTH - 2}` } }]).errors).toEqual([]);
  });
});

describe('remove', () => {
  it('recursively removes descendants and clears dangling references', () => {
    const w = sampleWorld();
    const r = apply(w, [
      { op: 'add', entity: { id: 'trailer', joint: { type: 'spherical', target: 'car' } } },
      { op: 'remove', id: 'car' },
    ]);
    expect(Object.keys(r.world.entities).sort()).toEqual(['coin', 'floor', 'grass', 'trailer']);
    expect(e(r.world, 'trailer').joint).toBeUndefined();
    expect(r.world.player.controls).toBeUndefined();
  });

  it('non-recursive removal re-parents children to the grandparent', () => {
    const r = apply(sampleWorld(), [{ op: 'remove', id: 'wheel', recursive: false }]);
    expect(e(r.world, 'hub').parent).toBe('car');
    expect(r.world.entities['wheel']).toBeUndefined();
  });

  it('clears scatter surfaces pointing at removed entities', () => {
    const r = apply(sampleWorld(), [{ op: 'remove', id: 'floor' }]);
    const grass = e(r.world, 'grass');
    expect(grass.shape.kind === 'scatter' && grass.shape.onSurface).toBeUndefined();
  });

  it('errors for unknown ids', () => {
    expect(only(sampleWorld(), { op: 'remove', id: 'ghost' })).toBe("remove entity 'ghost': entity 'ghost' does not exist");
  });
});

describe('rename', () => {
  it('rewrites every reference', () => {
    const w = sampleWorld({
      hud: [{ key: 'car.crashed', label: 'Crashed' }],
      entities: {
        car: { id: 'car', tags: ['vehicle'] },
        wheel: { id: 'wheel', parent: 'car', joint: { type: 'revolute', target: 'car' } },
        cam: { id: 'cam', behaviors: [{ type: 'follow', params: { target: 'car', list: ['car', 'x'], other: 'carx' } }] },
        pad: { id: 'pad', shape: { kind: 'scatter', of: { kind: 'primitive', primitive: 'box' }, count: 1, area: [1, 1], onSurface: 'car' } },
        tpl: { id: 'tpl', template: true },
      },
      rules: [
        { id: 'r1', when: { on: 'collision', a: 'car', b: '#wall' }, if: [{ key: 'car.speed', op: '>', value: 3 }], then: [{ do: 'impulse', target: 'car', vector: [0, 1, 0] }, { do: 'teleport', target: 'cam', to: 'car' }] },
        { id: 'r2', when: { on: 'state', key: 'car.hp', op: '<=', value: 0 }, then: [{ do: 'set', key: 'car.dead', value: true }, { do: 'add', key: 'score', amount: 1 }, { do: 'spawn', template: 'tpl', at: 'car' }] },
      ],
      tests: [{ id: 't1', kind: 'reaches', target: 'car', zone: 'pad' }, { id: 't2', kind: 'eventually', condition: { key: 'car.dead', op: '==', value: true } }],
      player: { controls: 'car' },
    });
    const r = apply(w, [{ op: 'rename', id: 'car', newId: 'truck' }]);
    expect(r.errors).toEqual([]);
    const x = r.world;
    expect(Object.keys(x.entities)).toEqual(['truck', 'wheel', 'cam', 'pad', 'tpl']); // order preserved
    expect(e(x, 'truck').id).toBe('truck');
    expect(e(x, 'wheel').parent).toBe('truck');
    expect(e(x, 'wheel').joint!.target).toBe('truck');
    expect(e(x, 'cam').behaviors[0]!.params).toEqual({ target: 'truck', list: ['truck', 'x'], other: 'carx' });
    const pad = e(x, 'pad');
    expect(pad.shape.kind === 'scatter' && pad.shape.onSurface).toBe('truck');
    expect(x.player.controls).toBe('truck');
    expect(x.hud[0]!.key).toBe('truck.crashed');
    expect(x.rules[0]!.when).toMatchObject({ a: 'truck', b: '#wall' });
    expect(x.rules[0]!.if[0]!.key).toBe('truck.speed');
    expect(x.rules[0]!.then).toMatchObject([{ target: 'truck' }, { target: 'cam', to: 'truck' }]);
    expect(x.rules[1]!.when).toMatchObject({ key: 'truck.hp' });
    expect(x.rules[1]!.then).toMatchObject([{ key: 'truck.dead' }, { key: 'score' }, { template: 'tpl', at: 'truck' }]);
    expect(x.tests[0]).toMatchObject({ target: 'truck', zone: 'pad' });
    expect(x.tests[1]).toMatchObject({ condition: { key: 'truck.dead' } });
    expect(e(x, 'tpl')).toBe(w.entities['tpl']); // untouched entities keep identity
  });

  it('rejects collisions, unknown ids and reserved ids; same id is a no-op', () => {
    const w = sampleWorld();
    expect(only(w, { op: 'rename', id: 'car', newId: 'coin' })).toMatch(/entity 'coin' already exists — choose a free id, such as 'coin-2'/);
    expect(only(w, { op: 'rename', id: 'nope', newId: 'x' })).toMatch(/does not exist/);
    expect(only(w, { op: 'rename', id: 'car', newId: 'constructor' })).toMatch(/reserved/);
    expect(apply(w, [{ op: 'rename', id: 'car', newId: 'car' }]).world).toBe(w);
  });
});

describe('rules', () => {
  const rule = { id: 'r9', when: { on: 'key', key: 'e' }, then: [{ do: 'message', text: 'hi' }] };

  it('add / update / remove', () => {
    const w = sampleWorld();
    let r = apply(w, [{ op: 'addRule', rule }]);
    expect(r.world.rules.map((x) => x.id)).toEqual(['pickup', 'crash', 'r9']);
    r = apply(r.world, [{ op: 'updateRule', id: 'r9', set: { when: { on: 'timer', at: 5 }, once: true } }]);
    expect(r.world.rules[2]).toMatchObject({ when: { on: 'timer', at: 5 }, once: true });
    expect(r.world.rules[2]!.when).not.toHaveProperty('key');
    r = apply(r.world, [{ op: 'updateRule', id: 'r9', set: { then: [{ do: 'win' }] } }]);
    expect(r.world.rules[2]!.then).toEqual([{ do: 'win', text: 'You win!' }]);
    r = apply(r.world, [{ op: 'removeRule', id: 'r9' }]);
    expect(r.world.rules).toBe(r.world.rules);
    expect(r.world.rules.map((x) => x.id)).toEqual(['pickup', 'crash']);
  });

  it('validates rules', () => {
    const w = sampleWorld();
    expect(only(w, { op: 'addRule', rule: { ...rule, id: 'pickup' } })).toMatch(/rule 'pickup' already exists/);
    expect(only(w, { op: 'addRule', rule: { id: 'x', when: { on: 'click', target: 'Not Valid' }, then: [{ do: 'reset' }] } })).toMatch(/invalid selector 'Not Valid'/);
    expect(only(w, { op: 'addRule', rule: { id: 'x', when: { on: 'start' }, then: [{ do: 'fly' }] } })).toMatch(/rule\.then\.0\.do must be one of set\|add/);
    expect(only(w, { op: 'updateRule', id: 'pickup', set: { then: [] } })).toBe("updateRule 'pickup': then must have at least 1 item(s)");
    expect(only(w, { op: 'updateRule', id: 'pickup', set: { id: 'other' } })).toMatch(/cannot change a rule's id/);
    expect(only(w, { op: 'updateRule', id: 'pickp', set: {} })).toMatch(/rule 'pickp' does not exist — did you mean 'pickup'\?/);
    expect(only(w, { op: 'removeRule', id: 'nope' })).toMatch(/does not exist/);
    expect(only(w, { op: 'updateRule', id: 'pickup', set: { when: { zone: 'Bad Zone' } } })).toMatch(/invalid selector 'Bad Zone'/);
  });

  it('enforces MAX_RULES', () => {
    const patches = Array.from({ length: LIMITS.MAX_RULES + 1 }, (_, i) => ({ op: 'addRule', rule: { ...rule, id: `r${i}` } }));
    const r = applyPatches(createWorld(), patches);
    expect(r.world.rules).toHaveLength(LIMITS.MAX_RULES);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.message).toMatch(/rule limit reached \(500\)/);
  });
});

describe('environment / player / state / hud / meta / clear', () => {
  it('setEnvironment deep-merges and validates', () => {
    const w = sampleWorld();
    const r = apply(w, [{ op: 'setEnvironment', set: { fog: { color: '#112233', density: 0.05 }, ground: { material: { color: '#ffffff' } } } }]);
    expect(r.world.environment.fog).toEqual({ color: '#112233', density: 0.05 });
    expect(r.world.environment.ground).toEqual({ material: { preset: 'grass', color: '#ffffff' }, size: 400 });
    const r2 = apply(r.world, [{ op: 'setEnvironment', set: { fog: null, ground: null } }]);
    expect(r2.world.environment.fog).toBeNull();
    expect(r2.world.environment.ground).toBeNull();
    expect(only(w, { op: 'setEnvironment', set: { sky: 'purple' } })).toMatch(/^setEnvironment: sky must be one of day\|dawn/);
    expect(only(w, { op: 'setEnvironment', set: { skyy: 'day' } })).toMatch(/skyy is not a known field — did you mean 'sky'\?/);
  });

  it('setPlayer validates and checks controls', () => {
    const w = sampleWorld();
    expect(apply(w, [{ op: 'setPlayer', set: { mode: 'firstPerson', controls: null } }]).world.player).toMatchObject({ mode: 'firstPerson' });
    expect(apply(w, [{ op: 'setPlayer', set: { controls: null } }]).world.player.controls).toBeUndefined();
    expect(only(w, { op: 'setPlayer', set: { controls: 'ghost' } })).toMatch(/controls entity 'ghost' does not exist/);
    expect(only(w, { op: 'setPlayer', set: { moveSpeed: -1 } })).toMatch(/moveSpeed must be > 0/);
  });

  it('setState sets, deletes with null, and guards keys and limits', () => {
    const w = sampleWorld();
    let r = apply(w, [{ op: 'setState', key: 'lives', value: 3 }, { op: 'setState', key: 'score', value: null }]);
    expect(r.world.state).toEqual({ lives: 3 });
    r = apply(r.world, [{ op: 'setState', key: 'ghost', value: null }]);
    expect(r.errors).toEqual([]);
    expect(only(w, { op: 'setState', key: '', value: 1 })).toMatch(/1–128 characters/);
    expect(only(w, { op: 'setState', key: '__proto__', value: 1 })).toMatch(/reserved/);
    expect(only(w, { op: 'setState', key: 'constructor', value: 1 })).toMatch(/reserved/);
    const many = Array.from({ length: LIMITS.MAX_STATE_KEYS + 1 }, (_, i) => ({ op: 'setState', key: `k${i}`, value: i }));
    expect(applyPatches(createWorld(), many).errors).toHaveLength(1);
  });

  it('setHud replaces and limits', () => {
    const w = sampleWorld();
    expect(apply(w, [{ op: 'setHud', hud: [{ key: 'lives', label: 'Lives' }] }]).world.hud).toEqual([{ key: 'lives', label: 'Lives' }]);
    expect(only(w, { op: 'setHud', hud: Array.from({ length: LIMITS.MAX_HUD + 1 }, () => ({ key: 'a', label: 'b' })) })).toMatch(/too many HUD entries/);
  });

  it('setMeta updates name/description/seed', () => {
    const r = apply(sampleWorld(), [{ op: 'setMeta', name: 'N', description: 'D', seed: 9 }]);
    expect([r.world.name, r.world.description, r.world.seed]).toEqual(['N', 'D', 9]);
  });

  it('clear keeps environment/player by default, resets them on request, keeps generators', () => {
    const w = apply(sampleWorld(), [
      { op: 'setEnvironment', set: { sky: 'night' } },
      { op: 'defineGenerator', generator: { id: 'gen', description: '', source: 'return api.build()' } },
    ]).world;
    const kept = apply(w, [{ op: 'clear' }]).world;
    expect(kept.entities).toEqual({});
    expect(kept.rules).toEqual([]);
    expect(kept.tests).toEqual([]);
    expect(kept.state).toEqual({});
    expect(kept.hud).toEqual([]);
    expect(kept.environment.sky).toBe('night');
    expect(kept.player.controls).toBeUndefined();
    expect(kept.player.mode).toBe('vehicle');
    expect(Object.keys(kept.generators)).toEqual(['gen']);
    const reset = apply(w, [{ op: 'clear', keepEnvironment: false }]).world;
    expect(reset.environment.sky).toBe('day');
    expect(reset.player.mode).toBe('thirdPerson');
  });
});

describe('generators / scripts / tests', () => {
  const gen = (id: string) => ({ id, description: 'g', source: 'return api.build()' });

  it('define, redefine, remove; in-use generators cannot be removed', () => {
    let w = apply(createWorld(), [
      { op: 'defineGenerator', generator: gen('tower') },
      { op: 'add', entity: { id: 't', shape: { kind: 'procedural', generator: 'tower' } } },
      { op: 'add', entity: { id: 's', shape: { kind: 'scatter', of: { kind: 'procedural', generator: 'tower' }, count: 3, area: [5, 5] } } },
    ]).world;
    w = apply(w, [{ op: 'defineGenerator', generator: { ...gen('tower'), description: 'v2' } }]).world;
    expect(w.generators['tower']!.description).toBe('v2');
    expect(only(w, { op: 'removeGenerator', id: 'tower' })).toMatch(/still used by 't', 's'/);
    w = apply(w, [{ op: 'remove', id: 't' }, { op: 'remove', id: 's' }, { op: 'removeGenerator', id: 'tower' }]).world;
    expect(w.generators).toEqual({});
    expect(only(w, { op: 'removeGenerator', id: 'tower' })).toMatch(/generator 'tower' does not exist/);
    expect(only(w, { op: 'defineGenerator', generator: gen('constructor') })).toMatch(/reserved/);
    expect(only(w, { op: 'defineGenerator', generator: { ...gen('x1'), source: '' } })).toMatch(/generator\.source must be at least 1 character/);
  });

  it('enforces MAX_GENERATORS and MAX_SCRIPTS', () => {
    const gens = Array.from({ length: LIMITS.MAX_GENERATORS + 1 }, (_, i) => ({ op: 'defineGenerator', generator: gen(`g${i}`) }));
    expect(applyPatches(createWorld(), gens).errors.map((x) => x.message)).toEqual([`defineGenerator 'g64': generator limit reached (64)`]);
    const scripts = Array.from({ length: LIMITS.MAX_SCRIPTS + 1 }, (_, i) => ({ op: 'defineScript', script: { id: `s${i}`, description: '', source: 'x' } }));
    const r = applyPatches(createWorld(), scripts);
    expect(r.errors).toHaveLength(1);
    expect(Object.keys(r.world.scripts)).toHaveLength(LIMITS.MAX_SCRIPTS);
    expect(apply(r.world, [{ op: 'removeScript', id: 's0' }]).world.scripts['s0']).toBeUndefined();
    expect(only(r.world, { op: 'removeScript', id: 'zz' })).toMatch(/does not exist/);
  });

  it('tests: add, duplicate, selectors, remove, MAX_TESTS', () => {
    const w = sampleWorld();
    expect(apply(w, [{ op: 'addTest', test: { id: 'n', kind: 'moves', target: '#coin' } }]).world.tests).toHaveLength(2);
    expect(only(w, { op: 'addTest', test: { id: 'car-stays', kind: 'noOverlap' } })).toMatch(/already exists/);
    expect(only(w, { op: 'addTest', test: { id: 'z', kind: 'moves', target: 'Bad Target' } })).toMatch(/invalid selector 'Bad Target'/);
    expect(only(w, { op: 'removeTest', id: 'nope' })).toMatch(/does not exist/);
    const many = Array.from({ length: LIMITS.MAX_TESTS + 1 }, (_, i) => ({ op: 'addTest', test: { id: `t${i}`, kind: 'noOverlap' } }));
    expect(applyPatches(createWorld(), many).errors).toHaveLength(1);
  });
});

describe('limits', () => {
  it('enforces MAX_ENTITIES', () => {
    const patches = Array.from({ length: LIMITS.MAX_ENTITIES + 2 }, (_, i) => ({ op: 'add', entity: { id: `e${i}` } }));
    const r = applyPatches(createWorld(), patches);
    expect(Object.keys(r.world.entities)).toHaveLength(LIMITS.MAX_ENTITIES);
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0]!.message).toMatch(/entity limit reached \(5000\); use a scatter shape/);
  });

  it('enforces MAX_SCATTER_TOTAL on add and update (and allows shrinking)', () => {
    const scatter = (count: number) => ({ kind: 'scatter', of: { kind: 'primitive', primitive: 'box' }, count, area: [10, 10] });
    let w = apply(createWorld(), [
      { op: 'add', entity: { id: 'a', shape: scatter(200_000) } },
      { op: 'add', entity: { id: 'b', shape: scatter(200_000) } },
    ]).world;
    expect(only(w, { op: 'add', entity: { id: 'c', shape: scatter(100_001) } })).toMatch(/scatter instances would total 500001 \(max 500000\)/);
    w = apply(w, [{ op: 'add', entity: { id: 'c', shape: scatter(50_000) } }]).world;
    expect(only(w, { op: 'update', id: 'c', set: { shape: { count: 100_001 } } })).toMatch(/would total 500001/);
    expect(apply(w, [{ op: 'update', id: 'c', set: { shape: { count: 100_000 } } }]).errors).toEqual([]);
    w = apply(w, [{ op: 'update', id: 'a', set: { shape: { count: 1 } } }]).world;
    expect(apply(w, [{ op: 'add', entity: { id: 'd', shape: scatter(199_999) } }]).errors).toEqual([]);
  });
});

describe('prototype pollution', () => {
  const payloads = [
    '{"op":"setState","key":"x","value":{"__proto__":{"polluted":1}}}',
    '{"op":"update","id":"car","set":{"__proto__":{"polluted":1}}}',
    '{"op":"update","id":"car","set":{"state":{"constructor":{"prototype":{"polluted":1}}}}}',
    '{"op":"add","entity":{"id":"x","state":{"a":[{"prototype":1}]}}}',
    '{"op":"setEnvironment","set":{"fog":{"__proto__":{"polluted":1}}}}',
    '{"op":"setPlayer","set":{"constructor":1}}',
    '{"op":"updateRule","id":"pickup","set":{"__proto__":{"once":true}}}',
    '{"op":"add","entity":{"id":"y","behaviors":[{"type":"spin","params":{"__proto__":{"polluted":1}}}]}}',
    '{"__proto__":{"op":"clear"}}',
  ];
  it.each(payloads)('rejects %s', (json) => {
    const w = sampleWorld();
    const msg = only(w, JSON.parse(json));
    expect(msg).toMatch(/forbidden key "(__proto__|constructor|prototype)"|op must be one of/);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
  });
});

describe('performance', () => {
  it('applies 1000 add patches in < 200ms', () => {
    const patches = Array.from({ length: 1000 }, (_, i) => ({
      op: 'add',
      entity: {
        id: `box-${i}`,
        name: `Box ${i}`,
        tags: ['crate'],
        shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] },
        transform: { position: [i % 10, Math.floor(i / 10), 0] },
        physics: { body: 'dynamic' },
        material: { preset: 'wood', color: '#aa8844' },
      },
    }));
    applyPatches(createWorld(), patches.slice(0, 50)); // warm-up (JIT)
    const t0 = performance.now();
    const r = applyPatches(createWorld(), patches);
    const ms = performance.now() - t0;
    expect(r.errors).toEqual([]);
    expect(Object.keys(r.world.entities)).toHaveLength(1000);
    expect(ms).toBeLessThan(200);
  });

  it('updates in a 5000-entity world scale linearly (structural sharing)', () => {
    const big = applyPatches(createWorld(), Array.from({ length: 5000 }, (_, i) => ({ op: 'add', entity: { id: `e${i}` } }))).world;
    const t0 = performance.now();
    const updates = Array.from({ length: 1000 }, (_, i) => ({ op: 'update', id: `e${i}`, set: { transform: { position: [i, 0, 0] } } }));
    const r = applyPatches(big, updates);
    const ms = performance.now() - t0;
    expect(r.errors).toEqual([]);
    expect(r.world.entities['e4999']).toBe(big.entities['e4999']);
    expect(ms).toBeLessThan(300);
  });

  it('stays fast for hostile batches of failing patches (hint budget)', () => {
    const big = applyPatches(createWorld(), Array.from({ length: 5000 }, (_, i) => ({ op: 'add', entity: { id: `entity-number-${i}` } }))).world;
    const t0 = performance.now();
    const bad = Array.from({ length: 10_000 }, (_, i) => ({ op: 'update', id: `entity-numbr-${i}`, set: { name: 'x' } }));
    const r = applyPatches(big, bad);
    expect(r.errors).toHaveLength(10_000);
    expect(r.errors[0]!.message).toMatch(/did you mean/);
    expect(r.errors[9999]!.message).not.toMatch(/did you mean/);
    const dupes = applyPatches(big, Array.from({ length: 5000 }, (_, i) => ({ op: 'add', entity: { id: `entity-number-${i}` } })));
    expect(dupes.errors).toHaveLength(5000);
    expect(performance.now() - t0).toBeLessThan(1500);
  });

  it('removes many entities from a large world quickly', () => {
    const big = applyPatches(createWorld(), Array.from({ length: 5000 }, (_, i) => ({ op: 'add', entity: { id: `e${i}`, parent: i % 10 === 0 ? null : `e${i - (i % 10)}` } }))).world;
    const t0 = performance.now();
    const r = applyPatches(big, Array.from({ length: 500 }, (_, i) => ({ op: 'remove', id: `e${i * 10}` })));
    expect(r.errors).toEqual([]);
    expect(Object.keys(r.world.entities)).toHaveLength(0);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
