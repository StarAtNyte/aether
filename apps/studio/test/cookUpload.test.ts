import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hfCliOps, uploadPackage, type HubOps } from '../../../scripts/lib/cook-upload';

const ID = '0123456789abcdef';
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A local cooked package of `slug` with two packs and one program set. */
function localPackage(slug = 'w', id = ID): string {
  const root = mkdtempSync(join(tmpdir(), 'cook-upload-'));
  dirs.push(root);
  mkdirSync(join(root, slug, id, 'packs'), { recursive: true });
  mkdirSync(join(root, slug, id, 'programs'), { recursive: true });
  writeFileSync(join(root, slug, id, 'packs/0000.bin'), Buffer.alloc(16));
  writeFileSync(join(root, slug, id, 'packs/0001.bin'), Buffer.alloc(8));
  writeFileSync(join(root, slug, id, 'programs/low.json'), '{}');
  const manifest = {
    format: 2,
    irHash: 'a'.repeat(64),
    genVersion: 'gen1.p3.e2',
    dir: `${id}/`,
    cookedAt: '2026-11-06T00:00:00.000Z',
    world: { id: 'w', name: 'W', entities: 1 },
    opening: null,
    startMode: 'orbit',
    profile: 'showcase',
    partition: null,
    cells: [{ key: 'p', bounds: null, entries: 2, bytes: 24, packs: [0, 1] }],
    packs: [
      { file: 'packs/0000.bin', bytes: 16 },
      { file: 'packs/0001.bin', bytes: 8 },
    ],
    entries: { ['b'.repeat(64)]: [0, 0, 16, 0], ['c'.repeat(64)]: [1, 0, 8, 0] },
    programs: { low: { file: 'programs/low.json', bytes: 2, programs: 0 } },
    lightmap: null,
  };
  writeFileSync(join(root, slug, 'manifest.json'), JSON.stringify(manifest));
  return root;
}

/** A fake dataset: a set of paths, a manifest per slug, and the order of the calls. */
function fakeHub(opts: { files?: string[]; manifestDir?: string; dropOnUpload?: string } = {}): HubOps & { calls: string[]; files: Set<string> } {
  const files = new Set(opts.files ?? []);
  const manifests = new Map<string, string>();
  if (opts.manifestDir) manifests.set('w', opts.manifestDir);
  const calls: string[] = [];
  return {
    calls,
    files,
    async listFiles(dir) {
      calls.push(`list ${dir}`);
      return [...files].filter((f) => f.startsWith(`${dir}/`));
    },
    async readManifest(slug) {
      calls.push(`manifest? ${slug}`);
      const d = manifests.get(slug);
      return d ? { dir: d } : null;
    },
    async uploadFolder(_local, path) {
      calls.push(`folder ${path}`);
      for (const f of ['packs/0000.bin', 'packs/0001.bin', 'programs/low.json']) if (`${path}/${f}` !== opts.dropOnUpload) files.add(`${path}/${f}`);
    },
    async uploadFile(_local, path) {
      calls.push(`file ${path}`);
      if (path.endsWith('manifest.json')) manifests.set(path.split('/')[0]!, `${ID}/`);
    },
  };
}

describe('uploading a cooked package', () => {
  it('uploads the id folder, checks it is complete, then the manifest last', async () => {
    const root = localPackage();
    const hub = fakeHub();
    const r = await uploadPackage(root, 'w', hub);
    expect(r).toEqual({ slug: 'w', id: ID, files: true, manifest: true });
    expect(hub.calls).toEqual([`list w/${ID}`, `folder w/${ID}`, `list w/${ID}`, 'manifest? w', 'file w/manifest.json']);
  });

  it('skips an id already complete on the dataset, and a manifest that already names it', async () => {
    const root = localPackage();
    const hub = fakeHub({ files: [`w/${ID}/packs/0000.bin`, `w/${ID}/packs/0001.bin`, `w/${ID}/programs/low.json`], manifestDir: `${ID}/` });
    expect(await uploadPackage(root, 'w', hub)).toEqual({ slug: 'w', id: ID, files: false, manifest: false });
    expect(hub.calls.filter((c) => c.startsWith('folder') || c.startsWith('file'))).toEqual([]);
  });

  it('points the manifest at a new id without uploading files already there', async () => {
    const root = localPackage();
    const hub = fakeHub({ files: [`w/${ID}/packs/0000.bin`, `w/${ID}/packs/0001.bin`, `w/${ID}/programs/low.json`, 'w/ffffffffffffffff/packs/0000.bin'], manifestDir: 'ffffffffffffffff/' });
    expect(await uploadPackage(root, 'w', hub)).toMatchObject({ files: false, manifest: true });
    expect(hub.calls.at(-1)).toBe('file w/manifest.json');
  });

  it('completes an id folder a previous run left half uploaded', async () => {
    const root = localPackage();
    const hub = fakeHub({ files: [`w/${ID}/packs/0000.bin`] });
    expect(await uploadPackage(root, 'w', hub)).toMatchObject({ files: true, manifest: true });
    expect(hub.calls.indexOf(`folder w/${ID}`)).toBeLessThan(hub.calls.indexOf('file w/manifest.json'));
  });

  it('never uploads the manifest when a file is still missing after the upload', async () => {
    const root = localPackage();
    const hub = fakeHub({ dropOnUpload: `w/${ID}/packs/0001.bin` });
    await expect(uploadPackage(root, 'w', hub)).rejects.toThrow(/still lacks packs\/0001\.bin; the manifest was not uploaded/);
    expect(hub.calls.some((c) => c.startsWith('file'))).toBe(false);
  });

  it('refuses a local package whose files do not match its manifest, before any upload', async () => {
    const root = localPackage();
    rmSync(join(root, 'w', ID, 'packs/0001.bin'));
    const hub = fakeHub();
    await expect(uploadPackage(root, 'w', hub)).rejects.toThrow(/names packs\/0001\.bin/);
    expect(hub.calls).toEqual([]);
    const root2 = localPackage();
    writeFileSync(join(root2, 'w', ID, 'packs/0000.bin'), Buffer.alloc(3));
    await expect(uploadPackage(root2, 'w', fakeHub())).rejects.toThrow(/not the size/);
  });

  it('lists the dataset through the paged tree API and reads a missing folder as empty', async () => {
    const seen: string[] = [];
    const fetchFn = (async (u: string) => {
      seen.push(u);
      if (u.includes('/tree/main/none')) return new Response('{"error":"not found"}', { status: 404 });
      if (u.includes('cursor=2')) return Response.json([{ type: 'file', path: 'w/x/b' }]);
      if (u.includes('/tree/main/w/x')) return Response.json([{ type: 'directory', path: 'w/x/packs' }, { type: 'file', path: 'w/x/a' }], { headers: { link: '<https://huggingface.co/api/datasets/o/d/tree/main/w/x?recursive=true&cursor=2>; rel="next"' } });
      if (u.endsWith('/w/manifest.json')) return new Response(JSON.stringify({ dir: 'x/' }), { headers: { 'content-type': 'text/plain' } });
      return new Response('', { status: 404 });
    }) as typeof fetch;
    const ops = hfCliOps({ repo: 'o/d', fetch: fetchFn, log: () => undefined });
    expect(await ops.listFiles('w/x')).toEqual(['w/x/a', 'w/x/b']);
    expect(await ops.listFiles('none')).toEqual([]);
    expect(await ops.readManifest('w')).toEqual({ dir: 'x/' });
    expect(await ops.readManifest('missing')).toBeNull();
    expect(seen[0]).toBe('https://huggingface.co/api/datasets/o/d/tree/main/w/x?recursive=true&expand=false');
  });
});
