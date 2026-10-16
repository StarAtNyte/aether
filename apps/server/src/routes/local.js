import { streamSSE } from 'hono/streaming';
import { getConnInfo } from '@hono/node-server/conninfo';
import { AccountCreateRequestSchema, AssetJobRequestSchema, BridgeCompleteRequestSchema, CompletionResponseSchema, JOB_ID_RE, ACCOUNT_ID_RE, LoginStartRequestSchema, LogoutRequestSchema, PROJECT_SESSION_RE, ProviderError, } from '@aether/agent';
import { BridgeError, DEFAULT_ACCOUNT_ID } from '@aether/bridge';
import { readJsonBody } from '../http';
import { ADMIN_HEADER, hasSession, secretEquals } from '../local-guard';
const LOOPBACK_ADDR = /^(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|::1|::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3})$/;
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;
/** Headers a reverse proxy adds: their presence means the request did not come straight from this machine. */
const PROXY_HEADERS = ['x-forwarded-for', 'x-real-ip', 'forwarded', 'x-forwarded-host', 'cf-connecting-ip', 'true-client-ip'];
/** Default loopback check: the socket's remote address. */
export function socketIsLoopback(c) {
    try {
        const addr = getConnInfo(c).remote.address;
        return typeof addr === 'string' && LOOPBACK_ADDR.test(addr);
    }
    catch {
        return false;
    }
}
function errorBody(c, code, message, status, retryAfterSec) {
    if (retryAfterSec !== undefined)
        c.header('Retry-After', String(retryAfterSec));
    return c.json({ error: { code, message: message.slice(0, 500) } }, status);
}
function toError(c, e, logger) {
    if (e instanceof BridgeError)
        return errorBody(c, e.code, e.message, e.status, e.retryAfterSec);
    if (e instanceof ProviderError && e.code === 'invalid_response')
        return errorBody(c, 'backend_error', 'The model returned an unusable reply twice. Try again or pick another model.', 502);
    if (e instanceof ProviderError && e.code === 'aborted')
        return errorBody(c, 'backend_error', 'cancelled', 502);
    if (e instanceof Error && /already in progress|not installed|does not exist|not signed in|switch|cannot be removed|At most|Account names|Wait for running/i.test(e.message)) {
        return errorBody(c, 'invalid_request', e.message, 409);
    }
    logger.warn('local ai error', { name: e instanceof Error ? e.name : typeof e });
    return errorBody(c, 'backend_error', 'Local AI hit an unexpected error.', 502);
}
async function jsonBody(c) {
    const r = await readJsonBody(c, { maxStringLength: 8 * 1024 * 1024, maxNodes: 200_000, maxDepth: 64 });
    if (r.ok)
        return r;
    return { ok: false, response: errorBody(c, 'invalid_request', 'The request body is not acceptable JSON.', 400) };
}
/** Register the local AI routes. */
export function registerLocalRoutes(app, deps) {
    const { local, logger } = deps;
    const isLoopback = deps.isLoopback ?? socketIsLoopback;
    app.use('/api/local/*', async (c, next) => {
        if (deps.sessionSecret !== undefined && !hasSession(c, deps.sessionSecret)) {
            return errorBody(c, 'unauthorized', 'Reload the studio from the link printed by "aether start".', 401);
        }
        for (const h of PROXY_HEADERS) {
            if (c.req.header(h) !== undefined)
                return errorBody(c, 'forbidden_host', 'Local AI only answers requests made directly on this computer.', 403);
        }
        if (!LOOPBACK_HOST.test(c.req.header('host') ?? '') || !isLoopback(c))
            return errorBody(c, 'forbidden_host', 'Local AI only answers requests made directly on this computer.', 403);
        return next();
    });
    // The CLI (which holds the session secret) asks for a pairing code and one-click links for hosted studios.
    app.post('/api/local/bridge/pair', (c) => {
        const bridge = deps.bridge;
        if (!bridge)
            return errorBody(c, 'not_found', 'The bridge is off. Start Aether with --origin <https://your-studio>.', 404);
        if (deps.sessionSecret === undefined || !secretEquals(c.req.header(ADMIN_HEADER), deps.sessionSecret))
            return errorBody(c, 'unauthorized', 'Only the aether command can request pairing links.', 401);
        const token = bridge.issue();
        const links = bridge.origins.map((o) => `${o}/?bridge=${encodeURIComponent(bridge.url)}#aether-bridge=${token}`);
        return c.json({ url: bridge.url, code: bridge.code(), links });
    });
    app.get('/api/local/status', async (c) => {
        try {
            return c.json(await local.status());
        }
        catch (e) {
            return toError(c, e, logger);
        }
    });
    app.post('/api/local/complete', async (c) => {
        const body = await jsonBody(c);
        if (!body.ok)
            return body.response;
        const parsed = BridgeCompleteRequestSchema.safeParse(body.value);
        if (!parsed.success)
            return errorBody(c, 'invalid_request', `The completion request is invalid (${parsed.error.issues[0]?.path.join('.') ?? ''}: ${parsed.error.issues[0]?.message ?? ''}).`.slice(0, 300), 400);
        const { backend, model, effort } = parsed.data;
        const { model: _inner, ...request } = parsed.data.request;
        const ctrl = new AbortController();
        const onAbort = () => ctrl.abort();
        c.req.raw.signal.addEventListener('abort', onAbort, { once: true });
        deps.shutdownSignal?.addEventListener('abort', onAbort, { once: true });
        try {
            const out = await local.provider(backend, model, effort).complete(request, ctrl.signal);
            const valid = CompletionResponseSchema.safeParse(out);
            if (!valid.success)
                return errorBody(c, 'backend_error', 'The model returned an unexpected response.', 502);
            return c.json(valid.data);
        }
        catch (e) {
            return toError(c, e, logger);
        }
        finally {
            c.req.raw.signal.removeEventListener('abort', onAbort);
            deps.shutdownSignal?.removeEventListener('abort', onAbort);
        }
    });
    app.delete('/api/local/sessions/:project', (c) => {
        const project = c.req.param('project');
        if (!PROJECT_SESSION_RE.test(project))
            return errorBody(c, 'invalid_request', 'Invalid project key.', 400);
        return c.json({ cleared: local.clearProject(project) });
    });
    // Sign-in with the CLIs' own flows (the machine's default login).
    app.get('/api/local/login', (c) => c.json({ login: local.loginState() }));
    app.post('/api/local/login', async (c) => {
        const body = await jsonBody(c);
        if (!body.ok)
            return body.response;
        const parsed = LoginStartRequestSchema.safeParse(body.value);
        if (!parsed.success)
            return errorBody(c, 'invalid_request', 'Send {"backend": "codex" | "claude-code"}.', 400);
        try {
            return c.json(local.login.start(parsed.data.backend));
        }
        catch (e) {
            return toError(c, e, logger);
        }
    });
    app.post('/api/local/login/cancel', (c) => {
        local.login.cancel();
        return c.json({ login: local.loginState() });
    });
    app.post('/api/local/logout', async (c) => {
        const body = await jsonBody(c);
        if (!body.ok)
            return body.response;
        const parsed = LogoutRequestSchema.safeParse(body.value);
        if (!parsed.success)
            return errorBody(c, 'invalid_request', 'Send {"backend": "codex" | "claude-code"}.', 400);
        try {
            let home;
            if (parsed.data.backend === 'codex' && parsed.data.accountId && parsed.data.accountId !== DEFAULT_ACCOUNT_ID) {
                const h = await local.accounts.homeOf(parsed.data.accountId);
                if (h === undefined)
                    return errorBody(c, 'not_found', 'That account does not exist.', 404);
                home = h ?? undefined;
            }
            const r = await local.login.logout(parsed.data.backend, home);
            local.refresh();
            return c.json(r);
        }
        catch (e) {
            return toError(c, e, logger);
        }
    });
    // Several Codex accounts (manual switching only).
    const accountsList = async () => ({ ...(await local.accounts.list()), jobs: local.jobs.activeCount() });
    app.get('/api/local/accounts', async (c) => {
        try {
            local.loginState();
            return c.json(await accountsList());
        }
        catch (e) {
            return toError(c, e, logger);
        }
    });
    app.post('/api/local/accounts', async (c) => {
        const body = await jsonBody(c);
        if (!body.ok)
            return body.response;
        const parsed = AccountCreateRequestSchema.safeParse(body.value);
        if (!parsed.success)
            return errorBody(c, 'invalid_request', 'Send {"label": "<name>"}.', 400);
        try {
            if (local.login.running)
                return errorBody(c, 'busy', 'A sign-in is already in progress. Finish or cancel it first.', 409);
            const { id, home } = await local.accounts.create(parsed.data.label);
            try {
                return c.json(local.login.start('codex', { home, accountId: id }));
            }
            catch (e) {
                await local.accounts.remove(id).catch(() => undefined);
                throw e;
            }
        }
        catch (e) {
            return toError(c, e, logger);
        }
    });
    app.post('/api/local/accounts/:id/activate', async (c) => {
        const id = c.req.param('id');
        if (!ACCOUNT_ID_RE.test(id))
            return errorBody(c, 'invalid_request', 'Invalid account id.', 400);
        try {
            await local.accounts.activate(id, local.jobs.activeCount() + local.busy);
            local.refresh();
            return c.json(await accountsList());
        }
        catch (e) {
            return toError(c, e, logger);
        }
    });
    app.delete('/api/local/accounts/:id', async (c) => {
        const id = c.req.param('id');
        if (!ACCOUNT_ID_RE.test(id))
            return errorBody(c, 'invalid_request', 'Invalid account id.', 400);
        try {
            await local.accounts.remove(id);
            return c.json(await accountsList());
        }
        catch (e) {
            return toError(c, e, logger);
        }
    });
    // Deep builds (durable queue, progress over server-sent events).
    app.post('/api/local/jobs', async (c) => {
        const body = await jsonBody(c);
        if (!body.ok)
            return body.response;
        const parsed = AssetJobRequestSchema.safeParse(body.value);
        if (!parsed.success)
            return errorBody(c, 'invalid_request', `The job is invalid (${parsed.error.issues[0]?.path.join('.') ?? ''}: ${parsed.error.issues[0]?.message ?? ''}).`.slice(0, 300), 400);
        try {
            return c.json(await local.jobs.enqueueAsset(parsed.data));
        }
        catch (e) {
            return toError(c, e, logger);
        }
    });
    app.get('/api/local/jobs/:id', async (c) => {
        const id = c.req.param('id');
        if (!JOB_ID_RE.test(id))
            return errorBody(c, 'invalid_request', 'Invalid job id.', 400);
        await local.jobs.init();
        const job = local.jobs.get(id);
        return job ? c.json(job) : errorBody(c, 'not_found', 'No such job.', 404);
    });
    app.post('/api/local/jobs/:id/cancel', async (c) => {
        const id = c.req.param('id');
        if (!JOB_ID_RE.test(id))
            return errorBody(c, 'invalid_request', 'Invalid job id.', 400);
        const job = await local.jobs.cancel(id);
        return job ? c.json(job) : errorBody(c, 'not_found', 'No such job.', 404);
    });
    app.get('/api/local/jobs/:id/events', async (c) => {
        const id = c.req.param('id');
        if (!JOB_ID_RE.test(id))
            return errorBody(c, 'invalid_request', 'Invalid job id.', 400);
        const afterRaw = c.req.query('after') ?? c.req.header('last-event-id') ?? '0';
        const after = /^\d{1,7}$/.test(afterRaw) ? Number(afterRaw) : 0;
        await local.jobs.init();
        if (!local.jobs.get(id))
            return errorBody(c, 'not_found', 'No such job.', 404);
        return streamSSE(c, async (stream) => {
            let cursor = after;
            let done = false;
            let wake = null;
            const pending = [];
            // Subscribe first, then replay: nothing is lost between the two.
            const unsubscribe = local.jobs.subscribe(id, (e) => {
                pending.push(e);
                wake?.();
            });
            const onAbort = () => {
                done = true;
                wake?.();
            };
            stream.onAbort(onAbort);
            deps.shutdownSignal?.addEventListener('abort', onAbort, { once: true });
            try {
                for (const e of await local.jobs.eventsAfter(id, cursor)) {
                    await stream.writeSSE({ id: String(e.seq), event: 'progress', data: JSON.stringify(e) });
                    cursor = e.seq;
                }
                const finished = () => {
                    const j = local.jobs.get(id);
                    return !j || (j.status !== 'queued' && j.status !== 'running');
                };
                while (!done && !finished()) {
                    if (pending.length === 0) {
                        await new Promise((resolve) => {
                            wake = resolve;
                            const t = setTimeout(resolve, 15_000);
                            t.unref?.();
                        });
                        wake = null;
                        if (pending.length === 0 && !done)
                            await stream.writeSSE({ event: 'ping', data: '{}' });
                        continue;
                    }
                    const e = pending.shift();
                    if (e === null || e === undefined)
                        break;
                    if (e.seq <= cursor)
                        continue;
                    await stream.writeSSE({ id: String(e.seq), event: 'progress', data: JSON.stringify(e) });
                    cursor = e.seq;
                }
                if (!done) {
                    for (const e of pending) {
                        if (e === null || e.seq <= cursor)
                            continue;
                        await stream.writeSSE({ id: String(e.seq), event: 'progress', data: JSON.stringify(e) });
                        cursor = e.seq;
                    }
                    for (const e of await local.jobs.eventsAfter(id, cursor))
                        await stream.writeSSE({ id: String(e.seq), event: 'progress', data: JSON.stringify(e) });
                    await stream.writeSSE({ event: 'end', data: JSON.stringify(local.jobs.get(id) ?? null) });
                }
            }
            finally {
                unsubscribe();
                deps.shutdownSignal?.removeEventListener('abort', onAbort);
            }
        });
    });
}
