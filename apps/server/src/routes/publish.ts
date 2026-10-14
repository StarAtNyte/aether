/**
 * Publishing from the local app (registered only with local AI, i.e. the
 * `aether` command on this computer; behind the same loopback + session
 * guard as `/api/local/*`):
 *
 *   GET    /api/local/publish/targets          which hosting CLIs are installed / signed in
 *   GET    /api/local/publish/builds           the local library of published builds
 *   POST   /api/local/publish/builds           add a build (application/zip, validated, immutable)
 *   DELETE /api/local/publish/builds/:id       remove a build
 *   POST   /api/local/publish/deploy           deploy a build to the user's own hosting
 *   GET    /api/local/publish/jobs/:id         a deploy's state
 *   GET    /api/local/publish/jobs/:id/events  its progress (server-sent events, `?after=<seq>`)
 *   DELETE /api/local/publish/jobs/:id         cancel it
 *   GET    /api/local/publish/lan              LAN share status
 *   POST   /api/local/publish/lan              `{ on, build? }` turn it on / off
 *   GET    /published/:id/…                    play a library build on this computer
 *
 * Nothing uploaded is executed on the server.
 */
import type { Context, Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { z } from 'zod';
import type { AppEnv } from '../app-env';
import { fail, readJsonBody } from '../http';
import type { Logger } from '../logger';
import { DeployRequest } from '../publish/hosts';
import { DeployError, type DeployJobs } from '../publish/jobs';
import { buildHeaders, type LanShare } from '../publish/lan';
import { PublishStoreError, type PublishStore } from '../publish/store';

/** Dependencies of the publish routes. */
export interface PublishRouteDeps {
  store: PublishStore;
  jobs: DeployJobs;
  lan: LanShare;
  logger: Logger;
  /** Largest build upload (bytes). */
  maxUploadBytes: number;
}

const JOB_RE = /^[a-z0-9]{12}$/;
const LanRequest = z.object({ on: z.boolean(), build: z.string().regex(/^[a-z0-9]{12}$/).optional() }).strict();

function storeError(c: Context<AppEnv>, e: unknown, logger: Logger): Response {
  if (e instanceof PublishStoreError) return fail(c, e.status, 'publish-rejected', e.message);
  logger.warn('publish store error', { name: e instanceof Error ? e.name : typeof e });
  return fail(c, 500, 'internal', 'The build could not be stored.');
}

/** Register the routes (call only for the local app). */
export function registerPublishRoutes(app: Hono<AppEnv>, deps: PublishRouteDeps): void {
  const { store, jobs, lan, logger } = deps;

  app.get('/api/local/publish/targets', async (c) => c.json({ targets: await jobs.status(c.req.query('fresh') === '1') }));

  app.get('/api/local/publish/builds', async (c) => c.json({ builds: await store.list() }));

  app.post('/api/local/publish/builds', async (c) => {
    const type = c.req.header('content-type') ?? '';
    if (!/^application\/zip\s*(;|$)/i.test(type)) return fail(c, 415, 'unsupported-media-type', 'Upload the build as application/zip.');
    const declared = Number(c.req.header('content-length') ?? '0');
    if (declared > deps.maxUploadBytes) return fail(c, 413, 'payload-too-large', `The build is larger than ${Math.round(deps.maxUploadBytes / 1024 / 1024)} MB.`);
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await c.req.arrayBuffer());
    } catch {
      return fail(c, 400, 'bad-request', 'The upload could not be read.');
    }
    if (bytes.byteLength > deps.maxUploadBytes) return fail(c, 413, 'payload-too-large', 'The build is too large.');
    try {
      const meta = await store.add(bytes);
      return c.json({ build: meta, url: `/published/${meta.id}/` }, 201);
    } catch (e) {
      return storeError(c, e, logger);
    }
  });

  app.delete('/api/local/publish/builds/:id', async (c) => {
    const id = c.req.param('id');
    const lanState = lan.status();
    if (lanState.build === id) await lan.stop();
    return (await store.remove(id)) ? c.json({ ok: true }) : fail(c, 404, 'not-found', 'No such build.');
  });

  app.post('/api/local/publish/deploy', async (c) => {
    const body = await readJsonBody(c, { maxDepth: 4, maxNodes: 50 });
    if (!body.ok) return body.response;
    const req = DeployRequest.safeParse(body.value);
    if (!req.success) return fail(c, 400, 'invalid-request', 'The deploy request is not valid (check the name: lowercase letters, digits and dashes).');
    try {
      return c.json({ job: await jobs.start(req.data) }, 202);
    } catch (e) {
      if (e instanceof DeployError) return fail(c, e.status === 404 ? 404 : e.status === 400 ? 400 : 409, 'deploy-refused', e.message);
      logger.warn('deploy start failed', { name: e instanceof Error ? e.name : typeof e });
      return fail(c, 500, 'internal', 'The deploy could not start.');
    }
  });

  app.get('/api/local/publish/jobs/:id', (c) => {
    const id = c.req.param('id');
    const v = JOB_RE.test(id) ? jobs.view(id) : null;
    return v ? c.json({ job: v }) : fail(c, 404, 'not-found', 'No such job.');
  });

  app.delete('/api/local/publish/jobs/:id', (c) => {
    const id = c.req.param('id');
    return JOB_RE.test(id) && jobs.cancel(id) ? c.json({ ok: true }) : fail(c, 404, 'not-found', 'No running job with that id.');
  });

  app.get('/api/local/publish/jobs/:id/events', (c) => {
    const id = c.req.param('id');
    const view = JOB_RE.test(id) ? jobs.view(id) : null;
    if (!view) return fail(c, 404, 'not-found', 'No such job.');
    const after = Math.max(0, Number(c.req.query('after') ?? '0') || 0);
    return streamSSE(c, async (stream) => {
      const queue: Array<{ seq: number; data: string }> = [];
      let wake: (() => void) | null = null;
      const push = (e: { seq: number }): void => {
        queue.push({ seq: e.seq, data: JSON.stringify(e) });
        wake?.();
      };
      for (const e of view.events) if (e.seq > after) push(e);
      const unsubscribe = jobs.listen(id, push);
      let closed = false;
      stream.onAbort(() => {
        closed = true;
        wake?.();
      });
      try {
        for (;;) {
          while (queue.length > 0) {
            const e = queue.shift() as { seq: number; data: string };
            await stream.writeSSE({ id: String(e.seq), event: 'progress', data: e.data });
          }
          const state = jobs.view(id)?.state ?? 'error';
          if (closed || state !== 'running') break;
          await new Promise<void>((resolve) => {
            wake = resolve;
            setTimeout(resolve, 15_000);
          });
          wake = null;
          if (!closed && queue.length === 0) await stream.writeSSE({ event: 'ping', data: '{}' });
        }
        const final = jobs.view(id);
        if (final && !closed) await stream.writeSSE({ event: 'end', data: JSON.stringify({ state: final.state, url: final.url, error: final.error }) });
      } finally {
        unsubscribe?.();
      }
    });
  });

  app.get('/api/local/publish/lan', (c) => c.json(lan.status()));

  app.post('/api/local/publish/lan', async (c) => {
    const body = await readJsonBody(c, { maxDepth: 3, maxNodes: 10 });
    if (!body.ok) return body.response;
    const r = LanRequest.safeParse(body.value);
    if (!r.success) return fail(c, 400, 'invalid-request', 'Expected { on, build }.');
    if (!r.data.on) return c.json(await lan.stop());
    if (!r.data.build) return fail(c, 400, 'invalid-request', 'Choose the build to share.');
    try {
      return c.json(await lan.start(r.data.build));
    } catch (e) {
      return fail(c, 409, 'lan-unavailable', e instanceof Error ? e.message.slice(0, 200) : 'Could not share on the local network.');
    }
  });

  // Play a library build on this computer.
  app.get('/published/:id/*', async (c) => {
    const id = c.req.param('id');
    const rest = c.req.path.slice(`/published/${id}/`.length);
    const f = await store.file(id, rest);
    if (!f) return fail(c, 404, 'not-found', 'Not found.');
    const name = rest === '' || rest.endsWith('/') ? `${rest}index.html` : rest;
    const headers = buildHeaders(name);
    for (const [k, v] of Object.entries(headers)) if (k !== 'Content-Security-Policy') c.header(k, v);
    c.header('Content-Length', String(f.size));
    return c.body(Readable.toWeb(createReadStream(f.file)) as unknown as ReadableStream, 200);
  });
  app.get('/published/:id', (c) => c.redirect(`/published/${c.req.param('id')}/`, 308));
}
