import { describe, expect, it } from 'vitest';
import { hudEqual, type VoxelHudState } from '../src/voxel/hudState';
import { ICON, paintItemIcons } from '../src/voxel/itemIcons';
import { MemoryVoxelStore, parseChunkKey } from '../src/voxel/saveStore';

function hud(over: Partial<VoxelHudState> = {}): VoxelHudState {
  return {
    mode: 'survival', loading: null, health: 20, hunger: 20, air: 10, dead: false, deathCause: '', slots: [{ item: 'stone', label: 'Stone', count: 3, icon: { kind: 'block', top: 1, side: 1, flat: false } }, null],
    selected: 0, inventoryOpen: false, recipes: [], nearTable: false, hour: 8, day: 0, locked: true, view: 'first', flying: false, target: '', position: [0, 60, 0],
    atlasUrl: 'a', itemsUrl: 'b', itemCount: 3, toast: '', ...over,
  };
}

describe('voxel HUD snapshot', () => {
  it('compares by value so unchanged frames do not re-render', () => {
    expect(hudEqual(hud(), hud())).toBe(true);
    expect(hudEqual(hud(), hud({ health: 19 }))).toBe(false);
    expect(hudEqual(hud(), hud({ slots: [{ item: 'stone', label: 'Stone', count: 4, icon: { kind: 'block', top: 1, side: 1, flat: false } }, null] }))).toBe(false);
    expect(hudEqual(hud(), hud({ position: [1, 60, 0] }))).toBe(false);
    expect(hudEqual(null, null)).toBe(true);
    expect(hudEqual(hud(), null)).toBe(false);
  });
});

describe('item icons', () => {
  it('paints a distinct opaque icon per item', () => {
    const items = [{ id: 'stick', color: '#8a6a3e' }, { id: 'diamond', color: '#5fe3e0' }, { id: 'iron_pickaxe', color: '#d6d6d6' }, { id: 'apple', color: '#d8312b' }];
    const px = paintItemIcons(items);
    expect(px.length).toBe(ICON * items.length * ICON * 4);
    const icon = (k: number): number[] => {
      const out: number[] = [];
      for (let y = 0; y < ICON; y++) for (let x = 0; x < ICON; x++) out.push(px[((y * ICON * items.length) + k * ICON + x) * 4 + 3] as number);
      return out;
    };
    for (let k = 0; k < items.length; k++) expect(icon(k).filter((a) => a === 255).length).toBeGreaterThan(8);
    expect(icon(0)).not.toEqual(icon(1));
  });
});

describe('voxel save store', () => {
  it('keeps saves apart by key and clears them', async () => {
    const s = new MemoryVoxelStore();
    await s.putChunks('p1::survival:1:0', [{ cx: 0, cz: -1, bytes: new Uint8Array([1]) }, { cx: 3, cz: 4, bytes: new Uint8Array([2]) }]);
    await s.putChunks('p2::survival:1:0', [{ cx: 0, cz: 0, bytes: new Uint8Array([3]) }]);
    expect((await s.listChunks('p1::survival:1:0')).sort()).toEqual(['0,-1', '3,4']);
    expect(await s.getChunk('p1::survival:1:0', 3, 4)).toEqual(new Uint8Array([2]));
    await s.clear('p1::survival:1:0');
    expect(await s.listChunks('p1::survival:1:0')).toEqual([]);
    expect(await s.listChunks('p2::survival:1:0')).toEqual(['0,0']);
  });

  it('parses chunk keys strictly', () => {
    expect(parseChunkKey('-3,17')).toEqual([-3, 17]);
    expect(parseChunkKey('1,2,3')).toBeNull();
    expect(parseChunkKey('99999,0')).toBeNull();
    expect(parseChunkKey('16384,0')).toBeNull();
    expect(parseChunkKey('__proto__')).toBeNull();
  });
});
