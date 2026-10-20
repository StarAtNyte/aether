/**
 * The design tools as the AI calls them: four batch tools over the scene
 * functions of this folder.
 *
 *   design_plan  write the plan (rooms, exact openings, every piece with its relations); builds the shell
 *   place_items  place pieces from the parts library, each against a wall, an opening or a surface
 *   edit_items   move / rotate / resize / remove / snap / anchor / centre pieces
 *   query_scene  measuring facts: a wall, a distance, a listing, the parts, the review, the plan check
 *
 * Every input is untrusted model output: it is validated with zod, size
 * capped, and applied to a working copy of the document. A batch keeps going
 * after a refusal (each refusal says why and what would work); the patches of
 * the accepted steps come back together so the host can commit one undo step.
 */
import { z } from 'zod';
import { applyPatches, hasOwn, type EntityId, type Json, type Patch, type WorldDoc } from '@aether/core';
import { applyArchOps, planOf } from '../ops';
import { fitStair, stairSizes } from '../stair-fit';
import { RELATION_TYPES } from '../design-record';
import { reviewScene, scoreFindings, findingsText, type Finding } from './checks';
import { checkConformance, describeShell, DesignPlan, designToBuildingPlan, resolveDesignStairs, validateDesign } from './design';
import { anchorToOpening, centerOver, moveItem, placeItem, removeItem, resizeItem, resolveBuilding, rotateItem, snapToWall, type EditResult } from './edit';
import { findRoom, findWall, isLookupError, listEntities, measure, queryWall, wallQueryText } from './facts';
import { describeParts } from './parts';
import { readScene } from './read';
import type { Scene } from './types';

/** Names of the design tools. */
export const DESIGN_TOOL_NAMES = ['design_plan', 'place_items', 'edit_items', 'query_scene'] as const;
/** A design tool name. */
export type DesignToolName = (typeof DESIGN_TOOL_NAMES)[number];

/** Bounds of a design tool call. */
export const DESIGN_LIMITS = Object.freeze({ MAX_ITEMS: 40, MAX_EDITS: 40, MAX_QUERIES: 12, MAX_TEXT: 14_000, MAX_REF: 100 });

/** True when `name` is a design tool. */
export function isDesignTool(name: string): name is DesignToolName {
  return (DESIGN_TOOL_NAMES as readonly string[]).includes(name);
}

const Ref = z.string().min(1).max(DESIGN_LIMITS.MAX_REF);
const Num = z.number().finite().min(-2000).max(2000);
const Pair = z.tuple([Num, Num]);
const WallName = z.union([z.enum(['north', 'south', 'east', 'west']), z.string().min(1).max(40)]);
const JsonValue: z.ZodType<Json> = z.lazy(() => z.union([z.string().max(400), z.number().finite(), z.boolean(), z.null(), z.array(JsonValue).max(40), z.record(z.string().max(40), JsonValue)])) as z.ZodType<Json>;

const TargetFields = {
  at: Pair.optional(),
  wall: WallName.optional(),
  edge: z.number().int().min(0).max(200).optional(),
  t: Num.optional(),
  align: z.enum(['centre', 'start', 'end']).optional(),
  gap: z.number().finite().min(-5).max(5).optional(),
  on: Ref.optional(),
  offset: Pair.optional(),
  y: Num.optional(),
  yaw: Num.optional(),
  faces: z.union([Ref, z.object({ point: Pair })]).optional(),
};

/** One piece to place. */
export const PlaceItemInput = z
  .object({
    kind: z.string().min(1).max(40).optional(),
    asset: z.string().max(90).optional(),
    room: Ref,
    level: z.number().int().min(0).max(20).optional(),
    id: z.string().max(40).optional(),
    name: z.string().max(60).optional(),
    params: z.record(z.string().max(40), JsonValue).optional(),
    opening: Ref.optional(),
    ...TargetFields,
  })
  .strict();

/** One edit of an existing piece. */
export const EditItemInput = z.discriminatedUnion('op', [
  z.object({ op: z.literal('move'), ref: Ref, ...TargetFields }).strict(),
  z.object({ op: z.literal('rotate'), ref: Ref, yaw: Num.optional(), delta: Num.optional(), faces: z.union([Ref, z.object({ point: Pair })]).optional() }).strict(),
  z.object({ op: z.literal('resize'), ref: Ref, params: z.record(z.string().max(40), JsonValue) }).strict(),
  z.object({ op: z.literal('remove'), ref: Ref }).strict(),
  z.object({ op: z.literal('snap_to_wall'), ref: Ref, wall: WallName.optional(), edge: z.number().int().min(0).max(200).optional(), t: Num.optional(), align: z.enum(['centre', 'start', 'end']).optional(), gap: z.number().finite().min(-5).max(5).optional() }).strict(),
  z.object({ op: z.literal('anchor_to_opening'), ref: Ref, opening: Ref, mode: z.enum(['centre', 'left', 'right']).optional(), gap: z.number().finite().min(-5).max(5).optional(), y: Num.optional() }).strict(),
  z.object({ op: z.literal('center_over'), ref: Ref, target: Ref, gap: z.number().finite().min(-5).max(5).optional() }).strict(),
]);

/** One question about the scene. */
export const QueryInput = z.discriminatedUnion('q', [
  z.object({ q: z.literal('wall'), room: Ref, wall: WallName, kind: z.string().max(40).optional(), y0: Num.optional(), y1: Num.optional() }).strict(),
  z.object({ q: z.literal('measure'), a: z.union([Ref, z.object({ point: z.array(Num).min(2).max(3) })]), b: z.union([Ref, z.object({ point: z.array(Num).min(2).max(3) })]) }).strict(),
  z.object({ q: z.literal('list'), room: Ref.optional(), wall: WallName.optional(), kind: z.string().max(40).optional(), level: z.number().int().min(0).max(20).optional() }).strict(),
  z.object({ q: z.literal('parts') }).strict(),
  z.object({ q: z.literal('shell') }).strict(),
  z.object({ q: z.literal('review'), fast: z.boolean().optional() }).strict(),
  // Where a stair from `level` to the next fits (optionally in a room / of a shape / heading / width), with the riser maths.
  z.object({ q: z.literal('stairs'), level: z.number().int().min(0).max(5).optional(), room: Ref.optional(), shape: z.enum(['straight', 'l', 'u']).optional(), heading: z.enum(['north', 'south', 'east', 'west']).optional(), width: z.number().min(0.7).max(2.5).optional() }).strict(),
]);

/** Inputs of the four tools. */
export const DesignToolInputs = {
  design_plan: z.object({ plan: z.unknown() }),
  place_items: z.object({ building: Ref.optional(), items: z.array(z.unknown()).min(1).max(DESIGN_LIMITS.MAX_ITEMS), message: z.string().max(200).optional() }),
  edit_items: z.object({ building: Ref.optional(), edits: z.array(z.unknown()).min(1).max(DESIGN_LIMITS.MAX_EDITS), message: z.string().max(200).optional() }),
  query_scene: z.object({ building: Ref.optional(), queries: z.array(z.unknown()).min(1).max(DESIGN_LIMITS.MAX_QUERIES) }),
} as const;

/** Outcome of a design tool call. */
export interface DesignToolResult {
  /** At least one step was accepted (or, for queries, the call was understood). */
  ok: boolean;
  /** Facts and refusals for the model. */
  text: string;
  /** Patches to commit as one undo step (empty for queries). */
  patches: Patch[];
  /** Commit message. */
  message: string;
  /** Entities created or changed. */
  ids: EntityId[];
  /** Number of accepted / refused steps. */
  accepted: number;
  refused: number;
  /** The world after the patches (the input world for queries). */
  world: WorldDoc;
}

function issues(e: z.ZodError): string {
  return e.issues
    .slice(0, 4)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}

function clipText(s: string): string {
  return s.length <= DESIGN_LIMITS.MAX_TEXT ? s : `${s.slice(0, DESIGN_LIMITS.MAX_TEXT)}\n… (truncated)`;
}

function refuse(world: WorldDoc, text: string, message = 'Design'): DesignToolResult {
  return { ok: false, text: clipText(text), patches: [], message, ids: [], accepted: 0, refused: 1, world };
}

/** Run one design tool against `world`. Never throws. */
export function runDesignTool(world: WorldDoc, name: DesignToolName, rawInput: unknown): DesignToolResult {
  try {
    switch (name) {
      case 'design_plan':
        return runDesignPlan(world, rawInput);
      case 'place_items':
        return runBatch(world, rawInput, 'place_items');
      case 'edit_items':
        return runBatch(world, rawInput, 'edit_items');
      case 'query_scene':
        return runQueries(world, rawInput);
    }
  } catch (e) {
    return refuse(world, `${name} failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`);
  }
}

// ---------------------------------------------------------------------------
// design_plan
// ---------------------------------------------------------------------------

function runDesignPlan(world: WorldDoc, rawInput: unknown): DesignToolResult {
  const input = DesignToolInputs.design_plan.safeParse(rawInput);
  if (!input.success) return refuse(world, `Invalid design_plan input: ${issues(input.error)}. Send {"plan": {...}}.`);
  const cleaned = dropUnknownRelations(input.data.plan);
  const parsed = DesignPlan.safeParse(cleaned.plan);
  if (!parsed.success) return refuse(world, `The design plan does not match the schema: ${issues(parsed.error)}. Fix these fields and resend design_plan.`);
  const check = validateDesign(parsed.data);
  // Stairs given by room are fitted; exact ones are measured (refused with numbers and a stair that fits).
  const stairs = check.errors.length > 0 ? { plan: parsed.data, errors: [], lines: [] } : resolveDesignStairs(parsed.data);
  const plan = stairs.plan;
  check.errors.push(...stairs.errors);
  if (check.errors.length > 0) {
    return refuse(world, `The design plan was refused, nothing was built:\n${check.errors.slice(0, 20).map((e) => `- ${e}`).join('\n')}${check.warnings.length > 0 ? `\nAdvice:\n${check.warnings.slice(0, 8).map((e) => `- ${e}`).join('\n')}` : ''}\nFix these and resend design_plan.`, `Design ${plan.name}`);
  }
  let ops = applyArchOps(world, [{ op: 'create_building', plan: designToBuildingPlan(plan), walkthrough: true }]);
  if (ops.errors.length > 0 && ops.patches.length === 0) {
    return refuse(world, `The shell could not be built: ${ops.errors.map((e) => `${e.code}: ${e.message} Fix: ${e.hint}`).join('; ').slice(0, 1500)}`, `Design ${plan.name}`);
  }
  let res = applyPatches(world, ops.patches);
  if (res.errors.length > 0 && res.applied.length === 0) return refuse(world, `The shell was rejected: ${res.errors[0]?.message ?? 'invalid'}`, `Design ${plan.name}`);
  let scene = readScene(res.world, plan.id);
  // The builder numbers the openings; the plan's own opening ids are aliases. Rewrite relation targets that name
  // a plan id to the real entity id so the conformance check can find them.
  const alias = scene ? openingAliases(plan, scene) : new Map<string, string>();
  if (alias.size > 0) {
    ops = applyArchOps(world, [{ op: 'create_building', plan: designToBuildingPlan(rewriteTargets(plan, alias) ?? plan, Object.fromEntries(alias)), walkthrough: true }]);
    res = applyPatches(world, ops.patches);
    scene = readScene(res.world, plan.id);
  }
  // Pieces kept from an earlier plan follow a changed ceiling: lights hang from the new one.
  let patches: Patch[] = ops.patches;
  if (scene) {
    const reseat: Patch[] = [];
    for (const it of scene.items) {
      const room = scene.rooms.find((r) => r.id === it.room);
      const e = res.world.entities[it.id];
      if (it.mount === 'ceiling' && room && e && Math.abs(it.pos[1] - room.ceiling) > 0.005) reseat.push({ op: 'update', id: it.id, set: { transform: { ...e.transform, position: [e.transform.position[0], room.ceiling, e.transform.position[2]] } } } as Patch);
    }
    if (reseat.length > 0) {
      const again = applyPatches(res.world, reseat);
      res = { ...res, world: again.world };
      patches = [...patches, ...reseat];
      scene = readScene(res.world, plan.id);
    }
  }
  const lines = [`Built the shell of "${plan.name}" (${plan.levels.length} level(s)). Nothing is furnished yet: place every piece of the plan with place_items.`];
  if (cleaned.dropped.length > 0) lines.push(`Ignored relations the checker cannot measure (use ${RELATION_TYPES.join(', ')}): ${cleaned.dropped.slice(0, 8).join('; ')}. The intent text still guides you; place those pieces where the intent says.`);
  if (scene) lines.push(describeShell(scene));
  if (alias.size > 0) lines.push(`Opening ids as built: ${[...alias].map(([k, v]) => `${k} = ${v}`).join(', ')}. Use the built ids in place_items / edit_items.`);
  for (const l of stairs.lines) lines.push(`Stairs: ${l}.`);
  if (check.warnings.length > 0) lines.push(`Advice:\n${check.warnings.slice(0, 8).map((w) => `- ${w}`).join('\n')}`);
  for (const n of ops.compiled.flatMap((c) => c.notes).slice(0, 8)) lines.push(`Note: ${n}`);
  if (plan.furniture.length > 0) lines.push(`Planned pieces to place (${plan.furniture.length}): ${plan.furniture.map((f) => `${f.id} (${f.kind}, ${f.room})`).join(', ')}.`);
  return { ok: true, text: clipText(lines.join('\n')), patches, message: `Design ${plan.name}`.slice(0, 120), ids: [plan.id], accepted: 1, refused: 0, world: res.world };
}

/**
 * Relations of a type the checker cannot measure are dropped (and reported) instead of refusing the whole plan:
 * models invent "centred", "at" and the like, and the plan is still sound without them.
 */
function dropUnknownRelations(plan: unknown): { plan: unknown; dropped: string[] } {
  const dropped: string[] = [];
  if (typeof plan !== 'object' || plan === null || Array.isArray(plan)) return { plan, dropped };
  const p = plan as Record<string, unknown>;
  if (!Array.isArray(p['furniture'])) return { plan, dropped };
  const furniture = p['furniture'].map((f: unknown) => {
    if (typeof f !== 'object' || f === null || Array.isArray(f)) return f;
    const item = f as Record<string, unknown>;
    if (!Array.isArray(item['relations'])) return f;
    const relations = item['relations'].filter((r: unknown) => {
      const type = typeof r === 'object' && r !== null ? (r as Record<string, unknown>)['type'] : undefined;
      const ok = typeof type === 'string' && (RELATION_TYPES as readonly string[]).includes(type);
      if (!ok) dropped.push(`${typeof item['id'] === 'string' ? item['id'].slice(0, 36) : 'piece'}: "${typeof type === 'string' ? type.slice(0, 30) : 'no type'}"`);
      return ok;
    });
    return { ...item, relations };
  });
  return { plan: { ...p, furniture }, dropped };
}

function openingAliases(plan: DesignPlan, scene: Scene): Map<string, string> {
  const out = new Map<string, string>();
  for (const lvl of plan.levels) {
    for (const o of lvl.openings) {
      if (!o.id) continue;
      const room = scene.rooms.find((r) => r.key === o.room);
      const found = room?.walls.filter((w) => w.compass === o.wall).flatMap((w) => w.openings).find((x) => Math.abs(x.centre - o.along) < 0.35 && (o.kind === 'window') === (x.kind === 'window'));
      if (found && found.id !== o.id) out.set(o.id, found.id);
    }
  }
  return out;
}

/** The plan with relation targets that name a plan opening id changed to the built entity id (null when none did). */
function rewriteTargets(plan: DesignPlan, alias: ReadonlyMap<string, string>): DesignPlan | null {
  let changed = false;
  const furniture = plan.furniture.map((f) => ({
    ...f,
    relations: f.relations.map((r) => {
      const to = r.target !== undefined ? alias.get(r.target) : undefined;
      if (to === undefined) return r;
      changed = true;
      return { ...r, target: to };
    }),
  }));
  return changed ? { ...plan, furniture } : null;
}

// ---------------------------------------------------------------------------
// place_items / edit_items
// ---------------------------------------------------------------------------

/** The plan's opening ids of a building, as the model chose them in design_plan. */
function aliasesOf(world: WorldDoc, building: string | undefined): Readonly<Record<string, string>> {
  const b = resolveBuilding(world, building);
  if ('error' in b) return {};
  try {
    return planOf(world, b.id).design?.openingAliases ?? {};
  } catch {
    return {};
  }
}

/** Swap an opening id the model took from its own plan for the built one. */
function unalias(a: Readonly<Record<string, string>>, ref: unknown): unknown {
  return typeof ref === 'string' && hasOwn(a, ref) ? a[ref] : ref;
}

function runBatch(world: WorldDoc, rawInput: unknown, tool: 'place_items' | 'edit_items'): DesignToolResult {
  const isPlace = tool === 'place_items';
  const input = (isPlace ? DesignToolInputs.place_items : DesignToolInputs.edit_items).safeParse(rawInput);
  if (!input.success) return refuse(world, `Invalid ${tool} input: ${issues(input.error)}.`);
  const data = input.data as { building?: string; message?: string; items?: unknown[]; edits?: unknown[] };
  const aliases = aliasesOf(world, data.building);
  const steps = ((isPlace ? data.items : data.edits) ?? []).map((raw) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
    const r = raw as Record<string, unknown>;
    return { ...r, ...(r['opening'] !== undefined ? { opening: unalias(aliases, r['opening']) } : {}) };
  });
  let working = world;
  const patches: Patch[] = [];
  const lines: string[] = [];
  const ids = new Set<EntityId>();
  let accepted = 0;
  let refused = 0;
  steps.forEach((raw, index) => {
    let r: EditResult;
    let label = `${index + 1}`;
    if (isPlace) {
      const p = PlaceItemInput.safeParse(raw);
      if (!p.success) {
        refused++;
        lines.push(`[${label}] refused: ${issues(p.error)}`);
        return;
      }
      label = `${index + 1} ${p.data.kind ?? p.data.asset ?? 'item'}`;
      r = placeItem(working, data.building, stripUndefined(p.data));
    } else {
      const p = EditItemInput.safeParse(raw);
      if (!p.success) {
        refused++;
        lines.push(`[${label}] refused: ${issues(p.error)}`);
        return;
      }
      label = `${index + 1} ${p.data.op} ${p.data.ref}`;
      r = applyEdit(working, data.building, p.data);
    }
    if (!r.ok) {
      refused++;
      lines.push(`[${label}] refused: ${r.error}`);
      return;
    }
    const next = applyPatches(working, r.patches);
    if (next.errors.length > 0 && next.applied.length === 0) {
      refused++;
      lines.push(`[${label}] refused: the document rejected it (${next.errors[0]?.message.slice(0, 200) ?? 'invalid'})`);
      return;
    }
    working = next.world;
    patches.push(...r.patches);
    for (const id of r.ids) ids.add(id);
    accepted++;
    lines.push(`[${label}] ${r.text}${r.warnings.length > 0 ? ` (note: ${r.warnings.join('; ')})` : ''}`);
  });
  const head = `${accepted} of ${steps.length} ${isPlace ? 'placement' : 'edit'}${steps.length === 1 ? '' : 's'} applied${refused > 0 ? `, ${refused} refused (fix and resend only those)` : ''}.`;
  const message = (data.message ?? (isPlace ? 'Place pieces' : 'Edit pieces')).slice(0, 120);
  return { ok: accepted > 0, text: clipText([head, ...lines].join('\n')), patches, message, ids: [...ids], accepted, refused, world: working };
}

function stripUndefined<T extends object>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as T;
}

function applyEdit(world: WorldDoc, building: string | undefined, e: z.infer<typeof EditItemInput>): EditResult {
  switch (e.op) {
    case 'move': {
      const { op: _op, ref, ...target } = e;
      return moveItem(world, building, ref, stripUndefined(target));
    }
    case 'rotate':
      return rotateItem(world, building, e.ref, stripUndefined({ yaw: e.yaw, delta: e.delta, faces: e.faces }));
    case 'resize':
      return resizeItem(world, building, e.ref, e.params);
    case 'remove':
      return removeItem(world, building, e.ref);
    case 'snap_to_wall':
      return snapToWall(world, building, e.ref, stripUndefined({ wall: e.wall, edge: e.edge, t: e.t, align: e.align, gap: e.gap }));
    case 'anchor_to_opening':
      return anchorToOpening(world, building, e.ref, stripUndefined({ opening: e.opening, mode: e.mode, gap: e.gap, y: e.y }));
    case 'center_over':
      return centerOver(world, building, e.ref, e.target, e.gap !== undefined ? { gap: e.gap } : {});
  }
}

// ---------------------------------------------------------------------------
// query_scene
// ---------------------------------------------------------------------------

/** The full review of one building: checker findings plus the conformance with the design record. */
export function reviewFindings(world: WorldDoc, building: EntityId, opts: { fast?: boolean } = {}): Finding[] {
  const scene = readScene(world, building);
  if (!scene) return [];
  const out = reviewScene(world, building, opts);
  let design;
  try {
    design = planOf(world, building).design;
  } catch {
    design = undefined;
  }
  out.push(...checkConformance(scene, design));
  const rank = { error: 0, warning: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || a.code.localeCompare(b.code));
}

function runQueries(world: WorldDoc, rawInput: unknown): DesignToolResult {
  const input = DesignToolInputs.query_scene.safeParse(rawInput);
  if (!input.success) return refuse(world, `Invalid query_scene input: ${issues(input.error)}.`);
  const b = resolveBuilding(world, input.data.building);
  const aliases = aliasesOf(world, input.data.building);
  const lines: string[] = [];
  let answered = 0;
  input.data.queries.forEach((raw, index) => {
    const q = QueryInput.safeParse(raw);
    if (!q.success) {
      lines.push(`[${index + 1}] refused: ${issues(q.error)}`);
      return;
    }
    const query = q.data.q === 'measure' ? { ...q.data, a: unalias(aliases, q.data.a) as typeof q.data.a, b: unalias(aliases, q.data.b) as typeof q.data.b } : q.data;
    if (query.q === 'parts') {
      lines.push(`[${index + 1}] parts library:\n${describeParts()}`);
      answered++;
      return;
    }
    if ('error' in b) {
      lines.push(`[${index + 1}] ${b.error}`);
      return;
    }
    const scene = b.scene;
    answered++;
    switch (query.q) {
      case 'wall': {
        const room = findRoom(scene, query.room);
        if (isLookupError(room)) {
          lines.push(`[${index + 1}] ${room.error}`);
          return;
        }
        const wall = findWall(room, query.wall);
        if (isLookupError(wall)) {
          lines.push(`[${index + 1}] ${wall.error}`);
          return;
        }
        lines.push(`[${index + 1}] ${wallQueryText(queryWall(scene, room, wall, stripUndefined({ kind: query.kind, y0: query.y0, y1: query.y1 })))}`);
        return;
      }
      case 'measure': {
        const m = measure(scene, query.a, query.b);
        lines.push(`[${index + 1}] ${isLookupError(m) ? m.error : m.text}`);
        return;
      }
      case 'list': {
        const l = listEntities(scene, stripUndefined({ room: query.room, wall: query.wall, kind: query.kind, level: query.level }));
        lines.push(`[${index + 1}] ${l.lines.length > 0 ? l.lines.join('\n') : 'nothing matches'}`);
        return;
      }
      case 'shell':
        lines.push(`[${index + 1}] ${describeShell(scene)}`);
        return;
      case 'review': {
        const f = reviewFindings(world, b.id, query.fast ? { fast: true } : {});
        lines.push(`[${index + 1}] review of ${b.id}: score ${scoreFindings(f)}/100\n${findingsText(f)}`);
        return;
      }
      case 'stairs': {
        lines.push(`[${index + 1}] ${stairsAnswer(world, b.id, query)}`);
        return;
      }
    }
  });
  return { ok: answered > 0, text: clipText(lines.join('\n')), patches: [], message: 'Query', ids: [], accepted: answered, refused: input.data.queries.length - answered, world };
}

/** Answer of a `stairs` query: a fitted stair per storey (or the one asked about), with the riser maths. */
function stairsAnswer(world: WorldDoc, building: EntityId, q: { level?: number | undefined; room?: string | undefined; shape?: 'straight' | 'l' | 'u' | undefined; heading?: 'north' | 'south' | 'east' | 'west' | undefined; width?: number | undefined }): string {
  const plan = planOf(world, building);
  const levels = q.level !== undefined ? [q.level] : plan.levels.map((_, i) => i).slice(0, -1);
  if (levels.length === 0) return `${building} has one level: add a level above (build_architecture add_level) before a stair.`;
  const out: string[] = [];
  for (const li of levels) {
    const lvl = plan.levels[li];
    if (!lvl) {
      out.push(`level ${li}: no such level (0..${plan.levels.length - 1})`);
      continue;
    }
    const room = q.room !== undefined ? q.room.replace(new RegExp(`^${building}-l\\d+-`), '') : undefined;
    const fit = fitStair(plan, li, { room, shape: q.shape, heading: q.heading, width: q.width, others: lvl.stairs });
    const have = lvl.stairs.length > 0 ? ` (level ${li} already has ${lvl.stairs.length} stair(s))` : '';
    out.push(
      fit.ok
        ? `level ${li} → ${li + 1}${have}: ${fit.line}. ${stairSizes(lvl.height, fit.stair.width)}. Use it as build_architecture {"op":"add_stairs","building":"${building}","level":${li},"stair":{"at":[${fit.stair.at.join(',')}],"heading":"${fit.stair.heading}","shape":"${fit.stair.shape}","width":${fit.stair.width}${fit.stair.shape === 'straight' ? '' : `,"turn":"${fit.stair.turn}"`}}} or in design_plan levels[${li}].stairs.`
        : `level ${li} → ${li + 1}${have}: no stair fits: ${fit.reasons.join('; ')}.`,
    );
  }
  return out.join('\n');
}

/** True when the document has a building (the design tools apply). */
export function hasBuilding(world: WorldDoc): boolean {
  return Object.values(world.entities).some((e) => e.arch?.role === 'building');
}

/** Ids of the buildings of a document. */
export function buildingIdsOf(world: WorldDoc): EntityId[] {
  return Object.values(world.entities)
    .filter((e) => e.arch?.role === 'building' && hasOwn(world.entities, e.id))
    .map((e) => e.id);
}
