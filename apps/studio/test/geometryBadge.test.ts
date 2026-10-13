import { describe, expect, it } from 'vitest';
import { BADGE_MIN_RATIO, BADGE_MIN_SCENE_TRIANGLES, showGeometryBadge } from '../src/components/viewport/GeometryBadge';

describe('geometry badge', () => {
  it('appears only for big scenes drawn far below their full detail', () => {
    expect(showGeometryBadge(223_000_000, 1_200_000)).toBe(true);
    expect(showGeometryBadge(BADGE_MIN_SCENE_TRIANGLES - 1, 1000)).toBe(false);
    expect(showGeometryBadge(10_000_000, 10_000_000 / (BADGE_MIN_RATIO - 1))).toBe(false);
    expect(showGeometryBadge(10_000_000, 0)).toBe(true);
    expect(showGeometryBadge(0, 0)).toBe(false);
  });
});
