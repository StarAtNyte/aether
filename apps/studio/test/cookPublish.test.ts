import { describe, expect, it } from 'vitest';
import { createWorld, type WorldDoc } from '@aether/core';
import { BAKED_LIGHT_VERSION, DDC_CODE_VERSION, parseCookManifest, parseCookedProgramSet, worldIrHash, worldOutputKeys } from '@aether/render';
import { readProgramSetFile } from '../../../packages/render/src/cook/format';
import { CHUNK_BYTES, handleCookUpload, RateLimiter, type UploadDeps } from '../../../api/_lib/cook-upload';
import { ANON_KEY, cookAndPublish, cookInBrowser, publishBakeQuality, type CookRenderer } from '../src/publish/cook-publish';
import { loadGame, loadPublished, sharedCookRoute, sharedCookUrl } from '../src/player/source';
import { decodeWorldFile, encodeShare } from '../src/publish/share';
import { datasetFetch, fakeHub, sha, TOKEN } from './fakeCookHub';

function entity(id: string, x: number, z: number, size: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, name: id, transform: { position: [x, 0, z] }, shape: { kind: 'procedural', generator: 'test-rock', params: { size }, seed: 1 }, ...extra };
}

/** A small world: four outputs (two near the opening, one far, one a spawn template) and a scatter layer of a fifth. */
function world(): WorldDoc {
  return createWorld({
    id: 'w1',
    name: 'Test world',
    entities: {
      a: entity('a', 0, 0, 1),
      b: entity('b', 2, 1, 2),
      c: entity('c', 400, 400, 3),
      d: entity('d', 401, 400, 3),
      t: entity('t', 0, 0, 7, { template: true }),
      s: { id: 's', name: 's', transform: { position: [3, 0, 3] }, shape: { kind: 'scatter', of: { kind: 'procedural', generator: 'test-rock', params: { size: 9 }, seed: 1 }, count: 10, area: [10, 10] } },
    } as never,
  } as never);
}

/** A fake Cache Storage holding `entries` (key to bytes) as the geometry cache does (`/__ddc/<key>`); live: later sets show. */
function fakeCaches(entries: Map<string, Uint8Array>): Pick<CacheStorage, 'open'> {
  return {
    open: async () =>
      ({
        keys: async () => [...entries.keys()].map((k) => new Request(`https://studio.test/__ddc/${k}`)),
        match: async (r: Request) => {
          const b = entries.get(new URL(r.url).pathname.split('/').pop()!);
          return b ? new Response(b as Uint8Array<ArrayBuffer>) : undefined;
        },
      }) as unknown as Cache,
  };
}

const programs: CookRenderer['sessionPrograms'] = () => [{ tier: 'medium', boot: 1, pairs: [['void main(){} // v1', 'void main(){} // f1'], ['void main(){} // v1', 'void main(){} // f2']] }];
const renderer: CookRenderer = { openingPose: () => ({ position: [0, 2, 5], target: [0, 1, 0], fov: 60 }), sessionPrograms: programs };

/** The entries of `w` the editor kept: all but the spawn template and the scatter piece (never drawn, or cheap). */
async function storedEntries(w: WorldDoc, sizes: (i: number) => number = (i) => 24 + i * 8): Promise<{ cache: Map<string, Uint8Array>; all: string[]; left: string[] }> {
  const keys = await worldOutputKeys(w, DDC_CODE_VERSION);
  const all = [...keys.keys()];
  const left = all.filter((k) => keys.get(k)!.includes('t') || keys.get(k)!.includes('s'));
  const cache = new Map<string, Uint8Array>();
  all.forEach((k, i) => {
    if (!left.includes(k)) cache.set(k, new Uint8Array(sizes(i)).fill(i + 1));
  });
  // An entry of another world in the same cache is not packed.
  cache.set('f'.repeat(64), new Uint8Array(32));
  return { cache, all, left };
}

describe('cooking in the browser', () => {
  it('packs the world file, its outputs nearest the opening first, and its program sets with the load\'s own first', async () => {
    const w = world();
    const { cache, all, left } = await storedEntries(w);
    expect(all).toHaveLength(5);
    expect(left).toHaveLength(2);
    const pkg = await cookInBrowser({ world: w, renderer, startMode: 'walkthrough', signal: new AbortController().signal, onProgress: () => undefined, caches: fakeCaches(cache) });
    const parsed = parseCookManifest(JSON.parse(JSON.stringify(pkg.manifest)));
    expect(parsed.ok).toBe(true);
    const m = pkg.manifest;
    expect(m.irHash).toBe(await worldIrHash(w));
    expect(m.startMode).toBe('walkthrough');
    expect(m.profile).toBe('walkthrough');
    // Without a renderer that generates, the two outputs the editor did not keep are left out (a viewer makes them).
    expect(Object.keys(m.entries)).toHaveLength(3);
    expect(pkg.skipped).toBe(2);
    expect(m.entries['f'.repeat(64)]).toBeUndefined();
    expect(m.cells[0]!.bounds![0]).toBeLessThan(10);
    const set = parseCookedProgramSet(await readProgramSetFile(pkg.files.get('programs/medium.bin')! as Uint8Array<ArrayBuffer>), 'medium');
    expect(set?.boot).toBe(1);
    expect(set?.pairs).toHaveLength(2);
    expect([...pkg.files.keys()].sort()).toEqual([...m.packs.map((p) => p.file), 'programs/medium.bin', 'world.json.gz'].sort());
    // The world file: listed with its size and hash, and it reads back as the same world.
    const file = pkg.files.get('world.json.gz')!;
    expect(m.ir).toEqual({ file: 'world.json.gz', bytes: file.byteLength, sha256: sha(file) });
    const back = await decodeWorldFile(file);
    expect(back.ok && (await worldIrHash(back.payload.world))).toBe(m.irHash);
  });

  it('generates the outputs the editor did not keep (spawn templates, scatter pieces, cheap ones), so the package covers the world', async () => {
    const w = world();
    const { cache, all, left } = await storedEntries(w);
    const asked: string[][] = [];
    const generating: CookRenderer = {
      ...renderer,
      storeOutputsForCook: async (missing) => {
        asked.push([...missing].sort());
        // The lanes write each entry a little after the reply.
        for (const k of missing) setTimeout(() => cache.set(k, new Uint8Array(16).fill(9)), 50);
        return { generated: missing.size, failed: 0 };
      },
    };
    const pkg = await cookInBrowser({ world: w, renderer: generating, startMode: 'play', signal: new AbortController().signal, onProgress: () => undefined, caches: fakeCaches(cache) });
    expect(asked).toEqual([[...left].sort()]);
    expect(pkg.generated).toBe(2);
    expect(pkg.skipped).toBe(0);
    expect(Object.keys(pkg.manifest.entries).sort()).toEqual([...all].sort());
  });
});

describe('publishing from the editor', () => {
  /** The site's upload function over a fake hub, as the browser calls it. */
  function site(): { hub: ReturnType<typeof fakeHub>; fetch: typeof fetch; storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>; kept: Map<string, string> } {
    const hub = fakeHub();
    const d: UploadDeps = { token: TOKEN, limiter: new RateLimiter(), fetch: hub.fetch };
    const f = (async (u: string | URL | Request, i?: RequestInit) => handleCookUpload(new Request(new URL(String(u), 'https://studio.test'), i), d)) as typeof fetch;
    const kept = new Map<string, string>();
    const storage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v), removeItem: (k: string) => void kept.delete(k) };
    return { hub, fetch: f, storage, kept };
  }

  it('uploads a package with a part over the request cap in chunks, and its short link opens the world from the dataset', async () => {
    const w = world();
    // One entry of 5 MB: its pack is sent in two chunks and joined by the function.
    const { cache } = await storedEntries(w, (i) => (i === 0 ? 5_000_000 : 24 + i * 8));
    const s = site();
    const steps: number[] = [];
    const r = await cookAndPublish({ world: w, meta: { title: 'Rocks', author: 'Ana' }, renderer, startMode: 'orbit', signal: new AbortController().signal, onProgress: (p) => steps.push(p), fetch: s.fetch, storage: s.storage, caches: fakeCaches(cache) });
    const anon = (JSON.parse(s.kept.get(ANON_KEY)!) as { anon: string }).anon;
    const wid = (await worldIrHash(w)).slice(0, 16);
    expect(r.ref).toBe(`${anon}.${wid}`);
    expect(r.path).toBe(`users/${anon}/${wid}/manifest.json`);
    expect(r.bytes).toBeGreaterThan(CHUNK_BYTES);
    expect(s.hub.calls.filter((c) => c.kind === 'commit')).toHaveLength(2);
    expect(s.hub.calls.filter((c) => c.kind === 'get')).toHaveLength(2);
    const big = [...s.hub.stored.values()].find((b) => b.byteLength > CHUNK_BYTES);
    expect(big?.byteLength).toBeGreaterThanOrEqual(5_000_000);
    expect(steps.at(-1)).toBe(1);
    expect(steps.every((p, i) => i === 0 || p >= steps[i - 1]!)).toBe(true);

    // The short link: the route, then the world read from the dataset, checked, with its title screen and cooked copy.
    const route = sharedCookRoute(`#c=${r.ref}&m=orbit`);
    expect(route).toEqual({ anon, world: wid, startMode: 'orbit' });
    const base = 'https://huggingface.co/datasets/x/resolve/main/';
    const g = await loadPublished(route!, datasetFetch(s.hub, base), base);
    expect(g.kind).toBe('game');
    if (g.kind !== 'game') return;
    expect(await worldIrHash(g.game.world)).toBe(await worldIrHash(w));
    expect(g.game.title).toBe('Rocks');
    expect(g.game.author).toBe('Ana');
    expect(g.game.startMode).toBe('orbit');
    expect(g.game.cook).toBe(sharedCookUrl(anon, wid, base));

    // A tampered world file, or a missing package, is an error (there is no world to load live).
    const file = [...s.hub.files].find(([p]) => p.endsWith('/world.json.gz'))!;
    const real = s.hub.stored.get(file[1].oid!)!;
    s.hub.stored.set(file[1].oid!, real.map((b, i) => (i === 20 ? b ^ 1 : b)));
    const bad = await loadPublished(route!, datasetFetch(s.hub, base), base);
    expect(bad.kind === 'error' && bad.message).toMatch(/damaged/);
    s.hub.stored.set(file[1].oid!, real);
    const none = await loadPublished({ anon, world: '0'.repeat(16), startMode: null }, datasetFetch(s.hub, base), base);
    expect(none.kind === 'error' && none.message).toMatch(/not found/);
  });

  it("bakes a building's light at publish quality and ships it in light/, with progress, an estimate and the manifest's files", async () => {
    const lamp = { id: 'lamp', name: 'lamp', transform: { position: [0, 2, 0] }, shape: { kind: 'none' }, light: { type: 'point', intensity: 2, color: '#ffffff', range: 6 }, arch: { role: 'light', kind: 'pendant' } };
    const base = world();
    const w = createWorld({ ...base, entities: { ...base.entities, lamp } } as never);
    expect(publishBakeQuality(w)).toBe('high');
    expect(publishBakeQuality(base)).toBeNull();
    expect(publishBakeQuality(createWorld({ ...w, environment: { ...w.environment, lightBake: { quality: 'off' } } } as never))).toBeNull();
    const { cache } = await storedEntries(w);
    const asked: Array<{ quality: string; samples: number }> = [];
    const lmKey = `lm5-${'d'.repeat(32)}`;
    const lvKey = `lv3-${'e'.repeat(32)}`;
    const baking: CookRenderer = {
      ...renderer,
      publishLightBake: async (o) => {
        asked.push({ quality: o.quality, samples: o.samples });
        for (const f of [0, 0.3, 0.6, 0.96]) o.onProgress?.({ stage: 'lightmap', fraction: f, etaSeconds: f > 0 ? 90 * (1 - f) : null, label: 'Baking light on 6 of 6 workers' });
        return { lightmap: { key: lmKey, bytes: new Uint8Array(4_500_000).fill(3) }, volume: { key: lvKey, bytes: new Uint8Array(1000).fill(4) }, baker: 'page-6', ms: 1234 };
      },
    };
    const s = site();
    const steps: Array<[number, string]> = [];
    const r = await cookAndPublish({ world: w, renderer: baking, startMode: 'walkthrough', signal: new AbortController().signal, onProgress: (p, l) => steps.push([p, l]), fetch: s.fetch, storage: s.storage, caches: fakeCaches(cache) });
    expect(asked).toEqual([{ quality: 'high', samples: 256 }]);
    expect(r.light).toEqual({ lightmapBytes: 4_500_000, volumeBytes: 1000, baker: 'page-6', ms: 1234 });
    expect(steps.every(([p], i) => i === 0 || p >= steps[i - 1]![0])).toBe(true);
    expect(steps.some(([, l]) => /about 1 min left/.test(l))).toBe(true);
    const anon = (JSON.parse(s.kept.get(ANON_KEY)!) as { anon: string }).anon;
    const wid = (await worldIrHash(w)).slice(0, 16);
    const m = parseCookManifest(JSON.parse(s.hub.files.get(`users/${anon}/${wid}/manifest.json`)!.text!));
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.manifest.lightmap).toMatchObject({ base: 'light/', version: BAKED_LIGHT_VERSION });
    expect(m.manifest.lightmap!.files!.map((f) => f.file).sort()).toEqual([`light/${lmKey}.lmap`, `light/${lvKey}.lvol`, 'light/index.json'].sort());
    const dir = `users/${anon}/${wid}/${m.manifest.dir}`;
    expect(s.hub.files.get(`${dir}light/${lmKey}.lmap`)?.size).toBe(4_500_000);
    const index = [...s.hub.stored.entries()].map(([, b]) => new TextDecoder().decode(b)).find((t) => t.startsWith('{"keys"'));
    expect(JSON.parse(index!)).toEqual({ keys: [lmKey], volumes: [lvKey] });
  });

  it('opens old long links with their cooked copy, short links through the dataset, and plain links without one', async () => {
    const enc = await encodeShare(createWorld());
    const ref = `${'1'.repeat(16)}.${'2'.repeat(16)}`;
    const g = await loadGame(`#w=${enc.value}&c=${ref}&m=walkthrough`);
    expect(g.kind).toBe('game');
    if (g.kind !== 'game') return;
    expect(g.game.cook).toMatch(new RegExp(`users/${'1'.repeat(16)}/${'2'.repeat(16)}/manifest\\.json$`));
    expect(g.game.startMode).toBe('walkthrough');
    const plain = await loadGame(`#w=${enc.value}`);
    expect(plain.kind === 'game' ? plain.game.cook : 'none').toBeUndefined();
    // A short link goes to the dataset (here: nothing there).
    const asked: string[] = [];
    const short = await loadGame(`#c=${ref}&m=play`, (async (u: string | URL | Request) => {
      asked.push(String(u));
      return new Response('Entry not found', { status: 404 });
    }) as typeof fetch);
    expect(short.kind).toBe('error');
    expect(asked[0]).toMatch(new RegExp(`users/${'1'.repeat(16)}/${'2'.repeat(16)}/manifest\\.json$`));
    expect(sharedCookRoute('#c=../../x')).toBeNull();
    expect(sharedCookRoute('#w=Dxyz&c=../../x')).toBeNull();
  });
});
