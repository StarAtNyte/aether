import { describe, expect, it } from 'vitest';
import { createWorld } from '@aether/core';
import { STORAGE_KEYS } from '../src/config';
import { DEFAULT_SETTINGS, loadChat, loadSettings, loadWorld, readJson, saveChat, saveSettings, saveWorld, writeJson, type StorageLike } from '../src/lib/storage';

class MemoryStorage implements StorageLike {
  readonly map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

const throwing: StorageLike = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('quota');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

describe('storage', () => {
  it('round-trips a valid world', () => {
    const s = new MemoryStorage();
    const w = createWorld({ name: 'Saved' });
    expect(saveWorld(s, w)).toBe(true);
    expect(loadWorld(s)).toEqual(w);
  });

  it('rejects tampered or corrupt worlds', () => {
    const s = new MemoryStorage();
    s.setItem(STORAGE_KEYS.world, '{"entities":{"X":{}}}');
    expect(loadWorld(s)).toBeNull();
    s.setItem(STORAGE_KEYS.world, '{"__proto__":{"a":1}}');
    expect(loadWorld(s)).toBeNull();
    s.setItem(STORAGE_KEYS.world, 'not json');
    expect(loadWorld(s)).toBeNull();
  });

  it('survives storage that throws', () => {
    expect(loadWorld(throwing)).toBeNull();
    expect(saveWorld(throwing, createWorld())).toBe(false);
    expect(loadChat(throwing)).toEqual([]);
    expect(loadSettings(throwing)).toEqual(DEFAULT_SETTINGS);
    expect(readJson(null, 'x')).toBeNull();
    expect(writeJson(null, 'x', 1)).toBe(false);
  });

  it('keeps only known boolean settings', () => {
    const s = new MemoryStorage();
    s.setItem(STORAGE_KEYS.settings, JSON.stringify({ showPerf: false, shadows: 'yes', evil: true }));
    const settings = loadSettings(s);
    expect(settings.showPerf).toBe(false);
    expect(settings.shadows).toBe(true);
    expect('evil' in settings).toBe(false);
    saveSettings(s, settings);
    expect(loadSettings(s)).toEqual(settings);
  });

  it('round-trips chat through revive', () => {
    const s = new MemoryStorage();
    saveChat(s, [{ id: 1, role: 'user', text: 'hi' }]);
    expect(loadChat(s)).toEqual([{ id: 1, role: 'user', text: 'hi' }]);
  });
});
