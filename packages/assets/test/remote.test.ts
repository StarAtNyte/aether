import { afterEach, describe, expect, it } from 'vitest';
import { characterUrl, isLibraryRemoteUrl, libraryPathOf, libraryUrl, setLibraryRemote, textureVariantUrl } from '../src';

const CDN = 'https://cdn.example/gh/o/r@abc/assets/lib/';

afterEach(() => setLibraryRemote(null));

describe('lean library: files the build does not ship come from the CDN', () => {
  it('shipped files stay local, the rest resolve to the CDN', () => {
    setLibraryRemote({ base: CDN, shipped: ['m/a.1.glb'] });
    expect(libraryUrl('m/a.1.glb')).toBe('/assets/lib/m/a.1.glb');
    expect(libraryUrl('m/b.2.glb')).toBe(`${CDN}m/b.2.glb`);
    expect(characterUrl('c/x.glb')).toBe(`${CDN}c/x.glb`);
  });

  it('without an index every file is local (the whole library ships)', () => {
    expect(libraryUrl('m/b.2.glb')).toBe('/assets/lib/m/b.2.glb');
    expect(isLibraryRemoteUrl(`${CDN}m/b.2.glb`)).toBe(false);
  });

  it('trusts only URLs under the CDN base', () => {
    setLibraryRemote({ base: CDN, shipped: [] });
    expect(isLibraryRemoteUrl(`${CDN}m/b.2.glb`)).toBe(true);
    expect(isLibraryRemoteUrl(`${CDN}../../evil.glb`)).toBe(false);
    expect(isLibraryRemoteUrl('https://cdn.example/other/m/b.glb')).toBe(false);
  });

  it('maps a local or CDN URL back to its library path and its compressed twin', () => {
    setLibraryRemote({ base: CDN, shipped: ['k/b.3.glb'] });
    expect(libraryPathOf('/assets/lib/m/b.2.glb')).toBe('m/b.2.glb');
    expect(libraryPathOf(`${CDN}m/b.2.glb`)).toBe('m/b.2.glb');
    expect(libraryPathOf('/elsewhere/m/b.2.glb')).toBeNull();
    const index = { version: 1, entries: { 'm/b.2.glb': { file: 'k/b.3.glb' } } } as unknown as Parameters<typeof textureVariantUrl>[1];
    expect(textureVariantUrl(`${CDN}m/b.2.glb`, index, '/assets/lib/')).toBe('/assets/lib/k/b.3.glb');
  });
});
