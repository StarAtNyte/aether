import { describe, expect, it } from 'vitest';
import { clipWords } from '../src/lib/format';

describe('clipWords', () => {
  it('keeps short text', () => {
    expect(clipWords('a cozy camp', 34)).toBe('a cozy camp');
  });
  it('cuts at a word boundary and trims trailing punctuation', () => {
    expect(clipWords('a coin collecting game on a tropical island — collect', 34)).toBe('a coin collecting game on a…');
    expect(clipWords('bowling alley: knock down a pyramid', 15)).toBe('bowling alley…');
  });
  it('hard-cuts a single long word', () => {
    expect(clipWords('supercalifragilistic', 8)).toBe('supercal…');
  });
});
