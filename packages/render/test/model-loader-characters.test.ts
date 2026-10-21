import { describe, expect, it } from 'vitest';
import { CHARACTER_FILE } from '../src/geometry/model-loader';

describe('character files skip the KTX2 twin', () => {
  it('matches bodies and motion sets of the library', () => {
    expect(CHARACTER_FILE.test('/assets/lib/c/tomas.bab0c4aa.glb')).toBe(true);
    expect(CHARACTER_FILE.test('/assets/lib/c/motions-male.81d7d7b9.glb')).toBe(true);
  });
  it('leaves props, animals and uploads alone', () => {
    expect(CHARACTER_FILE.test('/assets/lib/m/deer.ca0c5bb7.glb')).toBe(false);
    expect(CHARACTER_FILE.test('/assets/lib/k/tomas.031dccc1.glb')).toBe(false);
    expect(CHARACTER_FILE.test('/assets/lib/m/c.glb')).toBe(false);
  });
});
