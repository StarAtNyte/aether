import { applyPatches, validateWorld, type WorldDoc } from '@aether/core';
import { describe, expect, it } from 'vitest';
import { applyArchOps } from '../src/ops';

const PLAN = {
  id: 'flat',
  name: 'Flat',
  style: 'modern',
  levels: [
    {
      rooms: [
        { id: 'living', type: 'living', rect: [0, 0, 6, 5] },
        { id: 'bed', type: 'bedroom', rect: [6, 0, 10, 5] },
      ],
      doors: [{ between: ['living', 'bed'] }, { between: ['living', 'outside'], main: true }],
    },
  ],
} as const;

function built(): WorldDoc {
  const r = applyArchOps(validateWorldOrThrow({}), [{ op: 'create_building', plan: PLAN }]);
  return applyPatches(validateWorldOrThrow({}), r.patches).world;
}

function validateWorldOrThrow(input: unknown): WorldDoc {
  const r = validateWorld(input);
  if (!r.ok) throw new Error('invalid');
  return r.world;
}

function sofaId(w: WorldDoc): string {
  const e = Object.values(w.entities).find((x) => x.arch?.kind === 'sofa');
  if (!e) throw new Error('no sofa');
  return e.id;
}

describe('arch.overrides and arch.removed survive re-compilation', () => {
  it('re-applies recorded property edits to the regenerated piece', () => {
    const w = built();
    const id = sofaId(w);
    const sofa = w.entities[id]!;
    const edited = structuredClone(w);
    const piece = edited.entities[id]!;
    if (piece.shape.kind !== 'procedural') throw new Error('expected a generated sofa');
    piece.shape.params = { ...piece.shape.params, color: '#1f5d3a' };
    piece.arch = { ...sofa.arch!, overrides: { 'shape.params.color': '#1f5d3a' } };
    const res = applyArchOps(edited, [{ op: 'set_material', building: 'flat', target: 'floor', material: { finish: 'oak' } }]);
    const again = res.target.entities[id]!;
    expect(again.shape.kind === 'procedural' && again.shape.params['color']).toBe('#1f5d3a');
    expect(again.arch?.overrides?.['shape.params.color']).toBe('#1f5d3a');
  });

  it('ignores overrides that would make the piece invalid or touch protected keys', () => {
    const w = built();
    const id = sofaId(w);
    const sofa = w.entities[id]!;
    const hostile: WorldDoc = {
      ...w,
      entities: { ...w.entities, [id]: { ...sofa, arch: { ...sofa.arch!, overrides: { id: 'x', parent: 'y', '__proto__.polluted': 1, 'transform.scale': 'not-a-vector', 'arch.role': 'wall' } } } },
    };
    const res = applyArchOps(hostile, [{ op: 'set_material', building: 'flat', target: 'floor', material: { finish: 'oak' } }]);
    const again = res.target.entities[id];
    expect(again).toBeDefined();
    expect(again!.id).toBe(id);
    expect(again!.arch?.role).toBe('furniture');
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('keeps removed pieces removed', () => {
    const w = built();
    const id = sofaId(w);
    const building = w.entities['flat']!;
    const { [id]: _gone, ...rest } = w.entities;
    const removed: WorldDoc = { ...w, entities: { ...rest, flat: { ...building, arch: { ...building.arch!, removed: [id] } } } };
    const res = applyArchOps(removed, [{ op: 'set_material', building: 'flat', target: 'floor', material: { finish: 'oak' } }]);
    expect(res.target.entities[id]).toBeUndefined();
    expect(res.target.entities['flat']?.arch?.removed).toContain(id);
  });
});
