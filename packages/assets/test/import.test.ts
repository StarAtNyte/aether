import { describe, expect, it } from 'vitest';
import { accessorBytes, gltfBounds, sanitizeName, validateGltf, writeGlb } from '../src/import/glb';
import { validateHdr, validateImage } from '../src/import/image';
import { assetNameFromFile, importUserAsset, isUserAssetId, sniffAssetKind } from '../src/user';
import { hdrHeader, jpegHeader, pngHeader, triangleGlb, triangleGltf, triangleGltfText } from './fixtures';

function parseGlbJson(glb: Uint8Array): Record<string, unknown> {
  const len = new DataView(glb.buffer, glb.byteOffset).getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + len))) as Record<string, unknown>;
}

describe('glTF / GLB import validation', () => {
  it('accepts a valid GLB, normalises its pivot and reports facts', () => {
    const r = validateGltf(triangleGlb({ translate: [5, 3, -2] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.triangles).toBe(1);
    expect(r.report.size).toEqual([1, 1, 0]);
    const json = parseGlbJson(r.glb);
    const nodes = json['nodes'] as Array<Record<string, unknown>>;
    const root = nodes[nodes.length - 1]!;
    expect(root['name']).toBe('aether-root');
    // Base on y = 0, centred on X/Z: the triangle spans x 5..6, y 3..4, z -2.
    expect(root['translation']).toEqual([-5.5, -3, 2]);
    const b = gltfBounds(json as never)!;
    expect(b.min[1]).toBeCloseTo(0, 6);
    expect((b.min[0] + b.max[0]) / 2).toBeCloseTo(0, 6);
  });

  it('is idempotent: re-validating its own output gives identical bytes', () => {
    const once = validateGltf(triangleGlb({ translate: [1, 2, 3] }));
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    const twice = validateGltf(once.glb);
    expect(twice.ok).toBe(true);
    if (twice.ok) expect(Buffer.from(twice.glb).equals(Buffer.from(once.glb))).toBe(true);
  });

  it('converts a self-contained .gltf (data URIs) into a GLB', () => {
    const r = validateGltf(triangleGltfText());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const json = parseGlbJson(r.glb);
    expect((json['buffers'] as Array<Record<string, unknown>>)[0]!['uri']).toBeUndefined();
  });

  it('rejects malformed binaries', () => {
    const good = triangleGlb();
    const badMagic = good.slice();
    badMagic[0] = 0;
    expect(validateGltf(badMagic).ok).toBe(false);
    const wrongLength = good.slice();
    new DataView(wrongLength.buffer).setUint32(8, good.byteLength + 4, true);
    expect(validateGltf(wrongLength)).toMatchObject({ ok: false, error: expect.stringContaining('length') });
    expect(validateGltf(good.subarray(0, 30)).ok).toBe(false);
    expect(validateGltf(new Uint8Array([1, 2, 3])).ok).toBe(false);
    expect(validateGltf(new TextEncoder().encode('{not json')).ok).toBe(false);
  });

  it('refuses external references (buffers and images)', () => {
    const { json, bin } = triangleGltf();
    (json['buffers'] as Array<Record<string, unknown>>)[0]!['uri'] = 'https://evil.example/x.bin';
    expect(validateGltf(writeGlb(json, bin))).toMatchObject({ ok: false, error: expect.stringContaining('external') });
    const img = triangleGltf({ extra: { images: [{ uri: 'https://evil.example/tracker.png' }] } });
    expect(validateGltf(writeGlb(img.json, img.bin))).toMatchObject({ ok: false, error: expect.stringContaining('external image') });
    expect(validateGltf(new TextEncoder().encode(JSON.stringify({ ...triangleGltf().json, buffers: [{ byteLength: 42, uri: 'model.bin' }] })))).toMatchObject({ ok: false });
  });

  it('refuses extensions the studio cannot decode and buffer views out of range', () => {
    const draco = triangleGltf({ extra: { extensionsRequired: ['KHR_draco_mesh_compression'], extensionsUsed: ['KHR_draco_mesh_compression'] } });
    expect(validateGltf(writeGlb(draco.json, draco.bin))).toMatchObject({ ok: false, error: expect.stringContaining('KHR_draco') });
    const { json, bin } = triangleGltf();
    (json['bufferViews'] as Array<Record<string, unknown>>)[0]!['byteLength'] = 10_000;
    expect(validateGltf(writeGlb(json, bin))).toMatchObject({ ok: false, error: expect.stringContaining('outside') });
  });

  it('enforces budgets (bytes, triangles, nodes)', () => {
    expect(validateGltf(triangleGlb(), { maxBytes: 10 })).toMatchObject({ ok: false, error: expect.stringContaining('too large') });
    const { json, bin } = triangleGltf();
    (json['accessors'] as Array<Record<string, unknown>>)[1]!['count'] = 3_000_000;
    expect(validateGltf(writeGlb(json, bin))).toMatchObject({ ok: false, error: expect.stringContaining('triangles') });
    const many = triangleGltf({ extra: { nodes: Array.from({ length: 5000 }, () => ({})) } });
    expect(validateGltf(writeGlb(many.json, many.bin))).toMatchObject({ ok: false, error: expect.stringContaining('nodes') });
  });

  it('reads embedded texture headers before any decoder: pixel bombs and fake images are refused (exploit attempts)', () => {
    /** The triangle plus one embedded image (bufferView after the geometry). */
    const withImage = (image: Uint8Array, mimeType = 'image/png'): Uint8Array => {
      const { json, bin } = triangleGltf();
      const at = (bin.byteLength + 3) & ~3;
      const all = new Uint8Array(at + image.byteLength);
      all.set(bin, 0);
      all.set(image, at);
      (json['buffers'] as Array<Record<string, unknown>>)[0]!['byteLength'] = all.byteLength;
      (json['bufferViews'] as Array<Record<string, unknown>>).push({ buffer: 0, byteOffset: at, byteLength: image.byteLength });
      json['images'] = [{ bufferView: 2, mimeType }];
      json['textures'] = [{ source: 0 }];
      return writeGlb(json, all);
    };
    expect(validateGltf(withImage(pngHeader(256, 256)))).toMatchObject({ ok: true });
    // 65535 x 65535 declared in a 33-byte header: ~17 GB once decoded.
    expect(validateGltf(withImage(pngHeader(65535, 65535)))).toMatchObject({ ok: false, error: expect.stringContaining('texture') });
    expect(validateGltf(withImage(jpegHeader(9000, 16)))).toMatchObject({ ok: false, error: expect.stringContaining('texture') });
    // Not an image at all (e.g. SVG / HTML posing as a texture).
    expect(validateGltf(withImage(new TextEncoder().encode('<svg onload="alert(1)"/>'), 'image/png'))).toMatchObject({ ok: false, error: expect.stringContaining('texture') });
    // Individually fine textures that add up past the pixel budget.
    expect(validateGltf(withImage(pngHeader(4096, 4096)), { maxTexturePixels: 8 * 1024 * 1024 })).toMatchObject({ ok: false, error: expect.stringContaining('megapixels') });
    // The same checks on a data URI image of a .gltf.
    let b = '';
    for (const c of pngHeader(60000, 60000)) b += String.fromCharCode(c);
    const text = triangleGltfText({ images: [{ uri: `data:image/png;base64,${btoa(b)}` }] });
    expect(validateGltf(text)).toMatchObject({ ok: false, error: expect.stringContaining('texture') });
  });

  it('caps decoded vertex data, including zero-filled accessors without a buffer view (exploit attempt)', () => {
    const { json, bin } = triangleGltf();
    // An accessor the loader would allocate as 100M x VEC4 floats (1.6 GB) from no data at all.
    (json['accessors'] as Array<Record<string, unknown>>).push({ componentType: 5126, count: 100_000_000, type: 'VEC4' });
    expect(validateGltf(writeGlb(json, bin))).toMatchObject({ ok: false, error: expect.stringContaining('vertex data') });
    expect(accessorBytes(triangleGltf().json as Parameters<typeof accessorBytes>[0])).toBe(3 * 12 + 3 * 2);
  });

  it('blocks prototype-pollution keys and strips extras / hostile names', () => {
    const { json, bin } = triangleGltf();
    const text = JSON.stringify(json).replace('"asset":', '"__proto__":{"polluted":true},"asset":');
    const enc = new TextEncoder().encode(text);
    const glb = writeGlb(JSON.parse('{}'), null);
    void glb;
    // Hand-build a GLB with the raw JSON text (JSON.parse would drop __proto__ silently on stringify round trips).
    const pad = (n: number): number => (n + 3) & ~3;
    const jsonLen = pad(enc.byteLength);
    const out = new Uint8Array(12 + 8 + jsonLen + 8 + bin.byteLength);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546c67, true);
    dv.setUint32(4, 2, true);
    dv.setUint32(8, out.byteLength, true);
    dv.setUint32(12, jsonLen, true);
    dv.setUint32(16, 0x4e4f534a, true);
    out.fill(0x20, 20, 20 + jsonLen);
    out.set(enc, 20);
    dv.setUint32(20 + jsonLen, bin.byteLength, true);
    dv.setUint32(24 + jsonLen, 0x004e4942, true);
    out.set(bin, 28 + jsonLen);
    expect(validateGltf(out)).toMatchObject({ ok: false, error: expect.stringContaining('rejected') });
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();

    const named = triangleGltf({ extra: { extras: { secret: 1 } } });
    (named.json['nodes'] as Array<Record<string, unknown>>)[0]!['name'] = 'evil\u0000<script>name‮';
    (named.json['nodes'] as Array<Record<string, unknown>>)[0]!['extras'] = { tracking: 'x' };
    const r = validateGltf(writeGlb(named.json, named.bin));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const json2 = parseGlbJson(r.glb);
    expect(json2['extras']).toBeUndefined();
    const n0 = (json2['nodes'] as Array<Record<string, unknown>>)[0]!;
    expect(n0['name']).toBe('evilscriptname');
    expect(n0['extras']).toBeUndefined();
  });

  it('sanitizes display names', () => {
    expect(sanitizeName('  a\u0007b   c  ')).toBe('ab c');
    expect(sanitizeName('x'.repeat(200)).length).toBe(64);
    expect(sanitizeName(42)).toBe('');
  });
});

describe('image and HDR validation', () => {
  it('reads PNG / JPEG headers by content', () => {
    expect(validateImage(pngHeader(640, 480))).toEqual({ ok: true, info: { format: 'png', mime: 'image/png', width: 640, height: 480 } });
    expect(validateImage(jpegHeader(320, 200))).toMatchObject({ ok: true, info: { format: 'jpeg', width: 320, height: 200 } });
  });

  it('rejects oversize, empty and unknown images', () => {
    expect(validateImage(pngHeader(20_000, 10)).ok).toBe(false);
    expect(validateImage(pngHeader(0, 10)).ok).toBe(false);
    expect(validateImage(new Uint8Array(100)).ok).toBe(false);
    expect(validateImage(pngHeader(10, 10), { maxBytes: 5 }).ok).toBe(false);
  });

  it('validates Radiance HDR headers', () => {
    expect(validateHdr(hdrHeader(1024, 512))).toEqual({ ok: true, width: 1024, height: 512 });
    expect(validateHdr(hdrHeader(1024, 512, '32-bit_rle_xyze')).ok).toBe(false);
    expect(validateHdr(hdrHeader(100_000, 512)).ok).toBe(false);
    expect(validateHdr(new TextEncoder().encode('P6 not hdr')).ok).toBe(false);
  });
});

describe('user asset import', () => {
  it('sniffs kinds by content, not extension', () => {
    expect(sniffAssetKind(triangleGlb())).toBe('model');
    expect(sniffAssetKind(triangleGltfText())).toBe('model');
    expect(sniffAssetKind(pngHeader(4, 4))).toBe('image');
    expect(sniffAssetKind(hdrHeader(4, 4))).toBe('hdri');
    expect(sniffAssetKind(new TextEncoder().encode('MZ executable'))).toBeNull();
  });

  it('imports with content-derived, deterministic ids', async () => {
    const a = await importUserAsset(triangleGlb({ translate: [1, 0, 0] }), 'My_Chair-v2.glb', { now: 5 });
    const b = await importUserAsset(triangleGlb({ translate: [1, 0, 0] }), 'other name.glb', { now: 6 });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(isUserAssetId(a.asset.meta.id)).toBe(true);
    expect(a.asset.meta.id).toBe(b.asset.meta.id);
    expect(a.asset.meta.name).toBe('My Chair v2');
    expect(a.asset.meta.size).toEqual([1, 1, 0]);
    const img = await importUserAsset(pngHeader(300, 150), 'poster.png');
    expect(img).toMatchObject({ ok: true, asset: { meta: { kind: 'image', width: 300, height: 150, mime: 'image/png' } } });
    const sky = await importUserAsset(hdrHeader(64, 32), 'sky.hdr');
    expect(sky).toMatchObject({ ok: true, asset: { meta: { kind: 'hdri' } } });
    expect(await importUserAsset(new Uint8Array([1, 2, 3, 4]), 'virus.exe')).toMatchObject({ ok: false });
  });

  it('derives safe display names from file names', () => {
    expect(assetNameFromFile('wooden_chair.final.glb')).toBe('wooden chair.final');
    expect(assetNameFromFile('.glb')).toBe('Imported asset');
    expect(assetNameFromFile('<img src=x onerror=1>.png')).toBe('img src=x onerror=1');
  });
});
