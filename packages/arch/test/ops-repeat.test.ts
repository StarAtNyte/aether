/**
 * The same ops on the same document are answered from the document's recent results: the studio tries candidate ops and
 * then commits the winner through the same call. The answer must equal a fresh one, and a different document or
 * different ops must not reuse it.
 */
import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld, type WorldDoc } from '@aether/core';
import { applyArchOps, DesignPlan, designToBuildingPlan } from '../src/index';

const PLAN = DesignPlan.parse({
  id: 'home',
  name: 'Repeat home',
  style: 'scandinavian',
  brief: 'A bedroom and a hall.',
  programme: [{ room: 'bedroom', purpose: 'sleep', targetArea: 14 }],
  circulation: { entrance: 'hall', notes: 'front door into the hall' },
  levels: [
    {
      height: 2.9,
      rooms: [
        { id: 'bedroom', type: 'bedroom', rect: [0, 0, 4, 3.6] },
        { id: 'hall', type: 'hall', rect: [0, 3.6, 4, 5.2] },
      ],
      openings: [
        { kind: 'door', room: 'bedroom', wall: 'south', to: 'hall', along: 3.2, width: 0.9, id: 'door-bed' },
        { kind: 'door', room: 'hall', wall: 'south', to: 'outside', along: 1.4, width: 1, main: true, id: 'front' },
      ],
    },
  ],
});

function built(): WorldDoc {
  const first = applyArchOps(createWorld(), [{ op: 'create_building', plan: designToBuildingPlan(PLAN) }]);
  return applyPatches(createWorld(), first.patches).world;
}

describe('applyArchOps repeat', () => {
  it('a repeat on the same document equals the first answer and is not the same object', () => {
    const world = built();
    const ops = [{ op: 'set_material', building: 'home', target: 'walls', material: { color: '#c0b090' } }];
    const a = applyArchOps(world, ops);
    const b = applyArchOps(world, ops);
    expect(b).not.toBe(a);
    expect(b.patches).toEqual(a.patches);
    expect(b.lines).toEqual(a.lines);
    expect(b.errors).toEqual(a.errors);
    expect(b.target).toBe(a.target);
    b.lines.push('mutated');
    b.patches.length = 0;
    expect(applyArchOps(world, ops).lines).toEqual(a.lines);
    expect(applyArchOps(world, ops).patches.length).toBe(a.patches.length);
  });

  it('an equal document that is another object, and other ops, are computed again', () => {
    const world = built();
    const ops = [{ op: 'set_material', building: 'home', target: 'walls', material: { color: '#c0b090' } }];
    const a = applyArchOps(world, ops);
    const other = applyArchOps({ ...world }, ops);
    expect(other.target).not.toBe(a.target);
    expect(other.patches).toEqual(a.patches);
    const different = applyArchOps(world, [{ op: 'remove_room', building: 'home', room: 'no-such-room' }]);
    expect(a.errors).toEqual([]);
    expect(different.errors.length).toBeGreaterThan(0);
  });

  it('ops that cannot be serialised are applied without keeping a result', () => {
    const world = built();
    const loop: Record<string, unknown> = { op: 'remove_room', building: 'home', room: 'none' };
    loop['self'] = loop;
    expect(() => applyArchOps(world, [loop])).not.toThrow();
  });
});
