import { describe, expect, it } from 'vitest';
import { effectsOf, RENDER_TIERS } from '@aether/render';
import { STORAGE_KEYS } from '../src/config';
import { DEFAULT_SETTINGS, EFFECT_SETTINGS, loadSettings, parseEffectSettings, RENDER_TIER_SETTINGS, saveSettings, type StorageLike } from '../src/lib/storage';
import { TIER_EFFECTS } from '../src/components/SettingsDialog';

class MemoryStorage implements StorageLike {
  private readonly m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
}

describe('graphics settings', () => {
  it('default to automatic quality with every effect following the tier', () => {
    expect(DEFAULT_SETTINGS.renderTier).toBe('auto');
    expect(DEFAULT_SETTINGS.effects).toEqual({});
    expect(loadSettings(null).renderTier).toBe('auto');
  });
  it('accepts only known tiers and boolean switches of known effects', () => {
    const s = new MemoryStorage();
    s.setItem(STORAGE_KEYS.settings, JSON.stringify({ renderTier: 'ultra', effects: { ao: false, ssr: true, shafts: 'yes', evil: true, __proto__: { polluted: true }, constructor: true } }));
    const loaded = loadSettings(s);
    expect(loaded.renderTier).toBe('ultra');
    expect(loaded.effects).toEqual({ ao: false, ssr: true });
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    s.setItem(STORAGE_KEYS.settings, JSON.stringify({ renderTier: 'extreme', effects: [true] }));
    const bad = loadSettings(s);
    expect(bad.renderTier).toBe('auto');
    expect(bad.effects).toEqual({});
    s.setItem(STORAGE_KEYS.settings, JSON.stringify({ renderTier: { x: 1 }, effects: 'all' }));
    expect(loadSettings(s).renderTier).toBe('auto');
  });
  it('round-trips through storage', () => {
    const s = new MemoryStorage();
    saveSettings(s, { ...DEFAULT_SETTINGS, renderTier: 'high', effects: { grain: false } });
    const back = loadSettings(s);
    expect(back.renderTier).toBe('high');
    expect(back.effects).toEqual({ grain: false });
  });
  it('parseEffectSettings ignores everything that is not a plain object', () => {
    for (const bad of [null, undefined, 3, 'x', [true], () => 1]) expect(parseEffectSettings(bad)).toEqual({});
  });
  it('the settings tier list and the effect table match the renderer', () => {
    expect(RENDER_TIER_SETTINGS.filter((t) => t !== 'auto')).toEqual([...RENDER_TIERS]);
    for (const tier of RENDER_TIERS) {
      const fromRenderer = EFFECT_SETTINGS.filter((k) => effectsOf(tier)[k]);
      expect([...TIER_EFFECTS[tier]].sort()).toEqual([...fromRenderer].sort());
    }
  });
});
