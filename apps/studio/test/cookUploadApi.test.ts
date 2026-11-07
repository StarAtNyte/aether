import { describe, expect, it } from 'vitest';
import { anonKey, CHUNK_BYTES, checkAssemble, checkCommit, handleCookUpload, LIMITS, MAX_FILE_BYTES, MAX_FILES, MAX_PACKAGE_BYTES, QUOTA, RateLimiter, signTicket, TICKET_MS, type UploadDeps } from '../../../api/_lib/cook-upload';
import { fakeHub, sha, TOKEN, type HubCall } from './fakeCookHub';

const HEX = (c: string, n = 64): string => c.repeat(n);

function deps(over: Partial<UploadDeps> = {}): UploadDeps {
  return { token: TOKEN, limiter: new RateLimiter(), ...over };
}

const ANON = '0123456789abcdef';
const IR = HEX('a');
const WORLD = IR.slice(0, 16);

/** A ticket for `ANON` and `WORLD` (as `begin` signs it). */
function ticket(d: UploadDeps, over: { anon?: string; world?: string; bytes?: number; exp?: number } = {}): string {
  return signTicket({ anon: over.anon ?? ANON, world: over.world ?? WORLD, bytes: over.bytes ?? 10_000_000, exp: over.exp ?? d.limiter.now() + TICKET_MS }, d);
}

function req(op: string, body: BodyInit | null, d: UploadDeps, headers: Record<string, string> = {}, ip = '203.0.113.7'): Request {
  return new Request(`https://studio.test/api/cook-upload?op=${op}`, { method: 'POST', body, headers: { 'x-forwarded-for': ip, 'x-aether-anon': ANON, 'x-aether-key': anonKey(ANON, d), 'x-aether-ticket': ticket(d), ...headers } });
}

const WORLD_BYTES = new Uint8Array(40).fill(4);
const WORLD_OID = sha(WORLD_BYTES);

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
    entries: packs.length ? { [HEX('b')]: [0, 0, 8, 0] } : {},
    programs: {},
    lightmap: null,
    ir: { file: 'world.json.gz', bytes: WORLD_BYTES.byteLength, sha256: WORLD_OID },
    ...over,
  };
}

/** Everything a response shows: status, headers and body. */
async function text(res: Response): Promise<string> {
  return `${res.status} ${JSON.stringify([...res.headers])} ${await res.text()}`;
}

describe('cook upload: validation', () => {
  const ok = (m: Record<string, unknown>, files: Record<string, string>) => () => checkCommit({ world: WORLD, manifest: m, files: { 'world.json.gz': WORLD_OID, ...files } });

  it('accepts a well-formed package with its world file', () => {
    const m = manifest([{ file: 'packs/0000.bin', bytes: 16 }], { programs: { low: { file: 'programs/low.bin', bytes: 10, programs: 2 } } });
    const c = ok(m, { 'packs/0000.bin': HEX('1'), 'programs/low.bin': HEX('2') })();
    expect(c.files.map((f) => f.file).sort()).toEqual(['packs/0000.bin', 'programs/low.bin', 'world.json.gz']);
    expect(c.bytes).toBe(16 + 10 + WORLD_BYTES.byteLength);
    // A world with no geometry and no shaders is still a package: the world file.
    expect(ok(manifest([], { cells: [] }), {})().files).toHaveLength(1);
  });

  it('accepts baked light in light/ with its files listed, and refuses it anywhere else or unlisted', () => {
    const LM = 'light/lm5-' + HEX('d', 32) + '.lmap';
    const LV = 'light/lv3-' + HEX('e', 32) + '.lvol';
    const files = [{ file: LM, bytes: 5_500_000 }, { file: LV, bytes: 3_300_000 }, { file: 'light/index.json', bytes: 120 }];
    const light = { base: 'light/', version: 'r1', files };
    const listed = { 'packs/0000.bin': HEX('1'), [LM]: HEX('3'), [LV]: HEX('4'), 'light/index.json': HEX('5') };
    const c = ok(manifest([{ file: 'packs/0000.bin', bytes: 16 }], { lightmap: light }), listed)();
    expect(c.files.map((f) => f.file).sort()).toEqual(['light/index.json', LM, LV, 'packs/0000.bin', 'world.json.gz'].sort());
    expect(c.bytes).toBe(16 + WORLD_BYTES.byteLength + 5_500_000 + 3_300_000 + 120);
    // Unlisted, unversioned, outside light/, a missing part, a foreign name or a large index: refused.
    expect(ok(manifest([{ file: 'packs/0000.bin', bytes: 16 }], { lightmap: { base: 'light/', version: 'r1' } }), { 'packs/0000.bin': HEX('1') })).toThrow(/baked light/);
    expect(ok(manifest([{ file: 'packs/0000.bin', bytes: 16 }], { lightmap: { base: 'light/', files } }), listed)).toThrow(/baked light/);
    expect(ok(manifest([{ file: 'packs/0000.bin', bytes: 16 }], { lightmap: { base: 'lm/', version: 'r1', files: files.map((f) => ({ ...f, file: f.file.replace('light/', 'lm/') })) } }), { 'packs/0000.bin': HEX('1') })).toThrow(/baked light/);
    expect(ok(manifest([{ file: 'packs/0000.bin', bytes: 16 }], { lightmap: { ...light, files: files.slice(0, 2) } }), { 'packs/0000.bin': HEX('1'), [LM]: HEX('3'), [LV]: HEX('4') })).toThrow(/index\.json/);
    expect(ok(manifest([{ file: 'packs/0000.bin', bytes: 16 }], { lightmap: { ...light, files: [...files, { file: 'light/x.html', bytes: 9 }] } }), { ...listed, 'light/x.html': HEX('6') })).toThrow(/not allowed/);
    expect(ok(manifest([{ file: 'packs/0000.bin', bytes: 16 }], { lightmap: { ...light, files: [files[0]!, files[1]!, { file: 'light/index.json', bytes: 9000 }] } }), listed)).toThrow(/index is too large/);
    // A listed file must be in the commit's file list.
    expect(ok(manifest([{ file: 'packs/0000.bin', bytes: 16 }], { lightmap: light }), { 'packs/0000.bin': HEX('1') })).toThrow(/does not match/);
  });

  it('refuses a bad manifest, a wrong world id, a lightmap and a package without its world', () => {
    expect(ok(manifest([{ file: 'packs/0000.bin', bytes: 16 }], { format: 3 }), { 'packs/0000.bin': HEX('1') })).toThrow(/manifest rejected/);
    expect(ok(manifest([{ file: 'packs/0000.bin', bytes: 16 }], { irHash: 'nothex' }), { 'packs/0000.bin': HEX('1') })).toThrow(/manifest rejected/);
    expect(() => checkCommit({ world: HEX('c', 16), manifest: manifest([{ file: 'packs/0000.bin', bytes: 16 }]), files: { 'packs/0000.bin': HEX('1'), 'world.json.gz': WORLD_OID } })).toThrow(/world id/);
    expect(ok(manifest([{ file: 'packs/0000.bin', bytes: 16 }], { lightmap: { base: 'lm/' } }), { 'packs/0000.bin': HEX('1') })).toThrow(/baked light/);
    expect(() => checkCommit({ world: WORLD, manifest: manifest([{ file: 'packs/0000.bin', bytes: 16 }], { ir: null }), files: { 'packs/0000.bin': HEX('1') } })).toThrow(/world\.json\.gz/);
    expect(ok(manifest([{ file: 'packs/0000.bin', bytes: 16 }], { ir: { file: 'w.json', bytes: 40, sha256: WORLD_OID } }), { 'packs/0000.bin': HEX('1') })).toThrow(/world\.json\.gz/);
    // The world file's hash in the list must be the manifest's.
    expect(() => checkCommit({ world: WORLD, manifest: manifest([{ file: 'packs/0000.bin', bytes: 16 }]), files: { 'packs/0000.bin': HEX('1'), 'world.json.gz': HEX('9') } })).toThrow(/hash of world\.json\.gz/);
    expect(() => checkCommit('nope')).toThrow();
  });

  it('refuses oversize files and packages, and too many files', () => {
    expect(ok(manifest([{ file: 'packs/0000.bin', bytes: MAX_FILE_BYTES + 1 }]), { 'packs/0000.bin': HEX('1') })).toThrow(/at most/);
    expect(ok(manifest([{ file: 'packs/0000.bin', bytes: MAX_FILE_BYTES }]), { 'packs/0000.bin': HEX('1') })).not.toThrow();
    const n = Math.ceil(MAX_PACKAGE_BYTES / MAX_FILE_BYTES) + 1;
    const many = Array.from({ length: n }, (_, i) => ({ file: `packs/${String(i).padStart(4, '0')}.bin`, bytes: MAX_FILE_BYTES }));
    expect(ok(manifest(many), Object.fromEntries(many.map((p) => [p.file, HEX('1')])))).toThrow(/the package is/);
    const lots = Array.from({ length: MAX_FILES }, (_, i) => ({ file: `packs/${String(i).padStart(4, '0')}.bin`, bytes: 8 }));
    expect(ok(manifest(lots), Object.fromEntries(lots.map((p) => [p.file, HEX('1')])))).toThrow(/more than/);
  });

  it('refuses names outside the allowed set, and file lists that do not match the manifest', () => {
    expect(ok(manifest([{ file: 'packs/evil.bin', bytes: 16 }]), { 'packs/evil.bin': HEX('1') })).toThrow(/pack name/);
    expect(ok(manifest([{ file: 'packs/0000.bin', bytes: 16 }], { dir: '../x/' }), { 'packs/0000.bin': HEX('1') })).toThrow();
    expect(ok(manifest([{ file: 'packs/0000.bin', bytes: 16 }], { programs: { low: { file: 'programs/high.bin', bytes: 10, programs: 1 } } }), { 'packs/0000.bin': HEX('1'), 'programs/high.bin': HEX('2') })).toThrow(/program set name/);
    expect(ok(manifest([{ file: 'packs/0000.bin', bytes: 16 }], { programs: { low: { file: 'programs/low.json', bytes: 10, programs: 1 } } }), { 'packs/0000.bin': HEX('1'), 'programs/low.json': HEX('2') })).toThrow();
    expect(ok(manifest([{ file: 'packs/0000.bin', bytes: 16 }]), { 'packs/0000.bin': HEX('1'), 'index.html': HEX('2') })).toThrow(/does not match/);
    expect(() => checkCommit({ world: WORLD, manifest: manifest([{ file: 'packs/0000.bin', bytes: 16 }]), files: { 'index.html': HEX('2'), 'world.json.gz': WORLD_OID } })).toThrow(/not in the manifest/);
    expect(ok(manifest([{ file: 'packs/0000.bin', bytes: 16 }]), { 'packs/0000.bin': 'abc' })).toThrow(/bad hash/);
  });

  it('checks an assemble request: size above one chunk, chunks that add up', () => {
    const parts = [{ oid: HEX('1'), size: CHUNK_BYTES }, { oid: HEX('2'), size: 10 }];
    expect(checkAssemble({ oid: HEX('3'), size: CHUNK_BYTES + 10, parts }).parts).toHaveLength(2);
    expect(() => checkAssemble({ oid: HEX('3'), size: CHUNK_BYTES + 11, parts })).toThrow(/add up/);
    expect(() => checkAssemble({ oid: HEX('3'), size: 100, parts: [{ oid: HEX('1'), size: 50 }, { oid: HEX('2'), size: 50 }] })).toThrow(/assemble/);
    expect(() => checkAssemble({ oid: HEX('3'), size: MAX_FILE_BYTES + 1, parts })).toThrow(/assemble/);
    expect(() => checkAssemble({ oid: HEX('3'), size: CHUNK_BYTES + 10, parts: [{ oid: HEX('1'), size: CHUNK_BYTES + 1 }, { oid: HEX('2'), size: 9 }] })).toThrow(/bad chunk/);
    expect(() => checkAssemble({ oid: 'x', size: CHUNK_BYTES + 10, parts })).toThrow(/bad hash/);
  });

  it('answers 400 to a bad commit, 413 to an oversize chunk, 401 to a forged key or ticket', async () => {
    const d = deps({ fetch: fakeHub().fetch });
    expect((await handleCookUpload(req('commit', JSON.stringify({ world: WORLD, manifest: { format: 9 }, files: {} }), d), d)).status).toBe(400);
    expect((await handleCookUpload(req('blob', new Uint8Array(CHUNK_BYTES + 1), d), d)).status).toBe(413);
    expect((await handleCookUpload(req('blob', new Uint8Array(8), d, { 'x-aether-key': 'forged' }), d)).status).toBe(401);
    expect((await handleCookUpload(req('blob', new Uint8Array(8), d, { 'x-aether-anon': 'not-hex' }), d)).status).toBe(401);
    // No ticket, a forged one, another id's, an expired one.
    expect((await handleCookUpload(req('blob', new Uint8Array(8), d, { 'x-aether-ticket': '' }), d)).status).toBe(401);
    expect((await handleCookUpload(req('blob', new Uint8Array(8), d, { 'x-aether-ticket': ticket(d).slice(0, -2) + 'AA' }), d)).status).toBe(401);
    expect((await handleCookUpload(req('blob', new Uint8Array(8), d, { 'x-aether-ticket': ticket(d, { anon: 'fedcba9876543210' }) }), d)).status).toBe(401);
    expect((await handleCookUpload(req('blob', new Uint8Array(8), d, { 'x-aether-ticket': ticket(d, { exp: d.limiter.now() - 1 }) }), d)).status).toBe(401);
    expect((await handleCookUpload(req('blob', new Uint8Array(8), d, { 'x-aether-ticket': ticket(deps({ secret: 'other' })) }), d)).status).toBe(401);
    expect((await handleCookUpload(new Request('https://studio.test/api/cook-upload?op=id'), d)).status).toBe(405);
    expect((await handleCookUpload(req('nope', null, d), d)).status).toBe(404);
  });
});

describe('cook upload: order', () => {
  it('begins, stores chunks in LFS storage, then commits the files, then the manifest', async () => {
    const hub = fakeHub();
    const d = deps({ fetch: hub.fetch });
    const b = await handleCookUpload(req('begin', JSON.stringify({ world: WORLD, bytes: 66, files: 3 }), d, { 'x-aether-ticket': '' }), d);
    expect(b.status).toBe(200);
    const { ticket: t } = (await b.json()) as { ticket: string };
    expect(hub.calls.map((c) => c.kind)).toEqual(['commits', 'tree']);
    hub.calls.length = 0;
    const pack = new Uint8Array(16).fill(7);
    const prog = new Uint8Array(10).fill(9);
    for (const x of [pack, prog, WORLD_BYTES]) {
      const r = await handleCookUpload(req('blob', x, d, { 'x-aether-ticket': t }), d);
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ oid: sha(x), size: x.byteLength });
    }
    expect(hub.calls.map((c) => c.kind)).toEqual(['batch', 'put', 'verify', 'batch', 'put', 'verify', 'batch', 'put', 'verify']);
    // A blob already stored is not sent again.
    await handleCookUpload(req('blob', pack, d, { 'x-aether-ticket': t }), d);
    expect(hub.calls.slice(9).map((c) => c.kind)).toEqual(['batch']);
    hub.calls.length = 0;

    const m = manifest([{ file: 'packs/0000.bin', bytes: 16 }], { programs: { low: { file: 'programs/low.bin', bytes: 10, programs: 2 } } });
    const res = await handleCookUpload(req('commit', JSON.stringify({ world: WORLD, manifest: m, files: { 'packs/0000.bin': sha(pack), 'programs/low.bin': sha(prog), 'world.json.gz': WORLD_OID } }), d, { 'x-aether-ticket': t }), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: `users/${ANON}/${WORLD}/manifest.json`, ref: `${ANON}.${WORLD}` });
    expect(hub.calls.map((c) => c.kind)).toEqual(['commits', 'tree', 'batch', 'commit', 'commit']);
    const lines = (c: HubCall): Array<{ key: string; value: { path?: string; content?: string; summary?: string } }> => c.body.split('\n').map((l) => JSON.parse(l));
    const files = lines(hub.calls[3]!);
    expect(files.slice(1).map((l) => [l.key, l.value.path])).toEqual([
      ['lfsFile', `users/${ANON}/${WORLD}/fedcba9876543210/packs/0000.bin`],
      ['lfsFile', `users/${ANON}/${WORLD}/fedcba9876543210/programs/low.bin`],
      ['lfsFile', `users/${ANON}/${WORLD}/fedcba9876543210/world.json.gz`],
    ]);
    const last = lines(hub.calls[4]!);
    expect(last[0]!.value.summary).toBe(`Point users/${ANON}/${WORLD} at cooked package fedcba9876543210`);
    expect(last.slice(1).map((l) => [l.key, l.value.path])).toEqual([['file', `users/${ANON}/${WORLD}/manifest.json`]]);
    const written = JSON.parse(Buffer.from(last[1]!.value.content!, 'base64').toString('utf8')) as { dir: string; startMode: string; ir: { sha256: string } };
    expect(written.dir).toBe('fedcba9876543210/');
    expect(written.startMode).toBe('walkthrough');
    expect(written.ir.sha256).toBe(WORLD_OID);
  });

  it('commits nothing while a file is not in storage, nor for another world than the ticket', async () => {
    const hub = fakeHub();
    const d = deps({ fetch: hub.fetch });
    const m = manifest([{ file: 'packs/0000.bin', bytes: 16 }]);
    const body = JSON.stringify({ world: WORLD, manifest: m, files: { 'packs/0000.bin': HEX('1'), 'world.json.gz': WORLD_OID } });
    const res = await handleCookUpload(req('commit', body, d), d);
    expect(res.status).toBe(409);
    expect(hub.calls.some((c) => c.kind === 'commit')).toBe(false);
    expect((await handleCookUpload(req('commit', body, d, { 'x-aether-ticket': ticket(d, { world: HEX('c', 16) }) }), d)).status).toBe(401);
  });
});

describe('cook upload: chunks', () => {
  /** A file of `n` bytes that is not one repeated byte. */
  const file = (n: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (i * 31 + (i >> 8)) & 255);

  it('joins a file larger than one request from its chunks, read back from storage, and stores it whole', async () => {
    const hub = fakeHub();
    const d = deps({ fetch: hub.fetch });
    const big = file(CHUNK_BYTES * 2 + 1234);
    const parts: Array<{ oid: string; size: number }> = [];
    for (let at = 0; at < big.byteLength; at += CHUNK_BYTES) {
      const c = big.subarray(at, at + CHUNK_BYTES);
      const r = await handleCookUpload(req('blob', c.slice(), d), d);
      expect(r.status).toBe(200);
      parts.push({ oid: sha(c), size: c.byteLength });
    }
    expect(parts).toHaveLength(3);
    hub.calls.length = 0;
    const r = await handleCookUpload(req('assemble', JSON.stringify({ oid: sha(big), size: big.byteLength, parts }), d), d);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ oid: sha(big), size: big.byteLength });
    expect(hub.calls.map((c) => c.kind)).toEqual(['batch', 'get', 'batch', 'get', 'batch', 'get', 'batch', 'put', 'verify']);
    expect(Buffer.from(hub.stored.get(sha(big))!).equals(Buffer.from(big))).toBe(true);
  });

  it('refuses chunks not uploaded, a damaged chunk, and chunks that do not make the file', async () => {
    const hub = fakeHub();
    const d = deps({ fetch: hub.fetch });
    const big = file(CHUNK_BYTES + 100);
    const a = big.subarray(0, CHUNK_BYTES), b = big.subarray(CHUNK_BYTES);
    const parts = [{ oid: sha(a), size: a.byteLength }, { oid: sha(b), size: b.byteLength }];
    const assemble = (body: object): Promise<Response> => handleCookUpload(req('assemble', JSON.stringify(body), d), d);
    expect((await assemble({ oid: sha(big), size: big.byteLength, parts })).status).toBe(409);
    await handleCookUpload(req('blob', a.slice(), d), d);
    await handleCookUpload(req('blob', b.slice(), d), d);
    hub.damage.add(sha(b));
    expect((await assemble({ oid: sha(big), size: big.byteLength, parts })).status).toBe(502);
    expect((await assemble({ oid: HEX('e'), size: big.byteLength, parts })).status).toBe(400);
    expect(hub.stored.has(sha(big))).toBe(false);
    expect((await assemble({ oid: sha(big), size: big.byteLength, parts })).status).toBe(200);
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

  /** Publish the one-pack package of `anon` from `ip` through the function, `begin` first. */
  async function publish(d: UploadDeps, anon: string, ip: string, world = WORLD): Promise<number> {
    const who = { 'x-aether-anon': anon, 'x-aether-key': anonKey(anon, d) };
    const ir = world + HEX('a', 48);
    const b = await handleCookUpload(req('begin', JSON.stringify({ world, bytes: 56, files: 2 }), d, { ...who, 'x-aether-ticket': '' }, ip), d);
    if (b.status !== 200) return b.status;
    const t = ((await b.json()) as { ticket: string }).ticket;
    const pack = new Uint8Array(16).fill(3);
    for (const x of [pack, WORLD_BYTES]) await handleCookUpload(req('blob', x, d, { ...who, 'x-aether-ticket': t }, ip), d);
    const body = JSON.stringify({ world, manifest: manifest([{ file: 'packs/0000.bin', bytes: 16 }], { irHash: ir }), files: { 'packs/0000.bin': sha(pack), 'world.json.gz': WORLD_OID } });
    return (await handleCookUpload(req('commit', body, d, { ...who, 'x-aether-ticket': t }, ip), d)).status;
  }

  it("counts an id's publishes on the dataset itself: a new instance (no memory) still refuses, until the window passes", async () => {
    let now = Date.parse('2026-11-06T12:00:00Z');
    const hub = fakeHub({ now: () => now });
    const clock = (): number => now;
    for (let i = 0; i < QUOTA.publishesPerAnon; i++) expect(await publish(deps({ fetch: hub.fetch, limiter: new RateLimiter(clock) }), ANON, `192.0.2.${i}`)).toBe(200);
    // Every request on a fresh instance, from a fresh address: the count is the dataset's.
    expect(await publish(deps({ fetch: hub.fetch, limiter: new RateLimiter(clock) }), ANON, '192.0.2.200')).toBe(429);
    // Another id is not limited by this one's publishes.
    expect(await publish(deps({ fetch: hub.fetch, limiter: new RateLimiter(clock) }), 'fedcba9876543210', '192.0.2.201')).toBe(200);
    now += QUOTA.windowMs + 1000;
    expect(await publish(deps({ fetch: hub.fetch, limiter: new RateLimiter(clock) }), ANON, '192.0.2.200')).toBe(200);
  });

  it("limits everyone's publishes per window, and what one id stores", async () => {
    const now = Date.parse('2026-11-06T12:00:00Z');
    const hub = fakeHub({ now: () => now });
    for (let i = 0; i < QUOTA.publishesPerWindow; i++) hub.history.push({ title: `Point users/${(i + 1).toString(16).padStart(16, '0')}/${WORLD} at cooked package x`, date: new Date(now - 60_000).toISOString() });
    // The template cook's commits do not count.
    hub.history.unshift({ title: 'Point lisbon-hills at cooked package x', date: new Date(now).toISOString() });
    const d = deps({ fetch: hub.fetch, limiter: new RateLimiter(() => now) });
    expect(await publish(d, ANON, '192.0.2.1')).toBe(429);
    hub.history.length = 1;
    // Stored: near the cap already.
    hub.files.set(`users/${ANON}/${HEX('d', 16)}/x/packs/0000.bin`, { size: QUOTA.storedBytesPerAnon - 20, oid: HEX('d') });
    expect(await publish(d, ANON, '192.0.2.2')).toBe(429);
    expect(await publish(d, 'fedcba9876543210', '192.0.2.3')).toBe(200);
  });

  it('refuses a begin over the package cap, and keeps soft limits per address in memory', async () => {
    const d = deps({ fetch: fakeHub().fetch });
    const begin = (bytes: number, ip = '203.0.113.9'): Promise<Response> => handleCookUpload(req('begin', JSON.stringify({ world: WORLD, bytes, files: 2 }), d, {}, ip), d);
    expect((await begin(MAX_PACKAGE_BYTES + 1)).status).toBe(413);
    for (let i = 0; i < LIMITS.beginsPerIp; i++) expect((await begin(100)).status).toBe(200);
    expect((await begin(100)).status).toBe(429);
    expect((await begin(100, '203.0.113.10')).status).toBe(200);
  });

  it('limits what one ticket uploads to its package', async () => {
    const d = deps({ fetch: fakeHub().fetch });
    const t = ticket(d, { bytes: 100 });
    const chunk = new Uint8Array(CHUNK_BYTES).fill(1);
    expect((await handleCookUpload(req('blob', chunk, d, { 'x-aether-ticket': t }), d)).status).toBe(200);
    expect((await handleCookUpload(req('blob', new Uint8Array(300).fill(2), d, { 'x-aether-ticket': t }), d)).status).toBe(429);
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
      seen.push(await text(await handleCookUpload(req('begin', JSON.stringify({ world: WORLD, bytes: 56, files: 2 }), d), d)));
      seen.push(await text(await handleCookUpload(req('blob', pack, d), d)));
      seen.push(await text(await handleCookUpload(req('blob', WORLD_BYTES, d), d)));
      seen.push(await text(await handleCookUpload(req('blob', new Uint8Array(0), d), d)));
      seen.push(await text(await handleCookUpload(req('blob', pack, d, { 'x-aether-key': 'x' }), d)));
      seen.push(await text(await handleCookUpload(req('assemble', JSON.stringify({ oid: HEX('1'), size: CHUNK_BYTES + 2, parts: [{ oid: HEX('2'), size: CHUNK_BYTES }, { oid: HEX('3'), size: 2 }] }), d), d)));
      const body = JSON.stringify({ world: WORLD, manifest: manifest([{ file: 'packs/0000.bin', bytes: 16 }]), files: { 'packs/0000.bin': sha(pack), 'world.json.gz': WORLD_OID } });
      seen.push(await text(await handleCookUpload(req('commit', body, d), d)));
      seen.push(await text(await handleCookUpload(req('commit', '{', d), d)));
    }
    // A hub that throws (network failure) with the token in its message.
    const boom = deps({ fetch: (async () => Promise.reject(new Error(`connect failed Bearer ${TOKEN}`))) as typeof fetch });
    seen.push(await text(await handleCookUpload(req('blob', new Uint8Array(8), boom), boom)));
    seen.push(await text(await handleCookUpload(req('begin', JSON.stringify({ world: WORLD, bytes: 56, files: 2 }), boom), boom)));
    expect(seen.some((s) => s.startsWith('502'))).toBe(true);
    expect(seen.some((s) => s.startsWith('200'))).toBe(true);
    for (const s of seen) expect(s).not.toContain(TOKEN);
    // Nor anything derived from it the browser does not need (the signing key is a hash of it, not the token).
    for (const s of seen) expect(s).not.toContain(TOKEN.slice(3, 15));
  });
});
