/**
 * Deploy jobs: a published build copied into a throwaway directory, then
 * the target's CLI steps (`hosts.ts`) run one after another with argument
 * arrays, an allow-listed environment (no API keys or tokens are passed
 * through — the CLIs use their own saved logins), per-step timeouts,
 * cancellation, output caps and no stdin. Progress streams as events the
 * routes forward over server-sent events; the public URL is read from the
 * CLI's output. One deploy runs at a time; finished jobs are kept briefly.
 */
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { killTree, restrictedEnv, runProcess, spawnCli, which } from '@aether/bridge';
import { deployedUrl, deploySteps, HOST_IDS, HOSTS, parseStatus, statusArgs, substitute } from './hosts';
const MAX_EVENTS = 600;
const KEEP_FINISHED_MS = 30 * 60_000;
const STATUS_TTL_MS = 30_000;
const PROBE_TIMEOUT_MS = 15_000;
/** Lines of CLI output safe to show (no ANSI, no control chars, bounded). */
export function cleanLine(line) {
    // eslint-disable-next-line no-control-regex
    return line.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, 400);
}
/** Where butler keeps its login on this platform. */
export function butlerCredsPath(env, platform) {
    const home = env['HOME'] ?? env['USERPROFILE'] ?? homedir();
    if (platform === 'win32')
        return join(env['APPDATA'] ?? join(home, 'AppData', 'Roaming'), 'itch', 'butler_creds');
    if (platform === 'darwin')
        return join(home, 'Library', 'Application Support', 'itch', 'butler_creds');
    return join(env['XDG_CONFIG_HOME'] ?? join(home, '.config'), 'itch', 'butler_creds');
}
/** Runs deploys (see module docs). */
export class DeployJobs {
    deps;
    jobs = new Map();
    running = null;
    statusCache = null;
    env;
    now;
    platform;
    constructor(deps) {
        this.deps = deps;
        this.env = deps.env ?? process.env;
        this.now = deps.now ?? Date.now;
        this.platform = deps.platform ?? process.platform;
    }
    /** The allow-listed environment of every CLI run. */
    childEnv() {
        return restrictedEnv(this.env, { NO_COLOR: '1', CI: '1', FORCE_COLOR: '0' });
    }
    /** Which CLIs are installed and signed in (cached briefly; `fresh` re-probes). */
    async status(fresh = false) {
        if (!fresh && this.statusCache && this.now() - this.statusCache.at < STATUS_TTL_MS)
            return this.statusCache.value;
        const out = await Promise.all(HOST_IDS.map(async (id) => {
            const h = HOSTS[id];
            const bin = which(h.bin, this.env, this.platform);
            if (!bin)
                return { id, label: h.label, bin: h.bin, installed: false, signedIn: false, hint: `Install it: ${h.install}` };
            if (id === 'itch') {
                const signedIn = existsSync(butlerCredsPath(this.env, this.platform));
                return { id, label: h.label, bin: h.bin, installed: true, signedIn, ...(signedIn ? {} : { hint: `Sign in: ${h.login}` }) };
            }
            const dir = await mkdtemp(join(this.deps.tmpRoot ?? tmpdir(), 'aether-probe-'));
            try {
                const r = await runProcess(bin, statusArgs(id), { cwd: dir, env: this.childEnv(), timeoutMs: PROBE_TIMEOUT_MS, maxStdout: 64 * 1024, ...(this.deps.spawn ? { spawn: this.deps.spawn } : {}) });
                const s = parseStatus(id, r.code, r.stdout, r.stderr);
                return { id, label: h.label, bin: h.bin, installed: true, signedIn: s.signedIn, ...(s.account ? { account: s.account } : {}), ...(s.signedIn ? {} : { hint: `Sign in: ${h.login}` }) };
            }
            finally {
                await rm(dir, { recursive: true, force: true }).catch(() => undefined);
            }
        }));
        this.statusCache = { at: this.now(), value: out };
        return out;
    }
    /** A job's view (null when unknown). */
    view(id) {
        this.prune();
        const j = this.jobs.get(id);
        if (!j)
            return null;
        return { id: j.id, target: j.target, build: j.build, state: j.state, step: j.step, steps: j.steps, url: j.url, error: j.error, events: [...j.events] };
    }
    /** Listen for a job's events; returns an unsubscribe function (null when unknown). */
    listen(id, fn) {
        const j = this.jobs.get(id);
        if (!j)
            return null;
        j.listeners.add(fn);
        return () => j.listeners.delete(fn);
    }
    /** Cancel a running job. */
    cancel(id) {
        const j = this.jobs.get(id);
        if (!j || j.state !== 'running')
            return false;
        j.ctrl.abort();
        return true;
    }
    /** True while a job still in the `running` state holds the deploy slot. */
    busy() {
        return this.running?.state === 'running';
    }
    /** Start a deploy. Throws when one is already running or the CLI is not ready. */
    async start(req) {
        this.prune();
        // Only a job still in the `running` state holds the slot: a finished job that is merely
        // removing its own temporary folder must not refuse the next deploy (clients start one
        // as soon as they see the previous job end).
        if (this.busy())
            throw new DeployError(409, 'A deploy is already running. Wait for it or cancel it.');
        if (req.target === 'itch' && !req.itch)
            throw new DeployError(400, 'itch.io needs the game page as user/game.');
        if ((req.target === 'github' || req.target === 'netlify') && !req.name)
            throw new DeployError(400, 'Choose a name for the site.');
        const st = (await this.status(true)).find((s) => s.id === req.target);
        if (!st?.installed)
            throw new DeployError(409, `${HOSTS[req.target].label}: the ${HOSTS[req.target].bin} command is not installed (${HOSTS[req.target].install}).`);
        if (!st.signedIn)
            throw new DeployError(409, `${HOSTS[req.target].label}: sign in first with "${HOSTS[req.target].login}".`);
        if (!(await this.deps.store.meta(req.build)))
            throw new DeployError(404, 'That build does not exist any more. Publish it again.');
        // The checks above awaited: a concurrent request may have taken the slot meanwhile.
        if (this.busy())
            throw new DeployError(409, 'A deploy is already running. Wait for it or cancel it.');
        const id = randomBytes(9).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x').toLowerCase().slice(0, 12);
        const job = { id, target: req.target, build: req.build, state: 'running', step: 0, steps: 0, url: null, error: null, events: [], ctrl: new AbortController(), listeners: new Set(), finishedAt: 0 };
        this.jobs.set(id, job);
        this.running = job;
        void this.run(job, req).finally(() => {
            if (this.running === job)
                this.running = null;
            job.finishedAt = this.now();
        });
        return this.view(id);
    }
    emit(job, kind, text, url) {
        const e = { seq: (job.events[job.events.length - 1]?.seq ?? 0) + 1, at: this.now(), kind, text: cleanLine(text), ...(url ? { url } : {}) };
        job.events.push(e);
        if (job.events.length > MAX_EVENTS)
            job.events.splice(0, job.events.length - MAX_EVENTS);
        for (const fn of job.listeners) {
            try {
                fn(e);
            }
            catch {
                /* a closed stream */
            }
        }
    }
    async run(job, req) {
        const root = await mkdtemp(join(this.deps.tmpRoot ?? tmpdir(), 'aether-deploy-'));
        // The build folder is named after the site: Vercel derives the project name from it.
        const dir = join(root, req.name ?? 'aether-game');
        const scratch = join(root, '.inputs');
        try {
            await mkdir(dir, { recursive: true });
            await mkdir(scratch, { recursive: true });
            this.emit(job, 'step', 'Preparing the build');
            await this.deps.store.copyTo(req.build, dir);
            const files = await listFiles(dir);
            const b64 = new Map();
            if (req.target === 'github')
                for (const f of files)
                    b64.set(f, (await readFile(join(dir, f))).toString('base64'));
            const version = new Date(this.now()).toISOString().replace(/[-:]/g, '').replace(/\..*$/, '');
            const steps = deploySteps(req, files, (f) => b64.get(f) ?? '', version);
            job.steps = steps.length;
            const vars = {};
            let outputs = '';
            const env = this.childEnv();
            for (let i = 0; i < steps.length; i++) {
                if (job.ctrl.signal.aborted)
                    throw new DeployError(499, 'cancelled');
                const step = substitute(steps[i], vars, req);
                job.step = i + 1;
                this.emit(job, 'step', step.label);
                const bin = which(step.bin, this.env, this.platform);
                if (!bin)
                    throw new DeployError(409, `${step.bin} is not installed.`);
                if (step.input) {
                    if (!/^[a-z0-9-]+\.json$/.test(step.input.file))
                        throw new DeployError(500, 'bad step input');
                    await writeFile(join(scratch, step.input.file), JSON.stringify(step.input.json));
                }
                const args = step.args.map((a) => (step.input && a === step.input.file ? join(scratch, a) : a));
                // Every placeholder must have been filled by an earlier step's output.
                if (args.some((a) => /\{[a-z0-9|]+\}/i.test(a)) || (step.input && /"\{[a-z0-9|]+\}"/i.test(JSON.stringify(step.input.json)))) {
                    if (step.optional)
                        continue;
                    throw new DeployError(502, `${step.label}: an earlier step did not report what this one needs.`);
                }
                // Each step runs in its own process group: cancelling or timing out ends the CLI and
                // everything it started (a CLI's children would otherwise keep the step alive).
                const stepTimeout = Math.min(this.deps.stepTimeoutMs ?? 20 * 60_000, step.timeoutMs ?? 5 * 60_000);
                const stepCtrl = new AbortController();
                let child = null;
                let timedOut = false;
                const endGroup = () => {
                    stepCtrl.abort();
                    const pid = child?.pid;
                    if (pid) {
                        killTree(pid, 'SIGTERM');
                        setTimeout(() => killTree(pid, 'SIGKILL'), 2000).unref();
                    }
                };
                const onJobAbort = () => endGroup();
                job.ctrl.signal.addEventListener('abort', onJobAbort, { once: true });
                const timer = setTimeout(() => {
                    timedOut = true;
                    endGroup();
                }, stepTimeout);
                const baseSpawn = this.deps.spawn ?? ((c, a, o) => spawnCli(c, a, o));
                const r = await runProcess(bin, args, {
                    cwd: step.cwd === 'parent' ? root : dir,
                    env,
                    timeoutMs: stepTimeout + 5000,
                    signal: stepCtrl.signal,
                    spawn: (c, a, o) => {
                        child = baseSpawn(c, a, { ...o, detached: this.platform !== 'win32' });
                        return child;
                    },
                    maxStdout: 4 * 1024 * 1024,
                    onLine: (line) => {
                        const l = cleanLine(line);
                        if (l && !/^[a-f0-9]{40}$/.test(l))
                            this.emit(job, 'log', l);
                    },
                });
                clearTimeout(timer);
                job.ctrl.signal.removeEventListener('abort', onJobAbort);
                if (job.ctrl.signal.aborted)
                    throw new DeployError(499, 'cancelled');
                if (timedOut || r.stopped === 'timeout')
                    throw new DeployError(504, `${step.label} timed out.`);
                if (r.stopped === 'aborted')
                    throw new DeployError(499, 'cancelled');
                if (r.spawnError)
                    throw new DeployError(500, `${step.bin} could not start (${r.spawnError.code ?? 'error'}).`);
                outputs += `${r.stdout}\n`;
                if (r.code !== 0) {
                    for (const l of r.stderr.split(/\r?\n/).slice(-6))
                        if (cleanLine(l))
                            this.emit(job, 'log', l);
                    if (step.optional)
                        continue;
                    throw new DeployError(502, `${step.label} failed (exit code ${r.code ?? 'none'}).`);
                }
                Object.assign(vars, step.capture?.(r.stdout) ?? {});
            }
            const url = deployedUrl(req.target, outputs, vars, req);
            if (!url)
                throw new DeployError(502, 'The deploy finished but did not report a public address.');
            job.url = url;
            job.state = 'done';
            this.emit(job, 'done', req.target === 'github' ? 'Published. GitHub Pages may take a minute to go live.' : 'Published.', url);
        }
        catch (e) {
            const cancelled = job.ctrl.signal.aborted || (e instanceof DeployError && e.status === 499);
            job.state = cancelled ? 'cancelled' : 'error';
            job.error = cancelled ? 'Cancelled.' : e instanceof DeployError ? e.message : 'The deploy failed unexpectedly.';
            this.emit(job, 'error', job.error);
        }
        finally {
            await rm(root, { recursive: true, force: true, maxRetries: 2 }).catch(() => undefined);
        }
    }
    prune() {
        const t = this.now();
        for (const [id, j] of this.jobs)
            if (j.state !== 'running' && j.finishedAt > 0 && t - j.finishedAt > KEEP_FINISHED_MS)
                this.jobs.delete(id);
    }
    /** Cancel everything (server shutdown). */
    dispose() {
        for (const j of this.jobs.values())
            j.ctrl.abort();
    }
}
/** An error with an HTTP status. */
export class DeployError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
        this.name = 'DeployError';
    }
}
/** Every file under `dir` (relative, `/`-separated, sorted). */
async function listFiles(dir, rel = '') {
    const out = [];
    for (const name of await readdir(join(dir, rel))) {
        const r = rel ? `${rel}/${name}` : name;
        const st = await stat(join(dir, r));
        if (st.isDirectory())
            out.push(...(await listFiles(dir, r)));
        else if (st.isFile())
            out.push(r);
    }
    return out.sort();
}
