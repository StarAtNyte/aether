import { describe, expect, it } from 'vitest';
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, Texture } from 'three';
import { anyCompressedFormat, supportLabel, TextureCompression } from '../src/gpu/texture-compression';
import { compressedBytes, generatesMips, textureBreakdown, textureKind, trackCompressedTextureBytes } from '../src/gpu/texture-memory';
import { parseKtx2Index } from '../src/voxel/block-sheets';
import { createGltfModelLoader } from '../src/geometry/model-loader';

const none = { astc: false, bptc: false, s3tc: false, etc2: false, etc1: false, pvrtc: false };

describe('texture compression support', () => {
  it('needs at least one block format (RGBA8 transcoding saves nothing)', () => {
    expect(anyCompressedFormat(none)).toBe(false);
    expect(anyCompressedFormat({ ...none, bptc: true })).toBe(true);
    expect(supportLabel({ ...none, bptc: true, s3tc: true })).toBe('bptc s3tc');
    expect(supportLabel(none)).toBe('none');
  });

  it('is off without a renderer or a transcoder path, and never rejects', async () => {
    const off = new TextureCompression(null);
    expect(await off.loader()).toBeNull();
    expect(off.state).toBe('off');
    const noPath = new TextureCompression(null, null);
    expect(await noPath.loader()).toBeNull();
    noPath.disable('test');
    expect(await noPath.loader()).toBeNull();
  });

  it('loads originals when compression is off (the twin is never asked for)', async () => {
    let asked = 0;
    const loader = createGltfModelLoader({
      compression: new TextureCompression(null),
      variantOf: async () => {
        asked++;
        return '/assets/lib/k/x.01234567.glb';
      },
    });
    await expect(loader.load('javascript:alert(1)')).rejects.toThrow(/rejected/);
    expect(asked).toBe(0);
  });
});

describe('texture byte accounting', () => {
  it('counts compressed textures by their mip data', () => {
    expect(compressedBytes({ isCompressedTexture: true, mipmaps: [{ data: new Uint8Array(1024) }, { data: new Uint8Array(256) }] })).toBe(1280);
    expect(compressedBytes({ isCompressedTexture: false, mipmaps: [] })).toBeNull();
    expect(compressedBytes({ isCompressedTexture: true, mipmaps: [] })).toBeNull();
  });

  it('adds the mip chain the GPU generates', () => {
    const t = new DataTexture(new Uint8Array(16), 2, 2);
    t.generateMipmaps = true;
    t.minFilter = LinearMipmapLinearFilter;
    expect(generatesMips(t)).toBe(true);
    t.minFilter = LinearFilter;
    expect(generatesMips(t)).toBe(false);
  });

  it('classifies textures and tracks live bytes by kind on a renderer info', () => {
    expect(textureKind({ isRenderTargetTexture: true })).toBe('target');
    expect(textureKind({ isCompressedTexture: true })).toBe('compressed');
    expect(textureKind({ image: { width: 4, height: 4 } })).toBe('image');
    expect(textureKind({ image: { data: new Uint8Array(4), width: 1, height: 1 } })).toBe('data');
    const info = {
      _getTextureMemorySize: (_t: Texture): number => 100,
      createTexture(_t: Texture): void {},
      destroyTexture(_t: Texture): void {},
    };
    const renderer = { info };
    trackCompressedTextureBytes(renderer);
    trackCompressedTextureBytes(renderer);
    const a = new Texture({ width: 4, height: 4 } as unknown as HTMLImageElement);
    a.generateMipmaps = false;
    info.createTexture(a);
    const b = new DataTexture(new Uint8Array(4), 1, 1);
    b.generateMipmaps = false;
    info.createTexture(b);
    let bd = textureBreakdown(renderer);
    expect(bd?.image).toEqual({ count: 1, bytes: 100 });
    expect(bd?.data).toEqual({ count: 1, bytes: 100 });
    info.destroyTexture(a);
    bd = textureBreakdown(renderer);
    expect(bd?.image.count).toBe(0);
    expect(textureBreakdown({ info: {} })).toBeNull();
  });
});

describe('KTX2 block sheet index', () => {
  const ok = { version: 1, size: 256, layers: 32, files: { albedo: { file: 'block-albedo.ktx2' }, normal: { file: 'block-normal.ktx2' }, orm: { file: 'block-orm.ktx2' } } };
  it('accepts the generated index for the matching layout only', () => {
    expect(parseKtx2Index(ok, 256, 32)).toEqual({ albedo: 'block-albedo.ktx2', normal: 'block-normal.ktx2', orm: 'block-orm.ktx2' });
    expect(parseKtx2Index(ok, 128, 32)).toBeNull();
    expect(parseKtx2Index(ok, 256, 16)).toBeNull();
    expect(parseKtx2Index({ ...ok, files: { ...ok.files, orm: { file: '../secret.ktx2' } } }, 256, 32)).toBeNull();
    expect(parseKtx2Index(null, 256, 32)).toBeNull();
  });
});
