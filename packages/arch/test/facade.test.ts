import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld, type WorldDoc } from '@aether/core';
import { applyArchOps, DesignPlan, designToBuildingPlan, exteriorPoses } from '../src/index';

const BASE = {
  id: 'hall',
  name: 'Cinema Aurora',
  style: 'classic',
  brief: 'A small cinema.',
  levels: [
    {
      height: 4.2,
      rooms: [
        { id: 'lobby', type: 'lobby', rect: [0, 0, 8, 4] },
        { id: 'hall', type: 'hall', rect: [0, 4, 8, 14] },
      ],
      openings: [
        { kind: 'door', room: 'lobby', wall: 'north', to: 'outside', along: 4, width: 1.8, main: true, id: 'front' },
        { kind: 'door', room: 'lobby', wall: 'south', to: 'hall', along: 4, width: 1.8, id: 'inner' },
        { kind: 'window', room: 'lobby', wall: 'east', along: 2, width: 1.4, height: 1.4, sill: 0.9, id: 'w1' },
      ],
    },
  ],
  furniture: [],
};

function build(over: Record<string, unknown> = {}): WorldDoc {
  const plan = DesignPlan.parse({ ...BASE, ...over });
  const res = applyArchOps(createWorld({}), [{ op: 'create_building', plan: designToBuildingPlan(plan) }]);
  expect(res.errors).toEqual([]);
  const applied = applyPatches(createWorld({}), res.patches);
  expect(applied.errors).toEqual([]);
  return applied.world;
}
const ids = (w: WorldDoc): string[] => Object.keys(w.entities);

describe('facade', () => {
  it('a building made from a design gets an entrance, canopy, cornice, forecourt, lamps, planters and benches by default', () => {
    const w = build();
    for (const part of ['door-lintel', 'portico', 'forecourt', 'lampl', 'lampr', 'planterl', 'benchr', 'entry-light']) expect(ids(w), part).toContain(`hall-${part}`);
    expect(ids(w).filter((i) => i.startsWith('hall-cornice')).length).toBeGreaterThanOrEqual(4);
    expect(ids(w)).not.toContain('hall-sign');
  });

  it('a long front gets pilasters between its openings, none where the door or a window is', () => {
    const long = { levels: [{ height: 4.2, rooms: [{ id: 'lobby', type: 'lobby', rect: [0, 0, 16, 4] }, { id: 'hall', type: 'hall', rect: [0, 4, 16, 14] }], openings: [{ kind: 'door', room: 'lobby', wall: 'north', to: 'outside', along: 8, width: 1.8, main: true, id: 'front' }, { kind: 'door', room: 'lobby', wall: 'south', to: 'hall', along: 8, width: 1.8, id: 'inner' }, { kind: 'window', room: 'lobby', wall: 'north', along: 3.2, width: 1.6, height: 1.4, sill: 1, id: 'w1' }] }] };
    const w = build(long);
    const ps = ids(w).filter((i) => i.startsWith('hall-pilaster'));
    expect(ps.length).toBeGreaterThanOrEqual(1);
    for (const id of ps) {
      const x = w.entities[id]!.transform.position[0];
      expect(Math.abs(x - 8)).toBeGreaterThan(1.3);
      expect(Math.abs(x - 3.2)).toBeGreaterThan(1.3);
    }
    expect(ids(build({ facade: { pilasters: false }, ...long })).filter((i) => i.startsWith('hall-pilaster'))).toEqual([]);
  });

  it('a sign with emissive lettering comes from the name, with its own light', () => {
    const w = build({ facade: { sign: 'Cinema Aurora' } });
    const sign = w.entities['hall-sign'];
    expect(sign?.shape.kind === 'procedural' && sign.shape.generator).toBe('arch-sign');
    expect(sign?.name).toContain('Cinema Aurora');
    expect(w.entities['hall-sign-light']?.light).toBeDefined();
  });

  it('facade false keeps the front bare', () => {
    const w = build({ facade: false });
    expect(ids(w).filter((i) => /portico|forecourt|cornice|lamp|bench/.test(i))).toEqual([]);
  });

  it('set_facade changes the stored plan and re-compiles', () => {
    const w = build({ facade: false });
    const r = applyArchOps(w, [{ op: 'set_facade', building: 'hall', facade: { sign: 'Aurora', bench: false } }]);
    expect(r.errors).toEqual([]);
    expect(r.lines.join(' ')).toContain('sign "Aurora"');
    const after = r.target as WorldDoc;
    expect(ids(after)).toContain('hall-sign');
    expect(ids(after)).not.toContain('hall-benchl');
  });

  it('the street view stands in front of the entrance, facing it, and the aerial looks down at the building', () => {
    const w = build();
    const poses = exteriorPoses(w, 'hall');
    expect(poses.map((p) => p.name)).toEqual(['exterior-street', 'exterior-aerial']);
    const street = poses[0]!;
    // The entrance is on the north wall (z = 0): the street is further north (negative z) and 1.6 m high.
    expect(street.position[1]).toBeCloseTo(1.75, 1); // 1.6 m above the floor, which sits on a 0.15 m plinth
    expect(street.position[2]).toBeLessThan(-5);
    expect(poses[1]!.position[1]).toBeGreaterThan(8);
  });
});
