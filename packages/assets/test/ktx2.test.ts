/**
 * The GPU-compressed (KTX2) twins of the library: `assets/ktx2.json` validates, every twin and every
 * source it was made from exist with the recorded SHA-256 (a library rebuild without `assets:ktx2` is
 * caught here), the codec rules hold (normals and data maps UASTC, the cast's tinted base colours kept,
 * colour in sRGB), the block sheets' KTX2 arrays match their WebP sources, the Basis transcoder served by
 * the studio is three's own, and the planning helpers of the encoder script behave.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Catalog } from '../src/schema';
import { TextureVariants, textureVariantPath, textureVariantUrl } from '../src/texture-variants';
import { bleedAlpha, firstPlan, gpuBytes, mipChainBytes, parseLevel0Ssim, roleOf, stemOf, uastcPlan } from '../../../scripts/assets/ktx2-plan';

const ROOT = resolve(import.meta.dirname, '../../..');
const LIB = join(ROOT, 'assets', 'lib');
const sha = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');
const index = TextureVariants.parse(JSON.parse(readFileSync(join(ROOT, 'assets', 'ktx2.json'), 'utf8')));
const catalog = Catalog.parse(JSON.parse(readFileSync(join(ROOT, 'assets', 'catalog.json'), 'utf8')));

describe('KTX2 twins of the library', () => {
  it('cover the textured library models and record the encoder', () => {
    const n = Object.keys(index.entries).length;
    expect(n).toBeGreaterThanOrEqual(150);
    expect(index.encoder.name).toMatch(/KTX-Software/);
    expect(index.encoder.licence).toBe('Apache-2.0');
    // Every twin belongs to a catalog file or a cast body.
    const files = new Set(catalog.entries.map((e) => e.file).filter(Boolean));
    for (const path of Object.keys(index.entries)) expect(files.has(path) || path.startsWith('c/'), path).toBe(true);
  });

  it('match their sources and their own checksums (rerun `npm run assets:ktx2` after a library rebuild)', () => {
    for (const [path, v] of Object.entries(index.entries)) {
      const src = join(LIB, path);
      expect(existsSync(src), path).toBe(true);
      expect(sha(src), `${path} changed since its twin was made`).toBe(v.source.sha256);
      const out = join(LIB, v.file);
      expect(existsSync(out), v.file).toBe(true);
      const hash = sha(out);
      expect(hash, v.file).toBe(v.sha256);
      expect(v.file.split('.').at(-2)).toBe(hash.slice(0, 8));
      expect(readFileSync(out).byteLength).toBe(v.bytes);
    }
  });

  it('keep GPU memory at a quarter or less of RGBA8 for every texture they encode, and stay within the disk budget', () => {
    let before = 0;
    let after = 0;
    let bytes = 0;
    for (const v of Object.values(index.entries)) {
      before += v.gpu.before;
      after += v.gpu.after;
      bytes += v.bytes;
      for (const t of v.textures) if (t.codec !== 'kept') expect(t.ssim ?? 1, `${v.file} ${t.slots.join('+')}`).toBeGreaterThan(0.9);
    }
    expect(after).toBeLessThan(before * 0.6);
    // The twins ship next to the originals: keep them bounded (the library itself is ≤ 150 MB).
    expect(bytes).toBeLessThan(110 * 1024 * 1024);
  });

  it('use UASTC for normal and data maps, and keep the base colours the cast tints on the CPU', () => {
    for (const [path, v] of Object.entries(index.entries)) {
      for (const t of v.textures) {
        const role = roleOf(t.slots);
        if (t.codec === 'kept') {
          expect(t.reason, `${path} ${t.slots.join('+')}`).toBeTruthy();
          continue;
        }
        if (role === 'normal' || role === 'data') expect(t.codec, `${path} ${t.slots.join('+')}`).toBe('uastc');
        if (path.startsWith('c/')) expect(role, path).not.toBe('color');
      }
      if (path.startsWith('c/')) expect(v.textures.some((t) => t.codec === 'kept' && t.slots.includes('baseColorTexture'))).toBe(true);
    }
  });

  it('maps library URLs to their twins and nothing else', () => {
    const [path, v] = Object.entries(index.entries)[0] as [string, (typeof index.entries)[string]];
    expect(textureVariantUrl(`/assets/lib/${path}`, index, '/assets/lib/')).toBe(`/assets/lib/${v.file}`);
    expect(textureVariantUrl(`/html/1/assets/lib/${path}`, index, '/html/1/assets/lib/')).toBe(`/html/1/assets/lib/${v.file}`);
    expect(textureVariantUrl(`https://example.com/assets/lib/${path}`, index, '/assets/lib/')).toBeNull();
    expect(textureVariantUrl(`/assets/lib/${path}?x=1`, index, '/assets/lib/')).toBeNull();
    expect(textureVariantUrl('/assets/lib/m/unknown.01234567.glb', index, '/assets/lib/')).toBeNull();
    expect(textureVariantUrl('/assets/lib/constructor', index, '/assets/lib/')).toBeNull();
    expect(textureVariantUrl(`/assets/lib/${path}`, null)).toBeNull();
    expect(textureVariantPath(path, index)).toBe(v.file);
    expect(textureVariantPath('__proto__', index)).toBeNull();
  });
});

describe('KTX2 block sheets', () => {
  const dir = join(ROOT, 'apps', 'studio', 'public', 'blocks');
  const blocks = JSON.parse(readFileSync(join(dir, 'block-ktx2.json'), 'utf8')) as {
    version: number;
    size: number;
    layers: number;
    files: Record<string, { file: string; sha256: string; bytes: number; codec: string; source: string; sourceSha256: string }>;
  };
  const sheet = JSON.parse(readFileSync(join(dir, 'block-materials.json'), 'utf8')) as { size: number; columns: number; rows: number };

  it('match the WebP sheets they were made from and the sheet layout', () => {
    expect(blocks.version).toBe(1);
    expect(blocks.size).toBe(sheet.size);
    expect(blocks.layers).toBe(sheet.columns * sheet.rows);
    for (const k of ['albedo', 'normal', 'orm']) {
      const f = blocks.files[k];
      expect(f, k).toBeTruthy();
      expect(sha(join(dir, f!.file)), f!.file).toBe(f!.sha256);
      expect(sha(join(dir, f!.source)), `${f!.source} changed since its KTX2 array was made`).toBe(f!.sourceSha256);
    }
    expect(blocks.files['normal']!.codec).toBe('uastc');
    expect(blocks.files['orm']!.codec).toBe('uastc');
  });
});

describe('Basis transcoder served by the studio', () => {
  it('is the one three.js ships, and its worker is the KTX2Loader worker (rerun scripts/assets/basis-worker.ts after a three upgrade)', async () => {
    const { expectedBasisFiles, PUBLIC_BASIS } = await import('../../../scripts/assets/basis-worker');
    const files = expectedBasisFiles();
    expect([...files.keys()].sort()).toEqual(['basis_transcoder.js', 'basis_transcoder.wasm', 'ktx2-worker.js']);
    for (const [name, data] of files) expect(readFileSync(join(PUBLIC_BASIS, name)).equals(data), name).toBe(true);
  });
});

describe('KTX2 encoder planning', () => {
  it('classifies textures by the slots they fill', () => {
    expect(roleOf(['baseColorTexture'])).toBe('color');
    expect(roleOf(['emissiveTexture', 'baseColorTexture'])).toBe('color');
    expect(roleOf(['normalTexture'])).toBe('normal');
    expect(roleOf(['metallicRoughnessTexture', 'occlusionTexture'])).toBe('data');
    expect(roleOf(['baseColorTexture', 'metallicRoughnessTexture'])).toBeNull();
  });

  it('encodes colour as sRGB and everything else as linear, with mip chains', () => {
    const albedo = firstPlan('color', false, true);
    expect(albedo.codec).toBe('etc1s');
    expect(albedo.args).toEqual(expect.arrayContaining(['R8G8B8_SRGB', 'srgb', '--generate-mipmap', 'wrap']));
    const leaf = firstPlan('color', true, false);
    expect(leaf.codec).toBe('uastc');
    expect(leaf.args).toEqual(expect.arrayContaining(['R8G8B8A8_SRGB', 'clamp']));
    // Cut-outs are not rate-distortion optimised: RDO smears alpha edges.
    expect(leaf.args).not.toContain('--uastc-rdo');
    const normal = firstPlan('normal', false, true);
    expect(normal.codec).toBe('uastc');
    expect(normal.args).toEqual(expect.arrayContaining(['R8G8B8_UNORM', 'linear']));
    // The OpenGL normal layout stays RGB (no two-channel normal mode: three samples .xyz).
    expect(normal.args).not.toContain('--normal-mode');
    expect(uastcPlan('data', false, true).args).toEqual(expect.arrayContaining(['R8G8B8_UNORM', '--zstd']));
  });

  it('reads the level-0 similarity of the encoder report (luma-weighted)', () => {
    const out = 'Level 0:\n    SSIM R: +0.955832, G: +0.962857, B: +0.932882\nLevel 1:\n    SSIM R: +0.5, G: +0.5, B: +0.5\n';
    expect(parseLevel0Ssim(out)).toBeCloseTo(0.2126 * 0.955832 + 0.7152 * 0.962857 + 0.0722 * 0.932882, 6);
    expect(parseLevel0Ssim('Level 0:\n    SSIM A: +0.9\n')).toBeCloseTo(0.9);
    expect(parseLevel0Ssim('nothing')).toBeNull();
  });

  it('estimates GPU bytes: RGBA8 with mips versus 8-bit-per-texel blocks', () => {
    expect(mipChainBytes(4, 4, 32, false)).toBe(64 + 16 + 4);
    expect(mipChainBytes(4, 4, 8, true)).toBe(16 * 3);
    const rgba = gpuBytes(1024, 1024, false);
    const bc7 = gpuBytes(1024, 1024, true);
    expect(rgba).toBeGreaterThan(1024 * 1024 * 4);
    expect(bc7 / rgba).toBeGreaterThan(0.24);
    expect(bc7 / rgba).toBeLessThan(0.26);
  });

  it('bleeds visible colour under transparent texels without touching visible ones or alpha', () => {
    // 3 × 1: green leaf, transparent black, transparent black.
    const px = new Uint8Array([0, 200, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0]);
    bleedAlpha(px, 3, 1);
    expect([...px]).toEqual([0, 200, 0, 255, 0, 200, 0, 0, 0, 200, 0, 0]);
    const opaque = new Uint8Array([10, 20, 30, 255]);
    bleedAlpha(opaque, 1, 1);
    expect([...opaque]).toEqual([10, 20, 30, 255]);
  });

  it('names twins after their source', () => {
    expect(stemOf('m/sofa.0123abcd.glb')).toBe('sofa');
    expect(stemOf('c/dario.26754f25.glb')).toBe('dario');
    expect(stemOf('m/street-lamp-realistic.7cae016d.glb')).toBe('street-lamp-realistic');
  });
});
