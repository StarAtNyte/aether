/**
 * Spatial voice in shared visits (player copresence/voice.ts, session.ts): who is in voice, signalling addressed to one
 * peer, who offers, the 8-talker cap, failure when no route comes up, and the distance model. WebRTC and Web Audio are
 * fakes: the real thing runs in the browser probe.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VOICE_MAX_TALKERS, type PresenceMessage, type PresenceRtc } from '@aether/core/copresence';
import { CopresenceSession, type VoiceSink } from '../src/player/copresence/session';
import { Listeners, type CopresenceTransport } from '../src/player/copresence/transport';
import { CONNECT_TIMEOUT_MS, SpeakingGate, VoiceMesh, rms, shouldOffer, voiceFade, voiceFull, voiceGain, type VoiceDeps, type VoiceHost } from '../src/player/copresence/voice';

class LoopTransport implements CopresenceTransport {
  readonly kind = 'loop';
  readonly voice = true;
  sent: PresenceMessage[] = [];
  readonly msg = new Listeners<[string, PresenceMessage]>();
  readonly joinL = new Listeners<[string]>();
  readonly leaveL = new Listeners<[string]>();
  connect(): Promise<string> {
    return Promise.resolve('peermmmm01');
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

const SDP = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';

describe('session: voice and signalling', () => {
  it('tells the room and every newcomer it is in voice, tracks who else is, and reads only rtc addressed to it', async () => {
    const t = new LoopTransport();
    const s = new CopresenceSession({ transport: t, name: 'Me', body: 'kaho-vrm', now: () => 0 });
    const got: Array<[string, string]> = [];
    const sink: VoiceSink = { peerVoice: (id, on) => got.push([id, `voice ${on}`]), signal: (from, m) => got.push([from, `rtc ${m.k}`]), peerLeft: (id) => got.push([id, 'left']) };
    s.setVoiceSink(sink);
    await s.join('room123456');
    t.sent.length = 0;
    s.setVoice(true);
    expect(t.sent).toEqual([{ v: 1, t: 'voice', on: true }]);
    t.joinL.emit('peerbbbb01');
    expect(t.sent).toContainEqual({ v: 1, t: 'voice', on: true });
    t.msg.emit('peerbbbb01', { v: 1, t: 'voice', on: true });
    expect(s.snapshot().peers[0]?.voice).toBe(true);
    // Signalling for another visitor (a tab or Supabase transport reaches the whole room) is dropped.
    t.msg.emit('peerbbbb01', { v: 1, t: 'rtc', to: 'peercccc01', k: 'offer', sdp: SDP });
    t.msg.emit('peerbbbb01', { v: 1, t: 'rtc', to: 'peermmmm01', k: 'offer', sdp: SDP });
    // Sending wraps the body for one peer, and only to a peer that is here.
    s.sendRtc('peerbbbb01', { k: 'answer', sdp: SDP });
    s.sendRtc('peerzzzz01', { k: 'answer', sdp: SDP });
    expect(t.sent.filter((m) => m.t === 'rtc')).toEqual([{ v: 1, t: 'rtc', to: 'peerbbbb01', k: 'answer', sdp: SDP }]);
    t.msg.emit('peerbbbb01', { v: 1, t: 'bye' });
    expect(got).toEqual([
      ['peerbbbb01', 'voice true'],
      ['peerbbbb01', 'rtc offer'],
      ['peerbbbb01', 'left'],
    ]);
  });
});

/** A fake RTCPeerConnection: records descriptions and candidates, lets a test drive its state. */
class FakePC {
  static all: FakePC[] = [];
  localDescription: { type: string; sdp: string } | null = null;
  remoteDescription: { type: string; sdp: string } | null = null;
  signalingState = 'stable';
  connectionState = 'new';
  iceConnectionState = 'new';
  candidates: unknown[] = [];
  transceivers: Array<{ direction: string; receiver: { track: { kind: string } }; sender: { replaceTrack: (t: unknown) => Promise<void>; setStreams: () => void; track: unknown } }> = [];
  closed = false;
  onicecandidate: ((e: { candidate: unknown }) => void) | null = null;
  ontrack: ((e: unknown) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  constructor() {
    FakePC.all.push(this);
  }
  addTransceiver(track: unknown): void {
    this.transceivers.push(this.tr(track));
  }
  private tr(track: unknown) {
    const sender = { track, replaceTrack: async (t: unknown) => void (sender.track = t), setStreams: () => undefined };
    return { direction: 'sendrecv', receiver: { track: { kind: 'audio' } }, sender };
  }
  getTransceivers() {
    return this.transceivers;
  }
  async createOffer() {
    return { type: 'offer', sdp: SDP };
  }
  async createAnswer() {
    return { type: 'answer', sdp: SDP };
  }
  async setLocalDescription(d: { type: string; sdp: string }) {
    this.localDescription = d;
    this.signalingState = d.type === 'offer' ? 'have-local-offer' : 'stable';
  }
  async setRemoteDescription(d: { type: string; sdp: string }) {
    this.remoteDescription = d;
    if (d.type === 'offer' && this.transceivers.length === 0) this.transceivers.push(this.tr(null));
    this.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable';
  }
  async addIceCandidate(c: unknown) {
    this.candidates.push(c);
  }
  set(state: string): void {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
  close(): void {
    this.closed = true;
  }
}

function fakeDeps(): VoiceDeps & { mic: number; track: { enabled: boolean } } {
  const track = { kind: 'audio', enabled: true, stop: () => undefined, addEventListener: () => undefined };
  const node = () => ({ connect: (n: unknown) => n, disconnect: () => undefined, gain: { value: 1 }, fftSize: 1024, getFloatTimeDomainData: (a: Float32Array) => a.fill(0.2) });
  const deps = {
    mic: 0,
    track,
    getUserMedia: async () => {
      deps.mic++;
      return { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
    },
    createPeerConnection: () => new FakePC() as unknown as RTCPeerConnection,
    createAudioContext: () =>
      ({
        resume: async () => undefined,
        close: async () => undefined,
        listener: { setPosition: () => undefined, setOrientation: () => undefined },
        destination: {},
        createMediaStreamSource: node,
        createAnalyser: node,
        createGain: node,
        createPanner: () => ({ ...node(), setPosition: () => undefined }),
      }) as unknown as AudioContext,
    createSink: () => null,
  };
  return deps;
}

function host(self: string, inVoice: string[]) {
  const sent: Array<[string, PresenceRtc['k']]> = [];
  const h: VoiceHost & { on: boolean } = { selfId: self, on: false, sendRtc: (to, b) => sent.push([to, b.k]), setVoice: (on) => void (h.on = on), voicePeers: () => inVoice };
  return { h, sent };
}

const rtc = (k: 'offer' | 'answer', to = 'peermmmm01'): PresenceRtc => ({ v: 1, t: 'rtc', to, k, sdp: SDP });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('VoiceMesh', () => {
  afterEach(() => {
    FakePC.all = [];
    vi.useRealTimers();
  });

  it('asks for the microphone only on start, then offers to larger ids and waits for smaller ones', async () => {
    const deps = fakeDeps();
    const { h, sent } = host('peermmmm01', ['peeraaaa01', 'peerzzzz01']);
    const mesh = new VoiceMesh(h, deps);
    expect(deps.mic).toBe(0);
    expect(await mesh.start()).toBe('on');
    expect(deps.mic).toBe(1);
    // Open mic: the track goes out.
    expect(deps.track.enabled).toBe(true);
    expect(h.on).toBe(true);
    await flush();
    expect(shouldOffer('peermmmm01', 'peerzzzz01')).toBe(true);
    expect(sent).toEqual([['peerzzzz01', 'offer']]);
    // The smaller id offers; this visitor answers with its mic on the transceiver; a candidate that arrives
    // while the offer is still being applied waits for it.
    mesh.signal('peeraaaa01', rtc('offer'));
    mesh.signal('peeraaaa01', { v: 1, t: 'rtc', to: 'peermmmm01', k: 'ice', c: 'candidate:1 1 udp 1 a.local 9 typ host', mid: '0', i: 0 });
    await flush();
    expect(sent).toContainEqual(['peeraaaa01', 'answer']);
    const answerer = FakePC.all[1]!;
    expect(answerer.candidates).toHaveLength(1);
    expect(answerer.transceivers[0]?.sender.track).not.toBeNull();
    answerer.set('connected');
    expect(mesh.snapshot().peers['peeraaaa01']?.state).toBe('live');
    // A peer leaving voice closes its connection; leaving voice tells the rest (`end`) and lets the mic go.
    mesh.peerVoice('peeraaaa01', false);
    expect(answerer.closed).toBe(true);
    mesh.stop();
    expect(sent.at(-1)).toEqual(['peerzzzz01', 'end']);
    expect(h.on).toBe(false);
  });

  it(`is full with ${VOICE_MAX_TALKERS} in voice: a ninth does not join, and an offer past the cap is answered busy`, async () => {
    expect(voiceFull(VOICE_MAX_TALKERS - 2)).toBe(false);
    expect(voiceFull(VOICE_MAX_TALKERS - 1)).toBe(true);
    const others = Array.from({ length: VOICE_MAX_TALKERS - 1 }, (_, i) => `peerz${i}00000`);
    const ninth = host('peermmmm01', others);
    const deps = fakeDeps();
    expect(await new VoiceMesh(ninth.h, deps).start()).toBe('full');
    // No permission prompt and no announcement for a full voice.
    expect(deps.mic).toBe(0);
    expect(ninth.h.on).toBe(false);

    // A visitor already connected to seven answers the eighth offer with busy.
    const inVoice: string[] = [];
    const full = host('peermmmm01', inVoice);
    const mesh = new VoiceMesh(full.h, fakeDeps());
    await mesh.start();
    for (let i = 0; i < VOICE_MAX_TALKERS - 1; i++) mesh.signal(`peera${i}00000`, rtc('offer'));
    await flush();
    mesh.signal('peerb9000000', rtc('offer'));
    await flush();
    expect(full.sent.filter(([, k]) => k === 'answer')).toHaveLength(VOICE_MAX_TALKERS - 1);
    expect(full.sent.at(-1)).toEqual(['peerb9000000', 'busy']);

    // And the newcomer told busy leaves voice as full.
    const late = host('peeraaaa01', ['peermmmm01']);
    const lateMesh = new VoiceMesh(late.h, fakeDeps());
    await lateMesh.start();
    await flush();
    lateMesh.signal('peermmmm01', { v: 1, t: 'rtc', to: 'peeraaaa01', k: 'busy' });
    await flush();
    expect(lateMesh.snapshot().status).toBe('full');
    expect(late.h.on).toBe(false);
  });

  it('answers an offer with end when not in voice, and marks a connection that never comes up as failed', async () => {
    const idle = host('peermmmm01', []);
    const off = new VoiceMesh(idle.h, fakeDeps());
    off.signal('peeraaaa01', rtc('offer'));
    await flush();
    expect(idle.sent).toEqual([['peeraaaa01', 'end']]);

    vi.useFakeTimers();
    const failed: string[] = [];
    const { h } = host('peeraaaa01', ['peerzzzz01']);
    const mesh = new VoiceMesh(h, fakeDeps(), undefined, (p) => failed.push(p));
    await mesh.start();
    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS + 10);
    expect(failed).toEqual(['peerzzzz01']);
    expect(mesh.snapshot().peers['peerzzzz01']?.state).toBe('failed');
    expect(FakePC.all[0]?.closed).toBe(true);
  });

  it('keeps a mute and a volume per person and gates push-to-talk on the held key', async () => {
    const { h } = host('peermmmm01', []);
    const deps = fakeDeps();
    const mesh = new VoiceMesh(h, deps);
    await mesh.start();
    expect(mesh.snapshot().transmitting).toBe(true);
    mesh.setMode('ptt');
    expect(mesh.snapshot().transmitting).toBe(false);
    expect(deps.track.enabled).toBe(false);
    mesh.setHolding(true);
    expect(mesh.snapshot().transmitting).toBe(true);
    mesh.setMode('open');
    mesh.setSelfMuted(true);
    expect(mesh.snapshot().transmitting).toBe(false);
    mesh.signal('peeraaaa01', rtc('offer'));
    await flush();
    mesh.setPeerVolume('peeraaaa01', 0.4);
    mesh.setPeerMuted('peeraaaa01', true);
    expect(mesh.snapshot().peers['peeraaaa01']).toMatchObject({ muted: true, volume: 0.4 });
    mesh.setPeerVolume('peeraaaa01', 7);
    expect(mesh.snapshot().peers['peeraaaa01']?.volume).toBe(1);
  });
});

describe('voice distance and speaking light', () => {
  it('is full up to 2 m, halves at 4 m (inverse distance) and is silent from 40 m', () => {
    expect(voiceGain(1)).toBe(1);
    expect(voiceGain(2)).toBe(1);
    expect(voiceGain(4)).toBeCloseTo(0.5, 6);
    expect(voiceGain(20)).toBeCloseTo(0.1, 6);
    expect(voiceFade(30)).toBe(1);
    expect(voiceFade(35)).toBeCloseTo(0.5, 6);
    expect(voiceGain(40)).toBe(0);
    expect(voiceGain(500)).toBe(0);
  });

  it('lights at once on a loud sample and goes out after a short quiet', () => {
    expect(rms(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5, 6);
    const g = new SpeakingGate();
    expect(g.push(0.001, 0)).toBe(false);
    expect(g.push(0.1, 10)).toBe(true);
    expect(g.push(0.02, 20)).toBe(true);
    expect(g.push(0.001, 30)).toBe(true);
    expect(g.push(0.001, 400)).toBe(false);
  });
});
