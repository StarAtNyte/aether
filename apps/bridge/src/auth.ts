/**
 * Sign-in / sign-out through the CLIs' own documented flows, started on the
 * user's machine:
 *
 * - Codex: `codex login --device-auth` prints a verification URL and a
 *   one-time code (works without a local callback port); `codex logout`.
 * - Claude Code: `claude auth login --claudeai` opens the browser on this
 *   machine (and prints the URL); `claude auth logout`.
 *
 * Aether never reads, stores or transmits credential files: the CLI writes
 * its own login wherever it keeps it (optionally a per-account `CODEX_HOME`).
 * Only the URL and code the CLI prints are relayed to the local user. One
 * sign-in runs at a time; it is stopped after 10 minutes.
 */
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
import { runProcess, type SpawnFn } from './process';
import { restrictedEnv } from './sandbox';
import { spawnCli } from './spawn-plan';

/** Backends with a sign-in flow. */
export type LoginBackend = 'codex' | 'claude-code';

/** Observable state of the current (or last) sign-in. */
export interface LoginState {
  backend: LoginBackend;
  /** Registry id of the Codex account being added (multi-account mode). */
  accountId?: string;
  running: boolean;
  /** Verification URL printed by the CLI. */
  url?: string;
  /** One-time code printed by the CLI (device sign-in). */
  code?: string;
  /** Short, sanitized tail of the CLI output (no secrets: the CLI prints none). */
  output: string;
  startedAt: number;
  /** Set once the CLI exited. */
  finished?: { ok: boolean; message: string };
}

/** Options of {@link LoginManager}. */
export interface LoginManagerOptions {
  codexCommand: string | null;
  claudeCommand: string | null;
  env?: NodeJS.ProcessEnv;
  /** Process spawner (tests). */
  spawn?: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
  /** Runner for short commands (logout, status). */
  run?: SpawnFn;
  timeoutMs?: number;
  now?: () => number;
}

const MAX_OUTPUT = 2000;
/** Desktop session variables a CLI needs to open the user's browser. */
const DESKTOP_ENV = ['DISPLAY', 'WAYLAND_DISPLAY', 'DBUS_SESSION_BUS_ADDRESS', 'BROWSER'] as const;
/** URLs the CLIs print for sign-in (https only; nothing with quotes or brackets). */
const URL_RE = /https:\/\/[^\s"'<>()[\]]{4,300}/;
/** Device codes such as "ABCD-EFGH" or "ABCD-1234E". */
const CODE_RE = /\b([A-Z0-9]{4}-[A-Z0-9]{4,5})\b/;
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;?]*[A-Za-z]/g;

/** Strip terminal escapes and control characters from CLI output. */
export function sanitizeOutput(s: string): string {
  return s.replace(ANSI_RE, '').replace(/[^\x09\x0a\x20-\x7e -￿]/g, '');
}

/** Pull the verification URL and code out of CLI output. */
export function parseLoginOutput(text: string): { url?: string; code?: string } {
  const clean = sanitizeOutput(text);
  const url = URL_RE.exec(clean)?.[0];
  const code = CODE_RE.exec(clean)?.[1];
  return { ...(url ? { url } : {}), ...(code ? { code } : {}) };
}

/** Arguments of the sign-in command. */
export function loginArgs(backend: LoginBackend): string[] {
  return backend === 'codex' ? ['login', '--device-auth'] : ['auth', 'login', '--claudeai'];
}

/** Arguments of the sign-out command. */
export function logoutArgs(backend: LoginBackend): string[] {
  return backend === 'codex' ? ['logout'] : ['auth', 'logout'];
}

/** Runs the CLI sign-in flows, one at a time. */
export class LoginManager {
  private state: LoginState | null = null;
  private child: ChildProcess | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(private readonly opts: LoginManagerOptions) {
    this.timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000;
    this.now = opts.now ?? Date.now;
  }

  private command(backend: LoginBackend): string | null {
    return backend === 'codex' ? this.opts.codexCommand : this.opts.claudeCommand;
  }

  /** The current or last sign-in (null before the first). */
  status(): LoginState | null {
    return this.state ? { ...this.state } : null;
  }

  /** True while a sign-in runs. */
  get running(): boolean {
    return this.state?.running === true;
  }

  /**
   * Start a sign-in. `home` points Codex at a separate `CODEX_HOME` (multi
   * account). Throws when one is already running or the CLI is missing.
   */
  start(backend: LoginBackend, opts: { home?: string; accountId?: string } = {}): LoginState {
    if (this.running) throw new Error('A sign-in is already in progress. Finish or cancel it first.');
    const command = this.command(backend);
    if (!command) throw new Error(backend === 'codex' ? 'The Codex CLI is not installed (npm i -g @openai/codex).' : 'The Claude Code CLI is not installed.');
    // The browser opens on this machine: pass the desktop session variables (not secrets) too.
    const source = this.opts.env ?? process.env;
    const desktop: Record<string, string> = {};
    for (const k of DESKTOP_ENV) {
      const v = source[k];
      if (typeof v === 'string' && v.length > 0 && v.length < 1024) desktop[k] = v;
    }
    const env = restrictedEnv(this.opts.env, { ...desktop, ...(opts.home ? { CODEX_HOME: opts.home } : {}) });
    const doSpawn = this.opts.spawn ?? ((c: string, a: readonly string[], o: SpawnOptions): ChildProcess => spawnCli(c, a, o));
    const child = doSpawn(command, loginArgs(backend), { cwd: tmpdir(), env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    const state: LoginState = { backend, running: true, output: '', startedAt: this.now(), ...(opts.accountId ? { accountId: opts.accountId } : {}) };
    this.state = state;
    const onLine = (line: string): void => {
      if (this.state !== state) return;
      const clean = sanitizeOutput(line).slice(0, 500);
      state.output = `${state.output}${clean}\n`.slice(-MAX_OUTPUT);
      const found = parseLoginOutput(clean);
      if (found.url && !state.url) state.url = found.url;
      if (found.code && !state.code) state.code = found.code;
    };
    for (const stream of [child.stdout, child.stderr]) {
      if (!stream) continue;
      createInterface({ input: stream, crlfDelay: Infinity }).on('line', onLine);
    }
    child.once('error', (e: NodeJS.ErrnoException) => this.finish(state, false, e.code === 'ENOENT' ? 'The CLI could not be started.' : 'Sign-in failed to start.'));
    child.once('close', (code) => this.finish(state, code === 0, code === 0 ? 'Signed in.' : 'Sign-in did not complete.'));
    this.timer = setTimeout(() => this.cancel('Sign-in timed out.'), this.timeoutMs);
    this.timer.unref?.();
    return { ...state };
  }

  private finish(state: LoginState, ok: boolean, message: string): void {
    if (this.state !== state || !state.running) return;
    state.running = false;
    state.finished = { ok, message };
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.child = null;
  }

  /** Stop the running sign-in. */
  cancel(message = 'Sign-in cancelled.'): void {
    const state = this.state;
    const child = this.child;
    if (!state || !state.running || !child) return;
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
    setTimeout(() => {
      try {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }, 2000).unref?.();
    this.finish(state, false, message);
  }

  /** Sign out (`home`: a separate Codex home). Resolves to a short message. */
  async logout(backend: LoginBackend, home?: string): Promise<{ ok: boolean; message: string }> {
    const command = this.command(backend);
    if (!command) return { ok: false, message: 'The CLI is not installed.' };
    const r = await runProcess(command, logoutArgs(backend), {
      cwd: tmpdir(),
      env: restrictedEnv(this.opts.env, home ? { CODEX_HOME: home } : {}),
      timeoutMs: 20_000,
      ...(this.opts.run ? { spawn: this.opts.run } : {}),
    });
    if (r.spawnError) return { ok: false, message: 'The CLI could not be started.' };
    return r.code === 0 ? { ok: true, message: 'Signed out.' } : { ok: false, message: sanitizeOutput(`${r.stdout}${r.stderr}`).trim().slice(0, 200) || 'Sign-out failed.' };
  }

  /** Stop everything (shutdown). */
  dispose(): void {
    this.cancel('Stopped.');
  }
}
