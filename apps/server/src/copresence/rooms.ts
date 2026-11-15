/**
 * The co-presence rooms of the relay, in memory: one room per world and room id, at most
 * {@link COPRESENCE_MAX_PEERS} visitors each. Pure bookkeeping (no sockets): a peer is anything that can be sent a
 * frame and closed, so tests drive it directly.
 *
 * What it enforces: every message a visitor sends is validated (`@aether/core/copresence`) and relayed to the others
 * stamped with the sender's id (a visitor cannot speak for another); per-visitor rate limits (all messages, and chat
 * on its own tighter bucket; a visitor far over them is dropped); a cap on rooms; visitors silent for
 * {@link COPRESENCE_IDLE_MS} are dropped by {@link RoomRegistry.sweep}. Nothing is stored: a room disappears with its
 * last visitor.
 */
import { randomBytes } from 'node:crypto';
import { COPRESENCE_IDLE_MS, COPRESENCE_MAX_FRAME_BYTES, COPRESENCE_MAX_PEERS, COPRESENCE_VERSION, parsePresence, type RelayFrame } from '@aether/core/copresence';
import { TokenBucketLimiter } from '../rate-limit';

/** One connected visitor, as the registry sees it. */
export interface RelayPeer {
  send(text: string): void;
  close(code: number, reason: string): void;
}

/** Limits of a {@link RoomRegistry}. */
export interface RoomLimits {
  maxPeers: number;
  maxRooms: number;
  idleMs: number;
  /** All messages per visitor: sustained per second and burst. */
  messagesPerSecond: number;
  messageBurst: number;
  /** Chat lines per visitor per minute, and burst. */
  chatPerMinute: number;
  chatBurst: number;
  /** Dropped (over-limit or invalid) messages after which the visitor is disconnected. */
  maxStrikes: number;
}

export const DEFAULT_ROOM_LIMITS: RoomLimits = Object.freeze({
  maxPeers: COPRESENCE_MAX_PEERS,
  maxRooms: 256,
  idleMs: COPRESENCE_IDLE_MS,
  messagesPerSecond: 20,
  messageBurst: 40,
  chatPerMinute: 20,
  chatBurst: 5,
  maxStrikes: 200,
});

interface Entry {
  id: string;
  peer: RelayPeer;
  room: string;
  lastSeen: number;
  strikes: number;
}

/** Why a join was refused. */
export type JoinRefusal = 'full' | 'too-many-rooms';

const frame = (f: RelayFrame): string => JSON.stringify(f);

/** In-memory rooms of the co-presence relay. */
export class RoomRegistry {
  private readonly rooms = new Map<string, Map<string, Entry>>();
  private readonly peers = new Map<string, Entry>();
  private readonly limits: RoomLimits;
  private readonly now: () => number;
  private readonly messages: TokenBucketLimiter;
  private readonly chat: TokenBucketLimiter;
  private readonly newId: () => string;

  constructor(opts: { limits?: Partial<RoomLimits>; now?: () => number; newId?: () => string } = {}) {
    this.limits = { ...DEFAULT_ROOM_LIMITS, ...opts.limits };
    this.now = opts.now ?? Date.now;
    this.newId = opts.newId ?? (() => randomBytes(6).toString('hex'));
    this.messages = new TokenBucketLimiter({ perMinute: this.limits.messagesPerSecond * 60, burst: this.limits.messageBurst, now: this.now });
    this.chat = new TokenBucketLimiter({ perMinute: this.limits.chatPerMinute, burst: this.limits.chatBurst, now: this.now });
  }

  /** Number of open rooms and connected visitors. */
  get size(): { rooms: number; peers: number } {
    return { rooms: this.rooms.size, peers: this.peers.size };
  }

  /** Visitors of one room (ids). */
  members(room: string): string[] {
    return [...(this.rooms.get(room)?.keys() ?? [])];
  }

  /** Whether `room` can take one more visitor (checked before the WebSocket handshake). */
  canJoin(room: string): JoinRefusal | null {
    const r = this.rooms.get(room);
    if (r) return r.size >= this.limits.maxPeers ? 'full' : null;
    return this.rooms.size >= this.limits.maxRooms ? 'too-many-rooms' : null;
  }

  /**
   * Add a visitor to `room` (key `<world>/<room id>`): it is sent `welcome` with its id and the others', and they are
   * sent `join`. Returns its id, or why it was refused (the peer is then sent `error` and closed).
   */
  join(room: string, peer: RelayPeer): { id: string } | { refused: JoinRefusal } {
    const refused = this.canJoin(room);
    if (refused) {
      peer.send(frame({ k: 'error', code: 'full' }));
      peer.close(4001, refused);
      return { refused };
    }
    let id = this.newId();
    while (this.peers.has(id)) id = this.newId();
    let r = this.rooms.get(room);
    if (!r) {
      r = new Map();
      this.rooms.set(room, r);
    }
    const others = [...r.keys()];
    const entry: Entry = { id, peer, room, lastSeen: this.now(), strikes: 0 };
    r.set(id, entry);
    this.peers.set(id, entry);
    peer.send(frame({ k: 'welcome', v: COPRESENCE_VERSION, id, peers: others }));
    this.broadcast(r, id, frame({ k: 'join', id }));
    return { id };
  }

  /** A text message from visitor `id`: validated, rate limited, relayed to the rest of its room. */
  receive(id: string, text: string): void {
    const e = this.peers.get(id);
    if (!e) return;
    e.lastSeen = this.now();
    if (Buffer.byteLength(text, 'utf8') > COPRESENCE_MAX_FRAME_BYTES) return this.strike(e, 'bad-message');
    if (!this.messages.take(id).allowed) return this.strike(e, 'rate');
    const m = parsePresence(text);
    if (!m) return this.strike(e, 'bad-message');
    if (m.t === 'chat' && !this.chat.take(id).allowed) return this.strike(e, 'rate');
    const r = this.rooms.get(e.room);
    if (r) this.broadcast(r, id, frame({ k: 'msg', from: id, m }));
    if (m.t === 'bye') this.leave(id, 1000, 'bye');
  }

  /** Remove visitor `id` (its socket closed or it said bye): the others are sent `leave`. */
  leave(id: string, code = 1000, reason = ''): void {
    const e = this.peers.get(id);
    if (!e) return;
    this.peers.delete(id);
    const r = this.rooms.get(e.room);
    if (r) {
      r.delete(id);
      if (r.size === 0) this.rooms.delete(e.room);
      else this.broadcast(r, id, frame({ k: 'leave', id }));
    }
    e.peer.close(code, reason);
  }

  /** Drop visitors silent for longer than the idle limit. Returns how many were dropped. */
  sweep(): number {
    const cutoff = this.now() - this.limits.idleMs;
    let n = 0;
    for (const e of [...this.peers.values()]) {
      if (e.lastSeen >= cutoff) continue;
      e.peer.send(frame({ k: 'error', code: 'idle' }));
      this.leave(e.id, 4002, 'idle');
      n++;
    }
    return n;
  }

  /** Close every visitor (server shutdown). */
  closeAll(): void {
    for (const e of [...this.peers.values()]) {
      e.peer.send(frame({ k: 'error', code: 'closing' }));
      this.leave(e.id, 1001, 'server closing');
    }
  }

  private strike(e: Entry, code: 'rate' | 'bad-message'): void {
    e.strikes++;
    if (e.strikes === 1) e.peer.send(frame({ k: 'error', code }));
    if (e.strikes >= this.limits.maxStrikes) this.leave(e.id, 4003, code);
  }

  private broadcast(r: Map<string, Entry>, from: string, text: string): void {
    for (const [id, e] of r) if (id !== from) e.peer.send(text);
  }
}
