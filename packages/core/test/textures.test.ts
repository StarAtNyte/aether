/** Texture sets in the World IR: schema (additive), setMeta patches, undo, diff, material and skin references. */
import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld, invertPatches, MaterialSpec, patchesBetween, validateWorld, type TextureSetDef } from '../src';

const def: TextureSetDef = { name: 'bed linen', provenance: 'photographed', tile: 0.8, tiers: [256, 512], albedoScale: 2.5, mean: '#e8e0d0' };
const ID = 'tex-0123456789ab';

describe('texture sets', () => {
  it('are optional: worlds without them stay without them', () => {
    const w = createWorld({});
    expect(w.textures).toBeUndefined();
    const v = validateWorld(JSON.parse(JSON.stringify(w)));
    expect(v.ok && 'textures' in v.world).toBe(false);
  });

  it('setMeta adds, replaces and removes a set; undo restores it', () => {
    const w0 = createWorld({});
    const r1 = applyPatches(w0, [{ op: 'setMeta', textures: { [ID]: def } }]);
    expect(r1.errors).toEqual([]);
    expect(r1.world.textures?.[ID]?.provenance).toBe('photographed');
    const inv = invertPatches(w0, r1.applied);
    expect(applyPatches(r1.world, inv).world.textures).toBeUndefined();
    const r2 = applyPatches(r1.world, [{ op: 'setMeta', textures: { [ID]: null } }]);
    expect(r2.world.textures).toBeUndefined();
    expect(patchesBetween(w0, r1.world).some((p) => p.op === 'setMeta' && p.textures?.[ID] !== undefined)).toBe(true);
  });

  it('refuse a malformed id or an unknown provenance', () => {
    const w0 = createWorld({});
    expect(applyPatches(w0, [{ op: 'setMeta', textures: { 'tex-xyz': def } }]).errors.length).toBe(1);
    expect(applyPatches(w0, [{ op: 'setMeta', textures: { [ID]: { ...def, provenance: 'stolen' as never } } }]).errors.length).toBe(1);
  });

  it('materials and pieces reference sets', () => {
    expect(MaterialSpec.safeParse({ finish: 'fabric', color: '#ffffff', texture: { id: ID, tile: 1.2 } }).success).toBe(true);
    expect(MaterialSpec.safeParse({ texture: { id: 'bad' } }).success).toBe(false);
    const w = createWorld({ entities: { b: { id: 'b', arch: { role: 'furniture', skins: { 'fabric#f7f4ee': { id: ID } } } } } });
    expect(w.entities['b']?.arch?.skins?.['fabric#f7f4ee']?.id).toBe(ID);
  });
});
