import { describe, expect, it } from 'vitest';
import { Catalog, type CatalogInput } from '../src/schema';
import { describeModel, findModels, interiorTypes, pickModel, resolveType } from '../src/interior';

const model = (id: string, name: string, size: [number, number, number], type: string, styles: string[], colors: string[], rgb: [number, number, number], extra: Record<string, unknown> = {}): CatalogInput['entries'][number] =>
  ({
    id,
    name,
    kind: 'model',
    category: 'furniture',
    tags: [type],
    style: 'realistic',
    pack: 'polyhaven',
    size,
    tris: 1000,
    bytes: 100_000,
    file: `i/${id}.01234567.glb`,
    lods: [],
    collider: { type: 'box' },
    placement: 'floor',
    interior: { type, styles, colors, rgb },
    source: 'test',
    ...extra,
  }) as CatalogInput['entries'][number];

const catalog = Catalog.parse({
  version: 1,
  base: '/assets/lib/',
  packs: [{ id: 'polyhaven', title: 'Poly Haven', author: 'x', licence: 'CC0-1.0', licenceUrl: 'https://polyhaven.com/license', url: 'https://polyhaven.com', version: '1' }],
  entries: [
    model('sofa-modern', 'Modern sofa', [2.1, 0.8, 0.9], 'sofa', ['modern', 'contemporary'], ['grey'], [128, 128, 128]),
    model('sofa-carved', 'Carved sofa', [1.9, 1, 0.8], 'sofa', ['asian', 'traditional'], ['brown'], [112, 74, 44]),
    model('sofa-green', 'Green sofa', [2.0, 0.85, 0.9], 'sofa', ['classic'], ['green'], [74, 120, 58]),
    model('coffee-low', 'Low coffee table', [1.1, 0.35, 0.6], 'coffee-table', ['modern', 'minimal'], ['tan'], [186, 148, 104]),
    model('lamp-pendant', 'Pendant lamp', [0.4, 0.6, 0.4], 'lamp', ['modern'], ['black'], [28, 28, 30], { placement: 'ceiling', category: 'lighting' }),
    model('lamp-desk', 'Desk lamp', [0.2, 0.5, 0.2], 'lamp', ['modern'], ['black'], [28, 28, 30], { placement: 'surface', category: 'lighting' }),
    model('plant-pot', 'Potted plant', [0.4, 0.9, 0.4], 'plant', ['modern'], ['green'], [74, 120, 58], { category: 'plants' }),
    { ...model('sofa-classic', 'Classic sofa', [2, 0.9, 0.9], 'sofa', [], [], [128, 128, 128]), interior: undefined },
  ],
});

describe('interior model finder', () => {
  it('resolves types through synonyms', () => {
    expect(resolveType(catalog, 'couch')).toBe('sofa');
    expect(resolveType(catalog, 'Coffee Table')).toBe('coffee-table');
    expect(resolveType(catalog, 'dragon')).toBeNull();
    expect(interiorTypes(catalog)).toEqual(expect.arrayContaining(['sofa', 'coffee-table', 'lamp', 'plant']));
  });

  it('ranks by style, then colour, then size', () => {
    expect(findModels(catalog, { type: 'sofa', style: 'modern' })[0]!.entry.id).toBe('sofa-modern');
    expect(findModels(catalog, { type: 'sofa', style: 'classic', color: 'green' })[0]!.entry.id).toBe('sofa-green');
    expect(findModels(catalog, { type: 'sofa', color: '#70492b' })[0]!.entry.id).toBe('sofa-carved');
    expect(findModels(catalog, { type: 'sofa', size: [1.9, undefined, undefined] }).map((h) => h.entry.id)[0]).toBe('sofa-carved');
  });

  it('takes the type and colour from free text', () => {
    const hits = findModels(catalog, { text: 'green velvet couch' });
    expect(hits[0]!.entry.id).toBe('sofa-green');
    expect(hits[0]!.notes.join(' ')).toContain('colour: green');
  });

  it('maps a catalogue kind to its mount', () => {
    expect(findModels(catalog, { kind: 'pendant' }).map((h) => h.entry.id)).toEqual(['lamp-pendant']);
    expect(findModels(catalog, { kind: 'table-lamp' }).map((h) => h.entry.id)).toEqual(['lamp-desk']);
  });

  it('picks nothing when a strict style has no model, but plants suit any room', () => {
    expect(pickModel(catalog, 'coffee-table', 'classic')).toBeNull();
    expect(pickModel(catalog, 'coffee-table', 'scandinavian')?.id).toBe('coffee-low');
    expect(pickModel(catalog, 'plant', 'classic')?.id).toBe('plant-pot');
  });

  it('is repeatable for a seed and describes a hit for judging', () => {
    expect(pickModel(catalog, 'sofa', 'modern', { seed: 'living' })?.id).toBe(pickModel(catalog, 'sofa', 'modern', { seed: 'living' })?.id);
    const line = describeModel(findModels(catalog, { type: 'sofa', style: 'modern' })[0]!);
    expect(line).toContain('sofa-modern');
    expect(line).toContain('2.1x0.8x0.9 m');
  });

  it('keeps earlier realistic models whose id names a type, as candidates without a style', () => {
    expect(findModels(catalog, { type: 'sofa' }).map((h) => h.entry.id)).toContain('sofa-classic');
  });
});
