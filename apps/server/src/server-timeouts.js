/**
 * Socket-level timeouts of the Node HTTP server.
 *
 * Hosting proxies (Fly.io, Render, load balancers) keep idle upstream
 * connections open for about 60 s. If Node closed an idle keep-alive socket
 * first, a request the proxy sends on it at the same moment fails with a 502,
 * so the keep-alive timeout is longer than any common proxy idle timeout, and
 * the header timeout is longer still (Node requires `headersTimeout` >
 * `keepAliveTimeout` for this to hold). `requestTimeout` bounds how long a
 * client may take to send one whole request (slow-loris defence); it does not
 * limit how long a response (an LLM call, an event stream) may take.
 */
/** Production defaults. */
export const HTTP_TIMEOUTS = Object.freeze({
    keepAliveTimeoutMs: 65_000,
    headersTimeoutMs: 66_000,
    requestTimeoutMs: 120_000,
});
/**
 * Apply `t` to `server`. Throws a RangeError when the values are inconsistent
 * (header timeout not above keep-alive, or request timeout below the header timeout).
 */
export function applyHttpTimeouts(server, t = HTTP_TIMEOUTS) {
    if (!(t.keepAliveTimeoutMs > 0 && t.headersTimeoutMs > t.keepAliveTimeoutMs && t.requestTimeoutMs >= t.headersTimeoutMs)) {
        throw new RangeError('HTTP timeouts must satisfy 0 < keepAlive < headers <= request');
    }
    server.keepAliveTimeout = t.keepAliveTimeoutMs;
    server.headersTimeout = t.headersTimeoutMs;
    server.requestTimeout = t.requestTimeoutMs;
}
