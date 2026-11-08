/**
 * The sound of a story (`world.story`): an original procedural score that follows the shots' music cues, an ambience
 * bed (wind, waves, cicadas, gulls, the town) and one-shot sounds (the crossing bell, a train passing, its whistle, a
 * gull, steps…), all synthesized with WebAudio: no files, nothing to license. Everything goes through one master gain,
 * so the film can be muted at once; a browser that blocks sound until a gesture starts it on the first key or click.
 *
 * The score is written as phrases over a slow chord cycle, scheduled a little ahead of the clock (a 120 ms timer), so a
 * busy frame never drops a note. Each cue is a set of layers (pad, piano, bass, pulse, strings, bells) with its tempo;
 * a cue change crossfades the layers over a second and keeps the bar grid running.
 */

/** Cues a shot can name (`StoryShot.music`). */
export const STORY_CUES = ['intro', 'run', 'tension', 'hush', 'hope', 'climax', 'coda'] as const;
export type StoryCue = (typeof STORY_CUES)[number];

/** Sounds a shot can name (`StoryShot.sounds[].sound`). */
export const STORY_SOUNDS = ['crossing-bell', 'train-pass', 'train-whistle', 'gull', 'steps', 'wind-gust', 'chime', 'heartbeat'] as const;

/** What the story runner drives (the player's audio, or nothing). */
export interface StorySoundSink {
  cue(name: string | null): void;
  ambience(levels: Readonly<Record<string, number>>): void;
  sound(name: string, gain: number, seconds?: number): void;
}

interface Layers {
  /** The melody (a soft flute-like lead singing the motif). */
  lead: number;
  pad: number;
  piano: number;
  bass: number;
  pulse: number;
  strings: number;
  bells: number;
}

interface CueDef {
  bpm: number;
  layers: Layers;
  /** Chord roots (MIDI) and qualities, one per bar. */
  chords: ReadonlyArray<readonly number[]>;
  /** Piano phrase: beat offsets and scale steps over the chord (null: rest). */
  phrase: ReadonlyArray<readonly [number, number]>;
}

// D major / B minor colours; the motif is a rising sixth and a step down (the two whistles).
const PROG_A = [
  [50, 57, 62, 66, 69],
  [47, 54, 59, 62, 66],
  [43, 50, 55, 59, 62],
  [45, 52, 57, 61, 64],
] as const;
const PROG_B = [
  [43, 50, 55, 59, 64],
  [45, 52, 57, 61, 66],
  [47, 54, 59, 62, 66],
  [50, 57, 62, 66, 69],
] as const;
const PROG_T = [
  [46, 53, 58, 62],
  [46, 53, 58, 61],
  [45, 52, 57, 60],
  [45, 52, 56, 59],
] as const;
const MOTIF: ReadonlyArray<readonly [number, number]> = [[0, 0], [1, 5], [2.5, 4], [3, 2]];
const MOTIF_LONG: ReadonlyArray<readonly [number, number]> = [[0, 0], [0.5, 2], [1, 5], [2, 4], [2.5, 2], [3, 4], [3.5, 5]];

const CUES: Readonly<Record<StoryCue, CueDef>> = {
  intro: { bpm: 72, layers: { lead: 0.45, pad: 0.55, piano: 0.5, bass: 0.25, pulse: 0, strings: 0, bells: 0.25 }, chords: PROG_A, phrase: MOTIF },
  run: { bpm: 124, layers: { lead: 0.3, pad: 0.35, piano: 0.45, bass: 0.5, pulse: 0.5, strings: 0.15, bells: 0 }, chords: PROG_B, phrase: MOTIF_LONG },
  tension: { bpm: 96, layers: { lead: 0, pad: 0.5, piano: 0.3, bass: 0.45, pulse: 0.3, strings: 0.35, bells: 0 }, chords: PROG_T, phrase: [[0, 7], [1, 7], [2, 7], [3, 7]] },
  hush: { bpm: 60, layers: { lead: 0.0, pad: 0.28, piano: 0.35, bass: 0, pulse: 0, strings: 0, bells: 0.15 }, chords: PROG_T, phrase: [[0, 4], [3, 2]] },
  hope: { bpm: 88, layers: { lead: 0.55, pad: 0.5, piano: 0.55, bass: 0.35, pulse: 0.2, strings: 0.3, bells: 0.2 }, chords: PROG_A, phrase: MOTIF_LONG },
  climax: { bpm: 84, layers: { lead: 0.8, pad: 0.6, piano: 0.6, bass: 0.5, pulse: 0.15, strings: 0.6, bells: 0.35 }, chords: PROG_B, phrase: MOTIF_LONG },
  coda: { bpm: 66, layers: { lead: 0.5, pad: 0.45, piano: 0.45, bass: 0.2, pulse: 0, strings: 0.15, bells: 0.25 }, chords: PROG_A, phrase: MOTIF },
};

const LAYER_KEYS: ReadonlyArray<keyof Layers> = ['lead', 'pad', 'piano', 'bass', 'pulse', 'strings', 'bells'];
const SILENT: Layers = { lead: 0, pad: 0, piano: 0, bass: 0, pulse: 0, strings: 0, bells: 0 };

/**
 * The melody, four bars that loop: [beat in the phrase, MIDI note, beats long]. It opens on the motif (a rising sixth,
 * then a step down: the two whistles), answers it, climbs, and comes home.
 */
const MELODY: ReadonlyArray<readonly [number, number, number]> = [
  [0, 74, 1], [1, 83, 1.5], [2.5, 81, 1.5],
  [4, 79, 1], [5, 78, 1], [6, 76, 2],
  [8, 74, 1], [9, 83, 1], [10, 81, 1], [11, 83, 1],
  [12, 86, 2], [14, 85, 0.5], [14.5, 83, 0.5], [15, 81, 1],
];
/** Ambience channels. */
const BEDS = ['wind', 'waves', 'cicadas', 'gulls', 'town'] as const;

const hz = (m: number): number => 440 * 2 ** ((m - 69) / 12);

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface StoryAudioOptions {
  /** Master level 0..1 (the player's volume). */
  volume: number;
  /** Score level 0..1 (the player's music setting). */
  music: number;
  muted: boolean;
}

export class StoryAudio implements StorySoundSink {
  private ctx: BaseAudioContext | null = null;
  /** Built on an OfflineAudioContext (a film export): no timer, no gesture, the caller drives {@link tick}. */
  private offline = false;
  private master: GainNode | null = null;
  private meter: AnalyserNode | null = null;
  private readonly meterBuf = new Float32Array(2048);
  private scoreBus: GainNode | null = null;
  private ambBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private readonly layerGain = new Map<keyof Layers, GainNode>();
  private readonly bedGain = new Map<string, GainNode>();
  private noise: AudioBuffer | null = null;
  private brown: AudioBuffer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private cueName: StoryCue | null = null;
  private def: CueDef | null = null;
  /** Bar grid: the context time the next beat falls on and its index. */
  private nextBeat = 0;
  private beat = 0;
  private nextGull = 0;
  private readonly rand = rng(0x5eed);
  private opts: StoryAudioOptions;
  private disposed = false;

  constructor(opts: StoryAudioOptions) {
    this.opts = { ...opts };
  }

  /**
   * The same graph on an offline context (a film export renders the score and the ambience through an
   * `OfflineAudioContext`, so the sound is the live film's and deterministic). Nothing runs by itself: the caller suspends
   * the context at each step of the film, drives the story's cues and sounds at that time, and calls {@link tick}.
   */
  static offline(ctx: BaseAudioContext, opts: StoryAudioOptions): StoryAudio {
    const a = new StoryAudio({ ...opts, muted: false });
    a.offline = true;
    a.build(ctx);
    return a;
  }

  /** Schedule the score and the ambience's gulls ahead of the context's clock (the live timer's work; offline: per step). */
  tick(): void {
    this.schedule();
  }

  /** Create the context and the graph (call from a gesture when possible). Returns false where WebAudio is missing. */
  private ensure(): boolean {
    if (this.ctx) return true;
    if (this.offline) return false;
    const Ctor = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor || this.disposed) return false;
    const ctx = new Ctor({ latencyHint: 'playback' });
    this.build(ctx);
    this.timer = setInterval(() => this.schedule(), 120);
    if (this.opts.muted) void ctx.suspend();
    else if (ctx.state === 'suspended') {
      const resume = (): void => {
        void ctx.resume();
        removeEventListener('pointerdown', resume, true);
        removeEventListener('keydown', resume, true);
      };
      addEventListener('pointerdown', resume, true);
      addEventListener('keydown', resume, true);
    }
    return true;
  }

  /** The graph on `ctx`: master, limiter, meter, reverb, the buses, the score's layers and the ambience beds. */
  private build(ctx: BaseAudioContext): void {
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = this.masterLevel();
    // A gentle limiter so a whistle over the climax never clips.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 4;
    comp.attack.value = 0.01;
    comp.release.value = 0.25;
    master.connect(comp).connect(ctx.destination);
    // A meter on the mix (the player's check that the film is really audible: `level()`).
    this.meter = ctx.createAnalyser();
    this.meter.fftSize = 2048;
    comp.connect(this.meter);
    this.master = master;
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.2, 2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.32;
    this.reverb.connect(wet).connect(master);
    this.scoreBus = ctx.createGain();
    this.scoreBus.gain.value = this.scoreLevel();
    this.scoreBus.connect(master);
    this.scoreBus.connect(this.reverb);
    this.ambBus = ctx.createGain();
    this.ambBus.gain.value = 0.9;
    this.ambBus.connect(master);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(master);
    this.sfxBus.connect(this.reverb);
    for (const k of LAYER_KEYS) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.scoreBus);
      this.layerGain.set(k, g);
    }
    this.noise = this.noiseBuffer(4, false);
    this.brown = this.noiseBuffer(6, true);
    this.startBeds();
    this.nextBeat = ctx.currentTime + 0.15;
  }

  /** The audio context's state (`running`, `suspended`, `closed`), or `none` before it exists. */
  get state(): string {
    return this.ctx?.state ?? 'none';
  }

  /** RMS level of the mix right now (0 silent .. about 0.3 loud), or 0 before the context runs. */
  level(): number {
    if (!this.meter || this.ctx?.state !== 'running') return 0;
    this.meter.getFloatTimeDomainData(this.meterBuf);
    let sum = 0;
    for (const v of this.meterBuf) sum += v * v;
    return Math.sqrt(sum / this.meterBuf.length);
  }

  /** Whether the browser is holding the sound until a gesture. */
  get blocked(): boolean {
    return this.ctx?.state === 'suspended';
  }

  /** Start (or resume) the sound; call on a user gesture. */
  resume(): void {
    if (!this.ensure()) return;
    void this.live()?.resume();
  }

  /** The live context (null offline: an offline render is never suspended, resumed or closed from here). */
  private live(): AudioContext | null {
    return this.offline ? null : (this.ctx as AudioContext | null);
  }

  set(opts: Partial<StoryAudioOptions>): void {
    this.opts = { ...this.opts, ...opts };
    const ctx = this.live();
    if (!ctx || !this.master || !this.scoreBus) return;
    this.master.gain.setTargetAtTime(this.masterLevel(), ctx.currentTime, 0.08);
    this.scoreBus.gain.setTargetAtTime(this.scoreLevel(), ctx.currentTime, 0.08);
    // Muted, the graph stops rendering altogether (no audio thread work); the score's grid picks up on resume.
    if (this.opts.muted) setTimeout(() => void (this.opts.muted && ctx.state === 'running' ? ctx.suspend() : undefined), 400);
    else if (ctx.state === 'suspended') void ctx.resume();
  }

  get muted(): boolean {
    return this.opts.muted;
  }

  /** The score over the ambience: the film's music is the lead of its mix (the player's music setting scales it). */
  private scoreLevel(): number {
    return 1.6 * this.opts.music;
  }

  private masterLevel(): number {
    return this.opts.muted ? 0 : 0.8 * this.opts.volume;
  }

  cue(name: string | null): void {
    if (!this.ensure() || !this.ctx) return;
    const next = name && (STORY_CUES as readonly string[]).includes(name) ? (name as StoryCue) : null;
    if (next === this.cueName) return;
    this.cueName = next;
    const def = next ? CUES[next] : null;
    const layers = def?.layers ?? SILENT;
    const t = this.ctx.currentTime;
    for (const k of LAYER_KEYS) this.layerGain.get(k)?.gain.setTargetAtTime(layers[k], t, next === 'hush' || !next ? 0.6 : 0.35);
    if (def) {
      // A new tempo starts on the next beat of the old grid.
      if (!this.def || this.def.bpm !== def.bpm) this.beat = Math.ceil(this.beat / 4) * 4;
      this.def = def;
    }
  }

  ambience(levels: Readonly<Record<string, number>>): void {
    if (!this.ensure() || !this.ctx) return;
    const t = this.ctx.currentTime;
    for (const b of BEDS) {
      const v = levels[b];
      if (v === undefined) continue;
      const g = this.bedGain.get(b);
      if (g && Math.abs(g.gain.value - v) > 1e-3) g.gain.setTargetAtTime(v * BED_LEVEL[b], t, 0.4);
    }
  }

  sound(name: string, gain: number, seconds?: number): void {
    if (!this.ensure() || !this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime + 0.02;
    switch (name) {
      case 'crossing-bell':
        this.bell(t, seconds ?? 4, gain);
        break;
      case 'train-pass':
        this.trainPass(t, seconds ?? 5, gain);
        break;
      case 'train-whistle':
        this.whistle(t, gain);
        break;
      case 'gull':
        this.gull(t, gain);
        break;
      case 'steps':
        this.steps(t, seconds ?? 2, gain);
        break;
      case 'wind-gust':
        this.gust(t, seconds ?? 3, gain);
        break;
      case 'chime':
        this.chime(t, gain);
        break;
      case 'heartbeat':
        this.heartbeat(t, seconds ?? 3, gain);
        break;
      default:
        break;
    }
  }

  /** Fade everything out over `seconds` (the end of the film's sound when leaving it). */
  fadeOut(seconds = 1.5): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    this.master.gain.setTargetAtTime(0, ctx.currentTime, seconds / 4);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const ctx = this.live();
    this.ctx = null;
    if (ctx) {
      this.master?.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
      setTimeout(() => void ctx.close().catch(() => undefined), 700);
    }
  }

  // ---- the score -----------------------------------------------------------------------------------------------

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || this.disposed) return;
    const horizon = ctx.currentTime + 0.45;
    if (this.nextBeat < ctx.currentTime - 0.5) this.nextBeat = ctx.currentTime + 0.05;
    while (this.nextBeat < horizon) {
      const def = this.def;
      const spb = def ? 60 / def.bpm : 0.75;
      if (def) this.playBeat(def, this.beat, this.nextBeat, spb);
      this.nextBeat += spb;
      this.beat++;
    }
    // Gulls now and then (the bed's level sets how loud).
    const gulls = this.bedGain.get('gulls')?.gain.value ?? 0;
    if (gulls > 0.02 && ctx.currentTime > this.nextGull) {
      this.gull(ctx.currentTime + 0.1, gulls / BED_LEVEL.gulls, this.ambBus);
      this.nextGull = ctx.currentTime + 2.5 + this.rand() * 6;
    }
  }

  private playBeat(def: CueDef, beat: number, t: number, spb: number): void {
    const bar = Math.floor(beat / 4);
    const inBar = beat % 4;
    const chord = def.chords[bar % def.chords.length] as readonly number[];
    if (inBar === 0) {
      this.pad(chord, t, spb * 4);
      this.strings(chord, t, spb * 4);
      if (bar % 2 === 0) this.bellTone(chord[chord.length - 1]! + 12, t + spb * 2, 0.5);
    }
    // Bass: roots on 1 and 3 (8ths in the pulse cues).
    const root = chord[0] as number;
    if (def.layers.pulse > 0.25) {
      this.bassNote(root - 12, t, spb * 0.45);
      this.bassNote(root - 12, t + spb / 2, spb * 0.4);
      this.shaker(t + spb / 2);
      if (inBar === 0 || inBar === 2) this.thump(t);
    } else if (inBar === 0 || inBar === 2) this.bassNote(root - 12, t, spb * 1.8);
    else if (def.layers.pulse > 0) this.shaker(t);
    // The melody: the beats of the four-bar phrase that fall in this beat.
    if (def.layers.lead > 0) {
      const at = beat % 16;
      for (const [b, note, len] of MELODY) if (b >= at && b < at + 1) this.lead(note, t + (b - at) * spb, len * spb);
    }
    // The piano phrase over every other bar (the first of each pair), an octave answer on the next.
    const answer = bar % 2 === 1;
    for (const [off, step] of def.phrase) {
      if (off < inBar || off >= inBar + 1) continue;
      const scale = [chord[1], chord[2], chord[3], chord[4] ?? (chord[2] as number) + 12, (chord[1] as number) + 12, (chord[2] as number) + 12, (chord[3] as number) + 12, (chord[2] as number) + 19] as number[];
      const note = (scale[step % scale.length] as number) + (answer ? -12 : 12);
      this.piano(note, t + (off - inBar) * spb, answer ? 0.55 : 0.8);
    }
  }

  private voice(type: OscillatorType, freq: number, t: number, dur: number, peak: number, attack: number, release: number, out: AudioNode, detune = 0): void {
    const ctx = this.ctx as BaseAudioContext;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + Math.max(attack, dur - release));
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private pad(chord: readonly number[], t: number, dur: number): void {
    const ctx = this.ctx as BaseAudioContext;
    const out = this.layerGain.get('pad') as GainNode;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(700, t);
    f.frequency.linearRampToValueAtTime(1500, t + dur * 0.5);
    f.frequency.linearRampToValueAtTime(800, t + dur);
    f.connect(out);
    for (const [i, n] of chord.slice(1, 4).entries()) {
      this.voice('sawtooth', hz(n), t, dur + 0.6, 0.035, dur * 0.35, dur * 0.4, f, (i - 1) * 7);
      this.voice('triangle', hz(n), t, dur + 0.6, 0.05, dur * 0.3, dur * 0.4, f, -(i - 1) * 5);
    }
  }

  private strings(chord: readonly number[], t: number, dur: number): void {
    const ctx = this.ctx as BaseAudioContext;
    const out = this.layerGain.get('strings') as GainNode;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2400;
    f.Q.value = 0.4;
    f.connect(out);
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.2;
    const vg = ctx.createGain();
    vg.gain.value = 9;
    vib.connect(vg);
    vib.start(t);
    vib.stop(t + dur + 0.6);
    for (const n of [chord[2] as number, (chord[3] as number) + 12, (chord[1] as number) + 12]) {
      for (const d of [-8, 8]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = hz(n);
        o.detune.value = d;
        vg.connect(o.detune);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.022, t + dur * 0.45);
        g.gain.linearRampToValueAtTime(0, t + dur + 0.5);
        o.connect(g).connect(f);
        o.start(t);
        o.stop(t + dur + 0.6);
      }
    }
  }

  private piano(note: number, t: number, vel: number): void {
    const ctx = this.ctx as BaseAudioContext;
    const out = this.layerGain.get('piano') as GainNode;
    const f = hz(note);
    // A struck string: a few partials, the higher ones decaying faster; a soft hammer click.
    const partials: Array<[number, number, number]> = [[1, 0.5, 2.6], [2, 0.22, 1.4], [3, 0.1, 0.8], [4.02, 0.05, 0.5]];
    for (const [m, a, d] of partials) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * m;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(a * vel * 0.26, t + 0.005);
      g.gain.exponentialRampToValueAtTime(1e-4, t + d);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + d + 0.05);
    }
  }

  /** A soft, breathy lead: a sine and a quiet octave triangle, a slow attack, vibrato after the onset. */
  private lead(note: number, t: number, dur: number): void {
    const ctx = this.ctx as BaseAudioContext;
    const out = this.layerGain.get('lead') as GainNode;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 3200;
    f.connect(out);
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.1;
    const vg = ctx.createGain();
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(7, t + Math.min(0.5, dur * 0.6));
    vib.connect(vg);
    vib.start(t);
    vib.stop(t + dur + 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.14, t + 0.09);
    g.gain.setTargetAtTime(0.1, t + 0.09, dur * 0.5);
    g.gain.setTargetAtTime(0, t + dur, 0.18);
    g.connect(f);
    for (const [type, mul, amp] of [['sine', 1, 1], ['triangle', 2, 0.18]] as Array<[OscillatorType, number, number]>) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = hz(note) * mul;
      vg.connect(o.detune);
      const a = ctx.createGain();
      a.gain.value = amp;
      o.connect(a).connect(g);
      o.start(t);
      o.stop(t + dur + 0.6);
    }
    // Breath: a little filtered noise at the onset.
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = hz(note) * 2;
    bp.Q.value = 2;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.025, t);
    ng.gain.exponentialRampToValueAtTime(1e-4, t + 0.25);
    n.connect(bp).connect(ng).connect(out);
    n.start(t, this.rand() * 3, 0.3);
  }

  private bellTone(note: number, t: number, vel: number): void {
    const ctx = this.ctx as BaseAudioContext;
    const out = this.layerGain.get('bells') as GainNode;
    const f = hz(note);
    for (const [m, a, d] of [[1, 1, 3], [2.76, 0.4, 1.6], [5.4, 0.2, 0.8]] as Array<[number, number, number]>) {
      const o = ctx.createOscillator();
      o.frequency.value = f * m;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(a * vel * 0.05, t + 0.004);
      g.gain.exponentialRampToValueAtTime(1e-4, t + d);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + d + 0.05);
    }
  }

  private bassNote(note: number, t: number, dur: number): void {
    this.voice('sine', hz(note), t, dur, 0.2, 0.02, Math.min(0.3, dur * 0.5), this.layerGain.get('bass') as GainNode);
    this.voice('triangle', hz(note) * 2, t, dur, 0.04, 0.02, Math.min(0.3, dur * 0.5), this.layerGain.get('bass') as GainNode);
  }

  private shaker(t: number): void {
    const ctx = this.ctx as BaseAudioContext;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 6500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.01);
    g.gain.exponentialRampToValueAtTime(1e-4, t + 0.09);
    src.connect(f).connect(g).connect(this.layerGain.get('pulse') as GainNode);
    src.start(t, this.rand() * 3, 0.12);
  }

  private thump(t: number): void {
    const ctx = this.ctx as BaseAudioContext;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(1e-4, t + 0.3);
    o.connect(g).connect(this.layerGain.get('pulse') as GainNode);
    o.start(t);
    o.stop(t + 0.32);
  }

  // ---- the ambience bed ------------------------------------------------------------------------------------------

  private startBeds(): void {
    const ctx = this.ctx as BaseAudioContext;
    const amb = this.ambBus as GainNode;
    const loop = (buf: AudioBuffer): AudioBufferSourceNode => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.start(ctx.currentTime, this.rand() * buf.duration);
      return s;
    };
    const lfo = (rate: number, depth: number, param: AudioParam): void => {
      const o = ctx.createOscillator();
      o.frequency.value = rate;
      const g = ctx.createGain();
      g.gain.value = depth;
      o.connect(g).connect(param);
      o.start();
    };
    for (const b of BEDS) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(amb);
      this.bedGain.set(b, g);
    }
    // Wind: noise through a wandering band, its level breathing.
    {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 520;
      f.Q.value = 0.6;
      lfo(0.07, 260, f.frequency);
      const v = ctx.createGain();
      v.gain.value = 0.7;
      lfo(0.11, 0.3, v.gain);
      loop(this.noise as AudioBuffer).connect(f).connect(v).connect(this.bedGain.get('wind') as GainNode);
    }
    // Waves: brown noise swelling on a ~7 s period (two slightly detuned swells, so no two waves are alike).
    {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 700;
      lfo(0.13, 380, f.frequency);
      const v = ctx.createGain();
      v.gain.value = 0.55;
      lfo(0.142, 0.35, v.gain);
      lfo(0.093, 0.18, v.gain);
      loop(this.brown as AudioBuffer).connect(f).connect(v).connect(this.bedGain.get('waves') as GainNode);
      // The hiss of the wash up the stones.
      const h = ctx.createBiquadFilter();
      h.type = 'highpass';
      h.frequency.value = 3000;
      const hv = ctx.createGain();
      hv.gain.value = 0.05;
      lfo(0.142, 0.045, hv.gain);
      loop(this.noise as AudioBuffer).connect(h).connect(hv).connect(this.bedGain.get('waves') as GainNode);
    }
    // Cicadas: a narrow band of noise near 5 kHz, chopped at ~48 Hz, swelling in long waves.
    {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 5200;
      f.Q.value = 6;
      const am = ctx.createGain();
      am.gain.value = 0.5;
      const chop = ctx.createOscillator();
      chop.type = 'square';
      chop.frequency.value = 48;
      const cd = ctx.createGain();
      cd.gain.value = 0.5;
      chop.connect(cd).connect(am.gain);
      chop.start();
      const v = ctx.createGain();
      v.gain.value = 0.6;
      lfo(0.05, 0.4, v.gain);
      loop(this.noise as AudioBuffer).connect(f).connect(am).connect(v).connect(this.bedGain.get('cicadas') as GainNode);
    }
    // The town: a low hum far off.
    {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 220;
      loop(this.brown as AudioBuffer).connect(f).connect(this.bedGain.get('town') as GainNode);
    }
  }

  // ---- one-shot sounds -------------------------------------------------------------------------------------------

  /** The level crossing's bell: a struck bell twice a second (alternating pitch), for `dur` seconds. */
  private bell(t: number, dur: number, gain: number): void {
    const ctx = this.ctx as BaseAudioContext;
    const out = ctx.createGain();
    out.gain.value = gain;
    out.connect(this.sfxBus as GainNode);
    for (let k = 0; k * 0.42 < dur; k++) {
      const s = t + k * 0.42;
      const f = k % 2 === 0 ? 1180 : 1050;
      for (const [m, a, d] of [[1, 1, 0.5], [2.41, 0.5, 0.25], [3.9, 0.25, 0.12]] as Array<[number, number, number]>) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f * m;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, s);
        g.gain.linearRampToValueAtTime(0.09 * a, s + 0.003);
        g.gain.exponentialRampToValueAtTime(1e-4, s + d);
        o.connect(g).connect(out);
        o.start(s);
        o.stop(s + d + 0.02);
      }
    }
  }

  /** A train passing: a rumble that swells and fades, the rail joints' double click (ta-tan) at speed, a motor whine. */
  private trainPass(t: number, dur: number, gain: number): void {
    const ctx = this.ctx as BaseAudioContext;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(gain, t + dur * 0.4);
    out.gain.linearRampToValueAtTime(gain * 0.8, t + dur * 0.6);
    out.gain.linearRampToValueAtTime(0, t + dur);
    out.connect(this.sfxBus as GainNode);
    const src = ctx.createBufferSource();
    src.buffer = this.brown;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.linearRampToValueAtTime(1400, t + dur * 0.5);
    lp.frequency.linearRampToValueAtTime(400, t + dur);
    const rg = ctx.createGain();
    rg.gain.value = 0.9;
    src.connect(lp).connect(rg).connect(out);
    src.start(t);
    src.stop(t + dur + 0.1);
    // Joints: 20 m cars at ~14 m/s, a bogie pair over each joint.
    for (let s = t + 0.1; s < t + dur; s += 0.68) {
      for (const dt of [0, 0.13]) {
        const c = ctx.createBufferSource();
        c.buffer = this.noise;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 900;
        bp.Q.value = 1.4;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.5, s + dt);
        g.gain.exponentialRampToValueAtTime(1e-3, s + dt + 0.07);
        c.connect(bp).connect(g).connect(out);
        c.start(s + dt, this.rand() * 3, 0.09);
      }
    }
    // The motor's whine, falling in pitch as it passes (Doppler).
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(620, t);
    o.frequency.setValueAtTime(620, t + dur * 0.45);
    o.frequency.linearRampToValueAtTime(520, t + dur * 0.6);
    const og = ctx.createGain();
    og.gain.value = 0.025;
    o.connect(og).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Two long whistle blasts, far off (a reed horn: two detuned tones through a band, with the valley's echo). */
  private whistle(t: number, gain: number): void {
    const ctx = this.ctx as BaseAudioContext;
    const out = ctx.createGain();
    out.gain.value = gain;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2200;
    out.connect(lp).connect(this.sfxBus as GainNode);
    const echo = ctx.createDelay(2);
    echo.delayTime.value = 0.55;
    const eg = ctx.createGain();
    eg.gain.value = 0.28;
    lp.connect(echo).connect(eg).connect(this.reverb as ConvolverNode);
    for (const [s, d] of [[0, 1.1], [1.45, 1.6]] as Array<[number, number]>) {
      for (const f of [466, 587]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(f * 0.96, t + s);
        o.frequency.linearRampToValueAtTime(f, t + s + 0.12);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = f * 2;
        bp.Q.value = 1.2;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t + s);
        g.gain.linearRampToValueAtTime(0.12, t + s + 0.08);
        g.gain.setValueAtTime(0.12, t + s + d - 0.25);
        g.gain.linearRampToValueAtTime(0, t + s + d);
        o.connect(bp).connect(g).connect(out);
        o.start(t + s);
        o.stop(t + s + d + 0.05);
      }
    }
  }

  private gull(t: number, gain: number, bus: AudioNode | null = this.sfxBus): void {
    const ctx = this.ctx as BaseAudioContext;
    const out = ctx.createGain();
    out.gain.value = gain * (0.4 + this.rand() * 0.6);
    const pan = ctx.createStereoPanner();
    pan.pan.value = this.rand() * 1.6 - 0.8;
    out.connect(pan).connect(bus as AudioNode);
    const calls = 1 + Math.floor(this.rand() * 3);
    for (let k = 0; k < calls; k++) {
      const s = t + k * (0.28 + this.rand() * 0.1);
      const base = 1500 + this.rand() * 500;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(base * 0.75, s);
      o.frequency.linearRampToValueAtTime(base * 1.1, s + 0.06);
      o.frequency.linearRampToValueAtTime(base * 0.7, s + 0.24);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = base * 1.4;
      bp.Q.value = 3;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.06, s + 0.03);
      g.gain.exponentialRampToValueAtTime(1e-3, s + 0.26);
      o.connect(bp).connect(g).connect(out);
      o.start(s);
      o.stop(s + 0.3);
    }
  }

  private steps(t: number, dur: number, gain: number): void {
    const ctx = this.ctx as BaseAudioContext;
    for (let s = t; s < t + dur; s += 0.29 + this.rand() * 0.03) {
      const c = ctx.createBufferSource();
      c.buffer = this.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1400 + this.rand() * 500;
      bp.Q.value = 1.1;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.18 * gain, s);
      g.gain.exponentialRampToValueAtTime(1e-3, s + 0.06);
      c.connect(bp).connect(g).connect(this.sfxBus as GainNode);
      c.start(s, this.rand() * 3, 0.08);
    }
  }

  private gust(t: number, dur: number, gain: number): void {
    const ctx = this.ctx as BaseAudioContext;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.linearRampToValueAtTime(1100, t + dur * 0.5);
    bp.frequency.linearRampToValueAtTime(400, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35 * gain, t + dur * 0.4);
    g.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(bp).connect(g).connect(this.sfxBus as GainNode);
    src.start(t, this.rand(), dur + 0.1);
  }

  private chime(t: number, gain: number): void {
    const ctx = this.ctx as BaseAudioContext;
    for (const [k, n] of [86, 90, 93].entries()) {
      const s = t + k * 0.12;
      const o = ctx.createOscillator();
      o.frequency.value = hz(n);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.05 * gain, s + 0.004);
      g.gain.exponentialRampToValueAtTime(1e-4, s + 2.2);
      o.connect(g).connect(this.sfxBus as GainNode);
      o.start(s);
      o.stop(s + 2.3);
    }
  }

  private heartbeat(t: number, dur: number, gain: number): void {
    const ctx = this.ctx as BaseAudioContext;
    for (let s = t; s < t + dur; s += 0.78) {
      for (const [dt, a] of [[0, 1], [0.18, 0.7]] as Array<[number, number]>) {
        const o = ctx.createOscillator();
        o.frequency.setValueAtTime(70, s + dt);
        o.frequency.exponentialRampToValueAtTime(38, s + dt + 0.12);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.3 * a * gain, s + dt);
        g.gain.exponentialRampToValueAtTime(1e-4, s + dt + 0.16);
        o.connect(g).connect(this.sfxBus as GainNode);
        o.start(s + dt);
        o.stop(s + dt + 0.18);
      }
    }
  }

  // ---- buffers ---------------------------------------------------------------------------------------------------

  private noiseBuffer(seconds: number, brown: boolean): AudioBuffer {
    const ctx = this.ctx as BaseAudioContext;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = this.rand() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w * 0.5;
    }
    // A short crossfade so the loop has no click.
    const x = Math.min(2048, n >> 2);
    for (let i = 0; i < x; i++) {
      const u = i / x;
      d[i] = (d[i] as number) * u + (d[n - x + i] as number) * (1 - u);
    }
    return buf;
  }

  /** A synthetic room: decaying stereo noise. */
  private impulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx as BaseAudioContext;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (this.rand() * 2 - 1) * (1 - i / n) ** decay;
    }
    return buf;
  }
}

/** Each bed's full level (so a shot's 0..1 reads the same across beds). */
const BED_LEVEL: Readonly<Record<(typeof BEDS)[number], number>> = { wind: 0.16, waves: 0.28, cicadas: 0.04, gulls: 0.45, town: 0.08 };
