import { describe, expect, it } from 'vitest';
import { Mesh, MeshStandardMaterial, BoxGeometry, Texture } from 'three';
import { TEXTURE_ANISOTROPY, sharpenObject } from '../src/materials/anisotropy';

describe('texture anisotropy', () => {
  it('raises every map of a loaded model and keeps a higher value', () => {
    const a = new Texture();
    const b = new Texture();
    b.anisotropy = 32;
    const m = new MeshStandardMaterial({ map: a, normalMap: b });
    sharpenObject(new Mesh(new BoxGeometry(), m).add(new Mesh()) as never);
    const root = new Mesh(new BoxGeometry(), m);
    sharpenObject(root);
    expect(a.anisotropy).toBe(TEXTURE_ANISOTROPY);
    expect(b.anisotropy).toBe(32);
  });
});
