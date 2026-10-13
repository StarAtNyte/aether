/**
 * Request handler of the physics verification worker, written without any
 * worker globals so Node tests can drive it directly. Every message is
 * validated ({@link parseVerifyRequest}), the world is re-validated with
 * `validateWorld`, each request gets its own `AbortController` (a `cancel`
 * message aborts it at the next simulation slice), and every request ends
 * with exactly one terminal reply (`verified`, `diagnosed`, `settled`,
 * `warmed` or `failed`). Handler errors never escape.
 */
import { validateWorld, type WorldDoc } from '@aether/core';
import type { ColliderDesc } from '@aether/procgen';
import type * as Physics from '@aether/physics';
import type { ScriptRunner } from '@aether/logic';
import { createVerifyLogic } from '../headlessHost';
import { parseVerifyRequest, type VerifyReply, type VerifyRequest } from './protocol';

/** The parts of `@aether/physics` the handler uses (lazy; injected for tests). */
export type PhysicsModule = Pick<typeof Physics, 'initPhysics' | 'verify' | 'diagnose' | 'settle'>;

/** Optional sandboxed scripting (QuickJS), loaded only for worlds with scripts. */
export interface ScriptingModule {
  init(): Promise<void>;
  create(seed: number): ScriptRunner | undefined;
}

/** Dependencies of {@link createVerifyHandler}. */
export interface VerifyHandlerDeps {
  /** Loads physics (dynamic import in the worker). */
  physics: () => Promise<PhysicsModule>;
  /** Loads scripting; omitted means worlds with scripts verify without them. */
  scripting?: () => Promise<ScriptingModule>;
  /** Sends a reply (worker `postMessage`). */
  post: (reply: VerifyReply) => void;
  /**
   * Stepping slice before yielding (ms). The worker yields so `cancel`
   * messages are seen; default 25.
   */
  sliceMs?: number;
}

/** A request handler (one per worker). */
export interface VerifyHandler {
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

/** Collider provider over the renderer's colliders sent with the request. */
function providerOf(list: ReadonlyArray<readonly [string, ColliderDesc[]]>): Physics.ColliderProvider | undefined {
  if (list.length === 0) return undefined;
  const map = new Map<string, ColliderDesc[]>(list);
  return (entity) => map.get(entity.id);
}

/** Create the handler. */
export function createVerifyHandler(deps: VerifyHandlerDeps): VerifyHandler {
  const controllers = new Map<number, AbortController>();
  let physics: Promise<PhysicsModule> | null = null;
  let scripting: Promise<ScriptingModule | null> | null = null;
  const sliceMs = deps.sliceMs ?? 25;

  const loadPhysics = async (): Promise<PhysicsModule> => {
    physics ??= deps.physics().then(
      async (m) => {
        await m.initPhysics();
        return m;
      },
      (err: unknown) => {
        physics = null;
        throw err;
      },
    );
    return physics;
  };

  const loadScripting = async (): Promise<ScriptingModule | null> => {
    if (!deps.scripting) return null;
    scripting ??= deps
      .scripting()
      .then(async (m) => {
        await m.init();
        return m;
      })
      .catch(() => null);
    return scripting;
  };

  const send = (reply: VerifyReply): void => {
    try {
      deps.post(reply);
    } catch {
      /* the port is gone; nothing to report to */
    }
  };

  const world = (raw: unknown): WorldDoc => {
    const v = validateWorld(raw);
    if (!v.ok) throw new Error(`invalid world: ${v.issues.slice(0, 3).map((i) => `${i.path} ${i.message}`).join('; ')}`);
    return v.world;
  };

  const run = async (req: Exclude<VerifyRequest, { type: 'cancel' }>, signal: AbortSignal): Promise<void> => {
    if (req.type === 'warm') {
      await loadPhysics();
      if (req.scripting) await loadScripting();
      send({ type: 'warmed', id: req.id });
      return;
    }
    const doc = world(req.world);
    const p = await loadPhysics();
    if (signal.aborted) throw Object.assign(new Error('verification cancelled'), { name: 'AbortError' });
    const colliders = providerOf(req.colliders);
    if (req.type === 'diagnose') {
      const diagnostics = await p.diagnose(doc, colliders ? { colliders } : {});
      send({ type: 'diagnosed', id: req.id, diagnostics });
      return;
    }
    if (req.type === 'settle') {
      const report = await p.settle(doc, { ...(colliders ? { colliders } : {}), ...(req.seconds !== undefined ? { seconds: req.seconds } : {}), ...(req.only ? { only: req.only } : {}) });
      send({ type: 'settled', id: req.id, report });
      return;
    }
    const hasScripts = Object.keys(doc.scripts).length > 0;
    const scripts = hasScripts ? await loadScripting() : null;
    const logic = createVerifyLogic(doc, { scripts: () => scripts?.create(doc.seed) });
    try {
      const report = await p.verify(doc, {
        ...(colliders ? { colliders } : {}),
        logic: logic.factory,
        maxSeconds: req.options.maxSeconds,
        budgetMs: req.options.budgetMs,
        diagnostics: req.options.diagnostics,
        sliceMs,
        signal,
        ...(req.options.tests ? { tests: req.options.tests } : {}),
        onResult: (index, result) => send({ type: 'progress', id: req.id, index, result }),
      });
      send({ type: 'verified', id: req.id, report });
    } finally {
      logic.dispose();
    }
  };

  return {
    get running(): number {
      return controllers.size;
    },
    async handle(data: unknown): Promise<void> {
      const req = parseVerifyRequest(data);
      if (!req) {
        // Malformed: answer when an id can be recovered so the caller does not wait for a timeout.
        const id = typeof data === 'object' && data !== null ? (data as { id?: unknown }).id : undefined;
        if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) send({ type: 'failed', id, error: 'malformed verification request', cancelled: false });
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
        send({ type: 'failed', id: req.id, error: cancelled ? 'verification cancelled' : message(err), cancelled });
      } finally {
        controllers.delete(req.id);
      }
    },
  };
}
