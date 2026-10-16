/**
 * Durable queue of agentic build jobs (deep build): one runs at a time, the
 * rest wait. Every job and its progress events are persisted (a JSON record
 * plus a capped JSON-lines event log, files 0600 in a 0700 folder), so the
 * studio can reconnect and resume a progress stream with an `after` cursor.
 * Jobs that were queued or running when the host stopped are marked failed
 * on the next start. Provider, account, model and effort are frozen into
 * the job when it is queued.
 */
import { randomUUID } from 'node:crypto';
import { appendFile, chmod, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { AssetJobRequestSchema, JOB_ID_RE, LocalJobSchema } from '@aether/agent';
import { BridgeError } from '../errors';
import { readArtifact, runConfinedCheck } from './agentic';
import { createAssetWorkspace, parseAssetArtifact, removeWorkspace } from './workspace';
const JobRecordSchema = LocalJobSchema;
const MAX_EVENTS = 2000;
/**
 * Default host-side validation: write the parsed definition to a new file in
 * the workspace (never following anything the agent left there) and run the
 * checker on it, confined to the workspace with the Node permission model.
 * The studio validates it once more in its own sandbox before use.
 */
export async function validateInWorkspace(def, workspace, env) {
    const name = `out/aether-validate-${randomUUID().slice(0, 8)}.json`;
    try {
        await writeFile(join(workspace, name), JSON.stringify(def), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    }
    catch {
        return 'could not prepare the validation run';
    }
    const r = await runConfinedCheck(workspace, name, env ?? process.env);
    if (r.valid)
        return null;
    const issue = r.report.split('\n').find((l) => l.startsWith('- issue:'));
    return (issue ? issue.replace(/^- issue:\s*/, '') : 'the generator did not pass validation').slice(0, 300);
}
/** The durable job queue. */
export class JobManager {
    opts;
    jobs = new Map();
    events = new Map();
    listeners = new Map();
    queue = [];
    current = null;
    writes = new Map();
    now;
    ready = null;
    disposed = false;
    constructor(opts) {
        this.opts = opts;
        this.now = opts.now ?? Date.now;
    }
    /** Load persisted jobs; interrupted ones become failed. Idempotent. */
    init() {
        this.ready ??= (async () => {
            await mkdir(this.opts.dir, { recursive: true, mode: 0o700 });
            await chmod(this.opts.dir, 0o700).catch(() => undefined);
            let names = [];
            try {
                names = (await readdir(this.opts.dir)).filter((n) => /^[0-9a-f-]{36}\.json$/.test(n));
            }
            catch {
                names = [];
            }
            for (const n of names) {
                try {
                    const r = JobRecordSchema.safeParse(JSON.parse(await readFile(join(this.opts.dir, n), 'utf8')));
                    if (!r.success)
                        continue;
                    const rec = r.data;
                    if (rec.status === 'queued' || rec.status === 'running') {
                        rec.status = 'failed';
                        rec.error = 'Interrupted: the AI service restarted.';
                        rec.finishedAt = this.now();
                        await this.persist(rec);
                    }
                    this.jobs.set(rec.id, rec);
                }
                catch {
                    /* unreadable record: skip */
                }
            }
            await this.prune();
        })();
        return this.ready;
    }
    file(id, ext) {
        if (!JOB_ID_RE.test(id))
            throw new BridgeError('invalid_request', 'Invalid job id.');
        return join(this.opts.dir, `${id}.${ext}`);
    }
    /** Serialize writes per job. */
    serial(id, fn) {
        const prev = this.writes.get(id) ?? Promise.resolve();
        const next = prev.then(fn, fn).catch(() => undefined);
        this.writes.set(id, next);
        return next;
    }
    persist(rec) {
        const snapshot = JSON.stringify(rec);
        return this.serial(rec.id, async () => {
            const path = this.file(rec.id, 'json');
            const tmp = `${path}.tmp`;
            await writeFile(tmp, snapshot, { encoding: 'utf8', mode: 0o600 });
            await rename(tmp, path);
        });
    }
    async prune() {
        const keep = this.opts.keep ?? 100;
        const finished = [...this.jobs.values()].filter((j) => j.status !== 'queued' && j.status !== 'running').sort((a, b) => a.createdAt - b.createdAt);
        while (finished.length > keep) {
            const old = finished.shift();
            if (!old)
                break;
            this.jobs.delete(old.id);
            this.events.delete(old.id);
            await rm(this.file(old.id, 'json'), { force: true }).catch(() => undefined);
            await rm(this.file(old.id, 'events.jsonl'), { force: true }).catch(() => undefined);
        }
    }
    /** Jobs queued or running (account switches are refused while > 0). */
    activeCount() {
        return this.queue.length + (this.current ? 1 : 0);
    }
    /** Queue an asset build. */
    async enqueueAsset(input) {
        const parsed = AssetJobRequestSchema.safeParse(input);
        if (!parsed.success)
            throw new BridgeError('invalid_request', 'The build request is invalid.');
        const req = parsed.data;
        await this.init();
        if (this.disposed)
            throw new BridgeError('backend_error', 'The AI service is shutting down.');
        if (this.queue.length >= (this.opts.maxQueued ?? 4))
            throw new BridgeError('busy', 'Too many builds are waiting. Try again when one finished.', { retryAfterSec: 30 });
        const account = req.backend === 'codex' && this.opts.accountHome ? await this.opts.accountHome() : { id: 'default', home: null };
        const rec = {
            id: randomUUID(),
            kind: 'asset',
            backend: req.backend,
            accountId: account.id,
            ...(req.model ? { model: req.model } : {}),
            ...(req.effort ? { effort: req.effort } : {}),
            spec: { id: req.spec.id, description: req.spec.description, ...(req.spec.paramsHint ? { paramsHint: req.spec.paramsHint } : {}) },
            budget: { turns: req.budget.turns, minutes: req.budget.minutes },
            status: 'queued',
            createdAt: this.now(),
            events: 0,
        };
        this.jobs.set(rec.id, rec);
        this.homes.set(rec.id, account.home);
        await this.persist(rec);
        this.queue.push(rec.id);
        this.emit(rec.id, 'queued', this.current ? 'Waiting for the current build to finish…' : 'Queued');
        void this.pump();
        return { ...rec };
    }
    /** Codex homes frozen per queued job (not persisted: homes are host paths). */
    homes = new Map();
    /** A job by id. */
    get(id) {
        const r = this.jobs.get(id);
        return r ? { ...r } : undefined;
    }
    /** Events after `after` (from memory, else from the log on disk). */
    async eventsAfter(id, after) {
        const mem = this.events.get(id);
        if (mem)
            return mem.filter((e) => e.seq > after);
        if (!this.jobs.has(id))
            return [];
        try {
            const text = await readFile(this.file(id, 'events.jsonl'), 'utf8');
            const out = [];
            for (const line of text.split('\n')) {
                if (!line)
                    continue;
                try {
                    const e = JSON.parse(line);
                    if (typeof e.seq === 'number' && e.seq > after && typeof e.message === 'string' && typeof e.phase === 'string')
                        out.push({ seq: e.seq, at: Number(e.at) || 0, phase: e.phase.slice(0, 48), message: e.message.slice(0, 500) });
                }
                catch {
                    /* skip a torn line */
                }
            }
            return out;
        }
        catch {
            return [];
        }
    }
    /** Listen to new events of a job; `null` marks the end of the job. Returns the unsubscribe function. */
    subscribe(id, fn) {
        let set = this.listeners.get(id);
        if (!set)
            this.listeners.set(id, (set = new Set()));
        set.add(fn);
        return () => {
            set?.delete(fn);
            if (set && set.size === 0)
                this.listeners.delete(id);
        };
    }
    emit(id, phase, message) {
        const rec = this.jobs.get(id);
        if (!rec || rec.events >= MAX_EVENTS)
            return;
        const e = { seq: rec.events + 1, at: this.now(), phase: phase.slice(0, 48), message: message.replace(/\s+/g, ' ').slice(0, 500) };
        rec.events = e.seq;
        let list = this.events.get(id);
        if (!list)
            this.events.set(id, (list = []));
        list.push(e);
        void this.serial(id, () => appendFile(this.file(id, 'events.jsonl'), `${JSON.stringify(e)}\n`, { encoding: 'utf8', mode: 0o600 }));
        for (const fn of this.listeners.get(id) ?? []) {
            try {
                fn(e);
            }
            catch {
                /* a listener must not break the job */
            }
        }
    }
    end(id) {
        for (const fn of this.listeners.get(id) ?? []) {
            try {
                fn(null);
            }
            catch {
                /* ignore */
            }
        }
        // Finished jobs keep their events on disk; memory copies are dropped.
        this.events.delete(id);
    }
    /** Cancel a queued or running job. */
    async cancel(id) {
        const rec = this.jobs.get(id);
        if (!rec)
            return undefined;
        const i = this.queue.indexOf(id);
        if (i >= 0) {
            this.queue.splice(i, 1);
            await this.finish(rec, 'cancelled', 'Cancelled.');
        }
        else if (this.current?.id === id)
            this.current.ctrl.abort();
        return this.get(id);
    }
    async finish(rec, status, error) {
        rec.status = status;
        rec.finishedAt = this.now();
        if (error)
            rec.error = error.slice(0, 500);
        this.emit(rec.id, status, status === 'done' ? 'Finished' : (error ?? status));
        this.homes.delete(rec.id);
        await this.persist(rec);
        this.end(rec.id);
    }
    async pump() {
        if (this.current || this.disposed)
            return;
        const id = this.queue.shift();
        if (!id)
            return;
        const rec = this.jobs.get(id);
        if (!rec)
            return void this.pump();
        const ctrl = new AbortController();
        this.current = { id, ctrl };
        try {
            await this.runAsset(rec, ctrl.signal);
        }
        finally {
            this.current = null;
            void this.prune();
            void this.pump();
        }
    }
    async runAsset(rec, signal) {
        rec.status = 'running';
        rec.startedAt = this.now();
        await this.persist(rec);
        this.emit(rec.id, 'running', 'Preparing the workspace…');
        let ws = null;
        let outcome = { status: 'failed', error: 'The build failed.' };
        try {
            ws = await (this.opts.createWorkspace ?? createAssetWorkspace)(rec.spec);
            if (signal.aborted)
                throw new BridgeError('backend_error', 'cancelled');
            const r = await this.opts.runWorker({
                kind: 'agentic',
                backend: rec.backend,
                ...(rec.model ? { model: rec.model } : {}),
                ...(rec.effort ? { effort: rec.effort } : {}),
                workspace: ws.dir,
                task: ws.task,
                artifact: ws.artifact,
                maxTurns: rec.budget.turns,
                codexHome: this.homes.get(rec.id) ?? null,
            }, { timeoutMs: rec.budget.minutes * 60_000, signal, onProgress: (p) => this.emit(rec.id, p.phase, p.message) });
            if (!r.ok || r.kind !== 'agentic')
                throw new BridgeError('backend_error', 'The coding agent returned an unexpected result.');
            this.emit(rec.id, 'validate', 'Validating the result in Aether’s sandbox…');
            // Only the final artifact is used, and it is validated again here.
            const parsed = parseAssetArtifact(await readArtifact(ws.dir, ws.artifact), rec.spec.id);
            if (!parsed.ok)
                throw new BridgeError('backend_error', parsed.error);
            const problem = await (this.opts.validate ?? ((d, w) => validateInWorkspace(d, w)))(parsed.def, ws.dir);
            if (problem)
                throw new BridgeError('backend_error', `The generator failed validation: ${problem}`);
            // A cancel that arrives while the result is being validated still wins.
            if (signal.aborted)
                throw new BridgeError('backend_error', 'cancelled');
            rec.result = { def: parsed.def, turns: r.turns, checkerPassed: r.passed, ...(r.usage ? { usage: r.usage } : {}), ...(r.model ? { model: r.model } : {}) };
            outcome = { status: 'done' };
        }
        catch (e) {
            outcome = signal.aborted ? { status: 'cancelled', error: 'Cancelled.' } : { status: 'failed', error: e instanceof Error ? e.message : 'The build failed.' };
        }
        finally {
            // The workspace is gone before anyone hears that the job ended.
            if (ws)
                await removeWorkspace(ws.dir);
        }
        await this.finish(rec, outcome.status, outcome.error);
    }
    /** Stop the running job and refuse new ones (host shutdown). */
    dispose() {
        this.disposed = true;
        this.current?.ctrl.abort();
    }
}
