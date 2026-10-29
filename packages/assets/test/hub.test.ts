import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  HUB_MAX_MAIN_BYTES, HubIndex, HubMinIndex, HubRow, hubCreditText, hubFileUrl, hubItems, hubLicenceAllowed, hubModelPath, hubSourceLabel, readHubEmbeddings, searchHubItems, similarHubIds, toMinIndex, verifyHubBytes, type HubItem,
} from '../src/hub';
import { HubClient, type HubCache } from '../src/hub-client';
import { importUserAsset } from '../src/user';

const sha = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');

function row(id: string, name: string, o: Partial<HubRow> & { aliases?: string[]; tags?: string[]; bytes?: number; glb?: Uint8Array } = {}): HubRow {
  const glb = o.glb ?? new Uint8Array([0x67, 0x6c, 0x54, 0x46, ...Array.from(id, (c) => c.charCodeAt(0))]);
  const f = (path: string, bytes: Uint8Array) => ({ path, bytes: bytes.byteLength, sha256: sha(bytes) });
  const licence = o.licence ?? 'CC0-1.0';
  const author = o.author ?? 'Poly Haven';
  const source = o.source ?? { name: 'Poly Haven', url: 'https://polyhaven.com', path: id };
  return HubRow.parse({
    id, name, aliases: o.aliases ?? [], tags: o.tags ?? [name.toLowerCase()], category: o.category ?? 'furniture', style: o.style ?? 'realistic',
    size: [1, 1, 1], triangles: 1000, bytes: o.bytes ?? glb.byteLength, licence, licenceUrl: licence === 'CC0-1.0' ? 'https://creativecommons.org/publicdomain/zero/1.0/' : 'https://creativecommons.org/licenses/by/4.0/',
    author, credit: hubCreditText({ name, author, licence, source: hubSourceLabel(source.name), modified: true }), source, converted: 'Re-exported by Aether.', modified: true,
    placement: 'floor', facing: '+z', collider: { type: 'box' }, files: { main: f(hubModelPath(id), glb), thumb: f(`models/${id}/thumb.webp`, new Uint8Array([1, 2, 3])) },
  });
}

const ROWS = [
  row('office-chair', 'Office chair', { aliases: ['swivel'], tags: ['chair', 'seat', 'office', 'desk'] }),
  row('armchair-green', 'Green armchair', { tags: ['armchair', 'chair', 'seat'], style: 'stylized' }),
  row('simready-range-cooker-lg', 'Range cooker', { aliases: ['stove', 'hob'], tags: ['cooker', 'oven', 'kitchen'], category: 'kitchen', licence: 'CC-BY-4.0', author: 'LG Electronics', source: { name: 'NVIDIA SimReady Central, Hugging Face dataset LGElectronics/simready-assets', url: 'https://huggingface.co/datasets/LGElectronics/simready-assets', dataset: 'LGElectronics/simready-assets', revision: 'a'.repeat(40), path: 'cooking_x/x.usd' } }),
  row('big-table', 'Banquet table', { tags: ['table', 'dining'], bytes: 900_000, glb: new Uint8Array(900_000).fill(7) }),
];
const INDEX = HubIndex.parse({ version: 1, dataset: 'StarAtNyte1/aether-assets', generated: '2026-10-28', count: ROWS.length, rows: ROWS });
const MIN = toMinIndex(INDEX);
const items = (): HubItem[] => hubItems(MIN);

describe('hub index schema', () => {
  it('round-trips the compact index and keeps the credit identical', () => {
    expect(HubMinIndex.parse(JSON.parse(JSON.stringify(MIN)))).toEqual(MIN);
    for (const [i, it] of items().entries()) expect(it.credit).toBe(ROWS[i]!.credit);
    expect(items()[2]!.credit).toMatch(/CC BY 4\.0, modified/);
    expect(items()[2]!.credit.length).toBeLessThanOrEqual(200);
  });
  it('is only for CC0 and CC BY, within the size cap', () => {
    for (const bad of ['CC-BY-NC-4.0', 'CC-BY-ND-4.0', 'CC-BY-SA-4.0', 'MIT', '', 'unknown']) {
      expect(hubLicenceAllowed(bad), bad).toBe(false);
      expect(HubRow.safeParse({ ...ROWS[0], licence: bad }).success, bad).toBe(false);
    }
    expect(hubLicenceAllowed('CC0-1.0') && hubLicenceAllowed('CC-BY-4.0')).toBe(true);
    expect(HubRow.safeParse({ ...ROWS[0], bytes: HUB_MAX_MAIN_BYTES + 1 }).success).toBe(false);
    expect(HubRow.safeParse({ ...ROWS[0], files: { ...ROWS[0]!.files, main: { ...ROWS[0]!.files.main, path: '../x.glb' } } }).success).toBe(false);
  });
  it('builds pinned resolve URLs', () => {
    expect(hubFileUrl({ dataset: 'a/b', revision: 'main' }, 'models/x y/x.glb')).toBe('https://huggingface.co/datasets/a/b/resolve/main/models/x%20y/x.glb');
    expect(hubFileUrl({ dataset: 'a/b', revision: 'main' }, 'index.min.json', '/__hub')).toBe('/__hub/datasets/a/b/resolve/main/index.min.json');
  });
});

describe('hub search', () => {
  const ids = (q: string, o = {}): string[] => searchHubItems(items(), q, o).map((h) => h.item.id);
  it('ranks by name, tag and alias', () => {
    expect(ids('office chair')[0]).toBe('office-chair');
    expect(ids('chair')).toContain('armchair-green');
    expect(ids('stove')).toEqual(['simready-range-cooker-lg']);
    expect(ids('cooker')[0]).toBe('simready-range-cooker-lg');
    expect(ids('swivel')).toEqual(['office-chair']);
  });
  it('tolerates typos and plurals', () => {
    expect(ids('armchiar')).toContain('armchair-green');
    expect(ids('banqet tables')).toEqual(['big-table']);
    expect(ids('banquet tables')).toEqual(['big-table']);
    expect(ids('offcie chair')[0]).toBe('office-chair');
  });
  it('filters by style and size and requires every word', () => {
    expect(ids('chair', { style: 'stylized' })).toEqual(['armchair-green']);
    expect(ids('banquet', { maxBytes: 100_000 })).toEqual([]);
    expect(ids('office zebra')).toEqual([]);
    expect(searchHubItems(items(), 'chair', { limit: 1 })).toHaveLength(1);
  });
});

describe('hub hashes', () => {
  it('verifies bytes against a SHA-256', async () => {
    const b = new Uint8Array([1, 2, 3]);
    expect(await verifyHubBytes(b, sha(b))).toBe(true);
    expect(await verifyHubBytes(new Uint8Array([1, 2, 4]), sha(b))).toBe(false);
    expect(await verifyHubBytes(b, 'nope')).toBe(false);
  });
  it('reads embeddings only when the header and hash agree, and ranks similar assets', async () => {
    const dim = 8;
    const bin = new Int8Array([127, 0, 0, 0, 0, 0, 0, 0, 120, 30, 0, 0, 0, 0, 0, 0, 0, 0, 127, 0, 0, 0, 0, 0]);
    const raw = new Uint8Array(bin.buffer);
    const header = { version: 1, model: 'clip', dim, count: 3, ids: ['a', 'b', 'c'], sha256: sha(raw) };
    const emb = await readHubEmbeddings(header, raw);
    expect(emb).not.toBeNull();
    expect(similarHubIds(emb!, 'a', 2).map((x) => x.id)).toEqual(['b', 'c']);
    expect(await readHubEmbeddings({ ...header, sha256: sha('x') }, raw)).toBeNull();
    expect(await readHubEmbeddings({ ...header, count: 4 }, raw)).toBeNull();
  });
});

/** A map-backed Cache API. */
function memoryCache(): HubCache & { map: Map<string, Response> } {
  const map = new Map<string, Response>();
  return { map, match: async (u) => map.get(u)?.clone(), put: async (u, r) => void map.set(u, r.clone()) };
}
const PINNED = { dataset: 'StarAtNyte1/aether-assets', revision: 'b'.repeat(40), visibility: 'public' as const };

function server(files: Record<string, Uint8Array | string>, calls: string[] = []): typeof fetch {
  return (async (url: string) => {
    calls.push(url);
    const path = url.split('/resolve/')[1]!.split('/').slice(1).join('/');
    const body = files[decodeURIComponent(path)];
    if (body === undefined) return new Response('no', { status: 404 });
    return new Response(body as BodyInit, { status: 200, headers: { etag: '"e1"', 'content-length': String(typeof body === 'string' ? new TextEncoder().encode(body).byteLength : body.byteLength) } });
  }) as unknown as typeof fetch;
}

describe('HubClient', () => {
  const files = (): Record<string, Uint8Array | string> => ({
    'index.min.json': JSON.stringify(MIN),
    [hubModelPath('office-chair')]: new Uint8Array([0x67, 0x6c, 0x54, 0x46, ...Array.from('office-chair', (c) => c.charCodeAt(0))]),
  });

  it('loads the index lazily, searches it and caches the pinned answer', async () => {
    const calls: string[] = [];
    const cache = memoryCache();
    const hub = new HubClient({ config: PINNED, fetch: server(files(), calls), cache });
    expect(calls).toHaveLength(0);
    const r = await hub.search('office chair');
    expect(r.ok && r.hits[0]!.item.id).toBe('office-chair');
    expect(r.ok && r.hits[0]!.thumbUrl).toBe(`https://huggingface.co/datasets/StarAtNyte1/aether-assets/resolve/${'b'.repeat(40)}/models/office-chair/thumb.webp`);
    expect(hub.getState()).toMatchObject({ status: 'ready', count: 4 });
    // A second client (a reload) reads the cache: no request at all.
    const again = new HubClient({ config: PINNED, fetch: server({}, calls), cache });
    calls.length = 0;
    expect((await again.search('cooker')).ok).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('downloads a model and checks its hash; a tampered file is refused', async () => {
    const ok = new HubClient({ config: PINNED, fetch: server(files()), cache: memoryCache() });
    const got = await ok.fetchModel('office-chair');
    expect(got.ok && got.bytes.byteLength).toBe(ROWS[0]!.bytes);
    expect(got.ok && got.revision).toBe(PINNED.revision);
    const tampered = files();
    const evil = new Uint8Array(tampered[hubModelPath('office-chair')] as Uint8Array);
    evil[5] = 0;
    tampered[hubModelPath('office-chair')] = evil;
    const bad = await new HubClient({ config: PINNED, fetch: server(tampered), cache: memoryCache() }).fetchModel('office-chair');
    expect(bad).toMatchObject({ ok: false });
    expect(!bad.ok && bad.reason).toMatch(/hash/);
    const missing = await ok.fetchModel('nope');
    expect(missing.ok).toBe(false);
  });

  it('refuses an index that does not match the pinned hash or the dataset', async () => {
    const pinnedBad = new HubClient({ config: { ...PINNED, indexSha256: sha('other') }, fetch: server(files()) });
    expect((await pinnedBad.search('chair')).ok).toBe(false);
    const wrong = new HubClient({ config: PINNED, fetch: server({ 'index.min.json': JSON.stringify({ ...MIN, dataset: 'someone/else' }) }) });
    expect((await wrong.search('chair')).ok).toBe(false);
    const junk = new HubClient({ config: PINNED, fetch: server({ 'index.min.json': 'not json' }) });
    expect((await junk.search('chair')).ok).toBe(false);
  });

  it('is unavailable, never an error, when offline', async () => {
    const down = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const hub = new HubClient({ config: PINNED, fetch: down });
    const r = await hub.search('chair');
    expect(r).toMatchObject({ ok: false });
    expect(hub.getState().status).toBe('unavailable');
    expect((await hub.fetchModel('office-chair')).ok).toBe(false);
    expect(await hub.similar('office-chair')).toEqual([]);
  });

  it('does not touch the network while the dataset is private', async () => {
    const f = vi.fn(server(files()));
    const hub = new HubClient({ config: { ...PINNED, visibility: 'private' }, fetch: f as unknown as typeof fetch });
    const r = await hub.search('chair');
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/not public/) });
    expect(f).not.toHaveBeenCalled();
    // The dev proxy adds the credential on the server side: then it is used.
    const dev = new HubClient({ config: { ...PINNED, visibility: 'private' }, base: '/__hub', privateOk: true, fetch: f as unknown as typeof fetch });
    expect((await dev.search('chair')).ok).toBe(true);
    expect(f.mock.calls[0]![0]).toMatch(/^\/__hub\/datasets\//);
  });

  it('revalidates an unpinned main with its ETag', async () => {
    const cache = memoryCache();
    const seen: Array<string | undefined> = [];
    const f = (async (url: string, init?: { headers?: Record<string, string> }) => {
      seen.push(init?.headers?.['If-None-Match']);
      if (init?.headers?.['If-None-Match'] === '"e1"') return new Response(null, { status: 304 });
      return new Response(JSON.stringify(MIN), { status: 200, headers: { etag: '"e1"' } });
    }) as unknown as typeof fetch;
    const cfg = { ...PINNED, revision: 'main' as const };
    await new HubClient({ config: cfg, fetch: f, cache }).search('chair');
    const r = await new HubClient({ config: cfg, fetch: f, cache }).search('chair');
    expect(r.ok).toBe(true);
    expect(seen).toEqual([undefined, '"e1"']);
  });
});

describe('meshopt hub models pass the GLB validator', () => {
  const lib = (file: string): Uint8Array => new Uint8Array(readFileSync(new URL(`../../../assets/lib/${file}`, import.meta.url)));
  /** Rewrite the JSON chunk of a GLB. */
  function edit(glb: Uint8Array, fn: (j: any) => void): Uint8Array {
    const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
    const jl = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jl)));
    fn(json);
    let text = new TextEncoder().encode(JSON.stringify(json));
    const pad = (4 - (text.byteLength % 4)) % 4;
    text = new Uint8Array([...text, ...new Array(pad).fill(0x20)]);
    const rest = glb.subarray(20 + jl);
    const out = new Uint8Array(20 + text.byteLength + rest.byteLength);
    out.set(glb.subarray(0, 12));
    new DataView(out.buffer).setUint32(8, out.byteLength, true);
    new DataView(out.buffer).setUint32(12, text.byteLength, true);
    out.set(glb.subarray(16, 20), 16);
    out.set(text, 20);
    out.set(rest, 20 + text.byteLength);
    return out;
  }
  it('accepts a library model with the empty fallback buffer, and refuses a forged one', async () => {
    const glb = lib('i/armchair-green.b273d491.glb');
    const ok = await importUserAsset(glb, 'armchair.glb');
    expect(ok).toMatchObject({ ok: true });
    // A second buffer that is not the meshopt fallback is still refused.
    const bad1 = await importUserAsset(edit(glb, (j) => void delete j.buffers[1].extensions), 'x.glb');
    expect(bad1).toMatchObject({ ok: false });
    // A view on the fallback buffer must name a real compressed range.
    const bad2 = await importUserAsset(edit(glb, (j) => { for (const v of j.bufferViews) if (v.buffer === 1) { v.extensions.EXT_meshopt_compression.byteLength = 1e9; break; } }), 'x.glb');
    expect(bad2).toMatchObject({ ok: false });
    const bad3 = await importUserAsset(edit(glb, (j) => { for (const v of j.bufferViews) if (v.buffer === 1) { delete v.extensions; break; } }), 'x.glb');
    expect(bad3).toMatchObject({ ok: false });
  });
});

describe('hub mount height', () => {
  const WALL = row('wall-sink', 'Wall sink', { tags: ['sink'] });
  const MOUNTED = toMinIndex(HubIndex.parse({ version: 1, dataset: 'StarAtNyte1/aether-assets', generated: '2026-10-28', count: 2, rows: [{ ...WALL, placement: 'wall', mountY: 0.85 }, ROWS[0]] }));
  it('keeps a 15-column index (the pinned public one) readable and byte-identical', () => {
    expect(MIN.columns).toHaveLength(15);
    expect(MIN.rows.every((r) => r.length === 15)).toBe(true);
    expect(items().every((i) => i.mountY === undefined)).toBe(true);
  });
  it('adds a 16th column only when a row has a mount height, and reads both row shapes', () => {
    expect(MOUNTED.columns.at(-1)).toBe('mountY');
    const parsed = HubMinIndex.parse(JSON.parse(JSON.stringify(MOUNTED)));
    const got = hubItems(parsed);
    expect(got.find((i) => i.id === 'wall-sink')!.mountY).toBe(0.85);
    expect(got.find((i) => i.id === ROWS[0]!.id)!.mountY).toBeUndefined();
  });
  it('can leave the column out for an index that predates it', () => {
    const old = toMinIndex(HubIndex.parse({ version: 1, dataset: 'StarAtNyte1/aether-assets', generated: '2026-10-28', count: 1, rows: [{ ...WALL, placement: 'wall', mountY: 0.85 }] }), { mountY: false });
    expect(old.columns).toHaveLength(15);
    expect(old.rows[0]).toHaveLength(15);
  });
  it('refuses a mount height outside 0..4 m', () => {
    expect(HubRow.safeParse({ ...WALL, mountY: 5 }).success).toBe(false);
    expect(HubMinIndex.safeParse({ ...MOUNTED, rows: [[...MOUNTED.rows[0]!.slice(0, 15), 9]] }).success).toBe(false);
  });
});
