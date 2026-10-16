import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ThreadEvent } from '@openai/codex-sdk';
import { GENERATOR_EXAMPLES } from '@aether/procgen';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CodexAccounts } from '../src/accounts';
import { LoginManager, parseLoginOutput, sanitizeOutput } from '../src/auth';
import { JobQueue } from '../src/queue';
import { SessionStore } from '../src/sessions';
import { LocalAi } from '../src/local';
import { claudeAgenticArgs, codexAgenticConfig, confinedNodeArgs, codexAgenticThread, insideWorkspace, observeAgenticClaude, readArtifact, runAgentic } from '../src/worker/agentic';
import { JobManager, validateInWorkspace } from '../src/worker/jobs';
import { parseProgressLine, PROGRESS_PREFIX, WorkerJob, type WorkerResult, type WorkerRunner } from '../src/worker/protocol';
import { runWorker, runningWorkers } from '../src/worker/runner';
import { createWorkerSessionStore, createWorkerTextBackend } from '../src/worker/text-backend';
import { assetTask, createAssetWorkspace, parseAssetArtifact, removeWorkspace } from '../src/worker/workspace';
import { fakeSpawn } from './helpers';

const LIGHTHOUSE = GENERATOR_EXAMPLES[0]?.def;
if (!LIGHTHOUSE) throw new Error('missing example');

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aether-worker-test-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const agenticJob = (over: Partial<Extract<WorkerJob, { kind: 'agentic' }>> = {}): Extract<WorkerJob, { kind: 'agentic' }> => ({
  kind: 'agentic',
  backend: 'codex',
  workspace: dir,
  task: 'build it',
  artifact: 'out/generator.json',
  maxTurns: 3,
  ...over,
});

async function* events(list: ThreadEvent[]): AsyncGenerator<ThreadEvent> {
  for (const e of list) yield e;
}

describe('worker protocol', () => {
  it('parses progress lines strictly', () => {
    expect(parseProgressLine(`${PROGRESS_PREFIX}{"phase":"check","message":"Running checks…"}`)).toEqual({ phase: 'check', message: 'Running checks…' });
    expect(parseProgressLine('AETHER_PROGRESS not json')).toBeNull();
    expect(parseProgressLine(`${PROGRESS_PREFIX}{"phase":"","message":"x"}`)).toBeNull();
    expect(parseProgressLine('random stderr')).toBeNull();
    expect(parseProgressLine(`${PROGRESS_PREFIX}${'x'.repeat(5000)}`)).toBeNull();
  });
  it('rejects artifacts outside out/ and too many turns', () => {
    expect(WorkerJob.safeParse(agenticJob({ artifact: '../etc/passwd' as never })).success).toBe(false);
    expect(WorkerJob.safeParse(agenticJob({ maxTurns: 99 })).success).toBe(false);
    expect(WorkerJob.safeParse(agenticJob()).success).toBe(true);
  });
});

describe('agentic lockdown', () => {
  it('keeps Codex in a network-less workspace sandbox without approvals or secrets', () => {
    const c = codexAgenticConfig() as Record<string, unknown>;
    expect(c['sandbox_mode']).toBe('workspace-write');
    expect(c['approval_policy']).toBe('never');
    expect(c['sandbox_workspace_write']).toEqual({ network_access: false });
    expect(c['shell_environment_policy']).toEqual({ inherit: 'core' });
    expect(c['web_search']).toBe('disabled');
    const features = c['features'] as Record<string, boolean>;
    expect(features['shell_tool']).toBeUndefined();
    expect(features['code_mode_host']).toBeUndefined();
    expect(Object.values(features).every((v) => v === false)).toBe(true);
    expect(c['skills']).toEqual({ include_instructions: false, bundled: { enabled: false } });
    const t = codexAgenticThread({ workspace: dir, model: 'gpt-6.1-sol', effort: 'high' });
    expect(t).toMatchObject({ sandboxMode: 'workspace-write', approvalPolicy: 'never', networkAccessEnabled: false, workingDirectory: dir, model: 'gpt-6.1-sol', modelReasoningEffort: 'high' });
  });
  it('restricts Claude Code to file tools and the checker', () => {
    const args = claudeAgenticArgs({}, '/tmp/sys.txt');
    expect(args).toContain('--restricted');
    expect(args).toContain('Bash(node check.mjs:*)');
    expect(args).toContain('Write(./out/**)');
    expect(args).not.toContain('Write');
    expect(args[args.indexOf('--tools') + 1]).toBe('Read,Write,Edit,Bash');
    expect(args.join(' ')).not.toMatch(/dangerously|bypassPermissions/);
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('dontAsk');
  });
  it('stops Claude runs that leave the workspace or run other commands', () => {
    const progress: string[] = [];
    const report = (_p: string, m: string): void => void progress.push(m);
    const tool = (name: string, input: Record<string, unknown>): string => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } });
    expect(observeAgenticClaude(tool('Bash', { command: 'curl https://x' }), dir, report)).toMatch(/shell command/);
    expect(observeAgenticClaude(tool('Bash', { command: 'node check.mjs out/generator.json && rm -rf ~' }), dir, report)).toMatch(/shell command/);
    expect(observeAgenticClaude(tool('Write', { file_path: '/etc/passwd' }), dir, report)).toMatch(/outside/);
    expect(observeAgenticClaude(tool('Write', { file_path: join(dir, '../x') }), dir, report)).toMatch(/outside/);
    expect(observeAgenticClaude(tool('Write', { file_path: join(dir, 'check.mjs') }), dir, report)).toMatch(/outside out/);
    expect(observeAgenticClaude(tool('Read', { file_path: join(dir, 'task.md') }), dir, report)).toBeUndefined();
    expect(observeAgenticClaude(tool('WebFetch', { url: 'x' }), dir, report)).toMatch(/tool call/);
    expect(observeAgenticClaude(JSON.stringify({ type: 'system', subtype: 'init', tools: ['Read', 'WebSearch'], mcp_servers: [] }), dir, report)).toMatch(/tools exposed/);
    expect(observeAgenticClaude(tool('Write', { file_path: join(dir, 'out/generator.json') }), dir, report)).toBeUndefined();
    expect(observeAgenticClaude(tool('Bash', { command: 'node check.mjs out/generator.json' }), dir, report)).toBeUndefined();
    expect(progress).toEqual(['Writing generator.json…', 'Running checks…']);
    expect(insideWorkspace(dir, 'out/a.json')).toBe(true);
    expect(insideWorkspace(dir, '../a.json')).toBe(false);
  });
});

describe('agentic loop (fake Codex SDK)', () => {
  it('iterates on one thread until the checker passes and streams progress', async () => {
    const progress: Array<[string, string]> = [];
    let threads = 0;
    const inputs: string[] = [];
    const createCodex = () => ({
      startThread: () => {
        threads++;
        return {
          runStreamed: async (input: string) => {
            inputs.push(input);
            return {
              events: events([
                { type: 'turn.started' },
                { type: 'item.started', item: { id: '1', type: 'reasoning', text: '' } },
                { type: 'item.completed', item: { id: '2', type: 'file_change', changes: [{ path: join(dir, 'out/generator.json'), kind: 'add' }], status: 'completed' } },
                { type: 'item.started', item: { id: '3', type: 'command_execution', command: 'node check.mjs out/generator.json', aggregated_output: '', status: 'in_progress' } },
                { type: 'item.completed', item: { id: '4', type: 'agent_message', text: 'Wrote the lighthouse.' } },
                { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 30 } },
              ] as ThreadEvent[]),
            };
          },
        };
      },
    });
    let checks = 0;
    const r = await runAgentic(agenticJob(), {
      env: {},
      progress: (p, m) => void progress.push([p, m]),
      createCodex,
      mcpServers: async () => [],
      check: async () => (++checks === 1 ? { passed: false, report: 'RESULT: FAIL\n- issue: the tower is too thin' } : { passed: true, report: 'RESULT: PASS' }),
    });
    expect(r).toMatchObject({ ok: true, kind: 'agentic', turns: 2, passed: true, usage: { inputTokens: 240, outputTokens: 60 }, message: 'Wrote the lighthouse.' });
    expect(threads).toBe(1);
    expect(inputs[1]).toContain('the tower is too thin');
    const messages = progress.map((p) => p[1]);
    expect(messages).toContain('Writing generator.json…');
    expect(messages).toContain('Running checks…');
    expect(messages).toContain('Checks failed: the tower is too thin');
    expect(messages).toContain('Checks passed');
  });

  it('stops a run that reaches for MCP tools or web search', async () => {
    const createCodex = () => ({
      startThread: () => ({
        runStreamed: async () => ({ events: events([{ type: 'item.started', item: { id: '1', type: 'web_search', query: 'x' } }] as ThreadEvent[]) }),
      }),
    });
    await expect(runAgentic(agenticJob(), { env: {}, progress: () => undefined, createCodex, mcpServers: async () => [], check: async () => ({ passed: true, report: '' }) })).rejects.toMatchObject({ code: 'tool_violation' });
  });

  it('refuses to run when MCP servers cannot be listed', async () => {
    const createCodex = () => ({ startThread: () => ({ runStreamed: async () => ({ events: events([]) }) }) });
    await expect(runAgentic(agenticJob(), { env: {}, progress: () => undefined, createCodex, mcpServers: async () => null })).rejects.toMatchObject({ code: 'tool_violation' });
  });

  it('stops after the turn budget when the checker keeps failing', async () => {
    const createCodex = () => ({ startThread: () => ({ runStreamed: async () => ({ events: events([{ type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } }] as ThreadEvent[]) }) }) });
    const r = await runAgentic(agenticJob({ maxTurns: 2 }), { env: {}, progress: () => undefined, createCodex, mcpServers: async () => [], check: async () => ({ passed: false, report: 'RESULT: FAIL' }) });
    expect(r).toMatchObject({ ok: true, turns: 2, passed: false });
  });
});

describe('workspace and artifact', () => {
  it('creates a private workspace with the API, examples, checker and task', async () => {
    const check = join(dir, 'check.mjs');
    await writeFile(check, '// checker');
    const ws = await createAssetWorkspace({ id: 'tower', description: 'a stone tower' }, { root: dir, checkScript: check });
    expect((await stat(ws.dir)).mode & 0o777).toBe(0o700);
    expect(await readFile(join(ws.dir, 'task.md'), 'utf8')).toContain('a stone tower');
    expect(await readFile(join(ws.dir, 'GENERATOR_API.d.ts'), 'utf8')).toContain('interface');
    expect((await stat(join(ws.dir, 'out'))).isDirectory()).toBe(true);
    expect(await readFile(join(ws.dir, 'check.mjs'), 'utf8')).toBe('// checker');
    expect((await stat(join(ws.dir, 'check.mjs'))).mode & 0o777).toBe(0o400);
    await removeWorkspace(ws.dir);
    await expect(stat(ws.dir)).rejects.toThrow();
    expect(assetTask({ id: 'x1', description: 'y' })).toContain('node check.mjs out/generator.json');
  });

  it('never follows links the agent planted', async () => {
    await mkdir(join(dir, 'out'));
    const secret = join(tmpdir(), `aether-secret-${process.pid}.txt`);
    await writeFile(secret, '{"secret":true}');
    try {
      await symlink(secret, join(dir, 'out/generator.json'));
      expect(await readArtifact(dir, 'out/generator.json')).toBeNull();
      expect(await readArtifact(dir, '../outside.json')).toBeNull();
    } finally {
      await rm(secret, { force: true });
    }
    await rm(join(dir, 'out/generator.json'));
    await writeFile(join(dir, 'out/generator.json'), '{"a":1}');
    expect(await readArtifact(dir, 'out/generator.json')).toBe('{"a":1}');
    await writeFile(join(dir, 'out/generator.json'), 'x'.repeat(200_000));
    expect(await readArtifact(dir, 'out/generator.json')).toBeNull();
  });

  it('parses the artifact strictly (schema, id, static screen)', () => {
    expect(parseAssetArtifact(null, 'tower')).toMatchObject({ ok: false });
    expect(parseAssetArtifact('{nope', 'tower')).toMatchObject({ ok: false, error: expect.stringContaining('not valid JSON') });
    const ok = parseAssetArtifact(JSON.stringify({ ...LIGHTHOUSE, id: 'whatever' }), 'tower');
    expect(ok.ok && ok.def.id).toBe('tower');
    const evil = parseAssetArtifact(JSON.stringify({ ...LIGHTHOUSE, source: 'eval("1"); return api.build();' }), 'tower');
    expect(evil).toMatchObject({ ok: false, error: expect.stringContaining('rejected') });
  });

  it('validates generators with the confined checker (pristine copy, no links followed)', async () => {
    await mkdir(join(dir, 'out'));
    expect(await validateInWorkspace(LIGHTHOUSE, dir)).toBeNull();
    expect(await validateInWorkspace({ ...LIGHTHOUSE, source: 'while (true) {}\nreturn api.build();' }, dir)).toMatch(/.+/);
    expect(await validateInWorkspace({ ...LIGHTHOUSE, source: 'return 1;' }, dir)).toMatch(/.+/);
  }, 60_000);

  it('confines the checker: no reads outside the workspace, no processes, writes only under out/', async () => {
    await mkdir(join(dir, 'out'));
    const script = join(dir, 'probe.mjs');
    await writeFile(script, "import fs from 'node:fs'; const r = []; for (const f of [() => fs.readFileSync('/etc/hostname'), () => fs.writeFileSync('x.txt', 'a'), () => fs.writeFileSync('out/ok.txt', 'a')]) { try { f(); r.push('ok'); } catch (e) { r.push(e.code); } } import('node:child_process').then((cp) => { try { cp.execSync('true'); r.push('ok'); } catch (e) { r.push(e.code); } console.log(r.join(',')); });");
    const { runProcess } = await import('../src/process');
    const r = await runProcess(process.execPath, [...confinedNodeArgs(dir, script), script], { cwd: dir, env: { PATH: process.env['PATH'] ?? '' }, timeoutMs: 20_000 });
    expect(r.stdout.trim()).toBe('ERR_ACCESS_DENIED,ERR_ACCESS_DENIED,ok,ERR_ACCESS_DENIED');
    expect(confinedNodeArgs('/w', '/c.mjs', '22.5.0')[0]).toBe('--experimental-permission');
    expect(confinedNodeArgs('/w', '/c.mjs', '24.1.0')[0]).toBe('--permission');
  }, 30_000);
});

describe('worker process runner', () => {
  const script = (body: string): { command: string; args: string[] } => ({ command: process.execPath, args: ['-e', body] });
  const job: WorkerJob = agenticJob();

  it('sends the job on stdin, relays progress and parses the result', async () => {
    const progress: string[] = [];
    const r = await runWorker(job, {
      timeoutMs: 10_000,
      onProgress: (p) => void progress.push(p.message),
      command: script(`let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);process.stderr.write('${PROGRESS_PREFIX}'+JSON.stringify({phase:'turn',message:'got '+j.kind})+'\\n');process.stderr.write('noise\\n');process.stdout.write(JSON.stringify({ok:true,kind:'agentic',turns:1,passed:true}))})`),
    });
    expect(r).toEqual({ ok: true, kind: 'agentic', turns: 1, passed: true });
    expect(progress).toEqual(['got agentic']);
    expect(runningWorkers()).toBe(0);
  });

  it('maps worker errors, crashes and invalid output', async () => {
    await expect(runWorker(job, { timeoutMs: 10_000, command: script(`process.stdout.write(JSON.stringify({ok:false,code:'not_logged_in',message:'Codex is not signed in.'}))`) })).rejects.toMatchObject({ code: 'not_logged_in' });
    await expect(runWorker(job, { timeoutMs: 10_000, command: script('process.exit(3)') })).rejects.toMatchObject({ message: 'The AI worker crashed.' });
    await expect(runWorker(job, { timeoutMs: 10_000, command: script(`process.stdout.write('{"ok":true,"kind":"weird"}')`) })).rejects.toMatchObject({ message: 'The AI worker returned an invalid result.' });
  });

  it('kills the whole process group on timeout and on cancel', async () => {
    const t0 = Date.now();
    await expect(runWorker(job, { timeoutMs: 1000, command: script('setInterval(()=>{},1000)') })).rejects.toMatchObject({ code: 'timeout' });
    expect(Date.now() - t0).toBeLessThan(6000);
    const ctrl = new AbortController();
    const p = runWorker(job, { timeoutMs: 30_000, signal: ctrl.signal, command: script('setInterval(()=>{},1000)') });
    setTimeout(() => ctrl.abort(), 200);
    await expect(p).rejects.toMatchObject({ message: 'cancelled' });
    expect(runningWorkers()).toBe(0);
  }, 15_000);

  it('passes only an allowlisted environment', async () => {
    let seen = '';
    await runWorker(job, {
      timeoutMs: 10_000,
      env: { PATH: process.env['PATH'] ?? '', OPENAI_API_KEY: 'sk-secret', HOME: '/home/x' },
      command: script(`process.stdout.write(JSON.stringify({ok:true,kind:'agentic',turns:0,passed:false,message:Object.keys(process.env).join(',')}))`),
    }).then((r) => {
      if (r.ok && r.kind === 'agentic') seen = r.message ?? '';
    });
    expect(seen).not.toContain('OPENAI_API_KEY');
    expect(seen).toContain('PATH');
  });
});

describe('durable build jobs', () => {
  const okRunner = (onJob?: (job: WorkerJob) => void, delayMs = 10): WorkerRunner => async (j, o) => {
    onJob?.(j);
    o.onProgress?.({ phase: 'write', message: 'Writing generator.json…' });
    await new Promise((r) => setTimeout(r, delayMs));
    if (o.signal?.aborted) throw new Error('cancelled');
    if (j.kind === 'agentic') await writeFile(join(j.workspace, j.artifact), JSON.stringify(LIGHTHOUSE));
    return { ok: true, kind: 'agentic', turns: 1, passed: true, usage: { inputTokens: 5, outputTokens: 6 } } satisfies WorkerResult;
  };
  const workspaces: string[] = [];
  const createWorkspace = async (): Promise<{ dir: string; task: string; artifact: string }> => {
    const ws = await mkdtemp(join(dir, 'ws-'));
    await mkdir(join(ws, 'out'));
    workspaces.push(ws);
    return { dir: ws, task: 'task', artifact: 'out/generator.json' };
  };
  const wait = async (m: JobManager, id: string): Promise<void> => {
    // Deadline-based (not iteration-based) so a loaded machine cannot fail it spuriously.
    const until = Date.now() + 10_000;
    while (Date.now() < until) {
      const s = m.get(id)?.status;
      if (s && s !== 'queued' && s !== 'running') return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('job did not finish');
  };

  it('runs one job at a time, freezes the account, persists events and removes the workspace', async () => {
    const seen: WorkerJob[] = [];
    let n = 0;
    const m = new JobManager({ dir: join(dir, 'jobs'), runWorker: okRunner((j) => seen.push(j), 40), createWorkspace, validate: async () => null, accountHome: async () => ({ id: 'default', home: `/homes/${n++}` }) });
    const a = await m.enqueueAsset({ kind: 'asset', backend: 'codex', model: 'gpt-6.1-sol', effort: 'high', spec: { id: 'tower', description: 'a tower' }, budget: { turns: 2, minutes: 3 } });
    const b = await m.enqueueAsset({ kind: 'asset', backend: 'codex', spec: { id: 'lamp', description: 'a lamp' }, budget: { turns: 1, minutes: 1 } });
    expect(m.activeCount()).toBe(2);
    expect(m.get(b.id)?.status).toBe('queued');
    await wait(m, a.id);
    await wait(m, b.id);
    const done = m.get(a.id);
    expect(done).toMatchObject({ status: 'done', model: 'gpt-6.1-sol', effort: 'high', result: { turns: 1, checkerPassed: true, usage: { inputTokens: 5, outputTokens: 6 } } });
    expect(done?.result?.def.id).toBe('tower');
    expect(seen.map((j) => (j.kind === 'agentic' ? [j.codexHome, j.maxTurns, j.model] : null))).toEqual([
      ['/homes/0', 2, 'gpt-6.1-sol'],
      ['/homes/1', 1, undefined],
    ]);
    for (const ws of workspaces) await expect(stat(ws)).rejects.toThrow();
    const evs = await m.eventsAfter(a.id, 0);
    expect(evs.map((e) => e.message)).toEqual(expect.arrayContaining(['Writing generator.json…', 'Finished']));
    expect(evs.map((e) => e.seq)).toEqual(evs.map((_, i) => i + 1));
    expect((await m.eventsAfter(a.id, evs.length - 1)).length).toBe(1);
    expect((await stat(join(dir, 'jobs', `${a.id}.json`))).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(JSON.parse(await readFile(join(dir, 'jobs', `${a.id}.json`), 'utf8')))).not.toContain('/homes/');
  });

  it('streams events to subscribers and ends with null', async () => {
    const m = new JobManager({ dir: join(dir, 'jobs'), runWorker: okRunner(undefined, 30), createWorkspace, validate: async () => null });
    const job = await m.enqueueAsset({ kind: 'asset', backend: 'claude-code', spec: { id: 'tower', description: 'x' } });
    const got: Array<string | null> = [];
    await new Promise<void>((resolve) => {
      m.subscribe(job.id, (e) => {
        got.push(e ? e.phase : null);
        if (!e) resolve();
      });
    });
    expect(got.at(-1)).toBeNull();
    expect(got).toContain('done');
  });

  it('rejects results that fail host validation and reports failures', async () => {
    const m = new JobManager({ dir: join(dir, 'jobs'), runWorker: okRunner(), createWorkspace, validate: async () => 'seed 1: too many triangles' });
    const job = await m.enqueueAsset({ kind: 'asset', backend: 'codex', spec: { id: 'tower', description: 'x' } });
    await wait(m, job.id);
    expect(m.get(job.id)).toMatchObject({ status: 'failed', error: expect.stringContaining('too many triangles') });
    expect(m.get(job.id)?.result).toBeUndefined();
  });

  it('cancels queued and running jobs', async () => {
    const m = new JobManager({ dir: join(dir, 'jobs'), runWorker: okRunner(undefined, 300), createWorkspace, validate: async () => null });
    const a = await m.enqueueAsset({ kind: 'asset', backend: 'codex', spec: { id: 'tower', description: 'x' } });
    const b = await m.enqueueAsset({ kind: 'asset', backend: 'codex', spec: { id: 'lamp', description: 'x' } });
    expect((await m.cancel(b.id))?.status).toBe('cancelled');
    await new Promise((r) => setTimeout(r, 30));
    await m.cancel(a.id);
    await wait(m, a.id);
    expect(m.get(a.id)?.status).toBe('cancelled');
    // The slot frees once the aborted runner settles; allow for a loaded machine.
    for (let i = 0; i < 500 && m.activeCount() > 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(m.activeCount()).toBe(0);
  });

  it('a cancel during workspace setup or validation wins over a finished run', async () => {
    let releaseWs: () => void = () => undefined;
    let wsStarted = false;
    const slowWorkspace = async (): Promise<{ dir: string; task: string; artifact: string }> => {
      wsStarted = true;
      await new Promise<void>((r) => (releaseWs = r));
      return createWorkspace();
    };
    let ran = 0;
    // A runner that ignores the abort signal entirely.
    const deaf: WorkerRunner = async (j) => {
      ran++;
      if (j.kind === 'agentic') await writeFile(join(j.workspace, j.artifact), JSON.stringify(LIGHTHOUSE));
      return { ok: true, kind: 'agentic', turns: 1, passed: true } satisfies WorkerResult;
    };
    const m1 = new JobManager({ dir: join(dir, 'jobs1'), runWorker: deaf, createWorkspace: slowWorkspace, validate: async () => null });
    const a = await m1.enqueueAsset({ kind: 'asset', backend: 'codex', spec: { id: 'tower', description: 'x' } });
    // Deadline-based so a loaded machine cannot cancel before the workspace step began.
    for (let i = 0; i < 1000 && !wsStarted; i++) await new Promise((r) => setTimeout(r, 10));
    await m1.cancel(a.id);
    releaseWs();
    await wait(m1, a.id);
    expect(m1.get(a.id)?.status).toBe('cancelled');
    expect(ran).toBe(0);

    let m2: JobManager | null = null;
    m2 = new JobManager({
      dir: join(dir, 'jobs2'),
      runWorker: deaf,
      createWorkspace,
      validate: async () => {
        await m2?.cancel(b.id);
        return null;
      },
    });
    const b = await m2.enqueueAsset({ kind: 'asset', backend: 'codex', spec: { id: 'lamp', description: 'x' } });
    await wait(m2, b.id);
    expect(m2.get(b.id)?.status).toBe('cancelled');
    expect(m2.get(b.id)?.result).toBeUndefined();
  });

  it('marks jobs interrupted by a restart as failed and caps the queue', async () => {
    const jobsDir = join(dir, 'jobs');
    const m1 = new JobManager({ dir: jobsDir, runWorker: () => new Promise(() => undefined), createWorkspace, validate: async () => null, maxQueued: 1 });
    const a = await m1.enqueueAsset({ kind: 'asset', backend: 'codex', spec: { id: 'tower', description: 'x' } });
    await m1.enqueueAsset({ kind: 'asset', backend: 'codex', spec: { id: 'lamp', description: 'x' } });
    await expect(m1.enqueueAsset({ kind: 'asset', backend: 'codex', spec: { id: 'cart', description: 'x' } })).rejects.toMatchObject({ code: 'busy' });
    await new Promise((r) => setTimeout(r, 50));
    const m2 = new JobManager({ dir: jobsDir, runWorker: okRunner(), createWorkspace, validate: async () => null });
    await m2.init();
    expect(m2.get(a.id)).toMatchObject({ status: 'failed', error: expect.stringContaining('Interrupted') });
    expect((await m2.eventsAfter(a.id, 0)).length).toBeGreaterThan(0);
    m1.dispose();
  });
});

describe('quick completions through workers', () => {
  const request = { role: 'planner' as const, system: 'sys', prompt: 'full prompt', schema: { type: 'object' }, images: [], session: { key: 'p-abcdefgh1', body: 'conversation', tail: 'reply now' } };

  it('hands the remembered conversation to the worker and records the new one', async () => {
    const sessions = new SessionStore();
    const jobs: WorkerJob[] = [];
    const run: WorkerRunner = async (j) => {
      jobs.push(j);
      return { ok: true, kind: 'complete', text: '{}', model: 'gpt-6.1-sol', session: { id: 'thread-1', systemHash: 'a'.repeat(64), body: 'conversation' } };
    };
    const backend = createWorkerTextBackend({ backend: 'codex', runWorker: run, queue: new JobQueue(), sessions, codexHome: async () => '/acct/home' });
    const r1 = await backend.complete(request);
    expect(r1).toMatchObject({ text: '{}', model: 'gpt-6.1-sol' });
    expect(jobs[0]).toMatchObject({ kind: 'complete', codexHome: '/acct/home' });
    expect((jobs[0] as { session?: unknown }).session).toBeUndefined();
    await backend.complete(request);
    expect((jobs[1] as { session?: { id: string } }).session?.id).toBe('thread-1');
    expect(sessions.clearProject('p-abcdefgh1')).toBe(1);
  });

  it('forgets a conversation when the call fails', async () => {
    const sessions = new SessionStore();
    sessions.record('p-abcdefgh1', 'claude-code', undefined, { id: 's1', systemHash: 'a'.repeat(64), body: 'c' });
    const backend = createWorkerTextBackend({ backend: 'claude-code', runWorker: async () => Promise.reject(new Error('boom')), queue: new JobQueue(), sessions });
    await expect(backend.complete(request)).rejects.toThrow('boom');
    expect(sessions.size).toBe(0);
  });

  it('removes evicted Claude session folders only', async () => {
    const store = createWorkerSessionStore();
    const keep = await mkdtemp(join(dir, 'other-'));
    const gone = await mkdtemp(join(dir, 'aether-claude-session-'));
    store.record('p-abcdefgh1', 'claude-code', undefined, { id: 's1', systemHash: 'a'.repeat(64), body: 'c', dir: gone });
    store.record('p-abcdefgh2', 'claude-code', undefined, { id: 's2', systemHash: 'a'.repeat(64), body: 'c', dir: keep });
    store.clear();
    await new Promise((r) => setTimeout(r, 50));
    await expect(stat(gone)).rejects.toThrow();
    expect((await stat(keep)).isDirectory()).toBe(true);
  });
});

describe('sign-in and accounts', () => {
  it('extracts only the verification link and code from CLI output', () => {
    expect(parseLoginOutput('\u001b[1mOpen https://auth.openai.com/codex/device\u001b[0m and enter ABCD-EFGH5')).toEqual({ url: 'https://auth.openai.com/codex/device', code: 'ABCD-EFGH5' });
    expect(parseLoginOutput('visit http://evil.example')).toEqual({});
    expect(sanitizeOutput('a\u0007b\u001b[31mc')).toBe('abc');
  });

  it('starts Claude Code sign-in with its own command and no secrets in the environment', async () => {
    const sp = fakeSpawn([{ lines: ['Opening browser: https://claude.ai/oauth/authorize?x=1'], code: 0 }]);
    const m = new LoginManager({ codexCommand: null, claudeCommand: '/bin/claude', spawn: sp.spawn as never, env: { PATH: '/bin', ANTHROPIC_API_KEY: 'sk-x', DISPLAY: ':0' } });
    m.start('claude-code');
    await new Promise((r) => setTimeout(r, 30));
    expect(sp.calls[0]?.args).toEqual(['auth', 'login', '--claudeai']);
    const env = sp.calls[0]?.options.env ?? {};
    expect(env['ANTHROPIC_API_KEY']).toBeUndefined();
    expect(env['DISPLAY']).toBe(':0');
    expect(m.status()).toMatchObject({ running: false, url: 'https://claude.ai/oauth/authorize?x=1', finished: { ok: true } });
    expect(() => new LoginManager({ codexCommand: null, claudeCommand: null }).start('codex')).toThrow(/not installed/);
  });

  it('keeps a token-free registry with private account homes', async () => {
    const status = fakeSpawn(Array.from({ length: 10 }, () => ({ lines: ['Logged in using ChatGPT'], code: 0 })));
    const accounts = new CodexAccounts({ dir: join(dir, 'acct'), codexCommand: '/bin/codex', spawn: status.spawn });
    const { id, home } = await accounts.create('Work');
    expect((await stat(home)).mode & 0o777).toBe(0o700);
    const reg = await readFile(join(dir, 'acct', 'codex-accounts.json'), 'utf8');
    expect((await stat(join(dir, 'acct', 'codex-accounts.json'))).mode & 0o777).toBe(0o600);
    expect(Object.keys(JSON.parse(reg) as object).sort()).toEqual(['accounts', 'activeId']);
    await expect(accounts.activate(id, 1)).rejects.toThrow(/running jobs/);
    await accounts.activate(id, 0);
    expect(await accounts.activeHome()).toBe(home);
    await expect(accounts.remove(id)).rejects.toThrow(/Switch to another account/);
    await accounts.activate('default', 0);
    await accounts.remove(id);
    await expect(stat(home)).rejects.toThrow();
    await expect(accounts.remove('default')).rejects.toThrow();
    expect(status.calls.every((c) => c.args.join(' ') === 'login status')).toBe(true);
  });
});

describe('local AI service', () => {
  it('reports both backends, the account and queue sizes', async () => {
    const probeHomes: Array<string | null> = [];
    const local = new LocalAi({
      dataDir: dir,
      commands: { codex: null, claude: null },
      runWorker: async () => ({ ok: true, kind: 'complete', text: '{}' }),
      probe: async (home) => {
        probeHomes.push(home);
        return [{ id: 'codex', label: 'Codex', installed: true, loggedIn: true, detail: 'Logged in', models: [] }];
      },
    });
    await local.init();
    const st = await local.status();
    expect(st).toMatchObject({ ok: true, name: 'aether-local', account: null, jobs: 0, login: null });
    expect(st.backends[0]).toMatchObject({ id: 'codex', busy: 0 });
    expect(probeHomes).toEqual([null]);
    await local.status();
    expect(probeHomes.length).toBe(1);
    local.dispose();
  });
});
