/**
 * Test doubles: a fake child process (scripted stdout lines / exit) and a
 * recording spawn function.
 */
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import type { SpawnFn } from '../src/process';

/** What a fake run does. */
export interface FakeRun {
  lines?: string[];
  stderr?: string;
  code?: number;
  /** Never exit on its own (for timeout / abort tests). */
  hang?: boolean;
  /** Throw ENOENT like a missing binary. */
  enoent?: boolean;
}

/** A recorded spawn call. */
export interface SpawnCall {
  command: string;
  args: string[];
  options: SpawnOptions;
  stdin: string;
  killed: boolean;
}

/** A spawn function that plays `runs` in order and records every call. */
export function fakeSpawn(runs: FakeRun[]): { spawn: SpawnFn; calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  const spawn: SpawnFn = (command, args, options) => {
    const run = runs.shift() ?? { lines: [], code: 0 };
    const call: SpawnCall = { command, args: [...args], options, stdin: '', killed: false };
    calls.push(call);
    const child = new EventEmitter() as ChildProcess & EventEmitter;
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdin = new Writable({
      write(chunk: Buffer, _enc, cb) {
        call.stdin += chunk.toString();
        cb();
      },
    });
    let exited = false;
    const exit = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (exited) return;
      exited = true;
      Object.assign(child, { exitCode: code, signalCode: signal });
      stdout.end();
      stderr.end();
      setTimeout(() => child.emit('close', code, signal), 1);
    };
    Object.assign(child, {
      stdout,
      stderr,
      stdin,
      exitCode: null,
      signalCode: null,
      kill: (sig: NodeJS.Signals = 'SIGTERM') => {
        call.killed = true;
        exit(null, sig);
        return true;
      },
    });
    setTimeout(() => {
      if (run.enoent) {
        const e = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
        child.emit('error', e);
        return;
      }
      for (const l of run.lines ?? []) stdout.write(`${l}\n`);
      if (run.stderr) stderr.write(run.stderr);
      if (!run.hang) setTimeout(() => exit(run.code ?? 0, null), 2);
    }, 1);
    return child;
  };
  return { spawn, calls };
}
