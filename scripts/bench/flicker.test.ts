import { describe, expect, it } from 'vitest';
import { orbitFlicker, stillFlicker } from './flicker';

const frame = (v: number): Uint8Array => new Uint8Array(16).fill(v);

describe('flicker scores', () => {
  it('a steady linear change scores zero, a flicker does not', () => {
    expect(orbitFlicker([frame(10), frame(20), frame(30), frame(40)])).toBe(0);
    expect(orbitFlicker([frame(10), frame(30), frame(10), frame(30)])).toBeGreaterThan(10);
  });
  it('two identical frames score zero', () => {
    expect(stillFlicker(frame(5), frame(5))).toBe(0);
    expect(stillFlicker(frame(5), frame(9))).toBe(4);
  });
});
