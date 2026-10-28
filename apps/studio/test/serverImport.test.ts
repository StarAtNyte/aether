import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { importCredit, importIdFor } from '@aether/assets';
import { importFromServer, NEEDS_SERVER, serverCanImport } from '../src/assets/serverImport';

const glb = new Uint8Array([103, 108, 84, 70, 1, 2, 3]);
const sha = createHash('sha256').update(glb).digest('hex');
const id = importIdFor('toolbox_a01', 'c'.repeat(64));
const file = `s/${id}.${sha.slice(0, 8)}.glb`;
const asset = {
  id,
  entry: { id, name: 'Toolbox', kind: 'model', category: 'tools', tags: ['toolbox'], style: 'realistic', pack: 'simready-nvidia', size: [0.4, 0.2, 0.2], tris: 3000, bytes: 7, file, lods: [], collider: { type: 'box' }, placement: 'floor', facing: '+z', source: 'x' },
  base: `/api/assets/imported/files/${id}/`,
  credit: importCredit({ name: 'Toolbox', author: 'nvidia', licence: 'CC-BY-4.0', repo: 'nvidia/simready-assets' }),
  provenance: { repo: 'nvidia/simready-assets', revision: 'a'.repeat(40), package: 'toolbox_a01', usdSha256: 'c'.repeat(64), packageHash: null, files: { [file]: sha } },
  query: 'toolbox',
  createdAt: 1,
};
const job = (stage: string, extra: object = {}) => ({ job: { id: '0123456789abcdef', stage, message: stage, progress: stage === 'ready' ? 1 : 0.4, query: 'toolbox', ...extra } });
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

function server(opts: { health?: object | 'down'; glbBytes?: Uint8Array } = {}) {
  const calls: string[] = [];
  let polls = 0;
  const f = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url === '/api/health') return opts.health === 'down' ? new Response('nope', { status: 404 }) : json(opts.health ?? { ok: true, assetImport: true });
    if (url === '/api/assets/import') return json(job('queued'), 202);
    if (url.startsWith('/api/assets/import/')) return json(++polls < 2 ? job('converting') : job('ready', { asset }));
    if (url.startsWith('/api/assets/imported/files/')) return new Response((opts.glbBytes ?? glb) as Uint8Array<ArrayBuffer>);
    return new Response('?', { status: 404 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('serverImport (studio side)', () => {
  it('answers "needs the local server" on a page without one, without throwing', async () => {
    const s = server({ health: 'down' });
    expect(await serverCanImport(s.f)).toBe(false);
    expect(await importFromServer('toolbox', undefined, { fetchImpl: s.f })).toEqual({ ok: false, reason: 'unavailable', message: NEEDS_SERVER });
    expect(s.calls).toEqual(['GET /api/health', 'GET /api/health']);
    expect(await importFromServer('x', undefined, { fetchImpl: server({ health: { ok: true, assetImport: false } }).f })).toMatchObject({ reason: 'unavailable' });
    expect(await importFromServer('x', undefined, { fetchImpl: (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch })).toMatchObject({ reason: 'unavailable' });
  });

  it('follows the job with progress, downloads the file and checks its hash', async () => {
    const s = server();
    const lines: string[] = [];
    const r = await importFromServer('toolbox', 1, { fetchImpl: s.f, pollMs: 1, onProgress: (t) => lines.push(t) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bytes).toEqual(glb);
    expect(lines).toEqual(['queued', 'converting', 'ready']);
    expect(s.calls.filter((c) => c.startsWith('POST'))).toEqual(['POST /api/assets/import']);
  });

  it('refuses a file that does not match the recorded hash', async () => {
    const r = await importFromServer('toolbox', undefined, { fetchImpl: server({ glbBytes: new Uint8Array([9, 9, 9]) }).f, pollMs: 1 });
    expect(r).toMatchObject({ ok: false, reason: 'failed' });
    expect(!r.ok && r.message).toMatch(/hash/);
  });
});
