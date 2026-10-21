/**
 * Stairs: measured feedback and a fitting helper. A stair given by room is fitted to the storey height and a free
 * wall; a misplaced one is refused with numbers and a stair that fits; what the helper accepts, the building
 * check (and so the walkthrough bot) can climb.
 */
import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld, type WorldDoc } from '@aether/core';
import { applyArchOps, parsePlan, runDesignTool } from '../src/index';
import { checkStair, fitStair, stairShape } from '../src/stair-fit';

const HOUSE = {
  id: 'duplex',
  levels: [
    {
      height: 3,
      rooms: [
        { id: 'hall', type: 'hall', rect: [0, 0, 3, 6.5] },
        { id: 'living', type: 'living', rect: [3, 0, 9, 6.5] },
      ],
      // The front door on the short south wall, the passage to the living room near the north end: a stair fits along the west wall.
      doors: [{ between: ['hall', 'outside'], side: 'south', main: true }, { between: ['hall', 'living'], kind: 'opening', width: 1.2, at: 0.15 }],
    },
    {
      height: 2.9,
      rooms: [
        { id: 'landing', type: 'hall', rect: [0, 0, 3, 6.5] },
        { id: 'bed', type: 'bedroom', rect: [3, 0, 9, 6.5] },
      ],
      doors: [{ between: ['landing', 'bed'], at: 0.15 }],
    },
  ],
};

function built(plan: unknown = HOUSE): WorldDoc {
  const base = createWorld();
  const res = applyArchOps(base, [{ op: 'create_building', plan, walkthrough: false }]);
  expect(res.errors).toEqual([]);
  return applyPatches(base, res.patches).world;
}

describe('stair fitting', () => {
  it('fits a straight run to the storey height against a wall of the hall', () => {
    const plan = parsePlan(HOUSE);
    const fit = fitStair(plan, 0, { room: 'hall' });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    expect(fit.room).toBe('hall');
    expect(fit.stair.shape).toBe('straight');
    expect(fit.shape.risers).toBe(17);
    expect(fit.shape.riser).toBeCloseTo(3 / 17, 5);
    expect(['north', 'south']).toContain(fit.stair.heading);
    // Against the west wall (its inside face is 0.14 m from the centreline), away from the passage on the east wall.
    expect(fit.stair.at[0]).toBeCloseTo(0.65, 1);
    expect(checkStair(plan, 0, fit.stair).problems).toEqual([]);
    expect(fit.line).toMatch(/straight stair 1 m wide in hall, first riser at \(.+\) heading (north|south): 17 risers of 0\.18 m, arriving in landing on level 1/);
  });

  it('add_stairs with only a room is fitted, and the building check climbs it to every upstairs room', () => {
    const world = built();
    const before = applyArchOps(world, [{ op: 'set_residents', building: 'duplex', count: 0 }]);
    expect(before.reports[0]?.passed).toBe(false);
    const res = applyArchOps(world, [{ op: 'add_stairs', building: 'duplex', level: 0, stair: { room: 'hall' } }]);
    expect(res.errors).toEqual([]);
    expect(res.lines.join(' ')).toMatch(/add_stairs on level 0: a straight stair/);
    expect(res.reports[0]?.issues).toEqual([]);
    expect(res.reports[0]?.passed).toBe(true);
  });

  it('accepts the stair fields on the op itself', () => {
    const world = built();
    const fit = fitStair(parsePlan(HOUSE), 0, { room: 'hall' });
    if (!fit.ok) throw new Error('no fit');
    const res = applyArchOps(world, [{ op: 'add_stairs', building: 'duplex', level: 0, at: fit.stair.at, heading: fit.stair.heading }]);
    expect(res.errors).toEqual([]);
    expect(res.reports[0]?.passed).toBe(true);
  });

  it('refuses a stair that runs into a wall with the measured problem and a stair that fits', () => {
    const world = built();
    // First riser in the hall heading east: the run crosses into the living room wall.
    const res = applyArchOps(world, [{ op: 'add_stairs', building: 'duplex', level: 0, stair: { at: [1.5, 3], heading: 'east' } }]);
    expect(res.errors).toHaveLength(1);
    const e = res.errors[0];
    expect(e?.code).toBe('stair_misplaced');
    expect(e?.message).toMatch(/its footprint \(x 1\.50\.\.5\.82, z 2\.50\.\.3\.50, 4\.32 × 1\.00 m for 17 risers of 0\.18 m\) crosses the wall between hall and living/);
    expect(e?.message).toMatch(/upstairs the stairwell \(x 1\.50\.\.5\.82, z 2\.50\.\.3\.50\) cuts \d\.\d\d m into the walls of \w+ on level 1/);
    expect(e?.hint).toMatch(/A stair that fits: \{"at":\[[\d.]+,[\d.]+\],"heading":"\w+","shape":"straight","width":1\}/);
    // Following the hint works.
    const at = /"at":\[([\d.]+),([\d.]+)\],"heading":"(\w+)"/.exec(e?.hint ?? '');
    const again = applyArchOps(world, [{ op: 'add_stairs', building: 'duplex', level: 0, stair: { at: [Number(at?.[1]), Number(at?.[2])], heading: at?.[3] } }]);
    expect(again.errors).toEqual([]);
    expect(again.reports[0]?.passed).toBe(true);
  });

  it('says why no stair fits a small room, with the sizes each shape needs', () => {
    const small = { ...HOUSE, levels: [{ ...HOUSE.levels[0], rooms: [{ id: 'hall', type: 'hall', rect: [0, 0, 2, 2.5] }, { id: 'living', type: 'living', rect: [2, 0, 9, 6.5] }] }, HOUSE.levels[1]] };
    const world = built(small);
    const res = applyArchOps(world, [{ op: 'add_stairs', building: 'duplex', stair: { room: 'hall' } }]);
    expect(res.errors[0]?.code).toBe('stair_does_not_fit');
    expect(res.errors[0]?.message).toMatch(/hall \(2\.00 × 2\.50 m between wall centres\)/);
    expect(res.errors[0]?.message).toMatch(/a 3\.00 m storey takes 17 risers of 0\.18 m \(16 treads of 0\.27 m\); .*straight 5\.32 × 1\.00 m, L/);
  });

  it('refuses a stair on the top level', () => {
    const res = applyArchOps(built(), [{ op: 'add_stairs', building: 'duplex', level: 1, stair: { room: 'landing' } }]);
    expect(res.errors[0]?.code).toBe('stair_leads_nowhere');
  });

  it('the stair shape matches the compiled footprint frame', () => {
    const s = stairShape({ at: [1, 6], heading: 'north', shape: 'straight', width: 1, turn: 'left' }, 3);
    // Heading north climbs toward −z: the footprint spans z from 6 down by the run.
    const zs = s.footprint.map((p) => p[1]);
    expect(Math.max(...zs)).toBeCloseTo(6, 5);
    expect(Math.min(...zs)).toBeCloseTo(6 - 16 * 0.27, 5);
    expect(s.top[1]).toBeLessThan(6 - 16 * 0.27);
  });
});

describe('stairs in design_plan', () => {
  const design = {
    id: 'duplex',
    name: 'Duplex',
    levels: [
      { height: 3, rooms: [{ id: 'hall', type: 'hall', rect: [0, 0, 3, 6.5] }, { id: 'living', type: 'living', rect: [3, 0, 9, 6.5] }], openings: [{ kind: 'door', room: 'hall', wall: 'south', along: 1.5, width: 0.9, to: 'outside', main: true }, { kind: 'opening', room: 'hall', wall: 'east', along: 1, width: 1.2, to: 'living' }], stairs: [{ room: 'hall' }] },
      { height: 2.9, rooms: [{ id: 'landing', type: 'hall', rect: [0, 0, 3, 6.5] }, { id: 'bed', type: 'bedroom', rect: [3, 0, 9, 6.5] }], openings: [{ kind: 'door', room: 'landing', wall: 'east', along: 1, width: 0.9, to: 'bed' }] },
    ],
  };

  it('fits a stair given by room and says where it went', () => {
    const r = runDesignTool(createWorld(), 'design_plan', { plan: design });
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/Stairs: level 0 stair 1: fitted a straight stair 1 m wide in hall/);
    const after = applyPatches(createWorld(), r.patches).world;
    expect(Object.values(after.entities).filter((e) => e.arch?.role === 'stair')).toHaveLength(1);
  });

  it('refuses a misplaced exact stair with numbers and a fitting alternative', () => {
    const bad = { ...design, levels: [{ ...design.levels[0], stairs: [{ at: [1.5, 3], heading: 'east' }] }, design.levels[1]] };
    const r = runDesignTool(createWorld(), 'design_plan', { plan: bad });
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/level 0 stair 1 at \(1\.5, 3\) heading east: its footprint .* crosses the wall between hall and living/);
    expect(r.text).toMatch(/A stair that fits: \{"at":/);
  });

  it('query_scene stairs answers with the riser maths and a ready op', () => {
    const world = applyPatches(createWorld(), runDesignTool(createWorld(), 'design_plan', { plan: { ...design, levels: [{ ...design.levels[0], stairs: [] }, design.levels[1]] } }).patches).world;
    const q = runDesignTool(world, 'query_scene', { queries: [{ q: 'stairs', room: 'hall' }] });
    expect(q.ok).toBe(true);
    expect(q.text).toMatch(/level 0 → 1: a straight stair 1 m wide in hall/);
    expect(q.text).toMatch(/a 3\.00 m storey takes 17 risers/);
    expect(q.text).toMatch(/\{"op":"add_stairs","building":"duplex","level":0,"stair":\{"at":\[/);
  });
});
