import { describe, expect, it } from 'vitest';
import {
  COPRESENCE_MAX_FRAME_BYTES,
  HEADING_STEPS,
  ROOM_ID_RE,
  cleanPresenceText,
  dequantiseState,
  headingSteps,
  newRoomId,
  parsePresence,
  parseRelayFrame,
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
      { v: 1, t: 'chat', text: 'x'.repeat(201) },
      { v: 1, t: 'state', ts: 1, p: [0.5, 0, 0], h: 0, m: 0 },
      { v: 1, t: 'state', ts: 1, p: [0, 0, 0], h: 1024, m: 0 },
      { v: 1, t: 'state', ts: 1, p: [0, 0, 0], h: 0, m: 3 },
      'x'.repeat(COPRESENCE_MAX_FRAME_BYTES + 1),
    ])
      expect(parsePresence(bad), JSON.stringify(bad)?.slice(0, 60)).toBeNull();
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
});
