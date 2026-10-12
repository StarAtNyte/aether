/**
 * Tiny procedural sound effects (WebAudio oscillators, no asset files —
 * nothing to license). Unknown names are ignored; playback is rate-limited
 * so a rule firing every tick cannot flood the audio graph.
 */

interface Tone {
  type: OscillatorType;
  from: number;
  to: number;
  duration: number;
  gain: number;
  /** Optional second tone started after `delay` seconds. */
  then?: { from: number; to: number; delay: number };
}

const TONES: Readonly<Record<string, Tone>> = Object.freeze({
  pickup: { type: 'triangle', from: 880, to: 1320, duration: 0.12, gain: 0.18, then: { from: 1320, to: 1760, delay: 0.08 } },
  hit: { type: 'square', from: 180, to: 60, duration: 0.12, gain: 0.12 },
  explosion: { type: 'sawtooth', from: 120, to: 30, duration: 0.6, gain: 0.25 },
  win: { type: 'triangle', from: 523, to: 784, duration: 0.35, gain: 0.2, then: { from: 784, to: 1046, delay: 0.25 } },
  lose: { type: 'sine', from: 330, to: 110, duration: 0.7, gain: 0.2 },
  click: { type: 'square', from: 1200, to: 900, duration: 0.04, gain: 0.08 },
  whoosh: { type: 'sawtooth', from: 300, to: 1200, duration: 0.3, gain: 0.08 },
  bell: { type: 'sine', from: 988, to: 980, duration: 1.2, gain: 0.18 },
});

/** Minimum seconds between two plays of the same sound. */
const MIN_INTERVAL = 0.06;
/** Most voices started per second overall. */
const MAX_VOICES_PER_SECOND = 24;

/** Lazily-created audio output for game sounds. */
export class SoundBoard {
  private ctx: AudioContext | null = null;
  private readonly lastPlayed = new Map<string, number>();
  private windowStart = 0;
  private voices = 0;
  muted = false;

  /** Play a named effect (ignored when unknown, muted or rate-limited). */
  play(name: string): void {
    if (this.muted || !Object.prototype.hasOwnProperty.call(TONES, name)) return;
    const tone = TONES[name] as Tone;
    const ctx = this.context();
    if (!ctx) return;
    const t = ctx.currentTime;
    if (t - (this.lastPlayed.get(name) ?? -1) < MIN_INTERVAL) return;
    if (t - this.windowStart >= 1) {
      this.windowStart = t;
      this.voices = 0;
    }
    if (++this.voices > MAX_VOICES_PER_SECOND) return;
    this.lastPlayed.set(name, t);
    this.voice(ctx, tone.type, tone.from, tone.to, t, tone.duration, tone.gain);
    if (tone.then) this.voice(ctx, tone.type, tone.then.from, tone.then.to, t + tone.then.delay, tone.duration, tone.gain);
  }

  /** Close the audio context. */
  dispose(): void {
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }

  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const Ctor = typeof AudioContext !== 'undefined' ? AudioContext : null;
      this.ctx = Ctor ? new Ctor() : null;
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  private voice(ctx: AudioContext, type: OscillatorType, from: number, to: number, start: number, duration: number, gain: number): void {
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), start + duration);
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(gain, start + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(amp).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
    osc.onended = () => {
      osc.disconnect();
      amp.disconnect();
    };
  }
}
