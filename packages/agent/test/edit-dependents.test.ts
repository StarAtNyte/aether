/**
 * What belongs to an object goes and changes with it: "move the shrine onto the hill" may move the shrine's own
 * light and goal zone (the guard used to refuse them, so the model added new ones), a move carries them along,
 * and removing the shrine takes its light and zone with it. No orphaned duplicates.
 */
import { applyPatches, createWorld, type EntityInput, type WorldDoc } from '@aether/core';
import { catalog } from '@aether/procgen';
import { describe, expect, it } from 'vitest';
import { carryDependents } from '../src/executor';
import { auditPatches, classifyScope } from '../src/refine/guard';
import { planFineEdit, type FineEditResult } from '../src/refine/plan';

const generators = catalog();

function world(list: EntityInput[]): WorldDoc {
  const entities: Record<string, EntityInput> = {};
  for (const e of list) entities[e.id] = e;
  return createWorld({ entities });
}

/** The acceptance run's forest after the hill was built (reduced): a shrine, its light, its goal zone, a hill, a lantern and a wolf. */
const FOREST = world([
  { id: 'shrine', name: 'Shrine', tags: ['focus'], shape: { kind: 'procedural', generator: 'arch', params: { variant: 2, height: 5, width: 4 } }, transform: { position: [0, 0, -32], scale: [1.8, 1.8, 1.8] } },
  { id: 'shrine-light', shape: { kind: 'none' }, transform: { position: [0, 3, -29] }, light: { type: 'spot', color: '#ffb070', intensity: 25, range: 22, angle: 60 } },
  { id: 'summit-zone', name: 'Shrine goal', shape: { kind: 'none' }, transform: { position: [0, 1, -32] }, behaviors: [{ type: 'goal', params: { margin: 1.5, text: 'The shrine glows. You win!' } }] },
  { id: 'hill', name: 'Hill', shape: { kind: 'primitive', primitive: 'cylinder', size: [12, 6, 12] }, transform: { position: [0, 3, -60] }, physics: { body: 'static' } },
  { id: 'lantern-1', name: 'Lantern', shape: { kind: 'primitive', primitive: 'sphere', size: [0.4, 0.4, 0.4] }, transform: { position: [6, 1, -10] }, behaviors: [{ type: 'collectible', params: {} }] },
  { id: 'wolf-1', name: 'Wolf', shape: { kind: 'primitive', primitive: 'box', size: [0.6, 0.8, 1.2] }, transform: { position: [-6, 0.4, -12] } },
]);

const CTX = { selection: [], focus: [], heading: 0 };

function edit(w: WorldDoc, text: string): FineEditResult {
  return planFineEdit({ world: w, text, catalogs: { generators } });
}

describe('the edit guard and what belongs to the target', () => {
  it('"move the shrine onto the hill" may change the shrine\'s own light and goal zone, not the lantern', () => {
    const scope = classifyScope(FOREST, 'move the shrine onto the hill', CTX);
    expect(scope.kind).toBe('small');
    expect(scope.allowed.has('shrine-light')).toBe(true);
    expect(scope.allowed.has('summit-zone')).toBe(true);
    expect(scope.allowed.has('lantern-1')).toBe(false);
    const own = auditPatches(
      FOREST,
      [
        { op: 'update', id: 'shrine', set: { transform: { position: [0, 6, -60] } } },
        { op: 'update', id: 'shrine-light', set: { transform: { position: [0, 9, -57] } } },
        { op: 'update', id: 'summit-zone', set: { transform: { position: [0, 7, -60] } } },
      ],
      scope,
    );
    expect(own.ok, own.message).toBe(true);
    const stray = auditPatches(FOREST, [{ op: 'update', id: 'lantern-1', set: { transform: { position: [0, 1, 0] } } }], scope);
    expect(stray.ok).toBe(false);
  });

  it('what the request names is in scope even when the parser reads only part of it (irregular plurals included)', () => {
    const scope = classifyScope(FOREST, 'make the wolves patrol back and forth along the river bank', CTX);
    expect(scope.kind).toBe('small');
    expect(scope.allowed.has('wolf-1')).toBe(true);
    expect(scope.allowed.has('lantern-1')).toBe(false);
    expect(auditPatches(FOREST, [{ op: 'update', id: 'wolf-1', set: { transform: { position: [-6, 0.4, -14] } } }], scope).ok).toBe(true);
    // Function words name nothing: "the" does not bring in "Shrine of the Five Lights".
    const w = world([...Object.values(FOREST.entities), { id: 'big-shrine', name: 'Shrine of the Five Lights', shape: { kind: 'primitive', primitive: 'box', size: [2, 2, 2] }, transform: { position: [30, 1, 30] } }]);
    expect(classifyScope(w, 'make the wolves patrol along the bank', CTX).allowed.has('big-shrine')).toBe(false);
  });

  it('a follow-up that names the shrine through "it" still reaches its parts', () => {
    const scope = classifyScope(FOREST, 'yes, build a hill at the north end and put the shrine on top of it', CTX);
    expect(scope.allowed.has('shrine')).toBe(true);
    expect(scope.allowed.has('shrine-light')).toBe(true);
    expect(scope.allowed.has('summit-zone')).toBe(true);
  });
});

describe('a model patch that moves an object carries what belongs to it', () => {
  it('adds the moves of the light and the goal zone, by the same offset', () => {
    const carry = carryDependents(FOREST, [{ op: 'update', id: 'shrine', set: { transform: { position: [0, 6, -60] } } }]);
    expect(carry.carried.map((c) => c.id).sort()).toEqual(['shrine-light', 'summit-zone']);
    const after = applyPatches(FOREST, [{ op: 'update', id: 'shrine', set: { transform: { position: [0, 6, -60] } } }, ...carry.patches]).world;
    expect(after.entities['shrine-light']?.transform.position).toEqual([0, 9, -57]);
    expect(after.entities['summit-zone']?.transform.position).toEqual([0, 7, -60]);
    // Nothing new: no duplicate light or goal.
    expect(Object.keys(after.entities).sort()).toEqual(Object.keys(FOREST.entities).sort());
  });

  it('leaves a dependent the batch places itself, and ignores patches that move nothing', () => {
    const carry = carryDependents(FOREST, [
      { op: 'update', id: 'shrine', set: { transform: { position: [0, 6, -60] } } },
      { op: 'update', id: 'summit-zone', set: { transform: { position: [1, 7, -61] } } },
    ]);
    expect(carry.carried.map((c) => c.id)).toEqual(['shrine-light']);
    expect(carryDependents(FOREST, [{ op: 'update', id: 'shrine', set: { material: { color: '#ff0000' } } }]).patches).toEqual([]);
    expect(carryDependents(FOREST, [{ op: 'nonsense' }, null, 42]).patches).toEqual([]);
  });
});

describe('local edits move and remove what belongs to the target', () => {
  it('"move the shrine 5 m east" moves its light and goal zone too', () => {
    const r = edit(FOREST, 'move the shrine 5 m east');
    expect(r.kind, `${r.reason ?? ''} ${r.detail ?? ''}`).toBe('edit');
    const after = applyPatches(FOREST, r.patches).world;
    expect(after.entities['shrine']?.transform.position[0]).toBe(5);
    expect(after.entities['shrine-light']?.transform.position[0]).toBe(5);
    expect(after.entities['summit-zone']?.transform.position[0]).toBe(5);
    expect(after.entities['lantern-1']?.transform.position).toEqual(FOREST.entities['lantern-1']?.transform.position);
  });

  it('"move the shrine onto the hill" carries the zone and light to the hill', () => {
    const r = edit(FOREST, 'move the shrine onto the hill');
    expect(r.kind, `${r.reason ?? ''} ${r.detail ?? ''}`).toBe('edit');
    const after = applyPatches(FOREST, r.patches).world;
    const s = after.entities['shrine']?.transform.position ?? [0, 0, 0];
    expect(s[2]).toBe(-60);
    expect(after.entities['summit-zone']?.transform.position[2]).toBe(-60);
    expect(after.entities['shrine-light']?.transform.position[2]).toBe(-57);
    // The zone stays at the shrine's height offset (1 m above its base).
    expect((after.entities['summit-zone']?.transform.position[1] ?? 0) - s[1]).toBeCloseTo(1, 2);
  });

  it('"remove the shrine" takes its light and goal zone with it', () => {
    const r = edit(FOREST, 'remove the shrine');
    expect(r.kind, `${r.reason ?? ''} ${r.detail ?? ''}`).toBe('edit');
    const after = applyPatches(FOREST, r.patches).world;
    expect(after.entities['shrine']).toBeUndefined();
    expect(after.entities['shrine-light']).toBeUndefined();
    expect(after.entities['summit-zone']).toBeUndefined();
    expect(after.entities['hill']).toBeDefined();
  });
});

describe('the edit guard and the assistant\'s own work in the same turn', () => {
  const START = world([
    { id: 'shrine', name: 'Moonlit shrine', tags: ['focus'], shape: { kind: 'none' }, transform: { position: [0, 0, -34] } },
    { id: 'shrine-torii', name: 'Shrine torii', shape: { kind: 'none' }, transform: { position: [0, 0, -22] } },
    { id: 'lantern-1', name: 'Golden lantern', shape: { kind: 'none' }, transform: { position: [6, 1, -10] } },
  ]);
  const hill = (id: string, name: string): EntityInput => ({ id, name, tags: ['hill'], shape: { kind: 'none' }, transform: { position: [0, 0, -34] } });

  it('a failed first hill added this turn may be removed; one that was already there may not', () => {
    const scope = classifyScope(START, 'move the shrine onto the hill', CTX);
    expect(scope.kind).toBe('small');
    expect(scope.allowed.has('shrine-torii')).toBe(true);
    const mid = applyPatches(START, [{ op: 'add', entity: hill('hill-1', 'Shrine Hill') }]).world;
    const drop = [{ op: 'remove', id: 'hill-1' }];
    expect(auditPatches(mid, drop, scope).ok).toBe(false);
    expect(auditPatches(mid, drop, scope, START).ok).toBe(true);
    // Not a loophole: what was there at the start of the turn stays guarded.
    expect(auditPatches(mid, [{ op: 'remove', id: 'lantern-1' }], scope, START).ok).toBe(false);
  });
});
