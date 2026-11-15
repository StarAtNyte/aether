/**
 * Shared visits (co-presence) routes:
 *
 * - `GET /api/copresence`: `{ ok, v, maxPeers, voice, maxTalkers }`; the player asks it before showing the Invite
 *   button (a static host without the relay answers 404, and the feature stays hidden). `voice: true`: this relay
 *   forwards voice signalling (`rtc`) to the one visitor it names.
 * - `GET /api/copresence/ws?world=<key>&room=<id>`: the guard step of a WebSocket upgrade (`copresence/relay.ts` runs
 *   the upgrade request through the app with a marker in its env). Answers 204 with the room key when the Origin is
 *   this server's own (or an allowed origin) and the query is valid; 403 / 400 otherwise, and 426 to a plain request.
 */
import type { Hono } from 'hono';
import { z } from 'zod';
import { COPRESENCE_MAX_PEERS, COPRESENCE_VERSION, VOICE_MAX_TALKERS, ROOM_ID_RE, WORLD_KEY_RE } from '@aether/core/copresence';
import type { AppEnv } from '../app-env';
import { fail } from '../http';
import { COPRESENCE_ROOM_HEADER, COPRESENCE_UPGRADE_ENV, COPRESENCE_WS_PATH } from '../copresence/relay';

const Query = z.object({ world: z.string().regex(WORLD_KEY_RE), room: z.string().regex(ROOM_ID_RE) });

/** True when `origin` is this server (same host as the Host header) or one of `allowed`. */
export function sameOriginOrAllowed(origin: string | undefined, host: string | undefined, allowed: ReadonlySet<string>): boolean {
  if (!origin) return false;
  if (allowed.has(origin)) return true;
  try {
    return host !== undefined && new URL(origin).host === host.toLowerCase();
  } catch {
    return false;
  }
}

export function registerCopresenceRoutes(app: Hono<AppEnv>, opts: { allowedOrigins: readonly string[] }): void {
  const allowed = new Set(opts.allowedOrigins);
  app.get('/api/copresence', (c) => c.json({ ok: true, v: COPRESENCE_VERSION, maxPeers: COPRESENCE_MAX_PEERS, voice: true, maxTalkers: VOICE_MAX_TALKERS }, 200));
  app.get(COPRESENCE_WS_PATH, (c) => {
    const env = c.env as Record<string, unknown> | undefined;
    if (env?.[COPRESENCE_UPGRADE_ENV] !== true) return fail(c, 426, 'upgrade-required', 'Open this address as a WebSocket.');
    if (!sameOriginOrAllowed(c.req.header('origin'), c.req.header('host'), allowed)) return fail(c, 403, 'origin-not-allowed', 'Shared visits only open from this site.');
    const q = Query.safeParse({ world: c.req.query('world'), room: c.req.query('room') });
    if (!q.success) return fail(c, 400, 'bad-room', 'The world or room in this link is not valid.');
    c.header(COPRESENCE_ROOM_HEADER, `${q.data.world}/${q.data.room}`);
    return c.body(null, 204);
  });
}
