import { describe, expect, it } from 'vitest';
import { opaqueSort, type SortItem } from '../src/gpu/render-order';

const item = (id: number, z: number, alphaTest = 0, groupOrder = 0, renderOrder = 0): SortItem => ({ id, z, groupOrder, renderOrder, material: { alphaTest } });

describe('opaque draw order', () => {
  it('draws solid items front to back, then the alpha-tested ones front to back', () => {
    const items = [item(1, 5, 0.5), item(2, 1), item(3, 3, 0.5), item(4, 2), item(5, 4)];
    expect(items.sort(opaqueSort).map((i) => i.id)).toEqual([2, 4, 5, 3, 1]);
  });
  it('keeps group and render order above everything else', () => {
    const items = [item(1, 1, 0, 1), item(2, 9, 0.5, 0, 1), item(3, 9, 0, 0, 2), item(4, 9, 0, 0, 0)];
    expect(items.sort(opaqueSort).map((i) => i.id)).toEqual([4, 2, 3, 1]);
  });
  it('is stable on ties and tolerates a missing alphaTest', () => {
    const items = [item(2, 1), item(1, 1), { id: 3, z: 1, groupOrder: 0, renderOrder: 0, material: {} }];
    expect(items.sort(opaqueSort).map((i) => i.id)).toEqual([1, 2, 3]);
  });
  it('switches between tested and untested once', () => {
    const items = Array.from({ length: 40 }, (_, i) => item(i, i % 7, i % 2 === 0 ? 0.5 : 0));
    items.sort(opaqueSort);
    let switches = 0;
    for (let i = 1; i < items.length; i++) if ((items[i]!.material.alphaTest as number) > 0 !== (items[i - 1]!.material.alphaTest as number) > 0) switches++;
    expect(switches).toBe(1);
  });
});
