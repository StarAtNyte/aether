/**
 * Architecture operations for agents and tools: a batch of high-level edits
 * (create a building, add a level / room / door / window / stair, set the
 * roof, furnish or re-style rooms, place items, change materials) applied to
 * the buildings' plans, re-compiled, and turned into the minimal World IR
 * patch list (`patchesBetween`). Entities the user locked are preserved.
 * Failures are refusals with a code and a fix hint, per op; the other ops
 * still apply.
 */
import { deepEqual, Entity, isForbiddenKey, patchesBetween, PlayerSpec, WorldTest, type EntityId, type Json, type Patch, type WorldDoc } from '@aether/core';
import { z } from 'zod';
import { MaterialSpec } from '@aether/core';
import { compileBuilding, parsePlan, PlanError, type CompiledBuilding } from './compile';
import { checkBuilding, summarizeBuildingReports, type BuildingReport } from './nav';
import { area } from './math2';
import { WallDado } from './params';
import { ArchStyle, Compass, PlanDoor, PlanItem, PlanLevel, PlanRoof, PlanRoom, PlanStair, PlanWindow, type BuildingPlan } from './plan';
import { roomPolygon } from './rooms';
import { planWindowAddition } from './window-fit';

/** A window to add: the plan window with the side optional (the room's widest free exterior wall when omitted). */
const WindowRequest = PlanWindow.extend({ side: Compass.optional() });

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
  // One wall of a room ("the bedroom's back wall") or all of them: a finish (wallpaper, panelling, brick...) and / or a dado; `clear` resets.
  z.object({ op: z.literal('set_wall'), building: Id, room: Id, wall: z.union([Compass, z.literal('all')]).default('all'), material: MaterialSpec.optional(), dado: z.union([WallDado, z.null()]).optional(), clear: z.boolean().default(false) }),
  // People in the building ("two guests in the living room"): 0 to 8 idle-animated residents placed clear of doors and walkways.
  z.object({ op: z.literal('set_residents'), building: Id, count: z.number().int().min(0).max(8) }),
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

/** Remove a property (plans are stored as JSON: no undefined values). */
function dropKey(target: object, key: string): void {
  Reflect.deleteProperty(target, key);
}

function roomOf(plan: BuildingPlan, id: string): { level: PlanLevel; room: PlanRoom } {
  // Accept plan ids ("living") and room entity ids ("house-l0-living").
  const scoped = id.startsWith(`${plan.id}-`) ? id.slice(plan.id.length + 1) : id;
  const short = /^l\d+-/.test(scoped) && !plan.levels.some((l) => l.rooms.some((r) => r.id === scoped)) ? scoped.replace(/^l\d+-/, '') : scoped;
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

/** Re-apply recorded property edits to a freshly compiled piece (invalid results keep the compiled piece). */
function withOverrides(piece: Entity, overrides: Readonly<Record<string, Json>>): Entity {
  const draft = structuredClone(piece) as unknown as Record<string, unknown>;
  for (const [path, value] of Object.entries(overrides)) {
    const keys = path.split('.');
    if (keys.some((k) => isForbiddenKey(k)) || keys[0] === 'id' || keys[0] === 'parent' || keys[0] === 'arch') continue;
    let cur = draft;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i] as string;
      const next = cur[k];
      if (typeof next !== 'object' || next === null || Array.isArray(next)) cur[k] = {};
      cur = cur[k] as Record<string, unknown>;
    }
    cur[keys[keys.length - 1] as string] = value;
  }
  const arch = { ...(piece.arch as NonNullable<Entity['arch']>), overrides: { ...overrides } };
  const parsed = Entity.safeParse({ ...draft, arch });
  return parsed.success ? parsed.data : piece;
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
          const req = parseWith(WindowRequest, op.window, 'window', 'Windows: {room, side?: north|south|east|west (omit to use the room\'s widest free exterior wall), count?, width?, height?, sill?}.');
          // The level the room is on: the given one when it has the room, else wherever the room is.
          const found = roomOf(plan, req.room);
          const levelIndex = plan.levels[op.level]?.rooms.some((r) => r.id === found.room.id) ? op.level : plan.levels.indexOf(found.level);
          const lvl = levelOf(plan, levelIndex);
          const roomId = found.room.id;
          if (req.side !== undefined && req.centres) {
            lvl.windows.push({ ...req, room: roomId, side: req.side });
            lines.push(`add_window on level ${levelIndex}: ${req.centres.length} window(s) on the ${req.side} wall of ${roomId}`);
            break;
          }
          // Another window on a wall that already has evenly spread ones joins them (a second spec would land on top of the first).
          const same = req.side === undefined ? undefined : lvl.windows.find((w) => w.room === roomId && w.side === req.side && !w.centres);
          if (same) {
            same.count = Math.min(8, same.count + req.count);
            lines.push(`add_window on level ${levelIndex}: the ${same.side} wall of ${roomId} now has ${same.count} windows, spread evenly`);
            break;
          }
          // Measure the walls as they are now (exterior stretches with their doors and windows) and fit the new ones.
          const added = planWindowAddition(compileBuilding(plan).exterior, lvl.windows, levelIndex, roomId, req);
          if (!added.ok) throw new PlanError('no_wall_space', added.message, added.hint);
          lvl.windows = added.windows;
          lines.push(`add_window on level ${levelIndex}: ${added.line}`);
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
        case 'set_residents': {
          const plan = load(op.building);
          if (op.count === 0) delete plan.residents;
          else plan.residents = op.count;
          lines.push(`set_residents ${op.count}`);
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
        case 'set_wall': {
          const plan = load(op.building);
          const { room } = roomOf(plan, op.room);
          if (!op.clear && !op.material && op.dado === undefined) throw new PlanError('empty_wall_op', 'set_wall needs a material, a dado or clear', 'Send { op: "set_wall", building, room, wall: "north"|"south"|"east"|"west"|"all", material: { finish: "wallpaper-floral", color: "#d8e0cf" } }.');
          if (op.clear) {
            if (op.wall === 'all') {
              dropKey(room, 'walls');
              dropKey(room, 'finish');
              dropKey(room, 'dado');
            } else if (room.walls) {
              const rest = { ...room.walls };
              dropKey(rest, op.wall);
              if (Object.keys(rest).length > 0) room.walls = rest;
              else dropKey(room, 'walls');
            }
          }
          if (op.material) {
            if (op.wall === 'all') {
              room.finish = op.material;
              dropKey(room, 'walls');
            } else room.walls = { ...(room.walls ?? {}), [op.wall]: op.material };
          }
          if (op.dado === null) dropKey(room, 'dado');
          else if (op.dado) room.dado = op.dado;
          lines.push(`set_wall ${room.id} ${op.wall}`);
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
              else {
                if (op.material.finish && op.material.finish !== 'paint') r.finish = op.material;
                else {
                  if (op.material.color) r.wallColor = op.material.color;
                  if (op.material.finish === 'paint') dropKey(r, 'finish');
                }
                if (op.material.color && r.finish && !r.finish.color && op.material.finish === undefined) r.wallColor = op.material.color;
              }
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
    // Residents stand in the world frame (they walk), so they are not in the building's subtree: they go with it.
    for (const e of Object.values(world.entities)) if (e.arch?.role === 'resident' && e.arch.room?.startsWith(`${id}-`) && !e.locked) delete entities[e.id];
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
    // Pieces placed through the design tools belong to the document, not to the plan: they survive a
    // re-compile while the room they stand in still exists.
    const kept: Entity[] = [];
    const removedPieces = new Set<string>(Object.hasOwn(world.entities, id) ? (world.entities[id]?.arch?.removed ?? []) : []);
    if (Object.hasOwn(world.entities, id)) {
      for (const x of subtree(world, id)) {
        const e = world.entities[x];
        if (e && e.tags.includes('placed') && !e.locked) kept.push(e);
      }
      dropSubtree(id);
    }
    for (const raw of result.entities) {
      let parsed = Entity.parse(raw);
      if (removedPieces.has(parsed.id)) continue;
      const old = Object.hasOwn(world.entities, parsed.id) ? world.entities[parsed.id] : undefined;
      if (old?.locked) continue;
      // Edits made to a piece (by hand or by prompt) and pieces the user removed survive a re-compile.
      if (parsed.arch?.role === 'building' && removedPieces.size > 0 && parsed.arch) parsed = { ...parsed, arch: { ...parsed.arch, removed: [...removedPieces].slice(-400) } };
      if (old?.arch?.overrides && parsed.arch) parsed = withOverrides(parsed, old.arch.overrides);
      entities[parsed.id] = old && deepEqual(old, parsed) ? old : parsed;
    }
    for (const e of kept) {
      const room = e.arch?.room;
      if (room !== undefined && Object.hasOwn(entities, room) && e.parent !== null && Object.hasOwn(entities, e.parent) && !Object.hasOwn(entities, e.id)) entities[e.id] = e;
    }
    if (!tests.some((t) => t.kind === 'navigable' && t.target === id)) tests = [...tests, WorldTest.parse({ id: `${id}-usable`.slice(0, 64), kind: 'navigable', target: id })];
    if (walkthrough.has(id) && result.spawn) player = PlayerSpec.parse({ ...player, mode: 'firstPerson', spawn: result.spawn, yaw: result.spawnYaw, moveSpeed: 3.2, jumpSpeed: 4 });
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
