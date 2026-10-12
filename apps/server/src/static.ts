/**
 * Production static hosting of the built studio (`apps/studio/dist`).
 *
 * - Hashed build assets (`/assets/*`) get a one-year immutable cache.
 * - Everything else is revalidated (`no-cache`) so new deploys show up at once.
 * - Unknown non-API GET routes that accept HTML fall back to `index.html`
 *   (client-side routing), never for `/api/*`.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import type { AppEnv } from './app-env';
import type { Logger } from './logger';

/** Cache policy for content-hashed build output. */
export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

/** Register static file serving and the SPA fallback. No-op (with a warning) when `dir` is missing. */
export function registerStatic(app: Hono<AppEnv>, dir: string, logger: Logger): void {
  const indexPath = join(dir, 'index.html');
  if (!existsSync(indexPath)) {
    logger.warn('static directory has no index.html; studio will not be served', { dir });
    return;
  }

  app.use('/assets/*', async (c, next) => {
    await next();
    if (c.res.status === 200) c.header('Cache-Control', IMMUTABLE_CACHE);
  });
  app.use(
    '*',
    serveStatic({
      root: dir,
      onFound: (path, c) => {
        if (!path.includes('/assets/')) c.header('Cache-Control', 'no-cache');
      },
    }),
  );

  let indexHtml: string | null = null;
  app.get('*', async (c, next) => {
    if (c.req.path.startsWith('/api/') || c.req.path === '/api') return next();
    const accept = c.req.header('accept') ?? '';
    if (!accept.includes('text/html')) return next();
    indexHtml ??= await readFile(indexPath, 'utf8');
    c.header('Cache-Control', 'no-cache');
    return c.html(indexHtml, 200);
  });
}
