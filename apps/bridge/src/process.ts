/**
 * Safe child-process runner: argument arrays only (never a shell), a
 * restricted environment, a hard timeout, caller abort, output caps and an
 * optional per-line observer that may stop the process early (used to kill a
 * run the moment the CLI reports a tool call).
 */
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { createInterface } from 'node:readline';

/** `spawn`-compatible function (injectable for tests). */
export type SpawnFn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

/** Options of {@link runProcess}. */
export interface RunOptions {
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Written to stdin, then stdin is closed (stdin is closed immediately when absent). */
  stdin?: string;
  /** stdout cap in characters (default 8 MiB); the process is killed when exceeded. */
  maxStdout?: number;
  /** stderr cap in characters (default 64 KiB; the rest is dropped). */
  maxStderr?: number;
  /** Called per stdout line; return a reason string to kill the process. */
  onLine?: (line: string) => string | void;
  spawn?: SpawnFn;
}

/** Outcome of {@link runProcess}. */
export interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  /** Why the runner stopped the process early (timeout, abort, cap, observer), if it did. */
  stopped?: 'timeout' | 'aborted' | 'stdout_cap' | `observer:${string}`;
  /** spawn failed (e.g. ENOENT: command not found). */
  spawnError?: NodeJS.ErrnoException;
}

/** Run a command to completion. Never throws; inspect the result. */
export function runProcess(command: string, args: readonly string[], opts: RunOptions): Promise<RunResult> {
  const maxStdout = opts.maxStdout ?? 8 * 1024 * 1024;
  const maxStderr = opts.maxStderr ?? 64 * 1024;
  const doSpawn = opts.spawn ?? (spawn as SpawnFn);
  return new Promise<RunResult>((resolve) => {
    let child: ChildProcess;
    try {
      child = doSpawn(command, args, { cwd: opts.cwd, env: opts.env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ code: null, signal: null, stdout: '', stderr: '', spawnError: e as NodeJS.ErrnoException });
      return;
    }
    let stdout = '';
    let stderr = '';
    let stopped: RunResult['stopped'];
    let spawnError: NodeJS.ErrnoException | undefined;
    let settled = false;

    const stop = (why: NonNullable<RunResult['stopped']>): void => {
      if (stopped) return;
      stopped = why;
      try {
        child.kill('SIGTERM');
      } catch {
        /* already gone */
      }
      // Escalate if the CLI ignores SIGTERM.
      setTimeout(() => {
        try {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }, 2000).unref();
    };
    const timer = setTimeout(() => stop('timeout'), Math.max(1, opts.timeoutMs));
    const onAbort = (): void => stop('aborted');
    if (opts.signal?.aborted) stop('aborted');
    else opts.signal?.addEventListener('abort', onAbort, { once: true });

    const finish = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve({ code, signal, stdout, stderr, ...(stopped ? { stopped } : {}), ...(spawnError ? { spawnError } : {}) });
    };

    child.once('error', (e: NodeJS.ErrnoException) => {
      spawnError = e;
      finish(null, null);
    });
    if (child.stdout) {
      const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
      rl.on('line', (line) => {
        if (stdout.length + line.length + 1 > maxStdout) {
          stop('stdout_cap');
          return;
        }
        stdout += `${line}\n`;
        const reason = opts.onLine?.(line);
        if (typeof reason === 'string') stop(`observer:${reason}`);
      });
    }
    child.stderr?.on('data', (d: Buffer | string) => {
      if (stderr.length < maxStderr) stderr += String(d).slice(0, maxStderr - stderr.length);
    });
    child.once('close', (code, signal) => finish(code, signal));
    if (child.stdin) {
      child.stdin.on('error', () => undefined);
      child.stdin.end(opts.stdin ?? '');
    }
  });
}
