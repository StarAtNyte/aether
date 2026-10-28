import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { importCredit, importIdFor, type SimreadyHit, type SimreadyResult } from '@aether/assets';
import type { AppEnv } from '../src/app-env';
import { ImportRefused, ImportService, MAX_IMPORT_TRIS, nameOf, type ConvertInput, type ConvertOutput, type ImportServiceDeps } from '../src/assets-import/service';
import { registerAssetImportRoutes } from '../src/routes/assets-import';
import { silentLogger } from '../src/logger';
import { cleanupDirs, makeConfig } from './helpers';

const REV = '653d91e182011f357cf1644013cc94ddf194d349';
const USD = 'a'.repeat(64);
const tmps: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'aether-imp-'));
  tmps.push(d);
  return d;
};
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
  cleanupDirs();
});

const hit = (pkg: string, licence: string | null, score = 1, importable = true): SimreadyHit => ({
  ref: { owner: 'nvidia', dataset: 'simready-assets', repo: 'nvidia/simready-assets', rev: REV, pkg, file: `${pkg}/simready_usd/${pkg}.usd` },
  url: '',
  score,
  usdBytes: 1000,
  author: 'nvidia',
  licenceRaw: { packaging: licence, card: licence },
  licence,
  allowed: licence !== null,
  importable,
  reason: licence === null ? 'non-commercial' : '',
  packageHash: null,
  fetch: '',
});

const searchOf = (accepted: SimreadyHit[], rejected: SimreadyHit[] = []) => async (): Promise<SimreadyResult> => ({ ok: true, query: 'q', accepted, rejected, considered: accepted.length + rejected.length });

/** A converter that writes a tiny "glb" and reports a library-shaped entry. */
function fakeConvert(opts: { tris?: number; bytes?: number } = {}) {
  const calls: ConvertInput[] = [];
  const fn = async (input: ConvertInput): Promise<ConvertOutput> => {
    calls.push(input);
    input.onStage('converting');
    input.onStage('optimising');
    const libDir = join(input.work, 'lib');
    mkdirSync(join(libDir, 's'), { recursive: true });
    const data = Buffer.from('glTF-test-' + input.row[1]);
    const sha = createHash('sha256').update(data).digest('hex');
    const path = `s/${input.row[1]}.${sha.slice(0, 8)}.glb`;
    writeFileSync(join(libDir, path), data);
    return {
      libDir,
      files: [{ path, sha256: sha, bytes: opts.bytes ?? data.byteLength }],
      entry: { id: input.row[1], name: input.row[5], kind: 'model', category: 'furniture', tags: ['chair'], style: 'realistic', pack: input.pack, size: [0.6, 1.1, 0.7], tris: opts.tris ?? 5000, bytes: data.byteLength, file: path, lods: [], collider: { type: 'box' }, placement: 'floor', facing: '+z', source: 'x' } as never,
    };
  };
  return Object.assign(fn, { calls });
}

function fakePackage(root: string, licence = 'CC-BY-4.0') {
  return async (ref: { pkg: string }) => {
    const dir = join(root, ref.pkg);
    mkdirSync(join(dir, 'simready_usd'), { recursive: true });
    writeFileSync(join(dir, 'simready_usd', `${ref.pkg}.usd`), 'usd');
    return { dir, licence, author: 'nvidia', packageHash: null, usd: { path: `simready_usd/${ref.pkg}.usd`, sha256: USD, bytes: 3 }, licenceRaw: { packaging: licence, card: licence } };
  };
}

function service(over: Partial<ImportServiceDeps> = {}) {
  const root = tmp();
  const convert = fakeConvert();
  const svc = new ImportService({
    dir: join(root, 'imported'),
    srcDir: join(root, 'src'),
    logger: silentLogger,
    toolsMissing: () => null,
    search: searchOf([hit('chair_office_a01', 'CC-BY-4.0', 1.1)]),
    fetchPackage: fakePackage(join(root, 'pkg')) as never,
    convert,
    ...over,
  });
  return { svc, convert, root };
}

async function finish(svc: ImportService, id: string) {
  for (let i = 0; i < 200; i++) {
    const v = svc.status(id)!;
    if (v.stage === 'ready' || v.stage === 'failed') return v;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('job did not finish');
}

describe('import service', () => {
  it('runs search -> licence -> download -> convert -> ready and writes a library-shaped record with the credit', async () => {
    const { svc, convert } = service();
    const seen = new Set<string>();
    const job = svc.start({ query: 'office chair' });
    for (let i = 0; i < 400 && !seen.has('ready'); i++) {
      const v = svc.status(job.id)!;
      seen.add(v.stage);
      await new Promise((r) => setTimeout(r, 2));
    }
    const v = (await finish(svc, job.id))!;
    expect(v.stage).toBe('ready');
    expect(v.progress).toBe(1);
    expect(convert.calls[0]!.row[1]).toBe(importIdFor('chair_office_a01', USD));
    expect(convert.calls[0]!.row[6].tris).toBe(20000);
    const a = v.asset!;
    expect(a.id).toBe(importIdFor('chair_office_a01', USD));
    expect(a.entry.tris).toBe(5000);
    expect(a.credit).toMatchObject({ licence: 'CC-BY-4.0', author: 'nvidia' });
    expect(a.credit.text).toContain('CC BY 4.0');
    expect(a.provenance).toMatchObject({ revision: REV, usdSha256: USD });
    expect(svc.list().map((x) => x.id)).toEqual([a.id]);
    expect(svc.filePath(a.id, a.entry.file!)).toMatch(/\.glb$/);
    expect(svc.filePath(a.id, 's/other.00000000.glb')).toBeNull();
    expect(svc.filePath(a.id, '../../../etc/passwd')).toBeNull();
  });

  it('visits the stages in order', async () => {
    const stages: string[] = [];
    const { svc } = service({
      fetchPackage: (async (ref: { pkg: string }, o: { onProgress?: (m: string, d: number, t: number) => void }) => {
        o.onProgress?.('[1/2] a.usd (1 KB)', 0, 2);
        return fakePackage(join(tmp(), 'p'))(ref);
      }) as never,
    });
    const job = svc.start({ query: 'chair' });
    for (let i = 0; i < 400; i++) {
      const s = svc.status(job.id)!.stage;
      if (stages.at(-1) !== s) stages.push(s);
      if (s === 'ready') break;
      await new Promise((r) => setTimeout(r, 1));
    }
    expect(stages.at(-1)).toBe('ready');
    const order = ['queued', 'searching', 'licence', 'downloading', 'converting', 'optimising', 'ready'];
    expect(stages.filter((s) => order.includes(s))).toEqual(stages);
    expect(stages.map((s) => order.indexOf(s))).toEqual([...stages.map((s) => order.indexOf(s))].sort((x, y) => x - y));
  });

  it('never imports a hit whose licence is not on the allow-list, and says why', async () => {
    const { svc, convert } = service({ search: searchOf([], [hit('toaster_nc', null)]) });
    const v = await finish(svc, svc.start({ query: 'toaster' }).id);
    expect(v.stage).toBe('failed');
    expect(v.error).toMatch(/licence/);
    expect(convert.calls).toHaveLength(0);
  });

  it('skips accepted hits whose licence the catalog cannot take yet (Apache, BSD)', async () => {
    const { svc, convert } = service({ search: searchOf([hit('apache_thing', 'Apache-2.0', 2, false)]) });
    const v = await finish(svc, svc.start({ query: 'thing' }).id);
    expect(v.stage).toBe('failed');
    expect(convert.calls).toHaveLength(0);
  });

  it('refuses a package whose fetch-time licence check fails', async () => {
    const { svc, convert } = service({
      fetchPackage: (async () => {
        throw new Error('refused nvidia/simready-assets/x: package: non-commercial (CC-BY-NC-4.0).');
      }) as never,
    });
    const v = await finish(svc, svc.start({ query: 'x' }).id);
    expect(v).toMatchObject({ stage: 'failed' });
    expect(v.error).toMatch(/non-commercial/);
    expect(convert.calls).toHaveLength(0);
  });

  it('says the conversion tools are missing before it downloads anything', async () => {
    let fetched = 0;
    const { svc } = service({ toolsMissing: () => 'conversion tools not installed: run npm run assets:simready-setup', fetchPackage: (async () => { fetched++; throw new Error('no'); }) as never });
    const v = await finish(svc, svc.start({ query: 'x' }).id);
    expect(v.error).toBe('conversion tools not installed: run npm run assets:simready-setup');
    expect(fetched).toBe(0);
  });

  it('refuses a result over the triangle or size caps', async () => {
    const big = service({ convert: fakeConvert({ tris: MAX_IMPORT_TRIS + 1 }) });
    expect((await finish(big.svc, big.svc.start({ query: 'x' }).id)).error).toMatch(/triangles/);
    const fat = service({ convert: fakeConvert({ bytes: 7 * 1024 * 1024 }) });
    expect((await finish(fat.svc, fat.svc.start({ query: 'x' }).id)).error).toMatch(/too large/);
  });

  it('passes the download cap (150 MB) and stops a job that runs over its time budget', async () => {
    let limits: { packageBytes?: number } = {};
    const slow = service({
      limits: { jobMs: 30 },
      fetchPackage: (async (_r: unknown, o: { limits: { packageBytes: number }; signal: AbortSignal }) => {
        limits = o.limits;
        await new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(new Error('aborted')), { once: true }));
      }) as never,
    });
    const v = await finish(slow.svc, slow.svc.start({ query: 'x' }).id);
    expect(limits.packageBytes).toBe(150 * 1024 * 1024);
    expect(v.stage).toBe('failed');
    expect(v.error).toMatch(/too long/);
  });

  it('runs one job at a time and refuses a long queue and too many starts', async () => {
    const s = service({ limits: { maxQueued: 1, startsPerWindow: 3 }, fetchPackage: (() => new Promise(() => undefined)) as never });
    s.svc.start({ query: 'a' });
    await new Promise((r) => setTimeout(r, 10));
    s.svc.start({ query: 'b' });
    expect(() => s.svc.start({ query: 'c' })).toThrowError(ImportRefused);
    const r = service({ limits: { startsPerWindow: 2, maxQueued: 9 }, fetchPackage: (() => new Promise(() => undefined)) as never });
    r.svc.start({ query: 'a' });
    r.svc.start({ query: 'b' });
    expect(() => r.svc.start({ query: 'c' })).toThrowError(/Too many/);
  });

  it('refuses a ref that is not a pinned owner/dataset@commit/package (no branch, no URL)', () => {
    const { svc } = service();
    for (const ref of ['https://evil.example/x.glb', 'nvidia/simready-assets@main/chair', 'nvidia/simready-assets/chair', '../../etc@' + REV + '/x', `nvidia/simready-assets@${REV}/../x`, 'http://169.254.169.254/latest']) {
      expect(() => svc.start({ ref })).toThrowError(ImportRefused);
    }
    expect(svc.start({ ref: `nvidia/simready-assets@${REV}/chair_office_a01` }).stage).toBe('queued');
  });

  it('returns the earlier import for the same pinned package without converting again', async () => {
    const { svc, convert } = service();
    const first = await finish(svc, svc.start({ query: 'chair' }).id);
    const second = await finish(svc, svc.start({ query: 'chair' }).id);
    expect(second.asset!.id).toBe(first.asset!.id);
    expect(convert.calls).toHaveLength(1);
  });

  it('does not leak the home folder or paths in messages', async () => {
    const { svc } = service({ fetchPackage: (async () => { throw new Error(`ENOENT ${process.env['HOME']}/.cache/x`); }) as never });
    const v = await finish(svc, svc.start({ query: 'x' }).id);
    expect(v.error).not.toContain(process.env['HOME']!);
  });
});

describe('catalog entry and credit', () => {
  it('names a package and writes a one-line credit within 200 characters', () => {
    expect(nameOf('chair_office_fabric_manager_a01')).toBe('Chair office fabric manager');
    const c = importCredit({ name: 'X'.repeat(80), author: 'A'.repeat(100), licence: 'CC-BY-4.0', repo: 'nvidia/simready-assets' });
    expect(c.text.length).toBeLessThanOrEqual(200);
    expect(c.licenceUrl).toBe('https://creativecommons.org/licenses/by/4.0/');
  });
});

describe('import routes', () => {
  function app(over: { loopback?: boolean; secret?: string; loopbackOnly?: boolean } = {}) {
    const s = service();
    const a = new Hono<AppEnv>();
    registerAssetImportRoutes(a, { service: s.svc, logger: silentLogger, loopbackOnly: over.loopbackOnly ?? true, isLoopback: () => over.loopback ?? true, ...(over.secret ? { sessionSecret: over.secret } : {}) });
    return { a, ...s };
  }
  const post = (a: Hono<AppEnv>, body: unknown, host = 'localhost:8787', headers: Record<string, string> = {}) =>
    a.request('/api/assets/import', { method: 'POST', headers: { host, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

  it('starts a job, reports it, lists the catalog and serves the file by hash name', async () => {
    const { a } = app();
    const res = await post(a, { query: 'office chair' });
    expect(res.status).toBe(202);
    const { job } = (await res.json()) as { job: { id: string } };
    let v: { job: { stage: string; asset?: { id: string; base: string; entry: { file: string } } } } = { job: { stage: 'queued' } };
    for (let i = 0; i < 200 && v.job.stage !== 'ready'; i++) {
      v = (await (await a.request(`/api/assets/import/${job.id}`, { headers: { host: 'localhost:8787' } })).json()) as typeof v;
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(v.job.stage).toBe('ready');
    const asset = v.job.asset!;
    const list = (await (await a.request('/api/assets/imported', { headers: { host: 'localhost:8787' } })).json()) as { assets: Array<{ id: string }> };
    expect(list.assets.map((x) => x.id)).toEqual([asset.id]);
    const file = await a.request(`${asset.base}${asset.entry.file}`, { headers: { host: 'localhost:8787' } });
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('model/gltf-binary');
    expect(file.headers.get('cache-control')).toContain('immutable');
    expect((await a.request(`${asset.base}s/nothere.00000000.glb`, { headers: { host: 'localhost:8787' } })).status).toBe(404);
    expect((await a.request(`/api/assets/imported/files/${asset.id}/s/..%2F..%2Fimported.json`, { headers: { host: 'localhost:8787' } })).status).toBe(404);
  });

  it('refuses bad bodies, unknown jobs, and a ref that is a URL', async () => {
    const { a } = app();
    expect((await post(a, {})).status).toBe(400);
    expect((await post(a, { query: 'a', ref: 'b' })).status).toBe(400);
    expect((await post(a, { query: 'x', url: 'http://169.254.169.254/' })).status).toBe(400);
    expect((await post(a, { ref: 'https://huggingface.co/datasets/x/y/resolve/main/z.glb' })).status).toBe(400);
    expect((await a.request('/api/assets/import/zzzz', { headers: { host: 'localhost:8787' } })).status).toBe(404);
  });

  it('answers only requests made on this machine (socket, host, proxy headers) and with the session', async () => {
    expect((await post(app({ loopback: false }).a, { query: 'x' })).status).toBe(403);
    expect((await post(app().a, { query: 'x' }, 'evil.example')).status).toBe(403);
    expect((await post(app().a, { query: 'x' }, 'localhost:8787', { 'x-forwarded-for': '1.2.3.4' })).status).toBe(403);
    const secret = 's'.repeat(40);
    expect((await post(app({ secret }).a, { query: 'x' })).status).toBe(401);
    expect((await post(app({ secret }).a, { query: 'x' }, 'localhost:8787', { 'x-aether-admin': secret })).status).toBe(202);
  });
});

describe('server config', () => {
  it('is on with local AI, off for a production server, and on there only with AETHER_ALLOW_IMPORT=1', () => {
    expect(makeConfig({ AETHER_LOCAL_AI: 'on' }).assetImport).toMatchObject({ enabled: true, loopbackOnly: true });
    expect(makeConfig({ NODE_ENV: 'production' }).assetImport.enabled).toBe(false);
    expect(makeConfig({ NODE_ENV: 'production', AETHER_ALLOW_IMPORT: '1' }).assetImport).toMatchObject({ enabled: true, loopbackOnly: false });
    expect(makeConfig({ AETHER_LOCAL_AI: 'on', AETHER_ASSET_IMPORT: 'off' }).assetImport.enabled).toBe(false);
  });
});
