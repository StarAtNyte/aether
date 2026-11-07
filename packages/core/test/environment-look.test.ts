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

  it('takes an opt-in presentation style (anime), absent for every realistic world', () => {
    expect(Environment.parse({ look: { style: 'anime' } }).look).toEqual({ style: 'anime' });
    expect(Environment.parse({ look: { vignette: 0.2 } }).look?.style).toBeUndefined();
    expect(Environment.safeParse({ look: { style: 'cartoon' } }).success).toBe(false);
  });

  it('takes bounded compositing-layer defaults (satsuei), all optional', () => {
    const satsuei = { diffusion: 0.4, godRays: 0.3, flare: 0.2, dust: 0.25, grain: 0.3, chroma: 0.2, gradientTop: '#ffd9b0', gradientBottom: '#6a5a9a', gradientAmount: 0.15, letterbox: 0, sunDirection: [-0.55, 0.1, 0.83] };
    expect(Environment.parse({ look: { style: 'anime', satsuei } }).look?.satsuei).toEqual(satsuei);
    expect(Environment.parse({ look: { style: 'anime', satsuei: {} } }).look?.satsuei).toEqual({});
    expect(Environment.parse({ look: { style: 'anime' } }).look?.satsuei).toBeUndefined();
    expect(Environment.safeParse({ look: { satsuei: { godRays: 1.5 } } }).success).toBe(false);
    expect(Environment.safeParse({ look: { satsuei: { dust: -0.1 } } }).success).toBe(false);
    expect(Environment.safeParse({ look: { satsuei: { gradientTop: 'peach' } } }).success).toBe(false);
    expect(Environment.safeParse({ look: { satsuei: { sunDirection: [0, 1] } } }).success).toBe(false);
  });

  it('merges through setEnvironment and a null drops one field back to the renderer default', () => {
    let w = createWorld();
    w = applyPatches(w, [{ op: 'setEnvironment', set: { look: { interiorWarmth: 0.8, vignette: 0.5 } } }]).world;
    w = applyPatches(w, [{ op: 'setEnvironment', set: { look: { vignette: 0.1, interiorWarmth: null } } }]).world;
    expect(w.environment.look).toEqual({ vignette: 0.1 });
  });
});

describe('Environment.lightBake', () => {
  it('is optional, bounded and replaceable through setEnvironment', () => {
    expect(Environment.parse({}).lightBake).toBeUndefined();
    expect(Environment.parse({ lightBake: { quality: 'high', samples: 128 } }).lightBake).toEqual({ quality: 'high', samples: 128 });
    expect(Environment.safeParse({ lightBake: { quality: 'ultra' } }).success).toBe(false);
    expect(Environment.safeParse({ lightBake: { quality: 'low', samples: 4 } }).success).toBe(false);
    expect(Environment.safeParse({ lightBake: { quality: 'low', samples: 600 } }).success).toBe(false);
    let w = createWorld();
    w = applyPatches(w, [{ op: 'setEnvironment', set: { lightBake: { quality: 'medium' } } }]).world;
    expect(w.environment.lightBake).toEqual({ quality: 'medium' });
    w = applyPatches(w, [{ op: 'setEnvironment', set: { lightBake: null } }]).world;
    expect(w.environment.lightBake).toBeUndefined();
  });
});
