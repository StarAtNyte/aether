/**
 * The walkthrough bot climbs a spiral stair: a free-standing `arch-spiral-stair` in the hall, a stairwell cut in the slab
 * and ceiling above it, and nothing else linking the floors. The bot reaches every room, never gets stuck, and its feet
 * go round the axis and up through the height of the floor above, at the walking radius.
 */
import { applyArchOps, spiralFootprint, spiralLayout, spiralProblems, SpiralStairParams } from '@aether/arch';
import { createWorld, Entity, type Json, type Vec3, type WorldDoc } from '@aether/core';
import { ensureAssetCatalog } from '@aether/physics';
import { describe, expect, it } from 'vitest';
import { walkthrough } from '../src';
import { Session } from '../src/session';
import { LineFollower, onStair, stairGuides } from '../src/stairs';

const AT: [number, number] = [3.2, 4];

function plan(): Record<string, unknown> {
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

/** A two-storey house whose only way up is a spiral stair standing on the hall floor. */
function build(params: Record<string, Json>): { world: WorldDoc; p: SpiralStairParams } {
  const built = applyArchOps(createWorld(), [{ op: 'create_building', plan: plan() }]);
  expect(built.errors).toEqual([]);
  const world = structuredClone(built.target);
  const p = SpiralStairParams.parse({ rise: 3, ...params });
  const well = spiralFootprint(p).map(([x, z]) => [Math.round((x + AT[0]) * 1000) / 1000, Math.round((z + AT[1]) * 1000) / 1000] as [number, number]);
  let cut = 0;
  for (const e of Object.values(world.entities)) {
    if (e.shape.kind !== 'procedural') continue;
    const isUpperSlab = e.shape.generator === 'arch-slab' && /landing/.test(e.id);
    const isLowerCeiling = e.shape.generator === 'arch-ceiling' && /hall/.test(e.id) && !/landing/.test(e.id);
    if (!isUpperSlab && !isLowerCeiling) continue;
    e.shape = { ...e.shape, params: { ...(e.shape.params as Record<string, Json>), holes: [well as unknown as Json] } };
    cut++;
  }
  expect(cut).toBe(2);
  const level0 = Object.values(world.entities).find((e) => e.arch?.role === 'level' && e.arch.level === 0);
  expect(level0).toBeDefined();
  world.entities['spiral'] = Entity.parse({
    id: 'spiral',
    name: 'Spiral stair',
    parent: level0!.id,
    transform: { position: [AT[0], 0, AT[1]], rotation: [0, 0, 0], scale: [1, 1, 1] },
    shape: { kind: 'procedural', generator: 'arch-spiral-stair', params: p as unknown as Record<string, Json> },
    physics: { body: 'static', collider: 'auto' },
    arch: { role: 'stair' },
    tags: ['arch', 'stair'],
  });
  return { world, p };
}

const CASES: Array<{ name: string; params: Record<string, Json> }> = [
  { name: 'one turn, right-handed, solid post', params: { radius: 1.4, turns: 1, hand: 'right' } },
  { name: 'three quarters of a turn, left-handed, open core, timber', params: { radius: 1.4, turns: 0.75, hand: 'left', core: 'open', rail: 'both', balustrade: 'timber' } },
];

describe('spiral stairs walked by the bot', () => {
  it('the compiled stair is found as a guide with the walking line of its treads', () => {
    const { world, p } = build({});
    const g = stairGuides(world).find((s) => s.id === 'spiral');
    expect(g).toBeDefined();
    expect(g!.y1 - g!.y0).toBeCloseTo(p.rise, 6);
    expect(g!.line.length).toBeGreaterThan(spiralLayout(p).n);
    expect(g!.line[0]![1]).toBeCloseTo(g!.y0, 6);
    expect(g!.line.at(-1)![1]).toBeCloseTo(g!.y0 + p.rise, 6);
  });

  for (const hand of ['right', 'left'] as const) {
    it(`a person walking the line of a ${hand}-handed stair climbs it with the jump key never pressed`, async () => {
      const { world, p } = build({ turns: 1, hand });
      expect(spiralProblems(p)).toEqual([]);
      await ensureAssetCatalog(world);
      const guide = stairGuides(world).find((x) => x.id === 'spiral')!;
      const session = await Session.create(world, { trace: false });
      const start = guide.line[0]!;
      session.character.teleport([start[0], start[1] + 0.02, start[2]]);
      const follower = new LineFollower(guide.line, session.position);
      let maxY = -Infinity;
      for (let tick = 0; tick < 900; tick++) {
        const pos = session.position;
        const t = follower.target(pos);
        if (!t) break;
        session.tick({ forward: 1, right: 0, jump: false, yawDeg: (Math.atan2(-(t[0] - pos[0]), -(t[2] - pos[2])) * 180) / Math.PI });
        maxY = Math.max(maxY, session.position[1]);
      }
      const end = session.position;
      session.dispose();
      expect(follower.done).toBe(true);
      expect(maxY).toBeGreaterThan(guide.y0 + p.rise - 0.05);
      expect(end[1]).toBeGreaterThan(guide.y0 + p.rise - 0.05);
      expect(maxY).toBeLessThan(guide.y0 + p.rise + 0.4);
    }, 60_000);
  }

  it('a stair too tight for a body is not climbed, and spiralProblems says why', async () => {
    const { world, p } = build({ radius: 1.1 });
    expect(spiralProblems(p).join(' ')).toMatch(/catches on the inner treads/);
    await ensureAssetCatalog(world);
    const guide = stairGuides(world).find((x) => x.id === 'spiral')!;
    const session = await Session.create(world, { trace: false });
    const start = guide.line[0]!;
    session.character.teleport([start[0], start[1] + 0.02, start[2]]);
    const follower = new LineFollower(guide.line, session.position);
    let maxY = -Infinity;
    for (let tick = 0; tick < 400; tick++) {
      const pos = session.position;
      const t = follower.target(pos);
      if (!t) break;
      session.tick({ forward: 1, right: 0, jump: false, yawDeg: (Math.atan2(-(t[0] - pos[0]), -(t[2] - pos[2])) * 180) / Math.PI });
      maxY = Math.max(maxY, session.position[1]);
    }
    session.dispose();
    expect(maxY).toBeLessThan(guide.y0 + p.rise - 0.5);
  }, 60_000);

  for (const { name, params } of CASES) {
    it(`${name}: every room is reached, never stuck, up through the stairwell`, async () => {
      const { world, p } = build(params);
      await ensureAssetCatalog(world);
      const r = await walkthrough(world, { trace: true });
      expect(r.status, r.summary).toBe('passed');
      expect(r.stuckPoints).toEqual([]);
      const guide = stairGuides(world).find((s) => s.id === 'spiral');
      expect(guide).toBeDefined();
      if (!guide || !r.trace) return;
      // The feet were on the treads at several heights along the climb, and reached the floor above.
      const l = spiralLayout(p);
      let top = 0;
      let samples = 0;
      let angleSpan = 0;
      let last: number | null = null;
      for (let f = 0; f < r.trace.frames; f++) {
        const q: Vec3 = [r.trace.poses[f * 4] as number, r.trace.poses[f * 4 + 1] as number, r.trace.poses[f * 4 + 2] as number];
        if (!onStair(guide, q, 0.4)) continue;
        if (q[1] > guide.y0 + 0.4 && q[1] < guide.y0 + p.rise - 0.2) {
          samples++;
          const a = Math.atan2(q[2] - AT[1], q[0] - AT[0]);
          if (last !== null) {
            let d = a - last;
            while (d > Math.PI) d -= 2 * Math.PI;
            while (d < -Math.PI) d += 2 * Math.PI;
            angleSpan += d * l.dir;
          }
          last = a;
        }
        top = Math.max(top, q[1]);
      }
      expect(samples).toBeGreaterThan(10);
      expect(top).toBeGreaterThan(guide.y0 + p.rise - 0.1);
      // It went round the axis the way the stair climbs, about the turns it has.
      expect(angleSpan).toBeGreaterThan(p.turns * 2 * Math.PI * 0.5);
    }, 90_000);
  }
});
