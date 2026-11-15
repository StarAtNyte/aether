/**
 * The co-presence relay on the server's own port: WebSocket upgrades of `/api/copresence/ws?world=<key>&room=<id>`.
 *
 * Before the handshake the upgrade request is run through the Hono app itself (`GET /api/copresence/ws` with the
 * upgrade marker in its env), so it passes the same guards as every API request: the local app's Host check and LAN
 * access token, the per-client rate limit, and the route's own Origin check (a WebSocket is not covered by CORS, so
 * a page on another site must not open one) and query validation. Only a 204 from that route completes the
 * handshake; anything else is written back as a plain HTTP answer. Frames are capped at
 * {@link COPRESENCE_MAX_FRAME_BYTES}; the rooms (`rooms.ts`) validate, rate limit and relay them.
 */
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { COPRESENCE_MAX_FRAME_BYTES } from '@aether/core/copresence';
import type { Logger } from '../logger';
import { acceptUpgrade, isUpgradeRequest, refuseUpgrade } from './ws';
import { RoomRegistry } from './rooms';

/** Path of the relay's WebSocket. */
export const COPRESENCE_WS_PATH = '/api/copresence/ws';
/** Env flag the upgrade handler passes to the app (the route answers 426 without it). */
export const COPRESENCE_UPGRADE_ENV = 'aetherCopresenceUpgrade';
/** Header of the route's 204 naming the room the visitor may join. */
export const COPRESENCE_ROOM_HEADER = 'x-aether-copresence-room';

/** Something that answers a Fetch request with the app's guards (the Hono app's `fetch`). */
export type GuardFetch = (req: Request, env: Record<string, unknown>) => Response | Promise<Response>;

/** A running relay. */
export interface CopresenceRelay {
  readonly rooms: RoomRegistry;
  close(): void;
}

function toRequest(req: IncomingMessage): Request {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) for (const x of v) headers.append(k, x);
    else headers.set(k, v);
  }
  const host = typeof req.headers.host === 'string' && /^[A-Za-z0-9.:[\]-]{1,300}$/.test(req.headers.host) ? req.headers.host : 'localhost';
  return new Request(`http://${host}${req.url ?? '/'}`, { method: 'GET', headers });
}

/** Serve the relay on `server` (the process's HTTP server), guarded by `guard` (the app's fetch). */
export function attachCopresence(server: Server, guard: GuardFetch, opts: { logger?: Logger; rooms?: RoomRegistry; sweepMs?: number } = {}): CopresenceRelay {
  const rooms = opts.rooms ?? new RoomRegistry();
  const sweep = setInterval(() => rooms.sweep(), opts.sweepMs ?? 5000);
  sweep.unref();

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    socket.on('error', () => socket.destroy());
    const path = (req.url ?? '').split('?')[0];
    if (path !== COPRESENCE_WS_PATH || !isUpgradeRequest(req)) return refuseUpgrade(socket, path === COPRESENCE_WS_PATH ? 400 : 404);
    void (async () => {
      let res: Response;
      try {
        res = await guard(toRequest(req), { incoming: req, [COPRESENCE_UPGRADE_ENV]: true });
      } catch {
        return refuseUpgrade(socket, 400);
      }
      const room = res.headers.get(COPRESENCE_ROOM_HEADER);
      if (res.status !== 204 || !room) return refuseUpgrade(socket, res.status === 204 ? 400 : res.status, await res.text().catch(() => ''));
      if (socket.destroyed) return;
      const ws = acceptUpgrade(req, socket, head, { maxFrameBytes: COPRESENCE_MAX_FRAME_BYTES });
      const joined = rooms.join(room, { send: (t) => ws.send(t), close: (code, reason) => ws.close(code, reason) });
      if (!('id' in joined)) return;
      const id = joined.id;
      ws.onText((text) => rooms.receive(id, text));
      ws.onClose(() => rooms.leave(id));
      opts.logger?.debug('copresence join', { room, peers: rooms.members(room).length });
    })();
  };
  server.on('upgrade', onUpgrade);
  return {
    rooms,
    close() {
      clearInterval(sweep);
      server.off('upgrade', onUpgrade);
      rooms.closeAll();
    },
  };
}
