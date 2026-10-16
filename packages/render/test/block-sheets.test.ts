import { describe, expect, it } from 'vitest';
import { parseSheetIndex, sheetToLayers } from '../src/voxel/block-sheets';
import { SunShadowField } from '../src/voxel/shadow-field';

const good = { size: 64, columns: 2, rows: 2, materials: [{ key: 'grass', slot: 0, mean: [0.1, 0.2, 0.05] }, { key: 'dirt', slot: 3, mean: [0.2, 0.1, 0.05] }] };

describe('block sheet index', () => {
  it('accepts a well-formed index', () => {
    const p = parseSheetIndex(good);
    expect(p?.materials.map((m) => m.key)).toEqual(['grass', 'dirt']);
  });
  it('rejects malformed or hostile indexes', () => {
    expect(parseSheetIndex(null)).toBeNull();
    expect(parseSheetIndex({ ...good, size: 100 })).toBeNull();
    expect(parseSheetIndex({ ...good, size: 4096 })).toBeNull();
    expect(parseSheetIndex({ ...good, columns: 0 })).toBeNull();
    expect(parseSheetIndex({ ...good, materials: [] })).toBeNull();
    expect(parseSheetIndex({ ...good, materials: [{ key: 'a b', slot: 0, mean: [0, 0, 0] }] })).toBeNull();
    expect(parseSheetIndex({ ...good, materials: [{ key: 'grass', slot: 9, mean: [0, 0, 0] }] })).toBeNull();
    expect(parseSheetIndex({ ...good, materials: [{ key: 'grass', slot: 0, mean: [0, 0, 2] }] })).toBeNull();
    expect(parseSheetIndex({ ...good, materials: [good.materials[0], good.materials[0]] })).toBeNull();
  });
  it('cuts a sheet into layers in row-major slot order', () => {
    const size = 2;
    const cols = 2;
    const w = size * cols;
    const sheet = new Uint8Array(w * size * 2 * 4);
    // Fill each 2 × 2 tile with its slot number in the red channel.
    for (let slot = 0; slot < 4; slot++) {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) sheet[(((Math.floor(slot / cols) * size + y) * w) + (slot % cols) * size + x) * 4] = slot + 1;
    }
    const layers = sheetToLayers(sheet, w, size, cols, 4);
    expect(layers.length).toBe(4 * size * size * 4);
    for (let slot = 0; slot < 4; slot++) expect(layers[slot * size * size * 4]).toBe(slot + 1);
  });
});

describe('sun shadow field', () => {
  it('stores chunk columns, wraps around and clears', () => {
    const f = new SunShadowField(64);
    const h = new Uint8Array(512);
    h[3 + 5 * 16] = 77;
    h[256 + 3 + 5 * 16] = 33;
    f.setChunk(1, 2, h);
    expect(f.solidTop(16 + 3, 32 + 5)).toBe(77);
    expect(f.foliageTop(16 + 3, 32 + 5)).toBe(33);
    // 64 blocks wide: chunk 5 lands where chunk 1 was.
    expect(f.solidTop(16 + 3 + 64, 32 + 5)).toBe(77);
    expect(f.solidTop(-64 + 19, 37)).toBe(77);
    f.setChunk(1, 2, null);
    expect(f.solidTop(19, 37)).toBe(0);
    f.setChunk(1, 2, new Uint8Array(3));
    expect(f.solidTop(19, 37)).toBe(0);
  });
  it('uploads once per change', () => {
    const f = new SunShadowField(64);
    expect(f.flush()).toBe(false);
    f.setChunk(0, 0, new Uint8Array(512));
    expect(f.flush()).toBe(true);
    expect(f.flush()).toBe(false);
  });
});
