import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld } from '../src';
import { Environment } from '../src/schema';

describe('Environment.look', () => {
  it('is optional, so every older document still parses and has no look', () => {
    expect(Environment.parse({}).look).toBeUndefined();
  });

  it('takes partial, bounded fields', () => {
    expect(Environment.parse({ look: { interiorWarmth: 0.8, foliageTint: '#ffd9a0' } }).look).toEqual({ interiorWarmth: 0.8, foliageTint: '#ffd9a0' });
    expect(Environment.safeParse({ look: { interiorWarmth: 5 } }).success).toBe(false);
    expect(Environment.safeParse({ look: { vignette: 2 } }).success).toBe(false);
    expect(Environment.safeParse({ look: { lampStrength: -1 } }).success).toBe(false);
    expect(Environment.safeParse({ look: { sunTint: 'orange' } }).success).toBe(false);
    expect(Environment.safeParse({ look: { vignette: Number.NaN } }).success).toBe(false);
  });

  it('merges through setEnvironment and a null drops one field back to the renderer default', () => {
    let w = createWorld();
    w = applyPatches(w, [{ op: 'setEnvironment', set: { look: { interiorWarmth: 0.8, vignette: 0.5 } } }]).world;
    w = applyPatches(w, [{ op: 'setEnvironment', set: { look: { vignette: 0.1, interiorWarmth: null } } }]).world;
    expect(w.environment.look).toEqual({ vignette: 0.1 });
  });
});
