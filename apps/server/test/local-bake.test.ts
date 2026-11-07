import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalAi } from '@aether/bridge';
import { afterEach, describe, expect, it } from 'vitest';
import type { LocalBaker } from '../src/local-bake';
import { makeApp, makeConfig } from './helpers';

const dirs: string[] = [];
const services: LocalAi[] = [];
afterEach(() => {
  for (const s of services.splice(0)) s.dispose();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup(baker: LocalBaker | null, loopback = true): ReturnType<typeof makeApp> {
  const dataDir = mkdtempSync(join(tmpdir(), 'aether-local-bake-'));
  dirs.push(dataDir);
  const local = new LocalAi({ dataDir, commands: { codex: null, claude: null }, probe: async () => [] });
  services.push(local);
  return makeApp(makeConfig({ AETHER_LOCAL_AI: 'on' }), { local, isLoopback: () => loopback, localBaker: baker });
}

const host = { host: 'localhost:8787' };
const job = (n: number): RequestInit => ({ method: 'POST', headers: { ...host, 'content-type': 'application/octet-stream', 'content-length': String(n) }, body: new Uint8Array(n) });

describe('/api/local/bake', () => {
  it('reports the bakers and bakes a job into its .lmap', async () => {
    const jobs: number[] = [];
    const app = setup({ bakers: ['cpu-threads'], bake: async (j) => (jobs.push(j.byteLength), { bytes: new Uint8Array([1, 2, 3]), baker: 'node-cpu-12' }) });
    expect(await (await app.request('/api/local/bake/status', { headers: host })).json()).toEqual({ available: true, bakers: ['cpu-threads'] });
    const res = await app.request('/api/local/bake/lightmap', job(64));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-aether-baker')).toBe('node-cpu-12');
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([1, 2, 3]);
    expect(jobs).toEqual([64]);
  });

  it('answers without a baker, to a failed bake and to an empty job, and only to this computer', async () => {
    const none = setup(null);
    expect(await (await none.request('/api/local/bake/status', { headers: host })).json()).toEqual({ available: false, bakers: [] });
    expect((await none.request('/api/local/bake/lightmap', job(64))).status).toBe(404);
    const failing = setup({ bakers: ['cpu-threads'], bake: async () => null });
    expect((await failing.request('/api/local/bake/lightmap', job(64))).status).toBe(502);
    expect((await failing.request('/api/local/bake/lightmap', { method: 'POST', headers: { ...host, 'content-length': '0' } })).status).toBe(413);
    expect((await setup({ bakers: [], bake: async () => null }, false).request('/api/local/bake/status', { headers: host })).status).toBe(403);
  });
});
