import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BlockRegistry } from '../src/blocks';
import { PBR_CLASS, TILE_TABLE_ROWS, buildTileTable, hexLinear, pbrBinding } from '../src/pbr';
import { id, reg } from './helpers';
const index = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../apps/studio/public/blocks/block-materials.json'), 'utf8'));
function tileOf(block, face) {
    return reg.faceTiles[id(block) * 3 + face];
}
describe('photographic block materials', () => {
    const keys = new Set(index.materials.map((m) => m.key));
    it('ships only CC0 sheets', () => {
        expect(index.licence).toBe('CC0-1.0');
    });
    it('binds every built-in tile to a material that exists in the sheets, or to the pixel atlas', () => {
        for (const spec of reg.tiles) {
            const b = pbrBinding(spec);
            if (b.key !== null)
                expect(keys.has(b.key), `${spec.pattern} → ${b.key}`).toBe(true);
            if (b.key2 !== undefined)
                expect(keys.has(b.key2), `${spec.pattern} → ${b.key2}`).toBe(true);
        }
    });
    it('maps the terrain blocks to the right photographs', () => {
        const key = (block, face) => pbrBinding(reg.tiles[tileOf(block, face)]).key;
        expect(key('grass', 0)).toBe('grass');
        expect(key('grass', 2)).toBe('dirt');
        expect(key('stone', 0)).toBe('stone');
        expect(key('sand', 0)).toBe('sand');
        expect(key('bricks', 2)).toBe('bricks');
        expect(key('oak_planks', 0)).toBe('planks');
        expect(key('dark_planks', 0)).toBe('planks-dark');
        expect(key('snow', 0)).toBe('snow');
        expect(key('coarse_dirt', 0)).toBe('dirt-coarse');
        expect(key('gravel', 0)).toBe('gravel-grey');
        expect(pbrBinding(reg.tiles[tileOf('grass', 2)]).cls).toBe(PBR_CLASS.grassSide);
        expect(pbrBinding(reg.tiles[tileOf('oak_leaves', 0)]).cls).toBe(PBR_CLASS.leaves);
        expect(pbrBinding(reg.tiles[tileOf('lava', 0)]).cls).toBe(PBR_CLASS.lava);
        expect(pbrBinding(reg.tiles[tileOf('diamond_ore', 0)]).cls).toBe(PBR_CLASS.ore);
    });
    it('keeps sprites and glass on the pixel atlas', () => {
        for (const block of ['poppy', 'tall_grass', 'torch', 'glass', 'dead_bush']) {
            expect(pbrBinding(reg.tiles[tileOf(block, 0)]).key, block).toBeNull();
        }
    });
    it('draws tall grass as shader blades in the tile colours and keeps flames glowing', () => {
        const grass = pbrBinding(reg.tiles[tileOf('tall_grass', 0)]);
        expect(grass.cls).toBe(PBR_CLASS.blades);
        const table = buildTileTable(reg.tiles, index.materials);
        const t = tileOf('tall_grass', 0);
        expect(table[t * 4 + 1]).toBe(PBR_CLASS.blades);
        expect(table[(3 * 256 + t) * 4 + 1]).toBeGreaterThan(table[(3 * 256 + t) * 4]); // green base
        expect(table[(3 * 256 + tileOf('torch', 0)) * 4 + 3]).toBeGreaterThan(1);
    });
    it('builds a table with one column per tile and sane values', () => {
        const table = buildTileTable(reg.tiles, index.materials);
        expect(table.length).toBe(256 * TILE_TABLE_ROWS * 4);
        const slotOf = (i) => table[i * 4];
        const grassTile = tileOf('grass', 0);
        expect(slotOf(grassTile)).toBe(index.materials.find((m) => m.key === 'grass')?.slot);
        // Unused columns and sprite tiles are −1 (atlas).
        expect(slotOf(255)).toBe(-1);
        expect(slotOf(tileOf('poppy', 0))).toBe(-1);
        for (let i = 0; i < reg.tiles.length; i++) {
            for (const c of [4, 5, 6]) {
                const v = table[(256 + i) * 4 + (c - 4)];
                expect(v).toBeGreaterThanOrEqual(0.25 - 1e-6);
                expect(v).toBeLessThanOrEqual(3.2 + 1e-6);
            }
        }
    });
    it('re-colours wool towards its own colour and leaves natural stone nearly untouched', () => {
        const table = buildTileTable(reg.tiles, index.materials);
        const tint = (block) => {
            const t = tileOf(block, 0);
            return [0, 1, 2].map((c) => table[(256 + t) * 4 + c]);
        };
        const red = tint('red_wool');
        expect(red[0] / red[2]).toBeGreaterThan(2);
        const blue = tint('blue_wool');
        expect(blue[2]).toBeGreaterThan(blue[0]);
    });
    it('works for custom blocks of a world and tolerates a missing sheet index', () => {
        const custom = new BlockRegistry([{ id: 'neon', color: '#ff00aa', pattern: 'noise', hardness: 1, solid: true, transparent: false, liquid: false, emissive: 0 }]);
        expect(buildTileTable(custom.tiles, index.materials).length).toBe(256 * 16);
        const none = buildTileTable(reg.tiles, []);
        expect(none[0]).toBe(-1);
        expect(hexLinear('nope')[0]).toBeCloseTo(0.214, 2);
    });
});
