import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BLENDER_MCP_TOOLS } from '@aether/agent/blender';
import { allowedMcpTool, bakeCode, BlenderService, BridgeError, detectBlender, exportGlbCode, mcpEnv, parseBlenderResult, type BlenderInstall, type BlenderMcpSession } from '../src/index';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'aether-blender-'));
  dirs.push(d);
  return d;
}

const FOUND: BlenderInstall = { blender: '/x/blender', addon: '/x/mcp_for_blender.py', uvx: '/x/uvx' };

/** A fake MCP session: records calls; Python writes the file named in the code, like Blender would. */
function fakeSession(): BlenderMcpSession & { calls: Array<{ name: string; args: Record<string, unknown> }>; closed: number } {
  const s = {
    calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
    closed: 0,
    async listTools() {
      return [...BLENDER_MCP_TOOLS, 'search_assets', 'generate_3d'];
    },
    async callTool(name: string, args: Record<string, unknown>) {
      s.calls.push({ name, args });
      if (name === 'execute_blender_code') {
        const code = String(args['code']);
        const out = /^out = (".*")$/m.exec(code)?.[1] ?? /filepath = (".*")$/m.exec(code)?.[1] ?? /filepath_raw = (".*")$/m.exec(code)?.[1];
        if (out) {
          const path = JSON.parse(out) as string;
          writeFileSync(path, code.includes("export_format='GLB'") ? Buffer.from('glTF-fake') : Buffer.from([0x89, 0x50, 0x4e, 0x47]));
          return { text: `Code executed successfully: AETHER_RESULT ${JSON.stringify({ path, image: 'img' })}\n`, images: [], isError: false };
        }
        return { text: 'Code executed successfully: hello\n', images: [], isError: false };
      }
      if (name === 'look') return { text: 'viewport', images: [{ data: 'iVBORw0KGgo=', mimeType: 'image/png' }], isError: false };
      return { text: 'Cube at (0, 0, 0)', images: [], isError: false };
    },
    async close() {
      s.closed++;
    },
  };
  return s;
}

function service(o: { install?: BlenderInstall; listening?: boolean; session?: BlenderMcpSession; dir?: string } = {}): { svc: BlenderService; connects: number[] } {
  const connects: number[] = [];
  const svc = new BlenderService({
    dataDir: o.dir ?? tmp(),
    ttlMs: 0,
    detect: () => o.install ?? FOUND,
    probeSocket: async () => o.listening ?? true,
    connect: async (_i, port) => {
      connects.push(port);
      return o.session ?? fakeSession();
    },
  });
  return { svc, connects };
}

describe('Blender status', () => {
  it('is not_installed when Blender, the add-on or uvx is missing', async () => {
    for (const install of [{ ...FOUND, blender: null }, { ...FOUND, addon: null }, { ...FOUND, uvx: null }]) {
      const { svc, connects } = service({ install });
      const st = await svc.status();
      expect(st.state).toBe('not_installed');
      expect(connects).toEqual([]);
    }
  });

  it('is off by default and never starts the MCP server while off', async () => {
    const { svc, connects } = service();
    expect(await svc.status()).toMatchObject({ state: 'off', enabled: false });
    expect(connects).toEqual([]);
    await expect(svc.plan({ action: 'get_scene_info', input: {} })).rejects.toMatchObject({ code: 'blender_unavailable' });
  });

  it('is off when Blender is not listening, ready when connected; the switch persists', async () => {
    const dir = tmp();
    const down = service({ dir, listening: false });
    expect(await down.svc.setEnabled(true)).toMatchObject({ state: 'off', enabled: true });
    expect(down.connects).toEqual([]);
    expect(JSON.parse(readFileSync(join(dir, 'blender.json'), 'utf8'))).toEqual({ enabled: true });
    const up = service({ dir });
    expect(await up.svc.status()).toMatchObject({ state: 'ready', enabled: true });
    expect(await up.svc.state()).toBe('ready');
    expect(up.connects).toEqual([9876]);
    const s = await up.svc.setEnabled(false);
    expect(s).toMatchObject({ state: 'off', enabled: false });
  });

  it('is off when the MCP server lacks a required tool or fails to start', async () => {
    const lacking = { ...fakeSession(), listTools: async () => ['get_scene_info'] };
    const a = service({ session: lacking });
    await a.svc.setEnabled(true);
    expect((await a.svc.status()).state).toBe('off');
    const b = new BlenderService({ dataDir: tmp(), ttlMs: 0, detect: () => FOUND, probeSocket: async () => true, connect: async () => Promise.reject(new Error('spawn uvx ENOENT')) });
    expect(await b.setEnabled(true)).toMatchObject({ state: 'off' });
  });
});

describe('Blender confirmation gate (server)', () => {
  it('refuses Python actions without confirm and runs them with it', async () => {
    const session = fakeSession();
    const { svc } = service({ session });
    await svc.setEnabled(true);
    const plan = await svc.plan({ action: 'execute_blender_code', input: { code: 'print("hello")' } });
    expect(plan).toMatchObject({ python: true, code: 'print("hello")' });
    await expect(svc.run(plan.planId, false)).rejects.toMatchObject({ code: 'confirmation_required', status: 428 });
    expect(session.calls).toEqual([]);
    const out = await svc.run(plan.planId, true);
    expect(out).toEqual({ kind: 'json', result: { text: 'hello\n' } });
    expect(session.calls).toEqual([{ name: 'execute_blender_code', args: { code: 'print("hello")' } }]);
    // Plans are single use.
    await expect(svc.run(plan.planId, true)).rejects.toBeInstanceOf(BridgeError);
  });

  it('runs reads without confirmation, with the image', async () => {
    const session = fakeSession();
    const { svc } = service({ session });
    await svc.setEnabled(true);
    const info = await svc.plan({ action: 'get_scene_info', input: { limit: 5 } });
    expect(info.python).toBe(false);
    expect(info.code).toBeUndefined();
    expect(await svc.run(info.planId, false)).toEqual({ kind: 'json', result: { text: 'Cube at (0, 0, 0)' } });
    const look = await svc.plan({ action: 'look', input: {} });
    const r = await svc.run(look.planId, false);
    expect(r.kind === 'json' && r.result.image).toBe('data:image/png;base64,iVBORw0KGgo=');
  });

  it('exports a GLB from the template and removes the temp file', async () => {
    const dir = tmp();
    const { svc } = service({ dir });
    await svc.setEnabled(true);
    const plan = await svc.plan({ action: 'export_glb', input: { selection_only: true } });
    expect(plan.python).toBe(true);
    expect(plan.code).toContain("export_format='GLB'");
    expect(plan.code).toContain('use_selection=True');
    expect(plan.code).toContain(JSON.stringify(join(dir, 'out')).slice(0, -1));
    await expect(svc.run(plan.planId, false)).rejects.toMatchObject({ code: 'confirmation_required' });
    const out = await svc.run(plan.planId, true);
    expect(out.kind).toBe('glb');
    expect(out.kind === 'glb' && Buffer.from(out.bytes).toString()).toBe('glTF-fake');
    expect(() => readFileSync(join(dir, 'out', `${plan.planId}.glb`))).toThrow();
  });

  it('runs render and bake templates as Python', async () => {
    const { svc } = service();
    await svc.setEnabled(true);
    for (const req of [{ action: 'render' as const, input: { width: 320, height: 200, samples: 4 } }, { action: 'bake' as const, input: { object: 'Cube', type: 'AO' as const, size: 256 } }]) {
      const plan = await svc.plan(req);
      expect(plan.python).toBe(true);
      await expect(svc.run(plan.planId, false)).rejects.toMatchObject({ code: 'confirmation_required' });
      const out = await svc.run(plan.planId, true);
      expect(out.kind === 'json' && out.result.image?.startsWith('data:image/png;base64,')).toBe(true);
    }
  });
});

describe('Blender MCP and templates', () => {
  it('allows only the three tools and keeps telemetry off on loopback', () => {
    expect(BLENDER_MCP_TOOLS.every(allowedMcpTool)).toBe(true);
    for (const t of ['search_assets', 'import_asset', 'generate_3d', 'record_trajectory_feedback', 'disable_telemetry', 'get_addon_status']) expect(allowedMcpTool(t)).toBe(false);
    const env = mcpEnv(9876, { PATH: '/bin', HOME: '/h' });
    expect(env).toMatchObject({ BLENDER_HOST: '127.0.0.1', BLENDER_PORT: '9876', DISABLE_TELEMETRY: 'true', BLENDER_MCP_DISABLE_TELEMETRY: 'true', PATH: '/bin' });
  });

  it('inserts inputs as literals only', () => {
    const name = 'Cube")\nimport os\nos.system("x';
    const code = bakeCode('/d/out/a.png', { object: name });
    expect(code).toContain(JSON.stringify(name));
    expect(code.split('\n').some((l) => l.startsWith('import os'))).toBe(false);
    expect(exportGlbCode('/d/o.glb', {})).toContain('use_selection=False');
    expect(parseBlenderResult('Code executed successfully: x\nAETHER_RESULT {"path":"/a"}\n')).toEqual({ path: '/a' });
    expect(parseBlenderResult('Error executing code')).toBeNull();
  });

  it('finds Blender, the add-on and uvx from env and the user config', () => {
    const home = tmp();
    const bin = join(home, 'bin');
    mkdirSync(bin);
    for (const f of ['blender', 'uvx']) {
      writeFileSync(join(bin, f), '#!/bin/sh\n');
      chmodSync(join(bin, f), 0o755);
    }
    const env = { PATH: bin };
    expect(detectBlender({ env, home, platform: 'linux' })).toEqual({ blender: join(bin, 'blender'), addon: null, uvx: join(bin, 'uvx') });
    const addons = join(home, '.config', 'blender', '4.2', 'scripts', 'addons');
    mkdirSync(addons, { recursive: true });
    writeFileSync(join(addons, 'mcp_for_blender.py'), '');
    expect(detectBlender({ env, home, platform: 'linux' }).addon).toBe(join(addons, 'mcp_for_blender.py'));
    // Machine-wide folders (/usr/bin, /opt) may hold a Blender; the temp home's tools never do.
    const bare = detectBlender({ env: { PATH: '' }, home, platform: 'linux' });
    expect(bare.uvx).toBeNull();
    expect(bare.blender).not.toBe(join(bin, 'blender'));
    expect(detectBlender({ env: { PATH: '', AETHER_BLENDER: join(bin, 'blender') }, home, platform: 'linux' }).blender).toBe(join(bin, 'blender'));
  });
});
