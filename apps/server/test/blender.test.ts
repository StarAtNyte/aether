import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BLENDER_MCP_TOOLS } from '@aether/agent/blender';
import { BlenderService, LocalAi, type BlenderMcpSession } from '@aether/bridge';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupDirs, makeApp, makeConfig } from './helpers';

const dirs: string[] = [];
const services: LocalAi[] = [];
afterEach(() => {
  for (const s of services.splice(0)) s.dispose();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  cleanupDirs();
});

function setup(o: { loopback?: boolean; secret?: string } = {}): { app: ReturnType<typeof makeApp>; calls: string[] } {
  const dataDir = mkdtempSync(join(tmpdir(), 'aether-blender-route-'));
  dirs.push(dataDir);
  const calls: string[] = [];
  const session: BlenderMcpSession = {
    listTools: async () => [...BLENDER_MCP_TOOLS],
    callTool: async (name, args) => {
      calls.push(name);
      const out = /^out = (".*")$/m.exec(String(args['code'] ?? ''))?.[1];
      if (out) {
        writeFileSync(JSON.parse(out) as string, 'glTF-bytes');
        return { text: `Code executed successfully: AETHER_RESULT {"path": ${out}}`, images: [], isError: false };
      }
      return { text: name === 'execute_blender_code' ? 'Code executed successfully: 42' : 'Cube', images: [], isError: false };
    },
    close: async () => undefined,
  };
  const blender = new BlenderService({ dataDir: join(dataDir, 'blender'), ttlMs: 0, detect: () => ({ blender: '/b', addon: '/a', uvx: '/u' }), probeSocket: async () => true, connect: async () => session });
  const local = new LocalAi({ dataDir, commands: { codex: null, claude: null }, blender, probe: async () => [] });
  services.push(local);
  const config = makeConfig({ AETHER_LOCAL_AI: 'on' });
  const app = makeApp(o.secret ? { ...config, local: { ...config.local, sessionSecret: o.secret } } : config, { local, isLoopback: () => o.loopback ?? true });
  return { app, calls };
}

const host = { host: 'localhost:8787' };
const post = (body: unknown, extra: Record<string, string> = {}): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json', ...host, ...extra }, body: JSON.stringify(body) });

describe('/api/local/blender', () => {
  it('is off by default, reported on the local status, and switched on by the settings route', async () => {
    const { app, calls } = setup();
    expect(await (await app.request('/api/local/blender/status', { headers: host })).json()).toMatchObject({ state: 'off', enabled: false });
    expect(await (await app.request('/api/local/status', { headers: host })).json()).toMatchObject({ blender: 'off' });
    expect((await app.request('/api/local/blender/plan', post({ action: 'get_scene_info', input: {} }))).status).toBe(503);
    const on = await app.request('/api/local/blender/settings', post({ enabled: true }));
    expect(await on.json()).toMatchObject({ state: 'ready', enabled: true });
    expect(await (await app.request('/api/local/status', { headers: host })).json()).toMatchObject({ blender: 'ready' });
    expect(calls).toEqual([]);
  });

  it('refuses Python actions without the confirmation flag', async () => {
    const { app, calls } = setup();
    await app.request('/api/local/blender/settings', post({ enabled: true }));
    const plan = (await (await app.request('/api/local/blender/plan', post({ action: 'execute_blender_code', input: { code: 'print(42)' } }))).json()) as { planId: string; code: string; python: boolean };
    expect(plan).toMatchObject({ python: true, code: 'print(42)' });
    const refused = await app.request('/api/local/blender/run', post({ planId: plan.planId }));
    expect(refused.status).toBe(428);
    expect(await refused.json()).toMatchObject({ error: { code: 'confirmation_required' } });
    expect(calls).toEqual([]);
    // A confirmation flag inside the action input is not a confirmation: inputs are strict.
    expect((await app.request('/api/local/blender/plan', post({ action: 'execute_blender_code', input: { code: 'x', confirm: true } }))).status).toBe(400);
    expect((await app.request('/api/local/blender/run', post({ planId: plan.planId, confirm: 'yes' }))).status).toBe(400);
    const ok = await app.request('/api/local/blender/run', post({ planId: plan.planId, confirm: true }));
    expect(await ok.json()).toEqual({ text: '42' });
    expect(calls).toEqual(['execute_blender_code']);
  });

  it('returns exported GLB bytes', async () => {
    const { app } = setup();
    await app.request('/api/local/blender/settings', post({ enabled: true }));
    const plan = (await (await app.request('/api/local/blender/plan', post({ action: 'export_glb', input: {} }))).json()) as { planId: string };
    const res = await app.request('/api/local/blender/run', post({ planId: plan.planId, confirm: true }));
    expect(res.headers.get('content-type')).toBe('model/gltf-binary');
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('glTF-bytes');
  });

  it('answers only loopback requests with the session secret, and refuses proxied ones', async () => {
    const remote = setup({ loopback: false });
    expect((await remote.app.request('/api/local/blender/settings', post({ enabled: true }))).status).toBe(403);
    const proxied = setup();
    expect((await proxied.app.request('/api/local/blender/status', { headers: { ...host, 'x-forwarded-for': '1.2.3.4' } })).status).toBe(403);
    expect((await proxied.app.request('/api/local/blender/status', { headers: { host: 'example.com' } })).status).toBe(403);
    const locked = setup({ secret: 's'.repeat(43) });
    expect((await locked.app.request('/api/local/blender/status', { headers: host })).status).toBe(401);
  });
});
