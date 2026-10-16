import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
import { runProcess } from './process';
import { restrictedEnv } from './sandbox';
import { spawnCli } from './spawn-plan';
const MAX_OUTPUT = 2000;
/** Desktop session variables a CLI needs to open the user's browser. */
const DESKTOP_ENV = ['DISPLAY', 'WAYLAND_DISPLAY', 'DBUS_SESSION_BUS_ADDRESS', 'BROWSER'];
/** URLs the CLIs print for sign-in (https only; nothing with quotes or brackets). */
const URL_RE = /https:\/\/[^\s"'<>()[\]]{4,300}/;
/** Device codes such as "ABCD-EFGH" or "ABCD-1234E". */
const CODE_RE = /\b([A-Z0-9]{4}-[A-Z0-9]{4,5})\b/;
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;?]*[A-Za-z]/g;
/** Strip terminal escapes and control characters from CLI output. */
export function sanitizeOutput(s) {
    return s.replace(ANSI_RE, '').replace(/[^\x09\x0a\x20-\x7e -￿]/g, '');
}
/** Pull the verification URL and code out of CLI output. */
export function parseLoginOutput(text) {
    const clean = sanitizeOutput(text);
    const url = URL_RE.exec(clean)?.[0];
    const code = CODE_RE.exec(clean)?.[1];
    return { ...(url ? { url } : {}), ...(code ? { code } : {}) };
}
/** Arguments of the sign-in command. */
export function loginArgs(backend) {
    return backend === 'codex' ? ['login', '--device-auth'] : ['auth', 'login', '--claudeai'];
}
/** Arguments of the sign-out command. */
export function logoutArgs(backend) {
    return backend === 'codex' ? ['logout'] : ['auth', 'logout'];
}
/** Runs the CLI sign-in flows, one at a time. */
export class LoginManager {
    opts;
    state = null;
    child = null;
    timer = null;
    timeoutMs;
    now;
    constructor(opts) {
        this.opts = opts;
        this.timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000;
        this.now = opts.now ?? Date.now;
    }
    command(backend) {
        return backend === 'codex' ? this.opts.codexCommand : this.opts.claudeCommand;
    }
    /** The current or last sign-in (null before the first). */
    status() {
        return this.state ? { ...this.state } : null;
    }
    /** True while a sign-in runs. */
    get running() {
        return this.state?.running === true;
    }
    /**
     * Start a sign-in. `home` points Codex at a separate `CODEX_HOME` (multi
     * account). Throws when one is already running or the CLI is missing.
     */
    start(backend, opts = {}) {
        if (this.running)
            throw new Error('A sign-in is already in progress. Finish or cancel it first.');
        const command = this.command(backend);
        if (!command)
            throw new Error(backend === 'codex' ? 'The Codex CLI is not installed (npm i -g @openai/codex).' : 'The Claude Code CLI is not installed.');
        // The browser opens on this machine: pass the desktop session variables (not secrets) too.
        const source = this.opts.env ?? process.env;
        const desktop = {};
        for (const k of DESKTOP_ENV) {
            const v = source[k];
            if (typeof v === 'string' && v.length > 0 && v.length < 1024)
                desktop[k] = v;
        }
        const env = restrictedEnv(this.opts.env, { ...desktop, ...(opts.home ? { CODEX_HOME: opts.home } : {}) });
        const doSpawn = this.opts.spawn ?? ((c, a, o) => spawnCli(c, a, o));
        const child = doSpawn(command, loginArgs(backend), { cwd: tmpdir(), env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        this.child = child;
        const state = { backend, running: true, output: '', startedAt: this.now(), ...(opts.accountId ? { accountId: opts.accountId } : {}) };
        this.state = state;
        const onLine = (line) => {
            if (this.state !== state)
                return;
            const clean = sanitizeOutput(line).slice(0, 500);
            state.output = `${state.output}${clean}\n`.slice(-MAX_OUTPUT);
            const found = parseLoginOutput(clean);
            if (found.url && !state.url)
                state.url = found.url;
            if (found.code && !state.code)
                state.code = found.code;
        };
        for (const stream of [child.stdout, child.stderr]) {
            if (!stream)
                continue;
            createInterface({ input: stream, crlfDelay: Infinity }).on('line', onLine);
        }
        child.once('error', (e) => this.finish(state, false, e.code === 'ENOENT' ? 'The CLI could not be started.' : 'Sign-in failed to start.'));
        child.once('close', (code) => this.finish(state, code === 0, code === 0 ? 'Signed in.' : 'Sign-in did not complete.'));
        this.timer = setTimeout(() => this.cancel('Sign-in timed out.'), this.timeoutMs);
        this.timer.unref?.();
        return { ...state };
    }
    finish(state, ok, message) {
        if (this.state !== state || !state.running)
            return;
        state.running = false;
        state.finished = { ok, message };
        if (this.timer)
            clearTimeout(this.timer);
        this.timer = null;
        this.child = null;
    }
    /** Stop the running sign-in. */
    cancel(message = 'Sign-in cancelled.') {
        const state = this.state;
        const child = this.child;
        if (!state || !state.running || !child)
            return;
        try {
            child.kill('SIGTERM');
        }
        catch {
            /* already gone */
        }
        setTimeout(() => {
            try {
                if (child.exitCode === null && child.signalCode === null)
                    child.kill('SIGKILL');
            }
            catch {
                /* already gone */
            }
        }, 2000).unref?.();
        this.finish(state, false, message);
    }
    /** Sign out (`home`: a separate Codex home). Resolves to a short message. */
    async logout(backend, home) {
        const command = this.command(backend);
        if (!command)
            return { ok: false, message: 'The CLI is not installed.' };
        const r = await runProcess(command, logoutArgs(backend), {
            cwd: tmpdir(),
            env: restrictedEnv(this.opts.env, home ? { CODEX_HOME: home } : {}),
            timeoutMs: 20_000,
            ...(this.opts.run ? { spawn: this.opts.run } : {}),
        });
        if (r.spawnError)
            return { ok: false, message: 'The CLI could not be started.' };
        return r.code === 0 ? { ok: true, message: 'Signed out.' } : { ok: false, message: sanitizeOutput(`${r.stdout}${r.stderr}`).trim().slice(0, 200) || 'Sign-out failed.' };
    }
    /** Stop everything (shutdown). */
    dispose() {
        this.cancel('Stopped.');
    }
}
