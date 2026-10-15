/**
 * Request handler of the playtest worker, written without worker globals so
 * Node tests can drive it directly. Every message is validated, the world is
 * re-validated with `validateWorld`, each request gets its own
 * `AbortController` (a `cancel` message aborts it), progress streams while
 * the bot plays, and every request ends with exactly one terminal reply.
 * Handler errors never escape.
 */
import { validateWorld, type WorldDoc } from '@aether/core';
import type { ScriptRunner } from '@aether/logic';
import type * as Playtest from '@aether/playtest';
import { parsePlaytestRequest, type PlaytestReply, type PlaytestRequest } from './protocol';

/** The parts of `@aether/playtest` the handler uses (lazy; injected for tests). */
export type PlaytestModule = Pick<typeof Playtest, 'playtest' | 'walkthrough'>;

/** Optional sandboxed scripting (QuickJS), loaded only for worlds with scripts. */
export interface PlaytestScripting {
  init(): Promise<void>;
  create(seed: number): ScriptRunner | undefined;
}

/** Dependencies of {@link createPlaytestHandler}. */
export interface PlaytestHandlerDeps {
  /** Loads the bot (dynamic import in the worker). */
  bot: () => Promise<PlaytestModule>;
  /** Loads scripting; omitted means worlds with scripts are played without them. */
  scripting?: () => Promise<PlaytestScripting>;
  /** Sends a reply (worker `postMessage`). */
  post: (reply: PlaytestReply, transfer?: Transferable[]) => void;
}

/** A request handler (one per worker). */
export interface PlaytestHandler {
  /** Handle one raw message; resolves when the request finished (cancel resolves at once). */
  handle(data: unknown): Promise<void>;
  /** Requests currently running. */
  readonly running: number;
}

const MAX_ERROR = 600;

function message(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, MAX_ERROR);
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/** Create the handler. */
export function createPlaytestHandler(deps: PlaytestHandlerDeps): PlaytestHandler {
  const controllers = new Map<number, AbortController>();
  let bot: Promise<PlaytestModule> | null = null;
  let scripting: Promise<PlaytestScripting | null> | null = null;

  const loadBot = (): Promise<PlaytestModule> => {
    bot ??= deps.bot().catch((err: unknown) => {
      bot = null;
      throw err;
    });
    return bot;
  };

  const loadScripting = (): Promise<PlaytestScripting | null> => {
    if (!deps.scripting) return Promise.resolve(null);
    scripting ??= deps
      .scripting()
      .then(async (m) => {
        await m.init();
        return m;
      })
      .catch(() => null);
    return scripting;
  };

  const send = (reply: PlaytestReply, transfer?: Transferable[]): void => {
    try {
      deps.post(reply, transfer);
    } catch {
      /* the port is gone; nothing to report to */
    }
  };

  const world = (raw: unknown): WorldDoc => {
    const v = validateWorld(raw);
    if (!v.ok) throw new Error(`invalid world: ${v.issues.slice(0, 3).map((i) => `${i.path} ${i.message}`).join('; ')}`);
    return v.world;
  };

  const run = async (req: Exclude<PlaytestRequest, { type: 'cancel' }>, signal: AbortSignal): Promise<void> => {
    const m = await loadBot();
    if (req.type === 'warm') {
      send({ type: 'warmed', id: req.id });
      return;
    }
    const doc = world(req.world);
    if (signal.aborted) throw Object.assign(new Error('playtest cancelled'), { name: 'AbortError' });
    const scripts = Object.keys(doc.scripts).length > 0 ? await loadScripting() : null;
    const play = req.kind === 'walkthrough' ? m.walkthrough : m.playtest;
    const report = await play(doc, {
      maxSimSeconds: req.options.maxSimSeconds,
      budgetMs: req.options.budgetMs,
      trace: req.options.trace,
      signal,
      ...(scripts ? { scripts: () => scripts.create(doc.seed) } : {}),
      onProgress: (progress) => send({ type: 'progress', id: req.id, progress }),
    });
    send({ type: 'done', id: req.id, report }, report.trace ? [report.trace.poses.buffer as ArrayBuffer] : []);
  };

  return {
    get running(): number {
      return controllers.size;
    },
    async handle(data: unknown): Promise<void> {
      const req = parsePlaytestRequest(data);
      if (!req) {
        const id = typeof data === 'object' && data !== null ? (data as { id?: unknown }).id : undefined;
        if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) send({ type: 'failed', id, error: 'malformed playtest request', cancelled: false });
        return;
      }
      if (req.type === 'cancel') {
        controllers.get(req.id)?.abort();
        return;
      }
      if (controllers.has(req.id)) {
        send({ type: 'failed', id: req.id, error: 'duplicate request id', cancelled: false });
        return;
      }
      const ctrl = new AbortController();
      controllers.set(req.id, ctrl);
      try {
        await run(req, ctrl.signal);
      } catch (err) {
        const cancelled = ctrl.signal.aborted || isAbort(err);
        send({ type: 'failed', id: req.id, error: cancelled ? 'playtest cancelled' : message(err), cancelled });
      } finally {
        controllers.delete(req.id);
      }
    },
  };
}
