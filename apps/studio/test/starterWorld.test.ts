import { describe, expect, it } from 'vitest';
import { validateWorld } from '@aether/core';
import { BUILTIN_GENERATORS } from '@aether/procgen';
import { createStarterWorld } from '../src/lib/starterWorld';
import { EXAMPLE_PROMPTS } from '../src/lib/examples';

describe('starter world', () => {
  it('is a valid world using only built-in generators', () => {
    const w = createStarterWorld();
    expect(validateWorld(w).ok).toBe(true);
    for (const e of Object.values(w.entities)) {
      const s = e.shape.kind === 'scatter' ? e.shape.of : e.shape;
      if (s.kind === 'procedural') expect(BUILTIN_GENERATORS[s.generator], s.generator).toBeDefined();
    }
  });

  it('is playable: gems, a win rule and a HUD binding', () => {
    const w = createStarterWorld();
    const gems = Object.values(w.entities).filter((e) => e.tags.includes('gem'));
    expect(gems).toHaveLength(5);
    expect(w.rules.some((r) => r.then.some((a) => a.do === 'win'))).toBe(true);
    expect(w.hud.map((h) => h.key)).toContain('gems');
    expect(w.tests.length).toBeGreaterThan(0);
  });

  it('returns a fresh copy each time', () => {
    expect(createStarterWorld()).not.toBe(createStarterWorld());
  });
});

describe('example prompts', () => {
  it('ships the 8 curated prompts', () => {
    expect(EXAMPLE_PROMPTS).toHaveLength(9);
    expect(new Set(EXAMPLE_PROMPTS.map((p) => p.title)).size).toBe(9);
  });
});
