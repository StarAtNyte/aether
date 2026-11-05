/**
 * Production static hosting of the built studio (`apps/studio/dist`).
 *
 * - Hashed build assets (`/assets/*`, which includes the content-addressed
 *   asset library) and the bundled fonts get a one-year immutable cache.
 * - Everything else is revalidated (`no-cache`) so new deploys show up at once.
 * - Precompressed siblings (`.br`, `.gz`, written by `scripts/precompress.ts`
 *   in the container build) are sent when the browser accepts them, except
 *   for byte-range requests, which always get the identity file.
 * - `/play` serves the standalone player (`play.html`).
 * - The studio routes with the URL hash, so `/` (and `/index.html`) is its
 *   only page: any other browser navigation outside `/api/` gets a real 404
 *   page (`404.html` from the build, or a built-in one), never the app.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Context, Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import type { AppEnv } from './app-env';
import { errorPageHtml, sendErrorPage, wantsHtmlPage } from './error-pages';
import type { Logger } from './logger';

/** Cache policy for content-hashed build output. */
export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
/** Cache policy for everything that is not content-hashed. */
export const REVALIDATE_CACHE = 'no-cache';

/** Path prefixes whose files never change under the same name. */
const IMMUTABLE_PREFIXES: readonly string[] = ['/assets/', '/fonts/'];

/** True when `path` is served with {@link IMMUTABLE_CACHE}. */
export function isImmutablePath(path: string): boolean {
  return IMMUTABLE_PREFIXES.some((p) => path.startsWith(p));
}

/** Register static file serving, the player route and the 404 page. No-op (with a warning) when `dir` is missing. */
export function registerStatic(app: Hono<AppEnv>, dir: string, logger: Logger): void {
  const indexPath = join(dir, 'index.html');
  if (!existsSync(indexPath)) {
    logger.warn('static directory has no index.html; studio will not be served', { dir });
    return;
  }

  // serveStatic calls onFound after it has built the response, so the cache policy is applied
  // once it returns, only to requests it actually answered from a file.
  const served = new WeakSet<Context<AppEnv>>();
  const onFound = (_path: string, c: Context<AppEnv>): void => {
    served.add(c);
  };
  const compressed = serveStatic<AppEnv>({ root: dir, precompressed: true, onFound });
  // A byte range always refers to the identity bytes: never answer it from a `.br` / `.gz` sibling.
  const identity = serveStatic<AppEnv>({ root: dir, precompressed: false, onFound });
  app.use('*', async (c, next) => {
    // Precompressed siblings are an implementation detail: never serve them by their own name. A file that is gzipped
    // itself, with no identity twin (the product index `abo.json-<hash>.gz`), is an ordinary file.
    if (/\.(br|gz)$/.test(c.req.path) && isSibling(dir, c.req.path)) return next();
    const res = await (c.req.header('range') ? identity(c, next) : compressed(c, next));
    if (res instanceof Response && served.has(c)) res.headers.set('Cache-Control', isImmutablePath(c.req.path) ? IMMUTABLE_CACHE : REVALIDATE_CACHE);
    return res;
  });

  // The standalone player (published games and share links: `/play#w=…`).
  const playPath = join(dir, 'play.html');
  let playHtml: string | null = null;
  app.get('/play', async (c, next) => {
    if (!existsSync(playPath)) return next();
    playHtml ??= await readFile(playPath, 'utf8');
    c.header('Cache-Control', REVALIDATE_CACHE);
    return c.html(playHtml, 200);
  });

  // Browser navigations to anything else: the designed 404 page with a real 404 status.
  const notFoundPath = join(dir, '404.html');
  let notFoundHtml: string | null = null;
  app.get('*', async (c, next) => {
    if (!wantsHtmlPage(c)) return next();
    notFoundHtml ??= existsSync(notFoundPath) ? await readFile(notFoundPath, 'utf8') : errorPageHtml(404);
    return sendErrorPage(c, 404, notFoundHtml);
  });
}

/** True when `path` names a precompressed sibling (`x.js.gz` next to `x.js`), or cannot be resolved inside `dir`. */
function isSibling(dir: string, path: string): boolean {
  let rel: string;
  try {
    rel = decodeURIComponent(path).replace(/^\/+/, '');
  } catch {
    return true;
  }
  if (rel.split('/').includes('..') || rel.includes('\0')) return true;
  return existsSync(join(dir, rel.replace(/\.(br|gz)$/, '')));
}
