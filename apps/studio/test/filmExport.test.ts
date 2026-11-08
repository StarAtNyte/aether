import { describe, expect, it } from 'vitest';
import { audioStops, filmFileName, filmFps, filmMuxPlan, filmSeconds, FILM_TAIL_SECONDS, frameSchedule, letterboxBar, RENDER_QUANTUM } from '../src/player/film-schedule';
import { cssEase, wrap } from '../src/player/film-overlay';
import { WebmMuxer } from '../src/publish/video/webm';
import { Mp4Muxer } from '../src/publish/video/mp4';

describe('film frame schedule', () => {
  it('steps a fixed timestep, independent of real time', () => {
    const s = frameSchedule(105.4, 30);
    expect(s.fps).toBe(30);
    expect(s.frames).toBe(3162);
    expect(s.seconds).toBeCloseTo(105.4, 6);
    expect(s.time(0)).toBe(0);
    expect(s.dt(0)).toBe(0);
    expect(s.dt(1)).toBeCloseTo(1 / 30, 12);
    expect(s.time(300)).toBeCloseTo(10, 12);
    // Timestamps land on the frame grid without drift, and the durations add up to the film.
    expect(s.timestampUs(3000)).toBe(100_000_000);
    let sum = 0;
    for (let i = 0; i < s.frames; i++) sum += s.durationUs(i);
    expect(sum).toBe(s.timestampUs(s.frames));
  });

  it('takes 30 or 60 fps only', () => {
    expect(filmFps(60)).toBe(60);
    expect(filmFps(24)).toBe(30);
    expect(filmFps(Number.NaN)).toBe(30);
    expect(frameSchedule(2, 60).frames).toBe(120);
    expect(frameSchedule(0, 30).frames).toBe(1);
  });

  it('keeps the end card tail when the story has one', () => {
    expect(filmSeconds(100, true)).toBeCloseTo(100 + FILM_TAIL_SECONDS, 9);
    expect(filmSeconds(100, false)).toBe(100);
    expect(filmSeconds(-3, false)).toBe(0);
  });

  it('stops the offline audio on render quanta, increasing and inside the film', () => {
    const sr = 48_000;
    const stops = audioStops(10, 1 / 30, sr);
    expect(stops.length).toBe(299);
    const q = RENDER_QUANTUM / sr;
    let last = 0;
    for (const t of stops) {
      expect(t).toBeGreaterThan(last);
      expect(t).toBeLessThan(10);
      expect(Math.abs(t / q - Math.round(t / q))).toBeLessThan(1e-6);
      last = t;
    }
    // Every stop is within half a quantum of its frame time.
    stops.forEach((t, k) => expect(Math.abs(t - (k + 1) / 30)).toBeLessThanOrEqual(q / 2 + 1e-9));
    expect(audioStops(0, 1 / 30, sr)).toEqual([]);
    expect(audioStops(1, 0, sr)).toEqual([]);
  });
});

describe('film mux setup', () => {
  it('puts H.264 in MP4 and VP9 in WebM, Opus in both', () => {
    expect(filmMuxPlan({ container: 'mp4', codec: 'avc1.64002a' }, true)).toEqual({ container: 'mp4', ext: 'mp4', mime: 'video/mp4', audio: 'opus', type: 'video/mp4; codecs="avc1.64002a, opus"' });
    expect(filmMuxPlan({ container: 'webm', codec: 'vp09.00.41.08' }, false)).toEqual({ container: 'webm', ext: 'webm', mime: 'video/webm', audio: null, type: 'video/webm; codecs="vp09.00.41.08"' });
  });

  it('muxes a schedule\'s frames with the film\'s sound at 48 kHz', () => {
    const s = frameSchedule(1, 30);
    const webm = new WebmMuxer({ codec: 'V_VP9', width: 1920, height: 1080, frameRate: 30 }, { sampleRate: 48_000, channels: 2, preSkip: 312 });
    const avcC = new Uint8Array([1, 0x64, 0, 0x2a, 0xff, 0xe0, 0]);
    const mp4 = new Mp4Muxer({ width: 1920, height: 1080, avcC, frameRate: 30 }, { sampleRate: 48_000, channels: 2, preSkip: 312 });
    for (let i = 0; i < s.frames; i++) {
      const c = { timestampUs: s.timestampUs(i), durationUs: s.durationUs(i), key: i === 0, data: new Uint8Array([i & 255, 1, 2, 3]) };
      webm.addVideo(c);
      mp4.addVideo(c);
    }
    for (let k = 0; k < 50; k++) {
      const a = { timestampUs: k * 20_000, durationUs: 20_000, key: true, data: new Uint8Array([0xfc, k]) };
      webm.addAudio(a);
      mp4.addAudio(a);
    }
    const w = webm.finalize(1_000_000);
    expect([...w.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
    expect(new TextDecoder().decode(w).includes('A_OPUS')).toBe(true);
    const m = mp4.finalize();
    const text = new TextDecoder('latin1').decode(m);
    expect(text.slice(4, 8)).toBe('ftyp');
    expect(text.includes('Opus') && text.includes('avc1')).toBe(true);
  });
});

describe('film overlay', () => {
  it('sizes the bars of a 2.39:1 frame by the story amount', () => {
    expect(letterboxBar(1920, 1080, 1)).toBeCloseTo((1080 - 1920 / 2.39) / 2, 6);
    expect(letterboxBar(1920, 1080, 0.5)).toBeCloseTo((1080 - 1920 / 2.39) / 4, 6);
    expect(letterboxBar(1000, 300, 1)).toBe(0);
  });

  it('eases its entrances like CSS ease', () => {
    expect(cssEase(0)).toBe(0);
    expect(cssEase(1)).toBe(1);
    expect(cssEase(0.5)).toBeCloseTo(0.8024, 3);
    expect(cssEase(2)).toBe(1);
  });

  it('wraps captions by width', () => {
    expect(wrap('one two three four', 9, (s) => s.length)).toEqual(['one two', 'three', 'four']);
    expect(wrap('', 10, (s) => s.length)).toEqual([]);
  });

  it('names the file', () => {
    expect(filmFileName('Two Whistles', 30, 'mp4')).toBe('two-whistles-film-30fps.mp4');
    expect(filmFileName('', 60, 'webm')).toBe('film-film-60fps.webm');
  });
});
