/**
 * Background music from the studio's synthesizer: a short generative score
 * (pads, bass, arpeggio or percussion per mood) scheduled on any WebAudio
 * context. The same score renders offline (`OfflineAudioContext`) for video
 * export and plays live for previews and the MediaRecorder fallback. It is
 * deterministic for a given mood, length and seed — no samples, nothing to
 * license.
 */

/** Moods (score presets). */
export const MOODS = ['calm', 'cinematic', 'playful', 'mystery'] as const;
export type Mood = (typeof MOODS)[number];

/** Labels for the UI. */
export const MOOD_LABELS: Readonly<Record<Mood, string>> = { calm: 'Calm', cinematic: 'Cinematic', playful: 'Playful', mystery: 'Mystery' };

/** Sample rate of rendered scores (Opus native rate). */
export const MUSIC_SAMPLE_RATE = 48_000;
/** Longest score (seconds). */
export const MAX_MUSIC_SECONDS = 300;

interface Score {
  bpm: number;
  /** MIDI notes per chord (one chord per bar). */
  chords: number[][];
  pad: OscillatorType;
  padCutoff: number;
  arp: OscillatorType | null;
  bass: OscillatorType;
  drums: 'none' | 'taiko' | 'hats';
  bells: boolean;
}

const SCORES: Readonly<Record<Mood, Score>> = {
  calm: { bpm: 72, chords: [[48, 52, 55, 59], [45, 48, 52, 55], [41, 45, 48, 52], [43, 47, 50, 52]], pad: 'triangle', padCutoff: 1800, arp: 'sine', bass: 'sine', drums: 'none', bells: false },
  cinematic: { bpm: 84, chords: [[45, 48, 52], [41, 45, 48], [48, 52, 55], [43, 47, 50]], pad: 'sawtooth', padCutoff: 950, arp: null, bass: 'triangle', drums: 'taiko', bells: false },
  playful: { bpm: 112, chords: [[48, 52, 55], [43, 47, 50, 55], [45, 48, 52], [41, 45, 48]], pad: 'triangle', padCutoff: 2400, arp: 'square', bass: 'triangle', drums: 'hats', bells: false },
  mystery: { bpm: 64, chords: [[50, 53, 57], [46, 50, 53], [43, 46, 50], [45, 49, 52]], pad: 'sine', padCutoff: 1400, arp: null, bass: 'sine', drums: 'none', bells: true },
};

/** Frequency of a MIDI note. */
export function midiHz(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

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

/** Hash text to a seed (FNV-1a). */
export function musicSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Number of notes a score of this length schedules (bounded; used by tests and budgets). */
export function scoreBars(mood: Mood, seconds: number): number {
  const s = SCORES[mood];
  return Math.ceil((Math.min(MAX_MUSIC_SECONDS, Math.max(0, seconds)) * s.bpm) / 240);
}

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let s = 0x2468ace;
  for (let i = 0; i < d.length; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    d[i] = ((s >>> 0) / 4294967296) * 2 - 1;
  }
  return buf;
}

/**
 * Schedule a score of `seconds` on `ctx`, starting at `ctx.currentTime +
 * offset`, into `out`. Volume 0–1. Returns the nodes' master gain (so a
 * live preview can fade it out).
 */
export function scheduleMusic(ctx: BaseAudioContext, out: AudioNode, mood: Mood, seconds: number, opts: { seed?: number; volume?: number; offset?: number } = {}): GainNode {
  const score = SCORES[mood];
  const len = Math.min(MAX_MUSIC_SECONDS, Math.max(1, seconds));
  const t0 = ctx.currentTime + (opts.offset ?? 0);
  const rand = rng(opts.seed ?? 1);
  const vol = Math.max(0, Math.min(1, opts.volume ?? 0.7));
  const master = ctx.createGain();
  // Fade in, hold, fade out.
  master.gain.setValueAtTime(0.0001, t0);
  master.gain.linearRampToValueAtTime(0.42 * vol, t0 + Math.min(1.5, len * 0.2));
  master.gain.setValueAtTime(0.42 * vol, t0 + Math.max(0.1, len - Math.min(2.5, len * 0.3)));
  master.gain.linearRampToValueAtTime(0.0001, t0 + len);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.ratio.value = 3;
  master.connect(comp).connect(out);
  // A soft echo gives the dry synth some space.
  const beat = 60 / score.bpm;
  const delay = ctx.createDelay(2);
  delay.delayTime.value = beat * 0.75;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.32;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 2600;
  const send = ctx.createGain();
  send.gain.value = 0.35;
  send.connect(delay);
  delay.connect(tone).connect(feedback).connect(delay);
  tone.connect(master);
  const noise = score.drums !== 'none' ? noiseBuffer(ctx) : null;

  const end = t0 + len;
  const voice = (type: OscillatorType, hz: number, start: number, dur: number, peak: number, attack: number, cutoff: number, wet: boolean, detuneCents = 0): void => {
    if (start >= end) return;
    const stop = Math.min(end, start + dur);
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = hz;
    osc.detune.value = detuneCents;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    const span = stop - start;
    const a = Math.min(attack, span * 0.5);
    const hold = Math.max(start + a, stop - Math.min(0.6, span * 0.4));
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(peak, start + a);
    g.gain.setValueAtTime(peak, hold);
    g.gain.exponentialRampToValueAtTime(0.0001, stop);
    osc.connect(f).connect(g).connect(master);
    if (wet) g.connect(send);
    osc.start(start);
    osc.stop(stop + 0.02);
  };
  const hit = (start: number, dur: number, peak: number, cutoff: number, type: BiquadFilterType): void => {
    if (!noise || start >= end) return;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(f).connect(g).connect(master);
    src.start(start, rand() * 0.3);
    src.stop(start + dur + 0.02);
  };

  const bars = scoreBars(mood, len);
  const barLen = beat * 4;
  const arpOrder = rand() < 0.5 ? [0, 1, 2, 1] : [0, 2, 1, 2];
  for (let b = 0; b < bars; b++) {
    const start = t0 + b * barLen;
    const chord = score.chords[b % score.chords.length] as number[];
    // Pads: two slightly detuned voices per note, overlapping into the next bar.
    for (const n of chord) {
      voice(score.pad, midiHz(n), start, barLen * 1.15, 0.05, barLen * 0.35, score.padCutoff, true, -6);
      voice(score.pad, midiHz(n), start, barLen * 1.15, 0.05, barLen * 0.35, score.padCutoff, true, 6);
    }
    // Bass on beats 1 and 3.
    const root = (chord[0] as number) - 12;
    voice(score.bass, midiHz(root), start, beat * 1.9, 0.16, 0.02, 600, false);
    voice(score.bass, midiHz(root), start + beat * 2, beat * 1.9, 0.13, 0.02, 600, false);
    // Arpeggio in eighths.
    if (score.arp) {
      for (let i = 0; i < 8; i++) {
        const n = (chord[(arpOrder[i % 4] as number) % chord.length] as number) + 12 + (i >= 4 && rand() < 0.3 ? 12 : 0);
        voice(score.arp, midiHz(n), start + i * beat * 0.5, beat * 0.45, score.arp === 'square' ? 0.035 : 0.06, 0.01, score.arp === 'square' ? 2200 : 5000, true);
      }
    }
    if (score.drums === 'taiko') {
      for (const at of [0, 2.5, 3]) {
        voice('sine', 55, start + at * beat, 0.5, 0.35, 0.005, 200, false);
        hit(start + at * beat, 0.25, 0.25, 180, 'lowpass');
      }
    } else if (score.drums === 'hats') {
      for (let i = 0; i < 4; i++) hit(start + (i + 0.5) * beat, 0.05, 0.08, 7000, 'highpass');
      hit(start, 0.12, 0.18, 140, 'lowpass');
      hit(start + beat * 2, 0.12, 0.18, 140, 'lowpass');
    }
    if (score.bells && rand() < 0.7) {
      const n = (chord[Math.floor(rand() * chord.length)] as number) + 24;
      const at = start + Math.floor(rand() * 4) * beat;
      voice('sine', midiHz(n), at, beat * 3, 0.07, 0.005, 9000, true);
      voice('sine', midiHz(n) * 2.76, at, beat * 1.2, 0.015, 0.005, 9000, true);
    }
  }
  return master;
}

/** Render a score offline (stereo, {@link MUSIC_SAMPLE_RATE}). */
export async function renderMusic(mood: Mood, seconds: number, opts: { seed?: number; volume?: number } = {}): Promise<AudioBuffer> {
  const len = Math.min(MAX_MUSIC_SECONDS, Math.max(1, seconds));
  const Ctor = typeof OfflineAudioContext !== 'undefined' ? OfflineAudioContext : null;
  if (!Ctor) throw new Error('this browser cannot render audio');
  const ctx = new Ctor(2, Math.ceil(len * MUSIC_SAMPLE_RATE), MUSIC_SAMPLE_RATE);
  scheduleMusic(ctx, ctx.destination, mood, len, opts);
  return ctx.startRendering();
}

/** A live preview (or the soundtrack of a real-time recording). */
export interface MusicPlayer {
  /** Audio stream of the music (for MediaRecorder), when requested. */
  readonly stream: MediaStream | null;
  stop(): void;
  /** Duck the music by `depth` (0..1) for about `seconds`, then swell back (game-feel hook). */
  duck?(depth: number, seconds: number): void;
}

/** Play a score live; `record` also exposes it as a MediaStream. */
export function playMusic(mood: Mood, seconds: number, opts: { seed?: number; volume?: number; record?: boolean } = {}): MusicPlayer | null {
  const Ctor = typeof AudioContext !== 'undefined' ? AudioContext : null;
  if (!Ctor) return null;
  let ctx: AudioContext;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  const dest = opts.record ? ctx.createMediaStreamDestination() : null;
  const master = scheduleMusic(ctx, dest ?? ctx.destination, mood, seconds, { ...opts, offset: 0.05 });
  if (dest) master.connect(ctx.destination);
  let stopped = false;
  const timer = setTimeout(() => stop(), (Math.min(MAX_MUSIC_SECONDS, seconds) + 0.5) * 1000);
  function stop(): void {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    void ctx.close().catch(() => undefined);
  }
  // A ducking stage after the score's own master, so the score's volume automation is never overwritten.
  const duckGain = ctx.createGain();
  try {
    master.disconnect();
    master.connect(duckGain);
    duckGain.connect(dest ?? ctx.destination);
    if (dest) duckGain.connect(ctx.destination);
  } catch {
    /* keep the direct connection */
  }
  function duck(depth: number, seconds: number): void {
    if (stopped) return;
    const d = Math.max(0, Math.min(0.9, depth));
    const t = ctx.currentTime;
    const g = duckGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(1 - d, t + 0.06);
    g.setValueAtTime(1 - d, t + Math.max(0.05, seconds));
    g.linearRampToValueAtTime(1, t + Math.max(0.05, seconds) + 0.8);
  }
  return { stream: dest ? dest.stream : null, stop, duck };
}
