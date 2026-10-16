import { createInterface } from 'node:readline';
import { spawnCli } from './spawn-plan';
/** Run a command to completion. Never throws; inspect the result. */
export function runProcess(command, args, opts) {
    const maxStdout = opts.maxStdout ?? 8 * 1024 * 1024;
    const maxStderr = opts.maxStderr ?? 64 * 1024;
    const doSpawn = opts.spawn ?? ((c, a, o) => spawnCli(c, a, o));
    return new Promise((resolve) => {
        let child;
        try {
            child = doSpawn(command, args, { cwd: opts.cwd, env: opts.env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        }
        catch (e) {
            resolve({ code: null, signal: null, stdout: '', stderr: '', spawnError: e });
            return;
        }
        let stdout = '';
        let stderr = '';
        let stopped;
        let spawnError;
        let settled = false;
        const stop = (why) => {
            if (stopped)
                return;
            stopped = why;
            try {
                child.kill('SIGTERM');
            }
            catch {
                /* already gone */
            }
            // Escalate if the CLI ignores SIGTERM.
            setTimeout(() => {
                try {
                    if (child.exitCode === null && child.signalCode === null)
                        child.kill('SIGKILL');
                }
                catch {
                    /* already gone */
                }
            }, 2000).unref();
        };
        const timer = setTimeout(() => stop('timeout'), Math.max(1, opts.timeoutMs));
        const onAbort = () => stop('aborted');
        if (opts.signal?.aborted)
            stop('aborted');
        else
            opts.signal?.addEventListener('abort', onAbort, { once: true });
        const finish = (code, signal) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            opts.signal?.removeEventListener('abort', onAbort);
            resolve({ code, signal, stdout, stderr, ...(stopped ? { stopped } : {}), ...(spawnError ? { spawnError } : {}) });
        };
        child.once('error', (e) => {
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
                if (typeof reason === 'string')
                    stop(`observer:${reason}`);
            });
        }
        child.stderr?.on('data', (d) => {
            if (stderr.length < maxStderr)
                stderr += String(d).slice(0, maxStderr - stderr.length);
        });
        child.once('close', (code, signal) => finish(code, signal));
        if (child.stdin) {
            child.stdin.on('error', () => undefined);
            child.stdin.end(opts.stdin ?? '');
        }
    });
}
