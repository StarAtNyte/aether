import { describe, expect, it, vi } from 'vitest';
import { BufferAttribute, BufferGeometry } from 'three';
import { setPositionBounds } from '../src/geometry/position-bounds';

function compare(positions: Float32Array) {
  const a = new BufferGeometry().setAttribute('position', new BufferAttribute(positions, 3));
  const b = new BufferGeometry().setAttribute('position', new BufferAttribute(positions, 3));
  a.computeBoundingBox(); a.computeBoundingSphere(); setPositionBounds(b, positions);
  expect(b.boundingBox).toEqual(a.boundingBox); expect(b.boundingSphere).toEqual(a.boundingSphere);
  a.dispose(); b.dispose();
}
describe('packed procedural geometry bounds', () => {
  it('matches native bounds exactly for empty, degenerate and offset geometry', () => {
    for (const values of [[], [0,0,0], [7,-4,2,7,-4,2], [-2,5,9,8,-3,4,3,3,4]]) compare(new Float32Array(values));
  });
  it('matches native bounds across generated meshes and position edits', () => {
    let seed = 78243;
    for (const count of [3, 100, 10000]) {
      const p = new Float32Array(count * 3);
      for (let i=0;i<p.length;i++) { seed=(Math.imul(seed,1664525)+1013904223)>>>0; p[i]=(seed/4294967296-.5)*2000; }
      compare(p);p[0]=1e10;compare(p);
    }
  });
  it('reuses existing bound objects across in-place edits', () => {
    const p = new Float32Array([0,0,0,1,2,3]);
    const g = new BufferGeometry().setAttribute('position', new BufferAttribute(p, 3));
    setPositionBounds(g,p);const box=g.boundingBox,sphere=g.boundingSphere,center=sphere!.center;
    p[3]=20;setPositionBounds(g,p);
    expect(g.boundingBox).toBe(box);expect(g.boundingSphere).toBe(sphere);expect(g.boundingSphere!.center).toBe(center);
    expect(g.boundingBox!.max.x).toBe(20);g.dispose();
  });
  it('retains native handling and diagnostics for invalid coordinates', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try { compare(new Float32Array([NaN,0,0,1,2,3]));compare(new Float32Array([Infinity,0,0,1,2,3]));expect(error).toHaveBeenCalled(); }
    finally { error.mockRestore(); }
  });
});
