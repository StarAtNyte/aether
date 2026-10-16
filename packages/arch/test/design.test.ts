import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld, type Patch, type WorldDoc } from '@aether/core';
import { applyArchOps, checkConformance, DesignPlan, designToBuildingPlan, describeShell, moveItem, placeItem, planOf, readScene, validateDesign } from '../src/index';
import { applyEdit } from './scene-helpers';

const BASE = {
  id: 'home',
  name: 'Test home',
  style: 'scandinavian',
  brief: 'A calm bedroom with a window onto the garden.',
  programme: [{ room: 'bedroom', purpose: 'sleep', targetArea: 14 }],
  circulation: { entrance: 'hall', notes: 'front door into the hall, bedroom door off the hall' },
  levels: [
    {
      height: 2.9,
      rooms: [
        { id: 'bedroom', type: 'bedroom', rect: [0, 0, 4, 3.6] },
        { id: 'hall', type: 'hall', rect: [0, 3.6, 4, 5.2] },
      ],
      openings: [
        { kind: 'window', room: 'bedroom', wall: 'north', along: 2, width: 1.4, height: 1.3, sill: 0.9, id: 'win-n' },
        { kind: 'door', room: 'bedroom', wall: 'south', to: 'hall', along: 3.2, width: 0.9, id: 'door-bed' },
        { kind: 'door', room: 'hall', wall: 'south', to: 'outside', along: 1.4, width: 1, main: true, id: 'front' },
      ],
    },
  ],
  furniture: [
    { id: 'bed', kind: 'bed', room: 'bedroom', intent: 'bed centred on the north wall', relations: [{ type: 'against_wall', wall: 'north' }, { type: 'centred_on_wall', wall: 'north' }] },
    { id: 'ns-left', kind: 'nightstand', room: 'bedroom', intent: 'nightstand left of the bed', relations: [{ type: 'flanks', target: 'bed', side: 'left', gap: 0.05 }] },
    { id: 'picture', kind: 'art', room: 'bedroom', intent: 'picture centred above the bed', relations: [{ type: 'above_centred', target: 'bed', gap: 0.3 }] },
  ],
};

function parse(over: Record<string, unknown> = {}): DesignPlan {
  return DesignPlan.parse({ ...BASE, ...over });
}

function build(plan: DesignPlan, world: WorldDoc = createWorld({})): WorldDoc {
  const res = applyArchOps(world, [{ op: 'create_building', plan: designToBuildingPlan(plan) }]);
  expect(res.errors).toEqual([]);
  const applied = applyPatches(world, res.patches);
  expect(applied.errors).toEqual([]);
  return applied.world;
}

describe('design plan validation', () => {
  it('accepts a sound plan', () => {
    const v = validateDesign(parse());
    expect(v.errors).toEqual([]);
  });

  it('refuses a window in a shared wall, an overlapping pair of openings and a door between rooms that do not touch', () => {
    const lvl = BASE.levels[0]!;
    const bad = parse({ levels: [{ ...lvl, openings: [...lvl.openings, { kind: 'window', room: 'bedroom', wall: 'south', along: 1, width: 1 }] }] });
    expect(validateDesign(bad).errors.join('\n')).toMatch(/not an exterior wall/);
    const overlap = parse({ levels: [{ ...lvl, openings: [...lvl.openings, { kind: 'window', room: 'bedroom', wall: 'north', along: 2.5, width: 1 }] }] });
    expect(validateDesign(overlap).errors.join('\n')).toMatch(/overlap/);
    const far = parse({
      levels: [{ ...lvl, rooms: [...lvl.rooms, { id: 'shed', type: 'storage', rect: [10, 10, 12, 12] }], openings: [...lvl.openings, { kind: 'door', room: 'hall', wall: 'east', to: 'shed', along: 0.8, width: 0.8 }] }],
    });
    const msg = validateDesign(far).errors.join('\n');
    expect(msg).toMatch(/do not share|not a room|connecting/);
  });

  it('explains a window that does not fit its wall with the range that would', () => {
    const lvl = BASE.levels[0]!;
    const plan = parse({ levels: [{ ...lvl, openings: [{ kind: 'window', room: 'bedroom', wall: 'north', along: 3.8, width: 1.4 }, ...lvl.openings.slice(1)] }] });
    const msg = validateDesign(plan).errors.join('\n');
    expect(msg).toMatch(/does not fit|not on an exterior/);
  });

  it('refuses unreachable rooms, missing entrances, overlapping rooms and unknown kinds', () => {
    const lvl = BASE.levels[0]!;
    const isolated = parse({ levels: [{ ...lvl, rooms: [...lvl.rooms, { id: 'study', type: 'office', rect: [4, 0, 7, 3.6] }] }] });
    expect(validateDesign(isolated).errors.join('\n')).toMatch(/study.*no door or opening/);
    const noEntrance = parse({ levels: [{ ...lvl, openings: lvl.openings.filter((o) => o.to !== 'outside') }] });
    expect(validateDesign(noEntrance).errors.join('\n')).toMatch(/no door leads outside/);
    const overlapping = parse({ levels: [{ ...lvl, rooms: [lvl.rooms[0], { id: 'hall', type: 'hall', rect: [0, 3, 4, 5.2] }] }] });
    expect(validateDesign(overlapping).errors.join('\n')).toMatch(/overlap/);
    const kind = parse({ furniture: [{ id: 'x', kind: 'hovercraft', room: 'bedroom' }] });
    expect(validateDesign(kind).errors.join('\n')).toMatch(/unknown kind/);
  });

  it('rejects hostile plans at the schema', () => {
    expect(DesignPlan.safeParse({ ...BASE, id: '../x' }).success).toBe(false);
    expect(DesignPlan.safeParse({ ...BASE, levels: [] }).success).toBe(false);
    expect(DesignPlan.safeParse({ id: 'a', levels: [{ rooms: [{ id: 'r', type: 'living', rect: [0, 0, Number.POSITIVE_INFINITY, 1] }] }] }).success).toBe(false);
    expect(DesignPlan.safeParse({ ...BASE, furniture: Array.from({ length: 400 }, (_, i) => ({ id: `p${i}`, kind: 'bed', room: 'bedroom' })) }).success).toBe(false);
  });
});

describe('design plan to shell', () => {
  const world = build(parse());
  const scene = readScene(world, 'home')!;

  it('builds the shell with the openings exactly where the plan put them and no furniture', () => {
    expect(scene.items).toHaveLength(0);
    const bedroom = scene.rooms.find((r) => r.key === 'bedroom')!;
    const win = bedroom.walls.find((w) => w.compass === 'north')!.openings[0]!;
    expect(win.kind).toBe('window');
    expect(win.centre).toBeCloseTo(2, 1);
    expect(win.width).toBeCloseTo(1.4, 2);
    const door = bedroom.walls.find((w) => w.compass === 'south')!.openings.find((o) => o.kind === 'door')!;
    expect(door.centre).toBeCloseTo(3.2, 1);
    const text = describeShell(scene);
    expect(text).toContain('room bedroom');
    expect(text).toContain('north wall');
  });

  it('keeps pieces placed through the tools when the shell is re-submitted', () => {
    let w = applyEdit(world, placeItem(world, undefined, { kind: 'bed', room: 'bedroom', id: 'bed', wall: 'north', align: 'centre' }));
    w = build(parse({ levels: [{ ...BASE.levels[0]!, openings: BASE.levels[0]!.openings.map((o) => (o.id === 'door-bed' ? { ...o, along: 3.0 } : o)) }] }), w);
    const s2 = readScene(w, 'home')!;
    expect(s2.items.map((i) => i.id)).toEqual(['home-bed']);
    const door = s2.rooms.find((r) => r.key === 'bedroom')!.walls.find((x) => x.compass === 'south')!.openings.find((o) => o.kind === 'door')!;
    expect(door.centre).toBeCloseTo(3.0, 1);
  });

  it('drops placed pieces whose room disappears', () => {
    let w = applyEdit(world, placeItem(world, undefined, { kind: 'bed', room: 'bedroom', id: 'bed', wall: 'north', align: 'centre' }));
    const hallOnly = parse({
      levels: [{ rooms: [{ id: 'hall', type: 'hall', rect: [0, 3.6, 4, 5.2] }], openings: [{ kind: 'door', room: 'hall', wall: 'south', to: 'outside', along: 1.4, width: 1, main: true }] }],
      furniture: [],
    });
    w = build(hallOnly, w);
    expect(readScene(w, 'home')!.items).toHaveLength(0);
  });

  it('stores the design record on the plan', () => {
    const plan = planOf(world, 'home');
    expect(plan.design?.furniture.map((f) => f.id)).toEqual(['bed', 'ns-left', 'picture']);
    expect(plan.design?.brief).toContain('calm bedroom');
  });
});

describe('conformance with the plan', () => {
  const world0 = build(parse());
  const design = planOf(world0, 'home').design;

  it('reports pieces that were never placed', () => {
    const f = checkConformance(readScene(world0, 'home')!, design);
    expect(f.filter((x) => x.code === 'plan_missing')).toHaveLength(3);
  });

  it('is satisfied when the pieces keep their planned relations, and says what is off otherwise', () => {
    let w = applyEdit(world0, placeItem(world0, undefined, { kind: 'bed', room: 'bedroom', id: 'bed', wall: 'north', align: 'centre' }));
    w = applyEdit(w, placeItem(w, undefined, { kind: 'nightstand', room: 'bedroom', id: 'ns-left', wall: 'north', t: 0.62, params: { width: 0.4 } }));
    const s = readScene(w, 'home')!;
    const bed = s.items.find((i) => i.id === 'home-bed')!;
    const f1 = checkConformance(s, design);
    expect(f1.filter((x) => x.code === 'plan_mismatch')).toEqual([]);
    expect(bed.against?.[0]?.compass).toBe('north');
    // A bed pushed off centre breaks "centred on the wall".
    const moved = applyEdit(w, moveItem(w, undefined, 'bed', { wall: 'north', align: 'end' }));
    const f2 = checkConformance(readScene(moved, 'home')!, design);
    expect(f2.some((x) => x.code === 'plan_mismatch' && x.message.includes('centred'))).toBe(true);
    const f3 = checkConformance(readScene(moved, 'home')!, design).filter((x) => x.entities.length === 0);
    expect(f3.every((x) => x.code === 'plan_missing')).toBe(true);
    void ({} as Patch);
  });
});

describe('loose opening references and curtains', () => {
  const world0 = build(parse());
  const design = {
    ...planOf(world0, 'home').design!,
    furniture: [{ id: 'curt', kind: 'curtain', room: 'bedroom', intent: 'curtains framing the window', relations: [{ type: 'centred_on_opening' as const, target: 'bedroom-north-window' }] }],
  };

  it('finds the only window of the room from the words the model used', () => {
    let w = applyEdit(world0, placeItem(world0, undefined, { kind: 'curtain', room: 'bedroom', id: 'curt', opening: 'home-l0-win0' }));
    const f = checkConformance(readScene(w, 'home')!, design);
    expect(f.filter((x) => x.code === 'plan_mismatch')).toEqual([]);
    expect(f.filter((x) => x.code === 'plan_missing')).toEqual([]);
    // Curtains hung away from the window do not satisfy the relation.
    w = applyEdit(w, moveItem(w, undefined, 'home-curt-l', { wall: 'west', t: 1.8 }));
    const g = checkConformance(readScene(w, 'home')!, design);
    expect(g.some((x) => x.code === 'plan_mismatch')).toBe(true);
  });

  it('hangs a panel on both sides of a window near a corner, gathering the corner side flush over the glass edge', () => {
    const lvl = BASE.levels[0]!;
    const openings = lvl.openings.map((o) => (o.id === 'win-n' ? { ...o, along: 2.85, width: 1.2 } : o));
    const w0 = build(parse({ levels: [{ ...lvl, openings }] }));
    const w = applyEdit(w0, placeItem(w0, undefined, { kind: 'curtain', room: 'bedroom', id: 'curt', opening: 'home-l0-win0', params: { width: 0.95 } }));
    const scene = readScene(w, 'home')!;
    const panels = scene.items.filter((i) => i.kind === 'curtain');
    expect(panels).toHaveLength(2);
    const wall = scene.rooms[0]!.walls.find((x) => x.openings.some((o) => o.id === 'home-l0-win0'))!;
    const win = wall.openings.find((o) => o.id === 'home-l0-win0')!;
    const right = panels.map((p) => p.wall!).sort((a, b) => a.t - b.t)[1]!;
    // The right panel ends at the corner and still covers part of the window.
    expect(right.t + right.width / 2).toBeLessThanOrEqual(wall.length);
    expect(right.t - right.width / 2).toBeLessThan(win.t1);
  });

  it('accepts "opening" as the name of a relation target', () => {
    const p = DesignPlan.parse({ ...BASE, furniture: [{ id: 'c', kind: 'curtain', room: 'bedroom', relations: [{ type: 'centred_on_opening', opening: 'win-n' }] }] });
    expect(p.furniture[0]!.relations[0]!.target).toBe('win-n');
  });
});
