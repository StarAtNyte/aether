import { describe, expect, it } from 'vitest';
import { VoxelEdit } from '@aether/core';
import { ATLAS_SIZE, buildAtlas, tileAverage } from '../src/atlas';
import { CHUNK_VOLUME, cellIndex } from '../src/constants';
import { applyEdits, compileEdits } from '../src/edits';
import { TerrainGenerator } from '../src/terrain';
import { id, reg } from './helpers';

function count(dense: Uint16Array, block: number): number {
  let n = 0;
  for (let i = 0; i < dense.length; i++) if (dense[i] === block) n++;
  return n;
}

describe('block atlas', () => {
  const atlas = buildAtlas(reg);

  it('paints one tile per distinct face spec, deterministically', () => {
    expect(atlas.size).toBe(ATLAS_SIZE);
    expect(atlas.tiles).toBe(reg.tiles.length);
    expect(atlas.tiles).toBeGreaterThan(60);
    expect(buildAtlas(reg).pixels).toEqual(atlas.pixels);
  });

  it('cuts holes into leaves/glass and keeps cubes opaque', () => {
    const alphaZero = (slot: number): number => {
      let n = 0;
      const ox = (slot % 16) * 16;
      const oy = Math.floor(slot / 16) * 16;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (atlas.pixels[((oy + y) * ATLAS_SIZE + ox + x) * 4 + 3] === 0) n++;
      return n;
    };
    expect(alphaZero(reg.faceTiles[id('oak_leaves') * 3] as number)).toBeGreaterThan(10);
    expect(alphaZero(reg.faceTiles[id('glass') * 3] as number)).toBeGreaterThan(100);
    expect(alphaZero(reg.faceTiles[id('stone') * 3] as number)).toBe(0);
    const grass = tileAverage(atlas, reg.faceTiles[id('grass') * 3] as number);
    expect(grass[1]).toBeGreaterThan(grass[0]);
  });
});

describe('document edits', () => {
  const gen = new TerrainGenerator(1, 'flat', reg);

  function apply(input: unknown, cx = 0, cz = 0): Uint16Array {
    const edits = [VoxelEdit.parse(input)];
    const dense = new Uint16Array(CHUNK_VOLUME);
    gen.generate(cx, cz, dense);
    applyEdits(compileEdits(edits, reg, gen, 1), cx, cz, dense);
    return dense;
  }

  it('fills solid and hollow boxes exactly', () => {
    expect(count(apply({ shape: 'box', from: [1, 60, 1], to: [4, 62, 3], block: 'gold_block' }), id('gold_block'))).toBe(4 * 3 * 3);
    expect(count(apply({ shape: 'box', from: [1, 60, 1], to: [5, 64, 5], block: 'gold_block', hollow: true }), id('gold_block'))).toBe(125 - 27);
  });

  it('rasterises spheres, cylinders, lines and stairs', () => {
    const s = count(apply({ shape: 'sphere', center: [8, 80, 8], radius: 4, block: 'glass' }), id('glass'));
    expect(s).toBeGreaterThan(200);
    expect(s).toBeLessThan(400);
    expect(count(apply({ shape: 'cylinder', base: [8, 60, 8], radius: 2, height: 5, block: 'quartz' }), id('quartz'))).toBeGreaterThan(40);
    expect(count(apply({ shape: 'line', from: [0, 70, 0], to: [10, 70, 0], block: 'oak_log' }), id('oak_log'))).toBe(11);
    expect(count(apply({ shape: 'stairs', from: [2, 60, 2], direction: 'east', steps: 4, width: 1, block: 'bricks' }), id('bricks'))).toBe(1 + 2 + 3 + 4);
  });

  it('replaces and clears, and anchors to the surface', () => {
    const replaced = apply({ shape: 'replace', from: [0, 40, 0], to: [15, 60, 15], block: 'dirt', with: 'sand' });
    expect(count(replaced, id('dirt'))).toBe(0);
    expect(count(replaced, id('sand'))).toBeGreaterThan(0);
    const cleared = apply({ shape: 'clear', from: [0, 0, 0], to: [15, 127, 15] });
    expect(count(cleared, 0)).toBe(CHUNK_VOLUME);
    const anchored = apply({ shape: 'box', from: [3, 0, 3], to: [3, 0, 3], block: 'diamond_block', anchor: 'surface' });
    expect(anchored[cellIndex(3, 52, 3)]).toBe(id('diamond_block'));
  });

  it('stamps structures across chunk borders seamlessly', () => {
    const edit = { shape: 'structure', structure: 'castle', at: [16, 0, 16], size: 'medium' };
    let total = 0;
    for (let cz = 0; cz <= 1; cz++) for (let cx = 0; cx <= 1; cx++) total += count(apply(edit, cx, cz), id('stone_bricks'));
    expect(total).toBeGreaterThan(500);
  });

  it('carves structures up to the sky: no terrain floats above a building (regression)', () => {
    const edits = [VoxelEdit.parse({ shape: 'structure', structure: 'house', at: [8, 0, 8], anchor: 'surface' })];
    const compiled = compileEdits(edits, reg, gen, 1);
    const house = compiled[0];
    if (!house) throw new Error('house did not compile');
    expect(house.content).toBeDefined();
    expect(house.maxY).toBe(127);
    const dense = new Uint16Array(CHUNK_VOLUME);
    gen.generate(0, 0, dense);
    // An overhang (e.g. a mountain ledge) high above the site.
    const stone = id('stone');
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) dense[cellIndex(x, 110, z)] = stone;
    applyEdits(compiled, 0, 0, dense);
    expect(dense[cellIndex(8, 110, 8)]).toBe(0);
    // Outside the footprint the ledge stays.
    const outX = house.minX - 1;
    if (outX >= 0) expect(dense[cellIndex(outX, 110, 8)]).toBe(stone);
    expect(count(dense, stone)).toBeGreaterThan(0);
  });

  it('extends foundations down to the ground under raised or cliff-side structures (regression)', () => {
    // Placed 18 blocks above the flat ground (top block y = 51): no column may hang in the air.
    const dense = apply({ shape: 'structure', structure: 'house', at: [8, 70, 8], anchor: 'world' });
    const compiled = compileEdits([VoxelEdit.parse({ shape: 'structure', structure: 'house', at: [8, 70, 8], anchor: 'world' })], reg, gen, 1)[0];
    if (!compiled?.content) throw new Error('house did not compile');
    expect(compiled.minY).toBeLessThanOrEqual(52);
    for (let y = 52; y < compiled.content.minY; y++) expect(dense[cellIndex(8, y, 8)], `y ${y}`).not.toBe(0);
    // Natural ground below is untouched.
    expect(dense[cellIndex(8, 51, 8)]).toBe(id('grass'));
  });

  it('writes block text and pixel art', () => {
    expect(count(apply({ shape: 'text', text: 'HI', at: [0, 70, 0], block: 'red_wool' }), id('red_wool'))).toBe(17 + 11);
    const heart = apply({ shape: 'pixels', at: [0, 90, 2], rows: ['.#.#.', '#####', '.###.', '..#..'], palette: { '#': 'red_wool' } });
    expect(count(heart, id('red_wool'))).toBe(2 + 5 + 3 + 1);
  });
});
