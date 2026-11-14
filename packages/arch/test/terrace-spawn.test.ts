import { describe, expect, it } from 'vitest';
import { compileBuilding, type BuildingPlanInput } from '../src/index';
import { uncoveredPieces } from '../src/compile';
import { area, pointInPolygon, type P2 } from '../src/math2';

const rect = (x0: number, z0: number, x1: number, z1: number): P2[] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

// The villa: a kitchen roof (8..12) partly under the upper bath (6..9). The whole kitchen polygon used to become the roof
// terrace, lying in the plane of the bath's floor over 6 m² (decking and tiles fighting in depth).
const VILLA: BuildingPlanInput = {
  plinth: 0.15,
  levels: [
    { height: 3.1, rooms: [{ id: 'living', type: 'living', rect: [0, 0, 8, 6] }, { id: 'kitchen', type: 'kitchen', rect: [8, 0, 12, 6] }], doors: [{ between: ['living', 'outside'], main: true }, { between: ['living', 'kitchen'] }] },
    { height: 2.9, rooms: [{ id: 'landing', type: 'hall', rect: [0, 0, 6, 3] }, { id: 'master', type: 'bedroom', rect: [0, 3, 6, 6] }, { id: 'bath', type: 'bathroom', rect: [6, 0, 9, 6] }], doors: [{ between: ['landing', 'master'] }, { between: ['landing', 'bath'] }] },
  ],
} as unknown as BuildingPlanInput;

describe('roof terraces', () => {
  it('cut a partly covered room roof to its uncovered part', () => {
    const pieces = uncoveredPieces(rect(8, 0, 12, 6), [rect(0, 0, 6, 3), rect(0, 3, 6, 6), rect(6, 0, 9, 6)]);
    expect(pieces).toHaveLength(1);
    expect(area(pieces[0]!)).toBeCloseTo(18);
    expect(uncoveredPieces(rect(0, 0, 4, 4), [rect(1, 1, 2, 2)]).reduce((s, p) => s + area(p), 0)).toBeCloseTo(15);
    expect(uncoveredPieces(rect(0, 0, 4, 4), [])).toHaveLength(1);
  });

  it('never lie under a room of the level above', () => {
    const c = compileBuilding(VILLA);
    const terraces = c.entities.filter((e) => e.arch?.role === 'roof' && e.arch.kind === 'terrace');
    expect(terraces.length).toBeGreaterThan(0);
    for (const t of terraces) {
      const poly = (t.shape as unknown as { params: { polygon: P2[] } }).params.polygon;
      // Well inside the bath (x 6..9) there is no terrace.
      expect(pointInPolygon(8.5, 3, poly)).toBe(false);
    }
  });
});
