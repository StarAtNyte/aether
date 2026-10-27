import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld, type Entity, type WorldDoc } from '@aether/core';
import { applyArchOps, designToBuildingPlan, DesignPlan, readScene, reviewFindings, runDesignTool } from '../src/index';

const PLAN = {
  id: 'hall',
  name: 'Hall',
  style: 'modern',
  brief: 'A small screening room.',
  programme: [{ room: 'auditorium', purpose: 'watch films' }],
  levels: [
    {
      height: 4,
      rooms: [{ id: 'auditorium', type: 'living', rect: [0, 0, 8, 6] }],
      openings: [{ kind: 'door', room: 'auditorium', wall: 'south', to: 'outside', along: 2, width: 1, main: true, id: 'front' }],
    },
  ],
  furniture: [
    { id: 'screen', kind: 'cinema-screen', room: 'auditorium', intent: 'screen on the north wall', relations: [] },
    { id: 'stage', kind: 'stage', room: 'auditorium', intent: 'apron in front of the screen', relations: [] },
  ],
};

function build(): WorldDoc {
  const plan = DesignPlan.parse(PLAN);
  const res = applyArchOps(createWorld({}), [{ op: 'create_building', plan: designToBuildingPlan(plan) }]);
  expect(res.errors).toEqual([]);
  return applyPatches(createWorld({}), res.patches).world;
}

function crafted(world: WorldDoc, id: string, name: string, generator: string, at: [number, number, number]): WorldDoc {
  const e = { id, name, tags: [], transform: { position: at, rotation: [0, 0, 0], scale: [1, 1, 1] }, shape: { kind: 'procedural', generator, params: {} } } as unknown as Entity;
  const r = applyPatches(world, [{ op: 'add', entity: e }]);
  expect(r.errors).toEqual([]);
  return r.world;
}

const missing = (w: WorldDoc) => reviewFindings(w, 'hall').filter((f) => f.code === 'plan_missing');

describe('plan conformance matches by kind and crafted part', () => {
  it('reports both pieces missing when the world has nothing like them', () => {
    expect(missing(build()).map((f) => f.subject).sort()).toEqual(['screen', 'stage']);
  });

  it('matches planned "screen" to a crafted cinema-screen under another name, inside the room, and says so', () => {
    let w = crafted(build(), 'widescreen-1', 'Widescreen with black velvet masking', 'furn-cinema-screen', [4, 2, 0.1]);
    w = crafted(w, 'apron', 'Screen apron platform', 'furn-stage', [4, 0, 1]);
    expect(missing(w)).toEqual([]);
    const info = reviewFindings(w, 'hall').find((f) => f.code === 'plan_matched');
    expect(info?.message).toContain('screen');
    expect(info?.message).toContain('widescreen-1');
    expect(info?.message).toContain('apron');
  });

  it('does not match a piece of that kind that stands far outside the planned room, and names it as a candidate', () => {
    const w = crafted(build(), 'far-screen', 'Elsewhere', 'furn-cinema-screen', [60, 2, 60]);
    const f = missing(w).find((x) => x.subject === 'screen');
    expect(f).toBeDefined();
    expect(f?.candidates?.join(' ')).toContain('far-screen');
    expect(f?.candidates?.join(' ')).toContain('outside');
  });

  it('honours a declared mapping and keeps it when the plan is resent', () => {
    let w = crafted(build(), 'far-screen', 'Elsewhere', 'furn-cinema-screen', [60, 2, 60]);
    const r = runDesignTool(w, 'edit_items', { edits: [{ op: 'declare_plan', ref: 'screen', entities: ['far-screen'], reason: 'the screen is the far one' }, { op: 'declare_plan', ref: 'stage', reason: 'no stage in a small room' }] });
    expect(r.ok).toBe(true);
    w = applyPatches(w, r.patches).world;
    expect(missing(w)).toEqual([]);
    const again = runDesignTool(w, 'design_plan', { plan: PLAN });
    w = applyPatches(w, again.patches).world;
    expect(missing(w)).toEqual([]);
    expect(readScene(w, 'hall')).not.toBeNull();
  });

  it('brings the finding back when the declared entity is gone', () => {
    let w = crafted(build(), 'far-screen', 'Elsewhere', 'furn-cinema-screen', [60, 2, 60]);
    const r = runDesignTool(w, 'edit_items', { edits: [{ op: 'declare_plan', ref: 'screen', entities: ['far-screen'] }] });
    w = applyPatches(w, r.patches).world;
    w = applyPatches(w, [{ op: 'remove', id: 'far-screen' }]).world;
    expect(missing(w).some((f) => f.subject === 'screen' && f.message.includes('declared mapping ignored'))).toBe(true);
  });

  it('refuses a declaration for an unknown piece or entity', () => {
    const w = build();
    const r = runDesignTool(w, 'edit_items', { edits: [{ op: 'declare_plan', ref: 'nope', entities: ['x'] }, { op: 'declare_plan', ref: 'screen', entities: ['ghost'] }] });
    expect(r.ok).toBe(false);
    expect(r.text).toContain('no planned piece');
    expect(r.text).toContain('no entity ghost');
  });
});
