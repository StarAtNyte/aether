/**
 * The guide's lips: how far her mouth opens while she speaks, once a frame (0..1; the rig shows it on the body's
 * `mouth_open` morph within its face cap, `CharacterRig.mouth`).
 *
 * A recorded line drives it by its loudness, measured ahead of time: when a clip is loaded (ahead of its turn, or as it
 * starts) the same MP3 is fetched again (from the HTTP cache) and decoded on an `OfflineAudioContext` (decoding needs no
 * running context and never touches playback), and its mouth envelope is computed once: per ~16 ms frame the RMS, gated
 * against the clip's loud level, shaped a little by the zero-crossing rate (hissy or bright sounds open less than round
 * vowels) so it does not flap like a hinge. A few envelopes are kept (a small `Float32Array` each). Each frame the mouth
 * looks up the playing element's `currentTime` in it and eases there (fast open, slower close). The voice itself stays a
 * plain `<audio>` element, never routed through Web Audio.
 *
 * Without an envelope (no recording, a decode that failed or has not finished, a recording the browser refused to play)
 * the mouth moves at a syllable pace (about 4.5 Hz, varied) for the line's reading time. Voice muted: the mouth rests.
 * Reduced motion: it moves, but less.
 */
import { pb, pe, pj } from '@aether/core/perf-probe';

/** Envelope time constants (s): the mouth opens fast and closes a little slower. */
export const ATTACK_S = 0.04;
export const RELEASE_S = 0.09;
/** RMS below this is silence (breath, MP3 noise) whatever the clip's level. */
export const GATE_RMS = 0.008;
/** Length of an envelope frame (s). */
export const FRAME_S = 1 / 60;
/** Rate clips are decoded at (Hz): plenty for loudness, and quick. */
const DECODE_RATE = 22_050;
/** Envelopes kept (the line playing, the next, a few repeats). */
const KEEP = 6;
/** Fallback syllables per second (mean). */
export const SYLLABLE_HZ = 4.5;
/** With reduced motion the mouth opens at most this much. */
const REDUCED_CAP = 0.55;

/** Root mean square of `buf[from, to)` (samples in -1..1). No allocation. */
export function rms(buf: ArrayLike<number>, from = 0, to = buf.length): number {
  const n = to - from;
  if (n <= 0) return 0;
  let s = 0;
  for (let i = from; i < to; i++) {
    const v = buf[i]!;
    s += v * v;
  }
  return Math.sqrt(s / n);
}

/** Share of neighbouring samples of `buf[from, to)` that change sign (0..1). No allocation. */
export function zeroCrossRate(buf: ArrayLike<number>, from = 0, to = buf.length): number {
  if (to - from < 2) return 0;
  let c = 0;
  let prev = buf[from]!;
  for (let i = from + 1; i < to; i++) {
    const v = buf[i]!;
    if ((v >= 0) !== (prev >= 0)) c++;
    prev = v;
  }
  return c / (to - from - 1);
}

/** Loudness above the gate as 0..1 of the clip's loud level `peak` (a soft knee: quiet speech still shows). */
export function gateLevel(level: number, peak: number, gate = GATE_RMS): number {
  const g = Math.max(gate, peak * 0.08);
  const top = Math.max(peak, g * 2);
  const x = (level - g) / (top - g);
  if (x <= 0) return 0;
  return Math.min(1, Math.sqrt(x));
}

/** One step of the attack / release envelope toward `target` (frame-rate independent). */
export function envelope(cur: number, target: number, dt: number, attack = ATTACK_S, release = RELEASE_S): number {
  const tau = target > cur ? attack : release;
  const k = 1 - Math.exp(-Math.max(0, dt) / tau);
  return cur + (target - cur) * k;
}

/**
 * Openness for a loudness (0..1, gated) and the sign changes per second: a round vowel (voiced speech changes sign ~300-
 * 1500 times a second) opens fully, a bright or hissing sound (`ee`, `s`: several thousand) about two thirds.
 */
export function mouthFor(level: number, crossingsPerSecond: number): number {
  const bright = Math.max(0, Math.min(1, (crossingsPerSecond - 1500) / 7000));
  return Math.max(0, Math.min(1, level * (1 - 0.35 * bright)));
}

/** What {@link mouthEnvelope} reads of a decoded clip (an `AudioBuffer`, or a stand-in in the tests). */
export interface PcmLike {
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  readonly length: number;
  getChannelData(channel: number): Float32Array;
}

/**
 * The mouth target of a clip, one value (0..1) per {@link FRAME_S}: frame RMS gated against the clip's loud level (its
 * 95th percentile frame), shaped by the frame's zero-crossing rate. Runs once per clip (only the first channel is read).
 */
export function mouthEnvelope(pcm: PcmLike): Float32Array {
  const rate = pcm.sampleRate;
  const step = Math.max(1, Math.round(rate * FRAME_S));
  const n = Math.max(0, Math.ceil(pcm.length / step));
  const data = pcm.numberOfChannels > 0 ? pcm.getChannelData(0) : new Float32Array(0);
  const level = new Float32Array(n);
  const cps = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    const a = f * step;
    const b = Math.min(data.length, a + step);
    level[f] = rms(data, a, b);
    cps[f] = zeroCrossRate(data, a, b) * rate;
  }
  // The loud level: the 95th percentile frame of the sounding ones (a click does not set it).
  const sounding = Array.from(level).filter((v) => v > GATE_RMS).sort((x, y) => x - y);
  const peak = sounding.length ? sounding[Math.min(sounding.length - 1, Math.floor(sounding.length * 0.95))]! : 1;
  const out = new Float32Array(n);
  for (let f = 0; f < n; f++) out[f] = mouthFor(gateLevel(level[f]!, peak), cps[f]!);
  return out;
}

/** The envelope's target at `t` seconds into the clip (0 past its end). No allocation. */
export function envelopeAt(env: Float32Array, t: number): number {
  if (!(t >= 0)) return 0;
  const i = Math.floor(t / FRAME_S);
  return i < env.length ? env[i]! : 0;
}

/** A hash of an integer to 0..1 (syllable variation). */
function hash01(i: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * The fallback mouth `t` seconds into a line that lasts `length` seconds (0 outside it): a syllable every ~0.22 s with
 * varied height and a short pause now and then, eased in and out at the ends. `seed` varies it per line. Pure.
 */
export function syllableMouth(t: number, length: number, seed = 0): number {
  if (!(t > 0) || !(t < length)) return 0;
  // The pace drifts a little (4-5 Hz) so the syllables are not metronomic.
  const phase = t * SYLLABLE_HZ + 0.35 * Math.sin(t * 1.7 + seed);
  const i = Math.floor(phase);
  const u = phase - i;
  const r = hash01(i * 31 + seed);
  // About one syllable in seven is a pause between words.
  const amp = r < 0.14 ? 0.08 : 0.45 + 0.55 * hash01(i * 17 + seed + 7);
  const shape = Math.pow(Math.sin(Math.PI * u), 1.5);
  const edge = Math.min(1, t / 0.12, (length - t) / 0.15);
  return amp * shape * edge;
}

/** Seed of a line (its text). */
function seedOf(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return h & 0xffff;
}

export class GuideLipSync {
  /** Envelopes by clip URL, oldest first. */
  private readonly envelopes = new Map<string, Float32Array>();
  private readonly pending = new Set<string>();
  private decoder: OfflineAudioContext | null = null;
  private noDecoder = false;
  private disposed = false;
  private audio: HTMLAudioElement | null = null;
  private url = '';
  /** The line's start (ms) and its reading time (s), for the fallback. */
  private t0 = 0;
  private length = 0;
  private seed = 0;
  private cur = 0;
  private readonly reduced: boolean;

  constructor() {
    let r = false;
    try {
      r = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      r = false;
    }
    this.reduced = r;
  }

  /** The mouth now (0..1). */
  get value(): number {
    return this.cur;
  }

  /** The clip at `url` has its envelope. */
  ready(url: string): boolean {
    return this.envelopes.has(url);
  }

  /** Keep the envelope of `url` (the newest; the oldest beyond a few is dropped). */
  store(url: string, env: Float32Array): void {
    this.envelopes.delete(url);
    this.envelopes.set(url, env);
    while (this.envelopes.size > KEEP) this.envelopes.delete(this.envelopes.keys().next().value!);
  }

  /** Measure the clip at `url` ahead of its turn (a same-origin path; once per clip; failures leave the fallback). */
  prepare(url: string): void {
    if (this.disposed || this.noDecoder || !url || this.envelopes.has(url) || this.pending.has(url)) return;
    const C = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
    if (!C || typeof fetch !== 'function') {
      this.noDecoder = true;
      return;
    }
    this.pending.add(url);
    const endJob = pj('lipsync');
    void fetch(url, { credentials: 'same-origin', cache: 'force-cache' })
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((bytes) => {
        if (this.disposed) return null;
        this.decoder ??= new C(1, 1, DECODE_RATE);
        return this.decoder.decodeAudioData(bytes);
      })
      .then((buf) => {
        if (buf && !this.disposed) {
          const t0 = pb();
          this.store(url, mouthEnvelope(buf));
          pe('lipsync', t0);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        this.pending.delete(url);
        endJob();
      });
  }

  /**
   * A line starts: `audio` its recording playing (null: none, the mouth follows its reading time `seconds`). The
   * element is only read (its `currentTime`), never routed.
   */
  line(text: string, audio: HTMLAudioElement | null, seconds: number, nowMs: number): void {
    this.audio = audio;
    this.url = audio?.src ?? '';
    this.t0 = nowMs;
    this.length = seconds;
    this.seed = seedOf(text);
    if (this.url) this.prepare(this.url);
  }

  /** Silence now (muted, disposed): the mouth closes. */
  stop(): void {
    this.audio = null;
    this.url = '';
    this.length = 0;
  }

  /** The mouth this frame (smoothed); `dt` in s. No allocation. */
  update(dt: number, nowMs: number): number {
    let target = 0;
    const a = this.audio;
    const t = (nowMs - this.t0) / 1000;
    if (a && !a.paused && !a.ended) {
      const env = this.url ? this.envelopes.get(this.url) : undefined;
      if (env) target = envelopeAt(env, a.currentTime);
      else {
        // Plays, not measured yet: syllables while it plays.
        const len = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : this.length;
        target = syllableMouth(t, Math.max(len, t + 0.2), this.seed);
      }
    } else if (!a || !a.ended) {
      // No recording, or the browser refused it: the reading time (its recording's length when known).
      const len = a && Number.isFinite(a.duration) && a.duration > 0 ? a.duration : this.length;
      target = syllableMouth(t, len, this.seed);
    }
    if (this.reduced) target *= REDUCED_CAP;
    this.cur = envelope(this.cur, target, dt);
    if (this.cur < 0.01 && target === 0) this.cur = 0;
    return this.cur;
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.cur = 0;
    this.envelopes.clear();
    this.pending.clear();
    this.decoder = null;
  }
}
