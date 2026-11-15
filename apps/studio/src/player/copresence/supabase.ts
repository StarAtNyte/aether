/**
 * Shared visits on a static host (the hosted Vercel site) through Supabase Realtime: one public channel per world and
 * room (`aether-copresence:<world>/<room>`), presence for who is here (each visitor tracks itself under a random
 * presence key, its peer id) and broadcast for the {@link PresenceMessage}s.
 *
 * There is no relay of ours in between, so this side enforces what the relay enforces (apps/server `copresence/rooms.ts`):
 * - 16 visitors: a visitor who finds the room full does not join (`full`), and never lists more than 15 others;
 * - the sender of a message is the presence key it came with, and only a key that is present counts; the message body
 *   never names a sender, and every message still goes through `parsePresence` (1024 bytes at most; voice signalling,
 *   `rtc`, 8 KB). Broadcast reaches the whole room, so an `rtc` (addressed by `to`) for another visitor is dropped on
 *   arrival, though it still counts against its sender's limits;
 * - rate: at most 20 messages a second (burst 40) and 20 chat lines a minute (burst 5), and `rtc` on a bucket of its
 *   own (20 a second, burst 80), both ways. Over the limit,
 *   this visitor's messages are dropped before sending; a peer's are dropped on arrival, and a peer that keeps flooding
 *   (200 dropped) is ignored until it leaves.
 * Without a server a crafted client can still claim another present visitor's key on a broadcast; the relay of the
 * Aether server is the stronger option and stays the first choice (see docs/CONTRACTS.md, "Shared visits").
 *
 * `@supabase/realtime-js` is imported here only, and this module is loaded lazily by `CopresenceUI.tsx` when the page
 * has no relay and the build carries `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
 */
import { COPRESENCE_MAX_PEERS, COPRESENCE_MAX_SIGNAL_BYTES, COPRESENCE_SIGNAL_BURST, COPRESENCE_SIGNAL_PER_SEC, PEER_ID_RE, maxMessageBytes, parsePresence, type PresenceMessage } from '@aether/core/copresence';
import { Listeners, TransportError, type CopresenceTransport, type TransportEnd } from './transport';

const CONNECT_TIMEOUT_MS = 8000;
/** How long to wait for the first presence snapshot before counting the room as it stands. */
const SYNC_WAIT_MS = 2500;
/** Broadcast event name of a presence message. */
const EVENT = 'm';
/**
 * A message can arrive before its sender's presence does (a newcomer says hello right after it appears): it waits this
 * long, a few per key, and is delivered only once the key is present.
 */
const EARLY_MS = 4000;
const EARLY_PER_KEY = 6;
const EARLY_KEYS = 32;

/** Per visitor message limits (as the relay's `rooms.ts`). */
export const SUPABASE_LIMITS = Object.freeze({ msgPerSec: 20, msgBurst: 40, chatPerMin: 20, chatBurst: 5, signalPerSec: COPRESENCE_SIGNAL_PER_SEC, signalBurst: COPRESENCE_SIGNAL_BURST, floodDrops: 200 });

/** The build's Supabase project, or null when the build has none (then this transport is not offered). */
export interface SupabaseConfig {
  url: string;
  key: string;
}

/** The project the build was made with (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` or `…_PUBLISHABLE_KEY`). */
export function supabaseConfig(
  // Named one by one: `import.meta.env` as a whole would put every build variable in the chunk.
  env: Readonly<Record<string, unknown>> = { VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY, VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
): SupabaseConfig | null {
  const url = env['VITE_SUPABASE_URL'];
  const key = env['VITE_SUPABASE_ANON_KEY'] || env['VITE_SUPABASE_PUBLISHABLE_KEY'];
  if (typeof url !== 'string' || typeof key !== 'string' || !key) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? { url: u.origin, key } : null;
  } catch {
    return null;
  }
}

/** A token bucket. */
export class Bucket {
  private tokens: number;
  private at: number;
  constructor(
    private readonly perSec: number,
    private readonly burst: number,
    now: number,
  ) {
    this.tokens = burst;
    this.at = now;
  }
  take(now: number): boolean {
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.at) / 1000) * this.perSec);
    this.at = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** The message, chat and signalling buckets of one visitor. */
export class Limiter {
  private readonly msg: Bucket;
  private readonly chat: Bucket;
  private readonly signal: Bucket;
  dropped = 0;
  constructor(now: number) {
    this.msg = new Bucket(SUPABASE_LIMITS.msgPerSec, SUPABASE_LIMITS.msgBurst, now);
    this.chat = new Bucket(SUPABASE_LIMITS.chatPerMin / 60, SUPABASE_LIMITS.chatBurst, now);
    this.signal = new Bucket(SUPABASE_LIMITS.signalPerSec, SUPABASE_LIMITS.signalBurst, now);
  }
  allow(m: PresenceMessage, now: number): boolean {
    const ok = m.t === 'rtc' ? this.signal.take(now) : this.msg.take(now) && (m.t !== 'chat' || this.chat.take(now));
    if (!ok) this.dropped++;
    return ok;
  }
}

const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

function randomPeerId(): string {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** What this transport needs of a Realtime channel (the `@supabase/realtime-js` one; a fake in tests). */
export interface RealtimeChannelLike {
  on(type: 'presence', filter: { event: 'sync' | 'join' | 'leave' }, cb: (p: { key?: string }) => void): RealtimeChannelLike;
  on(type: 'broadcast', filter: { event: string }, cb: (p: { payload?: unknown }) => void): RealtimeChannelLike;
  subscribe(cb: (status: string) => void): unknown;
  presenceState(): Record<string, unknown[]>;
  track(payload: Record<string, unknown>): Promise<unknown>;
  send(args: { type: 'broadcast'; event: string; payload: unknown }): Promise<unknown>;
}
export interface RealtimeClientLike {
  channel(topic: string, opts: { config: { broadcast: { self: boolean; ack: boolean }; presence: { key: string; enabled: boolean }; private: boolean } }): RealtimeChannelLike;
  removeChannel(ch: RealtimeChannelLike): Promise<unknown>;
  disconnect(): Promise<unknown> | void;
}

/** A Realtime client for `cfg` (loads `@supabase/realtime-js`). */
async function realtimeClient(cfg: SupabaseConfig): Promise<RealtimeClientLike> {
  const { RealtimeClient } = await import('@supabase/realtime-js');
  const endpoint = `${cfg.url.replace(/^http/, 'ws')}/realtime/v1`;
  return new RealtimeClient(endpoint, { params: { apikey: cfg.key }, heartbeatIntervalMs: 15_000 }) as unknown as RealtimeClientLike;
}

export class SupabaseTransport implements CopresenceTransport {
  readonly kind = 'supabase';
  readonly voice = true;
  private client: RealtimeClientLike | null = null;
  private channel: RealtimeChannelLike | null = null;
  private readonly id = randomPeerId();
  /** Peers listed (at most 15). */
  private readonly peers = new Set<string>();
  /** Peers ignored (flooding, or said bye) until their presence goes. */
  private readonly muted = new Set<string>();
  private readonly limits = new Map<string, Limiter>();
  /** Messages from keys not (yet) present, by key. */
  private readonly early = new Map<string, { at: number; msgs: string[] }>();
  private own: Limiter;
  private live = false;
  private ended = false;
  private readonly message = new Listeners<[string, PresenceMessage]>();
  private readonly join = new Listeners<[string]>();
  private readonly leave = new Listeners<[string]>();
  private readonly end = new Listeners<[TransportEnd]>();

  constructor(
    private readonly world: string,
    private readonly cfg: SupabaseConfig,
    private readonly makeClient: (cfg: SupabaseConfig) => Promise<RealtimeClientLike> = realtimeClient,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.own = new Limiter(this.now());
  }

  async connect(roomId: string): Promise<string> {
    this.close();
    this.ended = false;
    let client: RealtimeClientLike;
    try {
      client = await this.makeClient(this.cfg);
    } catch {
      throw new TransportError('unreachable');
    }
    this.client = client;
    const ch = client.channel(`aether-copresence:${this.world}/${roomId}`, { config: { broadcast: { self: false, ack: false }, presence: { key: this.id, enabled: true }, private: false } });
    this.channel = ch;
    let synced: (() => void) | null = null;
    const firstSync = new Promise<void>((ok) => (synced = ok));
    ch.on('presence', { event: 'sync' }, () => {
      synced?.();
      if (this.live) this.reconcile();
    });
    ch.on('presence', { event: 'join' }, () => this.live && this.reconcile());
    ch.on('presence', { event: 'leave' }, () => this.live && this.reconcile());
    ch.on('broadcast', { event: EVENT }, (p) => this.receive(p.payload));
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new TransportError('unreachable')), CONNECT_TIMEOUT_MS);
        ch.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            clearTimeout(timer);
            resolve();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            clearTimeout(timer);
            if (this.live && this.channel === ch) this.fail('lost');
            else reject(new TransportError('unreachable'));
          }
        });
      });
      // Count the room before taking a place in it.
      await Promise.race([firstSync, new Promise((ok) => setTimeout(ok, SYNC_WAIT_MS))]);
      if (this.channel !== ch) throw new TransportError('closed');
      if (this.others().length >= COPRESENCE_MAX_PEERS) throw new TransportError('full');
      // Listen before appearing: the others greet a newcomer as soon as its presence shows.
      this.live = true;
      this.reconcile();
      await ch.track({});
    } catch (err) {
      if (this.channel === ch) this.teardown();
      throw err instanceof TransportError ? err : new TransportError('unreachable');
    }
    return this.id;
  }

  send(msg: PresenceMessage): void {
    const ch = this.channel;
    if (!ch || !this.live) return;
    const m = JSON.stringify(msg);
    if (utf8Bytes(m) > maxMessageBytes(msg.t)) return;
    if (!this.own.allow(msg, this.now())) return;
    void ch.send({ type: 'broadcast', event: EVENT, payload: { f: this.id, m } }).catch(() => undefined);
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
    this.teardown();
  }

  /** Present keys other than this visitor's, valid and not shared by two connections (a key claimed twice counts for no one). */
  private others(): string[] {
    const state = this.channel?.presenceState() ?? {};
    return Object.keys(state).filter((k) => k !== this.id && PEER_ID_RE.test(k) && Array.isArray(state[k]) && state[k].length === 1);
  }

  /** Bring the peer list in line with presence: join the new (up to the cap), leave the gone. */
  private reconcile(): void {
    const present = new Set(this.others());
    for (const id of [...this.peers]) if (!present.has(id)) this.drop(id);
    for (const id of [...this.muted]) if (!present.has(id)) this.muted.delete(id);
    for (const id of present) {
      if (this.peers.has(id) || this.muted.has(id) || this.peers.size >= COPRESENCE_MAX_PEERS - 1) continue;
      this.peers.add(id);
      this.limits.set(id, new Limiter(this.now()));
      this.join.emit(id);
      const waiting = this.early.get(id);
      this.early.delete(id);
      if (waiting && this.now() - waiting.at <= EARLY_MS) for (const m of waiting.msgs) this.deliver(id, m);
    }
  }

  /** Keep a message from a key not present yet (bounded, short lived). */
  private hold(f: string, m: string): void {
    const now = this.now();
    for (const [k, e] of this.early) if (now - e.at > EARLY_MS) this.early.delete(k);
    const e = this.early.get(f);
    if (e) {
      if (e.msgs.length < EARLY_PER_KEY) e.msgs.push(m);
    } else if (this.early.size < EARLY_KEYS && PEER_ID_RE.test(f) && !this.muted.has(f)) this.early.set(f, { at: now, msgs: [m] });
  }

  private receive(payload: unknown): void {
    if (!this.live || !payload || typeof payload !== 'object') return;
    const { f, m } = payload as { f?: unknown; m?: unknown };
    // The sender is a listed presence key, never a field of the message itself.
    if (typeof f !== 'string' || f === this.id || typeof m !== 'string' || utf8Bytes(m) > COPRESENCE_MAX_SIGNAL_BYTES) return;
    if (!this.peers.has(f)) return this.hold(f, m);
    this.deliver(f, m);
  }

  private deliver(f: string, m: string): void {
    const msg = parsePresence(m);
    if (!msg) return;
    const lim = this.limits.get(f);
    if (!lim || !lim.allow(msg, this.now())) {
      if (lim && lim.dropped >= SUPABASE_LIMITS.floodDrops) {
        this.muted.add(f);
        this.drop(f);
      }
      return;
    }
    // Signalling for another visitor: counted against its sender above, not delivered.
    if (msg.t === 'rtc' && msg.to !== this.id) return;
    this.message.emit(f, msg);
    if (msg.t === 'bye') {
      // Gone until its presence goes too (no ghost rejoin in between).
      this.muted.add(f);
      this.drop(f);
    }
  }

  private drop(id: string): void {
    this.limits.delete(id);
    if (this.peers.delete(id)) this.leave.emit(id);
  }

  private fail(why: TransportEnd): void {
    this.teardown();
    if (this.ended) return;
    this.ended = true;
    this.end.emit(why);
  }

  private teardown(): void {
    this.live = false;
    const ch = this.channel;
    const client = this.client;
    this.channel = null;
    this.client = null;
    this.peers.clear();
    this.muted.clear();
    this.limits.clear();
    this.early.clear();
    this.own = new Limiter(this.now());
    if (client) {
      void (ch ? client.removeChannel(ch) : Promise.resolve())
        .catch(() => undefined)
        .then(() => client.disconnect());
    }
  }
}
