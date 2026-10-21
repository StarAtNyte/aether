/**
 * 60 NPCs on two floors at 60 fps: residents walking routines up and down a stair and guards patrolling both floors,
 * in a compiled house, on the logic runtime alone. Measures the NPC cost per tick and proves the steady state with
 * layered navigation (routes across floors, stair walking, doors held open) allocates (almost) nothing.
 */
import { applyArchOps, fitStair, parsePlan, type PlanStair } from '@aether/arch';
import { applyPatches, createWorld, type EntityId, type EntityInput, type Vec3 } from '@aether/core';
import { EMPTY_INPUT, LogicRuntime } from '@aether/logic';
import { entityColliderBounds, entityWorldBounds } from '@aether/physics';
import { describe, expect, it } from 'vitest';
import { describeSites, probeAllocations } from '../../../tests/unit/alloc-probe';
import { DT, FakeHost } from '../../logic/test/helpers';

const NPC_SRC = /packages\/logic\/src\/npc\//;

function plan(stairs: PlanStair[]): Record<string, unknown> {
  return {
    id: 'h',
    style: 'modern',
    levels: [
      {
        height: 3,
        rooms: [
          { id: 'hall', type: 'hall', rect: [0, 0, 10, 10] },
          { id: 'living', type: 'living', rect: [10, 0, 22, 10] },
        ],
        doors: [{ between: ['living', 'outside'], side: 'south', main: true }, { between: ['hall', 'living'], kind: 'opening', width: 2, at: 0.5 }],
        stairs,
      },
      {
        height: 3,
        rooms: [
          { id: 'landing', type: 'hall', rect: [0, 0, 10, 10] },
          { id: 'gallery', type: 'office', rect: [10, 0, 22, 10] },
        ],
        doors: [{ between: ['landing', 'gallery'], kind: 'opening', width: 2, at: 0.5 }],
      },
    ],
  };
}

/** A host with the document's collider bounds (what the studio and the playtest hosts give the NPC grids). */
class BoundsHost extends FakeHost {
  constructor(private readonly worldRef: () => import('@aether/core').WorldDoc) {
    super();
    this.recordKinematic = false;
  }
  getBounds(id: EntityId): { min: Vec3; max: Vec3 } | undefined {
    return entityWorldBounds(this.worldRef(), id) ?? undefined;
  }
  getColliderBounds(id: EntityId): Array<{ min: Vec3; max: Vec3 }> {
    return entityColliderBounds(this.worldRef(), id);
  }
}

function crowd(n: number): { rt: LogicRuntime; step(i: number): void } {
  const fit = fitStair(parsePlan(plan([])), 0, { room: 'hall', shape: 'l' });
  if (!fit.ok) throw new Error('no stair');
  const base = applyArchOps(createWorld(), [{ op: 'create_building', plan: plan([fit.stair]) }]).target;
  const ents: EntityInput[] = [];
  for (let i = 0; i < n; i++) {
    const x = 11 + (i % 10) * 1.0;
    const z = 1.5 + Math.floor(i / 10) * 1.2;
    const up = i % 2 === 1;
    const y = up ? 3.15 : 0.15;
    const npc =
      i % 5 === 0
        ? { archetype: 'guard', faction: 'watch', radius: 0.3, speed: 1.3, waypoints: [[x, 0.15, z], [x, 3.15, z]] }
        : { archetype: 'villager', faction: 'house', radius: 0.3, speed: 1.0, wander: 0.5, routine: [{ at: [x, y, z], stay: 4 }, { at: [x, up ? 0.15 : 3.15, z], stay: 4 }] };
    ents.push({ id: `p${i}`, shape: { kind: 'primitive', primitive: 'capsule', size: [0.56, 1.7, 0.56] }, transform: { position: [x, y + 0.87, z] }, physics: { body: 'kinematic' }, tags: ['npc'], npc } as unknown as EntityInput);
  }
  const world = applyPatches(base, ents.map((entity) => ({ op: 'add' as const, entity }))).world;
  world.state['health'] = 1e9;
  const host = new BoundsHost(() => world);
  host.player = 'avatar';
  host.place('avatar', [5, 0.15, 25]);
  const rt = new LogicRuntime(world, host);
  return {
    rt,
    step() {
      rt.tick(DT, EMPTY_INPUT, []);
    },
  };
}

describe('NPC crowd on two floors', () => {
  it('60 NPCs walking routines across floors tick well inside a 60 fps frame, and some are on the stair', () => {
    const c = crowd(60);
    expect(c.rt.npcs.count).toBe(60);
    for (let i = 0; i < 600; i++) c.step(i);
    const t0 = performance.now();
    const N = 900;
    let onStair = 0;
    for (let i = 0; i < N; i++) {
      c.step(600 + i);
      if (i % 60 === 0) onStair += c.rt.npcs.infos().filter((x) => x.stair !== null).length;
    }
    const perTick = (performance.now() - t0) / N;
    if (process.env['NPC_PERF']) process.stdout.write(`60 NPCs on two floors: ${perTick.toFixed(3)} ms per tick, ${onStair} on the stair in 15 samples\n`);
    expect(perTick).toBeLessThan(3);
    expect(onStair).toBeGreaterThan(0);
    const floors = new Set(c.rt.npcs.infos().map((x) => x.layer));
    expect(floors.size).toBe(2);
  }, 120_000);

  it('the steady state allocates no objects, arrays or strings per tick', async () => {
    const c = crowd(60);
    let i = 0;
    for (let k = 0; k < 600; k++) c.step(i++);
    const r = await probeAllocations(() => c.step(i++), { iterations: 1500, warmup: 3000, match: NPC_SRC });
    expect(r.bytesPerIteration, describeSites(r)).toBeLessThan(16 * 1024);
  }, 120_000);
});
