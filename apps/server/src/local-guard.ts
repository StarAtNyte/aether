/**
 * Guards for the server when it runs as a local app (`aether start`):
 *
 * - {@link hostGuard}: only answer requests whose `Host` header names this
 *   server (`127.0.0.1:<port>`, `localhost:<port>`, plus the LAN address when
 *   LAN access is on). A web page on another site that rebinds its own DNS
 *   name to 127.0.0.1 still sends its own name as `Host`, so it is refused
 *   (DNS-rebinding defence).
 * - {@link sessionCookie} / {@link requireSession}: a per-install random
 *   secret is set as an HttpOnly, SameSite=Strict cookie on the studio's HTML
 *   and required on `/api/local/*` (the routes that spend the user's own AI
 *   subscription). Other sites cannot send it (SameSite=Strict) and cannot
 *   read it (HttpOnly, same-origin only). The `aether` CLI proves itself
 *   with the same secret in a header.
 * - {@link accessGate}: when LAN access is on, every request needs an access
 *   token (from the printed link, kept as a cookie afterwards).
 *
 * Secrets are compared in constant time and never logged.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from './app-env';
import { fail } from './http';

/** Cookie carrying the per-install session secret. */
export const SESSION_COOKIE = 'aether_session';
/** Cookie carrying the LAN access token. */
export const ACCESS_COOKIE = 'aether_access';
/** Header the CLI uses to prove it knows the session secret. */
export const ADMIN_HEADER = 'x-aether-admin';
/** Query parameter of the printed LAN link. */
export const ACCESS_PARAM = 'access';
/** Accepted secret / token shape (base64url, 32–128 chars). */
export const SECRET_RE = /^[A-Za-z0-9_-]{32,128}$/;

/** Constant-time comparison of two secrets (hashes first so lengths never leak). */
export function secretEquals(a: string | undefined | null, b: string): boolean {
  if (typeof a !== 'string' || a.length === 0 || a.length > 256) return false;
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Normalize a Host header value (lower case; at most 300 chars). */
function normalHost(value: string | undefined): string | null {
  if (value === undefined || value.length === 0 || value.length > 300) return null;
  return value.trim().toLowerCase();
}

/** True when `host` (a Host header value) is in `allowed` (exact `host:port` entries, lower case). */
export function hostAllowed(host: string | undefined, allowed: ReadonlySet<string>): boolean {
  const h = normalHost(host);
  return h !== null && allowed.has(h);
}

/** Refuse requests whose Host header is not one of `allowedHosts`. */
export function hostGuard(allowedHosts: readonly string[]): MiddlewareHandler<AppEnv> {
  const allowed = new Set(allowedHosts.map((h) => h.toLowerCase()));
  return async (c, next) => {
    if (!hostAllowed(c.req.header('host'), allowed)) return fail(c, 421, 'host-not-allowed', 'This server only answers on its own address.');
    return next();
  };
}

function isHtml(c: Context<AppEnv>): boolean {
  return /^text\/html\b/i.test(c.res.headers.get('content-type') ?? '');
}

/** Set the session cookie on every successful HTML response (the studio page). */
export function sessionCookie(secret: string, secure: boolean): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();
    if (c.res.status === 200 && isHtml(c) && !c.req.path.startsWith('/api/')) {
      setCookie(c, SESSION_COOKIE, secret, { httpOnly: true, sameSite: 'Strict', path: '/', secure });
    }
  };
}

/** True when the request carries the session secret (cookie from the studio, or the CLI header). */
export function hasSession(c: Context<AppEnv>, secret: string): boolean {
  return secretEquals(getCookie(c, SESSION_COOKIE), secret) || secretEquals(c.req.header(ADMIN_HEADER), secret);
}

/** Require the session secret (local AI routes). */
export function requireSession(secret: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!hasSession(c, secret)) {
      return c.json({ error: { code: 'unauthorized', message: 'Reload the studio page from the link printed by "aether start".' } }, 401);
    }
    return next();
  };
}

/**
 * LAN access token gate. `?access=<token>` on a page request sets the cookie
 * and redirects to the same URL without the token (so it does not stay in
 * history or get copied around); every other request needs the cookie.
 * `/api/health` stays open (it reveals nothing private) so tools can probe it.
 */
export function accessGate(token: string, secure: boolean): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.req.path === '/api/health') return next();
    const fromQuery = c.req.query(ACCESS_PARAM);
    if (fromQuery !== undefined && (c.req.method === 'GET' || c.req.method === 'HEAD')) {
      if (!secretEquals(fromQuery, token)) return fail(c, 403, 'access-denied', 'This link is not valid. Use the link printed by "aether start".');
      setCookie(c, ACCESS_COOKIE, token, { httpOnly: true, sameSite: 'Strict', path: '/', secure });
      const url = new URL(c.req.url);
      url.searchParams.delete(ACCESS_PARAM);
      c.header('Cache-Control', 'no-store');
      return c.redirect(`${url.pathname}${url.search}${url.hash}`, 303);
    }
    if (!secretEquals(getCookie(c, ACCESS_COOKIE), token) && !secretEquals(c.req.header(ADMIN_HEADER), token)) {
      return fail(c, 403, 'access-denied', 'Open the link printed by "aether start" on the computer running Aether.');
    }
    return next();
  };
}
