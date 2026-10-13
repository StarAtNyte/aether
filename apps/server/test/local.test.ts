import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GENERATOR_EXAMPLES } from '@aether/procgen';
import { JobManager, LocalAi, type WorkerRunner } from '@aether/bridge';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigError, hostedPlatform, loadConfig } from '../src/config';
import { cleanupDirs, makeApp, makeConfig } from './helpers';

const LIGHTHOUSE = GENERATOR_EXAMPLES[0]?.def;
const dirs: string[] = [];
const services: LocalAi[] = [];
afterEach(() => {
  for (const s of services.splice(0)) s.dispose();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  cleanupDirs();
});

const finishReply = JSON.stringify({ tool_calls: [{ name: 'finish', input: { message: 'done' } }] });

function setup(run?: WorkerRunner): { app: ReturnType<typeof makeApp>; calls: Array<Parameters<WorkerRunner>[0]>; local: LocalAi } {
  const dataDir = mkdtempSync(join(tmpdir(), 'aether-local-test-'));
  dirs.push(dataDir);
  const calls: Array<Parameters<WorkerRunner>[0]> = [];
  const runWorker: WorkerRunner =
    run ??
    (async (job) => {
      calls.push(job);
      return { ok: true, kind: 'complete', text: finishReply, model: 'gpt-6.1-sol', usage: { inputTokens: 3, outputTokens: 4 } };
    });
  const jobs = new JobManager({
    dir: join(dataDir, 'jobs'),
    runWorker: async (job, o) => {
      calls.push(job);
      o.onProgress?.({ phase: 'write', message: 'Writing generator.json…' });
      if (job.kind !== 'agentic') throw new Error('unexpected');
      const { writeFile } = await import('node:fs/promises');
      await writeFile(join(job.workspace, job.artifact), JSON.stringify(LIGHTHOUSE));
      return { ok: true, kind: 'agentic', turns: 1, passed: true };
    },
    createWorkspace: async () => {
      const ws = mkdtempSync(join(dataDir, 'ws-'));
      const { mkdirSync } = await import('node:fs');
      mkdirSync(join(ws, 'out'));
      return { dir: ws, task: 't', artifact: 'out/generator.json' };
    },
    validate: async () => null,
  });
  const local = new LocalAi({
    dataDir,
    commands: { codex: null, claude: null },
    runWorker,
    jobs,
    probe: async () => [{ id: 'codex', label: 'Codex', installed: true, loggedIn: true, detail: 'Logged in using ChatGPT', models: [{ id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol' }] }],
  });
  services.push(local);
  const app = makeApp(makeConfig({ AETHER_LOCAL_AI: 'on' }), { local, isLoopback: () => true });
  return { app, calls, local };
}

const host = { host: 'localhost:8787' };
const post = (body: unknown, extra: Record<string, string> = {}): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json', ...host, ...extra }, body: JSON.stringify(body) });

describe('local AI configuration', () => {
  it('is on by default only for a local development server', () => {
    expect(loadConfig({}).localAi).toBe(true);
    expect(loadConfig({ NODE_ENV: 'production' }).localAi).toBe(false);
    expect(loadConfig({ VERCEL: '1' }).localAi).toBe(false);
    expect(loadConfig({ AETHER_HOSTED: '1' }).localAi).toBe(false);
    expect(loadConfig({ AETHER_LOCAL_AI: 'off' }).localAi).toBe(false);
    expect(() => loadConfig({ AETHER_LOCAL_AI: 'on', FLY_APP_NAME: 'x' })).toThrow(ConfigError);
    expect(hostedPlatform({ RENDER: 'true' })).toBe('RENDER');
    expect(hostedPlatform({ AETHER_HOSTED: '0' })).toBeNull();
  });

  it('does not serve /api/local when off', async () => {
    const app = makeApp(makeConfig({ AETHER_LOCAL_AI: 'off' }));
    expect((await (await app.request('/api/health')).json()) as { local: boolean }).toMatchObject({ local: false });
    expect((await app.request('/api/local/status', { headers: host })).status).toBe(404);
  });
});

describe('/api/local guard', () => {
  it('answers only direct requests from this machine', async () => {
    const { app } = setup();
    expect((await (await app.request('/api/health')).json()) as { local: boolean }).toMatchObject({ local: true });
    expect((await app.request('/api/local/status', { headers: host })).status).toBe(200);
    for (const h of ['x-forwarded-for', 'x-real-ip', 'forwarded']) {
      const r = await app.request('/api/local/status', { headers: { ...host, [h]: '127.0.0.1' } });
      expect(r.status).toBe(403);
      expect(await r.json()).toMatchObject({ error: { code: 'forbidden_host' } });
    }
    expect((await app.request('/api/local/status', { headers: { host: 'evil.example' } })).status).toBe(403);
    const remote = makeApp(makeConfig({ AETHER_LOCAL_AI: 'on' }), { local: setup().local, isLoopback: () => false });
    expect((await remote.request('/api/local/status', { headers: host })).status).toBe(403);
  });

  it('rejects cross-origin writes', async () => {
    const { app } = setup();
    const r = await app.request('/api/local/login', post({ backend: 'codex' }, { origin: 'https://evil.example' }));
    expect(r.status).toBe(403);
  });
});

describe('/api/local endpoints', () => {
  it('reports status', async () => {
    const { app } = setup();
    const st = (await (await app.request('/api/local/status', { headers: host })).json()) as { name: string; backends: Array<{ id: string; busy: number }> };
    expect(st.name).toBe('aether-local');
    expect(st.backends[0]).toMatchObject({ id: 'codex', busy: 0 });
  });

  it('completes through a worker with the project session', async () => {
    const { app, calls } = setup();
    const body = { backend: 'codex', model: 'gpt-6.1-sol', effort: 'low', request: { role: 'planner', system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [{ name: 'finish', description: 'd', inputSchema: { type: 'object' } }], session: 'p-abcdefgh1', model: 'evil --flag' } };
    const r = await app.request('/api/local/complete', post(body));
    expect(r.status).toBe(200);
    const out = (await r.json()) as { content: Array<{ type: string; name?: string }>; model?: string };
    expect(out.content.some((c) => c.type === 'tool_use' && c.name === 'finish')).toBe(true);
    const job = calls[0];
    expect(job?.kind).toBe('complete');
    if (job?.kind === 'complete') {
      expect(job.request.model).toBe('gpt-6.1-sol');
      expect(job.request.session?.key).toBe('p-abcdefgh1');
    }
    const bad = await app.request('/api/local/complete', post({ backend: 'codex', model: '--yolo', request: body.request }));
    expect(bad.status).toBe(400);
  });

  it('maps worker failures to bridge errors', async () => {
    const { BridgeError } = await import('@aether/bridge');
    const { app } = setup(async () => {
      throw new BridgeError('not_logged_in', 'Codex is not signed in.');
    });
    const r = await app.request('/api/local/complete', post({ backend: 'codex', request: { role: 'planner', system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [] } }));
    expect(r.status).toBe(424);
    expect(await r.json()).toEqual({ error: { code: 'not_logged_in', message: 'Codex is not signed in.' } });
  });

  it('clears a project\'s sessions and validates the key', async () => {
    const { app, local } = setup();
    local.sessions.record('p-abcdefgh1', 'codex', undefined, { id: 't', systemHash: 'a'.repeat(64), body: 'b' });
    expect(await (await app.request('/api/local/sessions/p-abcdefgh1', { method: 'DELETE', headers: host })).json()).toEqual({ cleared: 1 });
    expect((await app.request('/api/local/sessions/NOPE', { method: 'DELETE', headers: host })).status).toBe(400);
  });

  it('runs a deep build and streams its progress over SSE with a resumable cursor', async () => {
    const { app } = setup();
    const r = await app.request('/api/local/jobs', post({ kind: 'asset', backend: 'codex', spec: { id: 'tower', description: 'a lighthouse' }, budget: { turns: 2, minutes: 2 } }));
    expect(r.status).toBe(200);
    const job = (await r.json()) as { id: string; status: string };
    const stream = await app.request(`/api/local/jobs/${job.id}/events?after=0`, { headers: host });
    expect(stream.headers.get('content-type')).toContain('text/event-stream');
    const text = await stream.text();
    expect(text).toContain('event: progress');
    expect(text).toContain('Writing generator.json');
    expect(text).toContain('event: end');
    const end = text.split('\n\n').find((b) => b.startsWith('event: end'));
    const done = JSON.parse(end?.split('\ndata: ')[1] ?? 'null') as { status: string; result: { def: { id: string } } };
    expect(done.status).toBe('done');
    expect(done.result.def.id).toBe('tower');
    // Reconnect after the last event: only the end marker comes back.
    const ids = [...text.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
    const again = await (await app.request(`/api/local/jobs/${job.id}/events?after=${Math.max(...ids)}`, { headers: host })).text();
    expect(again).not.toContain('event: progress');
    expect(again).toContain('event: end');
    expect((await app.request('/api/local/jobs/not-a-job', { headers: host })).status).toBe(400);
    expect((await app.request('/api/local/jobs', post({ kind: 'asset', backend: 'codex', spec: { id: 'Bad Id', description: 'x' } }))).status).toBe(400);
  });

  it('lists accounts and refuses unknown ones', async () => {
    const { app } = setup();
    const list = (await (await app.request('/api/local/accounts', { headers: host })).json()) as { items: Array<{ id: string }>; activeId: string };
    expect(list.activeId).toBe('default');
    expect(list.items.map((a) => a.id)).toEqual(['default']);
    expect((await app.request('/api/local/accounts/../x/activate', post({}))).status).toBe(404);
    const unknown = await app.request('/api/local/accounts/0e0e0e0e-0e0e-0e0e-0e0e-0e0e0e0e0e0e/activate', post({}));
    expect(unknown.status).toBe(409);
  });
});
