/**
 * Parent side of `complete` jobs: a {@link TextBackend} that runs every call
 * in a fresh worker process (crash isolation) through one shared queue (one
 * call at a time, a few waiting). Resumable conversations stay in the
 * parent's {@link SessionStore}: the worker gets the remembered conversation
 * for the call's session key and hands back the updated one.
 */
import { rm } from 'node:fs/promises';
import type { BridgeBackendId, TextBackend, TextCompletionRequest, TextCompletionResult } from '@aether/agent';
import { BridgeError } from '../errors';
import { JobQueue } from '../queue';
import { SessionStore, type SessionEntry } from '../sessions';
import type { WorkerJob, WorkerResult, WorkerRunner } from './protocol';

/** Options of {@link createWorkerTextBackend}. */
export interface WorkerTextBackendOptions {
  backend: BridgeBackendId;
  /** Runs one worker job (normally `runWorker`). */
  runWorker: WorkerRunner;
  /** Shared queue (one interactive call at a time across backends). */
  queue: JobQueue;
  /** Conversations per project (shared across backends; keys include the backend). */
  sessions?: SessionStore;
  /** Codex home of the active account (null: machine default). */
  codexHome?: () => Promise<string | null>;
  timeoutMs?: number;
  /** Count of running calls changes (busy indicator). */
  onActive?: (delta: 1 | -1) => void;
}

/** A session store whose evicted Claude Code conversations lose their private folder. */
export function createWorkerSessionStore(now?: () => number): SessionStore {
  return new SessionStore((e: SessionEntry) => {
    if (e.dir && /aether-claude-session-/.test(e.dir)) void rm(e.dir, { recursive: true, force: true }).catch(() => undefined);
  }, now);
}

/** A text backend that runs each call in a worker process. */
export function createWorkerTextBackend(opts: WorkerTextBackendOptions): TextBackend {
  const timeoutMs = opts.timeoutMs ?? 240_000;
  const sessionId = opts.backend === 'codex' ? 'codex' : 'claude-code';
  return {
    name: opts.backend === 'codex' ? 'Codex' : 'Claude Code',
    strictSchema: opts.backend === 'codex',
    complete(req: TextCompletionRequest, signal?: AbortSignal): Promise<TextCompletionResult> {
      return opts.queue.run(async () => {
        opts.onActive?.(1);
        try {
          const key = req.session?.key;
          const known = key ? opts.sessions?.peek(key, sessionId, req.model) : undefined;
          const job: WorkerJob = {
            kind: 'complete',
            backend: opts.backend,
            request: {
              role: req.role,
              system: req.system,
              prompt: req.prompt,
              schema: req.schema as Record<string, unknown>,
              images: req.images.slice(0, 4),
              ...(req.imageKeys ? { imageKeys: [...req.imageKeys].slice(0, 4) } : {}),
              ...(req.toolNames ? { toolNames: [...req.toolNames].slice(0, 64) } : {}),
              ...(req.model ? { model: req.model } : {}),
              ...(req.effort ? { effort: req.effort } : {}),
              ...(req.maxOutputTokens ? { maxOutputTokens: req.maxOutputTokens } : {}),
              ...(req.session && opts.sessions ? { session: req.session } : {}),
            },
            ...(known ? { session: { id: known.id, systemHash: known.systemHash, body: known.body, ...(known.dir ? { dir: known.dir } : {}), ...(known.totals ? { totals: known.totals } : {}) } } : {}),
            codexHome: opts.backend === 'codex' && opts.codexHome ? await opts.codexHome() : null,
            timeoutMs,
          };
          let r: WorkerResult;
          try {
            r = await opts.runWorker(job, { timeoutMs: timeoutMs + 15_000, ...(signal ? { signal } : {}) });
          } catch (e) {
            // A failed call never resumes the conversation it may have broken.
            if (key && known) opts.sessions?.forget(key, sessionId, req.model);
            throw e;
          }
          if (!r.ok || r.kind !== 'complete') throw new BridgeError('backend_error', 'The AI worker returned an unexpected result.');
          if (key && opts.sessions) {
            if (r.session) opts.sessions.record(key, sessionId, req.model, r.session);
            else if (known) opts.sessions.forget(key, sessionId, req.model);
          }
          return {
            text: r.text,
            ...(r.structured !== undefined ? { structured: r.structured } : {}),
            ...(r.usage ? { usage: r.usage } : {}),
            ...(r.model ? { model: r.model } : {}),
            ...(r.resumed ? { resumed: true } : {}),
          };
        } finally {
          opts.onActive?.(-1);
        }
      }, signal);
    },
  };
}
