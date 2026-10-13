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
import { JOB_ID_RE, LocalJobSchema, type AssetJobRequestSchema, type JobState, type LocalJob, type LocalJobEvent } from '@aether/agent';
import type { GeneratorDef as GeneratorDefType, Json } from '@aether/core';
import { createNodeSandbox } from '@aether/procgen/node';
import { resolveParams, validateOutput } from '@aether/procgen';
import { BridgeError } from '../errors';
import { readArtifact } from './agentic';
import type { WorkerRunner } from './protocol';
import { createAssetWorkspace, parseAssetArtifact, removeWorkspace, type AssetSpec } from './workspace';

/** Parsed asset job request. */
export type AssetJobInput = z.output<typeof AssetJobRequestSchema>;
/** A persisted job. */
export type JobRecord = LocalJob;
const JobRecordSchema = LocalJobSchema;
/** One progress event of a job. */
export type JobEvent = LocalJobEvent;

/** Options of {@link JobManager}. */
export interface JobManagerOptions {
  /** Folder for job records and event logs. */
  dir: string;
  /** Runs one worker job (normally `runWorker`). */
  runWorker: WorkerRunner;
  /** Codex home of the account a job is frozen to (resolved when queued). */
  accountHome?: () => Promise<{ id: string; home: string | null }>;
  /** Workspace factory (tests). */
  createWorkspace?: typeof createAssetWorkspace;
  /** Validate a generator in the host sandbox (default: node sandbox, three seeds). */
  validate?: (def: GeneratorDefType) => Promise<string | null>;
  now?: () => number;
  /** Jobs kept on disk (oldest finished ones are pruned). */
  keep?: number;
  /** Most queued jobs (on top of the running one). */
  maxQueued?: number;
}

const MAX_EVENTS = 2000;

/** Default host-side validation: node sandbox, three seeds, output validation. */
export async function validateGeneratorDef(def: GeneratorDefType): Promise<string | null> {
  const sandbox = createNodeSandbox({ timeoutMs: 4000 });
  try {
    for (const seed of [1, 7, 42]) {
      const v = validateOutput(await sandbox.run(def, resolveParams(def.params, {} as Record<string, Json>), seed));
      if (!v.ok) return `seed ${seed}: ${v.error}`;
    }
    return null;
  } catch (e) {
    return e instanceof Error ? e.message.slice(0, 300) : 'the generator failed';
  } finally {
    sandbox.dispose();
  }
}

/** The durable job queue. */
export class JobManager {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly events = new Map<string, JobEvent[]>();
  private readonly listeners = new Map<string, Set<(e: JobEvent | null) => void>>();
  private readonly queue: string[] = [];
  private current: { id: string; ctrl: AbortController } | null = null;
  private writes = new Map<string, Promise<void>>();
  private readonly now: () => number;
  private ready: Promise<void> | null = null;
  private disposed = false;

  constructor(private readonly opts: JobManagerOptions) {
    this.now = opts.now ?? Date.now;
  }

  /** Load persisted jobs; interrupted ones become failed. Idempotent. */
  init(): Promise<void> {
    this.ready ??= (async () => {
      await mkdir(this.opts.dir, { recursive: true, mode: 0o700 });
      await chmod(this.opts.dir, 0o700).catch(() => undefined);
      let names: string[] = [];
      try {
        names = (await readdir(this.opts.dir)).filter((n) => /^[0-9a-f-]{36}\.json$/.test(n));
      } catch {
        names = [];
      }
      for (const n of names) {
        try {
          const r = JobRecordSchema.safeParse(JSON.parse(await readFile(join(this.opts.dir, n), 'utf8')) as unknown);
          if (!r.success) continue;
          const rec = r.data;
          if (rec.status === 'queued' || rec.status === 'running') {
            rec.status = 'failed';
            rec.error = 'Interrupted: the AI service restarted.';
            rec.finishedAt = this.now();
            await this.persist(rec);
          }
          this.jobs.set(rec.id, rec);
        } catch {
          /* unreadable record: skip */
        }
      }
      await this.prune();
    })();
    return this.ready;
  }

  private file(id: string, ext: 'json' | 'events.jsonl'): string {
    if (!JOB_ID_RE.test(id)) throw new BridgeError('invalid_request', 'Invalid job id.');
    return join(this.opts.dir, `${id}.${ext}`);
  }

  /** Serialize writes per job. */
  private serial(id: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.writes.get(id) ?? Promise.resolve();
    const next = prev.then(fn, fn).catch(() => undefined);
    this.writes.set(id, next);
    return next;
  }

  private persist(rec: JobRecord): Promise<void> {
    const snapshot = JSON.stringify(rec);
    return this.serial(rec.id, async () => {
      const path = this.file(rec.id, 'json');
      const tmp = `${path}.tmp`;
      await writeFile(tmp, snapshot, { encoding: 'utf8', mode: 0o600 });
      await rename(tmp, path);
    });
  }

  private async prune(): Promise<void> {
    const keep = this.opts.keep ?? 100;
    const finished = [...this.jobs.values()].filter((j) => j.status !== 'queued' && j.status !== 'running').sort((a, b) => a.createdAt - b.createdAt);
    while (finished.length > keep) {
      const old = finished.shift();
      if (!old) break;
      this.jobs.delete(old.id);
      this.events.delete(old.id);
      await rm(this.file(old.id, 'json'), { force: true }).catch(() => undefined);
      await rm(this.file(old.id, 'events.jsonl'), { force: true }).catch(() => undefined);
    }
  }

  /** Jobs queued or running (account switches are refused while > 0). */
  activeCount(): number {
    return this.queue.length + (this.current ? 1 : 0);
  }

  /** Queue an asset build. */
  async enqueueAsset(req: AssetJobInput): Promise<JobRecord> {
    await this.init();
    if (this.disposed) throw new BridgeError('backend_error', 'The AI service is shutting down.');
    if (this.queue.length >= (this.opts.maxQueued ?? 4)) throw new BridgeError('busy', 'Too many builds are waiting. Try again when one finished.', { retryAfterSec: 30 });
    const account = req.backend === 'codex' && this.opts.accountHome ? await this.opts.accountHome() : { id: 'default', home: null };
    const rec: JobRecord = {
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
  private readonly homes = new Map<string, string | null>();

  /** A job by id. */
  get(id: string): JobRecord | undefined {
    const r = this.jobs.get(id);
    return r ? { ...r } : undefined;
  }

  /** Events after `after` (from memory, else from the log on disk). */
  async eventsAfter(id: string, after: number): Promise<JobEvent[]> {
    const mem = this.events.get(id);
    if (mem) return mem.filter((e) => e.seq > after);
    if (!this.jobs.has(id)) return [];
    try {
      const text = await readFile(this.file(id, 'events.jsonl'), 'utf8');
      const out: JobEvent[] = [];
      for (const line of text.split('\n')) {
        if (!line) continue;
        try {
          const e = JSON.parse(line) as JobEvent;
          if (typeof e.seq === 'number' && e.seq > after && typeof e.message === 'string' && typeof e.phase === 'string') out.push({ seq: e.seq, at: Number(e.at) || 0, phase: e.phase.slice(0, 48), message: e.message.slice(0, 500) });
        } catch {
          /* skip a torn line */
        }
      }
      return out;
    } catch {
      return [];
    }
  }

  /** Listen to new events of a job; `null` marks the end of the job. Returns the unsubscribe function. */
  subscribe(id: string, fn: (e: JobEvent | null) => void): () => void {
    let set = this.listeners.get(id);
    if (!set) this.listeners.set(id, (set = new Set()));
    set.add(fn);
    return () => {
      set?.delete(fn);
      if (set && set.size === 0) this.listeners.delete(id);
    };
  }

  private emit(id: string, phase: string, message: string): void {
    const rec = this.jobs.get(id);
    if (!rec || rec.events >= MAX_EVENTS) return;
    const e: JobEvent = { seq: rec.events + 1, at: this.now(), phase: phase.slice(0, 48), message: message.replace(/\s+/g, ' ').slice(0, 500) };
    rec.events = e.seq;
    let list = this.events.get(id);
    if (!list) this.events.set(id, (list = []));
    list.push(e);
    void this.serial(id, () => appendFile(this.file(id, 'events.jsonl'), `${JSON.stringify(e)}\n`, { encoding: 'utf8', mode: 0o600 }));
    for (const fn of this.listeners.get(id) ?? []) {
      try {
        fn(e);
      } catch {
        /* a listener must not break the job */
      }
    }
  }

  private end(id: string): void {
    for (const fn of this.listeners.get(id) ?? []) {
      try {
        fn(null);
      } catch {
        /* ignore */
      }
    }
    // Finished jobs keep their events on disk; memory copies are dropped.
    this.events.delete(id);
  }

  /** Cancel a queued or running job. */
  async cancel(id: string): Promise<JobRecord | undefined> {
    const rec = this.jobs.get(id);
    if (!rec) return undefined;
    const i = this.queue.indexOf(id);
    if (i >= 0) {
      this.queue.splice(i, 1);
      await this.finish(rec, 'cancelled', 'Cancelled.');
    } else if (this.current?.id === id) this.current.ctrl.abort();
    return this.get(id);
  }

  private async finish(rec: JobRecord, status: JobState, error?: string): Promise<void> {
    rec.status = status;
    rec.finishedAt = this.now();
    if (error) rec.error = error.slice(0, 500);
    this.emit(rec.id, status, status === 'done' ? 'Finished' : (error ?? status));
    this.homes.delete(rec.id);
    await this.persist(rec);
    this.end(rec.id);
  }

  private async pump(): Promise<void> {
    if (this.current || this.disposed) return;
    const id = this.queue.shift();
    if (!id) return;
    const rec = this.jobs.get(id);
    if (!rec) return void this.pump();
    const ctrl = new AbortController();
    this.current = { id, ctrl };
    try {
      await this.runAsset(rec, ctrl.signal);
    } finally {
      this.current = null;
      void this.prune();
      void this.pump();
    }
  }

  private async runAsset(rec: JobRecord, signal: AbortSignal): Promise<void> {
    rec.status = 'running';
    rec.startedAt = this.now();
    await this.persist(rec);
    this.emit(rec.id, 'running', 'Preparing the workspace…');
    let ws: { dir: string; task: string; artifact: string } | null = null;
    try {
      ws = await (this.opts.createWorkspace ?? createAssetWorkspace)(rec.spec as AssetSpec);
      const r = await this.opts.runWorker(
        {
          kind: 'agentic',
          backend: rec.backend,
          ...(rec.model ? { model: rec.model } : {}),
          ...(rec.effort ? { effort: rec.effort } : {}),
          workspace: ws.dir,
          task: ws.task,
          artifact: ws.artifact,
          maxTurns: rec.budget.turns,
          codexHome: this.homes.get(rec.id) ?? null,
        },
        { timeoutMs: rec.budget.minutes * 60_000, signal, onProgress: (p) => this.emit(rec.id, p.phase, p.message) },
      );
      if (!r.ok || r.kind !== 'agentic') throw new BridgeError('backend_error', 'The coding agent returned an unexpected result.');
      this.emit(rec.id, 'validate', 'Validating the result in Aether’s sandbox…');
      const parsed = parseAssetArtifact(await readArtifact(ws.dir, ws.artifact), rec.spec.id);
      if (!parsed.ok) throw new BridgeError('backend_error', parsed.error);
      const problem = await (this.opts.validate ?? validateGeneratorDef)(parsed.def);
      if (problem) throw new BridgeError('backend_error', `The generator failed validation: ${problem}`);
      rec.result = { def: parsed.def, turns: r.turns, checkerPassed: r.passed, ...(r.usage ? { usage: r.usage } : {}), ...(r.model ? { model: r.model } : {}) };
      await this.finish(rec, 'done');
    } catch (e) {
      const cancelled = signal.aborted;
      await this.finish(rec, cancelled ? 'cancelled' : 'failed', cancelled ? 'Cancelled.' : e instanceof Error ? e.message : 'The build failed.');
    } finally {
      if (ws) await removeWorkspace(ws.dir);
    }
  }

  /** Stop the running job and refuse new ones (host shutdown). */
  dispose(): void {
    this.disposed = true;
    this.current?.ctrl.abort();
  }
}
