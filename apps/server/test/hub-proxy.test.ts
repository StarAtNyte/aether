import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleHubRequest } from '../../../scripts/vite/hub-proxy';

const DATASET = 'StarAtNyte1/aether-assets';
const REV = 'c'.repeat(40);
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function res(): ServerResponse & { out: { status: number; headers: Record<string, string>; body: Buffer } } {
  const out = { status: 0, headers: {} as Record<string, string>, body: Buffer.alloc(0) };
  return {
    out,
    set statusCode(v: number) { out.status = v; },
    get statusCode() { return out.status; },
    setHeader: (k: string, v: string) => void (out.headers[k.toLowerCase()] = String(v)),
    end: (b?: string | Buffer) => void (out.body = Buffer.from(b ?? '')),
  } as never;
}
const get = (path: string, o: Parameters<typeof handleHubRequest>[2], method = 'GET') => {
  const r = res();
  return handleHubRequest({ url: path, method }, r, o).then((handled) => ({ handled, ...r.out }));
};
const url = (p: string): string => `/__hub/datasets/${DATASET}/resolve/${REV}/${p}`;

describe('dev hub proxy', () => {
  it('serves a local staging folder, only the dataset files, only GET', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hub-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'models', 'chair'), { recursive: true });
    writeFileSync(join(dir, 'index.min.json'), '{"a":1}');
    writeFileSync(join(dir, 'models', 'chair', 'chair.glb'), 'glTFx');
    writeFileSync(join(dir, 'secret.txt'), 'no');
    const o = { dataset: DATASET, env: { AETHER_HUB_DIR: dir } };
    expect((await get(url('index.min.json'), o)).body.toString()).toBe('{"a":1}');
    expect((await get(url('models/chair/chair.glb'), o)).headers['content-type']).toBe('model/gltf-binary');
    for (const bad of ['secret.txt', '../secret.txt', 'models/chair/../../secret.txt', 'models/CHAIR/x.glb', '.git/config']) expect((await get(url(bad), o)).status, bad).toBe(404);
    expect((await get(`/__hub/datasets/someone/else/resolve/${REV}/index.min.json`, o)).status).toBe(404);
    expect((await get(url('index.min.json'), o, 'POST')).status).toBe(405);
    expect((await get('/api/health', o)).handled).toBe(false);
  });

  it('forwards to Hugging Face with the token on the server side only', async () => {
    const seen: Array<{ url: string; auth: string | undefined }> = [];
    const f = vi.fn(async (u: string, init?: { headers?: Record<string, string> }) => {
      seen.push({ url: u, auth: init?.headers?.['authorization'] });
      return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const r = await get(url('index.min.json'), { dataset: DATASET, env: { HF_TOKEN: 'hf_secrettokenvalue' }, fetch: f });
    expect(r.status).toBe(200);
    expect(seen[0]).toEqual({ url: `https://huggingface.co/datasets/${DATASET}/resolve/${REV}/index.min.json`, auth: 'Bearer hf_secrettokenvalue' });
    expect(JSON.stringify(r.headers) + r.body.toString()).not.toContain('secrettokenvalue');
    const denied = await get(url('index.min.json'), { dataset: DATASET, env: {}, fetch: (async () => new Response('', { status: 401 })) as unknown as typeof fetch });
    expect(denied.status).toBe(404);
    const down = await get(url('index.min.json'), { dataset: DATASET, env: {}, fetch: (async () => { throw new Error('boom'); }) as unknown as typeof fetch });
    expect(down.status).toBe(502);
  });
});
