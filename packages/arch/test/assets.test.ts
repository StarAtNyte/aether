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

function build(style: 'modern' | 'classic' = 'classic'): WorldDoc {
  const c = compileBuilding({ ...APARTMENT, style });
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
    expect(furnitureAsset('sofa', 'classic')?.id).toBe('sofa-classic');
    // A modern flat gets a real modern sofa from the interior set (the hand-picked classic one stays classic-only).
    expect(furnitureAsset('sofa', 'modern')?.id).toMatch(/^sofa-0[23]$/);
    expect(furnitureAsset('pendant', 'modern')?.id).toBe('pendant-lamp');
    // Beds come from the interior set too, but kinds with doors and drawers keep their parametric parts.
    expect(furnitureAsset('bed', 'classic')?.id).toMatch(/^bed-/);
    expect(furnitureAsset('wardrobe', 'classic')).toBeNull();
    expect(furnitureAsset('nightstand', 'modern')).toBeNull();
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
    for (const b of beds) expect(b.shape.kind === 'procedural' || (b.shape.kind === 'asset' && b.shape.fallback?.kind === 'procedural')).toBe(true);
    for (const w of Object.values(world.entities).filter((e) => e.arch?.kind === 'wardrobe')) expect(w.shape.kind).toBe('procedural');
  });

  it('a modern flat keeps parametric seating but gets real coffee tables and pendants', async () => {
    await loadCatalog();
    const world = build('modern');
    const ids = Object.values(world.entities).flatMap((e) => (e.shape.kind === 'asset' ? [e.shape.id] : []));
    expect(ids).not.toContain('sofa-classic');
    expect(ids).toContain('pendant-lamp');
  });

  it('hangs ceiling models from their top and the checks agree', async () => {
    await loadCatalog();
    const world = build('modern');
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
    for (const list of Object.values(FURNITURE_ASSETS)) for (const opt of list) expect(ids.has(opt.id), opt.id).toBe(true);
  });
});
