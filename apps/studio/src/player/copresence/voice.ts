/**
 * Spatial voice in a shared visit: peer-to-peer WebRTC audio in a full mesh of at most {@link VOICE_MAX_TALKERS}
 * visitors, signalled over the visit's own transport (`rtc` messages addressed to one peer, `session.ts`), each voice
 * played from its speaker's avatar through the Web Audio API.
 *
 * - Loaded only when the mic button is first clicked (`CopresenceUI.tsx`); the microphone is asked for then, never
 *   before. Joining voice is joining the mesh: this visitor hears the others in voice and they hear it.
 * - Pairs: the visitor with the smaller peer id offers, the other answers ({@link shouldOffer}), so two visitors never
 *   offer to each other at once. Each connection carries one audio transceiver both ways; push-to-talk and mute only
 *   enable or disable the local track (silence is sent), so nothing is renegotiated.
 * - Public STUN only ({@link STUN_SERVERS}), no TURN: two visitors behind strict NATs or firewalls that block UDP cannot
 *   connect. A connection that has not come up within {@link CONNECT_TIMEOUT_MS}, or that fails, is marked `failed` and
 *   the UI says "Voice couldn't connect to <name>".
 * - The cap: a visitor who finds {@link VOICE_MAX_TALKERS} - 1 others in voice does not join (`full`); a visitor
 *   already holding that many connections answers a further offer with `busy`, and the newcomer leaves voice as full.
 * - Spatial: each remote stream → (an `AnalyserNode` for the speaking light) → volume / mute gain → distance fade →
 *   `PannerNode` (HRTF, inverse distance, reference {@link VOICE_REF_M} m, clamped at {@link VOICE_FADE_END_M} m) →
 *   speakers. The panner sits at the avatar's head and the listener at this visitor's camera (or its player's head
 *   while playing), both moved every frame ({@link VoiceMesh.update}). The fade gain takes the voice from full to
 *   silent between {@link VOICE_FADE_START_M} and {@link VOICE_FADE_END_M} m (the inverse model alone never reaches 0).
 * - Chrome only feeds a remote WebRTC stream to Web Audio while the stream also plays in a media element, so each
 *   stream is attached to a muted `<audio>` (kept here, never in the page).
 * Known limit: Chrome's echo cancellation does not cover audio played through Web Audio, so open mic on speakers can
 * echo; headphones, or push-to-talk, avoid it.
 */
import { VOICE_CANDIDATE_MAX, VOICE_MAX_TALKERS, VOICE_SDP_MAX, type PresenceRtc } from '@aether/core/copresence';
import type { RtcBody, VoiceSink } from './session';

/** Public STUN servers (no TURN: no relay of media through anyone's server). */
export const STUN_SERVERS: readonly RTCIceServer[] = Object.freeze([{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }]);
/** Distance (m) at which a voice is at full level; it halves at twice that (inverse distance). */
export const VOICE_REF_M = 2;
/** The fade to silence starts and ends here (m). */
export const VOICE_FADE_START_M = 30;
export const VOICE_FADE_END_M = 40;
/** Height of a speaker's mouth above its feet (m), where its voice comes from. */
export const VOICE_HEAD_M = 1.6;
/** A connection not up by then has failed (no TURN: it never will). */
export const CONNECT_TIMEOUT_MS = 20_000;
/** ICE candidates kept for a connection whose description has not arrived yet. */
const MAX_PENDING_ICE = 64;
/** Speaking light: on above this level (RMS of the samples, 0..1), off below the lower one after {@link SPEAK_HOLD_MS}. */
const SPEAK_ON = 0.02;
const SPEAK_OFF = 0.01;
const SPEAK_HOLD_MS = 300;

/** Whether this visitor makes the offer to `peer` (the smaller id offers). */
export const shouldOffer = (self: string, peer: string): boolean => self < peer;

/** Whether voice is full for a visitor who finds `othersInVoice` others in it. */
export const voiceFull = (othersInVoice: number): boolean => othersInVoice >= VOICE_MAX_TALKERS - 1;

/** The distance fade: 1 up to {@link VOICE_FADE_START_M}, 0 from {@link VOICE_FADE_END_M}, linear between. */
export function voiceFade(distanceM: number): number {
  if (!(distanceM > VOICE_FADE_START_M)) return 1;
  return Math.max(0, (VOICE_FADE_END_M - distanceM) / (VOICE_FADE_END_M - VOICE_FADE_START_M));
}

/** The level a voice is heard at from `distanceM` (the panner's inverse model times the fade), for tests and docs. */
export function voiceGain(distanceM: number): number {
  const d = Math.min(Math.max(distanceM, VOICE_REF_M), VOICE_FADE_END_M);
  return (VOICE_REF_M / (VOICE_REF_M + (d - VOICE_REF_M))) * voiceFade(distanceM);
}

/** Root mean square of samples (the level the speaking light reads). */
export function rms(samples: Float32Array): number {
  let s = 0;
  for (let i = 0; i < samples.length; i++) s += (samples[i] as number) * (samples[i] as number);
  return samples.length ? Math.sqrt(s / samples.length) : 0;
}

/** Speaking or not from a stream of levels: on at once above {@link SPEAK_ON}, off after a short quiet. */
export class SpeakingGate {
  speaking = false;
  private quietSince = 0;
  push(level: number, nowMs: number): boolean {
    if (level >= SPEAK_ON) {
      this.speaking = true;
      this.quietSince = 0;
    } else if (this.speaking && level < SPEAK_OFF) {
      if (this.quietSince === 0) this.quietSince = nowMs;
      else if (nowMs - this.quietSince >= SPEAK_HOLD_MS) this.speaking = false;
    } else this.quietSince = 0;
    return this.speaking;
  }
}

/** Where this visitor is in voice. */
export type VoiceStatus = 'off' | 'starting' | 'on' | 'denied' | 'full' | 'unsupported' | 'error';
/** A connection to one peer: coming up, carrying audio, failed (no route without TURN), or refused (`busy`). */
export type LinkState = 'connecting' | 'live' | 'failed' | 'busy';
export type VoiceMode = 'open' | 'ptt';

export interface VoiceSnapshot {
  status: VoiceStatus;
  mode: VoiceMode;
  /** Open mic muted by this visitor. */
  selfMuted: boolean;
  /** This visitor's voice goes out now (open and not muted, or push-to-talk held). */
  transmitting: boolean;
  selfSpeaking: boolean;
  peers: Record<string, { state: LinkState; muted: boolean; volume: number; speaking: boolean }>;
}

/** What the mesh needs of the session. */
export interface VoiceHost {
  readonly selfId: string | null;
  sendRtc(to: string, body: RtcBody): void;
  setVoice(on: boolean): void;
  /** Peers in voice now (their `voice` messages). */
  voicePeers(): string[];
}

/** Browser pieces, injectable for tests. */
export interface VoiceDeps {
  getUserMedia(c: MediaStreamConstraints): Promise<MediaStream>;
  createPeerConnection(cfg: RTCConfiguration): RTCPeerConnection;
  createAudioContext(): AudioContext;
  /** A muted media element for a remote stream (Chrome feeds Web Audio only then); null where not needed. */
  createSink(stream: MediaStream): { stop(): void } | null;
}

export function browserVoiceDeps(): VoiceDeps | null {
  if (typeof RTCPeerConnection !== 'function' || typeof AudioContext !== 'function' || !navigator.mediaDevices?.getUserMedia) return null;
  return {
    getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
    createPeerConnection: (cfg) => new RTCPeerConnection(cfg),
    createAudioContext: () => new AudioContext({ latencyHint: 'interactive' }),
    createSink: (stream) => {
      const el = new Audio();
      el.muted = true;
      el.srcObject = stream;
      void el.play().catch(() => undefined);
      return {
        stop: () => {
          el.pause();
          el.srcObject = null;
        },
      };
    },
  };
}

interface Graph {
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  gain: GainNode;
  fade: GainNode;
  panner: PannerNode;
  samples: Float32Array<ArrayBuffer>;
  sink: { stop(): void } | null;
}

interface Link {
  id: string;
  offerer: boolean;
  pc: RTCPeerConnection | null;
  state: LinkState;
  pendingIce: RTCIceCandidateInit[];
  timer: ReturnType<typeof setTimeout> | null;
  graph: Graph | null;
  gate: SpeakingGate;
  /** The gate's state last frame (a change re-renders the people list). */
  gateWas: boolean;
  level: number;
  /** Panner position now (debug / probes). */
  at: [number, number, number] | null;
  hasTrack: boolean;
}

type Vec3 = readonly [number, number, number];

export class VoiceMesh implements VoiceSink {
  private status: VoiceStatus = 'off';
  private mode: VoiceMode = 'open';
  private selfMuted = false;
  private holding = false;
  private stream: MediaStream | null = null;
  private track: MediaStreamTrack | null = null;
  private ctx: AudioContext | null = null;
  private selfAnalyser: AnalyserNode | null = null;
  private selfSamples: Float32Array<ArrayBuffer> = new Float32Array(1024);
  private readonly selfGate = new SpeakingGate();
  private selfLevel = 0;
  private readonly links = new Map<string, Link>();
  /** Per-person mute and volume (0..1), kept for the visit. */
  private readonly prefs = new Map<string, { muted: boolean; volume: number }>();
  private listenerAt: Vec3 | null = null;

  constructor(
    private readonly host: VoiceHost,
    private readonly deps: VoiceDeps | null = browserVoiceDeps(),
    private readonly onChange: (s: VoiceSnapshot) => void = () => undefined,
    /** A connection to `peer` failed (no route: "Voice couldn't connect to …"). */
    private readonly onFailed: (peer: string) => void = () => undefined,
  ) {}

  get active(): boolean {
    return this.status === 'on';
  }

  /** Join voice: asks for the microphone (only now), then connects to everyone in voice. */
  async start(): Promise<VoiceStatus> {
    if (this.status === 'on' || this.status === 'starting') return this.status;
    const deps = this.deps;
    if (!deps) return this.set('unsupported');
    if (voiceFull(this.host.voicePeers().length)) return this.set('full');
    this.set('starting');
    // Made while the click still counts as a gesture, so it may play.
    let ctx: AudioContext;
    try {
      ctx = deps.createAudioContext();
    } catch {
      return this.set('unsupported');
    }
    this.ctx = ctx;
    void ctx.resume?.().catch(() => undefined);
    let stream: MediaStream;
    try {
      stream = await deps.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    } catch (err) {
      this.releaseAudio();
      const name = (err as { name?: string }).name;
      return this.set(name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError' ? 'denied' : 'error');
    }
    const track = stream.getAudioTracks()[0];
    // Left voice while the prompt was open (stop() ran meanwhile), or the room filled meanwhile.
    const now = this.status as VoiceStatus;
    if (now !== 'starting' || !track || voiceFull(this.host.voicePeers().length)) {
      for (const t of stream.getTracks()) t.stop();
      if (now !== 'starting') return now;
      this.releaseAudio();
      return this.set(track ? 'full' : 'error');
    }
    this.stream = stream;
    this.track = track;
    track.addEventListener('ended', () => this.active && this.stop('error'));
    try {
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      src.connect(an);
      this.selfAnalyser = an;
      this.selfSamples = new Float32Array(an.fftSize);
    } catch {
      this.selfAnalyser = null;
    }
    this.status = 'on';
    // After the status: the track goes out only while in voice.
    this.applyTrack();
    this.host.setVoice(true);
    for (const id of this.host.voicePeers()) this.peerVoice(id, true);
    this.changed();
    return this.status;
  }

  /** Leave voice: every connection closed (the others are told), the microphone released. */
  stop(why: VoiceStatus = 'off'): void {
    const was = this.status;
    for (const id of [...this.links.keys()]) this.close(id, was === 'on');
    this.links.clear();
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.stream = null;
    this.track = null;
    this.holding = false;
    this.releaseAudio();
    if (was === 'on') this.host.setVoice(false);
    this.set(why);
  }

  setMode(mode: VoiceMode): void {
    this.mode = mode;
    this.holding = false;
    this.applyTrack();
    this.changed();
  }

  /** Mute this visitor's open mic (push-to-talk ignores it). */
  setSelfMuted(muted: boolean): void {
    this.selfMuted = muted;
    this.applyTrack();
    this.changed();
  }

  /** Push-to-talk held (V, or the mic button held). */
  setHolding(holding: boolean): void {
    if (this.holding === holding) return;
    this.holding = holding;
    this.applyTrack();
    this.changed();
  }

  setPeerMuted(id: string, muted: boolean): void {
    this.prefs.set(id, { ...this.pref(id), muted });
    this.applyPref(id);
    this.changed();
  }

  /** Volume of one person, 0..1. */
  setPeerVolume(id: string, volume: number): void {
    this.prefs.set(id, { ...this.pref(id), volume: Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 1)) });
    this.applyPref(id);
    this.changed();
  }

  snapshot(): VoiceSnapshot {
    const peers: VoiceSnapshot['peers'] = {};
    for (const [id, l] of this.links) peers[id] = { state: l.state, ...this.pref(id), speaking: l.gate.speaking && l.state === 'live' };
    return { status: this.status, mode: this.mode, selfMuted: this.selfMuted, transmitting: this.transmitting(), selfSpeaking: this.selfGate.speaking && this.transmitting(), peers };
  }

  /** Probe view: per peer its state, level now, whether its track arrived, and where its panner and the listener are. */
  debug(): { status: VoiceStatus; audio: string | null; mode: VoiceMode; transmitting: boolean; selfLevel: number; listener: Vec3 | null; peers: Array<{ id: string; state: LinkState; offerer: boolean; hasTrack: boolean; level: number; speaking: boolean; panner: [number, number, number] | null; fade: number | null; ice: string | null }> } {
    return {
      status: this.status,
      audio: this.ctx?.state ?? null,
      mode: this.mode,
      transmitting: this.transmitting(),
      selfLevel: this.selfLevel,
      listener: this.listenerAt,
      peers: [...this.links.values()].map((l) => ({
        id: l.id,
        state: l.state,
        offerer: l.offerer,
        hasTrack: l.hasTrack,
        level: l.level,
        speaking: l.gate.speaking,
        panner: l.at,
        fade: l.graph ? l.graph.fade.gain.value : null,
        ice: l.pc?.iceConnectionState ?? null,
      })),
    };
  }

  /** Probe view of the network side: per peer, the audio level and energy WebRTC itself reports for what arrives. */
  async stats(): Promise<Array<{ id: string; audioLevel: number | null; totalAudioEnergy: number | null; bytesReceived: number | null; candidatePair: string | null }>> {
    const out = [];
    for (const l of this.links.values()) {
      let audioLevel: number | null = null;
      let totalAudioEnergy: number | null = null;
      let bytesReceived: number | null = null;
      let candidatePair: string | null = null;
      const report = await l.pc?.getStats().catch(() => null);
      report?.forEach((r: { type: string; kind?: string; audioLevel?: number; totalAudioEnergy?: number; bytesReceived?: number; state?: string; nominated?: boolean; localCandidateId?: string; remoteCandidateId?: string }) => {
        if (r.type === 'inbound-rtp' && r.kind === 'audio') {
          audioLevel = r.audioLevel ?? null;
          totalAudioEnergy = r.totalAudioEnergy ?? null;
          bytesReceived = r.bytesReceived ?? null;
        }
        if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') {
          const kind = (id?: string): string => (id ? ((report.get(id) as { candidateType?: string } | undefined)?.candidateType ?? '?') : '?');
          candidatePair = `${kind(r.localCandidateId)}-${kind(r.remoteCandidateId)}`;
        }
      });
      out.push({ id: l.id, audioLevel, totalAudioEnergy, bytesReceived, candidatePair });
    }
    return out;
  }

  /**
   * Once a frame: the listener at `listener` facing `forward` (with `up`), each peer's panner at its head, the speaking
   * lights. Returns who is speaking now.
   */
  update(listener: { position: Vec3; forward: Vec3; up: Vec3 }, heads: ReadonlyMap<string, Vec3>, nowMs: number): Set<string> {
    const speaking = new Set<string>();
    const ctx = this.ctx;
    if (!ctx || this.status !== 'on') return speaking;
    setListener(ctx.listener, listener.position, listener.forward, listener.up);
    this.listenerAt = [listener.position[0], listener.position[1], listener.position[2]];
    for (const l of this.links.values()) {
      const g = l.graph;
      if (!g || l.state !== 'live') continue;
      const head = heads.get(l.id) ?? listener.position;
      setPos(g.panner, head);
      l.at = [head[0], head[1], head[2]];
      const d = Math.hypot(head[0] - listener.position[0], head[1] - listener.position[1], head[2] - listener.position[2]);
      g.fade.gain.value = voiceFade(d);
      g.analyser.getFloatTimeDomainData(g.samples);
      l.level = rms(g.samples);
      if (l.gate.push(l.level, nowMs) !== l.gateWas) {
        l.gateWas = l.gate.speaking;
        this.changed();
      }
      if (l.gate.speaking) speaking.add(l.id);
    }
    if (this.selfAnalyser) {
      this.selfAnalyser.getFloatTimeDomainData(this.selfSamples);
      this.selfLevel = rms(this.selfSamples);
      const was = this.selfGate.speaking;
      if (this.selfGate.push(this.transmitting() ? this.selfLevel : 0, nowMs) !== was) this.changed();
    }
    return speaking;
  }

  // ---- VoiceSink (from the session)

  peerVoice(id: string, on: boolean): void {
    if (this.status !== 'on') return;
    if (!on) return this.close(id, false);
    const self = this.host.selfId;
    if (!self || this.links.has(id) || !shouldOffer(self, id)) return;
    if (this.liveCount() >= VOICE_MAX_TALKERS - 1) return;
    void this.offer(id);
  }

  peerLeft(id: string): void {
    this.close(id, false);
    this.prefs.delete(id);
  }

  signal(from: string, m: PresenceRtc): void {
    void this.onSignal(from, m).catch((err) => {
      console.warn('[voice] signalling failed', err);
      const l = this.links.get(from);
      if (l && l.state === 'connecting') this.fail(l);
    });
  }

  // ---- internals

  private async onSignal(from: string, m: PresenceRtc): Promise<void> {
    if (this.status !== 'on') {
      // Not in voice: tell an offerer so it stops waiting.
      if (m.k === 'offer') this.host.sendRtc(from, { k: 'end' });
      return;
    }
    let l = this.links.get(from);
    switch (m.k) {
      case 'offer': {
        const self = this.host.selfId ?? '';
        if (l?.offerer) {
          // Both offered (a peer that learned of us late): the smaller id's offer stands.
          if (shouldOffer(self, from)) return;
          this.close(from, false);
          l = undefined;
        }
        if (l && l.state !== 'connecting') {
          this.close(from, false);
          l = undefined;
        }
        if (!l) {
          if (this.liveCount() >= VOICE_MAX_TALKERS - 1) return this.host.sendRtc(from, { k: 'busy' });
          l = this.link(from, false);
        }
        const pc = l.pc;
        if (!pc) return;
        await pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
        const tr = pc.getTransceivers().find((t) => t.receiver.track?.kind === 'audio');
        if (tr && this.track) {
          tr.direction = 'sendrecv';
          await tr.sender.replaceTrack(this.track);
          if (this.stream) tr.sender.setStreams?.(this.stream);
        }
        await this.flushIce(l);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.sendDescription(l, 'answer', pc.localDescription?.sdp ?? answer.sdp ?? '');
        return;
      }
      case 'answer': {
        const pc = l?.pc;
        if (!l || !l.offerer || !pc || pc.signalingState !== 'have-local-offer') return;
        await pc.setRemoteDescription({ type: 'answer', sdp: m.sdp });
        await this.flushIce(l);
        return;
      }
      case 'ice': {
        const pc = l?.pc;
        if (!l || !pc) return;
        const c: RTCIceCandidateInit = { candidate: m.c, sdpMid: m.mid, sdpMLineIndex: m.i };
        if (pc.remoteDescription) await pc.addIceCandidate(c).catch(() => undefined);
        else if (l.pendingIce.length < MAX_PENDING_ICE) l.pendingIce.push(c);
        return;
      }
      case 'busy': {
        if (!l) return;
        this.close(from, false);
        // Voice filled up while this visitor joined: it leaves rather than hear only some.
        this.stop('full');
        return;
      }
      case 'end':
        this.close(from, false);
        return;
    }
  }

  private async offer(id: string): Promise<void> {
    const l = this.link(id, true);
    const pc = l.pc;
    if (!pc || !this.track || !this.stream) return;
    try {
      pc.addTransceiver(this.track, { direction: 'sendrecv', streams: [this.stream] });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (this.links.get(id) !== l) return;
      this.sendDescription(l, 'offer', pc.localDescription?.sdp ?? offer.sdp ?? '');
    } catch (err) {
      console.warn('[voice] offer failed', err);
      this.fail(l);
    }
  }

  private sendDescription(l: Link, k: 'offer' | 'answer', sdp: string): void {
    if (sdp.length > VOICE_SDP_MAX || !/^v=0\r?\n/.test(sdp)) {
      console.warn('[voice] session description too large to send', sdp.length);
      return this.fail(l);
    }
    this.host.sendRtc(l.id, { k, sdp });
  }

  private async flushIce(l: Link): Promise<void> {
    const pc = l.pc;
    if (!pc) return;
    const queued = l.pendingIce.splice(0);
    for (const c of queued) await pc.addIceCandidate(c).catch(() => undefined);
  }

  private link(id: string, offerer: boolean): Link {
    const deps = this.deps as VoiceDeps;
    const pc = deps.createPeerConnection({ iceServers: [...STUN_SERVERS], bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' });
    const l: Link = { id, offerer, pc, state: 'connecting', pendingIce: [], timer: null, graph: null, gate: new SpeakingGate(), gateWas: false, level: 0, at: null, hasTrack: false };
    this.links.set(id, l);
    pc.onicecandidate = (e) => {
      const c = e.candidate;
      if (!c || !c.candidate || c.sdpMid == null || c.sdpMLineIndex == null || c.candidate.length > VOICE_CANDIDATE_MAX || !c.candidate.startsWith('candidate:')) return;
      if (!/^[A-Za-z0-9_-]{0,32}$/.test(c.sdpMid) || c.sdpMLineIndex > 63) return;
      this.host.sendRtc(id, { k: 'ice', c: c.candidate, mid: c.sdpMid, i: c.sdpMLineIndex });
    };
    pc.ontrack = (e) => {
      if (this.links.get(id) !== l || e.track.kind !== 'audio') return;
      this.attach(l, e.streams[0] ?? new MediaStream([e.track]));
    };
    const onState = (): void => {
      if (this.links.get(id) !== l) return;
      const s = pc.connectionState;
      const ice = pc.iceConnectionState;
      if ((s === 'connected' || (s === undefined && (ice === 'connected' || ice === 'completed'))) && l.state === 'connecting') {
        l.state = 'live';
        if (l.timer) clearTimeout(l.timer);
        l.timer = null;
        this.changed();
      } else if (s === 'failed' || ice === 'failed') this.fail(l);
    };
    pc.onconnectionstatechange = onState;
    pc.oniceconnectionstatechange = onState;
    l.timer = setTimeout(() => {
      if (this.links.get(id) === l && l.state === 'connecting') this.fail(l);
    }, CONNECT_TIMEOUT_MS);
    this.changed();
    return l;
  }

  private attach(l: Link, stream: MediaStream): void {
    const ctx = this.ctx;
    if (!ctx || l.graph) return;
    l.hasTrack = true;
    try {
      const sink = this.deps?.createSink(stream) ?? null;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      const gain = ctx.createGain();
      const fade = ctx.createGain();
      const panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = VOICE_REF_M;
      panner.maxDistance = VOICE_FADE_END_M;
      panner.rolloffFactor = 1;
      source.connect(analyser);
      source.connect(gain).connect(fade).connect(panner).connect(ctx.destination);
      if (this.listenerAt) setPos(panner, this.listenerAt);
      l.graph = { source, analyser, gain, fade, panner, samples: new Float32Array(analyser.fftSize), sink };
      this.applyPref(l.id);
    } catch (err) {
      console.warn('[voice] could not play a voice', err);
    }
    this.changed();
  }

  private fail(l: Link): void {
    if (this.links.get(l.id) !== l || l.state === 'failed') return;
    this.teardown(l);
    l.state = 'failed';
    this.changed();
    this.onFailed(l.id);
  }

  /** Close the connection to `id` (telling it, `end`, when `tell`); a failed record is dropped too. */
  private close(id: string, tell: boolean): void {
    const l = this.links.get(id);
    if (!l) return;
    if (tell && l.state !== 'failed' && l.state !== 'busy') this.host.sendRtc(id, { k: 'end' });
    this.teardown(l);
    this.links.delete(id);
    this.changed();
  }

  private teardown(l: Link): void {
    if (l.timer) clearTimeout(l.timer);
    l.timer = null;
    const g = l.graph;
    l.graph = null;
    if (g) {
      try {
        g.source.disconnect();
        g.gain.disconnect();
        g.fade.disconnect();
        g.panner.disconnect();
      } catch {
        // already gone
      }
      g.sink?.stop();
    }
    const pc = l.pc;
    l.pc = null;
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      try {
        pc.close();
      } catch {
        // closed
      }
    }
  }

  private liveCount(): number {
    let n = 0;
    for (const l of this.links.values()) if (l.state === 'connecting' || l.state === 'live') n++;
    return n;
  }

  private pref(id: string): { muted: boolean; volume: number } {
    return this.prefs.get(id) ?? { muted: false, volume: 1 };
  }

  private applyPref(id: string): void {
    const g = this.links.get(id)?.graph;
    if (!g) return;
    const p = this.pref(id);
    g.gain.gain.value = p.muted ? 0 : p.volume;
  }

  private transmitting(): boolean {
    return this.status === 'on' && (this.mode === 'ptt' ? this.holding : !this.selfMuted);
  }

  private applyTrack(): void {
    if (this.track) this.track.enabled = this.transmitting();
    // Push-to-talk holds V: the walkthrough's own V (camera view) steps aside meanwhile.
    if (typeof document !== 'undefined') document.documentElement.toggleAttribute('data-aether-ptt', this.status === 'on' && this.mode === 'ptt');
  }

  private releaseAudio(): void {
    this.selfAnalyser = null;
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx) void ctx.close?.().catch(() => undefined);
    if (typeof document !== 'undefined') document.documentElement.removeAttribute('data-aether-ptt');
  }

  private set(s: VoiceStatus): VoiceStatus {
    this.status = s;
    this.changed();
    return s;
  }

  private changed(): void {
    this.onChange(this.snapshot());
  }
}

function setPos(p: PannerNode, v: Vec3): void {
  if (p.positionX) {
    p.positionX.value = v[0];
    p.positionY.value = v[1];
    p.positionZ.value = v[2];
  } else (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(v[0], v[1], v[2]);
}

function setListener(l: AudioListener, pos: Vec3, fwd: Vec3, up: Vec3): void {
  if (l.positionX) {
    l.positionX.value = pos[0];
    l.positionY.value = pos[1];
    l.positionZ.value = pos[2];
    l.forwardX.value = fwd[0];
    l.forwardY.value = fwd[1];
    l.forwardZ.value = fwd[2];
    l.upX.value = up[0];
    l.upY.value = up[1];
    l.upZ.value = up[2];
  } else {
    // Firefox: the older methods.
    const old = l as unknown as { setPosition(x: number, y: number, z: number): void; setOrientation(a: number, b: number, c: number, d: number, e: number, f: number): void };
    old.setPosition(pos[0], pos[1], pos[2]);
    old.setOrientation(fwd[0], fwd[1], fwd[2], up[0], up[1], up[2]);
  }
}
