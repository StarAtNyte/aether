/**
 * Shared visits through the relay of the Aether server (`apps/server` `copresence/`): a WebSocket to
 * `/api/copresence/ws` on the page's own origin (the player's CSP allows `connect-src 'self'` only).
 * {@link relayAvailable} asks `/api/copresence` first, so a static host without the relay shows nothing.
 */
import { COPRESENCE_VERSION, parseRelayFrame, type PresenceMessage } from '@aether/core/copresence';
import { Listeners, TransportError, type CopresenceTransport, type TransportEnd } from './transport';

const CONNECT_TIMEOUT_MS = 6000;
/** Messages are dropped while this much is still waiting to be sent (a stalled connection; two session descriptions fit). */
const MAX_BUFFERED = 24 * 1024;

/** What this page's server relays: nothing (no relay), presence only, or presence and voice signalling. */
export interface RelayInfo {
  ok: boolean;
  voice: boolean;
}

/** Ask this page's server for its relay (`GET /api/copresence`), within `timeoutMs`. */
export async function relayInfo(fetchFn: typeof fetch = fetch, base: string = location.href, timeoutMs = 3000): Promise<RelayInfo> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn(new URL('/api/copresence', base).href, { cache: 'no-store', credentials: 'same-origin', signal: ctrl.signal });
    if (!res.ok || !/json/i.test(res.headers.get('content-type') ?? '')) return { ok: false, voice: false };
    const body = (await res.json()) as { ok?: unknown; v?: unknown; voice?: unknown };
    const ok = body.ok === true && body.v === COPRESENCE_VERSION;
    return { ok, voice: ok && body.voice === true };
  } catch {
    return { ok: false, voice: false };
  } finally {
    clearTimeout(timer);
  }
}

/** True when this page's server runs the relay (`GET /api/copresence`), within `timeoutMs`. */
export async function relayAvailable(fetchFn: typeof fetch = fetch, base: string = location.href, timeoutMs = 3000): Promise<boolean> {
  return (await relayInfo(fetchFn, base, timeoutMs)).ok;
}

/** The relay's socket URL for `world` / `room` on the page's origin. */
export function relayUrl(world: string, room: string, base: string = location.href): string {
  const u = new URL('/api/copresence/ws', base);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.search = new URLSearchParams({ world, room }).toString();
  return u.href;
}

export class WebSocketTransport implements CopresenceTransport {
  readonly kind = 'websocket';
  private ws: WebSocket | null = null;
  private ended = false;
  private readonly message = new Listeners<[string, PresenceMessage]>();
  private readonly join = new Listeners<[string]>();
  private readonly leave = new Listeners<[string]>();
  private readonly end = new Listeners<[TransportEnd]>();

  constructor(
    private readonly world: string,
    private readonly base: string = location.href,
    /** The relay forwards voice signalling (its `GET /api/copresence` said `voice: true`). */
    readonly voice: boolean = false,
  ) {}

  connect(roomId: string): Promise<string> {
    this.close();
    this.ended = false;
    return new Promise<string>((resolve, reject) => {
      let welcomed = false;
      let full = false;
      let ws: WebSocket;
      try {
        ws = new WebSocket(relayUrl(this.world, roomId, this.base));
      } catch {
        reject(new TransportError('unreachable'));
        return;
      }
      this.ws = ws;
      const timer = setTimeout(() => {
        if (!welcomed) {
          ws.close();
          reject(new TransportError('unreachable'));
        }
      }, CONNECT_TIMEOUT_MS);
      ws.onmessage = (e: MessageEvent) => {
        if (typeof e.data !== 'string') return;
        const f = parseRelayFrame(e.data);
        if (!f) return;
        if (f.k === 'welcome') {
          welcomed = true;
          clearTimeout(timer);
          resolve(f.id);
          for (const id of f.peers) this.join.emit(id);
        } else if (f.k === 'join') this.join.emit(f.id);
        else if (f.k === 'leave') this.leave.emit(f.id);
        else if (f.k === 'msg') this.message.emit(f.from, f.m);
        else if (f.k === 'error' && f.code === 'full') full = true;
      };
      ws.onclose = () => {
        clearTimeout(timer);
        if (this.ws === ws) this.ws = null;
        if (!welcomed) reject(new TransportError(full ? 'full' : 'unreachable'));
        else if (!this.ended) {
          this.ended = true;
          this.end.emit(full ? 'full' : 'lost');
        }
      };
    });
  }

  send(msg: PresenceMessage): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > MAX_BUFFERED) return;
    ws.send(JSON.stringify(msg));
  }

  onMessage(fn: (from: string, msg: PresenceMessage) => void): void {
    this.message.add(fn);
  }
  onPeerJoin(fn: (id: string) => void): void {
    this.join.add(fn);
  }
  onPeerLeave(fn: (id: string) => void): void {
    this.leave.add(fn);
  }
  onEnd(fn: (why: TransportEnd) => void): void {
    this.end.add(fn);
  }

  close(): void {
    this.ended = true;
    const ws = this.ws;
    this.ws = null;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) ws.close(1000);
  }
}
