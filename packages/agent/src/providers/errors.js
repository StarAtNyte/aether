/**
 * Normalized provider errors. Every provider throws {@link ProviderError} so the
 * agent loop and the server proxy can map failures without parsing vendor text.
 */
/** An error raised by a provider; `retryable` tells callers whether a retry may help. */
export class ProviderError extends Error {
    code;
    status;
    retryable;
    /** Server-suggested wait before retrying, in milliseconds. */
    retryAfterMs;
    /** Finer, backend-specific reason (e.g. 'not_logged_in', 'cli_missing', 'bridge_offline'); shown in setup/fallback UX. */
    reason;
    constructor(code, message, opts = {}) {
        super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
        this.name = 'ProviderError';
        this.code = code;
        this.status = opts.status;
        this.retryAfterMs = opts.retryAfterMs;
        this.reason = opts.reason;
        this.retryable = code === 'rate_limit' || code === 'overloaded' || code === 'server' || code === 'timeout' || code === 'network';
    }
}
/** Map an HTTP status to a {@link ProviderErrorCode}. */
export function codeForStatus(status) {
    if (status === 401)
        return 'auth';
    if (status === 403)
        return 'permission';
    if (status === 404)
        return 'not_found';
    if (status === 408)
        return 'timeout';
    if (status === 409)
        return 'server';
    if (status === 413)
        return 'too_large';
    if (status === 429)
        return 'rate_limit';
    if (status === 529 || status === 503)
        return 'overloaded';
    if (status >= 500)
        return 'server';
    return 'bad_request';
}
/** True when `e` represents an abort triggered by the caller. */
export function isAbortError(e) {
    return (e instanceof ProviderError && e.code === 'aborted') || (e instanceof Error && e.name === 'AbortError');
}
/** Human-readable message for any thrown value (never includes stack traces). */
export function errorMessage(e) {
    if (e instanceof Error)
        return e.message;
    if (typeof e === 'string')
        return e;
    return 'unknown error';
}
