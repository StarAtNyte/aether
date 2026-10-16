/**
 * The shipped library: `assets/catalog.json` validates, every referenced
 * file exists with the content hash in its name, licences are allowed, the
 * provenance manifest covers every asset, and naming / facing / variant
 * conventions hold.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Catalog } from '../src/schema';
import { catalogSummary } from '../src/summary';
import { loadCatalog, setCatalog } from '../src/registry';

const ROOT = resolve(import.meta.dirname, '../../..');
const raw = JSON.parse(readFileSync(join(ROOT, 'assets', 'catalog.json'), 'utf8')) as unknown;
const catalog = Catalog.parse(raw);
const manifest = JSON.parse(readFileSync(join(ROOT, 'assets', 'manifest.json'), 'utf8')) as { assets: Array<{ id: string; licence: string; files: Array<{ path: string; sha256: string; bytes: number }> }>; sources: Array<{ id: string; licence: string }> };

describe('asset catalog', () => {
  it('validates and is a curated, sizeable library', () => {
    expect(catalog.entries.length).toBeGreaterThanOrEqual(150);
    expect(catalog.entries.length).toBeLessThanOrEqual(420);
    const ids = catalog.entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers every category the brief asks for', () => {
    const cats = new Set(catalog.entries.map((e) => e.category));
    for (const c of ['furniture', 'kitchen', 'bathroom', 'decor', 'plants', 'nature', 'rocks', 'building', 'street', 'vehicles', 'characters', 'animals', 'food', 'tools', 'sky', 'materials'] as const) expect(cats.has(c), c).toBe(true);
  });

  it('ships only CC0 / CC-BY third-party packs (first-party forge originals are MIT) and every pack is referenced', () => {
    for (const p of catalog.packs) expect(p.id === 'aether-forge' || p.id === 'aether-vehicles' || p.id === 'aether-creatures' ? ['MIT'] : ['CC0-1.0', 'CC-BY-4.0']).toContain(p.licence);
    const packs = new Set(catalog.packs.map((p) => p.id));
    for (const e of catalog.entries) expect(packs.has(e.pack), `${e.id} pack ${e.pack}`).toBe(true);
  });

  it('references files that exist, with their content hash in the name', () => {
    const lib = join(ROOT, 'assets', 'lib');
    let total = 0;
    for (const e of catalog.entries) {
      for (const f of [e.file, e.thumb, ...e.lods.map((l) => l.file), ...(e.material ? [e.material.maps.albedo, e.material.maps.orm, e.material.maps.normal] : [])]) {
        if (!f) continue;
        const path = join(lib, f);
        expect(existsSync(path), f).toBe(true);
        const data = readFileSync(path);
        total += data.byteLength;
        const hash = createHash('sha256').update(data).digest('hex').slice(0, 8);
        expect(f.split('.').at(-2), f).toBe(hash);
      }
    }
    // Disk budget of the library (target ≤ 150 MB).
    expect(total).toBeLessThan(150 * 1024 * 1024);
  });

  it('has a thumbnail for every model, sky, surface and forge original', () => {
    for (const e of catalog.entries) expect(e.thumb, e.id).toBeTruthy();
  });

  it('photographed surfaces map onto existing finishes with real tile sizes', async () => {
    const { FINISHES } = await import('@aether/arch');
    const mats = catalog.entries.filter((e) => e.kind === 'material');
    expect(mats.length).toBeGreaterThanOrEqual(8);
    const finishes = new Set<string>();
    for (const m of mats) {
      expect(m.pack).toBe('ambientcg');
      expect(Object.hasOwn(FINISHES, m.material!.finish), m.id).toBe(true);
      expect(m.material!.tile).toBeGreaterThan(0.1);
      finishes.add(m.material!.finish);
    }
    expect(finishes.size).toBe(mats.length);
  });

  it('forge originals are library generators that ship with the app', async () => {
    const { GENERATOR_LIBRARY } = await import('@aether/procgen');
    const lib = new Set(GENERATOR_LIBRARY.map((g) => g.id));
    const heroes = catalog.entries.filter((e) => e.kind === 'generator');
    expect(heroes.length).toBeGreaterThanOrEqual(6);
    expect(heroes.length).toBeLessThanOrEqual(8);
    for (const h of heroes) {
      expect(h.pack).toBe('aether-forge');
      expect(lib.has(h.generator!.id), h.id).toBe(true);
    }
  });

  it('records provenance (licence, source, file checksums) for every asset', () => {
    const byId = new Map(manifest.assets.map((a) => [a.id, a]));
    for (const e of catalog.entries) {
      if (e.kind === 'generator') continue;
      const m = byId.get(e.id);
      if (e.kind === 'material') {
        expect(m, e.id).toBeTruthy();
        continue;
      }
      expect(m, e.id).toBeTruthy();
      // Code-authored vehicles are MIT; the fox is a CC0 model with a CC-BY rig and animation.
      expect(e.pack === 'aether-vehicles' || e.pack === 'aether-creatures' ? ['MIT'] : ['CC0-1.0', 'CC-BY-4.0', 'CC0-1.0 AND CC-BY-4.0']).toContain(m!.licence);
      expect(m!.files.some((f) => f.path === e.file)).toBe(true);
    }
    for (const s of manifest.sources) expect(s.id === 'aether-vehicles' || s.id === 'aether-creatures' ? ['MIT'] : ['CC0-1.0', 'CC-BY-4.0']).toContain(s.licence);
  });

  it('keeps real-world sizes and the facing convention', () => {
    const get = (id: string) => catalog.entries.find((e) => e.id === id)!;
    // A sofa is about 2 m wide, a person ~1.7 m, a car ~4.5 m long, a door-height fridge.
    expect(get('sofa').size[0]).toBeGreaterThan(1.5);
    expect(get('sofa').size[0]).toBeLessThan(2.6);
    expect(get('man').size[1]).toBeGreaterThan(1.6);
    expect(get('man').size[1]).toBeLessThan(1.9);
    expect(Math.max(get('car').size[0], get('car').size[2])).toBeGreaterThan(3.8);
    expect(Math.max(get('car').size[0], get('car').size[2])).toBeLessThan(5.5);
    for (const e of catalog.entries) {
      if (e.kind !== 'model') continue;
      const mover = e.category === 'characters' || e.category === 'animals' || e.category === 'vehicles';
      expect(e.facing, e.id).toBe(mover ? '-z' : '+z');
      expect(Math.min(...e.size), e.id).toBeGreaterThan(0);
    }
  });

  it('resolves locomotion clips for animated characters and animals', () => {
    const animated = catalog.entries.filter((e) => e.anims && e.anims.clips.length > 0);
    expect(animated.length).toBeGreaterThanOrEqual(20);
    for (const e of animated.filter((x) => x.category === 'characters')) {
      expect(e.anims?.idle, e.id).toBeTruthy();
      expect(e.anims?.walk, e.id).toBeTruthy();
    }
  });

  it('variants point to existing entries of the same category', () => {
    const byId = new Map(catalog.entries.map((e) => [e.id, e]));
    for (const e of catalog.entries) for (const v of e.variants ?? []) expect(byId.get(v)?.category, `${e.id} → ${v}`).toBe(e.category);
  });

  it('LOD files are only made for dense models and are lighter', () => {
    for (const e of catalog.entries) {
      if (e.lods.length === 0) continue;
      expect(e.tris).toBeGreaterThan(3000);
      expect(e.lods[0]!.tris).toBeLessThan(e.tris);
      if (e.lods[1]) expect(e.lods[1].tris).toBeLessThan(e.lods[0]!.tris);
    }
  });

  it('summarises compactly for prompts', () => {
    const text = catalogSummary(catalog);
    expect(text.length).toBeLessThanOrEqual(1800);
    expect(text).toContain('furniture');
    expect(text).toContain('characters');
  });

  it('loads through the registry', async () => {
    setCatalog(null);
    const c = await loadCatalog();
    expect(c.entries.length).toBe(catalog.entries.length);
  });
});

describe('catalog base path', () => {
  it('accepts sub-path hosting of published games but never dot segments or other origins', () => {
    for (const base of ['/assets/lib/', '/html/12345/assets/lib/', '/my-game_v2/assets/lib/', '/']) expect(Catalog.safeParse({ ...catalog, base }).success, base).toBe(true);
    for (const base of ['assets/lib/', '/a/../lib/', '/./lib/', '//other.example/lib/', 'https://other.example/lib/', '/a b/', '/assets/lib']) expect(Catalog.safeParse({ ...catalog, base }).success, base).toBe(false);
  });
});
