import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { anonKey, checkCommit, handleCookUpload, LIMITS, MAX_FILE_BYTES, MAX_PACKAGE_BYTES, RateLimiter, type UploadDeps } from '../../../api/_lib/cook-upload';

const TOKEN = 'hf_SECRETtokenVALUE0123456789';
const HEX = (c: string, n = 64): string => c.repeat(n);
const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

interface Call {
  kind: 'batch' | 'put' | 'verify' | 'commit';
  body: string;
}

/** A fake Hugging Face Hub: LFS batch, storage PUT, verify, commit. `echo` puts the token into every answer it can. */
function fakeHub(opts: { echo?: boolean; failCommit?: boolean } = {}): { fetch: typeof fetch; calls: Call[]; stored: Set<string> } {
  const calls: Call[] = [];
  const stored = new Set<string>();
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? init.body : init?.body ? `<${(init.body as Uint8Array).byteLength} bytes>` : '';
    if (url.endsWith('/info/lfs/objects/batch')) {
      calls.push({ kind: 'batch', body });
      const req = JSON.parse(body) as { objects: Array<{ oid: string; size: number }> };
      return new Response(
        JSON.stringify({
          transfer: 'basic',
          objects: req.objects.map((o) => (stored.has(o.oid) ? o : { ...o, actions: { upload: { href: `https://storage.test/${o.oid}` }, verify: { href: 'https://huggingface.co/verify', header: { Authorization: `Bearer ${TOKEN}` } } } })),
        }),
        { status: 200 },
      );
    }
    if (url.startsWith('https://storage.test/')) {
      calls.push({ kind: 'put', body });
      const bytes = init!.body as Uint8Array;
      stored.add(sha(bytes));
      return new Response('', { status: 200 });
    }
    if (url === 'https://huggingface.co/verify') {
      calls.push({ kind: 'verify', body });
      expect((init!.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
      return new Response('{}', { status: 200 });
    }
    if (url.endsWith('/commit/main')) {
      calls.push({ kind: 'commit', body });
      if (opts.failCommit) return new Response(`{"error":"bad token ${TOKEN}"}`, { status: 403, headers: { 'x-debug': TOKEN } });
      return new Response('{"commitOid":"x"}', { status: 200 });
    }
    return new Response(opts.echo ? `unknown ${TOKEN}` : 'unknown', { status: 404 });
  }) as typeof fetch;
  return { fetch: f, calls, stored };
}

function deps(over: Partial<UploadDeps> = {}): UploadDeps {
  return { token: TOKEN, limiter: new RateLimiter(), ...over };
}

const ANON = '0123456789abcdef';
function req(op: string, body: BodyInit | null, d: UploadDeps, headers: Record<string, string> = {}, ip = '203.0.113.7'): Request {
  return new Request(`https://studio.test/api/cook-upload?op=${op}`, { method: 'POST', body, headers: { 'x-forwarded-for': ip, 'x-aether-anon': ANON, 'x-aether-key': anonKey(ANON, d), ...headers } });
}

const IR = HEX('a');
const WORLD = IR.slice(0, 16);
function manifest(packs: Array<{ file: string; bytes: number }>, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: 2,
    irHash: IR,
    genVersion: 'gen1.p3.e2',
    dir: 'fedcba9876543210/',
    cookedAt: '2026-11-06T00:00:00.000Z',
    world: { id: 'w', name: 'W', entities: 2 },
    opening: null,
    startMode: 'walkthrough',
    profile: 'walkthrough',
    partition: null,
    cells: [{ key: 'p', bounds: null, entries: 1, bytes: 8, packs: packs.map((_, i) => i) }],
    packs,
    entries: { [HEX('b')]: [0, 0, 8, 0] },
    programs: {},
    lightmap: null,
    ...over,
  };
}

/** Everything a response shows: status, headers and body. */
async function text(res: Response): Promise<string> {
  return `${res.status} ${JSON.stringify([...res.headers])} ${await res.text()}`;
}

describe('cook upload: validation', () => {
  const ok = (m: Record<string, unknown>, files: Record<string, string>) => () => checkCommit({ world: WORLD, manifest: m, files });

  it('accepts a well-formed package', () => {
    const m = manifest([{ file: 'packs/0000.bin', bytes: 16 }], { programs: { low: { file: 'programs/low.bin', bytes: 10, programs: 2 } } });
    const c = checkCommit({ world: WORLD, manifest: m, files: { 'packs/0000.bin': HEX('1'), 'programs/low.bin': HEX('2') } });
    expect(c.files.map((f) => f.file).sort()).toEqual(['packs/0000.bin', 'programs/low.bin']);
  });

  it('refuses a bad manifest, a wrong world id and a lightmap', () => {
    expect(ok(manifest([{ file: 'packs/0000.bin', bytes: 16 }], { format: 3 }), { 'packs/0000.bin': HEX('1') })).toThrow(/manifest rejected/);
    expect(ok(manifest([{ file: 'packs/0000.bin', bytes: 16 }], { irHash: 'nothex' }), { 'packs/0000.bin': HEX('1') })).toThrow(/manifest rejected/);
    expect(() => checkCommit({ world: HEX('c', 16), manifest: manifest([{ file: 'packs/0000.bin', bytes: 16 }]), files: { 'packs/0000.bin': HEX('1') } })).toThrow(/world id/);
    expect(ok(manifest([{ file: 'packs/0000.bin', bytes: 16 }], { lightmap: { base: 'lm/' } }), { 'packs/0000.bin': HEX('1') })).toThrow(/lightmap/);
    expect(() => checkCommit('nope')).toThrow();
  });

  it('refuses oversize files and packages', () => {
    expect(ok(manifest([{ file: 'packs/0000.bin', bytes: MAX_FILE_BYTES + 1 }]), { 'packs/0000.bin': HEX('1') })).toThrow(/at most/);
    const many = Array.from({ length: 17 }, (_, i) => ({ file: `packs/${String(i).padStart(4, '0')}.bin`, bytes: MAX_FILE_BYTES }));
    expect(17 * MAX_FILE_BYTES).toBeGreaterThan(MAX_PACKAGE_BYTES);
    expect(ok(manifest(many), Object.fromEntries(many.map((p) => [p.file, HEX('1')])))).toThrow(/the package is/);
  });

  it('refuses names outside the allowed set, and file lists that do not match the manifest', () => {
    expect(ok(manifest([{ file: 'packs/evil.bin', bytes: 16 }]), { 'packs/evil.bin': HEX('1') })).toThrow(/pack name/);
    expect(ok(manifest([{ file: 'packs/0000.bin', bytes: 16 }], { dir: '../x/' }), { 'packs/0000.bin': HEX('1') })).toThrow();
    expect(ok(manifest([{ file: 'packs/0000.bin', bytes: 16 }], { programs: { low: { file: 'programs/high.bin', bytes: 10, programs: 1 } } }), { 'packs/0000.bin': HEX('1'), 'programs/high.bin': HEX('2') })).toThrow(/program set name/);
    expect(ok(manifest([{ file: 'packs/0000.bin', bytes: 16 }], { programs: { low: { file: 'programs/low.json', bytes: 10, programs: 1 } } }), { 'packs/0000.bin': HEX('1'), 'programs/low.json': HEX('2') })).toThrow();
    expect(ok(manifest([{ file: 'packs/0000.bin', bytes: 16 }]), { 'packs/0000.bin': HEX('1'), 'index.html': HEX('2') })).toThrow(/does not match/);
    expect(ok(manifest([{ file: 'packs/0000.bin', bytes: 16 }]), { 'index.html': HEX('2') })).toThrow(/not in the manifest/);
    expect(ok(manifest([{ file: 'packs/0000.bin', bytes: 16 }]), { 'packs/0000.bin': 'abc' })).toThrow(/bad hash/);
  });

  it('answers 400 to a bad commit, 413 to an oversize blob and 401 to a forged key', async () => {
    const d = deps({ fetch: fakeHub().fetch });
    expect((await handleCookUpload(req('commit', JSON.stringify({ world: WORLD, manifest: { format: 9 }, files: {} }), d), d)).status).toBe(400);
    expect((await handleCookUpload(req('blob', new Uint8Array(MAX_FILE_BYTES + 1), d), d)).status).toBe(413);
    expect((await handleCookUpload(req('blob', new Uint8Array(8), d, { 'x-aether-key': 'forged' }), d)).status).toBe(401);
    expect((await handleCookUpload(req('blob', new Uint8Array(8), d, { 'x-aether-anon': 'not-hex' }), d)).status).toBe(401);
    expect((await handleCookUpload(new Request('https://studio.test/api/cook-upload?op=id'), d)).status).toBe(405);
    expect((await handleCookUpload(req('nope', null, d), d)).status).toBe(404);
  });
});

describe('cook upload: order', () => {
  it('stores blobs in LFS storage, then commits the files, then the manifest', async () => {
    const hub = fakeHub();
    const d = deps({ fetch: hub.fetch });
    const pack = new Uint8Array(16).fill(7);
    const prog = new Uint8Array(10).fill(9);
    for (const b of [pack, prog]) {
      const r = await handleCookUpload(req('blob', b, d), d);
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ oid: sha(b), size: b.byteLength });
    }
    expect(hub.calls.map((c) => c.kind)).toEqual(['batch', 'put', 'verify', 'batch', 'put', 'verify']);
    // A blob already stored is not sent again.
    await handleCookUpload(req('blob', pack, d), d);
    expect(hub.calls.slice(6).map((c) => c.kind)).toEqual(['batch']);
    hub.calls.length = 0;

    const m = manifest([{ file: 'packs/0000.bin', bytes: 16 }], { programs: { low: { file: 'programs/low.bin', bytes: 10, programs: 2 } } });
    const res = await handleCookUpload(req('commit', JSON.stringify({ world: WORLD, manifest: m, files: { 'packs/0000.bin': sha(pack), 'programs/low.bin': sha(prog) } }), d), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: `users/${ANON}/${WORLD}/manifest.json`, ref: `${ANON}.${WORLD}` });
    expect(hub.calls.map((c) => c.kind)).toEqual(['batch', 'commit', 'commit']);
    const lines = (c: Call): Array<{ key: string; value: { path?: string; content?: string } }> => c.body.split('\n').map((l) => JSON.parse(l));
    const files = lines(hub.calls[1]!);
    expect(files.slice(1).map((l) => [l.key, l.value.path])).toEqual([
      ['lfsFile', `users/${ANON}/${WORLD}/fedcba9876543210/packs/0000.bin`],
      ['lfsFile', `users/${ANON}/${WORLD}/fedcba9876543210/programs/low.bin`],
    ]);
    const last = lines(hub.calls[2]!);
    expect(last.slice(1).map((l) => [l.key, l.value.path])).toEqual([['file', `users/${ANON}/${WORLD}/manifest.json`]]);
    const written = JSON.parse(Buffer.from(last[1]!.value.content!, 'base64').toString('utf8')) as { dir: string; startMode: string };
    expect(written.dir).toBe('fedcba9876543210/');
    expect(written.startMode).toBe('walkthrough');
  });

  it('commits nothing while a file is not in storage', async () => {
    const hub = fakeHub();
    const d = deps({ fetch: hub.fetch });
    const m = manifest([{ file: 'packs/0000.bin', bytes: 16 }]);
    const res = await handleCookUpload(req('commit', JSON.stringify({ world: WORLD, manifest: m, files: { 'packs/0000.bin': HEX('1') } }), d), d);
    expect(res.status).toBe(409);
    expect(hub.calls.map((c) => c.kind)).toEqual(['batch']);
  });
});

describe('cook upload: rate limits', () => {
  it('limits new ids per address', async () => {
    const d = deps({ fetch: fakeHub().fetch });
    for (let i = 0; i < LIMITS.idsPerIp; i++) {
      const r = await handleCookUpload(req('id', null, d), d);
      expect(r.status).toBe(200);
      const { anon, key } = (await r.json()) as { anon: string; key: string };
      expect(anon).toMatch(/^[0-9a-f]{16}$/);
      expect(key).toBe(anonKey(anon, d));
    }
    expect((await handleCookUpload(req('id', null, d), d)).status).toBe(429);
    expect((await handleCookUpload(req('id', null, d, {}, '198.51.100.1'), d)).status).toBe(200);
  });

  it('limits commits per anonymous id, and resets after the window', async () => {
    let now = 0;
    const hub = fakeHub();
    const d = deps({ fetch: hub.fetch, limiter: new RateLimiter(() => now) });
    const pack = new Uint8Array(16).fill(3);
    await handleCookUpload(req('blob', pack, d), d);
    const body = JSON.stringify({ world: WORLD, manifest: manifest([{ file: 'packs/0000.bin', bytes: 16 }]), files: { 'packs/0000.bin': sha(pack) } });
    for (let i = 0; i < LIMITS.commitsPerAnon; i++) expect((await handleCookUpload(req('commit', body, d, {}, `192.0.2.${i}`), d)).status).toBe(200);
    expect((await handleCookUpload(req('commit', body, d, {}, '192.0.2.200'), d)).status).toBe(429);
    now += LIMITS.windowMs;
    expect((await handleCookUpload(req('commit', body, d, {}, '192.0.2.200'), d)).status).toBe(200);
  });

  it('limits blob bytes per anonymous id', () => {
    const l = new RateLimiter(() => 0);
    expect(l.take('b', LIMITS.blobBytesPerAnon, LIMITS.blobBytesPerAnon, LIMITS.windowMs)).toBe(true);
    expect(l.take('b', 1, LIMITS.blobBytesPerAnon, LIMITS.windowMs)).toBe(false);
  });
});

describe('cook upload: the token', () => {
  it('never appears in a response, whatever the hub answers', async () => {
    const seen: string[] = [];
    for (const hubOpts of [{}, { echo: true }, { failCommit: true }]) {
      const hub = fakeHub(hubOpts);
      const d = deps({ fetch: hub.fetch });
      const pack = new Uint8Array(16).fill(5);
      seen.push(await text(await handleCookUpload(req('id', null, d), d)));
      seen.push(await text(await handleCookUpload(req('blob', pack, d), d)));
      seen.push(await text(await handleCookUpload(req('blob', new Uint8Array(0), d), d)));
      seen.push(await text(await handleCookUpload(req('blob', pack, d, { 'x-aether-key': 'x' }), d)));
      const body = JSON.stringify({ world: WORLD, manifest: manifest([{ file: 'packs/0000.bin', bytes: 16 }]), files: { 'packs/0000.bin': sha(pack) } });
      seen.push(await text(await handleCookUpload(req('commit', body, d), d)));
      seen.push(await text(await handleCookUpload(req('commit', '{', d), d)));
    }
    // A hub that throws (network failure) with the token in its message.
    const boom = deps({ fetch: (async () => Promise.reject(new Error(`connect failed Bearer ${TOKEN}`))) as typeof fetch });
    seen.push(await text(await handleCookUpload(req('blob', new Uint8Array(8), boom), boom)));
    expect(seen.some((s) => s.startsWith('502'))).toBe(true);
    for (const s of seen) expect(s).not.toContain(TOKEN);
    // Nor anything derived from it the browser does not need (the signing key is a hash of it, not the token).
    for (const s of seen) expect(s).not.toContain(TOKEN.slice(3, 15));
  });
});
