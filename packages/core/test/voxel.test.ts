import { describe, expect, it } from 'vitest';
import {
  applyPatches,
  createWorld,
  diffWorlds,
  invertPatches,
  isEmptyDiff,
  LIMITS,
  patchesBetween,
  summarizeWorld,
  validateWorld,
  VOXEL_BLOCK_IDS,
  voxelEditVolume,
  VoxelEdit,
  type WorldDoc,
} from '../src/index';
import { deepFreeze } from './helpers';

function voxelWorld(extra: Record<string, unknown> = {}): WorldDoc {
  const r = applyPatches(createWorld({ seed: 7 }), [{ op: 'setVoxel', set: { preset: 'plains', ...extra } }]);
  expect(r.errors).toEqual([]);
  return deepFreeze(r.world);
}

describe('voxel terrain IR', () => {
  it('worlds without voxel terrain stay valid and unchanged (backward compatible)', () => {
    const w = createWorld({ name: 'old' });
    expect(w.voxel).toBeUndefined();
    expect('voxel' in w).toBe(false);
    expect(validateWorld(JSON.parse(JSON.stringify(w))).ok).toBe(true);
  });

  it('setVoxel creates terrain with defaults and merges later settings', () => {
    const w = voxelWorld();
    expect(w.voxel?.preset).toBe('plains');
    expect(w.voxel?.viewDistance).toBe(6);
    expect(w.voxel?.game.mode).toBe('survival');
    const r = applyPatches(w, [{ op: 'setVoxel', set: { viewDistance: 8, game: { dayLength: 120 } } }]);
    expect(r.errors).toEqual([]);
    expect(r.world.voxel?.preset).toBe('plains');
    expect(r.world.voxel?.viewDistance).toBe(8);
    expect(r.world.voxel?.game.dayLength).toBe(120);
    expect(r.world.voxel?.game.mode).toBe('survival');
  });

  it('setVoxel null removes the terrain; an identical set keeps identity', () => {
    const w = voxelWorld();
    expect(applyPatches(w, [{ op: 'setVoxel', set: { preset: 'plains' } }]).world).toBe(w);
    const r = applyPatches(w, [{ op: 'setVoxel', set: null }]);
    expect(r.errors).toEqual([]);
    expect(r.world.voxel).toBeUndefined();
  });

  it('rejects unknown fields, blocks and items with hints', () => {
    const w = voxelWorld();
    const bad = applyPatches(w, [{ op: 'setVoxel', set: { viewDistanse: 4 } }]);
    expect(bad.errors[0]?.message).toMatch(/viewDistance/);
    const block = applyPatches(w, [{ op: 'voxelEdit', edits: [{ shape: 'box', from: [0, 50, 0], to: [2, 52, 2], block: 'stonee' }] }]);
    expect(block.errors[0]?.message).toMatch(/unknown block 'stonee'.*did you mean 'stone'/);
    const item = applyPatches(w, [{ op: 'setVoxel', set: { game: { startItems: [{ item: 'wodden_pickaxe', count: 1 }] } } }]);
    expect(item.errors[0]?.message).toMatch(/wooden_pickaxe/);
  });

  it('voxelEdit appends edits in order, accepts air and custom blocks', () => {
    const w = voxelWorld({ blocks: [{ id: 'marble', color: '#eeeeee' }] });
    const r = applyPatches(w, [
      { op: 'voxelEdit', edits: [{ shape: 'box', from: [0, 50, 0], to: [4, 54, 4], block: 'marble', hollow: true }] },
      { op: 'voxelEdit', edits: [{ shape: 'clear', from: [1, 51, 1], to: [1, 52, 1] }, { shape: 'sphere', center: [10, 60, 10], radius: 3, block: 'air' }] },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.world.voxel?.edits.map((e) => e.shape)).toEqual(['box', 'clear', 'sphere']);
  });

  it('voxelEdit without terrain explains how to create it', () => {
    const r = applyPatches(createWorld({}), [{ op: 'voxelEdit', edits: [{ shape: 'box', from: [0, 0, 0], to: [1, 1, 1], block: 'stone' }] }]);
    expect(r.errors[0]?.message).toMatch(/setVoxel/);
  });

  it('enforces the per-patch block limit (2M) and the edit count limit', () => {
    const w = voxelWorld();
    // 200 × 100 × 200 = 4M blocks.
    const big = applyPatches(w, [{ op: 'voxelEdit', edits: [{ shape: 'box', from: [0, 0, 0], to: [199, 99, 199], block: 'stone' }] }]);
    expect(big.errors[0]?.message).toMatch(/max 2000000 per patch/);
    // Exactly at the limit passes: 125 × 128 × 125 = 2,000,000.
    const ok = applyPatches(w, [{ op: 'voxelEdit', edits: [{ shape: 'box', from: [0, 0, 0], to: [124, 127, 124], block: 'stone' }] }]);
    expect(ok.errors).toEqual([]);
    const tooMany = applyPatches(w, [{ op: 'setVoxel', set: { edits: Array.from({ length: LIMITS.MAX_VOXEL_EDITS + 1 }, () => ({ shape: 'clear', from: [0, 0, 0], to: [0, 0, 0] })) } }]);
    expect(tooMany.errors.length).toBe(1);
  });

  it('caps the total edited volume of a world', () => {
    let w = voxelWorld();
    const edit = { shape: 'box', from: [0, 0, 0], to: [124, 127, 124], block: 'stone' };
    for (let i = 0; i < 16; i++) w = applyPatches(w, [{ op: 'voxelEdit', edits: [edit] }]).world;
    expect(w.voxel?.edits.length).toBe(16);
    const r = applyPatches(w, [{ op: 'voxelEdit', edits: [edit] }]);
    expect(r.errors[0]?.message).toMatch(/in total/);
  });

  it('volume bounds are conservative for every shape', () => {
    const shapes: unknown[] = [
      { shape: 'box', from: [0, 0, 0], to: [3, 3, 3], block: 'stone' },
      { shape: 'sphere', center: [0, 0, 0], radius: 2.5, block: 'stone' },
      { shape: 'cylinder', base: [0, 0, 0], radius: 3, height: 10, block: 'stone' },
      { shape: 'line', from: [0, 0, 0], to: [10, 5, 0], block: 'stone' },
      { shape: 'stairs', from: [0, 0, 0], direction: 'north', steps: 6, block: 'stone' },
      { shape: 'structure', structure: 'castle', at: [0, 0, 0], size: 'large' },
      { shape: 'pixels', at: [0, 0, 0], rows: ['.xx.', 'xxxx'], palette: { x: 'red_wool' } },
      { shape: 'text', text: 'HI', at: [0, 0, 0], block: 'gold_block' },
      { shape: 'replace', from: [0, 0, 0], to: [1, 1, 1], block: 'stone', with: 'gold_block' },
      { shape: 'clear', from: [0, 0, 0], to: [9, 0, 0] },
    ];
    for (const raw of shapes) {
      const e = VoxelEdit.parse(raw);
      expect(voxelEditVolume(e)).toBeGreaterThan(0);
    }
    expect(voxelEditVolume(VoxelEdit.parse(shapes[0]))).toBe(64);
    expect(voxelEditVolume(VoxelEdit.parse(shapes[9]))).toBe(10);
  });

  it('rejects hostile palette keys and oversized pixel art', () => {
    const w = voxelWorld();
    const proto = applyPatches(w, [{ op: 'voxelEdit', edits: [JSON.parse('{"shape":"pixels","at":[0,60,0],"rows":["x"],"palette":{"__proto__":"stone"}}')] }]);
    expect(proto.errors.length).toBe(1);
    const rows = Array.from({ length: 200 }, () => 'x');
    const big = applyPatches(w, [{ op: 'voxelEdit', edits: [{ shape: 'pixels', at: [0, 60, 0], rows, palette: { x: 'stone' } }] }]);
    expect(big.errors.length).toBe(1);
  });

  it('diff reports voxel changes; invert and patchesBetween restore exactly', () => {
    const base = voxelWorld();
    const steps = [
      { op: 'voxelEdit', edits: [{ shape: 'structure', structure: 'house', at: [5, 0, 5] }] },
      { op: 'setVoxel', set: { preset: 'desert', game: { mode: 'creative' } } },
    ];
    const after = applyPatches(base, steps).world;
    const d = diffWorlds(base, after);
    expect(d.voxelChanged).toBe(true);
    expect(isEmptyDiff(d)).toBe(false);
    const undo = invertPatches(base, applyPatches(base, steps).applied);
    expect(applyPatches(after, undo).world).toEqual(base);
    // Adding and removing the whole terrain round-trips too.
    const plain = createWorld({ seed: 7 });
    expect(applyPatches(plain, patchesBetween(plain, after)).world).toEqual(after);
    expect(applyPatches(after, patchesBetween(after, plain)).world).toEqual(plain);
  });

  it('clear with keepEnvironment:false removes the terrain, keepEnvironment keeps it', () => {
    const w = voxelWorld();
    expect(applyPatches(w, [{ op: 'clear', keepEnvironment: false }]).world.voxel).toBeUndefined();
    expect(applyPatches(w, [{ op: 'clear' }]).world.voxel).toEqual(w.voxel);
  });

  it('validateWorld checks voxel references of imported documents', () => {
    const w = voxelWorld();
    const json = JSON.parse(JSON.stringify(w)) as Record<string, unknown>;
    (json['voxel'] as Record<string, unknown>)['edits'] = [{ shape: 'box', from: [0, 0, 0], to: [1, 1, 1], block: 'unobtainium' }];
    const r = validateWorld(json);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]?.path).toBe('voxel');
  });

  it('custom blocks may not shadow items, be defined twice or redefine air', () => {
    const w = createWorld({});
    for (const blocks of [[{ id: 'stick', color: '#ffffff' }], [{ id: 'a', color: '#ffffff' }, { id: 'a', color: '#000000' }], [{ id: 'air', color: '#ffffff' }]]) {
      expect(applyPatches(w, [{ op: 'setVoxel', set: { blocks } }]).errors.length).toBe(1);
    }
    // A built-in id recolors the built-in block.
    expect(applyPatches(w, [{ op: 'setVoxel', set: { blocks: [{ id: 'grass', color: '#88aa44' }] } }]).errors).toEqual([]);
  });

  it('summary lists terrain, game settings and the newest edits', () => {
    const w = applyPatches(voxelWorld(), [
      { op: 'voxelEdit', edits: [{ shape: 'structure', structure: 'castle', size: 'large', at: [0, 0, 20] }, { shape: 'text', text: 'HELLO', block: 'gold_block', at: [0, 30, 0], anchor: 'surface' }] },
    ]).world;
    const s = summarizeWorld(w);
    expect(s).toMatch(/^voxel preset=plains seed=7 view=6 edits=2$/m);
    expect(s).toMatch(/^voxel-game mode=survival day=600s start=8h mobs=sheep,pig,chicken\/zombie,spider$/m);
    expect(s).toMatch(/voxel-edit 0: structure castle large at=0,0,20 facing=south above ground/);
    expect(s).toMatch(/voxel-edit 1: text "HELLO" gold_block at=0,30,0 plane=xy above ground/);
  });

  it('every built-in block id is a valid block id', () => {
    for (const id of VOXEL_BLOCK_IDS) expect(/^[a-z][a-z0-9_]{0,31}$/.test(id)).toBe(true);
    expect(new Set(VOXEL_BLOCK_IDS).size).toBe(VOXEL_BLOCK_IDS.length);
  });
});
