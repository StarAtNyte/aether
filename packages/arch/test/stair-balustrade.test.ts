/**
 * Balustrades on a stair's open sides. A flight or landing beside a drop (the room below, the inside of an L's turn,
 * the gap of a U) gets a guard with a collider, styled after the building (glass, steel bars, timber spindles); a side
 * against a wall gets a wall handrail instead. The guard stands just outside the stair's edge, so the flights keep
 * their full width for the walking line; it starts after the first treads, so a stair along a wall can still be
 * stepped onto beside them; beside the stairwell it stays under the floor above. Without it a person hugging the
 * inner edge of an L's first flight wedged the capsule's top under the slab there.
 */
import { describe, expect, it } from 'vitest';
import { applyArchOps, buildStair, checkBuilding, compileBuilding, parsePlan, pointInPolygon, pointSegmentDistance, rotateYaw, StairParams, stairFootprint, stairGuardOutlines, stairGuardPieces, stairLayout, stairWalkLine, GUARD_HEIGHT, type P2 } from '../src/index';
import { createWorld, type EntityInput } from '@aether/core';
import { fitStair, stairShape } from '../src/stair-fit';
import type { Compass, PlanStair } from '../src/plan';

type Heading = Compass;
const HEADINGS: readonly Heading[] = ['north', 'south', 'east', 'west'];

function hall(stair: PlanStair, style = 'modern'): Record<string, unknown> {
  return {
    id: 'house',
    style,
    levels: [
      { height: 3, rooms: [{ id: 'hall', type: 'hall', rect: [0, 0, 14, 14] }], doors: [{ between: ['hall', 'outside'], side: 'south', main: true }], stairs: [stair] },
      { height: 2.9, rooms: [{ id: 'landing', type: 'hall', rect: [0, 0, 14, 14] }] },
    ],
  };
}

/** The house of the landing tests: an 8 m hall where a fitted stair stands against a wall. */
function house(stairs: PlanStair[], style = 'modern'): Record<string, unknown> {
  return {
    id: 'h',
    style,
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

function stairOf(entities: readonly EntityInput[]): { sp: StairParams; toPlan: (q: P2) => P2 } {
  const e = entities.find((x) => x.arch?.role === 'stair');
  if (!e || e.shape?.kind !== 'procedural') throw new Error('no stair');
  const sp = StairParams.parse(e.shape.params);
  const yaw = e.transform?.rotation?.[1] ?? 0;
  const at = e.transform?.position ?? [0, 0, 0];
  return {
    sp,
    toPlan: (q) => {
      const r = rotateYaw(q[0], q[1], yaw);
      return [at[0] + r[0], at[2] + r[1]];
    },
  };
}

function polyDistance(p: P2, poly: readonly P2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as P2;
    const b = poly[(i + 1) % poly.length] as P2;
    best = Math.min(best, pointSegmentDistance(p[0], p[1], a[0], a[1], b[0], b[1]));
  }
  return best;
}

/** Points along a polygon's outline, about 2 cm apart. */
function outlinePoints(poly: readonly P2[]): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as P2;
    const b = poly[(i + 1) % poly.length] as P2;
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.02));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

/** The balustrades' colliders: those a balustraded stair has beyond the same stair without them. */
function guardBoxes(sp: StairParams): Array<{ offset: [number, number, number]; halfExtents: [number, number, number] }> {
  const bare = buildStair(StairParams.parse({ ...sp, guards: undefined })).colliders.length;
  const out: Array<{ offset: [number, number, number]; halfExtents: [number, number, number] }> = [];
  for (const c of buildStair(sp).colliders.slice(bare)) {
    expect(c.kind).toBe('box');
    if (c.kind === 'box') out.push({ offset: c.offset as [number, number, number], halfExtents: c.halfExtents as [number, number, number] });
  }
  return out;
}

const SHAPES: Array<['straight' | 'l' | 'u', 'left' | 'right']> = [['straight', 'left'], ['l', 'left'], ['l', 'right'], ['u', 'left'], ['u', 'right']];

describe('stair balustrades', () => {
  for (const heading of HEADINGS) {
    for (const [shape, turn] of SHAPES) {
      it(`${shape}${shape === 'straight' ? '' : ` ${turn}`} heading ${heading}, free-standing: every open side is guarded outside the flight, clear of the walking line`, () => {
        const out = compileBuilding(hall({ at: [7, 7], heading, shape, turn, width: 0.9 }) as Parameters<typeof compileBuilding>[0]);
        const { sp, toPlan } = stairOf(out.entities);
        const pieces = stairGuardPieces(sp);
        expect(pieces.length).toBe(shape === 'straight' ? 2 : shape === 'l' ? 6 : 7);
        // Nothing stands against a wall in the middle of a 14 m hall.
        expect(sp.guards).toEqual(pieces.map(() => true));
        const fp = stairFootprint(sp);
        const outlines = stairGuardOutlines(sp);
        expect(outlines.length).toBe(pieces.length);
        outlines.forEach((o, k) => {
          // In a U's central gap the balustrades stand between the flights (inside the stairwell's outline).
          if (!pieces[k]?.underSlab) return;
          for (const q of outlinePoints(o)) {
            // Outside the flights and landings (on their edge at most), within 5 cm of them.
            expect(pointInPolygon(q[0], q[1], fp) && polyDistance(q, fp) > 0.004).toBe(false);
            expect(polyDistance(q, fp)).toBeLessThanOrEqual(0.065);
          }
        });
        // The walking line keeps the stair's full width: half of it either side, up to the balustrades.
        const line = stairWalkLine(sp);
        for (let k = 1; k + 2 < line.length; k++) {
          const a = line[k] as [number, number, number];
          const b = line[k + 1] as [number, number, number];
          for (let t = 0; t <= 1; t += 0.05) {
            const p: P2 = [a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t];
            for (const o of outlines) expect(polyDistance(p, o)).toBeGreaterThanOrEqual(sp.width / 2 - 1e-6);
          }
        }
        // Upright boxes along every balustrade, on top of the stair's own colliders, all outside the flights.
        const boxes = guardBoxes(sp);
        expect(boxes.length).toBeGreaterThanOrEqual(pieces.length);
        for (const b of boxes) {
          const c: P2 = [b.offset[0], b.offset[2]];
          if (pieces.every((pc) => pc.underSlab)) expect(pointInPolygon(c[0], c[1], fp)).toBe(false);
        }
        // The floor beside the first treads and in front of the first riser stays open for stepping on.
        const shape2 = stairShape({ at: [7, 7], heading, shape, width: 0.9, turn }, 3);
        const world = outlines.map((o) => o.map(toPlan));
        // (A side of the first treads that the stair itself covers, the gap side of a U, is no way on anyway.)
        const open = shape2.sides.filter((q) => !q.some((c, i) => {
          const d = q[(i + 2) % 4] as P2;
          const m: P2 = [(c[0] * 3 + d[0]) / 4, (c[1] * 3 + d[1]) / 4];
          return pointInPolygon(m[0], m[1], shape2.footprint);
        }));
        for (const q of [...open, shape2.approachMin]) {
          for (const o of world) for (const p of outlinePoints(o)) expect(pointInPolygon(p[0], p[1], q)).toBe(false);
        }
      });
    }
  }

  it('guards the inner side of an L where the wedge was: full height beside the last treads of the first flight, under the slab', () => {
    for (const turn of ['left', 'right'] as const) {
      const sp = StairParams.parse({ shape: 'l', width: 1, rise: 3, turn, guards: [true, true, true, true, true, true], soffit: 2.78 });
      const pieces = stairGuardPieces(sp);
      const inner = pieces[4];
      expect(inner?.flight).toBe(0);
      expect(inner?.out[1]).toBe(turn === 'left' ? -1 : 1);
      // The boxes along the first flight's inner side (the line just outside its edge, short of the landing).
      const s = turn === 'left' ? -1 : 1;
      const landing = stairLayout(sp).landings[0]?.y ?? 0;
      const lx0 = stairLayout(sp).landings[0]?.x0 ?? 0;
      const line = guardBoxes(sp).filter((b) => Math.abs(b.offset[2] - s * (0.5 + 0.025)) < 0.01 && b.offset[0] < lx0);
      expect(line.length).toBeGreaterThan(2);
      const topMax = Math.max(...line.map((b) => b.offset[1] + b.halfExtents[1]));
      // The rail reaches 0.9 m above the pitch line at the landing and never into the slab (2.78 m).
      expect(landing).toBeGreaterThan(1.3);
      expect(topMax).toBeGreaterThan(landing + GUARD_HEIGHT - 0.01);
      expect(topMax).toBeLessThanOrEqual(2.78 - 0.02 + 1e-6);
    }
    // The second flight of a straight stair rises into the slab's height: its balustrades stop under it.
    const st = guardBoxes(StairParams.parse({ shape: 'straight', width: 1, rise: 3, guards: [true, true], soffit: 2.78 }));
    expect(st.length).toBeGreaterThan(4);
    for (const b of st) expect(b.offset[1] + b.halfExtents[1]).toBeLessThanOrEqual(2.76 + 1e-6);
  });

  it('a fitted stair against a wall gets a wall handrail on that side and a balustrade on the open one', () => {
    for (const heading of HEADINGS) {
      for (const [shape, turn] of SHAPES) {
        const fit = fitStair(parsePlan(house([])), 0, { room: 'hall', heading, shape, turn, width: 1 });
        if (!fit.ok) continue;
        const out = compileBuilding(house([fit.stair]) as Parameters<typeof compileBuilding>[0]);
        const { sp, toPlan } = stairOf(out.entities);
        const pieces = stairGuardPieces(sp);
        const guards = sp.guards ?? [];
        expect(guards.length).toBe(pieces.length);
        // Fitted stairs stand with a flank on a wall: something is against it, something is open.
        expect(guards.some((g) => !g)).toBe(true);
        expect(guards.some((g) => g)).toBe(true);
        pieces.forEach((pc, k) => {
          const mid = toPlan([(pc.a[0] + pc.b[0]) / 2 + pc.out[0] * 0.2, (pc.a[1] + pc.b[1]) / 2 + pc.out[1] * 0.2]);
          const inHall = mid[0] > 0 && mid[0] < 8 && mid[1] > 0 && mid[1] < 8;
          // A guard where there is floor beside the stair, none into the wall.
          if (guards[k]) expect(inHall).toBe(true);
        });
        // The building still passes its walkthrough check with the balustrades in place.
        const world = applyArchOps(createWorld(), [{ op: 'create_building', plan: house([fit.stair]), exactStairs: true }]);
        expect(world.errors).toEqual([]);
        const report = checkBuilding(world.target, 'h');
        expect(report.issues.filter((i) => i.code === 'unreachable_room')).toEqual([]);
      }
    }
  });

  it('matches the building: glass in a modern house, timber in a classic one, steel bars in an industrial loft, and the stairwell railing upstairs follows', () => {
    const cases: Array<[string, 'glass' | 'steel' | 'timber', string]> = [['modern', 'glass', 'glass'], ['classic', 'timber', 'timber'], ['scandinavian', 'timber', 'timber'], ['industrial', 'steel', 'bars']];
    for (const [style, balustrade, well] of cases) {
      const out = compileBuilding(hall({ at: [7, 7], heading: 'north', shape: 'l', turn: 'left', width: 1 }, style) as Parameters<typeof compileBuilding>[0]);
      const { sp } = stairOf(out.entities);
      expect(sp.balustrade).toBe(balustrade);
      const rail = out.entities.find((e) => e.arch?.role === 'railing');
      expect(rail?.shape?.kind === 'procedural' ? (rail.shape.params as { style?: string }).style : undefined).toBe(well);
      const parts = buildStair(sp).parts.map((p) => p.material.finish);
      if (balustrade === 'glass') expect(parts).toContain('glass');
      else expect(parts).not.toContain('glass');
    }
  });

  it('keeps old stairs as they were: no guards, the handrail of `rail`', () => {
    const sp = StairParams.parse({ shape: 'l', width: 1, rise: 3 });
    expect(sp.guards).toBeUndefined();
    expect(stairGuardOutlines(sp)).toEqual([]);
    expect(buildStair(sp).colliders.filter((c) => c.kind === 'box').length).toBe(1);
  });
});
