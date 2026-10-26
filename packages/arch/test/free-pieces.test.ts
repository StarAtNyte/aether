/**
 * A room furnished by instanced layouts (`shape_land` tier / grid / wall / perimeter) and lit by hand-made lights holds
 * pieces that belong to no level; the review used to call it empty and unlit and then stall on the same finding.
 */
import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld, type Entity } from '@aether/core';
import { applyArchOps, readScene, reviewScene } from '../src/index';

const PLAN = {
  id: 'hall',
  name: 'Hall',
  levels: [{ height: 3.2, rooms: [{ id: 'main', type: 'living', rect: [0, 0, 10, 8], furnish: false, dress: false }], openings: [{ kind: 'door', room: 'main', wall: 'south', along: 5, width: 1, to: 'outside', main: true }] }],
};

function built() {
  const base = createWorld();
  const res = applyArchOps(base, [{ op: 'create_building', plan: PLAN }]);
  expect(res.errors).toEqual([]);
  return applyPatches(base, res.patches).world;
}

describe('pieces and lights that belong to no level', () => {
  it('count towards a room: instanced seats and a hand-made light end "looks empty" and "no light fitting"', () => {
    const w0 = built();
    const before = reviewScene(w0, 'hall', { fast: true }).map((f) => f.code);
    expect(before).toContain('room_empty');
    expect(before).toContain('no_light');
    const seats: Entity = { id: 'seats', name: 'seats', tags: [], transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, shape: { kind: 'scatter', of: { kind: 'procedural', generator: 'furn-chair', params: {} }, count: 3, area: [1, 1], seed: 1, scaleRange: [1, 1], randomYaw: false, points: [[3, 0, 3], [4, 0, 3], [5, 0, 3]] } } as unknown as Entity;
    const lamp: Entity = { id: 'lamp', name: 'lamp', tags: [], transform: { position: [5, 2.5, 4], rotation: [0, 0, 0], scale: [1, 1, 1] }, shape: { kind: 'none' }, light: { type: 'point', color: '#ffffff', intensity: 1, range: 6, angle: 30, castShadow: false } } as unknown as Entity;
    const w1 = applyPatches(w0, [{ op: 'add', entity: seats }, { op: 'add', entity: lamp }]).world;
    expect(readScene(w1, 'hall')?.rooms[0]?.free).toEqual({ pieces: 3, lights: 1, kinds: ['chair'] });
    const after = reviewScene(w1, 'hall', { fast: true }).map((f) => f.code);
    expect(after).not.toContain('room_empty');
    expect(after).not.toContain('no_light');
    // Outside the room they count for nothing.
    const away = applyPatches(w0, [{ op: 'add', entity: { ...seats, transform: { ...seats.transform, position: [40, 0, 40] } } }]).world;
    expect(reviewScene(away, 'hall', { fast: true }).map((f) => f.code)).toContain('room_empty');
  });

  it('a free piece of the kind a room needs is that piece: tables laid by a layout are the dining table', () => {
    const w0 = built();
    expect(reviewScene(w0, 'hall', { fast: true }).map((f) => f.code)).toContain('missing_essential');
    const sofa = { id: 'sofas', name: 'sofas', tags: [], transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, shape: { kind: 'scatter', of: { kind: 'procedural', generator: 'furn-sofa', params: {} }, count: 1, area: [1, 1], seed: 1, scaleRange: [1, 1], randomYaw: false, points: [[5, 0, 4]] } } as unknown as Entity;
    const w1 = applyPatches(w0, [{ op: 'add', entity: sofa }]).world;
    expect(reviewScene(w1, 'hall', { fast: true }).map((f) => f.code)).not.toContain('missing_essential');
  });
});
