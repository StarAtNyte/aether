import { errorMessage, isAbortError, ProviderError } from './errors';
/** Wrap `primary` with an automatic switch to `fallback`. */
export function createFallbackProvider(opts) {
    let notice = null;
    const should = opts.shouldFallback ?? ((err) => !isAbortError(err));
    return {
        get name() {
            return notice ? opts.fallback.name : opts.primary.name;
        },
        get fellBack() {
            return notice;
        },
        async complete(req, signal) {
            if (notice)
                return opts.fallback.complete(req, signal);
            try {
                return await opts.primary.complete(req, signal);
            }
            catch (err) {
                if (signal?.aborted || !should(err))
                    throw err;
                notice = {
                    from: opts.primary.name,
                    to: opts.fallback.name,
                    code: err instanceof ProviderError ? err.code : 'error',
                    reason: err instanceof ProviderError ? err.reason : undefined,
                    message: errorMessage(err).slice(0, 300),
                };
                opts.onFallback?.(notice);
                return opts.fallback.complete(req, signal);
            }
        },
    };
}
