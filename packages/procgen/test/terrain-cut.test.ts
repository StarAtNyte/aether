/** The estate terrain's cut: a rectangle left out of the render mesh for a sunk pool, the collider unchanged. */
import { describe, expect, it } from 'vitest';
import { generateBuiltinSync } from '../src/index';

const BASE = { size: 120, height: 20, resolution: 96, variant: 5, padX: 4, padZ: 6, padRadius: 14 };

describe('estate terrain cut', () => {
  it('drops the triangles inside the rectangle and keeps the heightfield', () => {
    const plain = generateBuiltinSync('terrain', BASE, 3);
    const cut = generateBuiltinSync('terrain', { ...BASE, cutX0: 2, cutZ0: 8, cutX1: 9, cutZ1: 11 }, 3);
    const tris = (o: typeof plain): number => o.parts.reduce((s, p) => s + p.indices.length / 3, 0);
    expect(tris(cut)).toBeLessThan(tris(plain));
    expect(tris(plain) - tris(cut)).toBeLessThan(200);
    expect(cut.colliders).toEqual(plain.colliders);
    // A zero-size cut is no cut.
    expect(tris(generateBuiltinSync('terrain', { ...BASE, cutX0: 3, cutX1: 3 }, 3))).toBe(tris(plain));
  });
});
