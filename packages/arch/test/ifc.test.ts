import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld, type PatchInput } from '@aether/core';
import { compileBuilding } from '../src/index';
import { exportWorldToIfc } from '../src/ifc/world-to-ifc';
import { formatReal, formatString, StepWriter } from '../src/ifc/step';
import { ifcGuidFromSeed, GuidRegistry } from '../src/ifc/guid';
import { APARTMENT } from './fixtures';

describe('STEP writer', () => {
  it('formats reals, strings and entities', () => {
    expect(formatReal(1)).toBe('1.');
    expect(formatReal(-0)).toBe('0.');
    expect(formatReal(0.25)).toBe('0.25');
    expect(formatString("it's")).toBe("'it''s'");
    expect(formatString('é')).toBe("'\\X2\\00E9\\X0\\'");
    const w = new StepWriter();
    const a = w.add('IFCCARTESIANPOINT', [1, 2, 3]);
    expect(a.id).toBe(1);
    expect(w.addShared('IFCDIRECTION', [0, 0, 1])).toBe(w.addShared('IFCDIRECTION', [0, 0, 1]));
  });
  it('makes stable, unique 22-char GUIDs', () => {
    expect(ifcGuidFromSeed('a')).toBe(ifcGuidFromSeed('a'));
    expect(ifcGuidFromSeed('a')).toMatch(/^[0-3][0-9A-Za-z_$]{21}$/);
    const r = new GuidRegistry();
    expect(r.claim('x')).not.toBe(r.claim('x'));
  });
});

describe('IFC export of a compiled building', () => {
  const c = compileBuilding(APARTMENT);
  const res = applyPatches(createWorld({}), c.patches as PatchInput[], { atomic: true });
  expect(res.errors).toEqual([]);
  const out = exportWorldToIfc(res.world, { timestamp: new Date('2026-01-01T00:00:00Z') });

  it('is a well-formed IFC4 STEP file', () => {
    expect(out.ifc.startsWith('ISO-10303-21;')).toBe(true);
    expect(out.ifc).toContain("FILE_SCHEMA(('IFC4'))");
    expect(out.ifc.trimEnd().endsWith('END-ISO-10303-21;')).toBe(true);
    const ids = [...out.ifc.matchAll(/^#(\d+)=/gm)].map((m) => Number(m[1]));
    expect(ids.length).toBeGreaterThan(100);
    expect(new Set(ids).size).toBe(ids.length);
    // Every reference points to an entity that exists.
    const known = new Set(ids);
    for (const m of out.ifc.matchAll(/#(\d+)/g)) expect(known.has(Number(m[1]))).toBe(true);
  });

  it('exports walls, openings, doors, windows, slabs and spaces', () => {
    expect(out.elements['IFCBUILDING']).toBe(1);
    expect(out.elements['IFCBUILDINGSTOREY']).toBe(1);
    expect(out.elements['IFCWALL']).toBe(c.stats.walls);
    const roleCount = (r: string): number => Object.values(res.world.entities).filter((e) => e.arch?.role === r).length;
    expect(out.elements['IFCDOOR']).toBe(roleCount('door'));
    expect(out.elements['IFCWINDOW']).toBe(roleCount('window'));
    // Every leaf and window sits in a wall hole.
    expect(out.ifc.match(/IFCRELFILLSELEMENT/g)?.length).toBe(roleCount('door') + roleCount('window'));
    expect(out.elements['IFCSLAB']).toBeGreaterThan(0);
    expect(out.elements['IFCSPACE']).toBe(c.stats.rooms);
    expect(out.ifc).toContain('IFCRELVOIDSELEMENT');
    expect(out.ifc).toContain('IFCRELFILLSELEMENT');
  });

  it('is deterministic', () => {
    const again = exportWorldToIfc(res.world, { timestamp: new Date('2026-01-01T00:00:00Z') });
    expect(again.ifc).toBe(out.ifc);
  });
});
