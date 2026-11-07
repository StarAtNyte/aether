import { describe, expect, it } from 'vitest';
import { createBlenderApi, createBlenderToolRunner, runBlenderAction, type BlenderHostDeps } from '@aether/agent/blender';
import { AiConnection } from '../src/ai/connection';
import { BlenderGate, SESSION_KEY, type GateChoice, type GateRequest } from '../src/blender/gate';
import { blenderReady, blenderToolsFor } from '../src/blender/available';

function mem(): Storage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, length: 0, clear: () => map.clear(), key: () => null, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) } as Storage & { map: Map<string, string> };
}

const PLAN_ID = '0b6c1a9e-7d3f-4c21-9a55-1f0e2d3c4b5a';
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fake local server: records every request body; runs refuse Python without confirm like the real one. */
function fakeServer(): { fetch: typeof fetch; requests: Array<{ url: string; body: unknown }> } {
  const requests: Array<{ url: string; body: unknown }> = [];
  const f = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    requests.push({ url, body });
    if (url.endsWith('/plan')) return json({ planId: PLAN_ID, action: 'execute_blender_code', python: true, code: 'print(1)', expiresAt: 1 });
    if (url.endsWith('/run')) return (body as { confirm?: boolean }).confirm === true ? json({ text: '1' }) : json({ error: { code: 'confirmation_required', message: 'confirm' } }, 428);
    throw new TypeError('fetch failed');
  }) as typeof fetch;
  return { fetch: f, requests };
}

describe('Blender confirmation gate (studio)', () => {
  it('allow once asks every time; nothing is remembered', async () => {
    const asked: GateRequest[] = [];
    const session = mem();
    const gate = new BlenderGate(async (r) => (asked.push(r), 'once'), session);
    expect(await gate.confirm({ action: 'execute_blender_code', code: 'a' })).toBe(true);
    expect(await gate.confirm({ action: 'execute_blender_code', code: 'b' })).toBe(true);
    expect(asked.map((r) => r.code)).toEqual(['a', 'b']);
    expect(session.map.size).toBe(0);
  });

  it('allow for this session stops asking for that action only, kept in sessionStorage', async () => {
    let n = 0;
    const session = mem();
    const gate = new BlenderGate(async () => (n++, 'session'), session);
    expect(await gate.confirm({ action: 'render', code: 'r' })).toBe(true);
    expect(await gate.confirm({ action: 'render', code: 'r2' })).toBe(true);
    expect(n).toBe(1);
    expect(JSON.parse(session.map.get(SESSION_KEY) ?? '[]')).toEqual(['render']);
    expect(gate.allowedForSession('execute_blender_code')).toBe(false);
    // A new page in the same tab session remembers; reset forgets.
    const again = new BlenderGate(async () => 'cancel', session);
    expect(await again.confirm({ action: 'render', code: 'r3' })).toBe(true);
    again.reset();
    expect(await again.confirm({ action: 'render', code: 'r4' })).toBe(false);
  });

  it('cancel declines, and the server is never asked to run with confirm', async () => {
    const server = fakeServer();
    const choices: GateChoice[] = ['cancel'];
    const gate = new BlenderGate(async () => choices.shift() ?? 'cancel', mem());
    const deps: BlenderHostDeps = { api: createBlenderApi({ fetch: server.fetch }), confirm: (r) => gate.confirm(r), importGlb: async () => ({ ok: false, error: 'unused' }) };
    const out = await runBlenderAction(deps, { action: 'execute_blender_code', input: { code: 'print(1)' } });
    expect(out).toMatchObject({ ok: false, declined: true });
    expect(server.requests.map((r) => r.url)).toEqual(['/api/local/blender/plan']);
  });

  it('only the gate sets confirm: the agent cannot pass it through its tool input', async () => {
    const server = fakeServer();
    const confirms: string[] = [];
    const runner = createBlenderToolRunner({ api: createBlenderApi({ fetch: server.fetch }), confirm: async (r) => (confirms.push(r.code), true), importGlb: async () => ({ ok: false, error: 'unused' }) });
    const sneaky = await runner.run('blender_python', { code: 'print(1)', confirm: true });
    expect(sneaky.isError).toBe(true);
    expect(server.requests).toEqual([]);
    const ok = await runner.run('blender_python', { code: 'print(1)' });
    expect(ok).toEqual({ text: '1' });
    expect(confirms).toEqual(['print(1)']);
    expect(server.requests.map((r) => r.body)).toEqual([{ action: 'execute_blender_code', input: { code: 'print(1)' } }, { planId: PLAN_ID, confirm: true }]);
  });
});

describe('Blender on a hosted page', () => {
  it('never calls the local server: no tools, no status, no Blender requests', async () => {
    const urls: string[] = [];
    const spy = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      if (String(input).endsWith('/api/health')) return json({ ok: true, mode: 'mock', providers: [], byok: false, local: false });
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const session = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
    const ai = new AiConnection({ fetch: spy, session });
    await ai.refresh();
    const state = ai.store.getState();
    expect(state.local.state).toBe('off');
    expect(blenderReady(state)).toBe(false);
    expect(await blenderToolsFor(state, { importGlb: async () => ({ ok: false, error: 'x' }) })).toBeNull();
    expect(urls.filter((u) => u.includes('/api/local'))).toEqual([]);
  });

  it('offers the tools only when the local server reports Blender ready', async () => {
    const assets = { importGlb: async () => ({ ok: false as const, error: 'x' }) };
    const base = { server: { state: 'mock' as const, providers: [], byok: false, local: true }, local: { state: 'ready' as const, detail: '', backends: [], account: null, jobs: 0, login: null } };
    expect(await blenderToolsFor({ ...base, local: { ...base.local, blender: 'off' } }, assets)).toBeNull();
    expect(await blenderToolsFor({ ...base, local: { ...base.local, blender: 'not_installed' } }, assets)).toBeNull();
    const tools = await blenderToolsFor({ ...base, local: { ...base.local, blender: 'ready' } }, assets);
    expect(tools?.tools.map((t) => t.name)).toEqual(['blender_scene_info', 'blender_look', 'blender_python', 'blender_export_asset', 'blender_render', 'blender_bake', 'character_create', 'character_revise', 'character_review']);
  });
});
