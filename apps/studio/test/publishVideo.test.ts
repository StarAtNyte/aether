import { afterEach, describe, expect, it } from 'vitest';
import { chooseVideoCodec, evenSize, h264Candidates, videoBitrate, VIDEO_LIMITS } from '../src/publish/video/export';
import { letterboxBar, overlayAt } from '../src/publish/video/titles';
import { midiHz, musicSeed, scoreBars, MAX_MUSIC_SECONDS } from '../src/publish/video/music';
import { isLocalUrl, normalizePlayerBase } from '../src/engine/publish';

const g = globalThis as Record<string, unknown>;
afterEach(() => {
  delete g['VideoEncoder'];
  delete g['VideoFrame'];
});

function fakeEncoder(supported: (codec: string) => boolean): void {
  g['VideoFrame'] = class {};
  g['VideoEncoder'] = { isConfigSupported: async (c: { codec: string }) => ({ supported: supported(c.codec) }) };
}

describe('video codec choice', () => {
  it('needs WebCodecs (else the MediaRecorder fallback runs)', async () => {
    expect(await chooseVideoCodec(1280, 720, 30, 'auto')).toBeNull();
  });

  it('prefers MP4 only where the browser can also play it back', async () => {
    fakeEncoder(() => true);
    expect(await chooseVideoCodec(1280, 720, 30, 'auto', () => true)).toMatchObject({ container: 'mp4', codec: 'avc1.64001f' });
    // A browser with an H.264 encoder but no decoder: WebM is the playable choice.
    expect(await chooseVideoCodec(1280, 720, 30, 'auto', () => false)).toMatchObject({ container: 'webm', id: 'V_VP9' });
    expect(await chooseVideoCodec(1920, 1080, 30, 'mp4', () => false)).toMatchObject({ container: 'mp4', codec: 'avc1.64002a' });
    expect(await chooseVideoCodec(1920, 1080, 30, 'webm')).toMatchObject({ container: 'webm' });
  });

  it('falls back across codecs and containers', async () => {
    fakeEncoder((c) => c === 'vp8');
    expect(await chooseVideoCodec(640, 360, 24, 'mp4')).toMatchObject({ container: 'webm', id: 'V_VP8' });
    fakeEncoder(() => false);
    expect(await chooseVideoCodec(640, 360, 24, 'auto')).toBeNull();
  });

  it('sizes, levels and bitrates', () => {
    expect(evenSize(1081)).toBe(1080);
    expect(evenSize(99999)).toBe(VIDEO_LIMITS.maxSide);
    expect(evenSize(Number.NaN)).toBe(1280);
    expect(h264Candidates(1280, 720)[0]).toBe('avc1.64001f');
    expect(h264Candidates(1920, 1080)[0]).toBe('avc1.64002a');
    expect(videoBitrate(1920, 1080, 30)).toBeGreaterThan(5_000_000);
    expect(videoBitrate(16, 16, 24)).toBe(1_500_000);
  });
});

describe('title cards', () => {
  const spec = { title: 'Coin Island', endText: 'Made with Aether', fades: true };
  it('fades the title in and out, the end card in, and the frame from / to black', () => {
    expect(overlayAt(0, 10, spec).black).toBe(1);
    expect(overlayAt(0.3, 10, spec).black).toBeLessThan(1);
    expect(overlayAt(2, 10, spec).title).toBe(1);
    expect(overlayAt(5, 10, spec).title).toBe(0);
    expect(overlayAt(9.5, 10, spec).end).toBe(1);
    expect(overlayAt(10, 10, spec).black).toBe(1);
    expect(overlayAt(2, 10, { ...spec, title: ' ' }).title).toBe(0);
    expect(overlayAt(5, 10, { ...spec, fades: false }).black).toBe(0);
    // Short clips keep the title within 45 % of the clip.
    expect(overlayAt(0.8, 1.5, spec).title).toBe(0);
  });

  it('letterboxes to 2.39:1 only when the frame is taller', () => {
    expect(letterboxBar(1920, 1080)).toBe(138);
    expect(letterboxBar(2390, 1000)).toBe(0);
  });
});

describe('soundtrack', () => {
  it('is bounded and deterministic', () => {
    expect(scoreBars('calm', 60)).toBe(18);
    expect(scoreBars('playful', 1e9)).toBe(Math.ceil((MAX_MUSIC_SECONDS * 112) / 240));
    expect(musicSeed('a')).toBe(musicSeed('a'));
    expect(musicSeed('a')).not.toBe(musicSeed('b'));
    expect(midiHz(69)).toBe(440);
  });
});

describe('player address of share links', () => {
  it('accepts hosted https studios and normalizes to /play', () => {
    expect(normalizePlayerBase('aether.example.org')).toBe('https://aether.example.org/play');
    expect(normalizePlayerBase('https://x.example/sub/play/')).toBe('https://x.example/sub/play');
    expect(normalizePlayerBase('http://localhost:4280')).toBe('http://localhost:4280/play');
    for (const bad of ['http://x.example', 'javascript:alert(1)', 'https://u:p@x.example', 'https://x.example/a b', 'ftp://x.example', '']) expect(normalizePlayerBase(bad), bad).toBeNull();
    expect(isLocalUrl('http://127.0.0.1:4280/play')).toBe(true);
    expect(isLocalUrl('http://192.168.1.4/play')).toBe(true);
    expect(isLocalUrl('https://aether.example.org/play')).toBe(false);
  });
});
