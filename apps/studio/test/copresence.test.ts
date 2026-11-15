/**
 * Shared visits in the player: the interpolation buffer, the session's send rules, and two sessions meeting over the
 * BroadcastChannel transport (Node has BroadcastChannel).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { peerHue, quantiseState, type PresenceMessage, type PresenceState } from '@aether/core/copresence';
import { PoseBuffer, angleDelta, SNAP_M } from '../src/player/copresence/interpolate';
import { CopresenceSession, type SessionSnapshot } from '../src/player/copresence/session';
import { BroadcastTransport } from '../src/player/copresence/broadcast';
import { Listeners, type CopresenceTransport } from '../src/player/copresence/transport';
import { loadIdentity, randomName, roomFromHash, withRoom } from '../src/player/copresence/identity';

const st = (x: number, ts: number, yaw = 0): PresenceState => quantiseState({ position: [x, 0, 0], yawDeg: yaw, motion: 'walk' }, ts);

describe('PoseBuffer', () => {
  it('draws 100 ms behind the newest sample, between the two around that moment', () => {
    const b = new PoseBuffer(100);
    // Sender clock 1000.., arriving 5000.. with 20-40 ms of jitter.
    b.push(st(0, 1000), 5020);
    b.push(st(1, 1100), 5140);
    b.push(st(2, 1200), 5220);
    // Offset is the smallest delay (5020 - 1000 = 4020): at 5170 we draw sender time 1050.
    expect(b.sample(5170)?.position[0]).toBeCloseTo(0.5, 5);
    expect(b.sample(5270)?.position[0]).toBeCloseTo(1.5, 5);
    // Past the newest: hold it.
    expect(b.sample(9000)?.position[0]).toBeCloseTo(2, 5);
    // Before the first: the first.
    expect(b.sample(0)?.position[0]).toBe(0);
  });

  it('ignores late and repeated samples, and starts over when the sender clock jumps', () => {
    const b = new PoseBuffer(100);
    b.push(st(0, 1000), 2000);
    b.push(st(5, 1100), 2100);
    b.push(st(9, 1050), 2150);
    b.push(st(9, 1100), 2160);
    expect(b.size).toBe(2);
    b.push(st(3, 1_000_000), 3000);
    expect(b.size).toBe(1);
    expect(b.sample(3000)?.position[0]).toBe(3);
  });

  it('turns along the shorter arc and does not slide through jumps', () => {
    expect(angleDelta(350, 10)).toBe(20);
    expect(angleDelta(10, 350)).toBe(-20);
    const b = new PoseBuffer(0);
    b.push(st(0, 0, 350), 0);
    b.push(st(0, 100, 10), 100);
    expect(b.sample(50)?.yawDeg).toBeCloseTo(0, 0);
    const j = new PoseBuffer(0);
    j.push(st(0, 0), 0);
    j.push(st(SNAP_M + 5, 100), 100);
    expect(j.sample(50)?.position[0]).toBe(0);
    expect(j.sample(100)?.position[0]).toBe(SNAP_M + 5);
  });
});

/** A transport that records what is sent. */
class LoopTransport implements CopresenceTransport {
  readonly kind = 'loop';
  sent: PresenceMessage[] = [];
  readonly msg = new Listeners<[string, PresenceMessage]>();
  readonly joinL = new Listeners<[string]>();
  readonly leaveL = new Listeners<[string]>();
  connect(): Promise<string> {
    return Promise.resolve('selfpeer01');
  }
  send(m: PresenceMessage): void {
    this.sent.push(m);
  }
  onMessage(fn: (from: string, m: PresenceMessage) => void): void {
    this.msg.add(fn);
  }
  onPeerJoin(fn: (id: string) => void): void {
    this.joinL.add(fn);
  }
  onPeerLeave(fn: (id: string) => void): void {
    this.leaveL.add(fn);
  }
  onEnd(): void {}
  close(): void {}
}

describe('CopresenceSession', () => {
  it('sends state at most 10 times a second and only on change, with a keepalive', async () => {
    let now = 0;
    const t = new LoopTransport();
    const s = new CopresenceSession({ transport: t, name: 'Ada', body: 'mio-vrm', now: () => now });
    await s.join('room0001');
    expect(t.sent[0]).toEqual({ v: 1, t: 'hello', name: 'Ada', body: 'mio-vrm' });
    const pose = (x: number) => ({ position: [x, 0, 0] as [number, number, number], yawDeg: 0, motion: 'walk' as const });
    for (let i = 0; i < 60; i++) {
      now = i * 16.7; // a second of frames at 60 Hz, moving
      s.setPose(pose(i * 0.02));
    }
    const states = () => t.sent.filter((m) => m.t === 'state').length;
    expect(states()).toBeGreaterThanOrEqual(9);
    expect(states()).toBeLessThanOrEqual(11);
    const before = states();
    for (let i = 0; i < 60; i++) {
      now = 1000 + i * 16.7; // standing still: nothing more
      s.setPose(pose(5));
    }
    expect(states()).toBe(before + 1);
    now = 7000;
    s.setPose(pose(5));
    expect(states()).toBe(before + 2);
  });

  it('keeps peers by hello and state, introduces itself to newcomers, keeps chat', async () => {
    let now = 0;
    const t = new LoopTransport();
    const snaps: SessionSnapshot[] = [];
    const s = new CopresenceSession({ transport: t, name: 'Ada', body: 'kaho-vrm', now: () => now, onChange: (x) => snaps.push(x) });
    await s.join('room0001');
    t.joinL.emit('peerbbbb01');
    expect(t.sent.filter((m) => m.t === 'hello')).toHaveLength(2);
    t.msg.emit('peerbbbb01', { v: 1, t: 'hello', name: 'Bea', body: 'mio-vrm' });
    t.msg.emit('peerbbbb01', st(4, 10));
    t.msg.emit('peerbbbb01', { v: 1, t: 'chat', text: 'hi' });
    expect(s.say('  hello  ')).toBe(true);
    const last = snaps.at(-1) as SessionSnapshot;
    expect(last.count).toBe(2);
    // No tint in her hello: she is drawn in the hue her id gives.
    expect(last.peers).toEqual([{ id: 'peerbbbb01', name: 'Bea', body: 'mio-vrm', hue: peerHue('peerbbbb01') }]);
    expect(last.chat.map((c) => [c.name, c.text, c.self])).toEqual([
      ['Bea', 'hi', false],
      ['Ada', 'hello', true],
    ]);
    expect(s.remotes(now)[0]?.pose?.position[0]).toBe(4);
    // Silent too long: dropped.
    now = 60_000;
    expect(s.remotes(now)).toEqual([]);
  });
});

describe('outfit colour', () => {
  it('sends a picked hue in hello and none when automatic; a peer is drawn in its pick, else in its id\'s hue', async () => {
    const t = new LoopTransport();
    const snaps: SessionSnapshot[] = [];
    const s = new CopresenceSession({ transport: t, name: 'Ada', body: 'kaho-vrm', tint: 210, now: () => 0, onChange: (x) => snaps.push(x) });
    await s.join('room0001');
    expect(t.sent[0]).toEqual({ v: 1, t: 'hello', name: 'Ada', body: 'kaho-vrm', tint: 210 });
    s.setIdentity('Ada', 'kaho-vrm', null);
    expect(t.sent.at(-1)).toEqual({ v: 1, t: 'hello', name: 'Ada', body: 'kaho-vrm' });
    t.msg.emit('peerbbbb01', { v: 1, t: 'hello', name: 'Bea', body: 'kaho-vrm', tint: 140 });
    t.msg.emit('peercccc01', { v: 1, t: 'hello', name: 'Cy', body: 'kaho-vrm' });
    expect(snaps.at(-1)?.peers.map((p) => [p.id, p.hue])).toEqual([
      ['peerbbbb01', 140],
      ['peercccc01', peerHue('peercccc01')],
    ]);
    // She switches to automatic: her id's hue.
    t.msg.emit('peerbbbb01', { v: 1, t: 'hello', name: 'Bea', body: 'kaho-vrm' });
    expect(snaps.at(-1)?.peers[0]?.hue).toBe(peerHue('peerbbbb01'));
  });

  it('remembers a picked swatch and ignores a stored hue that is not one', () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    expect(loadIdentity(store).tint).toBeNull();
    mem.set('aether.player.copresence.v1', JSON.stringify({ name: 'Ada', body: 'mio-vrm', tint: 260 }));
    expect(loadIdentity(store)).toEqual({ name: 'Ada', body: 'mio-vrm', tint: 260 });
    mem.set('aether.player.copresence.v1', JSON.stringify({ name: 'Ada', body: 'mio-vrm', tint: 123 }));
    expect(loadIdentity(store).tint).toBeNull();
  });
});

describe('BroadcastChannel transport', () => {
  const open: CopresenceSession[] = [];
  afterEach(() => {
    for (const s of open.splice(0)) s.close();
  });

  it('two tabs meet, see each other move, chat and part', async () => {
    const snapsB: SessionSnapshot[] = [];
    const a = new CopresenceSession({ transport: new BroadcastTransport('himalayan-valley'), name: 'Ada', body: 'kaho-vrm' });
    const b = new CopresenceSession({ transport: new BroadcastTransport('himalayan-valley'), name: 'Bea', body: 'mio-vrm', onChange: (s) => snapsB.push(s) });
    const other = new CopresenceSession({ transport: new BroadcastTransport('himalayan-valley'), name: 'Cy', body: 'mio-vrm' });
    open.push(a, b, other);
    await a.join('room0001');
    await b.join('room0001');
    await other.join('room0002');
    const until = async (fn: () => boolean): Promise<void> => {
      for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 5));
      expect(fn()).toBe(true);
    };
    await until(() => a.snapshot().count === 2 && b.snapshot().count === 2);
    await until(() => b.snapshot().peers[0]?.name === 'Ada' && a.snapshot().peers[0]?.name === 'Bea');
    a.setPose({ position: [10, 2, -3], yawDeg: 45, motion: 'walk' });
    await until(() => b.remotes()[0]?.pose !== null && b.remotes()[0]?.pose !== undefined);
    expect(b.remotes()[0]?.pose?.position).toEqual([10, 2, -3]);
    a.say('namaste');
    await until(() => snapsB.at(-1)?.chat.at(-1)?.text === 'namaste');
    expect(other.snapshot().count).toBe(1);
    a.close();
    await until(() => b.snapshot().count === 1);
  });
});

describe('shared-visit links', () => {
  it('reads and writes room= in the fragment', () => {
    expect(roomFromHash('#t=himalayan-valley&room=abc123def')).toEqual({ room: 'abc123def', relay: 'server' });
    expect(roomFromHash('#t=himalayan-valley&room=BAD!&relay=tabs')).toEqual({ room: null, relay: 'tabs' });
    expect(withRoom('https://x.test/play#t=himalayan-valley', 'abc123def')).toBe('https://x.test/play#t=himalayan-valley&room=abc123def');
    expect(randomName(() => 0)).toBe('Amber Yak');
  });
});

describe('relay detection', () => {
  it('shows shared visits only when the page server answers /api/copresence', async () => {
    const { relayAvailable, relayUrl } = await import('../src/player/copresence/websocket');
    const answer = (status: number, body: string, type = 'application/json') => (async () => new Response(body, { status, headers: { 'content-type': type } })) as unknown as typeof fetch;
    expect(await relayAvailable(answer(200, '{"ok":true,"v":1,"maxPeers":16}'), 'https://x.test/play')).toBe(true);
    // A static host: 404, or its HTML fallback page.
    expect(await relayAvailable(answer(404, 'not found', 'text/plain'), 'https://x.test/play')).toBe(false);
    expect(await relayAvailable(answer(200, '<!doctype html>', 'text/html'), 'https://x.test/play')).toBe(false);
    expect(await relayAvailable((async () => Promise.reject(new Error('offline'))) as unknown as typeof fetch, 'https://x.test/play')).toBe(false);
    expect(relayUrl('himalayan-valley', 'abc123def', 'https://x.test/play#t=1')).toBe('wss://x.test/api/copresence/ws?world=himalayan-valley&room=abc123def');
    expect(relayUrl('himalayan-valley', 'abc123def', 'http://localhost:8787/play')).toBe('ws://localhost:8787/api/copresence/ws?world=himalayan-valley&room=abc123def');
  });
});
