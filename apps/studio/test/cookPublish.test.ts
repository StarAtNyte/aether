import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { WorldDoc } from '@aether/core';
import { DDC_CODE_VERSION, parseCookManifest, parseCookedProgramSet, worldIrHash, worldOutputKeys } from '@aether/render';
import { readProgramSetFile } from '../../../packages/render/src/cook/format';
import { handleCookUpload, RateLimiter, type UploadDeps } from '../../../api/_lib/cook-upload';
import { ANON_KEY, cookAndPublish, cookInBrowser, type CookRenderer } from '../src/publish/cook-publish';
import { loadGame, sharedCookRoute, sharedCookUrl } from '../src/player/source';

function entity(id: string, x: number, z: number, size: number): Record<string, unknown> {
  return { id, name: id, transform: { position: [x, 0, z], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, shape: { kind: 'procedural', generator: 'test-rock', params: { size }, seed: 1 }, material: 'stone', physics: null, tags: [] };
}

/** A small world: three outputs (two near the opening, one far). */
function world(): WorldDoc {
  return { id: 'w1', name: 'Test world', entities: { a: entity('a', 0, 0, 1), b: entity('b', 2, 1, 2), c: entity('c', 400, 400, 3), d: entity('d', 401, 400, 3) }, generators: {} } as unknown as WorldDoc;
}

/** A fake Cache Storage holding `entries` (key to bytes) as the geometry cache does (`/__ddc/<key>`). */
function fakeCaches(entries: Map<string, Uint8Array>): Pick<CacheStorage, 'open'> {
  const reqs = [...entries.keys()].map((k) => new Request(`https://studio.test/__ddc/${k}`));
  return {
    open: async () =>
      ({
        keys: async () => reqs,
        match: async (r: Request) => {
          const b = entries.get(new URL(r.url).pathname.split('/').pop()!);
          return b ? new Response(b as Uint8Array<ArrayBuffer>) : undefined;
        },
      }) as unknown as Cache,
  };
}

const renderer: CookRenderer = {
  openingPose: () => ({ position: [0, 2, 5], target: [0, 1, 0], fov: 60 }),
  sessionPrograms: () => [{ tier: 'medium', boot: 1, pairs: [['void main(){} // v1', 'void main(){} // f1'], ['void main(){} // v1', 'void main(){} // f2']] }],
};

async function storedEntries(w: WorldDoc): Promise<Map<string, Uint8Array>> {
  const keys = [...(await worldOutputKeys(w, DDC_CODE_VERSION)).keys()];
  const m = new Map<string, Uint8Array>();
  keys.forEach((k, i) => m.set(k, new Uint8Array(24 + i * 8).fill(i + 1)));
  // An entry of another world in the same cache is not packed.
  m.set('f'.repeat(64), new Uint8Array(32));
  return m;
}

describe('cooking in the browser', () => {
  it("packs the world's stored outputs nearest the opening first, and its program sets with the load's own first", async () => {
    const w = world();
    const pkg = await cookInBrowser({ world: w, renderer, startMode: 'walkthrough', signal: new AbortController().signal, onProgress: () => undefined, caches: fakeCaches(await storedEntries(w)) });
    const parsed = parseCookManifest(JSON.parse(JSON.stringify(pkg.manifest)));
    expect(parsed.ok).toBe(true);
    const m = pkg.manifest;
    expect(m.irHash).toBe(await worldIrHash(w));
    expect(m.startMode).toBe('walkthrough');
    expect(m.profile).toBe('walkthrough');
    expect(Object.keys(m.entries)).toHaveLength(3);
    expect(m.entries['f'.repeat(64)]).toBeUndefined();
    // The cell of a and b (at the opening) comes before the far one.
    expect(m.cells.length).toBe(2);
    expect(m.cells[0]!.bounds![0]).toBeLessThan(10);
    const set = parseCookedProgramSet(await readProgramSetFile(pkg.files.get('programs/medium.bin')! as Uint8Array<ArrayBuffer>), 'medium');
    expect(set?.boot).toBe(1);
    expect(set?.pairs).toHaveLength(2);
    expect([...pkg.files.keys()].sort()).toEqual([...m.packs.map((p) => p.file), 'programs/medium.bin'].sort());
  });

  it('cooks, uploads through the function and gives the link its cooked copy', async () => {
    const w = world();
    const stored = new Set<string>();
    const commits: string[] = [];
    const hub = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/objects/batch')) {
        const objs = (JSON.parse(String(init!.body)) as { objects: Array<{ oid: string; size: number }> }).objects;
        return new Response(JSON.stringify({ objects: objs.map((o) => (stored.has(o.oid) ? o : { ...o, actions: { upload: { href: `https://storage.test/${o.oid}` } } })) }));
      }
      if (url.startsWith('https://storage.test/')) {
        stored.add(createHash('sha256').update(init!.body as Uint8Array).digest('hex'));
        return new Response('');
      }
      if (url.endsWith('/commit/main')) {
        commits.push(String(init!.body));
        return new Response('{}');
      }
      return new Response('', { status: 404 });
    }) as typeof fetch;
    const d: UploadDeps = { token: 'hf_test', limiter: new RateLimiter(), fetch: hub };
    const site = (async (u: string | URL | Request, i?: RequestInit) => handleCookUpload(new Request(new URL(String(u), 'https://studio.test'), i), d)) as typeof fetch;
    const kept = new Map<string, string>();
    const storage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v), removeItem: (k: string) => void kept.delete(k) };
    const steps: number[] = [];
    const r = await cookAndPublish({ world: w, renderer, startMode: 'orbit', signal: new AbortController().signal, onProgress: (p) => steps.push(p), fetch: site, storage, caches: fakeCaches(await storedEntries(w)) });
    const anon = (JSON.parse(kept.get(ANON_KEY)!) as { anon: string }).anon;
    const wid = (await worldIrHash(w)).slice(0, 16);
    expect(r.ref).toBe(`${anon}.${wid}`);
    expect(r.path).toBe(`users/${anon}/${wid}/manifest.json`);
    expect(commits).toHaveLength(2);
    expect(commits[1]).toContain('manifest.json');
    expect(steps.at(-1)).toBe(1);
    expect(steps.every((p, i) => i === 0 || p >= steps[i - 1]!)).toBe(true);

    // The player reads the link's cooked copy and start mode.
    expect(sharedCookRoute(`#w=Dxyz&c=${r.ref}&m=orbit`)).toEqual({ anon, world: wid, startMode: 'orbit' });
    expect(sharedCookRoute('#w=Dxyz&c=../../x')).toBeNull();
    expect(sharedCookUrl(anon, wid, 'https://huggingface.co/datasets/x/resolve/main/')).toBe(`https://huggingface.co/datasets/x/resolve/main/users/${anon}/${wid}/manifest.json`);
  });

  it('opens a shared link with its cooked copy and start mode', async () => {
    const { encodeShare } = await import('../src/publish/share');
    const { createWorld } = await import('@aether/core');
    const enc = await encodeShare(createWorld());
    const ref = `${'1'.repeat(16)}.${'2'.repeat(16)}`;
    const g = await loadGame(`#w=${enc.value}&c=${ref}&m=walkthrough`);
    expect(g.kind).toBe('game');
    if (g.kind !== 'game') return;
    expect(g.game.cook).toMatch(new RegExp(`users/${'1'.repeat(16)}/${'2'.repeat(16)}/manifest\\.json$`));
    expect(g.game.startMode).toBe('walkthrough');
    const plain = await loadGame(`#w=${enc.value}`);
    expect(plain.kind === 'game' ? plain.game.cook : 'none').toBeUndefined();
  });
});
