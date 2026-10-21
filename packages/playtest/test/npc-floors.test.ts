/**
 * NPCs on more than one floor, in a headless simulation of a compiled two-storey house (Rapier physics, the logic
 * runtime, the player's capsule):
 *
 * - residents walk their day between rooms upstairs and downstairs, taking the stair along its walking line, feet on
 *   the treads, through doorways without getting stuck, never falling;
 * - a guard who sees the player downstairs follows the player up the stair and catches them in the bedroom;
 * - the same world and seed replay identically.
 */
import { applyArchOps, fitStair, parsePlan, type PlanStair } from '@aether/arch';
import { applyPatches, createWorld, type EntityInput, type WorldDoc } from '@aether/core';
import { pointAlong, stairLinks, type NpcInfo } from '@aether/logic';
import { ensureAssetCatalog } from '@aether/physics';
import { describe, expect, it } from 'vitest';
import { Session } from '../src/session';

const UPPER = 3;

/** A hall and a living room with a kitchen downstairs, a landing, a bedroom and a study upstairs. */
function plan(stairs: PlanStair[], residents?: number): Record<string, unknown> {
  return {
    id: 'h',
    style: 'scandinavian',
    ...(residents ? { residents } : {}),
    levels: [
      {
        height: UPPER,
        rooms: [
          { id: 'hall', type: 'hall', rect: [0, 0, 8, 8] },
          { id: 'living', type: 'living', rect: [8, 0, 14, 8] },
          { id: 'kitchen', type: 'kitchen', rect: [8, 8, 14, 12] },
        ],
        doors: [
          { between: ['living', 'outside'], side: 'south', main: true },
          { between: ['hall', 'living'], kind: 'opening', width: 1.4, at: 0.5 },
          { between: ['living', 'kitchen'], kind: 'opening', width: 1.4, at: 0.5 },
        ],
        stairs,
      },
      {
        height: 3,
        rooms: [
          { id: 'landing', type: 'hall', rect: [0, 0, 8, 8] },
          { id: 'bed', type: 'bedroom', rect: [8, 0, 14, 8] },
          { id: 'study', type: 'office', rect: [8, 8, 14, 12] },
        ],
        doors: [
          { between: ['landing', 'bed'], at: 0.5 },
          { between: ['bed', 'study'], at: 0.5 },
        ],
      },
    ],
  };
}

function house(residents?: number, extra: EntityInput[] = []): WorldDoc {
  const fit = fitStair(parsePlan(plan([])), 0, { room: 'hall', shape: 'l' });
  expect(fit.ok).toBe(true);
  if (!fit.ok) throw new Error('no stair');
  const built = applyArchOps(createWorld(), [{ op: 'create_building', plan: plan([fit.stair], residents) }]);
  expect(built.errors).toEqual([]);
  if (extra.length === 0) return built.target;
  return applyPatches(built.target, extra.map((entity) => ({ op: 'add' as const, entity }))).world;
}

interface Track {
  /** Per NPC: feet heights sampled every second, the floors visited off the stair, the longest stuck report. */
  ys: Map<string, number[]>;
  floors: Map<string, Set<number>>;
  stuck: Map<string, number>;
}

async function simulate(world: WorldDoc, seconds: number): Promise<{ track: Track; infos: NpcInfo[]; session: Session }> {
  await ensureAssetCatalog(world);
  const session = await Session.create(world, { trace: false });
  const track: Track = { ys: new Map(), floors: new Map(), stuck: new Map() };
  for (let t = 0; t < seconds; t++) {
    session.idle(1);
    for (const info of session.runtime.npcs.infos()) {
      const ys = track.ys.get(info.id) ?? [];
      ys.push(info.y);
      track.ys.set(info.id, ys);
      const f = track.floors.get(info.id) ?? new Set<number>();
      if (!info.stair) f.add(info.layer);
      track.floors.set(info.id, f);
      track.stuck.set(info.id, Math.max(track.stuck.get(info.id) ?? 0, info.stuck));
    }
  }
  return { track, infos: session.runtime.npcs.infos(), session };
}

describe('NPCs on two floors', () => {
  it('residents walk their day between the floors by the stair, on the treads, never stuck', async () => {
    const world = house(3);
    const residents = Object.keys(world.entities).filter((id) => world.entities[id]?.arch?.role === 'resident');
    expect(residents.length).toBe(3);
    // Each has a day of stops, and somebody's day takes them to the other floor.
    const routines = residents.map((id) => world.entities[id]?.npc?.routine ?? []);
    for (const r of routines) expect(r.length).toBeGreaterThanOrEqual(2);
    expect(routines.some((r) => new Set(r.map((s) => Math.round(s.at[1]))).size > 1)).toBe(true);
    const { track, session } = await simulate(world, 240);
    session.dispose();
    const travellers = residents.filter((id) => (track.floors.get(id)?.size ?? 0) > 1);
    // Most of them went up or down at least once in four minutes, and came off the stair.
    expect(travellers.length).toBeGreaterThanOrEqual(2);
    for (const id of residents) {
      const ys = track.ys.get(id) ?? [];
      // Feet always on a floor or on the stair between them (no fall through a slab, no flight into the air).
      for (const y of ys) expect(y).toBeGreaterThan(-0.2);
      for (const y of ys) expect(y).toBeLessThan(UPPER + 0.6);
      expect(track.stuck.get(id) ?? 0).toBeLessThan(2.5);
    }
  }, 120_000);

  it('a resident on the stair has its feet at the height of the treads under it', async () => {
    const world = house(3);
    const link = stairLinks(world)[0];
    expect(link).toBeDefined();
    if (!link) return;
    await ensureAssetCatalog(world);
    const session = await Session.create(world, { trace: false });
    const pt = new Float32Array(5);
    let checked = 0;
    for (let i = 0; i < 240 * 60 && checked < 120; i++) {
      session.idle(1 / 60);
      for (const info of session.runtime.npcs.infos()) {
        if (!info.stair) continue;
        // The nearest point of the line in plan: its height is the treads' height there.
        let best = Infinity;
        let y = 0;
        for (let u = 0; u <= link.length; u += 0.05) {
          pointAlong(link, u, 1, pt);
          const d = Math.hypot((pt[0] as number) - info.x, (pt[2] as number) - info.z);
          if (d < best) {
            best = d;
            y = pt[1] as number;
          }
        }
        if (best > 0.3) continue;
        expect(Math.abs(info.y - y)).toBeLessThan(0.12);
        checked++;
      }
    }
    session.dispose();
    expect(checked).toBeGreaterThan(20);
  }, 120_000);

  it('a guard who sees the player downstairs follows them up the stair and catches them in the bedroom', async () => {
    const guard = {
      id: 'guard',
      name: 'Guard',
      shape: { kind: 'primitive', primitive: 'capsule', size: [0.56, 1.7, 0.56] },
      transform: { position: [11.5, 1.02, 3], rotation: [0, 90, 0] },
      physics: { body: 'kinematic' },
      character: { wardrobe: 'formal', gender: 'male', age: 'adult', top: '#3f4f6b', bottom: '#2f3a3f', mood: 'neutral', hold: 'none' },
      tags: ['npc'],
      npc: { role: 'guard', archetype: 'guard', faction: 'watch', enemies: ['player'], radius: 0.3, speed: 1.4, runSpeed: 3.2, perception: { sight: 14, fov: 220, hearing: 10, memory: 15, alert: 0 }, attack: { damage: 4, range: 1.6, cooldown: 0.8 }, leash: 60 },
    } as unknown as EntityInput;
    const world = house(undefined, [guard]);
    world.state['health'] = 1000;
    const link = stairLinks(world)[0];
    if (!link) throw new Error('no stair');
    await ensureAssetCatalog(world);
    const session = await Session.create(world, { trace: false });
    let usedStair = false;
    const at = (x: number, y: number, z: number): void => {
      session.character.teleport([x, y, z]);
      session.tick({ forward: 0, right: 0, jump: false, yawDeg: 0 });
      const g = session.runtime.npcs.info('guard');
      if (g?.stair) usedStair = true;
    };
    const walk = (x0: number, z0: number, x1: number, z1: number, y: number, speed: number): void => {
      const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / (speed / 60)));
      for (let i = 1; i <= n; i++) at(x0 + ((x1 - x0) * i) / n, y, z0 + ((z1 - z0) * i) / n);
    };
    // The player shows up in the living room in the guard's view and is chased ...
    for (let i = 0; i < 60; i++) at(9.6, 0.15, 3.2);
    expect(session.runtime.npcs.info('guard')?.mode).toMatch(/chase|attack/);
    // ... runs through the opening to the hall, up the stair along its line and into the bedroom ...
    walk(9.6, 3.2, 6, 4, 0.15, 3.4);
    walk(6, 4, link.line[0] as number, link.line[2] as number, 0.15, 3.4);
    const pt = new Float32Array(5);
    for (let u = 0; u <= link.length; u += 3 / 60) {
      pointAlong(link, u, 1, pt);
      at(pt[0] as number, (pt[1] as number) + 0.02, pt[2] as number);
    }
    const tx = link.line[(link.n - 1) * 3] as number;
    const tz = link.line[(link.n - 1) * 3 + 2] as number;
    walk(tx, tz, 7, 4, UPPER + 0.15, 3);
    walk(7, 4, 11.5, 3.5, UPPER + 0.15, 3);
    // ... and stays there: the guard comes up the stair and strikes in the bedroom.
    const before = Number(session.runtime.readState('health'));
    let wentUp = false;
    let closest = Infinity;
    for (let i = 0; i < 60 * 30; i++) {
      at(11.5, UPPER + 0.15, 3.5);
      const g = session.runtime.npcs.info('guard');
      if (!g) continue;
      if (g.layer === 1 && !g.stair) {
        wentUp = true;
        closest = Math.min(closest, Math.hypot(g.x - 11.5, g.z - 3.5));
      }
    }
    const after = Number(session.runtime.readState('health'));
    session.dispose();
    expect(usedStair).toBe(true);
    expect(wentUp).toBe(true);
    expect(closest).toBeLessThan(2);
    expect(after).toBeLessThan(before);
  }, 120_000);

  it('a resident lets the player on the stair go first, then takes it', async () => {
    const probe = house();
    const link = stairLinks(probe)[0];
    if (!link) throw new Error('no stair');
    const foot = [link.line[0] as number, link.line[2] as number] as const;
    const top = [link.line[(link.n - 1) * 3] as number, link.line[(link.n - 1) * 3 + 2] as number] as const;
    const walker = {
      id: 'walker',
      shape: { kind: 'primitive', primitive: 'capsule', size: [0.56, 1.7, 0.56] },
      transform: { position: [foot[0] + 1.5, 1.02, foot[1] - 1] },
      physics: { body: 'kinematic' },
      tags: ['npc'],
      npc: { role: 'resident', faction: 'household', radius: 0.3, speed: 1, routine: [{ at: [top[0] + 3, UPPER + 0.15, top[1]], stay: 60 }] },
    } as unknown as EntityInput;
    const world = house(undefined, [walker]);
    await ensureAssetCatalog(world);
    const session = await Session.create(world, { trace: false });
    const pt = new Float32Array(5);
    pointAlong(link, link.length * 0.5, 1, pt);
    // The player stands halfway up: the walker comes to the foot and waits there.
    let onStairWhilePlayer = false;
    for (let i = 0; i < 60 * 5; i++) {
      session.character.teleport([pt[0] as number, (pt[1] as number) + 0.02, pt[2] as number]);
      session.tick({ forward: 0, right: 0, jump: false, yawDeg: 0 });
      if (session.runtime.npcs.info('walker')?.stair) onStairWhilePlayer = true;
    }
    expect(onStairWhilePlayer).toBe(false);
    const waiting = session.runtime.npcs.info('walker');
    expect(Math.hypot((waiting?.x ?? 0) - foot[0], (waiting?.z ?? 0) - foot[1])).toBeLessThan(1.2);
    // The player goes on up and away: the walker follows its day upstairs.
    let up = false;
    for (let i = 0; i < 60 * 15 && !up; i++) {
      session.character.teleport([12, UPPER + 0.15, 6]);
      session.tick({ forward: 0, right: 0, jump: false, yawDeg: 0 });
      const w = session.runtime.npcs.info('walker');
      if (w && w.layer === 1 && !w.stair) up = true;
    }
    session.dispose();
    expect(up).toBe(true);
  }, 120_000);

  it('replays identically: the same world and seed give the same people in the same places', async () => {
    const run = async (): Promise<NpcInfo[]> => {
      const { infos, session } = await simulate(house(3), 90);
      session.dispose();
      return infos;
    };
    expect(await run()).toEqual(await run());
  }, 120_000);
});
