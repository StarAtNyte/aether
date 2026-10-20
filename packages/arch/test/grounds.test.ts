/**
 * House exteriors and grounds: the style's facade articulation (clad upper storey, plinth band, window surrounds,
 * entrance canopy, gutters and downpipes), the compiled garden and estate land, room dressing, and the set_site /
 * dress_room ops.
 */
import { describe, expect, it } from 'vitest';
import { Entity, applyPatches, createWorld, type EntityInput, type WorldDoc } from '@aether/core';
import { compileBuilding } from '../src/compile';
import { applyArchOps } from '../src/ops';
import { checkBuilding } from '../src/nav';
import { buildStructure } from '../src/structure';
import type { BuildingPlanInput } from '../src/index';
import { APARTMENT } from './fixtures';

/** A two-storey house with a pool terrace in front of its main door. */
const HOUSE: BuildingPlanInput = {
  id: 'villa',
  name: 'House',
  style: 'modern',
  levels: [
    {
      height: 3.1,
      rooms: [
        { id: 'living', type: 'living', rect: [0, 0, 8, 6] },
        { id: 'kitchen', type: 'kitchen', rect: [8, 0, 12, 6] },
      ],
      doors: [
        { between: ['living', 'outside'], side: 'south', main: true, width: 1.1 },
        { between: ['living', 'kitchen'], kind: 'opening', width: 2 },
      ],
      stairs: [{ at: [0.5, 1.2], heading: 'east', width: 1 }],
    },
    {
      height: 2.9,
      rooms: [
        { id: 'landing', type: 'hall', rect: [0, 0, 9, 3] },
        { id: 'master', type: 'bedroom', rect: [0, 3, 5, 6] },
        { id: 'bed2', type: 'bedroom', rect: [5, 3, 9, 6] },
        { id: 'bath', type: 'bathroom', rect: [9, 0, 12, 6] },
      ],
      doors: [{ between: ['landing', 'master'] }, { between: ['landing', 'bed2'] }, { between: ['landing', 'bath'] }],
    },
  ],
  site: { terrace: [[-2, 6], [14, 6], [14, 14], [-2, 14]], pool: { at: [6, 10.5], width: 7, length: 3 }, garden: true, surroundings: 'estate' },
};

function params(e: EntityInput): Record<string, unknown> {
  return e.shape && 'params' in e.shape ? (e.shape.params as Record<string, unknown>) : {};
}

describe('facade articulation', () => {
  it('a modern house gets a clad upper storey over a rendered base when the plan names no facade', () => {
    const c = compileBuilding(HOUSE);
    const walls = c.entities.filter((e) => e.arch?.role === 'wall' && e.arch.kind === 'exterior');
    const outside = (e: EntityInput): unknown => (params(e)['finishA'] as { finish?: string })?.finish === 'plaster' && e.parent === 'villa-l0' ? 'plaster' : [params(e)['finishA'], params(e)['finishB']].map((f) => (f as { finish?: string }).finish).find((f) => f === 'cladding' || f === 'plaster');
    expect(walls.filter((w) => w.parent === 'villa-l1').some((w) => outside(w) === 'cladding')).toBe(true);
    expect(walls.filter((w) => w.parent === 'villa-l0').every((w) => outside(w) !== 'cladding')).toBe(true);
    // A facade the plan names is used on every storey.
    const named = compileBuilding({ ...HOUSE, exteriorWall: { thickness: 0.28, finish: { finish: 'brick' } } });
    const finishes = named.entities.filter((e) => e.arch?.role === 'wall' && e.arch.kind === 'exterior').flatMap((w) => [params(w)['finishA'], params(w)['finishB']].map((f) => (f as { finish?: string }).finish));
    expect(finishes).not.toContain('cladding');
    expect(finishes).toContain('brick');
  });

  it('ground-floor exterior walls stand on a plinth band, upper ones do not; the band is geometry on the outdoor face only', () => {
    const c = compileBuilding(HOUSE);
    const ext = c.entities.filter((e) => e.arch?.role === 'wall' && e.arch.kind === 'exterior');
    expect(ext.filter((w) => w.parent === 'villa-l0').every((w) => params(w)['base'] !== undefined)).toBe(true);
    expect(ext.filter((w) => w.parent === 'villa-l1').every((w) => params(w)['base'] === undefined)).toBe(true);
    const wall = ext.find((w) => w.parent === 'villa-l0') as EntityInput;
    const withBand = buildStructure('arch-wall', params(wall) as never);
    const without = buildStructure('arch-wall', { ...params(wall), base: undefined } as never);
    expect(withBand.parts.length).toBe(without.parts.length + 1);
    // Colliders are unchanged: the band never narrows a doorway.
    expect(withBand.colliders).toEqual(without.colliders);
  });

  it('large windows get the style surround, the main door a canopy, the roof gutters or downpipes', () => {
    const c = compileBuilding(HOUSE);
    const windows = c.entities.filter((e) => e.arch?.role === 'window');
    expect(windows.some((w) => (params(w)['surround'] as { style?: string } | undefined)?.style === 'box')).toBe(true);
    expect(c.entities.some((e) => e.arch?.kind === 'canopy')).toBe(true);
    expect(c.entities.filter((e) => e.arch?.kind === 'downpipe')).toHaveLength(2);
    const gable = compileBuilding({ ...HOUSE, style: 'scandinavian', roof: { shape: 'gable', pitch: 30, overhang: 0.4 } });
    const roof = gable.entities.find((e) => e.arch?.role === 'roof') as EntityInput;
    expect(params(roof)['gutters']).toBe(true);
    expect(params(roof)['downpipe']).toBeGreaterThan(5);
    expect(buildStructure('arch-roof', params(roof) as never).parts.length).toBeGreaterThan(buildStructure('arch-roof', { ...params(roof), gutters: false } as never).parts.length);
    const scandi = gable.entities.filter((e) => e.arch?.role === 'window');
    expect(scandi.every((w) => (params(w)['surround'] as { style?: string } | undefined)?.style === 'board')).toBe(true);
    for (const w of scandi) expect(buildStructure('arch-window', params(w) as never).parts.length).toBeGreaterThan(0);
  });
});

describe('grounds', () => {
  it('a garden: stepping slabs to the plot edge clear of the pool, hedges, beds with planting, trees; estate land and groves on it', () => {
    const c = compileBuilding(HOUSE);
    const site = c.entities.filter((e) => e.arch?.role === 'site');
    for (const e of site) {
      expect(e.parent === 'villa' || e.parent === 'villa-l0').toBe(true);
      expect(Entity.safeParse(e).success).toBe(true);
    }
    const kinds = new Set(site.map((e) => e.arch?.kind));
    for (const k of ['path', 'hedge', 'tree', 'terrain', 'grove', 'bed', 'planting']) expect(kinds.has(k), k).toBe(true);
    // No paving slab over the pool (x 2.2..9.8, z 8.7..12.3).
    for (const slab of site.filter((e) => e.arch?.kind === 'path')) {
      const poly = params(slab)['polygon'] as Array<[number, number]>;
      const cx = poly.reduce((s, q) => s + q[0], 0) / poly.length;
      const cz = poly.reduce((s, q) => s + q[1], 0) / poly.length;
      expect(cx > 2 && cx < 10 && cz > 8.5 && cz < 12.5, `slab at ${cx}, ${cz}`).toBe(false);
    }
    const land = site.find((e) => e.arch?.kind === 'terrain') as EntityInput;
    expect(params(land)['variant']).toBe(5);
    expect(params(land)['cutX1']).toBeGreaterThan(params(land)['cutX0'] as number);
    for (const g of site.filter((e) => e.arch?.kind === 'grove')) {
      expect(g.shape?.kind === 'scatter' && g.shape.onSurface).toBe('villa-land');
    }
    // Deterministic.
    expect(compileBuilding(HOUSE).entities).toEqual(c.entities);
  });

  it('nothing outside unless asked; grounds do not touch the walkthrough check', () => {
    const plain = compileBuilding({ ...HOUSE, site: { terrace: [[-2, 6], [14, 6], [14, 14], [-2, 14]], pool: { at: [6, 10.5], width: 7, length: 3 } } });
    expect(plain.entities.some((e) => e.arch?.kind === 'hedge' || e.arch?.kind === 'terrain')).toBe(false);
    const world = applyPatches(createWorld(), compileBuilding(HOUSE).patches).world;
    expect(checkBuilding(world, 'villa').passed).toBe(true);
  });
});

describe('dressing', () => {
  const kindsIn = (c: ReturnType<typeof compileBuilding>, room: string): string[] => c.entities.filter((e) => e.arch?.room === room).map((e) => e.arch?.kind ?? '');

  it('auto-furnished rooms are dressed (rugs, plants, styling), and the pieces placed before keep their ids', () => {
    const dressed = compileBuilding(HOUSE);
    const bare = compileBuilding({ ...HOUSE, levels: HOUSE.levels.map((l) => ({ ...l, rooms: l.rooms.map((r) => ({ ...r, dress: false })) })) });
    const living = kindsIn(dressed, 'villa-l0-living');
    expect(living).toContain('rug');
    expect(living).toContain('accent');
    expect(kindsIn(bare, 'villa-l0-living')).not.toContain('accent');
    expect(kindsIn(dressed, 'villa-l1-master')).toContain('rug');
    // Every piece of the undressed room is in the dressed one under the same id, at the same place.
    const ids = new Map(dressed.entities.map((e) => [e.id, e]));
    for (const e of bare.entities.filter((x) => x.arch?.role === 'furniture')) expect(ids.get(e.id)?.transform).toEqual(e.transform);
  });

  it('dress_room and set_site ops change the stored plan and re-compile', () => {
    const base = applyArchOps(createWorld(), [{ op: 'create_building', plan: { ...APARTMENT, levels: APARTMENT.levels.map((l) => ({ ...l, rooms: l.rooms.map((r) => ({ ...r, furnish: false })) })) } }]);
    expect(base.errors).toEqual([]);
    const before = Object.values(base.target.entities).filter((e) => e.arch?.kind === 'rug').length;
    const dressed = applyArchOps(base.target as WorldDoc, [{ op: 'place_item', building: 'apt', room: 'living', item: { kind: 'sofa', against: 'north' } }, { op: 'dress_room', building: 'apt' }]);
    expect(dressed.errors).toEqual([]);
    expect(Object.values(dressed.target.entities).filter((e) => e.arch?.kind === 'rug').length).toBeGreaterThan(before);
    const sited = applyArchOps(dressed.target as WorldDoc, [{ op: 'set_site', building: 'apt', site: { garden: true, surroundings: 'estate' } }]);
    expect(sited.errors).toEqual([]);
    expect(Object.values(sited.target.entities).some((e) => e.arch?.kind === 'hedge')).toBe(true);
    expect(sited.lines.join(' ')).toContain('set_site garden, estate');
    const bad = applyArchOps(sited.target as WorldDoc, [{ op: 'set_site', building: 'apt', site: { surroundings: 'jungle' } }]);
    expect(bad.errors).toHaveLength(1);
  });
});
