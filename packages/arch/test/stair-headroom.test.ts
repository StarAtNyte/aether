/**
 * Head room over a stair: a walker on the stair's walking line (up the middle of each flight, through the centre of
 * the landing) has at least 2.0 m clear above the feet everywhere, across the width of a body (0.35 m each side of
 * the line), from the floor before the first riser to the floor beyond the top step. Measured on the compiled
 * building: the slab of the floor above with its stairwell, and the ceiling of the room the stair stands in.
 *
 * The walkthrough bot used to get stuck on 1 m L stairs, its capsule wedged under the slab beside the last treads of
 * the first flight; the opening was not too tight (the well is the stair's footprint, so the walking line is open to
 * the floor above all the way), the bot cut the turn. The ceiling of the stair's room, though, was closed over the
 * well: on the way up the head passed through it, and from below it hid the well and the upper flight.
 */
import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld, worldTransform, type WorldDoc } from '@aether/core';
import { applyArchOps, parsePlan, pointInPolygon, StairParams, stairWalkLine, type P2 } from '../src/index';
import { fitStair } from '../src/stair-fit';
import type { Compass, PlanStair } from '../src/plan';

/** A hall and a living room downstairs, a landing and a bedroom upstairs (the house of the landing tests). */
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

/** A horizontal surface overhead: its height and plan outline with openings. */
interface Overhead {
  id: string;
  y: number;
  polygon: P2[];
  holes: P2[][];
}

function overheads(world: WorldDoc): Overhead[] {
  const out: Overhead[] = [];
  for (const [id, e] of Object.entries(world.entities)) {
    if (e.shape.kind !== 'procedural') continue;
    const p = e.shape.params as { polygon?: P2[]; holes?: P2[][]; thickness?: number };
    const y = worldTransform(world, id).position[1];
    // A slab's underside, and a ceiling surface.
    if (e.shape.generator === 'arch-slab' && e.arch?.role === 'room') out.push({ id, y: y - (p.thickness ?? 0), polygon: p.polygon ?? [], holes: p.holes ?? [] });
    if (e.shape.generator === 'arch-ceiling') out.push({ id, y, polygon: p.polygon ?? [], holes: p.holes ?? [] });
  }
  return out;
}

/** The least head room along the stair's walking line, across a body's width, and where. */
function headroom(world: WorldDoc, stairId: string): { least: number; where: string } {
  const e = world.entities[stairId];
  if (e?.shape.kind !== 'procedural') throw new Error('no stair');
  const sp = StairParams.parse(e.shape.params);
  const wt = worldTransform(world, stairId);
  const yaw = 2 * Math.atan2(wt.quaternion[1], wt.quaternion[3]);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const line = stairWalkLine(sp).map(([x, y, z]) => [wt.position[0] + x * c + z * s, wt.position[1] + y, wt.position[2] - x * s + z * c] as const);
  const over = overheads(world);
  let least = Infinity;
  let where = '';
  for (let k = 0; k + 1 < line.length; k++) {
    const a = line[k] as readonly [number, number, number];
    const b = line[k + 1] as readonly [number, number, number];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 0.05));
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const feet = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u] as const;
      for (let d = 0; d <= 16; d++) {
        const r = d === 0 ? 0 : 0.35;
        const ang = (d * Math.PI) / 8;
        const x = feet[0] + Math.cos(ang) * r;
        const z = feet[2] + Math.sin(ang) * r;
        for (const o of over) {
          // Only what is above the feet: the floor ahead at the top of the stair is underfoot, not overhead.
          if (o.y <= feet[1] + 0.05) continue;
          if (!pointInPolygon(x, z, o.polygon) || o.holes.some((h) => pointInPolygon(x, z, h))) continue;
          const clear = o.y - feet[1];
          if (clear < least) {
            least = clear;
            where = `${o.id} ${clear.toFixed(2)} m above feet at (${feet.map((v) => v.toFixed(2)).join(', ')})`;
          }
        }
      }
    }
  }
  return { least, where };
}

const HEADING: readonly Compass[] = ['north', 'east', 'south', 'west'];
const SHAPES: ReadonlyArray<Pick<PlanStair, 'shape' | 'turn'>> = [
  { shape: 'straight', turn: 'left' },
  { shape: 'l', turn: 'left' },
  { shape: 'l', turn: 'right' },
  { shape: 'u', turn: 'left' },
  { shape: 'u', turn: 'right' },
];

describe('stair head room along the walking line', () => {
  for (const width of [0.9, 1, 1.2]) {
    for (const heading of HEADING) {
      for (const { shape, turn } of SHAPES) {
        it(`${width} m ${shape}${shape === 'straight' ? '' : ` turning ${turn}`} heading ${heading}: 2.0 m clear over the walking line`, () => {
          const fit = fitStair(parsePlan(house([])), 0, { room: 'hall', heading, shape, turn, width });
          expect(fit.ok, fit.ok ? '' : fit.reasons.join('; ')).toBe(true);
          if (!fit.ok) return;
          const base = createWorld();
          const res = applyArchOps(base, [{ op: 'create_building', plan: house([fit.stair]), exactStairs: true }]);
          expect(res.errors).toEqual([]);
          const world = applyPatches(base, res.patches).world;
          const h = headroom(world, 'h-l0-stair0');
          expect(h.least, h.where).toBeGreaterThanOrEqual(2.0);
        });
      }
    }
  }

  it('the walking line runs through the centre of the landing and on up the middle of each flight', () => {
    const sp = StairParams.parse({ shape: 'l', width: 1, rise: 3, turn: 'right' });
    const line = stairWalkLine(sp);
    // Up the first flight on its centre line, to the landing's centre, then along the second flight's centre line.
    expect(line[0]).toEqual([-0.4, 0, 0]);
    const corner = line.find((p, i) => i > 0 && p[2] === 0 && line[i + 1]?.[0] === p[0] && line[i + 1]?.[2] !== 0);
    expect(corner).toBeDefined();
    const last = line[line.length - 1] as [number, number, number];
    expect(last[1]).toBe(3);
    expect(last[0]).toBeCloseTo((corner as [number, number, number])[0], 6);
    expect(last[2]).toBeGreaterThan(1);
  });
});
