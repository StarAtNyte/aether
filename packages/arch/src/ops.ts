/**
 * Architecture operations for agents and tools: a batch of high-level edits
 * (create a building, add a level / room / door / window / stair, set the
 * roof, furnish or re-style rooms, place items, change materials) applied to
 * the buildings' plans, re-compiled, and turned into the minimal World IR
 * patch list (`patchesBetween`). Entities the user locked are preserved.
 * Failures are refusals with a code and a fix hint, per op; the other ops
 * still apply.
 */
import { deepEqual, Entity, patchesBetween, PlayerSpec, WorldTest, type EntityId, type Patch, type WorldDoc } from '@aether/core';
import { z } from 'zod';
import { MaterialSpec } from '@aether/core';
import { compileBuilding, parsePlan, PlanError, type CompiledBuilding } from './compile';
import { checkBuilding, summarizeBuildingReports, type BuildingReport } from './nav';
import { area } from './math2';
import { ArchStyle, PlanDoor, PlanItem, PlanLevel, PlanRoof, PlanRoom, PlanStair, PlanWindow, type BuildingPlan } from './plan';
import { roomPolygon } from './rooms';

/** Upper bound of ops per call. */
export const MAX_ARCH_OPS = 40;

const Id = z.string().min(1).max(64);
const Unknown = z.unknown();

/** One architecture operation (untrusted input; nested parts are validated per op). */
export const ArchOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('create_building'), plan: Unknown, walkthrough: z.boolean().default(true) }),
  z.object({ op: z.literal('remove_building'), building: Id }),
  z.object({ op: z.literal('add_level'), building: Id, level: Unknown }),
  z.object({ op: z.literal('add_room'), building: Id, level: z.number().int().min(0).max(5).default(0), room: Unknown, doors: z.array(Unknown).max(8).default([]) }),
  z.object({ op: z.literal('remove_room'), building: Id, room: Id }),
  z.object({ op: z.literal('add_door'), building: Id, level: z.number().int().min(0).max(5).default(0), door: Unknown }),
  z.object({ op: z.literal('add_window'), building: Id, level: z.number().int().min(0).max(5).default(0), window: Unknown }),
  z.object({ op: z.literal('add_stairs'), building: Id, level: z.number().int().min(0).max(5).default(0), stair: Unknown }),
  z.object({ op: z.literal('set_roof'), building: Id, roof: Unknown }),
  z.object({ op: z.literal('set_style'), building: Id, style: ArchStyle }),
  z.object({ op: z.literal('furnish_room'), building: Id, room: Id, furnish: z.boolean().default(true), items: z.array(Unknown).max(60).optional(), omit: z.array(z.string().max(40)).max(20).optional() }),
  z.object({ op: z.literal('place_item'), building: Id, room: Id, item: Unknown }),
  z.object({ op: z.literal('remove_item'), building: Id, room: Id, kind: z.string().min(1).max(40) }),
  z.object({ op: z.literal('set_material'), building: Id, target: z.enum(['exterior', 'roof', 'floor', 'walls']), room: Id.optional(), material: MaterialSpec }),
]);
export type ArchOp = z.infer<typeof ArchOp>;

/** A refused op. */
export interface ArchOpError {
  index: number;
  op: string;
  code: string;
  message: string;
  hint: string;
}

/** Result of {@link applyArchOps}. */
export interface ArchOpsResult {
  patches: Patch[];
  /** One line per successful op. */
  lines: string[];
  errors: ArchOpError[];
  /** Compiled buildings (id → stats / notes). */
  compiled: CompiledBuilding[];
  /** Usability check of every touched building (after the edit). */
  reports: BuildingReport[];
  /** The world after the patches (validated by the caller's applyPatches again). */
  target: WorldDoc;
}

function issues(e: z.ZodError): string {
  return e.issues.slice(0, 4).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}

function parseWith<S extends z.ZodType>(schema: S, value: unknown, what: string, hint: string): z.infer<S> {
  const r = schema.safeParse(value);
  if (!r.success) throw new PlanError(`invalid_${what}`, `invalid ${what}: ${issues(r.error)}`, hint);
  return r.data;
}

/** Load the plan of a building entity from the world. */
export function planOf(world: WorldDoc, building: EntityId): BuildingPlan {
  const e = Object.hasOwn(world.entities, building) ? world.entities[building] : undefined;
  if (!e || e.arch?.role !== 'building') {
    const known = Object.values(world.entities).filter((x) => x.arch?.role === 'building').map((x) => x.id);
    throw new PlanError('building_not_found', `no building "${building}"`, known.length > 0 ? `Use one of: ${known.join(', ')}.` : 'Create one first with create_building.');
  }
  if (e.arch.plan === undefined) throw new PlanError('no_plan', `building "${building}" has no stored plan`, 'Re-create it with create_building.');
  return parsePlan(e.arch.plan);
}

function levelOf(plan: BuildingPlan, index: number): PlanLevel {
  const l = plan.levels[index];
  if (!l) throw new PlanError('level_not_found', `building "${plan.id}" has no level ${index}`, `Levels are 0..${plan.levels.length - 1}; add one with add_level.`);
  return l;
}

function roomOf(plan: BuildingPlan, id: string): { level: PlanLevel; room: PlanRoom } {
  const short = id.startsWith(`${plan.id}-`) ? id.slice(plan.id.length + 1) : id;
  for (const level of plan.levels) {
    const room = level.rooms.find((r) => r.id === short);
    if (room) return { level, room };
  }
  throw new PlanError('room_not_found', `building "${plan.id}" has no room "${id}"`, `Rooms: ${plan.levels.flatMap((l) => l.rooms.map((r) => r.id)).join(', ')}.`);
}

/** All entity ids of a building's subtree. */
function subtree(world: WorldDoc, root: EntityId): Set<EntityId> {
  const ids = new Set<EntityId>([root]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of Object.values(world.entities)) {
      if (e.parent && ids.has(e.parent) && !ids.has(e.id)) {
        ids.add(e.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** Apply a batch of architecture ops to `world` (pure). */
export function applyArchOps(world: WorldDoc, rawOps: readonly unknown[]): ArchOpsResult {
  const errors: ArchOpError[] = [];
  const lines: string[] = [];
  const plans = new Map<EntityId, BuildingPlan>();
  const removed = new Set<EntityId>();
  const walkthrough = new Set<EntityId>();
  const ops = rawOps.slice(0, MAX_ARCH_OPS);
  if (rawOps.length > MAX_ARCH_OPS) errors.push({ index: MAX_ARCH_OPS, op: '…', code: 'too_many_ops', message: `only the first ${MAX_ARCH_OPS} ops were applied`, hint: 'Send the rest in another call.' });
  const load = (id: EntityId): BuildingPlan => {
    const cached = plans.get(id);
    if (cached) return cached;
    const p = planOf(world, id);
    plans.set(id, p);
    return p;
  };
  ops.forEach((raw, index) => {
    const parsed = ArchOp.safeParse(raw);
    const opName = typeof raw === 'object' && raw !== null && 'op' in raw ? String((raw as { op: unknown }).op).slice(0, 40) : '?';
    if (!parsed.success) {
      errors.push({ index, op: opName, code: 'invalid_op', message: issues(parsed.error), hint: 'Each op needs "op" plus its fields (see the build_architecture tool description).' });
      return;
    }
    const op = parsed.data;
    try {
      switch (op.op) {
        case 'create_building': {
          const plan = parsePlan(op.plan);
          const existing = Object.hasOwn(world.entities, plan.id) ? world.entities[plan.id] : undefined;
          if (existing && existing.arch?.role !== 'building') throw new PlanError('id_taken', `entity "${plan.id}" already exists and is not a building`, 'Choose another building id.');
          plans.set(plan.id, plan);
          removed.delete(plan.id);
          if (op.walkthrough) walkthrough.add(plan.id);
          const rooms = plan.levels.reduce((n, l) => n + l.rooms.length, 0);
          lines.push(`create_building ${plan.id}: ${plan.levels.length} level(s), ${rooms} rooms, ${plan.style}`);
          break;
        }
        case 'remove_building': {
          load(op.building);
          plans.delete(op.building);
          removed.add(op.building);
          lines.push(`remove_building ${op.building}`);
          break;
        }
        case 'add_level': {
          const plan = load(op.building);
          const level = parseWith(PlanLevel, op.level, 'level', 'A level needs rooms: [{id, type, rect:[x0,z0,x1,z1]}] and usually doors.');
          plan.levels.push(level);
          lines.push(`add_level ${op.building}: level ${plan.levels.length - 1} with ${level.rooms.length} rooms`);
          break;
        }
        case 'add_room': {
          const plan = load(op.building);
          const level = levelOf(plan, op.level);
          const room = parseWith(PlanRoom, op.room, 'room', 'A room needs id, type and rect [x0,z0,x1,z1] sharing an edge with an existing room.');
          level.rooms.push(room);
          for (const d of op.doors) level.doors.push(parseWith(PlanDoor, d, 'door', 'Doors: {between:[roomId, roomId|"outside"], width?, at?}.'));
          lines.push(`add_room ${room.id} (${room.type}, ${area(roomPolygon(room)).toFixed(1)} m²) on level ${op.level}`);
          break;
        }
        case 'remove_room': {
          const plan = load(op.building);
          const { level, room } = roomOf(plan, op.room);
          level.rooms = level.rooms.filter((r) => r !== room);
          level.doors = level.doors.filter((d) => !d.between.includes(room.id));
          level.windows = level.windows.filter((w) => w.room !== room.id);
          if (level.rooms.length === 0) throw new PlanError('empty_level', 'that was the last room of its level', 'Remove the level instead (re-create the building without it).');
          lines.push(`remove_room ${room.id}`);
          break;
        }
        case 'add_door': {
          const plan = load(op.building);
          levelOf(plan, op.level).doors.push(parseWith(PlanDoor, op.door, 'door', 'Doors: {between:[roomId, roomId|"outside"], width?, at?, kind?: swing|sliding|opening}.'));
          lines.push(`add_door on level ${op.level}`);
          break;
        }
        case 'add_window': {
          const plan = load(op.building);
          levelOf(plan, op.level).windows.push(parseWith(PlanWindow, op.window, 'window', 'Windows: {room, side: north|south|east|west, count?, width?, height?, sill?}.'));
          lines.push(`add_window on level ${op.level}`);
          break;
        }
        case 'add_stairs': {
          const plan = load(op.building);
          levelOf(plan, op.level).stairs.push(parseWith(PlanStair, op.stair, 'stair', 'Stairs: {at:[x,z] (first riser), heading: north|south|east|west, shape?: straight|l|u, width?}.'));
          lines.push(`add_stairs on level ${op.level}`);
          break;
        }
        case 'set_roof': {
          const plan = load(op.building);
          plan.roof = parseWith(PlanRoof, op.roof, 'roof', 'Roofs: {shape: flat|gable|hip|shed, pitch?, overhang?}.');
          lines.push(`set_roof ${plan.roof.shape}`);
          break;
        }
        case 'set_style': {
          const plan = load(op.building);
          plan.style = op.style;
          lines.push(`set_style ${op.style}`);
          break;
        }
        case 'furnish_room': {
          const plan = load(op.building);
          const { room } = roomOf(plan, op.room);
          room.furnish = op.furnish;
          if (op.items) room.items = op.items.map((i) => parseWith(PlanItem, i, 'item', 'Items: {kind, params?, at?:[x,z], yaw?, against?}.'));
          if (op.omit) room.omit = op.omit;
          lines.push(`furnish_room ${room.id}${op.furnish ? '' : ' (layout off)'}`);
          break;
        }
        case 'place_item': {
          const plan = load(op.building);
          const { room } = roomOf(plan, op.room);
          const item = parseWith(PlanItem, op.item, 'item', 'Items: {kind: "sofa"|"bed"|… , params?, at?:[x,z], yaw?, against?: north|south|east|west}.');
          room.items.push(item);
          room.omit = room.omit.filter((k) => k !== item.kind);
          lines.push(`place_item ${item.kind} in ${room.id}`);
          break;
        }
        case 'remove_item': {
          const plan = load(op.building);
          const { room } = roomOf(plan, op.room);
          room.items = room.items.filter((i) => i.kind !== op.kind);
          if (!room.omit.includes(op.kind)) room.omit.push(op.kind);
          lines.push(`remove_item ${op.kind} from ${room.id}`);
          break;
        }
        case 'set_material': {
          const plan = load(op.building);
          if (op.target === 'exterior') plan.exteriorWall.finish = op.material;
          else if (op.target === 'roof') plan.roof.finish = op.material;
          else {
            const rooms = op.room ? [roomOf(plan, op.room).room] : plan.levels.flatMap((l) => l.rooms);
            for (const r of rooms) {
              if (op.target === 'floor') r.floor = op.material;
              else if (op.material.color) r.wallColor = op.material.color;
            }
          }
          lines.push(`set_material ${op.target}${op.room ? ` (${op.room})` : ''}`);
          break;
        }
      }
    } catch (e) {
      if (e instanceof PlanError) errors.push({ index, op: op.op, code: e.code, message: e.message, hint: e.hint });
      else throw e;
    }
  });

  // Compile the touched buildings and assemble the target world.
  const entities: Record<string, Entity> = { ...world.entities };
  const compiled: CompiledBuilding[] = [];
  let player = world.player;
  let tests = world.tests;
  const dropSubtree = (id: EntityId): void => {
    for (const x of subtree(world, id)) if (!world.entities[x]?.locked) delete entities[x];
  };
  for (const id of removed) {
    dropSubtree(id);
    tests = tests.filter((t) => !(t.kind === 'navigable' && t.target === id));
  }
  for (const [id, plan] of plans) {
    let result: CompiledBuilding;
    try {
      result = compileBuilding(plan);
    } catch (e) {
      if (e instanceof PlanError) {
        errors.push({ index: -1, op: `compile ${id}`, code: e.code, message: e.message, hint: e.hint });
        continue;
      }
      throw e;
    }
    compiled.push(result);
    if (Object.hasOwn(world.entities, id)) dropSubtree(id);
    for (const raw of result.entities) {
      const parsed = Entity.parse(raw);
      const old = Object.hasOwn(world.entities, parsed.id) ? world.entities[parsed.id] : undefined;
      if (old?.locked) continue;
      entities[parsed.id] = old && deepEqual(old, parsed) ? old : parsed;
    }
    if (!tests.some((t) => t.kind === 'navigable' && t.target === id)) tests = [...tests, WorldTest.parse({ id: `${id}-usable`.slice(0, 64), kind: 'navigable', target: id })];
    if (walkthrough.has(id) && result.spawn) player = PlayerSpec.parse({ ...player, mode: 'firstPerson', spawn: result.spawn, moveSpeed: 3.2, jumpSpeed: 4 });
  }
  const target: WorldDoc = { ...world, entities, player, tests };
  const patches = patchesBetween(world, target);
  const reports = compiled.map((c) => checkBuilding(target, c.id));
  for (const c of compiled) {
    const s = c.stats;
    lines.push(`${c.id}: ${s.levels} level(s), ${s.rooms} rooms (${s.floorArea} m²), ${s.walls} walls, ${s.doors} doors, ${s.windows} windows, ${s.stairs} stairs, ${s.furniture} pieces of furniture, ${s.lights} lights`);
    for (const n of c.notes.slice(0, 6)) lines.push(`note: ${n}`);
  }
  if (reports.length > 0) lines.push(summarizeBuildingReports(reports));
  return { patches, lines, errors, compiled, reports, target };
}

/** Short building summary for the agent's context (from the stored plan). */
export function describeBuilding(plan: BuildingPlan): string {
  const parts = plan.levels.map((l, i) => {
    const rooms = l.rooms.map((r) => `${r.id}:${r.type} ${area(roomPolygon(r)).toFixed(0)}m²`).join(', ');
    return `L${i} h=${l.height} [${rooms}] doors=${l.doors.length}${l.stairs.length ? ` stairs=${l.stairs.length}` : ''}`;
  });
  return `${plan.id} (${plan.style}, roof ${plan.roof.shape}): ${parts.join(' | ')}`;
}
