import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type StorageLike } from '../src/lib/storage';
import { applyTheme, THEME_COLORS, themeFromSetting, type ThemeDocument } from '../src/lib/theme';

class MemoryStorage implements StorageLike {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

function fakeDoc(withMeta = true): { doc: ThemeDocument; attrs: Map<string, string>; meta: Map<string, string>; style: { colorScheme: string } } {
  const attrs = new Map<string, string>();
  const meta = new Map<string, string>();
  const style = { colorScheme: '' };
  const doc: ThemeDocument = {
    documentElement: { setAttribute: (n, v) => void attrs.set(n, v), style },
    querySelector: (sel) => (withMeta ? { setAttribute: (_n: string, v: string) => void meta.set(sel, v) } : null),
  };
  return { doc, attrs, meta, style };
}

describe('theme', () => {
  it('defaults to the light theme', () => {
    expect(DEFAULT_SETTINGS.darkTheme).toBe(false);
    expect(themeFromSetting(DEFAULT_SETTINGS.darkTheme)).toBe('light');
    expect(themeFromSetting(true)).toBe('dark');
  });

  it('persists the dark theme choice and rejects non-booleans', () => {
    const s = new MemoryStorage();
    saveSettings(s, { ...DEFAULT_SETTINGS, darkTheme: true });
    expect(loadSettings(s).darkTheme).toBe(true);
    s.setItem('aether.studio.settings.v1', JSON.stringify({ darkTheme: 'dark' }));
    expect(loadSettings(s).darkTheme).toBe(false);
  });

  it('applies data-theme, color-scheme and browser chrome colors', () => {
    const { doc, attrs, meta, style } = fakeDoc();
    applyTheme(doc, 'dark');
    expect(attrs.get('data-theme')).toBe('dark');
    expect(style.colorScheme).toBe('dark');
    expect(meta.get('meta[name="theme-color"]')).toBe(THEME_COLORS.dark);
    expect(meta.get('meta[name="color-scheme"]')).toBe('dark');
    applyTheme(doc, 'light');
    expect(attrs.get('data-theme')).toBe('light');
    expect(meta.get('meta[name="theme-color"]')).toBe(THEME_COLORS.light);
  });

  it('tolerates missing documents, missing meta tags and throwing DOMs', () => {
    expect(() => applyTheme(null, 'dark')).not.toThrow();
    const { doc, attrs } = fakeDoc(false);
    applyTheme(doc, 'dark');
    expect(attrs.get('data-theme')).toBe('dark');
    const throwing: ThemeDocument = {
      documentElement: {
        setAttribute: () => {
          throw new Error('locked');
        },
        style: { colorScheme: '' },
      },
      querySelector: () => null,
    };
    expect(() => applyTheme(throwing, 'light')).not.toThrow();
  });
});
