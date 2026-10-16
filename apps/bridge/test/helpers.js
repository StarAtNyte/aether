/**
 * Test doubles: a fake child process (scripted stdout lines / exit) and a
 * recording spawn function.
 */
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
/** A spawn function that plays `runs` in order and records every call. */
export function fakeSpawn(runs) {
    const calls = [];
    const spawn = (command, args, options) => {
        const run = runs.shift() ?? { lines: [], code: 0 };
        const call = { command, args: [...args], options, stdin: '', killed: false };
        calls.push(call);
        const child = new EventEmitter();
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        const stdin = new Writable({
            write(chunk, _enc, cb) {
                call.stdin += chunk.toString();
                cb();
            },
        });
        let exited = false;
        const exit = (code, signal) => {
            if (exited)
                return;
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
            kill: (sig = 'SIGTERM') => {
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
            for (const l of run.lines ?? [])
                stdout.write(`${l}\n`);
            if (run.stderr)
                stderr.write(run.stderr);
            if (!run.hang)
                setTimeout(() => exit(run.code ?? 0, null), 2);
        }, 1);
        return child;
    };
    return { spawn, calls };
}
