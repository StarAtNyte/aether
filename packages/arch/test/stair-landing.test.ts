/**
 * Every stair needs a clear landing at its foot and beyond its top step: as wide as the flight, and at least the
 * stair's width deep, never less than a walker's body with room each side (0.9 m), measured to the inside faces of
 * the walls and clear of railings and furniture. A stair whose top lands against a wall is refused with the
 * measurements and a stair that works, create_building moves it to the nearest one that does, and the building
 * check (the review and the navigable test) finds the landing a walker cannot get off before the walkthrough bot.
 *
 * The reproduction is a house a model built: a straight stair along the hall's east wall whose top step came out
 * 0.78 m short of the south wall, with the stairwell balustrade beside it: 0.69 m to squeeze through, narrower than
 * the body, so the upper floor could not be reached.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld, type WorldDoc } from '@aether/core';
import { applyArchOps, checkBuilding, parsePlan, reviewScene } from '../src/index';
import { checkStair, fitStair, settleStairs, stairLandingDepth, stairShape, STAIR_MIN_LANDING } from '../src/stair-fit';
import type { Compass, PlanStair } from '../src/plan';

const C7 = JSON.parse(readFileSync(fileURLToPath(new URL('./plans/house-stair-landing.plan.json', import.meta.url)), 'utf8')) as Record<string, unknown>;

function build(plan: unknown, exactStairs: boolean): { world: WorldDoc; lines: string[] } {
  const base = createWorld();
  const res = applyArchOps(base, [{ op: 'create_building', plan, exactStairs }]);
  expect(res.errors).toEqual([]);
  return { world: applyPatches(base, res.patches).world, lines: res.lines };
}

describe('stair landings: the house whose top step landed against the wall', () => {
  it('measures the top landing short of the body and says by how much', () => {
    const plan = parsePlan(C7);
    const s = plan.levels[0]?.stairs[0] as PlanStair;
    const check = checkStair(plan, 0, s);
    expect(check.problems).toHaveLength(1);
    // 0.27 m goings × 16 treads from z 0.76 end at z 5.08; the south wall's inside face is at 5.86.
    expect(check.problems[0]).toMatch(/its top step comes out at \(12\.39, 5\.08\) with 0\.7\d m of clear floor before the wall of landing on level 1, where a walker needs a landing 0\.90 m \(a 0\.70 m body with 0\.10 m each side\) deep/);
  });

  it('the building check finds the landing nobody can get off, with a ready op that fixes it', () => {
    const { world } = build(C7, true);
    const report = checkBuilding(world, 'house');
    const landing = report.issues.find((i) => i.entities.includes('house-l0-stair0'));
    expect(landing?.code).toBe('unreachable_room');
    expect(landing?.message).toMatch(/top step comes out at \(12\.39, 5\.08\) onto a landing a walker cannot get off: 0\.\d\d m of clear floor beyond it/);
    // Every upstairs room is unreachable through it: what the walkthrough bot found.
    expect(report.reachable).toBe(3);
    const op = /build_architecture (\{"op":"add_stairs".*\}) \(/.exec(landing?.hint ?? '');
    expect(op, landing?.hint).not.toBeNull();
    const fixed = applyArchOps(world, [JSON.parse(op?.[1] ?? '{}') as unknown]);
    expect(fixed.errors).toEqual([]);
    expect(fixed.reports[0]?.issues.filter((i) => i.code === 'unreachable_room')).toEqual([]);
    expect(fixed.reports[0]?.reachable).toBe(6);
    // Replaced, not added: one stair still.
    expect(Object.values(fixed.target.entities).filter((e) => e.arch?.role === 'stair')).toHaveLength(1);
  });

  it('the building review reports it as an error before any walkthrough', () => {
    const { world } = build(C7, true);
    const findings = reviewScene(world, 'house', { fast: true });
    expect(findings.some((f) => f.severity === 'error' && f.entities.includes('house-l0-stair0') && /cannot get off/.test(f.message))).toBe(true);
  });

  it('create_building moves the stair to the nearest that works and says why, so every room is reachable', () => {
    const { world, lines } = build(C7, false);
    expect(lines.join('\n')).toMatch(/stair moved: level 0 stair 1 at \(12\.39, 0\.76\) heading south: its top step comes out .* moved to a straight stair 0\.9 m wide in hall/);
    const report = checkBuilding(world, 'house');
    expect(report.issues).toEqual([]);
    expect(report.reachable).toBe(report.rooms);
    // Same room, shape, width and heading: only slid along the wall.
    const plan = parsePlan(world.entities['house']?.arch?.plan);
    const s = plan.levels[0]?.stairs[0] as PlanStair;
    expect(s).toMatchObject({ heading: 'south', shape: 'straight', width: 0.9 });
    expect(s.at[0]).toBeCloseTo(12.39, 2);
    expect(checkStair(plan, 0, s).problems).toEqual([]);
  });

  it('add_stairs refuses the same stair with the measurement and a stair that works', () => {
    const plan = { ...C7, levels: (C7['levels'] as Array<Record<string, unknown>>).map((l) => ({ ...l, stairs: [] })) };
    const { world } = build(plan, true);
    const res = applyArchOps(world, [{ op: 'add_stairs', building: 'house', level: 0, stair: { at: [12.39, 0.76], heading: 'south', width: 0.9 } }]);
    expect(res.errors[0]?.code).toBe('stair_misplaced');
    expect(res.errors[0]?.message).toMatch(/0\.7\d m of clear floor before the wall of landing on level 1, where a walker needs a landing 0\.90 m/);
    expect(res.errors[0]?.hint).toMatch(/A stair that fits: \{"at":\[12\.39,[\d.]+\],"heading":"south","shape":"straight","width":0\.9\}/);
  });
});

/**
 * A hall and a living room downstairs, a landing and a bedroom upstairs, both 8 m deep: room for any stair. The
 * opening between hall and living room, and the door between landing and bedroom above it, sit `opening` of the
 * way along their wall (from the north).
 */
function house(stairs: PlanStair[], opening = 0.9): Record<string, unknown> {
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
        doors: [{ between: ['living', 'outside'], side: 'south', main: true }, { between: ['hall', 'living'], kind: 'opening', width: 1.2, at: opening }],
        stairs,
      },
      {
        height: 3,
        rooms: [
          { id: 'landing', type: 'hall', rect: [0, 0, 8, 8] },
          { id: 'bed', type: 'bedroom', rect: [8, 0, 13, 8] },
        ],
        doors: [{ between: ['landing', 'bed'], at: opening }],
      },
    ],
  };
}

const HEADING: readonly Compass[] = ['north', 'east', 'south', 'west'];
const SHAPES: ReadonlyArray<Pick<PlanStair, 'shape' | 'turn'>> = [
  { shape: 'straight', turn: 'left' },
  { shape: 'l', turn: 'left' },
  { shape: 'l', turn: 'right' },
  { shape: 'u', turn: 'left' },
  { shape: 'u', turn: 'right' },
];

describe('stair landings: every heading and shape', () => {
  for (const heading of HEADING) {
    for (const { shape, turn } of SHAPES) {
      const name = `${shape}${shape === 'straight' ? '' : ` turning ${turn}`} heading ${heading}`;
      it(`${name}: a fitted stair has clear landings the body gets off; one landing against the wall is caught and moved`, () => {
        const plan = parsePlan(house([]));
        const fit = fitStair(plan, 0, { room: 'hall', heading, shape, turn, width: 1 });
        expect(fit.ok, JSON.stringify(fit)).toBe(true);
        if (!fit.ok) return;
        const good: PlanStair = fit.stair;
        expect(good).toMatchObject({ heading, shape, turn });
        expect(checkStair(plan, 0, good).problems).toEqual([]);
        const ok = checkBuilding(build(house([good]), true).world, 'h');
        expect(ok.issues.map((i) => i.message)).toEqual([]);

        // Slide the same stair along its last flight until the top step comes out 0.8 m short of the wall ahead.
        const sh = stairShape(good, 3);
        const [dx, dz] = sh.topDir;
        // Inside faces of the hall's walls: 0.28 m exterior walls west, north and south, the 0.12 m wall to the living room east.
        const face = { x0: 0.14, x1: 7.94, z0: 0.14, z1: 7.86 };
        const ahead = dx > 0 ? face.x1 - sh.topEdge[0] : dx < 0 ? sh.topEdge[0] - face.x0 : dz > 0 ? face.z1 - sh.topEdge[1] : sh.topEdge[1] - face.z0;
        const shift = ahead - 0.8;
        const bad: PlanStair = { ...good, at: [Math.round((good.at[0] + dx * shift) * 100) / 100, Math.round((good.at[1] + dz * shift) * 100) / 100] };
        // Where the slid stair would stand in the opening to the living room, the opening goes to the other end.
        const opening = [0.9, 0.1, 0.5].find((o) => checkStair(parsePlan(house([bad], o)), 0, bad).problems.length === 1) ?? 0.9;
        const problems = checkStair(parsePlan(house([bad], opening)), 0, bad).problems;
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/its top step comes out at .* with 0\.\d\d m of clear floor before the wall of landing on level 1, where a walker needs a landing 1\.00 m/);

        // Built as drawn, the building check does not let the walker up there.
        const drawn = checkBuilding(build(house([bad], opening), true).world, 'h');
        expect(drawn.issues.some((i) => i.code === 'unreachable_room' && i.entities.includes('h-l0-stair0')), drawn.issues.map((i) => i.message).join('\n')).toBe(true);
        expect(drawn.reachable).toBeLessThan(drawn.rooms);

        // Settled, it works again: moved, checked, every room reached.
        const settled = settleStairs(parsePlan(house([bad], opening)));
        expect(settled.failing).toEqual([]);
        expect(settled.moved).toHaveLength(1);
        const moved = settled.plan.levels[0]?.stairs[0] as PlanStair;
        expect(checkStair(settled.plan, 0, moved).problems).toEqual([]);
        const after = checkBuilding(build(house([bad], opening), false).world, 'h');
        expect(after.issues.map((i) => i.message)).toEqual([]);
        expect(after.reachable).toBe(after.rooms);
      });
    }
  }
});

describe('stair landings: what counts as clear', () => {
  const stair: PlanStair = { at: [2, 6.9], heading: 'north', shape: 'straight', width: 1, turn: 'left' };

  it('the landing depth is the stair width, never less than a body with clearance', () => {
    expect(STAIR_MIN_LANDING).toBeCloseTo(0.9, 5);
    expect(stairLandingDepth(0.8)).toBe(0.9);
    expect(stairLandingDepth(1)).toBe(1);
    expect(stairLandingDepth(1.4)).toBe(1.4);
  });

  it('a railing across the top landing blocks it', () => {
    const base = parsePlan(house([stair]));
    expect(checkStair(base, 0, stair).problems).toEqual([]);
    const top = stairShape(stair, 3).topEdge;
    const levels = house([stair])['levels'] as Array<Record<string, unknown>>;
    const upper = { ...levels[1], railings: [{ points: [[top[0] - 1, top[1] - 0.5], [top[0] + 1, top[1] - 0.5]] }] };
    const railed = parsePlan({ ...house([stair]), levels: [levels[0], upper] });
    expect(checkStair(railed, 0, stair).problems.join('; ')).toMatch(/onto a landing that runs into railing 1 of level 1 on level 1 \(0\.4\d m clear straight ahead/);
    const report = checkBuilding(build(railed, true).world, 'h');
    expect(report.issues.some((i) => i.entities.includes('h-l0-stair0'))).toBe(true);
  });

  it('furniture placed on the landing upstairs blocks it', () => {
    const levels = house([stair])['levels'] as Array<Record<string, unknown>>;
    const top = stairShape(stair, 3).topEdge;
    const upper = { ...levels[1], rooms: [{ id: 'landing', type: 'hall', rect: [0, 0, 8, 8], items: [{ kind: 'sofa', at: [top[0], top[1] - 0.7], yaw: 0 }] }, { id: 'bed', type: 'bedroom', rect: [8, 0, 13, 8] }] };
    const plan = parsePlan({ ...house([stair]), levels: [levels[0], upper] });
    expect(checkStair(plan, 0, stair).problems.join('; ')).toMatch(/onto a landing that runs into the sofa at \(2\.00, [\d.]+\) in landing on level 1/);
  });

  it('a top landing boxed in by walls on three sides leads nowhere', () => {
    // A 1 m wide landing pocket the flight comes up into, closed ahead by the north wall 1.2 m on and on both sides.
    const plan = parsePlan({
      id: 'p',
      levels: [
        { height: 3, rooms: [{ id: 'hall', type: 'hall', rect: [0, 0, 1.3, 6.5] }, { id: 'living', type: 'living', rect: [1.3, 0, 7, 6.5] }], doors: [{ between: ['living', 'outside'], side: 'south', main: true }, { between: ['hall', 'living'], kind: 'opening', width: 1, at: 0.9 }] },
        { height: 3, rooms: [{ id: 'nook', type: 'hall', rect: [0, 0, 1.3, 6.5] }, { id: 'bed', type: 'bedroom', rect: [1.3, 0, 7, 6.5] }], doors: [{ between: ['nook', 'bed'], at: 0.9 }] },
      ],
    });
    const s: PlanStair = { at: [0.65, 5.6], heading: 'north', shape: 'straight', width: 1, turn: 'left' };
    expect(checkStair(plan, 0, s).problems.join('; ')).toMatch(/the landing beyond its top step at \(0\.65, 1\.28\) leads nowhere on level 1/);
  });
});
