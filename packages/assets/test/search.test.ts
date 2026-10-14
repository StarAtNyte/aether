import { beforeEach, describe, expect, it } from 'vitest';
import { bestAsset, searchAssets, tokenize } from '../src/search';
import { synonymsOf, canonicalTags } from '../src/synonyms';
import { Catalog } from '../src/schema';
import { lodDistances, screenFraction, selectLod } from '../src/lod';
import { assetInfo, assetShapeSize, effectiveAssetId, fitScale, pickRoles, registerUserAsset, unregisterUserAsset } from '../src/info';
import { catalogEntry, libraryUrl, setCatalog } from '../src/registry';
import { catalogSummary } from '../src/summary';
import { TEST_CATALOG } from './fixtures';

const catalog = Catalog.parse(TEST_CATALOG);
const ids = (q: Parameters<typeof searchAssets>[1]): string[] => searchAssets(catalog, q).map((h) => h.entry.id);

describe('asset search', () => {
  it('tokenises camelCase, punctuation and plurals', () => {
    expect(tokenize('Two loungeSofas, please!')).toEqual(['two', 'lounge', 'sofa', 'please']);
    expect(tokenize('benches')).toEqual(['bench']);
    expect(tokenize('bodies')).toEqual(['body']);
  });

  it('finds by name, tag and synonym ("couch" finds the sofa)', () => {
    expect(ids('sofa')[0]).toBe('sofa');
    expect(ids('couch')).toContain('sofa');
    expect(ids('cop car')[0]).toBe('police-car');
    expect(ids('automobile')).toContain('police-car');
  });

  it('tolerates one typo in longer words and prefixes', () => {
    expect(ids('armchiar')).toContain('armchair-classic');
    expect(ids('arm')).toContain('armchair-classic');
  });

  it('requires every query word to match (AND)', () => {
    expect(ids('long sofa')[0]).toBe('sofa-long');
    expect(ids('purple elephant')).toEqual([]);
  });

  it('filters by category, kind, placement and animation', () => {
    expect(ids({ category: 'sky' })).toEqual(['sky-venice-sunset']);
    expect(ids({ kind: 'generator' })).toEqual(['ornate-fountain']);
    expect(ids({ placement: 'wall' })).toEqual(['wall-lamp']);
    expect(ids({ animated: true })).toEqual(['man']);
  });

  it('exact id wins; ties prefer lighter models; limit is capped', () => {
    expect(ids('sofa-long')[0]).toBe('sofa-long');
    expect(searchAssets(catalog, { text: '', limit: 2 }).length).toBe(2);
    expect(searchAssets(catalog, { text: '', limit: 10_000 }).length).toBe(catalog.entries.length);
    expect(searchAssets(catalog, { text: 'x'.repeat(10_000) })).toEqual([]);
  });

  it('bestAsset returns the top hit or null', () => {
    expect(bestAsset(catalog, 'couch')?.id).toBe('sofa');
    expect(bestAsset(catalog, 'spaceship')).toBeNull();
  });

  it('synonym groups are symmetric and expose canonical tags', () => {
    expect(synonymsOf('couch')).toContain('sofa');
    expect(synonymsOf('sofa')).toContain('couch');
    expect(synonymsOf('unknownword')).toEqual(['unknownword']);
    expect(canonicalTags('couch')).toContain('sofa');
  });
});

describe('LOD selection', () => {
  const entry = catalog.entries.find((e) => e.id === 'armchair-classic')!;
  it('projects size to screen fraction', () => {
    expect(screenFraction(1, 0, 50)).toBe(Infinity);
    expect(screenFraction(2, 10, 90)).toBeCloseTo(0.1, 5);
  });

  it('picks full detail close up and lower levels far away', () => {
    expect(selectLod(entry, 1, 50)).toBe(0);
    expect(selectLod(entry, 6, 50)).toBe(1);
    expect(selectLod(entry, 40, 50)).toBe(2);
    // Bias keeps detail longer (studio stills); entries without LODs always use 0.
    expect(selectLod(entry, 6, 50, 1, 3)).toBe(0);
    expect(selectLod(catalog.entries[0]!, 500, 50)).toBe(0);
  });

  it('LOD switch distances grow with each level', () => {
    const d = lodDistances(entry, 50);
    expect(d.length).toBe(2);
    expect(d[1]!).toBeGreaterThan(d[0]!);
    expect(lodDistances(entry, 50, 2)[0]!).toBeCloseTo(d[0]! * 2, 5);
  });
});

describe('asset info and registry', () => {
  beforeEach(() => {
    setCatalog(TEST_CATALOG);
  });

  it('resolves library entries with URLs, LODs and clips', () => {
    const info = assetInfo('armchair-classic')!;
    expect(info.kind).toBe('model');
    expect(info.url).toBe('/assets/lib/m/armchair-classic.0123abcd.glb');
    expect(info.lodUrls).toHaveLength(2);
    expect(assetInfo('man')!.anims?.walk).toBe('walk');
    expect(assetInfo('nope')).toBeNull();
    expect(catalogEntry('sofa')?.name).toBe('Sofa');
    expect(libraryUrl('t/x.webp')).toBe('/assets/lib/t/x.webp');
  });

  it('applies variants only when the catalog lists them', () => {
    expect(effectiveAssetId({ id: 'sofa', variant: 'sofa-long' })).toBe('sofa-long');
    expect(effectiveAssetId({ id: 'sofa', variant: 'man' })).toBe('sofa');
    expect(effectiveAssetId({ id: 'sofa' })).toBe('sofa');
  });

  it('sizes shapes with fitSize', () => {
    expect(assetShapeSize({ id: 'sofa' })).toEqual([2, 0.9, 0.9]);
    expect(assetShapeSize({ id: 'sofa', fitSize: 1 })).toEqual([1, 0.45, 0.45]);
    expect(assetShapeSize({ id: 'sky-venice-sunset' })).toBeNull();
    expect(assetShapeSize({ id: 'missing' })).toBeNull();
    expect(fitScale([0, 0, 0], 5)).toBe(1);
  });

  it('registers user imports (models, posters sized by aspect)', () => {
    registerUserAsset({ meta: { id: 'user-0123456789ab', kind: 'image', name: 'Poster', mime: 'image/png', bytes: 100, width: 200, height: 100, createdAt: 1 }, url: 'blob:x' });
    const poster = assetInfo('user-0123456789ab')!;
    expect(poster.kind).toBe('image');
    expect(poster.size[1]).toBeCloseTo(poster.size[0] / 2, 5);
    registerUserAsset({ meta: { id: 'user-aaaaaaaaaaaa', kind: 'model', name: 'Chair', mime: 'model/gltf-binary', bytes: 100, size: [1, 2, 3], clips: ['Idle', 'Walking'], createdAt: 1 }, url: 'blob:y' });
    const model = assetInfo('user-aaaaaaaaaaaa')!;
    expect(model.size).toEqual([1, 2, 3]);
    expect(model.anims?.idle).toBe('Idle');
    expect(model.anims?.walk).toBe('Walking');
    unregisterUserAsset('user-aaaaaaaaaaaa');
    expect(assetInfo('user-aaaaaaaaaaaa')).toBeNull();
    unregisterUserAsset('user-0123456789ab');
  });

  it('picks locomotion roles from clip names', () => {
    expect(pickRoles(['Armature|Idle', 'Armature|Walk', 'Armature|Run'])).toEqual({ idle: 'Armature|Idle', walk: 'Armature|Walk', run: 'Armature|Run' });
    expect(pickRoles(['static', 'sprint'])).toEqual({ run: 'sprint' });
  });

  it('summary lists categories with examples, empty for no catalog', () => {
    expect(catalogSummary(catalog)).toMatch(/- furniture \(\d+\): /);
    expect(catalogSummary(catalog)).toContain('animated');
    expect(catalogSummary(null)).toBe('');
  });

  it('rejects invalid catalogs', () => {
    expect(() => setCatalog({ version: 2 })).toThrow();
    expect(() => setCatalog({ ...TEST_CATALOG, entries: [{ ...TEST_CATALOG.entries[0], file: '../../etc/passwd' }] })).toThrow();
  });
});
