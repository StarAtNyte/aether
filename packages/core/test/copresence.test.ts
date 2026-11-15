import { describe, expect, it } from 'vitest';
import {
  COPRESENCE_MAX_FRAME_BYTES,
  COPRESENCE_MAX_SIGNAL_BYTES,
  HEADING_STEPS,
  VOICE_MAX_TALKERS,
  VOICE_SDP_MAX,
  maxMessageBytes,
  utf8Length,
  PRESENCE_HUES,
  ROOM_ID_RE,
  cleanPresenceText,
  dequantiseState,
  headingSteps,
  newRoomId,
  parsePresence,
  parseRelayFrame,
  peerHue,
  presenceColours,
  quantiseState,
  sameState,
} from '../src/copresence';

describe('shared visits protocol', () => {
  it('quantises a pose to centimetres, 1/1024 turns and a motion index, and back', () => {
    const s = quantiseState({ position: [12.3456, -0.004, 1000.5], yawDeg: 90, motion: 'walk' }, 1234.7);
    expect(s).toEqual({ v: 1, t: 'state', ts: 1234, p: [1235, 0, 100050], h: 256, m: 1 });
    expect(parsePresence(JSON.stringify(s))).toEqual(s);
    const back = dequantiseState(s);
    expect(back.position).toEqual([12.35, 0, 1000.5]);
    expect(back.yawDeg).toBe(90);
    expect(back.motion).toBe('walk');
  });

  it('wraps headings into one turn and clamps far coordinates', () => {
    expect(headingSteps(-90)).toBe(768);
    expect(headingSteps(720 + 45)).toBe(128);
    expect(headingSteps(359.9)).toBe(0);
    expect(headingSteps(Number.NaN)).toBe(0);
    for (const y of [-1e6, -1, 0, 1, 179.9, 1e6]) expect(headingSteps(y)).toBeLessThan(HEADING_STEPS);
    const far = quantiseState({ position: [1e9, Number.NaN, -1e9], yawDeg: 0, motion: 'run' }, 2 ** 31 + 5);
    expect(far.p).toEqual([10_000_000, 0, -10_000_000]);
    expect(far.ts).toBe(5);
    expect(parsePresence(far)).not.toBeNull();
  });

  it('compares states without the clock', () => {
    const a = quantiseState({ position: [1, 2, 3], yawDeg: 10, motion: 'idle' }, 1);
    expect(sameState(a, { ...a, ts: 99 })).toBe(true);
    expect(sameState(a, { ...a, h: a.h + 1 })).toBe(false);
    expect(sameState(null, a)).toBe(false);
  });

  it('accepts the four messages and nothing else', () => {
    expect(parsePresence({ v: 1, t: 'hello', name: 'Misty Ibex', body: 'mio-vrm' })).not.toBeNull();
    // An optional outfit hue in whole degrees.
    expect(parsePresence({ v: 1, t: 'hello', name: 'Misty Ibex', body: 'mio-vrm', tint: 0 })).not.toBeNull();
    expect(parsePresence({ v: 1, t: 'hello', name: 'Misty Ibex', body: 'mio-vrm', tint: 359 })).toEqual({ v: 1, t: 'hello', name: 'Misty Ibex', body: 'mio-vrm', tint: 359 });
    expect(parsePresence({ v: 1, t: 'chat', text: 'namaste' })).not.toBeNull();
    expect(parsePresence({ v: 1, t: 'bye' })).not.toBeNull();
    for (const bad of [
      null,
      'x',
      '{',
      { v: 2, t: 'bye' },
      { v: 1, t: 'shout' },
      { v: 1, t: 'bye', extra: 1 },
      { v: 1, t: 'hello', name: '', body: 'kaho-vrm' },
      { v: 1, t: 'hello', name: ' padded ', body: 'kaho-vrm' },
      { v: 1, t: 'hello', name: 'evil‮', body: 'kaho-vrm' },
      { v: 1, t: 'hello', name: 'x'.repeat(25), body: 'kaho-vrm' },
      { v: 1, t: 'hello', name: 'Ada', body: 'kaho-vrm', tint: 360 },
      { v: 1, t: 'hello', name: 'Ada', body: 'kaho-vrm', tint: -1 },
      { v: 1, t: 'hello', name: 'Ada', body: 'kaho-vrm', tint: 12.5 },
      { v: 1, t: 'hello', name: 'Ada', body: 'kaho-vrm', tint: '210' },
      { v: 1, t: 'chat', text: 'x'.repeat(201) },
      { v: 1, t: 'state', ts: 1, p: [0.5, 0, 0], h: 0, m: 0 },
      { v: 1, t: 'state', ts: 1, p: [0, 0, 0], h: 1024, m: 0 },
      { v: 1, t: 'state', ts: 1, p: [0, 0, 0], h: 0, m: 3 },
      'x'.repeat(COPRESENCE_MAX_FRAME_BYTES + 1),
    ])
      expect(parsePresence(bad), JSON.stringify(bad)?.slice(0, 60)).toBeNull();
  });

  it('accepts voice signalling addressed to one peer, strictly, and lets only it be larger than 1 KB', () => {
    const sdp = `v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n${'a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level\r\n'.repeat(55)}`;
    const offer = { v: 1, t: 'rtc', to: 'peerbbbb01', k: 'offer', sdp };
    expect(JSON.stringify(offer).length).toBeGreaterThan(COPRESENCE_MAX_FRAME_BYTES);
    expect(parsePresence(JSON.stringify(offer))).toEqual(offer);
    expect(parsePresence({ ...offer, k: 'answer' })).not.toBeNull();
    expect(parsePresence({ v: 1, t: 'rtc', to: 'peerbbbb01', k: 'ice', c: 'candidate:842163049 1 udp 1677729535 1.2.3.4 61003 typ srflx raddr 0.0.0.0 rport 0', mid: '0', i: 0 })).not.toBeNull();
    expect(parsePresence({ v: 1, t: 'rtc', to: 'peerbbbb01', k: 'busy' })).not.toBeNull();
    expect(parsePresence({ v: 1, t: 'rtc', to: 'peerbbbb01', k: 'end' })).not.toBeNull();
    expect(parsePresence({ v: 1, t: 'voice', on: true })).not.toBeNull();
    for (const bad of [
      { v: 1, t: 'rtc', k: 'offer', sdp }, // no addressee
      { v: 1, t: 'rtc', to: 'NOT A PEER', k: 'offer', sdp },
      { ...offer, from: 'peeraaaa01' },
      { ...offer, k: 'pranswer' },
      { ...offer, sdp: 'hello' }, // not a description
      { ...offer, sdp: 'v=0\r\n<script>\u0000' },
      { ...offer, sdp: `v=0\r\n${'a'.repeat(VOICE_SDP_MAX)}` },
      { v: 1, t: 'rtc', to: 'peerbbbb01', k: 'ice', c: 'not a candidate', mid: '0', i: 0 },
      { v: 1, t: 'rtc', to: 'peerbbbb01', k: 'ice', c: `candidate:${'x'.repeat(600)}`, mid: '0', i: 0 },
      { v: 1, t: 'rtc', to: 'peerbbbb01', k: 'ice', c: 'candidate:1', mid: 'a b', i: 0 },
      { v: 1, t: 'rtc', to: 'peerbbbb01', k: 'ice', c: 'candidate:1', mid: '0', i: 64 },
      { v: 1, t: 'rtc', to: 'peerbbbb01', k: 'busy', sdp },
      { v: 1, t: 'voice', on: 'yes' },
      { v: 1, t: 'voice' },
    ])
      expect(parsePresence(bad), JSON.stringify(bad).slice(0, 80)).toBeNull();
    // Size by kind: only rtc may pass 1 KB, and nothing passes 8 KB.
    expect(maxMessageBytes('rtc')).toBe(COPRESENCE_MAX_SIGNAL_BYTES);
    expect(maxMessageBytes('chat')).toBe(COPRESENCE_MAX_FRAME_BYTES);
    expect(parsePresence(`{"v":1,"t":"voice","on":true}${' '.repeat(COPRESENCE_MAX_FRAME_BYTES)}`)).toBeNull();
    expect(parsePresence(JSON.stringify(offer).padEnd(COPRESENCE_MAX_SIGNAL_BYTES + 1, ' '))).toBeNull();
    expect(utf8Length('aü€😀')).toBe(1 + 2 + 3 + 4);
    // A relay frame carrying an offer parses.
    expect(parseRelayFrame(JSON.stringify({ k: 'msg', from: 'peeraaaa01', m: offer }))).not.toBeNull();
    expect(VOICE_MAX_TALKERS).toBe(8);
  });

  it('cleans names and chat lines', () => {
    expect(cleanPresenceText('  a\u0000b​  \n c ', 24)).toBe('ab c');
    expect(cleanPresenceText('x'.repeat(40), 24)).toHaveLength(24);
  });

  it('parses relay frames', () => {
    expect(parseRelayFrame('{"k":"welcome","v":1,"id":"abcdef123456","peers":[]}')).toEqual({ k: 'welcome', v: 1, id: 'abcdef123456', peers: [] });
    expect(parseRelayFrame('{"k":"msg","from":"abcdef123456","m":{"v":1,"t":"bye"}}')).not.toBeNull();
    expect(parseRelayFrame('{"k":"msg","from":"NOPE","m":{"v":1,"t":"bye"}}')).toBeNull();
    expect(parseRelayFrame('{"k":"error","code":"full"}')).toEqual({ k: 'error', code: 'full' });
  });

  it('makes valid room ids', () => {
    let seed = 1;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < 50; i++) expect(newRoomId(rnd)).toMatch(ROOM_ID_RE);
  });

  it('gives every peer id a stable hue, spread round the wheel', () => {
    const ids = Array.from({ length: 200 }, (_, i) => newRoomId(((seed) => () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31))(i + 1)).slice(0, 8));
    for (const id of ids) {
      const h = peerHue(id);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
      expect(peerHue(id)).toBe(h);
    }
    // Spread: every 60-degree sector of the wheel gets some of 200 ids, none more than a third.
    const sectors = new Array(6).fill(0) as number[];
    for (const id of ids) sectors[Math.floor(peerHue(id) / 60)]!++;
    for (const n of sectors) {
      expect(n).toBeGreaterThan(10);
      expect(n).toBeLessThan(70);
    }
    expect(peerHue('abcdef01')).not.toBe(peerHue('abcdef02'));
  });

  it('turns a hue into top, bottom and hair colours of that hue', () => {
    const hex = /^#[0-9a-f]{6}$/;
    const rgb = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    for (const h of [...PRESENCE_HUES, 359, 720, -30]) {
      const c = presenceColours(h);
      expect(c.top).toMatch(hex);
      expect(c.bottom).toMatch(hex);
      expect(c.hair).toMatch(hex);
      // The top is lighter than the bottom.
      expect(rgb(c.top).reduce((a, b) => a + b)).toBeGreaterThan(rgb(c.bottom).reduce((a, b) => a + b));
    }
    expect(presenceColours(0).top).toBe('#da6262');
    const [r, g, b] = rgb(presenceColours(210).top);
    expect(b).toBeGreaterThan(r!);
    expect(b).toBeGreaterThan(g!);
    expect(presenceColours(720)).toEqual(presenceColours(0));
    expect(presenceColours(-30)).toEqual(presenceColours(330));
    expect(presenceColours(Number.NaN)).toEqual(presenceColours(0));
  });
});
