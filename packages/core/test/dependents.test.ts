import { describe, expect, it } from 'vitest';
import { applyPatches, carryPatches, createWorld, dependencyIndex, type EntityInput, type WorldDoc } from '../src';

function world(list: EntityInput[]): WorldDoc {
  const entities: Record<string, EntityInput> = {};
  for (const e of list) entities[e.id] = e;
  return createWorld({ entities });
}

const SHRINE: EntityInput = { id: 'shrine', name: 'Shrine', shape: { kind: 'procedural', generator: 'arch', params: { width: 4, height: 5 } }, transform: { position: [0, 6, -32], scale: [1.8, 1.8, 1.8] } };
const LIGHT: EntityInput = { id: 'shrine-light', shape: { kind: 'none' }, transform: { position: [0, 9, -29] }, light: { type: 'spot', color: '#ffb070', intensity: 25, range: 22 } };
const ZONE: EntityInput = { id: 'summit-zone', name: 'Shrine goal', shape: { kind: 'none' }, transform: { position: [0, 7, -31] }, behaviors: [{ type: 'goal', params: { margin: 1.5 } }] };
const HILL: EntityInput = { id: 'hill', name: 'Hill', shape: { kind: 'primitive', primitive: 'cylinder', size: [32, 6, 32] }, transform: { position: [0, 3, -32] }, physics: { body: 'static' } };
const LANTERN: EntityInput = { id: 'lantern-1', name: 'Lantern', shape: { kind: 'primitive', primitive: 'sphere', size: [0.4, 0.4, 0.4] }, transform: { position: [1, 7, -31] }, behaviors: [{ type: 'collectible', params: {} }] };

describe('dependencyIndex', () => {
  it("finds a shrine's light and goal zone (by id, by name) and leaves the hill and pickups alone", () => {
    const w = world([HILL, SHRINE, LIGHT, ZONE, LANTERN]);
    const idx = dependencyIndex(w);
    expect(idx.ownerOf('shrine-light')).toEqual({ owner: 'shrine', why: 'named' });
    expect(idx.ownerOf('summit-zone')).toEqual({ owner: 'shrine', why: 'named' });
    expect(idx.ownerOf('lantern-1')).toBeNull();
    expect(idx.ownerOf('shrine')).toBeNull();
    expect(idx.dependentsOf('shrine').sort()).toEqual(['shrine-light', 'summit-zone']);
    expect(idx.dependentsOf('hill')).toEqual([]);
    expect([...idx.closure(['shrine'])].sort()).toEqual(['shrine', 'shrine-light', 'summit-zone']);
  });

  it('owns an anonymous light or invisible zone inside a footprint by proximity, the nearest object first', () => {
    const glow: EntityInput = { id: 'glow-7', shape: { kind: 'none' }, transform: { position: [0.5, 8, -31] }, light: { type: 'point', color: '#ffffff', intensity: 2, range: 6 } };
    const far: EntityInput = { id: 'glow-8', shape: { kind: 'none' }, transform: { position: [20, 2, 0] }, light: { type: 'point', color: '#ffffff', intensity: 2, range: 6 } };
    const statue: EntityInput = { id: 'statue', name: 'Statue', shape: { kind: 'primitive', primitive: 'box', size: [1, 2, 1] }, transform: { position: [4, 7, -32] } };
    const idx = dependencyIndex(world([HILL, SHRINE, statue, glow, far]));
    expect(idx.ownerOf('glow-7')).toEqual({ owner: 'shrine', why: 'nearby' });
    expect(idx.ownerOf('glow-8')).toBeNull();
  });

  it('a drawn altar the win rule listens to belongs to the shrine on the hill, not to the hill under both', () => {
    const hill: EntityInput = { id: 'shrine-hill', shape: { kind: 'primitive', primitive: 'cylinder', size: [16, 3, 16] }, transform: { position: [0, 1.5, -25] }, physics: { body: 'static' } };
    const shrine: EntityInput = { id: 'hill-shrine', name: 'Shrine of the Five Lights', shape: { kind: 'procedural', generator: 'arch', params: { width: 4, height: 5 } }, transform: { position: [0, 3, -26] } };
    const altar: EntityInput = { id: 'shrine-zone', name: 'Shrine Altar', shape: { kind: 'primitive', primitive: 'cylinder', size: [3, 0.2, 3] }, transform: { position: [0, 3.1, -25] }, physics: { body: 'static', sensor: true } };
    const lantern: EntityInput = { id: 'lantern-5', shape: { kind: 'primitive', primitive: 'sphere', size: [0.4, 0.4, 0.4] }, transform: { position: [0, 3.7, -25.5] }, physics: { body: 'static', sensor: true }, behaviors: [{ type: 'collectible', params: {} }] };
    const w = createWorld({
      entities: { 'shrine-hill': hill, 'hill-shrine': shrine, 'shrine-zone': altar, 'lantern-5': lantern },
      rules: [{ id: 'win', when: { on: 'enter', zone: 'shrine-zone', who: 'player' }, then: [{ do: 'win', text: 'won' }] }],
    });
    const idx = dependencyIndex(w);
    expect(idx.ownerOf('shrine-zone')).toEqual({ owner: 'hill-shrine', why: 'nearby' });
    expect(idx.ownerOf('lantern-5')).toBeNull();
    expect(idx.ownerOf('hill-shrine')).toBeNull();
  });

  it('honours attachedTo first, ignores a missing owner and never loops', () => {
    const plinth: EntityInput = { id: 'plinth', name: 'Plinth', shape: { kind: 'primitive', primitive: 'box', size: [5, 0.4, 3] }, transform: { position: [0, 6.2, -32] }, attachedTo: 'shrine' };
    const ghost: EntityInput = { ...LIGHT, id: 'lamp-2', attachedTo: 'nobody' };
    const loopA: EntityInput = { id: 'a', shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] }, attachedTo: 'b' };
    const loopB: EntityInput = { id: 'b', shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] }, attachedTo: 'a' };
    const idx = dependencyIndex(world([SHRINE, plinth, ghost, loopA, loopB]));
    expect(idx.ownerOf('plinth')).toEqual({ owner: 'shrine', why: 'attached' });
    expect(idx.ownerOf('lamp-2')?.why).not.toBe('attached');
    expect([...idx.closure(['a'])].sort()).toEqual(['a', 'b']);
  });

  it('a name several objects share points at none of them ("Tree" does not own "Tree light")', () => {
    const t1: EntityInput = { id: 't1', name: 'Tree', shape: { kind: 'primitive', primitive: 'cone', size: [2, 5, 2] }, transform: { position: [40, 2.5, 0] } };
    const t2: EntityInput = { id: 't2', name: 'Tree', shape: { kind: 'primitive', primitive: 'cone', size: [2, 5, 2] }, transform: { position: [-40, 2.5, 0] } };
    const l: EntityInput = { id: 'l', name: 'Tree light', shape: { kind: 'none' }, transform: { position: [0, 3, 40] }, light: { type: 'point', color: '#ffffff', intensity: 1, range: 4 } };
    expect(dependencyIndex(world([t1, t2, l])).ownerOf('l')).toBeNull();
  });

  it('"Tower 2" is not a part of "Tower"', () => {
    const a: EntityInput = { id: 'tower', name: 'Tower', shape: { kind: 'primitive', primitive: 'box', size: [3, 10, 3] }, transform: { position: [0, 5, 0] } };
    const b: EntityInput = { id: 'tower-2', name: 'Tower 2', shape: { kind: 'primitive', primitive: 'box', size: [3, 10, 3] }, transform: { position: [20, 5, 0] } };
    expect(dependencyIndex(world([a, b])).ownerOf('tower-2')).toBeNull();
  });
});

describe('carryPatches', () => {
  it('moves what belongs to a moved object by the same offset, and skips what the batch moved itself', () => {
    const w = world([HILL, SHRINE, LIGHT, ZONE]);
    const moved = applyPatches(w, [{ op: 'update', id: 'shrine', set: { transform: { position: [10, 6, -32] } } }]).world;
    const carry = carryPatches(w, moved, ['shrine'], new Set(['shrine']));
    expect(carry.carried.map((c) => c.id).sort()).toEqual(['shrine-light', 'summit-zone']);
    const after = applyPatches(moved, carry.patches).world;
    expect(after.entities['shrine-light']?.transform.position).toEqual([10, 9, -29]);
    expect(after.entities['summit-zone']?.transform.position).toEqual([10, 7, -31]);
    expect(carryPatches(w, moved, ['shrine'], new Set(['shrine', 'summit-zone'])).carried.map((c) => c.id)).toEqual(['shrine-light']);
  });

  it('swings dependents round a turned owner', () => {
    const w = world([SHRINE, LIGHT]);
    const turned = applyPatches(w, [{ op: 'update', id: 'shrine', set: { transform: { rotation: [0, 90, 0] } } }]).world;
    const carry = carryPatches(w, turned, ['shrine']);
    const p = carry.patches[0];
    expect(p?.op).toBe('update');
    const after = applyPatches(turned, carry.patches).world.entities['shrine-light']?.transform;
    // Offset (0, 3) in x, z turned 90 degrees about +Y becomes (3, 0).
    expect(after?.position[0]).toBeCloseTo(3, 3);
    expect(after?.position[2]).toBeCloseTo(-32, 3);
    expect(after?.rotation[1]).toBeCloseTo(90, 3);
  });

  it('does nothing when nothing moved', () => {
    const w = world([SHRINE, LIGHT]);
    const recoloured = applyPatches(w, [{ op: 'update', id: 'shrine', set: { name: 'Old shrine' } }]).world;
    expect(carryPatches(w, recoloured, ['shrine']).patches).toEqual([]);
  });

  it('keeps attachedTo through an id rename', () => {
    const plinth: EntityInput = { id: 'plinth', shape: { kind: 'primitive', primitive: 'box', size: [5, 0.4, 3] }, attachedTo: 'shrine' };
    const r = applyPatches(world([SHRINE, plinth]), [{ op: 'rename', id: 'shrine', newId: 'torii' }]);
    expect(r.errors).toEqual([]);
    expect(r.world.entities['plinth']?.attachedTo).toBe('torii');
  });
});
