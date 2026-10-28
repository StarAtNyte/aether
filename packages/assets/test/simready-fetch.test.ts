import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { IMPORT_LIMITS, checkUrl, fetchPackage, parseTarget, type StreamFetch } from '../src/simready-fetch';

const REV = '653d91e182011f357cf1644013cc94ddf194d349';
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('download targets (SSRF)', () => {
  it('allows https on huggingface.co and *.hf.co only', () => {
    expect(() => checkUrl('https://huggingface.co/datasets/a/b/resolve/x/y')).not.toThrow();
    expect(() => checkUrl('https://cdn-lfs.hf.co/repos/x')).not.toThrow();
    for (const u of ['http://huggingface.co/x', 'https://evil.example/x', 'https://huggingface.co.evil.example/x', 'https://127.0.0.1/x', 'https://169.254.169.254/latest', 'https://user:pw@huggingface.co/x', 'https://huggingface.co:8443/x', 'file:///etc/passwd', 'not a url']) {
      expect(() => checkUrl(u), u).toThrow();
    }
  });
  it('parses only pinned owner/dataset@commit/package refs', () => {
    expect(parseTarget(`nvidia/simready-assets@${REV}/chair_a01`)).toMatchObject({ repo: 'nvidia/simready-assets', pkg: 'chair_a01' });
    for (const t of ['nvidia/simready-assets@main/chair', `nvidia/simready-assets@${REV}/../x`, `a/b@${REV}/x/y`, 'https://huggingface.co/datasets/a/b', `a b/c@${REV}/x`]) expect(() => parseTarget(t), t).toThrow();
  });
});

/** A fake Hugging Face: licence files, a tree listing and the file bodies. */
function hub(files: Record<string, Uint8Array>, opts: { licence?: string; lfsFor?: string; redirectTo?: string; listedSize?: number } = {}): StreamFetch & { urls: string[] } {
  const urls: string[] = [];
  const ok = (v: unknown) => ({ ok: true, status: 200, url: '', body: null, json: async () => v });
  const fn: StreamFetch = async (u, init) => {
    urls.push(u);
    const url = new URL(u);
    if (init?.redirect !== 'follow' && url.pathname.endsWith('com.nvidia.simready.packaging.json') && url.pathname.includes('/resolve/')) return ok({ license: opts.licence ?? 'cc-by-4.0', package_hash: { sha256: 'b'.repeat(64) } });
    if (url.pathname === '/api/datasets/o/d') return ok({ author: 'o', cardData: { license: opts.licence ?? 'cc-by-4.0' } });
    if (url.pathname.startsWith('/api/datasets/o/d/tree/')) {
      return ok(
        Object.entries(files).map(([p, b]) => {
          const sha = createHash('sha256').update(b).digest('hex');
          const blob = createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
          return { type: 'file', path: `pkg/${p}`, size: opts.listedSize ?? b.length, oid: blob, ...(p === opts.lfsFor ? { lfs: { oid: sha } } : {}) };
        }),
      );
    }
    const rel = decodeURIComponent(url.pathname.split(`/${REV}/pkg/`)[1] ?? '');
    const b = files[rel];
    if (!b) return { ok: false, status: 404, url: u, body: null, json: async () => ({}) };
    return { ok: true, status: 200, url: opts.redirectTo ?? u, body: new Response(b as Uint8Array<ArrayBuffer>).body, json: async () => ({}) };
  };
  return Object.assign(fn, { urls });
}

const ref = { owner: 'o', dataset: 'd', repo: 'o/d', rev: REV, pkg: 'pkg', file: '' };
const body = (s: string): Uint8Array => new TextEncoder().encode(s);
const base = (): Record<string, Uint8Array> => ({ 'com.nvidia.simready.packaging.json': body('{}'), 'simready_usd/pkg.usd': body('usd-data') });
const out = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'aether-fetch-'));
  dirs.push(d);
  return d;
};

describe('fetchPackage', () => {
  it('downloads a pinned package, verifies hashes and reports progress', async () => {
    const lines: string[] = [];
    const dir = out();
    const got = await fetchPackage(ref, { dir, fetch: hub(base(), { lfsFor: 'simready_usd/pkg.usd' }), limits: IMPORT_LIMITS, onProgress: (m) => lines.push(m) });
    expect(got.licence).toBe('CC-BY-4.0');
    expect(got.usd.sha256).toBe(createHash('sha256').update('usd-data').digest('hex'));
    expect(existsSync(join(got.dir, 'simready_usd', 'pkg.usd'))).toBe(true);
    expect(lines.length).toBeGreaterThan(1);
  });
  it('refuses a licence that is not on the allow-list before listing anything', async () => {
    const h = hub(base(), { licence: 'cc-by-nc-4.0' });
    await expect(fetchPackage(ref, { dir: out(), fetch: h })).rejects.toThrow(/non-commercial/);
    expect(h.urls.some((u) => u.includes('/tree/'))).toBe(false);
  });
  it('refuses a package over the 150 MB cap and a file that is bigger than listed', async () => {
    await expect(fetchPackage(ref, { dir: out(), fetch: hub(base(), { listedSize: 200 * 1024 * 1024 }), limits: IMPORT_LIMITS })).rejects.toThrow(/cap/);
    await expect(fetchPackage(ref, { dir: out(), fetch: hub(base(), { listedSize: 2 }), limits: IMPORT_LIMITS })).rejects.toThrow(/more bytes than listed/);
  });
  it('refuses a corrupted download (hash mismatch) and a redirect off the allowed hosts', async () => {
    const files = base();
    const h = hub(files, { lfsFor: 'simready_usd/pkg.usd' });
    const tampered: StreamFetch = async (u, i) => {
      const r = await h(u, i);
      if (u.includes('/resolve/') && u.endsWith('pkg.usd')) return { ...r, body: new Response(body('usd-DATA')).body };
      return r;
    };
    await expect(fetchPackage(ref, { dir: out(), fetch: tampered })).rejects.toThrow(/sha256 mismatch/);
    await expect(fetchPackage(ref, { dir: out(), fetch: hub(base(), { redirectTo: 'https://evil.example/x' }) })).rejects.toThrow(/refusing/);
  });
});
