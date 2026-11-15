/**
 * Shared visits over Supabase Realtime (player copresence/supabase.ts), against an in-memory stand-in for one Realtime
 * project: presence (keys, metas, sync / join / leave) and broadcast to the others. Checks what the transport enforces
 * on the client in place of the relay: the 16-visitor cap, sender = presence key, parsePresence and the size cap, and the
 * rate limits both ways.
 */
import { describe, expect, it } from 'vitest';
import { COPRESENCE_MAX_PEERS, COPRESENCE_VERSION, type PresenceMessage } from '@aether/core/copresence';
import { Bucket, SupabaseTransport, supabaseConfig, type RealtimeChannelLike, type RealtimeClientLike } from '../src/player/copresence/supabase';
import { TransportError } from '../src/player/copresence/transport';

type Cb = (p: { key?: string; payload?: unknown }) => void;

/** One fake Realtime project: topics, their members' presence and broadcast. */
class Hub {
  readonly topics = new Map<string, Set<FakeChannel>>();
  members(topic: string): Set<FakeChannel> {
    let s = this.topics.get(topic);
    if (!s) this.topics.set(topic, (s = new Set()));
    return s;
  }
  state(topic: string): Record<string, unknown[]> {
    const out: Record<string, unknown[]> = {};
    for (const c of this.members(topic)) if (c.tracked) (out[c.key] ??= []).push({ presence_ref: c.key });
    return out;
  }
  presenceChanged(topic: string, event: 'join' | 'leave'): void {
    for (const c of this.members(topic)) {
      c.fire('presence', event, {});
      c.fire('presence', 'sync', {});
    }
  }
  client(): RealtimeClientLike {
    return {
      channel: (topic, opts) => new FakeChannel(this, topic, opts.config.presence.key),
      removeChannel: async (ch) => (ch as FakeChannel).leave(),
      disconnect: () => undefined,
    };
  }
}

class FakeChannel implements RealtimeChannelLike {
  tracked = false;
  private readonly cbs: Array<{ type: string; event: string; cb: Cb }> = [];
  sent: unknown[] = [];
  constructor(
    readonly hub: Hub,
    readonly topic: string,
    readonly key: string,
  ) {}
  on(type: 'presence' | 'broadcast', filter: { event: string }, cb: Cb): RealtimeChannelLike {
    this.cbs.push({ type, event: filter.event, cb });
    return this;
  }
  fire(type: string, event: string, p: { payload?: unknown }): void {
    for (const c of this.cbs) if (c.type === type && c.event === event) c.cb(p);
  }
  subscribe(cb: (status: string) => void): unknown {
    this.hub.members(this.topic).add(this);
    queueMicrotask(() => {
      cb('SUBSCRIBED');
      this.fire('presence', 'sync', {});
    });
    return this;
  }
  presenceState(): Record<string, unknown[]> {
    return this.hub.state(this.topic);
  }
  async track(): Promise<unknown> {
    this.tracked = true;
    this.hub.presenceChanged(this.topic, 'join');
    return 'ok';
  }
  async send(args: { type: 'broadcast'; event: string; payload: unknown }): Promise<unknown> {
    this.sent.push(args.payload);
    for (const c of this.hub.members(this.topic)) if (c !== this) c.fire('broadcast', args.event, { payload: args.payload });
    return 'ok';
  }
  leave(): void {
    if (!this.hub.members(this.topic).delete(this)) return;
    if (this.tracked) this.hub.presenceChanged(this.topic, 'leave');
  }
  /** A peer that broadcasts a raw payload (a crafted client). */
  raw(payload: unknown): void {
    for (const c of this.hub.members(this.topic)) if (c !== this) c.fire('broadcast', 'm', { payload });
  }
}

const cfg = { url: 'https://example.supabase.co', key: 'public-anon' };
const hello = (name: string): PresenceMessage => ({ v: COPRESENCE_VERSION, t: 'hello', name, body: 'kaho-vrm' });
const chat = (text: string): PresenceMessage => ({ v: COPRESENCE_VERSION, t: 'chat', text });
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function visitor(hub: Hub, clock = { t: 0 }) {
  const t = new SupabaseTransport('himalayan-valley', cfg, async () => hub.client(), () => clock.t);
  const got: Array<[string, PresenceMessage]> = [];
  const joined: string[] = [];
  const left: string[] = [];
  t.onMessage((from, m) => got.push([from, m]));
  t.onPeerJoin((id) => joined.push(id));
  t.onPeerLeave((id) => left.push(id));
  return { t, got, joined, left };
}

describe('supabaseConfig', () => {
  it('needs an https URL and a key; prefers the anon key', () => {
    expect(supabaseConfig({})).toBeNull();
    expect(supabaseConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co' })).toBeNull();
    expect(supabaseConfig({ VITE_SUPABASE_URL: 'http://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'k' })).toBeNull();
    expect(supabaseConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co/', VITE_SUPABASE_ANON_KEY: 'a', VITE_SUPABASE_PUBLISHABLE_KEY: 'p' })).toEqual({ url: 'https://x.supabase.co', key: 'a' });
    expect(supabaseConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'p' })).toEqual({ url: 'https://x.supabase.co', key: 'p' });
  });
});

describe('SupabaseTransport', () => {
  it('two visitors meet in one channel per world and room, see each other join, talk and leave', async () => {
    const hub = new Hub();
    const a = visitor(hub);
    const b = visitor(hub);
    const ida = await a.t.connect('room123456');
    const idb = await b.t.connect('room123456');
    expect([...hub.topics.keys()]).toEqual(['aether-copresence:himalayan-valley/room123456']);
    expect(a.joined).toEqual([idb]);
    expect(b.joined).toEqual([ida]);
    a.t.send(hello('Ana'));
    b.t.send(chat('hi'));
    await tick();
    expect(b.got).toEqual([[ida, hello('Ana')]]);
    expect(a.got).toEqual([[idb, chat('hi')]]);
    b.t.close();
    await tick();
    expect(a.left).toEqual([idb]);
  });

  it('refuses to join a full room (16 visitors)', async () => {
    const hub = new Hub();
    for (let i = 0; i < COPRESENCE_MAX_PEERS; i++) await visitor(hub).t.connect('fullroom1');
    const late = visitor(hub);
    await expect(late.t.connect('fullroom1')).rejects.toEqual(new TransportError('full'));
    expect(Object.keys(hub.state('aether-copresence:himalayan-valley/fullroom1'))).toHaveLength(COPRESENCE_MAX_PEERS);
  });

  it('takes the sender from presence: unknown or absent keys and invalid or oversized messages are dropped', async () => {
    const hub = new Hub();
    const a = visitor(hub);
    const b = visitor(hub);
    await a.t.connect('room123456');
    const idb = await b.t.connect('room123456');
    const ch = [...hub.members('aether-copresence:himalayan-valley/room123456')][1]!;
    ch.raw({ f: 'nobody12', m: JSON.stringify(hello('Eve')) }); // not present
    ch.raw({ m: JSON.stringify(hello('Eve')) }); // no sender
    ch.raw({ f: idb, m: hello('Eve') }); // not a string
    ch.raw({ f: idb, m: JSON.stringify({ ...hello('Eve'), admin: true }) }); // not a presence message
    ch.raw({ f: idb, m: JSON.stringify(chat('x'.repeat(190))).padEnd(1100, ' ') }); // over 1 KB
    ch.raw({ f: idb, from: 'other', m: JSON.stringify(hello('Bo')) });
    await tick();
    expect(a.got).toEqual([[idb, hello('Bo')]]);
  });

  it('holds a message that arrives before the presence of its sender, and delivers it once the key is present', async () => {
    const hub = new Hub();
    const clock = { t: 0 };
    const a = visitor(hub, clock);
    await a.t.connect('room123456');
    const topic = 'aether-copresence:himalayan-valley/room123456';
    const late = new FakeChannel(hub, topic, 'abcdef123456');
    late.subscribe(() => undefined);
    await tick();
    late.raw({ f: 'abcdef123456', m: JSON.stringify(hello('Early')) });
    late.raw({ f: 'zzzzzz999999', m: JSON.stringify(hello('Never')) });
    expect(a.got).toEqual([]);
    await late.track();
    expect(a.joined).toEqual(['abcdef123456']);
    expect(a.got).toEqual([['abcdef123456', hello('Early')]]);
    // Too late: a held message expires.
    const later = new FakeChannel(hub, topic, 'aaaaaa111111');
    later.subscribe(() => undefined);
    await tick();
    later.raw({ f: 'aaaaaa111111', m: JSON.stringify(hello('Stale')) });
    clock.t = 10_000;
    await later.track();
    expect(a.got).toHaveLength(1);
  });

  it('a visitor who said bye stays gone until its presence goes', async () => {
    const hub = new Hub();
    const a = visitor(hub);
    const b = visitor(hub);
    await a.t.connect('room123456');
    const idb = await b.t.connect('room123456');
    b.t.send({ v: COPRESENCE_VERSION, t: 'bye' });
    await tick();
    expect(a.left).toEqual([idb]);
    hub.presenceChanged('aether-copresence:himalayan-valley/room123456', 'join');
    expect(a.joined).toEqual([idb]);
  });

  it('ignores a key two connections claim', async () => {
    const hub = new Hub();
    const a = visitor(hub);
    const b = visitor(hub);
    await a.t.connect('room123456');
    const idb = await b.t.connect('room123456');
    const topic = 'aether-copresence:himalayan-valley/room123456';
    const twin = new FakeChannel(hub, topic, idb);
    twin.subscribe(() => undefined);
    await twin.track();
    expect(a.left).toEqual([idb]);
  });

  it('rate-limits what it sends (20/s, burst 40; chat 5 then 20/min) and drops a flooding peer', async () => {
    const hub = new Hub();
    const clock = { t: 0 };
    const a = visitor(hub, clock);
    const b = visitor(hub, clock);
    await a.t.connect('room123456');
    const idb = await b.t.connect('room123456');
    for (let i = 0; i < 100; i++) a.t.send(hello(`N${i}`));
    for (let i = 0; i < 10; i++) b.t.send(chat(`c${i}`));
    await tick();
    expect(b.got).toHaveLength(40);
    expect(a.got).toHaveLength(5);
    // A crafted peer that skips its own limit: 40 get through, the rest are dropped, and after 200 drops it is ignored.
    const ch = [...hub.members('aether-copresence:himalayan-valley/room123456')][1]!;
    clock.t = 60_000;
    a.got.length = 0;
    for (let i = 0; i < 300; i++) ch.raw({ f: idb, m: JSON.stringify(hello(`F${i}`)) });
    await tick();
    expect(a.got).toHaveLength(40);
    expect(a.left).toEqual([idb]);
    clock.t = 120_000;
    ch.raw({ f: idb, m: JSON.stringify(hello('again')) });
    await tick();
    expect(a.got).toHaveLength(40);
  });

  it('does not send a message over 1 KB', async () => {
    const hub = new Hub();
    const a = visitor(hub);
    await a.t.connect('room123456');
    const ch = [...hub.members('aether-copresence:himalayan-valley/room123456')][0]!;
    a.t.send(chat('ü'.repeat(200)) as PresenceMessage); // 200 chars but 400 bytes: fits
    a.t.send({ v: 1, t: 'chat', text: 'x'.repeat(1100) } as PresenceMessage);
    expect(ch.sent).toHaveLength(1);
  });

  it('Bucket refills over time', () => {
    const b = new Bucket(2, 2, 0);
    expect([b.take(0), b.take(0), b.take(0)]).toEqual([true, true, false]);
    expect(b.take(500)).toBe(true);
    expect(b.take(500)).toBe(false);
  });
});
