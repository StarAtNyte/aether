import { describe, expect, it } from 'vitest';
import { setLibraryFurniture } from '../src/index';
import { furnitureAsset } from '../src/furniture/assets';

describe('library furniture switch ("No assets")', () => {
  it('forbids library models while off and restores the previous setting', () => {
    const was = setLibraryFurniture(false);
    try {
      for (const kind of ['sofa', 'armchair', 'bed', 'dining-table', 'floor-lamp']) expect(furnitureAsset(kind, 'modern'), kind).toBeNull();
    } finally {
      expect(setLibraryFurniture(was)).toBe(false);
    }
  });
});
