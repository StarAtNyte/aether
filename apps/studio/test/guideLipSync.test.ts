/**
 * The guide's lip sync (player/guide/lipsync.ts): loudness, gate, smoothing and mapping on synthetic waveforms, a clip's
 * mouth envelope from a decoded-buffer stand-in and its lookup by time, the fallback syllables and their timing, and the
 * controller with fake elements (no Web Audio in the tests).
 */
import { describe, expect, it } from 'vitest';
import {
  ATTACK_S,
  envelope,
  envelopeAt,
  FRAME_S,
  GATE_RMS,
  gateLevel,
  GuideLipSync,
  mouthEnvelope,
  mouthFor,
  type PcmLike,
  RELEASE_S,
  rms,
  syllableMouth,
  SYLLABLE_HZ,
  zeroCrossRate,
} from '../src/player/guide/lipsync';

const RATE = 48_000;
const sine = (hz: number, amp: number, n = 1024): Float32Array => {
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) b[i] = amp * Math.sin((2 * Math.PI * hz * i) / RATE);
  return b;
};

describe('loudness', () => {
  it('rms of a sine is amp / sqrt 2, of silence 0', () => {
    expect(rms(sine(200, 0.5, 4800))).toBeCloseTo(0.5 / Math.SQRT2, 2);
    expect(rms(new Float32Array(1024))).toBe(0);
    expect(rms(new Float32Array(0))).toBe(0);
  });

  it('zero-crossing rate grows with pitch', () => {
    const low = zeroCrossRate(sine(150, 0.3));
    const high = zeroCrossRate(sine(6000, 0.3));
    expect(low).toBeCloseTo((2 * 150) / RATE, 2);
    expect(high).toBeGreaterThan(0.2);
  });

  it('rms and crossings read a slice without copying', () => {
    const b = new Float32Array([0, 0, 1, -1, 1, -1, 0, 0]);
    expect(rms(b, 2, 6)).toBe(1);
    expect(zeroCrossRate(b, 2, 6)).toBe(1);
  });

  it('the gate shuts quiet noise and opens speech fully at the peak', () => {
    expect(gateLevel(GATE_RMS * 0.9, 0.1)).toBe(0);
    expect(gateLevel(0.1, 0.1)).toBe(1);
    const mid = gateLevel(0.05, 0.1);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(1);
  });

  it('round vowels open more than bright sounds; the result stays in 0..1', () => {
    expect(mouthFor(1, 400)).toBe(1);
    expect(mouthFor(1, 12_000)).toBeCloseTo(0.65, 5);
    expect(mouthFor(2, 0)).toBe(1);
    expect(mouthFor(-1, 0)).toBe(0);
  });
});

/** A decoded clip stand-in: `parts` of [seconds, hz, amplitude] one after the other (0 Hz: silence). */
const clip = (rate: number, parts: Array<[number, number, number]>): PcmLike => {
  const n = parts.reduce((s, [sec]) => s + Math.round(sec * rate), 0);
  const d = new Float32Array(n);
  let o = 0;
  for (const [sec, hz, amp] of parts) {
    const m = Math.round(sec * rate);
    for (let i = 0; i < m; i++) d[o + i] = hz > 0 ? amp * Math.sin((2 * Math.PI * hz * i) / rate) : 0;
    o += m;
  }
  return { sampleRate: rate, numberOfChannels: 1, length: n, getChannelData: () => d };
};

describe('clip envelope', () => {
  it('one value per frame: closed in silence, open in a voiced vowel, less open in hiss', () => {
    const env = mouthEnvelope(clip(22_050, [[0.5, 0, 0], [0.5, 220, 0.3], [0.5, 0, 0], [0.5, 5000, 0.3]]));
    expect(env.length).toBeCloseTo(2 / FRAME_S, -1);
    expect(envelopeAt(env, 0.25)).toBe(0);
    expect(envelopeAt(env, 0.75)).toBeGreaterThan(0.9);
    expect(envelopeAt(env, 1.25)).toBe(0);
    const hiss = envelopeAt(env, 1.75);
    expect(hiss).toBeGreaterThan(0.4);
    expect(hiss).toBeLessThan(envelopeAt(env, 0.75));
  });

  it('a quiet recording still opens the mouth at its loudest (gated against its own level)', () => {
    const env = mouthEnvelope(clip(22_050, [[0.4, 0, 0], [0.6, 180, 0.04]]));
    expect(envelopeAt(env, 0.7)).toBeGreaterThan(0.9);
    expect(envelopeAt(env, 0.2)).toBe(0);
  });

  it('lookup by time: outside the clip is closed', () => {
    const env = new Float32Array([0.2, 0.4, 0.6]);
    expect(envelopeAt(env, 0)).toBeCloseTo(0.2);
    expect(envelopeAt(env, FRAME_S * 1.5)).toBeCloseTo(0.4);
    expect(envelopeAt(env, FRAME_S * 3.5)).toBe(0);
    expect(envelopeAt(env, -1)).toBe(0);
    expect(envelopeAt(env, NaN)).toBe(0);
  });
});

describe('envelope', () => {
  it('opens in about the attack time and closes slower', () => {
    let up = 0;
    for (let t = 0; t < ATTACK_S; t += 1 / 120) up = envelope(up, 1, 1 / 120);
    expect(up).toBeGreaterThan(0.55);
    expect(up).toBeLessThan(0.75);
    let down = 1;
    for (let t = 0; t < ATTACK_S; t += 1 / 120) down = envelope(down, 0, 1 / 120);
    expect(down).toBeGreaterThan(1 - up);
    expect(RELEASE_S).toBeGreaterThan(ATTACK_S);
  });

  it('does not depend on the frame rate', () => {
    let a = 0;
    for (let i = 0; i < 6; i++) a = envelope(a, 1, 1 / 60);
    let b = 0;
    for (let i = 0; i < 18; i++) b = envelope(b, 1, 1 / 180);
    expect(a).toBeCloseTo(b, 6);
  });
});

describe('fallback syllables', () => {
  it('is closed outside the line and moves inside it within 0..1', () => {
    expect(syllableMouth(-0.1, 3)).toBe(0);
    expect(syllableMouth(3.1, 3)).toBe(0);
    let max = 0;
    for (let t = 0; t < 3; t += 0.005) {
      const m = syllableMouth(t, 3, 42);
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThanOrEqual(1);
      max = Math.max(max, m);
    }
    expect(max).toBeGreaterThan(0.4);
  });

  it('opens about 4-5 times a second', () => {
    const len = 10;
    let opens = 0;
    let wasOpen = false;
    for (let t = 0; t < len; t += 0.002) {
      const open = syllableMouth(t, len, 7) > 0.05;
      if (open && !wasOpen) opens++;
      wasOpen = open;
    }
    const hz = opens / len;
    expect(hz).toBeGreaterThan(SYLLABLE_HZ * 0.6);
    expect(hz).toBeLessThan(SYLLABLE_HZ * 1.15);
  });

  it('varies from syllable to syllable', () => {
    const peaks = new Set<number>();
    for (let i = 0; i < 12; i++) {
      let p = 0;
      for (let u = 0; u < 1; u += 0.02) p = Math.max(p, syllableMouth(1 + (i + u) / SYLLABLE_HZ, 20, 3));
      peaks.add(Math.round(p * 20));
    }
    expect(peaks.size).toBeGreaterThan(3);
  });
});

/** A stand-in for a playing element (no Web Audio in the test environment). */
const fakeAudio = (o: Partial<{ paused: boolean; ended: boolean; duration: number; currentTime: number; src: string }>): HTMLAudioElement =>
  ({ paused: false, ended: false, duration: NaN, currentTime: 0, src: '', ...o }) as unknown as HTMLAudioElement;

const run = (lips: GuideLipSync, fromMs: number, toMs: number): { max: number; last: number } => {
  let max = 0;
  let last = 0;
  for (let t = fromMs; t <= toMs; t += 1000 / 60) {
    last = lips.update(1 / 60, t);
    max = Math.max(max, last);
  }
  return { max, last };
};

describe('GuideLipSync', () => {
  it('a measured clip drives the mouth by its envelope at the element\'s current time', () => {
    const lips = new GuideLipSync();
    const url = 'http://localhost/templates/voices/x/0000abcd.mp3';
    const env = new Float32Array(120);
    env.fill(0.9, 30, 60);
    lips.store(url, env);
    expect(lips.ready(url)).toBe(true);
    const a = fakeAudio({ src: url, duration: 2 });
    lips.line('A line.', a, 2, 0);
    // Silent part: stays closed (no syllables when the clip is measured).
    expect(run(lips, 0, 300).max).toBe(0);
    (a as unknown as { currentTime: number }).currentTime = 0.75;
    expect(run(lips, 300, 500).last).toBeGreaterThan(0.85);
    (a as unknown as { currentTime: number }).currentTime = 1.5;
    expect(run(lips, 500, 900).last).toBe(0);
  });

  it('keeps only a few envelopes, the newest', () => {
    const lips = new GuideLipSync();
    for (let i = 0; i < 10; i++) lips.store(`u${i}`, new Float32Array(1));
    expect(lips.ready('u0')).toBe(false);
    expect(lips.ready('u9')).toBe(true);
    lips.store('u5', new Float32Array(1));
    lips.store('u10', new Float32Array(1));
    expect(lips.ready('u5')).toBe(true);
  });

  it('a line without a recording moves for its reading time, then rests', () => {
    const lips = new GuideLipSync();
    lips.line('Welcome to the hall.', null, 2, 1000);
    expect(run(lips, 1000, 2900).max).toBeGreaterThan(0.3);
    expect(run(lips, 2900, 3600).last).toBe(0);
  });

  it('a playing recording not measured (yet) moves while it plays and rests once it ends', () => {
    const lips = new GuideLipSync();
    const a = fakeAudio({ duration: 1.5 });
    lips.line('This way.', a, 0.5, 0);
    expect(run(lips, 0, 1200).max).toBeGreaterThan(0.3);
    (a as unknown as { ended: boolean }).ended = true;
    expect(run(lips, 1200, 1800).last).toBe(0);
  });

  it('a refused recording falls back to its length', () => {
    const lips = new GuideLipSync();
    lips.line('Hello again! How can I help?', fakeAudio({ paused: true, duration: 1 }), 3, 0);
    expect(run(lips, 0, 900).max).toBeGreaterThan(0.3);
    expect(run(lips, 900, 1600).last).toBe(0);
  });

  it('stop (muted) closes the mouth', () => {
    const lips = new GuideLipSync();
    lips.line('A long line about rugs and their weaving.', null, 5, 0);
    run(lips, 0, 1000);
    lips.stop();
    expect(run(lips, 1000, 1400).last).toBe(0);
    lips.dispose();
    expect(lips.value).toBe(0);
  });
});
