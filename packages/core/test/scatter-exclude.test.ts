import { describe, expect, it } from 'vitest';
import { ScatterShape, scatterExcluded } from '../src/index';

const shape = { kind: 'scatter', of: { kind: 'primitive', primitive: 'cone' }, count: 10, area: [10, 10] } as const;

describe('scatter exclude', () => {
  it('accepts valid rects and rejects inverted, non-finite or too many', () => {
    expect(ScatterShape.safeParse({ ...shape, exclude: [{ x0: -1, z0: -2, x1: 1, z1: 2 }] }).success).toBe(true);
    expect(ScatterShape.safeParse({ ...shape, exclude: [{ x0: 1, z0: -2, x1: -1, z1: 2 }] }).success).toBe(false);
    expect(ScatterShape.safeParse({ ...shape, exclude: [{ x0: 0, z0: 0, x1: 0, z1: 2 }] }).success).toBe(false);
    expect(ScatterShape.safeParse({ ...shape, exclude: [{ x0: 0, z0: 0, x1: Infinity, z1: 2 }] }).success).toBe(false);
    const many = Array.from({ length: 65 }, (_, i) => ({ x0: i, z0: 0, x1: i + 0.5, z1: 1 }));
    expect(ScatterShape.safeParse({ ...shape, exclude: many }).success).toBe(false);
    expect(ScatterShape.safeParse({ ...shape, exclude: many.slice(0, 64) }).success).toBe(true);
  });

  it('tests points against rects with inclusive edges', () => {
    const rects = [{ x0: -1, z0: -1, x1: 1, z1: 1 }];
    expect(scatterExcluded(rects, 0, 0)).toBe(true);
    expect(scatterExcluded(rects, 1, -1)).toBe(true);
    expect(scatterExcluded(rects, 1.01, 0)).toBe(false);
    expect(scatterExcluded(undefined, 0, 0)).toBe(false);
    expect(scatterExcluded([], 0, 0)).toBe(false);
  });
});
