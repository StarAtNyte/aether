/**
 * The balustrade round a stairwell leaves the edge the stair arrives through open, whatever the stair's shape,
 * heading and turn, and stands on the floor round the opening rather than over the flight. An L stair has two edges
 * facing its arrival direction (the inner corner of the L and the real exit): the railing used to close the exit
 * and leave the inner corner open, walling the upper floor off. Centred on the opening's edge, the panels also
 * narrowed a 0.9 m flight to 0.82 m where the head passes them.
 */
import { describe, expect, it } from 'vitest';
import { compileBuilding, pointSegmentDistance, rotateYaw, stairLayout, StairParams, type P2 } from '../src/index';

type Heading = 'north' | 'south' | 'east' | 'west';

function plan(stair: { at: [number, number]; heading: Heading; shape: 'straight' | 'l' | 'u'; turn: 'left' | 'right'; width: number }) {
  return {
    id: 'house',
    name: 'Stair well test',
    style: 'modern',
    levels: [
      {
        name: 'Ground floor',
        height: 3,
        rooms: [{ id: 'hall', type: 'hall', rect: [0, 0, 14, 14] }],
        doors: [{ between: ['hall', 'outside'], side: 'south', main: true }],
        stairs: [stair],
      },
      { name: 'Upper floor', height: 2.9, rooms: [{ id: 'landing', type: 'hall', rect: [0, 0, 14, 14] }] },
    ],
  };
}

interface Built {
  rail: P2[];
  arrival: P2;
  width: number;
  /** Plan points along the centre of every flight (from 0.6 m up the first). */
  centre: P2[];
}

function build(heading: Heading, shape: 'straight' | 'l' | 'u', turn: 'left' | 'right'): Built {
  const out = compileBuilding(plan({ at: [7, 7], heading, shape, turn, width: 0.9 }) as Parameters<typeof compileBuilding>[0]);
  const stair = out.entities.find((e) => e.arch?.role === 'stair');
  const railEnt = out.entities.find((e) => e.arch?.role === 'railing');
  if (!stair || stair.shape?.kind !== 'procedural' || !railEnt || railEnt.shape?.kind !== 'procedural') throw new Error('no stair or railing');
  const sp = StairParams.parse(stair.shape.params);
  const yaw = stair.transform?.rotation?.[1] ?? 0;
  const at = stair.transform?.position ?? [0, 0, 0];
  const toWorld = (x: number, z: number): P2 => {
    const r = rotateYaw(x, z, yaw);
    return [at[0] + r[0], at[2] + r[1]];
  };
  const { flights } = stairLayout(sp);
  const last = flights[flights.length - 1];
  if (!last) throw new Error('no flight');
  const run = last.treads * sp.going;
  const centre: P2[] = [];
  // The foot of the first flight is left out (the railing behind the bottom step stands a storey above the head), and
  // so is the turn on a landing (where the corner post stands beside the landing, not over a flight).
  for (const [fi, f] of flights.entries()) {
    const len = f.treads * sp.going;
    for (let k = 1; k <= 10; k++) {
      const d = (len * k) / 10;
      if (fi === 0 && d < 0.6) continue;
      centre.push(toWorld(f.x + f.dx * d, f.z + f.dz * d));
    }
  }
  return { rail: (railEnt.shape.params as { points: P2[] }).points, arrival: toWorld(last.x + last.dx * run, last.z + last.dz * run), width: sp.width, centre };
}

function distToRail(p: P2, rail: readonly P2[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < rail.length; i++) {
    const a = rail[i] as P2;
    const b = rail[i + 1] as P2;
    best = Math.min(best, pointSegmentDistance(p[0], p[1], a[0], a[1], b[0], b[1]));
  }
  return best;
}

const CASES: Array<[Heading, 'straight' | 'l' | 'u', 'left' | 'right']> = [];
for (const h of ['north', 'south', 'east', 'west'] as const) for (const s of ['straight', 'l', 'u'] as const) for (const t of ['left', 'right'] as const) CASES.push([h, s, t]);

describe('stairwell railing', () => {
  it.each(CASES)('%s %s stair turning %s: the arrival edge is open and the flight keeps its width', (heading, shape, turn) => {
    const b = build(heading, shape, turn);
    // Nothing of the railing across the top step: the way off the stair is the full width.
    expect(distToRail(b.arrival, b.rail)).toBeGreaterThan(b.width / 2);
    // Along every flight the railing stays clear of the stair's width (half of it either side of the centre line, plus the setback).
    for (const p of b.centre) expect(distToRail(p, b.rail)).toBeGreaterThanOrEqual(b.width / 2 + 0.04);
  });

  it('opens the L stair of the Codex house at its real exit, not at the inner corner of the L', () => {
    const b = build('south', 'l', 'left');
    // The inner corner of the L (where flight 1 meets the landing) is railed now.
    expect(b.rail.length).toBe(6);
    expect(distToRail(b.arrival, b.rail)).toBeGreaterThan(0.45);
  });
});
