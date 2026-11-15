/**
 * Shared visits relay: the rooms (join, relay, validation, limits, idle drop) and the WebSocket on a real socket
 * (handshake through the app's guards, origin check, frame cap).
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { serve } from '@hono/node-server';
import { COPRESENCE_MAX_PEERS, COPRESENCE_MAX_SIGNAL_BYTES, VOICE_MAX_TALKERS, parseRelayFrame, type RelayFrame } from '@aether/core/copresence';
import { RoomRegistry, type RelayPeer } from '../src/copresence/rooms';
import { attachCopresence, type CopresenceRelay } from '../src/copresence/relay';
import { acceptKey } from '../src/copresence/ws';
import { cleanupDirs, makeApp, makeConfig } from './helpers';

const hello = (name: string): string => JSON.stringify({ v: 1, t: 'hello', name, body: 'kaho-vrm' });
/** An audio-only offer the size Chrome makes (about 3 KB, over the 1 KB of other messages). */
const SDP = `v=0\r\no=- 4611731400430051336 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n${'a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level\r\n'.repeat(55)}`;
const rtc = (to: string, k: 'offer' | 'answer' = 'offer'): string => JSON.stringify({ v: 1, t: 'rtc', to, k, sdp: SDP });
const state = (x: number): string => JSON.stringify({ v: 1, t: 'state', ts: 1, p: [x, 0, 0], h: 0, m: 1 });

interface FakePeer extends RelayPeer {
  frames: RelayFrame[];
  closed: number | null;
}
function fakePeer(): FakePeer {
  const p: FakePeer = {
    frames: [],
    closed: null,
    send(t) {
      const f = parseRelayFrame(t);
      if (f) p.frames.push(f);
    },
    close(code) {
      p.closed = code;
    },
  };
  return p;
}

describe('RoomRegistry', () => {
  let t = 0;
  let n = 0;
  const make = (limits = {}): RoomRegistry => new RoomRegistry({ now: () => t, newId: () => `peer${String(++n).padStart(4, '0')}`, limits });
  afterEach(() => {
    t = 0;
  });

  it('welcomes a visitor with the others and tells them', () => {
    const r = make();
    const a = fakePeer();
    const b = fakePeer();
    const ja = r.join('w/room01', a);
    const jb = r.join('w/room01', b);
    if (!('id' in ja) || !('id' in jb)) throw new Error('refused');
    expect(a.frames[0]).toEqual({ k: 'welcome', v: 1, id: ja.id, peers: [] });
    expect(b.frames[0]).toEqual({ k: 'welcome', v: 1, id: jb.id, peers: [ja.id] });
    expect(a.frames[1]).toEqual({ k: 'join', id: jb.id });
  });

  it('relays valid messages stamped with the sender, to its room only', () => {
    const r = make();
    const a = fakePeer();
    const b = fakePeer();
    const other = fakePeer();
    const ja = r.join('w/room01', a) as { id: string };
    r.join('w/room01', b);
    r.join('w/room02', other);
    r.receive(ja.id, hello('Ada'));
    r.receive(ja.id, state(120));
    const got = b.frames.filter((f) => f.k === 'msg');
    expect(got).toEqual([
      { k: 'msg', from: ja.id, m: { v: 1, t: 'hello', name: 'Ada', body: 'kaho-vrm' } },
      { k: 'msg', from: ja.id, m: { v: 1, t: 'state', ts: 1, p: [120, 0, 0], h: 0, m: 1 } },
    ]);
    expect(a.frames.some((f) => f.k === 'msg')).toBe(false);
    expect(other.frames.some((f) => f.k === 'msg')).toBe(false);
  });

  it('drops invalid messages (unknown fields, spoofed sender, wrong version, unclean names)', () => {
    const r = make();
    const a = fakePeer();
    const b = fakePeer();
    const ja = r.join('w/room01', a) as { id: string };
    r.join('w/room01', b);
    for (const bad of [
      'not json',
      JSON.stringify({ v: 1, t: 'state', ts: 1, p: [0, 0, 0], h: 0, m: 1, from: 'someoneelse' }),
      JSON.stringify({ v: 2, t: 'hello', name: 'x', body: 'kaho-vrm' }),
      JSON.stringify({ v: 1, t: 'hello', name: 'a‮b', body: 'kaho-vrm' }),
      JSON.stringify({ v: 1, t: 'hello', name: 'x', body: 'marcus' }),
      JSON.stringify({ v: 1, t: 'chat', text: 'x'.repeat(201) }),
      'x'.repeat(2000),
    ])
      r.receive(ja.id, bad);
    expect(b.frames.filter((f) => f.k === 'msg')).toEqual([]);
    expect(a.frames).toContainEqual({ k: 'error', code: 'bad-message' });
  });

  it(`refuses visitor ${COPRESENCE_MAX_PEERS + 1} and caps the number of rooms`, () => {
    const r = make({ maxRooms: 2 });
    for (let i = 0; i < COPRESENCE_MAX_PEERS; i++) expect('id' in r.join('w/full01', fakePeer())).toBe(true);
    const late = fakePeer();
    expect(r.join('w/full01', late)).toEqual({ refused: 'full' });
    expect(late.frames).toEqual([{ k: 'error', code: 'full' }]);
    expect(late.closed).toBe(4001);
    r.join('w/room02', fakePeer());
    expect(r.join('w/room03', fakePeer())).toEqual({ refused: 'too-many-rooms' });
  });

  it('rate limits chat and drops a visitor far over the limits', () => {
    const r = make({ chatBurst: 2, maxStrikes: 5 });
    const a = fakePeer();
    const b = fakePeer();
    const ja = r.join('w/room01', a) as { id: string };
    r.join('w/room01', b);
    for (let i = 0; i < 4; i++) r.receive(ja.id, JSON.stringify({ v: 1, t: 'chat', text: `hi ${i}` }));
    expect(b.frames.filter((f) => f.k === 'msg')).toHaveLength(2);
    expect(a.frames).toContainEqual({ k: 'error', code: 'rate' });
    for (let i = 0; i < 4; i++) r.receive(ja.id, 'junk');
    expect(a.closed).toBe(4003);
    expect(b.frames.at(-1)).toEqual({ k: 'leave', id: ja.id });
    expect(r.size).toEqual({ rooms: 1, peers: 1 });
  });

  it('forwards voice signalling to the one visitor it names, in the same room only', () => {
    const r = make();
    const [a, b, c, elsewhere] = [fakePeer(), fakePeer(), fakePeer(), fakePeer()];
    const ja = r.join('w/room01', a) as { id: string };
    const jb = r.join('w/room01', b) as { id: string };
    r.join('w/room01', c);
    const je = r.join('w/room02', elsewhere) as { id: string };
    expect(rtc(jb.id).length).toBeGreaterThan(2000);
    r.receive(ja.id, rtc(jb.id));
    r.receive(ja.id, JSON.stringify({ v: 1, t: 'rtc', to: jb.id, k: 'ice', c: 'candidate:1 1 udp 2122260223 abc.local 54321 typ host', mid: '0', i: 0 }));
    // To a visitor of another room, to itself, to no one here: dropped (quietly: a peer may just have left).
    r.receive(ja.id, rtc(je.id));
    r.receive(ja.id, rtc(ja.id));
    r.receive(ja.id, rtc('peer9999'));
    const toB = b.frames.filter((f) => f.k === 'msg');
    expect(toB.map((f) => f.k === 'msg' && f.m.t === 'rtc' && f.m.k)).toEqual(['offer', 'ice']);
    expect(toB.every((f) => f.k === 'msg' && f.from === ja.id)).toBe(true);
    for (const p of [a, c, elsewhere]) expect(p.frames.filter((f) => f.k === 'msg')).toEqual([]);
    expect(a.frames.some((f) => f.k === 'error')).toBe(false);
    // `voice` goes to the room like any other message.
    r.receive(jb.id, JSON.stringify({ v: 1, t: 'voice', on: true }));
    expect(c.frames.at(-1)).toEqual({ k: 'msg', from: jb.id, m: { v: 1, t: 'voice', on: true } });
  });

  it('holds signalling to 8 KB, everything else to 1 KB, and rate limits it on its own bucket', () => {
    const r = make({ signalBurst: 3, messageBurst: 5 });
    const a = fakePeer();
    const b = fakePeer();
    const ja = r.join('w/room01', a) as { id: string };
    const jb = r.join('w/room01', b) as { id: string };
    // A chat-sized message padded past 1 KB is refused even though an rtc may be that big.
    r.receive(ja.id, JSON.stringify({ v: 1, t: 'voice', on: true, pad: 'x'.repeat(1100) }));
    r.receive(ja.id, `{"v":1,"t":"voice","on":true}${' '.repeat(1100)}`);
    r.receive(ja.id, JSON.stringify({ v: 1, t: 'rtc', to: jb.id, k: 'offer', sdp: `v=0\r\n${'a'.repeat(COPRESENCE_MAX_SIGNAL_BYTES)}` }));
    expect(b.frames.filter((f) => f.k === 'msg')).toEqual([]);
    expect(a.frames).toContainEqual({ k: 'error', code: 'bad-message' });
    // Signalling does not eat the state budget (three junk messages took three of its five) and is capped by its own.
    for (let i = 0; i < 5; i++) r.receive(ja.id, rtc(jb.id));
    expect(b.frames.filter((f) => f.k === 'msg')).toHaveLength(3);
    r.receive(ja.id, state(1));
    r.receive(ja.id, state(2));
    expect(b.frames.filter((f) => f.k === 'msg')).toHaveLength(5);
  });

  it('drops idle visitors, says bye, and forgets empty rooms', () => {
    const r = make({ idleMs: 1000 });
    const a = fakePeer();
    const b = fakePeer();
    const ja = r.join('w/room01', a) as { id: string };
    const jb = r.join('w/room01', b) as { id: string };
    t = 800;
    r.receive(jb.id, state(1));
    t = 1500;
    expect(r.sweep()).toBe(1);
    expect(a.closed).toBe(4002);
    expect(b.frames.at(-1)).toEqual({ k: 'leave', id: ja.id });
    r.receive(jb.id, JSON.stringify({ v: 1, t: 'bye' }));
    expect(r.size).toEqual({ rooms: 0, peers: 0 });
  });
});

describe('relay over WebSocket', () => {
  let server: Server;
  let relay: CopresenceRelay;
  let base: string;
  beforeAll(async () => {
    const app = makeApp(makeConfig());
    server = await new Promise<Server>((resolve) => {
      const s = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, () => resolve(s as Server)) as Server;
    });
    relay = attachCopresence(server, (req, env) => app.fetch(req, env));
    base = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    relay.close();
    await new Promise<void>((r) => server.close(() => r()));
    cleanupDirs();
  });

  const open = (query: string, origin = `http://${base}`): Promise<{ ws: WebSocket; frames: RelayFrame[]; closed: Promise<number> }> =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://${base}/api/copresence/ws?${query}`, { headers: { origin } } as unknown as string[]);
      const frames: RelayFrame[] = [];
      const closed = new Promise<number>((r) => ws.addEventListener('close', (e) => r(e.code)));
      ws.addEventListener('message', (e) => {
        const f = parseRelayFrame(String(e.data));
        if (f) frames.push(f);
      });
      ws.addEventListener('open', () => resolve({ ws, frames, closed }));
      ws.addEventListener('error', () => reject(new Error('refused')));
    });
  const until = async (fn: () => boolean): Promise<void> => {
    for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 10));
    expect(fn()).toBe(true);
  };

  it('answers the availability check and refuses plain requests to the socket path', async () => {
    const health = await fetch(`http://${base}/api/copresence`);
    expect(await health.json()).toEqual({ ok: true, v: 1, maxPeers: COPRESENCE_MAX_PEERS, voice: true, maxTalkers: VOICE_MAX_TALKERS });
    expect((await fetch(`http://${base}/api/copresence/ws?world=himalayan-valley&room=abcdef12`)).status).toBe(426);
  });

  it('relays between two visitors of a room', async () => {
    const a = await open('world=himalayan-valley&room=abcdef12');
    const b = await open('world=himalayan-valley&room=abcdef12');
    await until(() => a.frames.length >= 2 && b.frames.length >= 1);
    const wa = a.frames[0] as Extract<RelayFrame, { k: 'welcome' }>;
    const wb = b.frames[0] as Extract<RelayFrame, { k: 'welcome' }>;
    expect(wb.peers).toEqual([wa.id]);
    expect(a.frames[1]).toEqual({ k: 'join', id: wb.id });
    b.ws.send(hello('Bea'));
    await until(() => a.frames.some((f) => f.k === 'msg'));
    expect(a.frames.find((f) => f.k === 'msg')).toEqual({ k: 'msg', from: wb.id, m: { v: 1, t: 'hello', name: 'Bea', body: 'kaho-vrm' } });
    // A session description (over 1 KB) passes the socket's frame cap and reaches the one it is for.
    b.ws.send(rtc(wa.id));
    await until(() => a.frames.some((f) => f.k === 'msg' && f.m.t === 'rtc'));
    b.ws.close();
    await until(() => a.frames.some((f) => f.k === 'leave'));
    a.ws.close();
  });

  it('refuses another site, a bad room and an oversized frame', async () => {
    await expect(open('world=himalayan-valley&room=abcdef12', 'https://evil.example')).rejects.toThrow();
    await expect(open('world=himalayan-valley&room=BAD')).rejects.toThrow();
    const a = await open('world=himalayan-valley&room=abcdef13');
    a.ws.send('x'.repeat(COPRESENCE_MAX_SIGNAL_BYTES + 100));
    expect(await a.closed).toBe(1009);
  });

  it('computes the RFC 6455 accept key', () => {
    expect(acceptKey('dGhlIHNhbXBsZSBub25jZQ==')).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  });
});
