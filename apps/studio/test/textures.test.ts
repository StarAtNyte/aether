/** Studio side of project texture sets: the store (caps, untrusted records), registry sync on world change, packages. */
import { afterEach, describe, expect, it } from 'vitest';
import { History, createWorld, type TextureSetDef } from '@aether/core';
import { clearTextureSets, textureSet, textureCredits } from '@aether/assets';
import { MemoryTextureStore, checkSetFiles } from '../src/assets/textureStore';
import { TextureController } from '../src/engine/textures';

const ID = 'tex-0123456789ab';
const def: TextureSetDef = { name: 'linen', provenance: 'photographed', tile: 0.8, tiers: [256], albedoScale: 2.5, mean: '#e0d8c8' };

/** A WebP header of `size` x `size` (lossless chunk) padded to `n` bytes: enough for the header validation. */
function webp(size: number, n = 64): Uint8Array {
  const b = new Uint8Array(n);
  b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c], 0);
  b[20] = 0x2f;
  const bits = (size - 1) | ((size - 1) << 14);
  b[21] = bits & 255;
  b[22] = (bits >> 8) & 255;
  b[23] = (bits >> 16) & 255;
  b[24] = (bits >>> 24) & 255;
  return b;
}
const files = (size = 256) => (['albedo', 'orm', 'normal'] as const).map((map) => ({ map, tier: size as 256, bytes: webp(size) }));

afterEach(() => clearTextureSets());

describe('texture store', () => {
  it('keeps a set, refuses files that break the caps or the tier size', async () => {
    expect(checkSetFiles(def, files())).toBeNull();
    expect(checkSetFiles(def, files(512))).toMatch(/missing|expected/);
    expect(checkSetFiles(def, [{ map: 'albedo', tier: 256, bytes: webp(256, 200 * 1024) }, ...files().slice(1)])).toMatch(/KB/);
    const store = new MemoryTextureStore();
    await store.put(ID, def, files());
    expect((await store.get(ID))?.def.name).toBe('linen');
    await expect(store.put(ID, def, [])).rejects.toThrow();
    await store.remove(ID);
    expect(await store.get(ID)).toBeNull();
  });
});

describe('texture controller', () => {
  it('registers a set the world names from the store, and keeps added sets drawable', async () => {
    const history = new History(createWorld({}));
    const c = new TextureController({ history });
    // Not stored yet: nothing is registered.
    history.commit([{ op: 'setMeta', textures: { [ID]: def } }], 'add', 'user');
    await new Promise((r) => setTimeout(r, 20));
    expect(textureSet(ID)).toBeNull();
    const r = await c.add({ id: ID, def, files: files() });
    expect(r.ok).toBe(true);
    expect(textureSet(ID)?.tiers[256]?.albedo).toMatch(/^blob:|^data:|\//);
    expect(textureCredits(history.current)[0]?.label).toContain('photographed');
    c.dispose();
  });

  it('refuses a set whose files break the caps without registering it', async () => {
    const c = new TextureController({ history: new History(createWorld({})) });
    const r = await c.add({ id: ID, def, files: [] });
    expect(r.ok).toBe(false);
    expect(textureSet(ID)).toBeNull();
    c.dispose();
  });

  it('registers bundled sets by their base folder', async () => {
    const history = new History(createWorld({}));
    const c = new TextureController({ history });
    history.commit([{ op: 'setMeta', textures: { [ID]: { ...def, base: 'templates/textures' } } }], 'add', 'user');
    await new Promise((r) => setTimeout(r, 20));
    expect(textureSet(ID)?.tiers[256]?.normal).toBe(`/templates/textures/${ID}.normal.256.webp`);
    c.dispose();
  });
});

describe('player world textures', () => {
  it('the /play player registers the textures of bundled templates (Lisbon Hills), served from the site', async () => {
    const { readFileSync, existsSync } = await import('node:fs');
    const { registerWorldTextures } = await import('../src/player/source');
    const root = new URL('../public/', import.meta.url);
    for (const slug of ['lisbon-hills']) {
      clearTextureSets();
      const world = (JSON.parse(readFileSync(new URL(`templates/worlds/${slug}.json`, root), 'utf8')) as { world: { textures?: Record<string, TextureSetDef> } }).world;
      const ids = Object.keys(world.textures ?? {});
      expect(ids.length).toBeGreaterThan(0);
      expect(registerWorldTextures(world, '/')).toBe(ids.length);
      for (const id of ids) {
        const set = textureSet(id);
        expect(set, `${slug}: ${id}`).toBeTruthy();
        for (const tier of Object.values(set!.tiers)) {
          for (const url of [tier.albedo, tier.orm, tier.normal]) {
            expect(url.startsWith('/templates/textures/')).toBe(true);
            expect(existsSync(new URL(url.slice(1), root)), url).toBe(true);
          }
        }
      }
    }
    // The player calls it on boot, before the world is built.
    expect(readFileSync(new URL('../src/player/PlayerApp.tsx', import.meta.url), 'utf8')).toMatch(/registerWorldTextures\(world,/);
  });
});
