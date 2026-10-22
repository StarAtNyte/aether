import { describe, expect, it } from 'vitest';
import { LIGHTMAP_VERSION } from '../src/environment/lightmap';
import { contentHash, lightmapKey, packAsset, stackAtlas, unpackAsset, unstackAtlas, type LightmapAssetMeta } from '../src/environment/lightmap-asset';
import { parseLightmapReply, parseLightmapRequest } from '../src/environment/lightmap-protocol';

function meta(over: Partial<LightmapAssetMeta> = {}): LightmapAssetMeta {
  return { version: LIGHTMAP_VERSION, key: 'lm1-abc', size: 256, scale: 0.4, quality: 'medium', samples: 48, density: 20, charts: 3, texels: 100, rays: 5000, bakeMs: 1234, tris: [2, -1, 4], image: 'raw', ...over };
}

describe('lightmap asset', () => {
  it('round-trips the header, the coordinates and the image', () => {
    const rgba = new Uint8Array(256 * 256 * 4);
    for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 7) & 255;
    const stacked = stackAtlas(rgba, 256);
    expect(stacked.length).toBe(256 * 512 * 4);
    expect(Array.from(unstackAtlas(stacked, 256).filter((_, i) => i % 4 === 3))).toEqual(Array.from(rgba.filter((_, i) => i % 4 === 3)));
    const uv = [Uint16Array.from({ length: 12 }, (_, i) => i * 100), null, Uint16Array.from({ length: 24 }, (_, i) => 65535 - i)];
    const file = packAsset(meta(), uv, stacked);
    const back = unpackAsset(file)!;
    expect(back).not.toBeNull();
    expect(back.meta.key).toBe('lm1-abc');
    expect(back.uv[1]).toBeNull();
    expect(Array.from(back.uv[0]!)).toEqual(Array.from(uv[0]!));
    expect(Array.from(back.uv[2]!)).toEqual(Array.from(uv[2]!));
    expect(Array.from(unstackAtlas(back.image, 256))).toEqual(Array.from(rgba.map((v, i) => (i % 4 === 3 ? v : v))));
  });

  it('rejects other versions, truncated files and bad sizes', () => {
    const img = new Uint8Array(256 * 512 * 4);
    const ok = packAsset(meta(), [new Uint16Array(12), null, new Uint16Array(24)], img);
    expect(unpackAsset(ok)).not.toBeNull();
    expect(unpackAsset(ok.slice(0, ok.length - 10))).toBeNull();
    expect(unpackAsset(packAsset(meta({ version: LIGHTMAP_VERSION + 1 }), [new Uint16Array(12), null, new Uint16Array(24)], img))).toBeNull();
    expect(unpackAsset(packAsset(meta({ size: 300 }), [new Uint16Array(12), null, new Uint16Array(24)], img))).toBeNull();
    expect(unpackAsset(packAsset(meta({ image: 'raw' }), [new Uint16Array(12), null, new Uint16Array(24)], new Uint8Array(10)))).toBeNull();
    expect(unpackAsset(new Uint8Array(40))).toBeNull();
  });

  it('keys depend on every input and are file-safe', () => {
    const a = new Float32Array([1, 2, 3, 4]);
    const c = contentHash([a]);
    const k = lightmapKey(c, { q: 'medium' });
    expect(k).toMatch(/^lm\d+-[0-9a-f]{32}$/);
    expect(lightmapKey(contentHash([a]), { q: 'medium' })).toBe(k);
    expect(lightmapKey(contentHash([new Float32Array([1, 2, 3, 5])]), { q: 'medium' })).not.toBe(k);
    expect(lightmapKey(c, { q: 'high' })).not.toBe(k);
  });
});

describe('lightmap protocol', () => {
  it('refuses a reply whose atlas or coordinates do not fit the request', () => {
    const good = { type: 'lightmap', id: 3, ok: true, size: 256, scale: 1, density: 10, charts: 1, texels: 2, rays: 3, rgba: new Uint8Array(256 * 256 * 4), uv: [new Float32Array(12), null] };
    expect(parseLightmapReply(good, [2, 5])).not.toBeNull();
    expect(parseLightmapReply({ ...good, size: 300 }, [2, 5])).toBeNull();
    expect(parseLightmapReply({ ...good, rgba: new Uint8Array(10) }, [2, 5])).toBeNull();
    expect(parseLightmapReply({ ...good, uv: [new Float32Array(10), null] }, [2, 5])).toBeNull();
    expect(parseLightmapReply({ ...good, uv: [Float32Array.from({ length: 12 }, () => 2), null] }, [2, 5])).toBeNull();
    expect(parseLightmapReply({ type: 'progress', id: 3, value: 7 }, [2, 5])).toEqual({ type: 'progress', id: 3, value: 1 });
    expect(parseLightmapReply({ type: 'lightmap', id: 3, ok: false, error: 'x' }, [2, 5])).toMatchObject({ ok: false });
  });

  it('refuses a request with a bad quality, sizes or indices', () => {
    expect(parseLightmapRequest(null)).toBeNull();
    expect(parseLightmapRequest({ type: 'bake', id: 1, maxSize: 300 })).toBeNull();
  });
});
