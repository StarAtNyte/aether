import { fail, readJsonBody, zodToIssues } from '../http';
import { mapUpstreamError } from '../llm/errors';
import { CompletionRequestSchema, CompletionResponseSchema, LLM_LIMITS } from '../llm/schema';
/** Rough token estimate (≈ 4 chars/token) used when upstream omits usage. */
function estimateTokens(chars) {
    return Math.ceil(chars / 4);
}
/** Register `POST /api/llm` on `app`. */
export function registerLlmRoutes(app, deps) {
    app.post('/api/llm', async (c) => {
        const llm = deps.llm;
        if (!llm)
            return fail(c, 503, 'mock-mode', 'No LLM provider is configured on the server; use the local mock provider.');
        const budget = deps.budget.status();
        if (budget.exhausted) {
            c.header('Retry-After', String(budget.resetInSec));
            return fail(c, 429, 'token-budget-exhausted', 'The daily AI budget for this deployment is used up. Please try again tomorrow.');
        }
        const body = await readJsonBody(c, { maxStringLength: LLM_LIMITS.MAX_IMAGE_DATA_URL + 64, maxNodes: 200_000, maxDepth: 64 });
        if (!body.ok)
            return body.response;
        const parsed = CompletionRequestSchema.safeParse(body.value);
        if (!parsed.success)
            return fail(c, 400, 'invalid-request', 'The completion request is invalid.', zodToIssues(parsed.error.issues));
        const model = llm.models[parsed.data.role];
        const upstreamReq = {
            ...parsed.data,
            model,
            maxTokens: Math.min(parsed.data.maxTokens ?? deps.maxOutputTokens, deps.maxOutputTokens),
        };
        const controller = new AbortController();
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            controller.abort(new Error('upstream timeout'));
        }, deps.timeoutMs);
        const clientSignal = c.req.raw.signal;
        const onClientAbort = () => controller.abort(new Error('client disconnected'));
        clientSignal.addEventListener('abort', onClientAbort, { once: true });
        deps.shutdownSignal?.addEventListener('abort', onClientAbort, { once: true });
        const started = performance.now();
        let raw;
        try {
            raw = await llm.provider.complete(upstreamReq, controller.signal);
        }
        catch (err) {
            if (deps.shutdownSignal?.aborted)
                return fail(c, 503, 'shutting-down', 'The server is restarting. Please retry.');
            if (clientSignal.aborted && !timedOut)
                return fail(c, 408, 'request-aborted', 'The request was cancelled.');
            const safe = mapUpstreamError(err, timedOut);
            deps.logger.warn('llm upstream failure', {
                reqId: c.get('requestId'),
                provider: llm.provider.name,
                role: parsed.data.role,
                code: safe.code,
                upstreamStatus: safe.upstreamStatus,
                errorName: err instanceof Error ? err.name : typeof err,
                error: err instanceof Error ? err.message : undefined,
            });
            if (safe.code === 'upstream-rate-limited')
                c.header('Retry-After', '10');
            return fail(c, safe.status, safe.code, safe.message);
        }
        finally {
            clearTimeout(timer);
            clientSignal.removeEventListener('abort', onClientAbort);
            deps.shutdownSignal?.removeEventListener('abort', onClientAbort);
        }
        const response = CompletionResponseSchema.safeParse(raw);
        if (!response.success) {
            deps.logger.warn('llm upstream invalid response', { reqId: c.get('requestId'), provider: llm.provider.name });
            return fail(c, 502, 'upstream-invalid-response', 'The language model returned an unexpected response.');
        }
        const out = { ...response.data, model };
        const usage = out.usage;
        const tokens = usage
            ? usage.inputTokens + usage.outputTokens
            : estimateTokens(JSON.stringify(upstreamReq).length + JSON.stringify(out.content).length);
        deps.budget.record(tokens);
        deps.logger.info('llm completion', {
            reqId: c.get('requestId'),
            provider: llm.provider.name,
            role: parsed.data.role,
            model,
            tokens,
            upstreamMs: Math.round(performance.now() - started),
            stopReason: out.stopReason,
        });
        return c.json(out, 200);
    });
}
