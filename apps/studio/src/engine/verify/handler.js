/**
 * Request handler of the physics verification worker, written without any
 * worker globals so Node tests can drive it directly. Every message is
 * validated ({@link parseVerifyRequest}), the world is re-validated with
 * `validateWorld`, each request gets its own `AbortController` (a `cancel`
 * message aborts it at the next simulation slice), and every request ends
 * with exactly one terminal reply (`verified`, `diagnosed`, `settled`,
 * `warmed` or `failed`). Handler errors never escape.
 */
import { validateWorld } from '@aether/core';
import { createVerifyLogic } from '../headlessHost';
import { parseVerifyRequest } from './protocol';
const MAX_ERROR = 600;
function message(err) {
    return (err instanceof Error ? err.message : String(err)).slice(0, MAX_ERROR);
}
function isAbort(err) {
    return err instanceof Error && err.name === 'AbortError';
}
/** Collider provider over the renderer's colliders sent with the request. */
function providerOf(list) {
    if (list.length === 0)
        return undefined;
    const map = new Map(list);
    return (entity) => map.get(entity.id);
}
/** Create the handler. */
export function createVerifyHandler(deps) {
    const controllers = new Map();
    let physics = null;
    let scripting = null;
    const sliceMs = deps.sliceMs ?? 25;
    const loadPhysics = async () => {
        physics ??= deps.physics().then(async (m) => {
            await m.initPhysics();
            return m;
        }, (err) => {
            physics = null;
            throw err;
        });
        return physics;
    };
    const loadScripting = async () => {
        if (!deps.scripting)
            return null;
        scripting ??= deps
            .scripting()
            .then(async (m) => {
            await m.init();
            return m;
        })
            .catch(() => null);
        return scripting;
    };
    const send = (reply) => {
        try {
            deps.post(reply);
        }
        catch {
            /* the port is gone; nothing to report to */
        }
    };
    const world = (raw) => {
        const v = validateWorld(raw);
        if (!v.ok)
            throw new Error(`invalid world: ${v.issues.slice(0, 3).map((i) => `${i.path} ${i.message}`).join('; ')}`);
        return v.world;
    };
    const run = async (req, signal) => {
        if (req.type === 'warm') {
            await loadPhysics();
            if (req.scripting)
                await loadScripting();
            send({ type: 'warmed', id: req.id });
            return;
        }
        const doc = world(req.world);
        const p = await loadPhysics();
        if (signal.aborted)
            throw Object.assign(new Error('verification cancelled'), { name: 'AbortError' });
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
                ...(req.options.trace ? { trace: true } : {}),
                onResult: (index, result) => send({ type: 'progress', id: req.id, index, result }),
            });
            send({ type: 'verified', id: req.id, report });
        }
        finally {
            logic.dispose();
        }
    };
    return {
        get running() {
            return controllers.size;
        },
        async handle(data) {
            const req = parseVerifyRequest(data);
            if (!req) {
                // Malformed: answer when an id can be recovered so the caller does not wait for a timeout.
                const id = typeof data === 'object' && data !== null ? data.id : undefined;
                if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0)
                    send({ type: 'failed', id, error: 'malformed verification request', cancelled: false });
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
            }
            catch (err) {
                const cancelled = ctrl.signal.aborted || isAbort(err);
                send({ type: 'failed', id: req.id, error: cancelled ? 'verification cancelled' : message(err), cancelled });
            }
            finally {
                controllers.delete(req.id);
            }
        },
    };
}
