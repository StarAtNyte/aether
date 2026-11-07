import { describe, expect, it } from 'vitest';
import { LIGHTMAP_VERSION } from '../src/environment/lightmap';
import { contentHash, lightmapKey, packAsset, stackAtlas, unpackAsset, unstackAtlas, type LightmapAssetMeta } from '../src/environment/lightmap-asset';
import { lightmapLayers, scaleCount } from '../src/environment/relight';
import { parseLightmapReply, parseLightmapRequest } from '../src/environment/lightmap-protocol';

const KEYCOUNT = 2;
const LAYERS = lightmapLayers(KEYCOUNT);
const SCALES = [1, 0.4, 0.3, 0.2, 0.1, 0.05];

function meta(over: Partial<LightmapAssetMeta> = {}): LightmapAssetMeta {
  return { version: LIGHTMAP_VERSION, key: 'lm1-abc', size: 256, layers: LAYERS, scales: SCALES, keys: [[0.6, 0.8, 0], [0, 1, 0]], quality: 'medium', samples: 48, density: 20, charts: 3, texels: 100, rays: 5000, bakeMs: 1234, tris: [2, -1, 4], image: 'raw', ...over };
}

describe('lightmap asset', () => {
  it('round-trips the header, the coordinates and the image', () => {
    const L = 256 * 256 * 4;
    const rgba = new Uint8Array(L * LAYERS);
    for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 7) & 255;
    // Every layer's alpha is the same visibility.
    for (let o = 0; o < 256 * 256; o++) for (let p = 1; p < LAYERS; p++) rgba[p * L + o * 4 + 3] = rgba[o * 4 + 3]!;
    const stacked = stackAtlas(rgba, 256, LAYERS);
    expect(stacked.length).toBe(256 * 256 * (LAYERS + 1) * 4);
    // Row 0 of the stack is the visibility grey, the parts follow; the whole round trip is exact.
    expect(stacked[0]).toBe(rgba[3]);
    expect(stacked[3]).toBe(255);
    expect(Array.from(unstackAtlas(stacked, 256, LAYERS))).toEqual(Array.from(rgba));
    const uv = [Uint16Array.from({ length: 12 }, (_, i) => i * 100), null, Uint16Array.from({ length: 24 }, (_, i) => 65535 - i)];
    const file = packAsset(meta(), uv, stacked);
    const back = unpackAsset(file)!;
    expect(back).not.toBeNull();
    expect(back.meta.key).toBe('lm1-abc');
    expect(back.uv[1]).toBeNull();
    expect(Array.from(back.uv[0]!)).toEqual(Array.from(uv[0]!));
    expect(Array.from(back.uv[2]!)).toEqual(Array.from(uv[2]!));
    expect(Array.from(unstackAtlas(back.image, 256, LAYERS))).toEqual(Array.from(rgba));
    expect(back.meta.layers).toBe(LAYERS);
    expect(back.meta.scales).toEqual(SCALES);
    expect(back.meta.keys).toEqual([[0.6, 0.8, 0], [0, 1, 0]]);
  });

  it('rejects other versions, truncated files and bad sizes', () => {
    const img = new Uint8Array(256 * 256 * (LAYERS + 1) * 4);
    const ok = packAsset(meta(), [new Uint16Array(12), null, new Uint16Array(24)], img);
    expect(unpackAsset(ok)).not.toBeNull();
    expect(unpackAsset(ok.slice(0, ok.length - 10))).toBeNull();
    expect(unpackAsset(packAsset(meta({ version: LIGHTMAP_VERSION + 1 }), [new Uint16Array(12), null, new Uint16Array(24)], img))).toBeNull();
    expect(unpackAsset(packAsset(meta({ size: 300 }), [new Uint16Array(12), null, new Uint16Array(24)], img))).toBeNull();
    expect(unpackAsset(packAsset(meta({ image: 'raw' }), [new Uint16Array(12), null, new Uint16Array(24)], new Uint8Array(10)))).toBeNull();
    expect(unpackAsset(new Uint8Array(40))).toBeNull();
    const uv = [new Uint16Array(12), null, new Uint16Array(24)];
    // Layers that do not match the keys, or scales that do not match the keys, are not an asset.
    expect(unpackAsset(packAsset(meta({ layers: LAYERS + 1 }), uv, img))).toBeNull();
    expect(scaleCount(KEYCOUNT)).toBe(SCALES.length);
    expect(unpackAsset(packAsset(meta({ scales: [1, 1] }), uv, img))).toBeNull();
    expect(unpackAsset(packAsset(meta({ scales: [1, 1, 1, 0, 1, 1] }), uv, img))).toBeNull();
    expect(unpackAsset(packAsset(meta({ keys: [[Number.NaN, 0, 0]] }), uv, img))).toBeNull();
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
    const good = { type: 'lightmap', id: 3, ok: true, size: 256, layers: LAYERS, scales: new Float32Array(SCALES), density: 10, charts: 1, texels: 2, rays: 3, rgba: new Uint8Array(256 * 256 * 4 * LAYERS), uv: [new Float32Array(12), null] };
    expect(parseLightmapReply(good, [2, 5], KEYCOUNT)).not.toBeNull();
    expect(parseLightmapReply({ ...good, size: 300 }, [2, 5], KEYCOUNT)).toBeNull();
    expect(parseLightmapReply({ ...good, layers: LAYERS - 1 }, [2, 5], KEYCOUNT)).toBeNull();
    expect(parseLightmapReply({ ...good, scales: new Float32Array([1, 1]) }, [2, 5], KEYCOUNT)).toBeNull();
    expect(parseLightmapReply({ ...good, scales: new Float32Array([1, 1, 0, 1, 1, 1]) }, [2, 5], KEYCOUNT)).toBeNull();
    expect(parseLightmapReply({ ...good, rgba: new Uint8Array(10) }, [2, 5], KEYCOUNT)).toBeNull();
    expect(parseLightmapReply({ ...good, uv: [new Float32Array(10), null] }, [2, 5], KEYCOUNT)).toBeNull();
    expect(parseLightmapReply({ ...good, uv: [Float32Array.from({ length: 12 }, () => 2), null] }, [2, 5], KEYCOUNT)).toBeNull();
    expect(parseLightmapReply({ type: 'progress', id: 3, value: 7 }, [2, 5], KEYCOUNT)).toEqual({ type: 'progress', id: 3, value: 1 });
    expect(parseLightmapReply({ type: 'lightmap', id: 3, ok: false, error: 'x' }, [2, 5], KEYCOUNT)).toMatchObject({ ok: false });
  });

  it('refuses a request with a bad quality, sizes or indices', () => {
    expect(parseLightmapRequest(null)).toBeNull();
    expect(parseLightmapRequest({ type: 'bake', id: 1, maxSize: 300 })).toBeNull();
  });
});
