/**
 * A person playing who walks up an L stair hugging the inside of the turn, pressing toward the inner edge of the first
 * flight all the way, is held on the stair by its balustrade and climbs on: the capsule never gets its top under the
 * slab that borders the stairwell there, and never drops off the flight into the room below. Without the balustrade
 * (the stair as it was) the same input takes the capsule off the edge. Also: the walkthrough bot still walks every
 * room of the balustraded house.
 */
import { applyArchOps, fitStair, parsePlan, rotateYaw, StairParams, stairLayout, type PlanStair } from '@aether/arch';
import { createWorld, worldTransform, type Json, type Vec3, type WorldDoc } from '@aether/core';
import { ensureAssetCatalog } from '@aether/physics';
import { describe, expect, it } from 'vitest';
import { Session } from '../src/session';
import { walkthrough } from '../src';

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

/** The same world with the stair as it was before balustrades (no guards). */
function withoutGuards(world: WorldDoc): WorldDoc {
  const copy = structuredClone(world);
  for (const e of Object.values(copy.entities)) {
    if (e.shape.kind !== 'procedural' || e.shape.generator !== 'arch-stair') continue;
    const p = { ...(e.shape.params as Record<string, Json>) };
    delete p['guards'];
    e.shape = { ...e.shape, params: p };
  }
  return copy;
}

interface Hug {
  /** Highest the feet got, and how far past the inner edge the capsule's centre went (m, negative: inside). */
  maxY: number;
  maxPast: number;
  /** Lowest the feet got after the start (a drop off the flight). */
  minY: number;
  landingY: number;
  /** Entities the capsule's head overlaps at the end. */
  head: string[];
}

/** Start two thirds up the first flight against its inner edge and press forward and toward the inside for 5 s. */
async function hug(world: WorldDoc): Promise<Hug> {
  const id = Object.keys(world.entities).find((k) => world.entities[k]?.shape.kind === 'procedural' && (world.entities[k]?.shape as { generator?: string }).generator === 'arch-stair');
  if (!id) throw new Error('no stair');
  const e = world.entities[id];
  if (!e || e.shape.kind !== 'procedural') throw new Error('no stair');
  const sp = StairParams.parse(e.shape.params);
  const t = worldTransform(world, id);
  const yaw = (2 * Math.atan2(t.quaternion[1], t.quaternion[3]) * 180) / Math.PI;
  const toWorld = (x: number, z: number): [number, number] => {
    const r = rotateYaw(x, z, yaw);
    return [t.position[0] + r[0], t.position[2] + r[1]];
  };
  const { flights, landings, riser } = stairLayout(sp);
  const f1 = flights[0];
  const landing = landings[0];
  if (!f1 || !landing) throw new Error('not an L');
  const s = sp.turn === 'left' ? -1 : 1;
  const hw = sp.width / 2;
  const along = f1.treads * sp.going * 0.6;
  const start = toWorld(along, s * (hw - 0.4));
  const y0 = t.position[1] + Math.ceil(along / sp.going) * riser + 0.02;
  const dir = rotateYaw(1, 0, yaw);
  const session = await Session.create(world, { trace: false });
  session.character.teleport([start[0], y0, start[1]]);
  const yawDeg = (Math.atan2(-dir[0], -dir[1]) * 180) / Math.PI;
  let maxY = -Infinity;
  let minY = Infinity;
  let maxPast = -Infinity;
  for (let i = 0; i < 300; i++) {
    session.tick({ forward: 1, right: s * 0.7, jump: false, yawDeg });
    const p: Vec3 = session.position;
    maxY = Math.max(maxY, p[1]);
    if (i > 20) minY = Math.min(minY, p[1]);
    // In the stair's frame: how far toward the inside the centre is, while beside the first flight.
    const dx = p[0] - t.position[0];
    const dz = p[2] - t.position[2];
    const local = rotateYaw(dx, dz, -yaw);
    if (local[0] < landing.x0 - 0.05) maxPast = Math.max(maxPast, s * local[1] - hw);
  }
  // What the capsule's head touches where it ends (the slab of the floor above, when wedged under it).
  const end = session.position;
  const head = session.pw.overlapsSphere([end[0], end[1] + 1.35, end[2]], 0.37).filter((x) => x !== 'player');
  session.dispose();
  return { maxY, minY, maxPast, landingY: t.position[1] + landing.y, head };
}

describe('stair balustrades hold a person on the stair', () => {
  // The first L that wedged the bot (1 m, heading north, turning right) and its mirror.
  for (const turn of ['right', 'left'] as const) {
    it(`1 m L turning ${turn}: pressing into the inner edge climbs to the landing, never under the slab, never off the flight`, async () => {
      const fit = fitStair(parsePlan(house([])), 0, { room: 'hall', heading: 'north', shape: 'l', turn, width: 1 });
      expect(fit.ok).toBe(true);
      if (!fit.ok) return;
      const world = build(fit.stair);
      await ensureAssetCatalog(world);
      const guarded = await hug(world);
      // Climbs on to the landing; the capsule (0.35 m) stays inside the edge: its side at most at the balustrade.
      expect(guarded.maxY).toBeGreaterThan(guarded.landingY - 0.05);
      expect(guarded.maxPast).toBeLessThan(-0.3);
      expect(guarded.minY).toBeGreaterThan(guarded.landingY - 0.9);
      expect(guarded.head).not.toContain('h-l1-landing');
      // Without the balustrade the same input takes the capsule over the edge, its head under the slab, and there it
      // stays below the landing.
      const bare = await hug(withoutGuards(world));
      expect(bare.maxPast).toBeGreaterThan(-0.2);
      expect(bare.maxY).toBeLessThan(bare.landingY - 0.1);
      expect(bare.head).toContain('h-l1-landing');
    }, 60_000);
  }

  it('the walkthrough bot still walks every room of a balustraded house', async () => {
    const fit = fitStair(parsePlan(house([])), 0, { room: 'hall', heading: 'north', shape: 'l', turn: 'right', width: 1 });
    if (!fit.ok) throw new Error('no fit');
    const world = build(fit.stair);
    await ensureAssetCatalog(world);
    const r = await walkthrough(world, { trace: false });
    expect(r.status, r.summary).toBe('passed');
    expect(r.stuckPoints).toEqual([]);
  }, 60_000);
});
