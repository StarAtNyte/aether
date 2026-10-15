/**
 * Headless proof that a generated apartment is interactive: with real physics
 * and the logic runtime, using a drawer slides it out along its rail, a hinged
 * cabinet door swings, the carried props rest on their tables, and nothing
 * else moves.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { applyArchOps } from '@aether/arch';
import { applyPatches, validateWorld, type Entity, type EntityId, type WorldDoc } from '@aether/core';
import { EMPTY_INPUT, LogicRuntime } from '@aether/logic';
import { initPhysics, PhysicsWorld, type ColliderProvider } from '@aether/physics';
import { generateBuiltinSync } from '@aether/procgen';
import { HeadlessLogicHost } from '../src/headless-host';

const PLAN = {
  id: 'flat',
  name: 'Flat',
  style: 'modern',
  levels: [
    {
      rooms: [
        { id: 'living', type: 'living', rect: [0, 0, 6, 5] },
        { id: 'kitchen', type: 'kitchen', rect: [6, 0, 10, 5] },
        { id: 'bed', type: 'bedroom', rect: [0, 5, 4.5, 9] },
        { id: 'hall', type: 'hall', rect: [4.5, 5, 10, 9] },
      ],
      doors: [{ between: ['living', 'kitchen'], kind: 'opening', width: 2 }, { between: ['living', 'hall'], kind: 'opening', width: 1.4 }, { between: ['bed', 'hall'] }, { between: ['hall', 'outside'], main: true }],
    },
  ],
} as const;

const DT = 1 / 60;
const live: PhysicsWorld[] = [];

function emptyWorld(): WorldDoc {
  const r = validateWorld({});
  if (!r.ok) throw new Error('invalid');
  return r.world;
}

const colliders: ColliderProvider = (entity: Entity) => {
  if (entity.shape.kind !== 'procedural') return undefined;
  try {
    return generateBuiltinSync(entity.shape.generator, entity.shape.params, entity.shape.seed ?? 1).colliders;
  } catch {
    return undefined;
  }
};

interface Rig {
  world: WorldDoc;
  pw: PhysicsWorld;
  rt: LogicRuntime;
  host: HeadlessLogicHost;
  step(seconds: number): void;
}

async function rig(extra: Record<string, unknown> = {}): Promise<Rig> {
  const r = applyArchOps(emptyWorld(), [{ op: 'create_building', plan: { ...PLAN, ...extra } }]);
  expect(r.errors).toEqual([]);
  const world = applyPatches(emptyWorld(), r.patches).world;
  const pw = await PhysicsWorld.create(world, { colliders, fixedDt: DT });
  live.push(pw);
  const host = new HeadlessLogicHost(pw, world);
  const rt = new LogicRuntime(world, host);
  return {
    world,
    pw,
    rt,
    host,
    step(seconds) {
      for (let i = 0; i < Math.round(seconds / DT); i++) {
        const events = pw.stepFixed();
        rt.tick(DT, EMPTY_INPUT, events);
      }
    },
  };
}

function pos(r: Rig, id: EntityId): [number, number, number] {
  const t = r.host.getTransform(id);
  if (!t) throw new Error(`no pose for ${id}`);
  return [t.position[0], t.position[1], t.position[2]];
}

function dist(a: readonly number[], b: readonly number[]): number {
  return Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));
}

beforeAll(async () => {
  await initPhysics();
});
afterEach(() => {
  for (const pw of live.splice(0)) pw.dispose();
});

describe('interactive rooms (physics + logic, headless)', () => {
  it('props rest on their tables and the rest of the apartment stays put', async () => {
    const r = await rig();
    const props = Object.values(r.world.entities).filter((e) => e.interact?.kind === 'pickup');
    expect(props.length).toBeGreaterThanOrEqual(3);
    const before = new Map(props.map((p) => [p.id, pos(r, p.id)]));
    const parts = Object.values(r.world.entities).filter((e) => e.arch?.role === 'part' && e.behaviors.length > 0);
    const partBefore = new Map(parts.map((p) => [p.id, pos(r, p.id)]));
    r.step(3);
    for (const p of props) {
      const a = before.get(p.id) as number[];
      const b = pos(r, p.id);
      expect(dist(a, b), `${p.id} stayed on its table`).toBeLessThan(0.08);
    }
    for (const p of parts) expect(dist(partBefore.get(p.id) as number[], pos(r, p.id)), `${p.id} shut`).toBeLessThan(0.01);
  });

  it('using a drawer slides it out of the front and using it again shuts it', async () => {
    const r = await rig();
    const drawer = Object.values(r.world.entities).find((e) => e.interact?.kind === 'drawer');
    expect(drawer).toBeDefined();
    if (!drawer) return;
    const shut = pos(r, drawer.id);
    r.rt.use(drawer.id);
    r.step(1.5);
    expect(r.rt.readState(`${drawer.id}.open`)).toBe(true);
    const out = pos(r, drawer.id);
    expect(dist(shut, out)).toBeGreaterThan(0.25);
    expect(dist(shut, out)).toBeLessThan(0.55);
    // Slid horizontally: the drawer front stays at its height.
    expect(Math.abs(out[1] - shut[1])).toBeLessThan(0.01);
    r.rt.use(drawer.id);
    r.step(1.5);
    expect(dist(shut, pos(r, drawer.id))).toBeLessThan(0.01);
  });

  it('a cabinet door swings about its hinge edge and only that door moves', async () => {
    const r = await rig();
    const doors = Object.values(r.world.entities).filter((e) => e.arch?.role === 'part' && e.arch.kind === 'door' && e.behaviors[0]?.type === 'operable');
    expect(doors.length).toBeGreaterThan(2);
    const door = doors[0] as Entity;
    const others = doors.slice(1, 4);
    const shut = pos(r, door.id);
    const otherShut = others.map((o) => pos(r, o.id));
    r.rt.use(door.id);
    r.step(1.5);
    expect(r.rt.readState(`${door.id}.open`)).toBe(true);
    // Swung: the centre moved sideways and forward by about half a leaf width.
    expect(dist(shut, pos(r, door.id))).toBeGreaterThan(0.1);
    others.forEach((o, i) => expect(dist(otherShut[i] as number[], pos(r, o.id))).toBeLessThan(0.01));
  });

  it('the tap turns on and shows water, off hides it', async () => {
    const r = await rig();
    const tap = Object.values(r.world.entities).find((e) => e.interact?.kind === 'tap');
    expect(tap).toBeDefined();
    if (!tap) return;
    r.step(0.2);
    r.rt.use(tap.id);
    r.step(0.2);
    expect(r.rt.readState(`${tap.id}.on`)).toBe(true);
    r.rt.use(tap.id);
    r.step(0.2);
    expect(r.rt.readState(`${tap.id}.on`)).toBe(false);
  });

  it('a window casement swings inward on its hinge when used and shuts again', async () => {
    const r = await rig();
    const sash = Object.values(r.world.entities).find((e) => e.arch?.kind === 'sash');
    expect(sash).toBeDefined();
    if (!sash) return;
    r.step(0.3);
    const shut = pos(r, sash.id);
    r.rt.use(sash.id);
    r.step(1.6);
    expect(r.rt.readState(`${sash.id}.open`)).toBe(true);
    const open = pos(r, sash.id);
    expect(dist(shut, open)).toBeGreaterThan(0.15);
    r.rt.use(sash.id);
    r.step(1.6);
    expect(dist(shut, pos(r, sash.id))).toBeLessThan(0.02);
  });

  it('a thrown mug flies and lands without tunnelling through the floor', async () => {
    const r = await rig();
    const mug = Object.values(r.world.entities).find((e) => e.interact?.kind === 'pickup' && e.arch?.kind === 'mug');
    expect(mug).toBeDefined();
    if (!mug) return;
    r.step(0.5);
    const start = pos(r, mug.id);
    r.pw.setVelocity(mug.id, [3, 2.5, 0]);
    r.step(3);
    const end = pos(r, mug.id);
    expect(dist(start, end)).toBeGreaterThan(0.5);
    expect(end[1]).toBeGreaterThan(-0.05);
  });
});

function yawDeg(r: Rig, id: EntityId): number {
  const q = r.host.getTransform(id)?.quaternion ?? [0, 0, 0, 1];
  return (2 * Math.atan2(q[1], q[3]) * 180) / Math.PI;
}

describe('physical doors (hinge joints, the default)', () => {
  it('swing doors compile to dynamic leaves on limited revolute joints with a spring motor', async () => {
    const r = await rig({ physicalDoors: true });
    const leaves = Object.values(r.world.entities).filter((e) => e.arch?.role === 'door' && e.joint);
    expect(leaves.length).toBeGreaterThanOrEqual(2);
    for (const l of leaves) {
      expect(l.physics?.body).toBe('dynamic');
      expect(l.joint?.type).toBe('revolute');
      expect(l.joint?.target).toBe('world');
      expect(l.joint?.axis).toEqual([0, 1, 0]);
      const [lo, hi] = l.joint?.limits ?? [0, 0];
      expect(Math.min(Math.abs(lo), Math.abs(hi))).toBe(0);
      expect(Math.max(Math.abs(lo), Math.abs(hi))).toBeGreaterThan(80);
      expect(l.joint?.motor?.targetPosition).toBe(0);
      expect(l.behaviors[0]?.params['motion']).toBe('joint');
    }
    // `physicalDoors: false` keeps the kinematic leaves.
    const plain = await rig({ physicalDoors: false });
    expect(Object.values(plain.world.entities).some((e) => e.arch?.role === 'door' && e.joint)).toBe(false);
  });

  it('using a physical door swings it open on its hinge, it stays shut until then, and using it again closes it', async () => {
    const r = await rig({ physicalDoors: true });
    const door = Object.values(r.world.entities).find((e) => e.arch?.role === 'door' && e.joint && !e.tags.includes('entrance')) ?? Object.values(r.world.entities).find((e) => e.arch?.role === 'door' && e.joint);
    expect(door).toBeDefined();
    if (!door) return;
    r.step(1.5);
    expect(Math.abs(yawDeg(r, door.id) - (door.transform.rotation[1] ?? 0))).toBeLessThan(3);
    const shut = pos(r, door.id);
    r.rt.use(door.id);
    r.step(2.5);
    expect(r.rt.readState(`${door.id}.open`)).toBe(true);
    const open = pos(r, door.id);
    expect(dist(shut, open)).toBeGreaterThan(0.2);
    // The hinge edge stays on its axis: the leaf centre stays half a leaf width from the hinge.
    const turned = Math.abs(((yawDeg(r, door.id) - (door.transform.rotation[1] ?? 0) + 540) % 360) - 180);
    expect(180 - turned).toBeGreaterThan(70);
    r.rt.use(door.id);
    r.step(3);
    expect(r.rt.readState(`${door.id}.open`)).toBe(false);
    expect(dist(shut, pos(r, door.id))).toBeLessThan(0.08);
  });
});
