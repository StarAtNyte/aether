/**
 * People at home keep off the stairs' walkways: the walkthrough bot found no way up when a resident stood in the strip
 * beside the first treads or on the top landing (a family of four in the offline planner's two-storey house). Every
 * resident stands at least a landing's depth from the flight of a stair on their floor and from the stairwell opened
 * in their floor by the stair below.
 */
import { describe, expect, it } from 'vitest';
import { compileBuilding, parsePlan } from '../src/compile';
import { pointInPolygon, pointSegmentDistance, type P2 } from '../src/math2';
import { settleStairs, stairShape } from '../src/stair-fit';
import { generateHouse } from './support/house-gen';

function distance(p: P2, poly: readonly P2[]): number {
  if (pointInPolygon(p[0], p[1], poly)) return 0;
  let d = Infinity;
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k] as P2;
    const b = poly[(k + 1) % poly.length] as P2;
    d = Math.min(d, pointSegmentDistance(p[0], p[1], a[0], a[1], b[0], b[1]));
  }
  return d;
}

describe('residents and stairs', () => {
  it('nobody stands within a landing of a stair or its stairwell, on any floor, in 30 generated houses', () => {
    let people = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const draft = generateHouse(seed, { furnish: false }).plan as Record<string, unknown>;
      draft['residents'] = 6;
      const settled = settleStairs(parsePlan(draft));
      if (settled.failing.length > 0) continue;
      const plan = settled.plan;
      const built = compileBuilding(plan);
      const floors: number[] = [];
      let elevation = 0;
      for (const l of plan.levels) {
        floors.push(elevation);
        elevation += l.height;
      }
      for (const e of built.entities) {
        const pos = e.transform?.position;
        if (!/-resident\d+$/.test(e.id) || !pos) continue;
        people++;
        const at: P2 = [pos[0], pos[2]];
        // The person's feet are on the floor of one level: the nearest one under the entity's height.
        const y = pos[1];
        let li = 0;
        floors.forEach((f, k) => {
          if (y >= f) li = k;
        });
        const near: number[] = [];
        for (const s of plan.levels[li]?.stairs ?? []) near.push(distance(at, stairShape(s, plan.levels[li]?.height ?? 3).footprint));
        for (const s of plan.levels[li - 1]?.stairs ?? []) near.push(distance(at, stairShape(s, plan.levels[li - 1]?.height ?? 3).footprint));
        for (const d of near) expect(d, `seed ${seed}: ${e.id} on level ${li} stands ${d.toFixed(2)} m from a stair`).toBeGreaterThanOrEqual(0.94);
      }
    }
    expect(people).toBeGreaterThan(30);
  });
});
