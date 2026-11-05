import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  ABO_CREDIT,
  ABO_REMOTE_BASE,
  aboEntries,
  aboEntry,
  aboFileOf,
  aboLoadUrl,
  aboOffset,
  aboPath,
  aboWeight,
  assetInfo,
  catalogEntry,
  creditsFor,
  creditsText,
  attributionLines,
  findAboModels,
  getAboIndex,
  isAboRemoteUrl,
  libraryUrl,
  loadAboIndex,
  parseAboPath,
  setAboBase,
} from '../src/index';

beforeAll(async () => {
  await loadAboIndex();
});

afterEach(() => setAboBase(null));

describe('Amazon Berkeley Objects index', () => {
  it('loads the committed gzipped index with thousands of furnishings at real size', () => {
    const idx = getAboIndex();
    expect(idx).not.toBeNull();
    expect(idx!.items.length).toBeGreaterThan(7000);
    const entries = aboEntries();
    const types = new Map<string, number>();
    for (const e of entries) types.set(e.interior!.type, (types.get(e.interior!.type) ?? 0) + 1);
    for (const t of ['sofa', 'chair', 'armchair', 'table', 'coffee-table', 'bed', 'lamp', 'rug', 'picture', 'mirror']) expect(types.get(t) ?? 0, t).toBeGreaterThan(50);
    // Real metres: every product fits a room and none is a speck.
    for (const e of entries) {
      expect(Math.max(...e.size), e.id).toBeLessThanOrEqual(8);
      expect(Math.max(...e.size), e.id).toBeGreaterThan(0.01);
    }
  });

  it('makes each product a catalog entry: LOD 0 near, the 512 and 256 px levels far, the 512 px copy for low tiers', () => {
    const sofa = aboEntries().find((e) => e.interior?.type === 'sofa' && e.placement === 'floor')!;
    const id = sofa.id.slice(4).toUpperCase();
    expect(catalogEntry(sofa.id)).toBe(sofa);
    expect(sofa.file).toBe(`objects_ktx2/${id}/${id}.glb`);
    expect(sofa.lods.map((l) => l.file)).toEqual([`lods/${id}/${id}_lod2.glb`, `lods/${id}/${id}_lod3.glb`]);
    expect(sofa.lite).toBe(`lods/${id}/${id}_lod2.glb`);
    expect(sofa.pack).toBe('abo');
    expect(sofa.size[0]).toBeGreaterThan(1);
    const info = assetInfo(sofa.id)!;
    expect(info.url).toBe(`${ABO_REMOTE_BASE}objects_ktx2/${id}/${id}.glb`);
    expect(info.lodUrls).toHaveLength(2);
    expect(info.liteUrl).toBe(`${ABO_REMOTE_BASE}lods/${id}/${id}_lod2.glb`);
    expect(aboWeight(sofa.id)!.bytes).toBe(sofa.bytes);
    expect(aboEntry('abo-zzzzzzzzzz')).toBeNull();
  });

  it('parses only the pack layout and allows only the pinned revision', () => {
    expect(parseAboPath('objects/B0714QGC72/B0714QGC72.glb')).toEqual({ id: 'B0714QGC72', level: 'webp' });
    expect(parseAboPath('lods/B0714QGC72/B0714QGC72_lod3.glb')).toEqual({ id: 'B0714QGC72', level: 3 });
    expect(parseAboPath('lods/B0714QGC72/B0714QGC73_lod3.glb')).toBeNull();
    expect(parseAboPath('objects/../secret.glb')).toBeNull();
    expect(isAboRemoteUrl(`${ABO_REMOTE_BASE}${aboPath('B0714QGC72', 0)}`)).toBe(true);
    expect(isAboRemoteUrl(`${ABO_REMOTE_BASE}README.md`)).toBe(false);
    expect(isAboRemoteUrl('https://huggingface.co/datasets/codepawl/abo-glb/resolve/main/objects/B0714QGC72/B0714QGC72.glb')).toBe(false);
    expect(isAboRemoteUrl('https://evil.example/objects/B0714QGC72/B0714QGC72.glb')).toBe(false);
  });

  it('picks the level a renderer can take: WebP without KTX2, never above the texture cap', () => {
    const near = `${ABO_REMOTE_BASE}${aboPath('B0714QGC72', 0)}`;
    expect(aboLoadUrl(near, { ktx2: true, textureCap: 0 })).toBe(near);
    expect(aboLoadUrl(near, { ktx2: true, textureCap: 512 })).toBe(`${ABO_REMOTE_BASE}${aboPath('B0714QGC72', 2)}`);
    expect(aboLoadUrl(near, { ktx2: true, textureCap: 256 })).toBe(`${ABO_REMOTE_BASE}${aboPath('B0714QGC72', 3)}`);
    expect(aboLoadUrl(`${ABO_REMOTE_BASE}${aboPath('B0714QGC72', 3)}`, { ktx2: true, textureCap: 512 })).toBe(`${ABO_REMOTE_BASE}${aboPath('B0714QGC72', 3)}`);
    expect(aboLoadUrl(`${ABO_REMOTE_BASE}${aboPath('B0714QGC72', 2)}`, { ktx2: false, textureCap: 0 })).toBe(`${ABO_REMOTE_BASE}${aboPath('B0714QGC72', 'webp')}`);
    expect(aboLoadUrl('/assets/lib/m/sofa.0123abcd.glb', { ktx2: true, textureCap: 0 })).toBeNull();
  });

  it('puts hanging products (wall art, pendants) on a floor-centre pivot like library models', () => {
    const art = aboEntries().find((e) => e.interior?.type === 'picture' && e.placement === 'wall')!;
    const off = aboOffset(libraryUrl(art.file!));
    expect(off).not.toBeNull();
    // Wall art is centred on its middle with its back on z = 0: lifted by half its height, pushed forward by half its depth.
    expect(off![1]).toBeCloseTo(art.size[1] / 2, 2);
    expect(off![2]).toBeCloseTo(-art.size[2] / 2, 2);
  });

  it('serves the files a published game carries from its own base', () => {
    setAboBase('/html/42/assets/lib/');
    const url = libraryUrl(aboPath('B0714QGC72', 2));
    expect(url).toBe('/html/42/assets/lib/lods/B0714QGC72/B0714QGC72_lod2.glb');
    expect(aboFileOf(url)).toEqual({ id: 'B0714QGC72', level: 2, path: 'lods/B0714QGC72/B0714QGC72_lod2.glb' });
    setAboBase('/../x/');
    expect(libraryUrl(aboPath('B0714QGC72', 2)).startsWith(ABO_REMOTE_BASE)).toBe(true);
  });

  it('credits Amazon.com and CodePawl with the CC BY line', () => {
    const id = aboEntries()[0]!.id;
    const credits = creditsFor({ entities: { a: { shape: { kind: 'asset', id } } } as never, environment: {} as never }, null);
    expect(credits).toHaveLength(1);
    expect(credits[0]).toMatchObject({ source: 'Amazon Berkeley Objects', licence: 'CC-BY-4.0', line: ABO_CREDIT });
    expect(attributionLines(credits)).toEqual([ABO_CREDIT]);
    expect(creditsText('Room', credits)).toContain(`Credit: ${ABO_CREDIT}`);
  });

  it('finds products by type, style, colour and the other words of the request', () => {
    const lamps = findAboModels({ text: 'floor lamp', limit: 5 });
    expect(lamps.length).toBe(5);
    for (const h of lamps) expect(h.entry.placement, h.entry.name).toBe('floor');
    const ches = findAboModels({ text: 'chesterfield sofa', limit: 3 });
    for (const h of ches) expect(h.entry.name.toLowerCase()).toContain('chesterfield');
    const coffee = findAboModels({ text: 'walnut coffee table', limit: 3 });
    for (const h of coffee) expect(h.entry.interior!.type).toBe('coffee-table');
    const tableLamp = findAboModels({ text: 'table lamp', limit: 3 });
    for (const h of tableLamp) expect(h.entry.interior!.type).toBe('lamp');
  });
});
