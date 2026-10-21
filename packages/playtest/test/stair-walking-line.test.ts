/**
 * The walkthrough bot walks a stair the way a person does: up the middle of each flight, to the centre of the
 * landing, then the next flight. On 1 m L stairs it used to cut the turn: the grid's shortest route hugs the inside
 * of the L, the capsule rode the inner edge of the first flight and its top wedged under the slab that borders the
 * stairwell beside the last treads (3 of the 20 shape and heading combinations stuck; the failing ones moved with
 * 10 cm shifts). Every shape, heading and width here is walked to every room without getting stuck once, and while
 * on a flight the bot keeps within a hand's breadth of the walking line.
 */
import { applyArchOps, fitStair, parsePlan, type Compass, type PlanStair } from '@aether/arch';
import { createWorld, type Vec3, type WorldDoc } from '@aether/core';
import { ensureAssetCatalog } from '@aether/physics';
import { describe, expect, it } from 'vitest';
import { walkthrough } from '../src';
import { BODY_SLACK, onStair, stairGuides } from '../src/stairs';

/** A hall and a living room downstairs, a landing and a bedroom upstairs, both 8 m deep: room for any stair. */
function house(stairs: PlanStair[]): Record<string, unknown> {
  return {
    id: 'h',
    style: 'modern',
    levels: [
      {
        height: 3,
        rooms: [
          { id: 'hall', type: 'hall', rect: [0, 0, 8, 8] },
          { id: 'living', type: 'living', rect: [8, 0, 13, 8] },
        ],
        doors: [{ between: ['living', 'outside'], side: 'south', main: true }, { between: ['hall', 'living'], kind: 'opening', width: 1.2, at: 0.9 }],
        stairs,
      },
      {
        height: 3,
        rooms: [
          { id: 'landing', type: 'hall', rect: [0, 0, 8, 8] },
          { id: 'bed', type: 'bedroom', rect: [8, 0, 13, 8] },
        ],
        doors: [{ between: ['landing', 'bed'], at: 0.9 }],
      },
    ],
  };
}

function build(stair: PlanStair): WorldDoc {
  const built = applyArchOps(createWorld(), [{ op: 'create_building', plan: house([stair]), exactStairs: true }]);
  expect(built.errors).toEqual([]);
  return built.target;
}

/** Plan distance from a point to a polyline. */
function lineDistance(p: Readonly<Vec3>, line: readonly Vec3[]): number {
  let best = Infinity;
  for (let k = 0; k + 1 < line.length; k++) {
    const a = line[k] as Vec3;
    const b = line[k + 1] as Vec3;
    const dx = b[0] - a[0];
    const dz = b[2] - a[2];
    const len2 = dx * dx + dz * dz;
    const u = len2 < 1e-9 ? 0 : Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[2] - a[2]) * dz) / len2));
    best = Math.min(best, Math.hypot(a[0] + dx * u - p[0], a[2] + dz * u - p[2]));
  }
  return best;
}

const HEADING: readonly Compass[] = ['north', 'east', 'south', 'west'];
const CASES: Array<{ width: number; shape: PlanStair['shape']; turn: PlanStair['turn']; shift: [number, number] }> = [];
for (const width of [0.9, 1, 1.2]) for (const turn of ['left', 'right'] as const) CASES.push({ width, shape: 'l', turn, shift: [0, 0] });
// The positions that failed moved with 10 cm shifts: the 1 m L stairs again, slid along and across.
for (const turn of ['left', 'right'] as const) CASES.push({ width: 1, shape: 'l', turn, shift: [0.1, 0.1] });
CASES.push({ width: 1, shape: 'straight', turn: 'left', shift: [0, 0] }, { width: 1, shape: 'u', turn: 'left', shift: [0, 0] }, { width: 1, shape: 'u', turn: 'right', shift: [0, 0] });

describe('stairs walked along their walking line', () => {
  for (const { width, shape, turn, shift } of CASES) {
    for (const heading of HEADING) {
      const name = `${width} m ${shape}${shape === 'straight' ? '' : ` turning ${turn}`} heading ${heading}${shift[0] !== 0 ? ' shifted 10 cm' : ''}`;
      it(`${name}: every room, never stuck, on the line over the flights`, async () => {
        const fit = fitStair(parsePlan(house([])), 0, { room: 'hall', heading, shape, turn, width });
        expect(fit.ok).toBe(true);
        if (!fit.ok) return;
        const stair: PlanStair = { ...fit.stair, at: [Math.round((fit.stair.at[0] + shift[0]) * 100) / 100, Math.round((fit.stair.at[1] + shift[1]) * 100) / 100] };
        const world = build(stair);
        await ensureAssetCatalog(world);
        const r = await walkthrough(world, { trace: true });
        expect(r.status, r.summary).toBe('passed');
        expect(r.stuckPoints).toEqual([]);
        // From the last treads of the first flight on (where the turn used to be cut, under the slab's edge) to the
        // top, the feet keep to the walking line. Lower down the route may step onto a flight from its side.
        const guide = stairGuides(world)[0];
        expect(guide).toBeDefined();
        if (!guide || !r.trace) return;
        let worst = 0;
        let samples = 0;
        for (let f = 0; f < r.trace.frames; f++) {
          const p: Vec3 = [r.trace.poses[f * 4] as number, r.trace.poses[f * 4 + 1] as number, r.trace.poses[f * 4 + 2] as number];
          if (!onStair(guide, p, BODY_SLACK) || p[1] < guide.y0 + (guide.y1 - guide.y0) * 0.35 || p[1] > guide.y1 - 0.3) continue;
          samples++;
          worst = Math.max(worst, lineDistance(p, guide.line));
        }
        expect(samples).toBeGreaterThan(5);
        expect(worst).toBeLessThan(0.25);
      }, 60_000);
    }
  }
});
