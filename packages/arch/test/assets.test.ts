/**
 * Furnished rooms with real library furniture: when the asset catalog is
 * loaded, kinds with a photographed model (sofa, armchair, coffee table,
 * nightstand, pendant) are placed as `asset` shapes sized by the model and
 * keeping the parametric generator as fallback; layouts, the floor plan and
 * the usability checks treat them exactly like procedural pieces. Without a
 * catalog everything stays procedural.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { applyPatches, createWorld, type PatchInput, type WorldDoc } from '@aether/core';
import { loadCatalog, setCatalog } from '@aether/assets';
import { checkBuilding, compileBuilding, floorPlan2d } from '../src/index';
import { FURNITURE_ASSETS, furnitureAsset, furnitureOfEntity } from '../src/furniture/assets';
import { APARTMENT } from './fixtures';

function build(): WorldDoc {
  const c = compileBuilding(APARTMENT);
  const res = applyPatches(createWorld({ environment: { ground: { material: { preset: 'grass' }, size: 200 } } }), c.patches as PatchInput[], { atomic: true });
  expect(res.errors).toEqual([]);
  return res.world;
}

afterEach(() => {
  setCatalog(null);
});

describe('library furniture in buildings', () => {
  it('uses photographed models for mapped kinds, with the generator as fallback', async () => {
    await loadCatalog();
    expect(furnitureAsset('sofa')?.id).toBe('sofa-classic');
    expect(furnitureAsset('bed')).toBeNull();
    const world = build();
    const sofa = Object.values(world.entities).find((e) => e.arch?.kind === 'sofa')!;
    expect(sofa.shape).toMatchObject({ kind: 'asset', id: 'sofa-classic', fallback: { kind: 'procedural', generator: 'furn-sofa' } });
    expect(sofa.physics?.body).toBe('static');
    // The material swap variants are generator params: none for a library model.
    expect(sofa.arch?.variants).toBeUndefined();
    const f = furnitureOfEntity(sofa)!;
    expect(f.def.kind).toBe('sofa');
    expect(f.size[0]).toBeCloseTo(1.571, 2);
    const beds = Object.values(world.entities).filter((e) => e.arch?.kind === 'bed');
    for (const b of beds) expect(b.shape.kind).toBe('procedural');
  });

  it('hangs ceiling models from their top and the checks agree', async () => {
    await loadCatalog();
    const world = build();
    const pendant = Object.values(world.entities).find((e) => e.shape.kind === 'asset' && e.shape.id === 'pendant-lamp');
    expect(pendant).toBeTruthy();
    const report = checkBuilding(world, 'apt');
    expect(report.issues.filter((i) => i.code === 'floating' || i.code === 'furniture_overlap')).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it('the floor plan draws library furniture footprints', async () => {
    await loadCatalog();
    const world = build();
    const plan = floorPlan2d(world, 'apt', 0)!;
    const sofa = Object.values(world.entities).find((e) => e.arch?.kind === 'sofa')!;
    expect(plan.items.some((i) => i.id === sofa.id && i.kind === 'sofa')).toBe(true);
  });

  it('without a catalog every piece stays procedural', () => {
    setCatalog(null);
    const world = build();
    expect(Object.values(world.entities).some((e) => e.shape.kind === 'asset')).toBe(false);
    expect(checkBuilding(world, 'apt').passed).toBe(true);
  });

  it('maps only kinds whose models exist in the shipped catalog', async () => {
    const catalog = await loadCatalog();
    const ids = new Set(catalog.entries.map((e) => e.id));
    for (const list of Object.values(FURNITURE_ASSETS)) for (const id of list) expect(ids.has(id), id).toBe(true);
  });
});
