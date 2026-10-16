/**
 * Request handler of the playtest worker, written without worker globals so
 * Node tests can drive it directly. Every message is validated, the world is
 * re-validated with `validateWorld`, each request gets its own
 * `AbortController` (a `cancel` message aborts it), progress streams while
 * the bot plays, and every request ends with exactly one terminal reply.
 * Handler errors never escape.
 */
import { validateWorld } from '@aether/core';
import { parsePlaytestRequest } from './protocol';
const MAX_ERROR = 600;
function message(err) {
    return (err instanceof Error ? err.message : String(err)).slice(0, MAX_ERROR);
}
function isAbort(err) {
    return err instanceof Error && err.name === 'AbortError';
}
/** Create the handler. */
export function createPlaytestHandler(deps) {
    const controllers = new Map();
    let bot = null;
    let scripting = null;
    const loadBot = () => {
        bot ??= deps.bot().catch((err) => {
            bot = null;
            throw err;
        });
        return bot;
    };
    const loadScripting = () => {
        if (!deps.scripting)
            return Promise.resolve(null);
        scripting ??= deps
            .scripting()
            .then(async (m) => {
            await m.init();
            return m;
        })
            .catch(() => null);
        return scripting;
    };
    const send = (reply, transfer) => {
        try {
            deps.post(reply, transfer);
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
        const m = await loadBot();
        if (req.type === 'warm') {
            send({ type: 'warmed', id: req.id });
            return;
        }
        const doc = world(req.world);
        if (signal.aborted)
            throw Object.assign(new Error('playtest cancelled'), { name: 'AbortError' });
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
        send({ type: 'done', id: req.id, report }, report.trace ? [report.trace.poses.buffer] : []);
    };
    return {
        get running() {
            return controllers.size;
        },
        async handle(data) {
            const req = parsePlaytestRequest(data);
            if (!req) {
                const id = typeof data === 'object' && data !== null ? data.id : undefined;
                if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0)
                    send({ type: 'failed', id, error: 'malformed playtest request', cancelled: false });
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
                send({ type: 'failed', id: req.id, error: cancelled ? 'playtest cancelled' : message(err), cancelled });
            }
            finally {
                controllers.delete(req.id);
            }
        },
    };
}
