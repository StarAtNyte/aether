/**
 * `/api/assets/*` — on-demand import of SimReady Central models (docs/ASSETS.md, "Importing while you work").
 *
 *   POST /api/assets/import            {query | ref, maxSize?}  -> 202 {job}   starts a job
 *   GET  /api/assets/import/<job>                               -> {job}       stage, progress, result
 *   GET  /api/assets/imported                                   -> {assets}    what is imported on this computer
 *   GET  /api/assets/imported/files/<id>/s/<name>.glb                           a file of an import (content-hashed name)
 *
 * Registered only when `config.assetImport.enabled` (a server on the user's own computer, or AETHER_ALLOW_IMPORT=1).
 * The same guards as local AI: the session cookie, no proxy headers, a loopback socket and Host. The routes never take a
 * URL or a path from the client; the service decides what is downloaded (see assets-import/service.ts).
 */
import { readFileSync } from 'node:fs';
import type { Context, Hono } from 'hono';
import { IMPORT_ID_RE, IMPORT_JOB_RE, ImportRequest } from '@aether/assets';
import type { AppEnv } from '../app-env';
import { fail, readJsonBody } from '../http';
import { hasSession } from '../local-guard';
import type { Logger } from '../logger';
import { ImportRefused, type ImportService } from '../assets-import/service';
import { LOOPBACK_HOST, PROXY_HEADERS, socketIsLoopback } from './local';

export interface AssetImportRouteDeps {
  service: ImportService;
  logger: Logger;
  /** Per-install secret (cookie); absent: not required. */
  sessionSecret?: string;
  /** Require a request made on this machine (default true). */
  loopbackOnly: boolean;
  isLoopback?: (c: Context<AppEnv>) => boolean;
}

const FILE_RE = /^[a-z0-9_-]{1,64}(\.lod[12]|\.lite)?\.[0-9a-f]{8}\.glb$/;

export function registerAssetImportRoutes(app: Hono<AppEnv>, deps: AssetImportRouteDeps): void {
  const isLoopback = deps.isLoopback ?? socketIsLoopback;
  app.use('/api/assets/*', async (c, next) => {
    if (deps.sessionSecret !== undefined && !hasSession(c, deps.sessionSecret)) return fail(c, 401, 'unauthorized', 'Reload the studio from the link printed by "aether start".');
    if (deps.loopbackOnly) {
      for (const h of PROXY_HEADERS) if (c.req.header(h) !== undefined) return fail(c, 403, 'forbidden-host', 'Importing only answers requests made directly on this computer.');
      if (!LOOPBACK_HOST.test(c.req.header('host') ?? '') || !isLoopback(c)) return fail(c, 403, 'forbidden-host', 'Importing only answers requests made directly on this computer.');
    }
    c.header('cache-control', 'no-store');
    return next();
  });

  app.post('/api/assets/import', async (c) => {
    const body = await readJsonBody(c, { maxStringLength: 1024, maxNodes: 50, maxDepth: 3 });
    if (!body.ok) return body.response;
    const parsed = ImportRequest.safeParse(body.value);
    if (!parsed.success) return fail(c, 400, 'invalid-request', 'Send {"query": "office chair"} or {"ref": "<owner>/<dataset>@<40-hex revision>/<package>"}.');
    try {
      const job = deps.service.start(parsed.data);
      deps.logger.info('asset import started', { job: job.id, kind: parsed.data.ref ? 'ref' : 'query' });
      return c.json({ job }, 202);
    } catch (e) {
      if (e instanceof ImportRefused) return fail(c, e.code === 'invalid' ? 400 : 429, e.code, e.message);
      throw e;
    }
  });

  app.get('/api/assets/import/:job', (c) => {
    const id = c.req.param('job');
    const job = IMPORT_JOB_RE.test(id) ? deps.service.status(id) : null;
    return job ? c.json({ job }) : fail(c, 404, 'not-found', 'No such import.');
  });

  app.get('/api/assets/imported', (c) => c.json({ version: 1, assets: deps.service.list() }));

  app.get('/api/assets/imported/files/:id/:dir/:name', (c) => {
    const { id, dir, name } = c.req.param();
    if (!IMPORT_ID_RE.test(id) || dir !== 's' || !FILE_RE.test(name)) return fail(c, 404, 'not-found', 'No such file.');
    const path = deps.service.filePath(id, `${dir}/${name}`);
    if (!path) return fail(c, 404, 'not-found', 'No such file.');
    return c.body(readFileSync(path) as unknown as ArrayBuffer, 200, { 'content-type': 'model/gltf-binary', 'cache-control': 'private, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' });
  });
}
