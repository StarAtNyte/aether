import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createWorld } from '@aether/core';
import { creditsFor, creditsText } from '../src/credits';
import { findModels } from '../src/interior';
import { Catalog } from '../src/schema';
import { setCatalog } from '../src/registry';
import { describeSimreadyHit, judgeLicence, parseSimreadyUrl, searchSimready, type FetchLike } from '../src/simready';

const REV = '70ea043e1a85455227e516766443d1fa235a5ea0';
const url = (repo: string, pkg: string): string => `https://huggingface.co/datasets/${repo}/blob/${REV}/${pkg}/simready_usd/${pkg}.usd`;

describe('judgeLicence', () => {
  it('accepts every spelling of CC-BY 4.0 and the other allowed licences', () => {
    for (const s of ['CC-BY 4.0', 'cc-by-4.0', 'CC-BY-4.0', 'cc0-1.0', 'CC0', 'MIT', 'Apache-2.0', 'BSD-3-Clause', 'BSD-2-Clause']) expect(judgeLicence(s).allowed, s).toBe(true);
    expect(judgeLicence('CC-BY 4.0').licence).toBe('CC-BY-4.0');
  });
  it('rejects the rest with a reason', () => {
    expect(judgeLicence('cc-by-nc-4.0').reason).toMatch(/non-commercial/);
    expect(judgeLicence('CC-BY-ND-4.0').reason).toMatch(/no-derivatives/);
    expect(judgeLicence('CC-BY-SA-4.0').reason).toMatch(/share-alike/);
    expect(judgeLicence('LicenseRef-UR-Graphical-Documentation AND BSD-3-Clause').reason).toMatch(/custom licence/);
    expect(judgeLicence(null).reason).toMatch(/no licence/);
    expect(judgeLicence('none').allowed).toBe(false);
    expect(judgeLicence('GPL-3.0').allowed).toBe(false);
    expect(judgeLicence('proprietary').allowed).toBe(false);
  });
});

describe('parseSimreadyUrl', () => {
  it('parses a pinned file URL and refuses everything else', () => {
    const r = parseSimreadyUrl(url('LGElectronics/simready-assets', 'cooking_ldgl6924s'));
    expect(r).toMatchObject({ repo: 'LGElectronics/simready-assets', rev: REV, pkg: 'cooking_ldgl6924s', file: 'simready_usd/cooking_ldgl6924s.usd' });
    expect(parseSimreadyUrl('https://huggingface.co/datasets/a/b/blob/main/p/x.usd')).toBeNull();
    expect(parseSimreadyUrl('https://evil.example/datasets/a/b/blob/' + REV + '/p/x.usd')).toBeNull();
    expect(parseSimreadyUrl(`https://huggingface.co/datasets/a/b/blob/${REV}/p/../x.usd`)).toBeNull();
    expect(parseSimreadyUrl(`https://huggingface.co/datasets/a/b/blob/${REV}/p/x.exe`)).toBeNull();
  });
});

function fakeFetch(licences: Record<string, string | null>, card = 'cc-by-4.0'): FetchLike {
  return async (u, init) => {
    const ok = (v: unknown) => ({ ok: true, status: 200, json: async () => v });
    if (u.endsWith('/search')) {
      expect(JSON.parse(init!.body!)).toMatchObject({ return_metadata: true, max_bbox_z: 2 });
      return ok(Object.keys(licences).map((p, i) => ({ url: url('Owner/set', p), score: 1 - i / 10, metadata: { size: 1000 } })));
    }
    if (u.includes('/api/datasets/')) return ok({ author: 'Owner', cardData: { license: card } });
    const pkg = /\/([^/]+)\/com\.nvidia/.exec(u)![1]!;
    const lic = licences[pkg];
    return lic === undefined ? { ok: false, status: 404, json: async () => ({}) } : ok({ license: lic, package_hash: { sha256: 'a'.repeat(64) } });
  };
}

describe('searchSimready', () => {
  it('keeps only allowed hits and explains the rest', async () => {
    const r = await searchSimready({ query: 'range cooker', maxSize: 2, fetch: fakeFetch({ good: 'cc-by-4.0', nc: 'cc-by-nc-4.0', none: 'none', apache: 'Apache-2.0' }) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.accepted.map((h) => h.ref.pkg)).toEqual(['good', 'apache']);
    expect(r.accepted[0]!.fetch).toBe(`npm run assets:simready -- fetch Owner/set@${REV}/good`);
    expect(r.accepted[1]!.importable).toBe(false);
    expect(r.rejected.map((h) => h.ref.pkg)).toEqual(['nc', 'none']);
    expect(r.rejected[0]!.reason).toMatch(/non-commercial/);
    expect(describeSimreadyHit(r.accepted[0]!)).toContain('CC-BY-4.0');
  });
  it('rejects a package the dataset card contradicts, and a package with no licence at all', async () => {
    const r = await searchSimready({ query: 'x', maxSize: 2, fetch: fakeFetch({ a: 'cc-by-4.0' }, 'cc-by-nc-4.0') });
    expect(r.ok && r.accepted.length).toBe(0);
    const r2 = await searchSimready({ query: 'x', maxSize: 2, fetch: fakeFetch({ gone: undefined as unknown as string }, 'unknown') });
    expect(r2.ok && r2.accepted.length).toBe(0);
  });
  it('fails gracefully when the service is down', async () => {
    const r = await searchSimready({ query: 'x', fetch: async () => { throw new Error('offline'); } });
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toMatch(/not reachable/);
  });
});

// The one imported package: the shipped catalog, manifest, sources and credits agree and stay licence-clean.

const ROOT = resolve(import.meta.dirname, '../../..');
const catalog = Catalog.parse(JSON.parse(readFileSync(join(ROOT, 'assets', 'catalog.json'), 'utf8')));
const ID = 'simready-range-cooker-lg';

describe('the imported SimReady range cooker', () => {
  const entry = catalog.entries.find((e) => e.id === ID)!;

  it('is in the catalog with real metres, a budgeted mesh, a light copy and a +Z front', () => {
    expect(entry.category).toBe('kitchen');
    expect(entry.tris).toBeLessThanOrEqual(20_000);
    expect(entry.size[1]).toBeGreaterThan(1.1);
    expect(entry.size[1]).toBeLessThan(1.3);
    expect(entry.facing).toBe('+z');
    expect(entry.lite && entry.file && entry.thumb).toBeTruthy();
    expect(entry.file).toMatch(/^s\//);
    expect(statSizeOk(entry.file!)).toBe(true);
    expect(catalog.packs.find((p) => p.id === entry.pack)).toMatchObject({ licence: 'CC-BY-4.0', author: 'LG Electronics', licenceUrl: 'https://creativecommons.org/licenses/by/4.0/' });
  });

  it('the shipped files match the manifest hashes', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'assets', 'manifest.json'), 'utf8')) as { assets: Array<{ id: string; licence: string; files: Array<{ path: string; sha256: string }> }> };
    const a = manifest.assets.find((x) => x.id === ID)!;
    expect(a.licence).toBe('CC-BY-4.0');
    for (const f of a.files) expect(createHash('sha256').update(readFileSync(join(ROOT, 'assets', 'lib', f.path))).digest('hex')).toBe(f.sha256);
  });

  it('sources.json pins the USD and every entry is CC0-1.0 or CC-BY-4.0', () => {
    const src = JSON.parse(readFileSync(join(ROOT, 'assets', 'sources.json'), 'utf8')) as { simready: { packages: Array<Record<string, string | number>> } };
    for (const p of src.simready.packages) {
      expect(['CC0-1.0', 'CC-BY-4.0']).toContain(p['licence']);
      expect(p['revision']).toMatch(/^[0-9a-f]{40}$/);
      expect(p['sha256']).toMatch(/^[0-9a-f]{64}$/);
      expect(String(p['licenceEvidence'])).toMatch(/license/);
    }
    expect(src.simready.packages.map((p) => p['package'])).toEqual(['cooking_ldgl6924s']);
  });

  it('find_model resolves range cooker, stove and cooktop', () => {
    for (const w of ['range cooker', 'stove', 'cooktop', 'oven range']) expect(findModels(catalog, { text: w, limit: 6 }).map((h) => h.entry.id), w).toContain(ID);
  });

  it('a world that uses it credits LG Electronics under CC BY 4.0', () => {
    setCatalog(catalog);
    const world = createWorld({ name: 'Kitchen', entities: { a: { id: 'a', shape: { kind: 'asset', id: ID } } } });
    const credits = creditsFor(world);
    expect(credits).toHaveLength(1);
    expect(credits[0]).toMatchObject({ author: 'LG Electronics', licence: 'CC-BY-4.0', assets: ['Range cooker'] });
    expect(credits[0]!.source).toContain('LGElectronics/simready-assets');
    expect(creditsText('Kitchen', credits)).toContain('Licence: CC-BY-4.0 (https://creativecommons.org/licenses/by/4.0/)');
    setCatalog(null);
  });
});

function statSizeOk(file: string): boolean {
  const p = join(ROOT, 'assets', 'lib', file);
  return existsSync(p) && readFileSync(p).byteLength < 700 * 1024;
}
