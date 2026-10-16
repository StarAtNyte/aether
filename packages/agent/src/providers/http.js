import { CompletionResponseSchema } from '../wire';
import { ProviderError } from './errors';
import { postJson } from './transport';
function describeError(status, body) {
    if (typeof body === 'object' && body !== null && 'error' in body) {
        const e = body.error;
        if (typeof e === 'string')
            return `server error ${status}: ${e.slice(0, 300)}`;
        if (typeof e === 'object' && e !== null && 'message' in e && typeof e.message === 'string') {
            return `server error ${status}: ${e.message.slice(0, 300)}`;
        }
    }
    return `server error ${status}`;
}
/** Create a provider that talks to the Aether server's `/api/llm` proxy. */
export function createHttpProvider(opts) {
    if (!opts.endpoint)
        throw new ProviderError('bad_request', 'endpoint is required');
    const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    return {
        name: opts.name ?? 'http',
        async complete(req, signal) {
            // Clients never choose models: the server maps `role` to an allowlisted model.
            const body = { ...req };
            delete body.model;
            const json = await postJson({
                url: opts.endpoint,
                headers: { ...opts.headers, 'content-type': 'application/json' },
                body,
                fetch: doFetch,
                describeError,
                policy: { maxRetries: 2, timeoutMs: 240_000, ...opts.retry },
                ...(signal ? { signal } : {}),
            });
            const parsed = CompletionResponseSchema.safeParse(json);
            if (!parsed.success)
                throw new ProviderError('invalid_response', 'server returned a malformed completion');
            return parsed.data;
        },
    };
}
