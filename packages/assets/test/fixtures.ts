/**
 * Test fixtures: tiny glTF / GLB / image / HDR files built in memory, and a
 * small catalog.
 */
import { writeGlb } from '../src/import/glb';
import type { CatalogInput } from '../src/schema';

/** One triangle (positions + indices) as a BIN chunk and matching glTF JSON. */
export function triangleGltf(opts: { translate?: [number, number, number]; scale?: number; extra?: Record<string, unknown> } = {}): { json: Record<string, unknown>; bin: Uint8Array } {
  const s = opts.scale ?? 1;
  const pos = new Float32Array([0, 0, 0, s, 0, 0, 0, s, 0]);
  const idx = new Uint16Array([0, 1, 2, 0]); // padded to 4-byte alignment
  const bin = new Uint8Array(pos.byteLength + idx.byteLength);
  bin.set(new Uint8Array(pos.buffer), 0);
  bin.set(new Uint8Array(idx.buffer), pos.byteLength);
  const json: Record<string, unknown> = {
    asset: { version: '2.0', generator: 'test' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'tri', mesh: 0, ...(opts.translate ? { translation: opts.translate } : {}) }],
    meshes: [{ name: 'tri', primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.byteLength },
      { buffer: 0, byteOffset: pos.byteLength, byteLength: 6 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [s, s, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    ...opts.extra,
  };
  return { json, bin };
}

/** A GLB of {@link triangleGltf}. */
export function triangleGlb(opts: Parameters<typeof triangleGltf>[0] = {}): Uint8Array {
  const { json, bin } = triangleGltf(opts);
  return writeGlb(json, bin);
}

/** A `.gltf` (JSON text bytes) with the buffer as a data URI. */
export function triangleGltfText(extra: Record<string, unknown> = {}): Uint8Array {
  const { json, bin } = triangleGltf({ extra });
  let b = '';
  for (const c of bin) b += String.fromCharCode(c);
  (json['buffers'] as Array<Record<string, unknown>>)[0]!['uri'] = `data:application/octet-stream;base64,${btoa(b)}`;
  return new TextEncoder().encode(JSON.stringify(json));
}

/** Minimal PNG header (signature + IHDR) of the given size. */
export function pngHeader(w: number, h: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const dv = new DataView(b.buffer);
  dv.setUint32(16, w);
  dv.setUint32(20, h);
  b[24] = 8;
  b[25] = 6;
  return b;
}

/** Minimal baseline JPEG header (SOI + SOF0) of the given size. */
export function jpegHeader(w: number, h: number): Uint8Array {
  const b = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0, 0, 0, 0, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  const dv = new DataView(b.buffer);
  dv.setUint16(25, h);
  dv.setUint16(27, w);
  return b;
}

/** Minimal Radiance HDR header. */
export function hdrHeader(w: number, h: number, format = '32-bit_rle_rgbe'): Uint8Array {
  return new TextEncoder().encode(`#?RADIANCE\nFORMAT=${format}\n\n-Y ${h} +X ${w}\n\u0000\u0000\u0000\u0000`);
}

/** A small valid catalog for unit tests. */
export const TEST_CATALOG: CatalogInput = {
  version: 1,
  base: '/assets/lib/',
  packs: [
    { id: 'kenney-furniture-kit', title: 'Kenney Furniture Kit', author: 'Kenney (www.kenney.nl)', licence: 'CC0-1.0', licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', url: 'https://kenney.nl/assets/furniture-kit', version: '2.0' },
    { id: 'polyhaven', title: 'Poly Haven', author: 'Poly Haven contributors', licence: 'CC0-1.0', licenceUrl: 'https://polyhaven.com/license', url: 'https://polyhaven.com', version: '1' },
    { id: 'byPack', title: 'Attributed Pack', author: 'Some Artist', licence: 'CC-BY-4.0', licenceUrl: 'https://creativecommons.org/licenses/by/4.0/', url: 'https://example.org/pack', version: '1' },
  ],
  entries: [
    { id: 'sofa', name: 'Sofa', kind: 'model', category: 'furniture', tags: ['sofa', 'couch', 'settee', 'living', 'furniture'], style: 'low-poly', pack: 'kenney-furniture-kit', size: [2, 0.9, 0.9], tris: 128, bytes: 9000, file: 'm/sofa.0123abcd.glb', lods: [], thumb: 't/sofa.0123abcd.webp', collider: { type: 'box' }, placement: 'floor', facing: '+z', variants: ['sofa-long'], source: 'furniture-kit/sofa.glb' },
    { id: 'sofa-long', name: 'Long sofa', kind: 'model', category: 'furniture', tags: ['sofa', 'couch'], style: 'low-poly', pack: 'kenney-furniture-kit', size: [3, 0.9, 0.9], tris: 160, bytes: 9500, file: 'm/sofa-long.0123abcd.glb', lods: [], collider: { type: 'box' }, placement: 'floor', facing: '+z', variants: ['sofa'], source: 'x' },
    { id: 'armchair-classic', name: 'Classic armchair', kind: 'model', category: 'furniture', tags: ['armchair', 'realistic', 'chair'], style: 'realistic', pack: 'polyhaven', authors: ['Kirill Sannikov'], size: [0.85, 1.06, 0.77], tris: 5626, bytes: 800_000, file: 'm/armchair-classic.0123abcd.glb', lods: [{ file: 'm/armchair-classic.lod1.0123abcd.glb', tris: 2800 }, { file: 'm/armchair-classic.lod2.0123abcd.glb', tris: 840 }], collider: { type: 'box' }, placement: 'floor', facing: '+z', source: 'x' },
    { id: 'tree-oak', name: 'Oak tree', kind: 'model', category: 'nature', tags: ['tree', 'oak'], style: 'low-poly', pack: 'kenney-furniture-kit', size: [3, 6, 3], tris: 200, bytes: 9000, file: 'm/tree-oak.0123abcd.glb', lods: [], collider: { type: 'hull', points: [-100, 0, -100, 100, 0, -100, 100, 0, 100, -100, 0, 100, 0, 600, 0] }, placement: 'floor', facing: '+z', source: 'x' },
    { id: 'man', name: 'Man', kind: 'model', category: 'characters', tags: ['man', 'person', 'character'], style: 'stylised', pack: 'kenney-furniture-kit', size: [2, 1.75, 0.9], tris: 700, bytes: 140_000, file: 'm/man.0123abcd.glb', lods: [], collider: { type: 'capsule' }, placement: 'floor', facing: '-z', anims: { idle: 'idle', walk: 'walk', run: 'sprint', clips: ['idle', 'walk', 'sprint'] }, source: 'x' },
    { id: 'police-car', name: 'Police car', kind: 'model', category: 'vehicles', tags: ['police', 'car', 'cop'], style: 'low-poly', pack: 'byPack', size: [2.2, 1.9, 4.6], tris: 2000, bytes: 170_000, file: 'm/police-car.0123abcd.glb', lods: [], collider: { type: 'box' }, placement: 'floor', facing: '-z', source: 'x' },
    { id: 'wall-lamp', name: 'Wall lamp', kind: 'model', category: 'lighting', tags: ['lamp', 'sconce'], style: 'low-poly', pack: 'kenney-furniture-kit', size: [0.5, 0.2, 0.3], tris: 50, bytes: 4000, file: 'm/wall-lamp.0123abcd.glb', lods: [], collider: { type: 'box' }, placement: 'wall', facing: '+z', source: 'x' },
    { id: 'sky-venice-sunset', name: 'Venice Sunset', kind: 'hdri', category: 'sky', tags: ['sky', 'sunset'], style: 'realistic', pack: 'polyhaven', authors: ['Greg Zaal'], size: [0, 0, 0], tris: 0, bytes: 1_500_000, file: 'h/sky-venice-sunset.0123abcd.hdr', lods: [], collider: { type: 'box' }, placement: 'floor', facing: '+z', source: 'x' },
    { id: 'ornate-fountain', name: 'Ornate fountain', kind: 'generator', category: 'street', tags: ['fountain'], style: 'stylised', pack: 'polyhaven', size: [3, 2.5, 3], tris: 0, bytes: 0, lods: [], collider: { type: 'box' }, placement: 'floor', facing: '+z', generator: { id: 'hero-fountain', params: { tiers: 3 } }, source: 'x' },
  ],
};
