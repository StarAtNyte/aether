import { describe, expect, it } from 'vitest';
import { VOXEL_BLOCK_IDS } from '@aether/core';
import { BUILTIN_BLOCKS } from '../src/blocks';
import { ChunkData } from '../src/chunk';
import { CHUNK_VOLUME, cellIndex, chunkKey, keyX, keyZ, HEIGHT, LAYER } from '../src/constants';
import { id, reg } from './helpers';

describe('block registry', () => {
  it('matches the core vocabulary exactly, in order', () => {
    expect(Object.keys(BUILTIN_BLOCKS)).toEqual([...VOXEL_BLOCK_IDS]);
    expect(reg.type(id('stone')).id).toBe('stone');
    expect(reg.id('air')).toBe(0);
  });

  it('builds flag tables for the hot loops', () => {
    expect(reg.opaque[id('stone')]).toBe(1);
    expect(reg.opaque[id('glass')]).toBe(0);
    expect(reg.solid[id('water')]).toBe(0);
    expect(reg.render[id('poppy')]).toBe(3);
    expect(reg.emissive[id('torch')]).toBe(14);
    expect(reg.lightCost[id('oak_leaves')]).toBe(2);
  });

  it('applies custom blocks and recolours without breaking behaviour', () => {
    const r = new (reg.constructor as typeof import('../src/blocks').BlockRegistry)([
      { id: 'marble', color: '#eeeeee', pattern: 'tiles', solid: true, transparent: false, liquid: false, emissive: 0, hardness: 2 },
      { id: 'grass', color: '#aa66cc', pattern: 'noise', solid: true, transparent: false, liquid: false, emissive: 0, hardness: 0.6 },
    ]);
    expect(r.id('marble')).toBe(VOXEL_BLOCK_IDS.length + 1);
    expect(r.type(r.id('grass') as number).drops).toBe('dirt');
    expect(r.type(r.id('grass') as number).side.pattern).toBe('grass_side');
  });
});

describe('ChunkData', () => {
  it('round-trips random writes through palette growth (0 → 16 bits)', () => {
    const c = ChunkData.filled(0);
    expect(c.bits).toBe(0);
    const ref = new Uint16Array(CHUNK_VOLUME);
    let s = 12345;
    const rand = (n: number): number => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s % n;
    };
    for (let k = 0; k < 20000; k++) {
      const i = rand(CHUNK_VOLUME);
      const v = rand(k < 10000 ? 12 : 300);
      c.set(i, v);
      ref[i] = v;
    }
    for (let v = 0; v < 300; v++) {
      c.set(v * 97, 1000 + v);
      ref[v * 97] = 1000 + v;
    }
    expect(c.bits).toBe(16);
    const dense = c.toDense(new Uint16Array(CHUNK_VOLUME));
    expect(dense).toEqual(ref);
  });

  it('packs typical terrain into ≤ 4 bits per cell', () => {
    const dense = new Uint16Array(CHUNK_VOLUME);
    for (let y = 0; y < 60; y++) dense.fill(y < 50 ? id('stone') : y < 59 ? id('dirt') : id('grass'), y * LAYER, (y + 1) * LAYER);
    const c = ChunkData.fromDense(dense);
    expect(c.bits).toBe(2);
    expect(c.byteLength).toBeLessThan(CHUNK_VOLUME / 2);
    expect(c.topY()).toBe(59);
  });

  it('validates packed data from untrusted sources', () => {
    const c = ChunkData.fromDense(new Uint16Array(CHUNK_VOLUME).fill(3));
    c.set(cellIndex(1, 2, 3), 5);
    const p = c.pack();
    expect(ChunkData.fromPacked(p, 10)?.get(cellIndex(1, 2, 3))).toBe(5);
    // Id above the registry.
    expect(ChunkData.fromPacked(p, 4)).toBeNull();
    // Wrong word count.
    expect(ChunkData.fromPacked({ ...p, words: new Uint32Array(3) }, 10)).toBeNull();
    // Index pointing past the palette.
    const bad = { palette: new Uint16Array([1, 2, 3]), bits: 2, words: new Uint32Array((CHUNK_VOLUME * 2) / 32).fill(0xffffffff) };
    expect(ChunkData.fromPacked(bad, 10)).toBeNull();
    expect(ChunkData.fromPacked({ palette: new Uint16Array([1]), bits: 3, words: new Uint32Array(0) }, 10)).toBeNull();
  });

  it('expands partial row ranges and answers palette queries', () => {
    const dense = new Uint16Array(CHUNK_VOLUME);
    dense.fill(id('stone'), 0, 10 * LAYER);
    dense[cellIndex(4, 5, 6)] = id('torch');
    const c = ChunkData.fromDense(dense);
    const out = new Uint16Array(CHUNK_VOLUME).fill(999);
    c.toDenseRows(out, 6);
    expect(out[cellIndex(4, 5, 6)]).toBe(id('torch'));
    expect(out[6 * LAYER]).toBe(999);
    expect(c.hasAny(reg.emissive)).toBe(true);
    expect(ChunkData.fromDense(new Uint16Array(CHUNK_VOLUME)).hasAny(reg.emissive)).toBe(false);
  });

  it('chunk keys are unique and reversible', () => {
    for (const [x, z] of [[0, 0], [-1, 0], [5, -7], [-32000, 32000]] as const) {
      const k = chunkKey(x, z);
      expect([keyX(k), keyZ(k)]).toEqual([x, z]);
    }
    expect(HEIGHT).toBe(128);
  });
});
