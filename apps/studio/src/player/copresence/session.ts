/**
 * One visitor's side of a shared visit, over any {@link CopresenceTransport}: says hello (name and body), sends its
 * pose at most {@link COPRESENCE_STATE_HZ} times a second and only when the quantised pose changed (plus a keepalive
 * every {@link COPRESENCE_KEEPALIVE_MS}), keeps the other visitors (name, body, an interpolation buffer each) and the
 * chat. Knows nothing of the renderer: `avatars.ts` draws {@link CopresenceSession.remotes}.
 */
import {
  COPRESENCE_CHAT_MAX,
  COPRESENCE_IDLE_MS,
  COPRESENCE_KEEPALIVE_MS,
  COPRESENCE_NAME_MAX,
  COPRESENCE_STATE_HZ,
  COPRESENCE_VERSION,
  cleanPresenceText,
  peerHue,
  quantiseState,
  sameState,
  type PresenceBody,
  type PresenceMessage,
  type PresencePose,
  type PresenceState,
} from '@aether/core/copresence';
import { PoseBuffer } from './interpolate';
import type { CopresenceTransport, TransportEnd } from './transport';

/** Most chat lines kept. */
const CHAT_KEEP = 60;

/** Another visitor. */
export interface RemotePeer {
  id: string;
  /** Empty until its hello arrives. */
  name: string;
  body: PresenceBody;
  /** The hue it picked (its hello's `tint`), else undefined: drawn in {@link RemotePeer.hue}. */
  tint: number | undefined;
  /** The hue it is drawn in: its pick, or the one its id gives. */
  hue: number;
  buffer: PoseBuffer;
  lastSeen: number;
}

/** A chat line (`self`: this visitor's own). */
export interface ChatLine {
  id: number;
  from: string;
  name: string;
  text: string;
  self: boolean;
  at: number;
}

/** What the UI shows. */
export interface SessionSnapshot {
  status: 'connecting' | 'live' | 'full' | 'lost' | 'unreachable' | 'closed';
  /** Visitors here, this one included. */
  count: number;
  peers: Array<{ id: string; name: string; body: PresenceBody; hue: number }>;
  chat: ChatLine[];
}

export interface SessionOptions {
  transport: CopresenceTransport;
  name: string;
  body: PresenceBody;
  /** The outfit hue picked (degrees), or null to be drawn in the one the peer id gives. */
  tint?: number | null;
  /** Monotonic clock in ms (default `performance.now`). */
  now?: () => number;
  /** Called when the snapshot changes (peers, names, chat, status), not on every pose. */
  onChange?: (s: SessionSnapshot) => void;
}

export class CopresenceSession {
  private readonly transport: CopresenceTransport;
  private readonly now: () => number;
  private readonly peers = new Map<string, RemotePeer>();
  private chat: ChatLine[] = [];
  private chatSeq = 0;
  private status: SessionSnapshot['status'] = 'closed';
  private name: string;
  private body: PresenceBody;
  private tint: number | null;
  private selfId: string | null = null;
  private lastSent: PresenceState | null = null;
  private lastSentAt = Number.NEGATIVE_INFINITY;
  private lastPose: PresencePose | null = null;

  constructor(private readonly opts: SessionOptions) {
    this.transport = opts.transport;
    this.now = opts.now ?? (() => performance.now());
    this.name = cleanPresenceText(opts.name, COPRESENCE_NAME_MAX) || 'Visitor';
    this.body = opts.body;
    this.tint = opts.tint ?? null;
    this.transport.onMessage((from, m) => this.receive(from, m));
    this.transport.onPeerJoin((id) => {
      this.peer(id);
      // Introduce ourselves to the newcomer (messages go to the whole room; the others ignore the repeat).
      this.sendHello();
      if (this.lastSent) this.transport.send({ ...this.lastSent, ts: this.clock() });
      this.changed();
    });
    this.transport.onPeerLeave((id) => {
      if (this.peers.delete(id)) this.changed();
    });
    this.transport.onEnd((why: TransportEnd) => {
      this.peers.clear();
      this.status = why === 'full' ? 'full' : why === 'lost' ? 'lost' : 'closed';
      this.changed();
    });
  }

  /** This visitor's peer id once connected. */
  get id(): string | null {
    return this.selfId;
  }

  /** Join `room`. Never throws: a failure shows in the status. */
  async join(room: string): Promise<boolean> {
    this.status = 'connecting';
    this.changed();
    try {
      this.selfId = await this.transport.connect(room);
    } catch (err) {
      const why = (err as { why?: string }).why;
      this.status = why === 'full' ? 'full' : 'unreachable';
      this.changed();
      return false;
    }
    this.status = 'live';
    this.lastSent = null;
    this.lastSentAt = Number.NEGATIVE_INFINITY;
    this.sendHello();
    if (this.lastPose) this.setPose(this.lastPose);
    this.changed();
    return true;
  }

  /** This visitor's pose now; sent when due (rate and change limited). */
  setPose(pose: PresencePose): void {
    this.lastPose = pose;
    if (this.status !== 'live') return;
    const t = this.now();
    const since = t - this.lastSentAt;
    if (since < 1000 / COPRESENCE_STATE_HZ - 1) return;
    const s = quantiseState(pose, this.clock());
    if (sameState(this.lastSent, s) && since < COPRESENCE_KEEPALIVE_MS) return;
    this.transport.send(s);
    this.lastSent = s;
    this.lastSentAt = t;
  }

  /** Change this visitor's name, body or outfit hue (null: the one the peer id gives); sent at once. */
  setIdentity(name: string, body: PresenceBody, tint: number | null = this.tint): void {
    this.name = cleanPresenceText(name, COPRESENCE_NAME_MAX) || this.name;
    this.body = body;
    this.tint = tint;
    this.sendHello();
  }

  /** Send a chat line; false when it was empty or not connected. */
  say(text: string): boolean {
    const t = cleanPresenceText(text, COPRESENCE_CHAT_MAX);
    if (!t || this.status !== 'live') return false;
    this.transport.send({ v: COPRESENCE_VERSION, t: 'chat', text: t });
    this.pushChat(this.selfId ?? 'self', this.name, t, true);
    return true;
  }

  /** The other visitors, with their pose at `nowMs` (null before their first state). Drops the long silent. */
  remotes(nowMs: number = this.now()): Array<{ peer: RemotePeer; pose: PresencePose | null }> {
    const out: Array<{ peer: RemotePeer; pose: PresencePose | null }> = [];
    let dropped = false;
    for (const p of [...this.peers.values()]) {
      if (nowMs - p.lastSeen > COPRESENCE_IDLE_MS) {
        this.peers.delete(p.id);
        dropped = true;
        continue;
      }
      out.push({ peer: p, pose: p.buffer.sample(nowMs) });
    }
    if (dropped) this.changed();
    return out;
  }

  snapshot(): SessionSnapshot {
    return {
      status: this.status,
      count: this.status === 'live' ? this.peers.size + 1 : 0,
      peers: [...this.peers.values()].map((p) => ({ id: p.id, name: p.name || 'Visitor', body: p.body, hue: p.hue })),
      chat: this.chat,
    };
  }

  /** Say goodbye and leave. */
  close(): void {
    if (this.status === 'live') this.transport.send({ v: COPRESENCE_VERSION, t: 'bye' });
    this.transport.close();
    this.peers.clear();
    this.status = 'closed';
    this.changed();
  }

  private clock(): number {
    return Math.floor(this.now()) % 2 ** 31;
  }

  private sendHello(): void {
    if (this.status !== 'live') return;
    this.transport.send(this.tint === null ? { v: COPRESENCE_VERSION, t: 'hello', name: this.name, body: this.body } : { v: COPRESENCE_VERSION, t: 'hello', name: this.name, body: this.body, tint: this.tint });
  }

  private peer(id: string): RemotePeer {
    let p = this.peers.get(id);
    if (!p) {
      p = { id, name: '', body: 'kaho-vrm', tint: undefined, hue: peerHue(id), buffer: new PoseBuffer(), lastSeen: this.now() };
      this.peers.set(id, p);
    }
    return p;
  }

  private receive(from: string, m: PresenceMessage): void {
    if (from === this.selfId) return;
    if (m.t === 'bye') {
      if (this.peers.delete(from)) this.changed();
      return;
    }
    const known = this.peers.has(from);
    const p = this.peer(from);
    p.lastSeen = this.now();
    if (m.t === 'state') {
      p.buffer.push(m, this.now());
      if (!known) this.changed();
    } else if (m.t === 'hello') {
      if (p.name !== m.name || p.body !== m.body || p.tint !== m.tint || !known) {
        p.name = m.name;
        p.body = m.body;
        p.tint = m.tint;
        p.hue = m.tint ?? peerHue(from);
        this.changed();
      }
    } else if (m.t === 'chat') {
      this.pushChat(from, p.name || 'Visitor', m.text, false);
    }
  }

  private pushChat(from: string, name: string, text: string, self: boolean): void {
    this.chat = [...this.chat, { id: ++this.chatSeq, from, name, text, self, at: Date.now() }].slice(-CHAT_KEEP);
    this.changed();
  }

  private changed(): void {
    this.opts.onChange?.(this.snapshot());
  }
}
