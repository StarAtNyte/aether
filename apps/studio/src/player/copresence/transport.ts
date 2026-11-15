/**
 * How visitors of one shared link reach each other. A transport joins one room, broadcasts this visitor's messages
 * to everyone else in it and reports who joins and leaves; it carries {@link PresenceMessage}s and nothing else.
 *
 * Implementations: `broadcast.ts` (tabs of one browser; tests and local demos), `websocket.ts` (the relay of the
 * Aether server, `/api/copresence/ws`, the first choice) and `supabase.ts` (Supabase Realtime, for the static hosted
 * site). When none is reachable the player shows no shared-visit controls at all.
 */
import type { PresenceMessage } from '@aether/core/copresence';

/** Why a transport closed: the room is full, the connection was lost, or it was closed here. */
export type TransportEnd = 'full' | 'lost' | 'closed';

export interface CopresenceTransport {
  /** 'websocket', 'supabase' or 'broadcast'. */
  readonly kind: string;
  /** Join `roomId`; resolves with this visitor's peer id, rejects when the room cannot be joined (`full`, unreachable). */
  connect(roomId: string): Promise<string>;
  /** Send to every other visitor of the room (dropped while not connected). */
  send(msg: PresenceMessage): void;
  onMessage(fn: (from: string, msg: PresenceMessage) => void): void;
  onPeerJoin(fn: (id: string) => void): void;
  onPeerLeave(fn: (id: string) => void): void;
  /** Called once when the transport ends on its own (not after {@link close}). */
  onEnd(fn: (why: TransportEnd) => void): void;
  close(): void;
}

/** An error a transport rejects `connect` with. */
export class TransportError extends Error {
  constructor(readonly why: TransportEnd | 'unreachable') {
    super(why === 'full' ? 'This shared visit is full.' : why === 'unreachable' ? 'Shared visits are not available here.' : 'The shared visit was closed.');
  }
}

/** A small listener set. */
export class Listeners<A extends unknown[]> {
  private readonly fns: Array<(...a: A) => void> = [];
  add(fn: (...a: A) => void): void {
    this.fns.push(fn);
  }
  emit(...a: A): void {
    for (const fn of this.fns) {
      try {
        fn(...a);
      } catch (err) {
        console.warn('[copresence] listener failed', err);
      }
    }
  }
}
