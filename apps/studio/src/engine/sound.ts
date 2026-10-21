/**
 * Tiny procedural sound effects (WebAudio oscillators, no asset files —
 * nothing to license). Unknown names are ignored; playback is rate-limited
 * so a rule firing every tick cannot flood the audio graph.
 */

interface Tone {
  /** Oscillator wave, or 'noise' (band-passed white noise at `from` Hz: digging, steps, splashes). */
  type: OscillatorType | 'noise';
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
  // Block worlds.
  dig: { type: 'noise', from: 900, to: 700, duration: 0.07, gain: 0.12 },
  break: { type: 'noise', from: 620, to: 380, duration: 0.16, gain: 0.2 },
  place: { type: 'noise', from: 1500, to: 900, duration: 0.07, gain: 0.14 },
  step: { type: 'noise', from: 420, to: 300, duration: 0.05, gain: 0.05 },
  // Footsteps by surface (people walking: the cast's feet land on the sound of what they stand on).
  'step-grass': { type: 'noise', from: 1700, to: 900, duration: 0.09, gain: 0.05 },
  'step-stone': { type: 'noise', from: 2300, to: 1100, duration: 0.045, gain: 0.07, then: { from: 520, to: 380, delay: 0.004 } },
  'step-wood': { type: 'noise', from: 700, to: 420, duration: 0.07, gain: 0.09, then: { from: 300, to: 220, delay: 0.006 } },
  'step-metal': { type: 'noise', from: 3600, to: 2200, duration: 0.07, gain: 0.07, then: { from: 1200, to: 900, delay: 0.005 } },
  'step-dirt': { type: 'noise', from: 900, to: 520, duration: 0.07, gain: 0.06 },
  'step-sand': { type: 'noise', from: 2600, to: 1500, duration: 0.11, gain: 0.04 },
  'step-snow': { type: 'noise', from: 1900, to: 800, duration: 0.12, gain: 0.04 },
  'step-water': { type: 'noise', from: 1300, to: 500, duration: 0.14, gain: 0.07 },
  'step-fabric': { type: 'noise', from: 500, to: 300, duration: 0.06, gain: 0.03 },
  hurt: { type: 'square', from: 260, to: 140, duration: 0.15, gain: 0.12 },
  eat: { type: 'noise', from: 2100, to: 1500, duration: 0.12, gain: 0.08, then: { from: 1900, to: 1400, delay: 0.14 } },
  craft: { type: 'triangle', from: 660, to: 990, duration: 0.1, gain: 0.12, then: { from: 990, to: 1320, delay: 0.07 } },
  splash: { type: 'noise', from: 1300, to: 500, duration: 0.35, gain: 0.14 },
  death: { type: 'sine', from: 300, to: 80, duration: 0.9, gain: 0.18 },
  poof: { type: 'noise', from: 800, to: 300, duration: 0.25, gain: 0.12 },
  baa: { type: 'sawtooth', from: 430, to: 380, duration: 0.35, gain: 0.05 },
  oink: { type: 'square', from: 190, to: 140, duration: 0.18, gain: 0.06, then: { from: 170, to: 130, delay: 0.16 } },
  cluck: { type: 'square', from: 950, to: 700, duration: 0.05, gain: 0.05, then: { from: 900, to: 650, delay: 0.09 } },
  groan: { type: 'sawtooth', from: 120, to: 78, duration: 0.7, gain: 0.07 },
  hiss: { type: 'noise', from: 4200, to: 3600, duration: 0.4, gain: 0.05 },
  // Interface (opt-in, Settings → Interface sounds): quiet, short, consonant.
  'ui-send': { type: 'sine', from: 520, to: 880, duration: 0.16, gain: 0.045 },
  'ui-proof': { type: 'sine', from: 784, to: 790, duration: 0.32, gain: 0.05, then: { from: 1175, to: 1180, delay: 0.11 } },
  'ui-play': { type: 'triangle', from: 330, to: 660, duration: 0.22, gain: 0.04 },
  'ui-tick': { type: 'sine', from: 1400, to: 1300, duration: 0.03, gain: 0.025 },
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
  /** Master volume 0–1 (player settings). */
  private volume = 1;
  private master: GainNode | null = null;
  /** Background bus (footsteps): ducked under big moments. */
  private bed: GainNode | null = null;
  /** Ducking listeners (music players outside the board). */
  private readonly duckListeners = new Set<(depth: number, seconds: number) => void>();

  /** Set the master volume (0 mutes). */
  setVolume(v: number): void {
    this.volume = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
    if (this.master) this.master.gain.value = this.volume;
  }

  /** Where voices connect: the master gain of the current context. */
  private output(ctx: AudioContext): AudioNode {
    if (!this.master || this.master.context !== ctx) {
      this.master = ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(ctx.destination);
    }
    return this.master;
  }

  /** The bus background sounds (footsteps, ambience) play through. */
  private bedOutput(ctx: AudioContext): AudioNode {
    const out = this.output(ctx);
    if (!this.bed || this.bed.context !== ctx) {
      this.bed = ctx.createGain();
      this.bed.gain.value = 1;
      this.bed.connect(out);
    }
    return this.bed;
  }

  /**
   * Duck the background (footsteps, and whoever listens: the music of a published game) by `depth` (0..1) for about
   * `seconds`, then let it swell back. The hook of the game-feel layer: a death or an explosion is heard over the bed.
   */
  duck(depth: number, seconds = 0.6): void {
    const d = Number.isFinite(depth) ? Math.max(0, Math.min(1, depth)) : 0;
    if (d <= 0) return;
    const hold = Number.isFinite(seconds) ? Math.max(0.05, Math.min(4, seconds)) : 0.6;
    for (const fn of this.duckListeners) {
      try {
        fn(d, hold);
      } catch {
        /* a listener never breaks the game */
      }
    }
    const ctx = this.ctx;
    const bed = this.bed;
    if (!ctx || !bed) return;
    const t = ctx.currentTime;
    const g = bed.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(1 - d, t + 0.04);
    g.setValueAtTime(1 - d, t + hold);
    g.linearRampToValueAtTime(1, t + hold + 0.45);
  }

  /** Listen to {@link duck} (returns the unsubscribe). */
  onDuck(fn: (depth: number, seconds: number) => void): () => void {
    this.duckListeners.add(fn);
    return () => this.duckListeners.delete(fn);
  }

  /** Play a named effect (ignored when unknown, muted or rate-limited). */
  play(name: string, level = 1): void {
    if (this.muted || this.volume <= 0 || !Object.prototype.hasOwnProperty.call(TONES, name)) return;
    const tone = TONES[name] as Tone;
    const ctx = this.context();
    if (!ctx) return;
    const t = ctx.currentTime;
    if (!(level > 0.002)) return;
    if (t - (this.lastPlayed.get(name) ?? -1) < MIN_INTERVAL) return;
    if (t - this.windowStart >= 1) {
      this.windowStart = t;
      this.voices = 0;
    }
    if (++this.voices > MAX_VOICES_PER_SECOND) return;
    this.lastPlayed.set(name, t);
    if (tone.type === 'noise') {
      // A little variation so repeated steps do not sound stamped.
      const k = 0.92 + Math.random() * 0.16;
      const g = tone.gain * Math.min(1.5, level);
      const bus = name.startsWith('step') ? this.bedOutput(ctx) : this.output(ctx);
      this.noise(ctx, tone.from * k, tone.to * k, t, tone.duration, g, bus);
      if (tone.then) this.noise(ctx, tone.then.from * k, tone.then.to * k, t + tone.then.delay, tone.duration, g, bus);
      return;
    }
    const g = tone.gain * Math.min(1.5, level);
    this.voice(ctx, tone.type, tone.from, tone.to, t, tone.duration, g);
    if (tone.then) this.voice(ctx, tone.type, tone.then.from, tone.then.to, t + tone.then.delay, tone.duration, g);
  }

  /** Pause the audio clock (page hidden); the next {@link play} resumes it. */
  suspend(): void {
    if (this.ctx?.state === 'running') void this.ctx.suspend().catch(() => undefined);
  }

  /** Close the audio context. */
  dispose(): void {
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.master = null;
    this.bed = null;
    this.noiseBuffer = null;
    this.duckListeners.clear();
  }

  private context(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
      return this.ctx;
    }
    try {
      const Ctor = typeof AudioContext !== 'undefined' ? AudioContext : null;
      this.ctx = Ctor ? new Ctor() : null;
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  /** One second of white noise, made once per context. */
  private noiseBuffer: AudioBuffer | null = null;

  private noise(ctx: AudioContext, from: number, to: number, start: number, duration: number, gain: number, bus: AudioNode): void {
    if (!this.noiseBuffer) {
      const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = buf.getChannelData(0);
      let s = 0x1234567;
      for (let i = 0; i < data.length; i++) {
        s ^= s << 13;
        s ^= s >>> 17;
        s ^= s << 5;
        data[i] = ((s >>> 0) / 4294967296) * 2 - 1;
      }
      this.noiseBuffer = buf;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.4;
    filter.frequency.setValueAtTime(from, start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(1, to), start + duration);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(gain, start + 0.005);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    src.connect(filter).connect(amp).connect(bus);
    src.start(start, Math.random() * 0.5);
    src.stop(start + duration + 0.02);
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      amp.disconnect();
    };
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
    osc.connect(amp).connect(this.output(ctx));
    osc.start(start);
    osc.stop(start + duration + 0.02);
    osc.onended = () => {
      osc.disconnect();
      amp.disconnect();
    };
  }
}
