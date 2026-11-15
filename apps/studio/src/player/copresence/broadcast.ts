/**
 * Shared visits between tabs of one browser, over a `BroadcastChannel` (tests and local demos: `#…&room=<id>&relay=tabs`).
 *
 * There is no server, so the tabs keep the room themselves: a tab announces `join`, the others answer `here`, each
 * sends a `beat` every {@link BEAT_MS} and says `leave` when it closes; a tab not heard from for {@link LOST_MS} is
 * gone (a crashed or frozen tab cannot say goodbye). Every frame is validated like a relay's.
 */
import { COPRESENCE_MAX_PEERS, PEER_ID_RE, parsePresence, type PresenceMessage } from '@aether/core/copresence';
import { Listeners, TransportError, type CopresenceTransport, type TransportEnd } from './transport';

const BEAT_MS = 2000;
const LOST_MS = 7000;

type Frame = { k: 'join' | 'here' | 'leave' | 'beat'; from: string } | { k: 'msg'; from: string; m: unknown };

function randomPeerId(): string {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export class BroadcastTransport implements CopresenceTransport {
  readonly kind = 'broadcast';
  readonly voice = true;
  private channel: BroadcastChannel | null = null;
  private readonly id = randomPeerId();
  private readonly peers = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly message = new Listeners<[string, PresenceMessage]>();
  private readonly join = new Listeners<[string]>();
  private readonly leave = new Listeners<[string]>();
  private readonly end = new Listeners<[TransportEnd]>();

  constructor(
    private readonly world: string,
    private readonly now: () => number = () => Date.now(),
  ) {}

  connect(roomId: string): Promise<string> {
    if (typeof BroadcastChannel !== 'function') return Promise.reject(new TransportError('unreachable'));
    this.close();
    const ch = new BroadcastChannel(`aether-copresence:${this.world}/${roomId}`);
    this.channel = ch;
    ch.onmessage = (e: MessageEvent) => this.receive(e.data);
    this.post({ k: 'join', from: this.id });
    this.timer = setInterval(() => {
      this.post({ k: 'beat', from: this.id });
      const cutoff = this.now() - LOST_MS;
      for (const [id, seen] of [...this.peers]) if (seen < cutoff) this.drop(id);
    }, BEAT_MS);
    return Promise.resolve(this.id);
  }

  send(msg: PresenceMessage): void {
    this.post({ k: 'msg', from: this.id, m: msg });
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
    if (!this.channel) return;
    this.post({ k: 'leave', from: this.id });
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.channel.close();
    this.channel = null;
    this.peers.clear();
  }

  private post(f: Frame): void {
    try {
      this.channel?.postMessage(f);
    } catch {
      // closed underneath us
    }
  }

  private receive(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const f = data as { k?: unknown; from?: unknown; m?: unknown };
    if (typeof f.from !== 'string' || !PEER_ID_RE.test(f.from) || f.from === this.id) return;
    const from = f.from;
    if (f.k === 'leave') return this.drop(from);
    const known = this.peers.has(from);
    if (!known) {
      if (this.peers.size >= COPRESENCE_MAX_PEERS - 1) return;
      this.peers.set(from, this.now());
      this.join.emit(from);
    } else this.peers.set(from, this.now());
    if (f.k === 'join') this.post({ k: 'here', from: this.id });
    else if (f.k === 'msg') {
      const m = parsePresence(f.m);
      if (m) this.message.emit(from, m);
      if (m?.t === 'bye') this.drop(from);
    }
  }

  private drop(id: string): void {
    if (this.peers.delete(id)) this.leave.emit(id);
  }
}
