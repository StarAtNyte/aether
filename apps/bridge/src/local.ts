/**
 * Local AI service: everything the Aether server offers when it runs on the
 * user's own machine (`/api/local/*`). It uses the Codex / Claude Code CLIs
 * the user is signed in to, through one worker process per call:
 *
 * - quick completions (tool-use emulation over the locked-down backends),
 *   one at a time with a short queue, conversations resumed per project;
 * - deep builds (an agent iterating in a throwaway workspace), durable queue;
 * - sign-in / sign-out with the CLIs' own flows and several Codex accounts.
 *
 * Nothing here is ever enabled on a hosted deployment (see the server's
 * `AETHER_LOCAL_AI`): it would spend the machine owner's subscription.
 */
import { BridgeError } from './errors';
import { createCodexImageBackend, type ImageJob, type ImageResultBytes } from './backends/codex-image';
import { join } from 'node:path';
import { createEmulatedProvider, type BridgeBackendId, type BridgeBackendStatus, type BridgeEffort, type LocalStatus, type Provider, type TextBackend } from '@aether/agent';
import { CodexAccounts, DEFAULT_ACCOUNT_ID } from './accounts';
import { LoginManager, type LoginState } from './auth';
import { cached, probeClaude, probeCodex } from './backends/status';
import { resolveCommands, type ResolvedCommands } from './headless';
import { JobQueue } from './queue';
import { BlenderService } from './blender/service';
import type { SessionStore } from './sessions';
import { JobManager, type JobManagerOptions } from './worker/jobs';
import { runWorker, stopAllWorkers } from './worker/runner';
import { createWorkerSessionStore, createWorkerTextBackend } from './worker/text-backend';

/** Version reported by the local status. */
export const LOCAL_AI_VERSION = '1';

/** Options of {@link LocalAi}. */
export interface LocalAiOptions {
  /** Private data folder (job records, account registry). */
  dataDir: string;
  env?: NodeJS.ProcessEnv;
  commands?: ResolvedCommands;
  /** Worker runner (tests inject a fake). */
  runWorker?: JobManagerOptions['runWorker'];
  /** Backend probes (tests). */
  probe?: (codexHome: string | null) => Promise<Array<Omit<BridgeBackendStatus, 'busy'>>>;
  login?: LoginManager;
  accounts?: CodexAccounts;
  jobs?: JobManager;
  /** Per-call timeout of quick completions (ms). */
  timeoutMs?: number;
  /** Most waiting quick calls. */
  maxWaiting?: number;
  /** Blender (default: one over `<dataDir>/blender`, off until switched on). */
  blender?: BlenderService;
}

/** The local AI service. */
export class LocalAi {
  readonly sessions: SessionStore;
  readonly accounts: CodexAccounts;
  readonly login: LoginManager;
  readonly jobs: JobManager;
  readonly commands: ResolvedCommands;
  /** Blender through its MCP server (local only; see blender/service.ts). */
  readonly blender: BlenderService;
  private readonly backends: Record<BridgeBackendId, TextBackend>;
  private readonly queue: JobQueue;
  private readonly probe: (home: string | null) => Promise<Array<Omit<BridgeBackendStatus, 'busy'>>>;
  private probeCache = new Map<string, () => Promise<Array<Omit<BridgeBackendStatus, 'busy'>>>>();
  private lastLoginFinish = 0;
  private active = 0;

  constructor(opts: LocalAiOptions) {
    this.commands = opts.commands ?? resolveCommands();
    const env = opts.env;
    const run = opts.runWorker ?? ((job, o) => runWorker(job, { ...o, ...(env ? { env } : {}) }));
    this.sessions = createWorkerSessionStore();
    this.accounts = opts.accounts ?? new CodexAccounts({ dir: opts.dataDir, codexCommand: this.commands.codex, ...(env ? { env } : {}) });
    this.login = opts.login ?? new LoginManager({ codexCommand: this.commands.codex, claudeCommand: this.commands.claude, ...(env ? { env } : {}) });
    this.jobs =
      opts.jobs ??
      new JobManager({
        dir: join(opts.dataDir, 'ai-jobs'),
        runWorker: run,
        accountHome: async () => ({ id: await this.accounts.activeId(), home: await this.accounts.activeHome() }),
      });
    this.queue = new JobQueue(opts.maxWaiting ?? 4);
    this.blender = opts.blender ?? new BlenderService({ dataDir: join(opts.dataDir, 'blender') });
    const common = {
      runWorker: run,
      queue: this.queue,
      sessions: this.sessions,
      codexHome: () => this.accounts.activeHome(),
      ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
      onActive: (d: 1 | -1) => {
        this.active += d;
      },
    };
    this.backends = { codex: createWorkerTextBackend({ ...common, backend: 'codex' }), 'claude-code': createWorkerTextBackend({ ...common, backend: 'claude-code' }) };
    const commands = this.commands;
    this.probe =
      opts.probe ??
      ((home) => {
        const deps = { codexCommand: commands.codex, claudeCommand: commands.claude, env: home ? { ...(env ?? process.env), CODEX_HOME: home } : (env ?? process.env) };
        return Promise.all([probeCodex(deps), probeClaude(deps)]);
      });
  }

  /** Prepare persisted state (jobs interrupted by a restart are marked failed). */
  init(): Promise<void> {
    return this.jobs.init();
  }

  /** A tool-calling provider over one backend (quick completions). */
  provider(backend: BridgeBackendId, model?: string, effort?: BridgeEffort): Provider {
    return createEmulatedProvider({ backend: this.backends[backend], name: backend, ...(model ? { model } : {}), ...(effort ? { effort } : {}) });
  }

  /** Make a picture with Codex's built-in image tool (the machine's signed-in Codex); queued with the quick calls. */
  async image(job: ImageJob, signal?: AbortSignal): Promise<ImageResultBytes> {
    const command = this.commands.codex;
    if (!command) throw new BridgeError('cli_missing', 'The Codex CLI could not be found. Install it (npm i -g @openai/codex) and run "codex login".');
    const home = await this.accounts.activeHome();
    const backend = createCodexImageBackend({ command, ...(home ? { codexHome: home, env: { ...process.env, CODEX_HOME: home } } : {}) });
    return this.queue.run(() => backend.generate(job, signal), signal);
  }

  /** The sign-in state; a finished sign-in refreshes account and backend status. */
  loginState(): LoginState | null {
    const s = this.login.status();
    if (s?.finished && s.startedAt !== this.lastLoginFinish) {
      this.lastLoginFinish = s.startedAt;
      this.accounts.invalidate();
      this.probeCache.clear();
    }
    return s;
  }

  /** Forget cached status (after sign-out or account changes). */
  refresh(): void {
    this.accounts.invalidate();
    this.probeCache.clear();
  }

  /** Status of both backends for the active Codex account. */
  async status(): Promise<LocalStatus> {
    const login = this.loginState();
    let account: LocalStatus['account'] = null;
    let home: string | null = null;
    try {
      const list = await this.accounts.list();
      const a = list.items.find((x) => x.active);
      if (a && (a.id !== DEFAULT_ACCOUNT_ID || list.items.length > 1)) account = { id: a.id, label: a.label };
      home = await this.accounts.activeHome();
    } catch {
      account = null;
    }
    const key = home ?? '';
    let probe = this.probeCache.get(key);
    if (!probe) {
      probe = cached(() => this.probe(home), 30_000);
      this.probeCache.set(key, probe);
    }
    const [list, blender] = await Promise.all([probe(), this.blender.state().catch(() => 'off' as const)]);
    const busy = this.queue.size;
    return {
      ok: true,
      name: 'aether-local',
      version: LOCAL_AI_VERSION,
      backends: list.map((b) => ({ ...b, busy: Math.min(1000, busy + this.jobs.activeCount()) })),
      account,
      jobs: this.jobs.activeCount(),
      login: login ? { ...login, output: login.output.slice(-4000) } : null,
      blender,
    };
  }

  /** Quick calls running + waiting. */
  get busy(): number {
    return this.queue.size;
  }

  /** Forget a project's conversations (the project was deleted). */
  clearProject(project: string): number {
    return this.sessions.clearProject(project);
  }

  /** Stop everything (shutdown). */
  dispose(): void {
    this.jobs.dispose();
    this.login.dispose();
    this.sessions.clear();
    void this.blender.dispose();
    stopAllWorkers();
  }
}
