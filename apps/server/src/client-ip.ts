/**
 * Client IP resolution for rate limiting.
 *
 * By default only the socket address is trusted. Behind N reverse proxies
 * (Fly.io, Render, Railway…) set `TRUST_PROXY_HOPS=N`: the address the
 * outermost trusted proxy saw is the N-th entry from the RIGHT of
 * X-Forwarded-For (entries further left are client-controlled and spoofable).
 */
import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';

/** Function returning a stable key for the requesting client. */
export type ClientIpResolver = (c: Context) => string;

const MAX_IP_LEN = 64;
const IP_RE = /^[0-9A-Fa-f:.]{2,64}$/;

/** Pick the trusted entry from an X-Forwarded-For header value. */
export function pickForwardedIp(header: string | undefined, hops: number): string | undefined {
  if (!header || hops <= 0) return undefined;
  const parts = header.split(',').slice(-hops - 1); // bounded work even for huge headers
  const parsed = parts.map((p) => p.trim()).filter((p) => p !== '');
  // Fewer entries than trusted hops means the chain is shorter than configured
  // (misconfiguration or a direct-to-origin request): every entry may be
  // client-controlled, so ignore the header and fall back to the socket address.
  if (parsed.length < hops) return undefined;
  const candidate = parsed[parsed.length - hops];
  return candidate !== undefined && IP_RE.test(candidate) ? candidate : undefined;
}

/** Build the default resolver: trusted X-Forwarded-For entry, else socket address, else "unknown". */
export function createClientIpResolver(trustProxyHops: number): ClientIpResolver {
  return (c) => {
    const forwarded = pickForwardedIp(c.req.header('x-forwarded-for'), trustProxyHops);
    if (forwarded) return forwarded;
    try {
      const addr = getConnInfo(c).remote.address;
      if (typeof addr === 'string' && addr.length > 0) return addr.slice(0, MAX_IP_LEN);
    } catch {
      // Not running on a Node socket (e.g. app.request() in tests).
    }
    return 'unknown';
  };
}
