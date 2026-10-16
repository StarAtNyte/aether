/**
 * Spawns one AI worker process per job (crash isolation: a failing CLI or
 * SDK never takes the host down; the next job simply gets a fresh process).
 *
 * The process runs detached in its own process group with an allowlisted
 * environment; the job goes in on stdin, progress lines are relayed
 * (validated), stdout is capped. A timeout or cancel sends SIGTERM to the
 * whole group, then SIGKILL after a grace period. Every running process is
 * tracked so the host can stop them all on shutdown.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { BridgeError } from '../errors';
import { killTree } from '../kill-tree';
import { restrictedEnv } from '../sandbox';
import { parseProgressLine, WorkerResult } from './protocol';
/** Grace period between SIGTERM and SIGKILL (ms). */
export const KILL_GRACE_MS = 3000;
const MAX_STDOUT = 16 * 1024 * 1024;
const STDERR_TAIL = 40;
const running = new Set();
/** Number of worker processes alive. */
export function runningWorkers() {
    return running.size;
}
/** Signal the worker's whole process tree (group on POSIX, `taskkill /T` on Windows). */
function signalGroup(child, sig) {
    if (child.pid === undefined)
        return;
    killTree(child.pid, sig);
}
/** SIGTERM the group now, SIGKILL after the grace period if it is still alive. */
function stop(child) {
    signalGroup(child, 'SIGTERM');
    const t = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null)
            signalGroup(child, 'SIGKILL');
    }, KILL_GRACE_MS);
    t.unref?.();
}
/** Stop every worker process (host shutdown). */
export function stopAllWorkers() {
    for (const c of running)
        stop(c);
}
/** The default worker command: node with tsx's loader running `ai-worker.ts`. */
export function defaultWorkerCommand() {
    const entry = fileURLToPath(new URL('./ai-worker.ts', import.meta.url));
    const loader = import.meta.resolve('tsx');
    return { command: process.execPath, args: ['--import', loader, entry] };
}
/** Run one job in a fresh worker process. Rejects with a {@link BridgeError}. */
export function runWorker(job, opts) {
    const { command, args } = opts.command ?? defaultWorkerCommand();
    const doSpawn = opts.spawn ?? spawn;
    return new Promise((resolve, reject) => {
        if (opts.signal?.aborted) {
            reject(new BridgeError('backend_error', 'cancelled'));
            return;
        }
        let child;
        try {
            child = doSpawn(command, args, {
                cwd: process.cwd(),
                env: restrictedEnv(opts.env, { NODE_ENV: 'production' }),
                shell: false,
                detached: true,
                windowsHide: true,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
        }
        catch {
            reject(new BridgeError('backend_error', 'The AI worker could not be started.'));
            return;
        }
        running.add(child);
        let stdout = '';
        let overflow = false;
        const tail = [];
        let settled = false;
        let why = null;
        const finish = (fn) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            opts.signal?.removeEventListener('abort', onAbort);
            running.delete(child);
            fn();
        };
        const timer = setTimeout(() => {
            why = 'timeout';
            stop(child);
        }, Math.max(1000, opts.timeoutMs));
        const onAbort = () => {
            why = 'cancelled';
            stop(child);
        };
        opts.signal?.addEventListener('abort', onAbort, { once: true });
        child.stdout?.setEncoding('utf8');
        child.stdout?.on('data', (d) => {
            if (stdout.length + d.length > MAX_STDOUT) {
                overflow = true;
                stop(child);
                return;
            }
            stdout += d;
        });
        if (child.stderr) {
            createInterface({ input: child.stderr, crlfDelay: Infinity }).on('line', (line) => {
                const p = parseProgressLine(line);
                if (p) {
                    try {
                        opts.onProgress?.(p);
                    }
                    catch {
                        /* a UI listener must never break the job */
                    }
                }
                else if (line.trim()) {
                    tail.push(line.slice(0, 300));
                    if (tail.length > STDERR_TAIL)
                        tail.shift();
                }
            });
        }
        child.once('error', () => finish(() => reject(new BridgeError('backend_error', 'The AI worker could not be started.'))));
        child.once('close', () => {
            finish(() => {
                if (why === 'timeout')
                    return reject(new BridgeError('timeout', `The job took longer than ${Math.round(opts.timeoutMs / 1000)} s and was stopped.`));
                if (why === 'cancelled')
                    return reject(new BridgeError('backend_error', 'cancelled'));
                if (overflow)
                    return reject(new BridgeError('backend_error', 'The AI worker produced too much output.'));
                let parsed;
                try {
                    parsed = WorkerResult.safeParse(JSON.parse(stdout));
                }
                catch {
                    return reject(new BridgeError('backend_error', 'The AI worker crashed.'));
                }
                if (!parsed.success)
                    return reject(new BridgeError('backend_error', 'The AI worker returned an invalid result.'));
                const r = parsed.data;
                if (!r.ok)
                    return reject(new BridgeError(r.code, r.message));
                resolve(r);
            });
        });
        child.stdin?.on('error', () => undefined);
        child.stdin?.end(JSON.stringify(job));
    });
}
