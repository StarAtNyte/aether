/**
 * `applyPatches` — the only mutation path for worlds.
 *
 * Pipeline per patch: safety screen (prototype keys / size) → unknown-field
 * detection → zod parse (defaults) → operation with referential checks and
 * limits → copy-on-write commit. Patches are independent: a failing patch is
 * reported and skipped (or, with `atomic`, the whole batch is rejected).
 *
 * Forward references inside one batch are supported: an operation that fails
 * only because it references an entity added LATER in the same batch is
 * deferred and retried after each successful patch.
 *
 * Operation semantics worth knowing (they are also what the LLM is told):
 * - `update` / `updateRule` / `setEnvironment` / `setPlayer`: deep merge, arrays
 *   replace, `null` deletes a key (see merge.ts); the result is re-validated.
 * - `remove` (recursive by default) deletes descendants; with `recursive:false`
 *   children move to the removed entity's parent. Joints targeting removed
 *   entities, scatter `onSurface` links and `player.controls` are cleared.
 *   Rules/tests are left untouched (selectors that match nothing are inert).
 * - `rename` rewrites parent, joint targets, scatter surfaces, behavior params
 *   equal to the old id, player.controls, exact-id selectors / spawn templates /
 *   "id.key" state keys in rules, tests and the HUD.
 * - `setState` with `value: null` deletes the variable.
 * - `setMesh` adds or replaces an editable mesh asset (sizes, index ranges and
 *   finite coordinates are checked by decoding it); `removeMesh` is refused
 *   while an entity still uses the mesh; `remove` drops mesh assets that no
 *   entity uses any more.
 * - `clear` empties entities, rules, tests, state, HUD and meshes; custom generators and
 *   scripts are kept (they are reusable code); environment/player (and voxel
 *   terrain) are reset only with `keepEnvironment: false` (player.controls is
 *   always cleared). The title card (`intro`) is removed too.
 * - `setMeta` sets name / description / seed and, additively, the title card
 *   (`intro: null` removes it), the opening view (`opening: null` removes it) and the game feel (`feel`, replaced whole;
 *   `feel: null` removes it). `clear` keeps the feel (a setting of the game,
 *   not content).
 * - `setVoxel` deep-merges voxel terrain settings (`set: null` removes the
 *   terrain); `voxelEdit` appends block edits. Block ids are checked against
 *   the registry and edit volumes against the voxel block limits.
 */
import type { z } from 'zod';
import {
  Entity as EntitySchema,
  Environment as EnvironmentSchema,
  Patch as PatchSchema,
  PlayerSpec as PlayerSchema,
  Rule as RuleSchema,
} from '../schema';
import type { Entity, Json, Patch, Rule, WorldDoc, WorldTest } from '../schema';
import { LIMITS } from '../limits';
import { inspectUntrusted, isForbiddenKey } from '../guard';
import { closestMatch, deepEqual, hasOwn, isPlainObject, truncate } from '../json';
import { findUnknownKeys, issuesText, zodIssues, type Issue } from '../issues';
import { deepMerge, ENTITY_MERGE, ENVIRONMENT_MERGE, PLAYER_MERGE, RULE_MERGE, type MergeConfig } from '../merge';
import { isValidSelector } from '../query';
import { isEntityId, uniqueId } from '../ids';
import { forEachRuleSelector, forEachTestSelector, mapRuleRefs, mapTestRefs, renameEntityRefs, renameMapper } from '../refs';
import { generatorUsers, meshTotalBytes, meshUsers, scatterCount } from '../validate';
import { checkMeshAssetSizes, decodeMesh, meshAssetBytes } from '../mesh/codec';
import { Draft } from './draft';
import { applySetVoxel, applyVoxelEdit } from './voxel-ops';

/** A rejected patch. `index` is the position in the input array (-1 for batch-level errors). */
export interface PatchError {
  index: number;
  op: string;
  message: string;
}

/** Outcome of {@link applyPatches}. */
export interface PatchResult {
  /** The new world (the input object itself when nothing changed). */
  world: WorldDoc;
  /** Successfully applied patches, normalized by zod, in application order. */
  applied: Patch[];
  /** Rejected patches with actionable messages (sorted by index). */
  errors: PatchError[];
  /**
   * Non-fatal notes for the caller (e.g. hosts that report overwritten
   * hand edits). `applyPatches` itself never sets it.
   */
  notes?: string[];
}

/** Options for {@link applyPatches}. */
export interface ApplyOptions {
  /** All-or-nothing: on any error return the original world and no applied patches. */
  atomic?: boolean;
}

type Outcome = { ok: true } | { ok: false; message: string; missingRef?: string };
type PatchOf<K extends Patch['op']> = Extract<Patch, { op: K }>;

const OK: Outcome = { ok: true };
const fail = (message: string, missingRef?: string): Outcome =>
  missingRef === undefined ? { ok: false, message } : { ok: false, message, missingRef };

const q = (s: string): string => `'${truncate(s, 64)}'`;

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? truncate(v, 64) : undefined;
}

/** Human label for messages, computed from the raw (untrusted) patch. */
function labelOf(raw: unknown): string {
  if (!isPlainObject(raw)) return 'patch';
  const op = str(raw['op']) ?? 'patch';
  const id = str(raw['id']);
  switch (op) {
    case 'add': {
      const e = raw['entity'];
      const eid = isPlainObject(e) ? str(e['id']) : undefined;
      return eid ? `add entity '${eid}'` : 'add entity';
    }
    case 'update':
      return id ? `entity '${id}' update` : 'update';
    case 'remove':
      return id ? `remove entity '${id}'` : 'remove';
    case 'rename':
      return id ? `rename entity '${id}'` : 'rename';
    case 'addRule': {
      const r = raw['rule'];
      const rid = isPlainObject(r) ? str(r['id']) : undefined;
      return rid ? `addRule '${rid}'` : 'addRule';
    }
    case 'addTest': {
      const t = raw['test'];
      const tid = isPlainObject(t) ? str(t['id']) : undefined;
      return tid ? `addTest '${tid}'` : 'addTest';
    }
    case 'defineGenerator':
    case 'defineScript': {
      const d = raw[op === 'defineGenerator' ? 'generator' : 'script'];
      const did = isPlainObject(d) ? str(d['id']) : undefined;
      return did ? `${op} '${did}'` : op;
    }
    case 'setState': {
      const key = str(raw['key']);
      return key !== undefined ? `setState '${key}'` : op;
    }
    case 'setMesh': {
      const m = raw['mesh'];
      const mid = isPlainObject(m) ? str(m['id']) : undefined;
      return mid ? `setMesh '${mid}'` : op;
    }
    default:
      return id ? `${op} '${id}'` : op;
  }
}

function opOf(raw: unknown): string {
  return isPlainObject(raw) && typeof raw['op'] === 'string' ? truncate(raw['op'], 32) : 'unknown';
}

/**
 * "entity 'cr' does not exist — did you mean 'car'?". Hints cost O(candidates),
 * so they are rationed per batch ({@link Draft.takeHint}) to keep hostile
 * batches of failing patches linear.
 */
function notFound(d: Draft, kind: string, id: string, candidates: () => Iterable<string>): string {
  const hint = d.takeHint() ? closestMatch(id, candidates()) : undefined;
  return `${kind} ${q(id)} does not exist${hint ? ` — did you mean ${q(hint)}?` : ''}`;
}

/** Suggest a free id for a colliding one (rationed like hints). */
function freeIdHint(d: Draft, id: string): string {
  return d.takeHint() ? `, such as ${q(uniqueId(d.world, id))}` : '';
}

const entityIds = (d: Draft) => (): Iterable<string> => Object.keys(d.world.entities);

// ---------------------------------------------------------------------------
// Shared checks
// ---------------------------------------------------------------------------

/** Merge `set` into `base`, then check unknown fields and re-validate with `schema`. */
function mergeAndValidate<T>(base: unknown, set: Record<string, Json>, cfg: MergeConfig, schema: z.ZodType<T>): { ok: true; value: T } | { ok: false; message: string } {
  const merged = deepMerge(base, set, cfg);
  const issues: Issue[] = findUnknownKeys(merged, schema);
  const parsed = schema.safeParse(merged);
  if (!parsed.success) issues.push(...zodIssues(parsed.error));
  if (issues.length > 0 || !parsed.success) return { ok: false, message: issuesText(issues) };
  return { ok: true, value: parsed.data };
}

function checkEntityRefs(d: Draft, e: Entity): Outcome {
  if (e.parent !== null) {
    if (e.parent === e.id) return fail('parent cannot be the entity itself');
    if (!d.has(e.parent)) return fail(`parent ${notFound(d, 'entity', e.parent, entityIds(d))}`, e.parent);
  }
  if (e.joint && e.joint.target !== 'world') {
    if (e.joint.target === e.id) return fail('joint.target cannot be the entity itself (use "world" to pin it)');
    if (!d.has(e.joint.target)) return fail(`joint.target ${notFound(d, 'entity', e.joint.target, entityIds(d))} (use "world" to pin to the static world)`, e.joint.target);
  }
  if (e.shape.kind === 'mesh' && !hasOwn(d.world.meshes, e.shape.mesh)) {
    return fail(`shape.mesh ${notFound(d, 'mesh', e.shape.mesh, () => Object.keys(d.world.meshes))} (add it with setMesh first)`);
  }
  if (e.shape.kind === 'scatter' && e.shape.onSurface !== undefined) {
    if (e.shape.onSurface === e.id) return fail('shape.onSurface cannot be the entity itself');
    if (!d.has(e.shape.onSurface)) return fail(`shape.onSurface ${notFound(d, 'entity', e.shape.onSurface, entityIds(d))}`, e.shape.onSurface);
  }
  return OK;
}

function checkScatter(d: Draft, next: Entity, prev: Entity | undefined): Outcome {
  const delta = scatterCount(next) - (prev ? scatterCount(prev) : 0);
  if (delta <= 0) return OK;
  const total = d.scatterTotal() + delta;
  if (total > LIMITS.MAX_SCATTER_TOTAL) {
    return fail(`scatter instances would total ${total} (max ${LIMITS.MAX_SCATTER_TOTAL}); lower shape.count or remove other scatters`);
  }
  return OK;
}

function checkRuleSelectors(rule: Rule): Outcome {
  const bad: string[] = [];
  forEachRuleSelector(rule, (s, where) => {
    const ok = where === 'template' ? isEntityId(s) : isValidSelector(s);
    if (!ok && bad.length < 4) bad.push(`invalid ${where} ${q(s)}`);
  });
  return bad.length > 0 ? fail(`${bad.join('; ')} (selectors are an entity id, "#tag", "player" or "*")`) : OK;
}

function checkTestSelectors(test: WorldTest): Outcome {
  const bad: string[] = [];
  forEachTestSelector(test, (s) => {
    if (!isValidSelector(s) && bad.length < 4) bad.push(q(s));
  });
  return bad.length > 0 ? fail(`invalid selector ${bad.join(', ')} (use an entity id, "#tag", "player" or "*")`) : OK;
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

function opAdd(d: Draft, p: PatchOf<'add'>): Outcome {
  const e = p.entity;
  if (isForbiddenKey(e.id)) return fail(`id ${q(e.id)} is reserved; choose another id`);
  if (d.has(e.id)) {
    return fail(`entity ${q(e.id)} already exists — use 'update' to modify it, or add it with a new id${freeIdHint(d, e.id)}`);
  }
  if (d.entityCount() >= LIMITS.MAX_ENTITIES) return fail(`entity limit reached (${LIMITS.MAX_ENTITIES}); use a scatter shape for many copies`);
  const refs = checkEntityRefs(d, e);
  if (!refs.ok) return refs;
  if (e.parent !== null && d.depthOf(e.parent, LIMITS.MAX_HIERARCHY_DEPTH) + 1 > LIMITS.MAX_HIERARCHY_DEPTH) {
    return fail(`hierarchy would exceed ${LIMITS.MAX_HIERARCHY_DEPTH} levels`);
  }
  const scatter = checkScatter(d, e, undefined);
  if (!scatter.ok) return scatter;
  d.setEntity(e);
  return OK;
}

function opUpdate(d: Draft, p: PatchOf<'update'>): Outcome {
  const prev = d.entity(p.id);
  if (!prev) return fail(notFound(d, 'entity', p.id, entityIds(d)));
  if (hasOwn(p.set, 'id') && p.set['id'] !== p.id) {
    return fail(`cannot change 'id' with update — use {"op":"rename","id":${JSON.stringify(p.id)},"newId":…}`);
  }
  const merged = mergeAndValidate(prev, p.set, ENTITY_MERGE, EntitySchema);
  if (!merged.ok) return fail(merged.message);
  const next = merged.value;
  if (deepEqual(next, prev)) return OK; // no-op keeps identity
  const refs = checkEntityRefs(d, next);
  if (!refs.ok) return refs;
  if (next.parent !== prev.parent && next.parent !== null) {
    if (d.isAncestorOrSelf(p.id, next.parent, LIMITS.MAX_HIERARCHY_DEPTH + 1)) {
      return fail(`parent ${q(next.parent)} would create a cycle (${q(next.parent)} is inside ${q(p.id)})`);
    }
    const depth = d.depthOf(next.parent, LIMITS.MAX_HIERARCHY_DEPTH) + 1 + d.subtreeHeight(p.id);
    if (depth > LIMITS.MAX_HIERARCHY_DEPTH) return fail(`hierarchy would exceed ${LIMITS.MAX_HIERARCHY_DEPTH} levels`);
  }
  const scatter = checkScatter(d, next, prev);
  if (!scatter.ok) return scatter;
  d.setEntity(next);
  return OK;
}

/** Remove references to deleted entities from survivors and the player. */
function clearDanglingRefs(d: Draft, removed: ReadonlySet<string>): void {
  for (const id of [...d.referenceHolders()]) {
    const e = d.entity(id);
    if (!e) continue;
    let next = e;
    if (e.joint && e.joint.target !== 'world' && removed.has(e.joint.target)) {
      const { joint: _dropped, ...rest } = next;
      next = rest;
    }
    if (e.shape.kind === 'scatter' && e.shape.onSurface !== undefined && removed.has(e.shape.onSurface)) {
      const { onSurface: _dropped, ...shape } = e.shape;
      next = { ...next, shape };
    }
    if (next !== e) d.setEntity(next);
  }
  if (d.world.player.controls !== undefined && removed.has(d.world.player.controls)) {
    const { controls: _dropped, ...player } = d.world.player;
    d.set('player', player);
  }
}

function opRemove(d: Draft, p: PatchOf<'remove'>): Outcome {
  const target = d.entity(p.id);
  if (!target) return fail(notFound(d, 'entity', p.id, entityIds(d)));
  let removed: string[];
  if (p.recursive) {
    removed = d.subtree(p.id);
  } else {
    removed = [p.id];
    for (const childId of [...d.childrenOf(p.id)]) {
      d.setEntity({ ...(d.entity(childId) as Entity), parent: target.parent });
    }
  }
  const meshes = new Set<string>();
  for (const id of removed) {
    const shape = d.entity(id)?.shape;
    if (shape?.kind === 'mesh') meshes.add(shape.mesh);
  }
  for (let i = removed.length - 1; i >= 0; i--) d.deleteEntity(removed[i] as string);
  clearDanglingRefs(d, new Set(removed));
  // Mesh data belongs to its entities: drop assets nothing uses any more.
  for (const m of meshes) if (hasOwn(d.world.meshes, m) && meshUsers(d.world.entities, m).length === 0) delete d.meshes()[m];
  return OK;
}

function opRename(d: Draft, p: PatchOf<'rename'>): Outcome {
  const { id, newId } = p;
  if (!d.has(id)) return fail(notFound(d, 'entity', id, entityIds(d)));
  if (newId === id) return OK;
  if (isForbiddenKey(newId)) return fail(`id ${q(newId)} is reserved; choose another id`);
  if (d.has(newId)) return fail(`entity ${q(newId)} already exists — choose a free id${freeIdHint(d, newId)}`);
  const src = d.world.entities;
  const next: Record<string, Entity> = {};
  for (const key of Object.keys(src)) {
    const e = src[key] as Entity;
    if (key === id) next[newId] = renameEntityRefs({ ...e, id: newId }, id, newId);
    else next[key] = renameEntityRefs(e, id, newId);
  }
  d.replaceEntities(next);
  if (d.world.player.controls === id) d.set('player', { ...d.world.player, controls: newId });
  const mapper = renameMapper(id, newId);
  const rules = d.world.rules.map((r) => mapRuleRefs(r, mapper));
  if (rules.some((r, i) => r !== d.world.rules[i])) d.set('rules', rules);
  const tests = d.world.tests.map((t) => mapTestRefs(t, mapper));
  if (tests.some((t, i) => t !== d.world.tests[i])) d.set('tests', tests);
  const hud = d.world.hud.map((h) => {
    const key = mapper.stateKey(h.key);
    return key === h.key ? h : { ...h, key };
  });
  if (hud.some((h, i) => h !== d.world.hud[i])) d.set('hud', hud);
  return OK;
}

function ruleIndex(d: Draft, id: string): number {
  return d.world.rules.findIndex((r) => r.id === id);
}

function opAddRule(d: Draft, p: PatchOf<'addRule'>): Outcome {
  if (ruleIndex(d, p.rule.id) >= 0) return fail(`rule ${q(p.rule.id)} already exists — use 'updateRule' or 'removeRule' first`);
  if (d.world.rules.length >= LIMITS.MAX_RULES) return fail(`rule limit reached (${LIMITS.MAX_RULES})`);
  const sel = checkRuleSelectors(p.rule);
  if (!sel.ok) return sel;
  d.rules().push(p.rule);
  return OK;
}

function opUpdateRule(d: Draft, p: PatchOf<'updateRule'>): Outcome {
  const idx = ruleIndex(d, p.id);
  if (idx < 0) return fail(notFound(d, 'rule', p.id, () => d.world.rules.map((r) => r.id)));
  if (hasOwn(p.set, 'id') && p.set['id'] !== p.id) return fail("cannot change a rule's id with updateRule — remove it and add a new one");
  const merged = mergeAndValidate(d.world.rules[idx], p.set, RULE_MERGE, RuleSchema);
  if (!merged.ok) return fail(merged.message);
  const sel = checkRuleSelectors(merged.value);
  if (!sel.ok) return sel;
  if (!deepEqual(merged.value, d.world.rules[idx])) d.rules()[idx] = merged.value;
  return OK;
}

function opRemoveRule(d: Draft, p: PatchOf<'removeRule'>): Outcome {
  const idx = ruleIndex(d, p.id);
  if (idx < 0) return fail(notFound(d, 'rule', p.id, () => d.world.rules.map((r) => r.id)));
  d.rules().splice(idx, 1);
  return OK;
}

function opSetEnvironment(d: Draft, p: PatchOf<'setEnvironment'>): Outcome {
  const merged = mergeAndValidate(d.world.environment, p.set, ENVIRONMENT_MERGE, EnvironmentSchema);
  if (!merged.ok) return fail(merged.message);
  if (!deepEqual(merged.value, d.world.environment)) d.set('environment', merged.value);
  return OK;
}

function opSetPlayer(d: Draft, p: PatchOf<'setPlayer'>): Outcome {
  const merged = mergeAndValidate(d.world.player, p.set, PLAYER_MERGE, PlayerSchema);
  if (!merged.ok) return fail(merged.message);
  const controls = merged.value.controls;
  if (controls !== undefined && !d.has(controls)) return fail(`controls ${notFound(d, 'entity', controls, entityIds(d))}`, controls);
  if (!deepEqual(merged.value, d.world.player)) d.set('player', merged.value);
  return OK;
}

function opSetState(d: Draft, p: PatchOf<'setState'>): Outcome {
  if (p.key.length === 0 || p.key.length > 128) return fail('state key must be 1–128 characters');
  if (isForbiddenKey(p.key)) return fail(`state key ${q(p.key)} is reserved`);
  const exists = hasOwn(d.world.state, p.key);
  if (p.value === null) {
    d.setStateVar(p.key, undefined);
    return OK;
  }
  if (!exists && d.stateKeyCount() >= LIMITS.MAX_STATE_KEYS) return fail(`state variable limit reached (${LIMITS.MAX_STATE_KEYS})`);
  if (exists && deepEqual(d.world.state[p.key], p.value)) return OK;
  d.setStateVar(p.key, p.value);
  return OK;
}

function opSetHud(d: Draft, p: PatchOf<'setHud'>): Outcome {
  if (p.hud.length > LIMITS.MAX_HUD) return fail(`too many HUD entries (${p.hud.length}, max ${LIMITS.MAX_HUD})`);
  if (!deepEqual(p.hud, d.world.hud)) d.set('hud', p.hud);
  return OK;
}

function opDefine(d: Draft, kind: 'generators' | 'scripts', def: { id: string }, max: number): Outcome {
  if (isForbiddenKey(def.id)) return fail(`id ${q(def.id)} is reserved; choose another id`);
  const map = d.world[kind];
  const exists = hasOwn(map, def.id);
  if (!exists && Object.keys(map).length >= max) return fail(`${kind === 'generators' ? 'generator' : 'script'} limit reached (${max})`);
  if (exists && deepEqual(map[def.id], def)) return OK;
  if (kind === 'generators') d.generators()[def.id] = def as WorldDoc['generators'][string];
  else d.scripts()[def.id] = def as WorldDoc['scripts'][string];
  return OK;
}

function opRemoveGenerator(d: Draft, p: PatchOf<'removeGenerator'>): Outcome {
  if (!hasOwn(d.world.generators, p.id)) return fail(notFound(d, 'generator', p.id, () => Object.keys(d.world.generators)));
  const users = generatorUsers(d.world.entities, p.id);
  if (users.length > 0) {
    return fail(`generator ${q(p.id)} is still used by ${users.slice(0, 5).map(q).join(', ')}${users.length > 5 ? ` and ${users.length - 5} more` : ''}; change or remove those entities first`);
  }
  delete d.generators()[p.id];
  return OK;
}

function opRemoveScript(d: Draft, p: PatchOf<'removeScript'>): Outcome {
  if (!hasOwn(d.world.scripts, p.id)) return fail(notFound(d, 'script', p.id, () => Object.keys(d.world.scripts)));
  delete d.scripts()[p.id];
  return OK;
}

function opSetMesh(d: Draft, p: PatchOf<'setMesh'>): Outcome {
  const m = p.mesh;
  if (isForbiddenKey(m.id)) return fail(`id ${q(m.id)} is reserved; choose another id`);
  const map = d.world.meshes;
  const prev = hasOwn(map, m.id) ? map[m.id] : undefined;
  if (!prev && Object.keys(map).length >= LIMITS.MAX_MESHES) return fail(`mesh limit reached (${LIMITS.MAX_MESHES})`);
  if (prev && deepEqual(prev, m)) return OK;
  const sizes = checkMeshAssetSizes(m);
  if (sizes) return fail(sizes);
  const total = meshTotalBytes(map) - (prev ? meshAssetBytes(prev) : 0) + meshAssetBytes(m);
  if (total > LIMITS.MAX_MESH_BYTES) return fail(`mesh data would total ${Math.round(total / 1024)} KiB (max ${LIMITS.MAX_MESH_BYTES / 1024} KiB); simplify or delete meshes`);
  try {
    decodeMesh(m);
  } catch (err) {
    return fail(`invalid mesh data: ${err instanceof Error ? truncate(err.message, 120) : 'malformed'}`);
  }
  d.meshes()[m.id] = m;
  return OK;
}

function opRemoveMesh(d: Draft, p: PatchOf<'removeMesh'>): Outcome {
  if (!hasOwn(d.world.meshes, p.id)) return fail(notFound(d, 'mesh', p.id, () => Object.keys(d.world.meshes)));
  const users = meshUsers(d.world.entities, p.id);
  if (users.length > 0) return fail(`mesh ${q(p.id)} is still used by ${users.slice(0, 5).map(q).join(', ')}; change or remove those entities first`);
  delete d.meshes()[p.id];
  return OK;
}

function opAddTest(d: Draft, p: PatchOf<'addTest'>): Outcome {
  if (d.world.tests.some((t) => t.id === p.test.id)) return fail(`test ${q(p.test.id)} already exists — remove it first or use another id`);
  if (d.world.tests.length >= LIMITS.MAX_TESTS) return fail(`test limit reached (${LIMITS.MAX_TESTS})`);
  const sel = checkTestSelectors(p.test);
  if (!sel.ok) return sel;
  d.tests().push(p.test);
  return OK;
}

function opRemoveTest(d: Draft, p: PatchOf<'removeTest'>): Outcome {
  const idx = d.world.tests.findIndex((t) => t.id === p.id);
  if (idx < 0) return fail(notFound(d, 'test', p.id, () => d.world.tests.map((t) => t.id)));
  d.tests().splice(idx, 1);
  return OK;
}

function opSetMeta(d: Draft, p: PatchOf<'setMeta'>): Outcome {
  if (p.name !== undefined && p.name !== d.world.name) d.set('name', p.name);
  if (p.description !== undefined && p.description !== d.world.description) d.set('description', p.description);
  if (p.seed !== undefined && p.seed !== d.world.seed) d.set('seed', p.seed);
  if (p.intro === null) d.setIntro(undefined);
  else if (p.intro !== undefined && !deepEqual(p.intro, d.world.intro)) d.setIntro(p.intro);
  if (p.opening === null) d.setOpening(undefined);
  else if (p.opening !== undefined && !deepEqual(p.opening, d.world.opening)) d.setOpening(p.opening);
  if (p.feel === null) d.setFeel(undefined);
  else if (p.feel !== undefined && !deepEqual(p.feel, d.world.feel)) d.setFeel(p.feel);
  if (p.textures !== undefined) {
    const next: NonNullable<typeof d.world.textures> = { ...(d.world.textures ?? {}) };
    for (const [id, def] of Object.entries(p.textures)) {
      if (def === null) delete next[id];
      else next[id] = def;
    }
    if (Object.keys(next).length > 48) return fail('a world holds at most 48 texture sets');
    if (!deepEqual(next, d.world.textures ?? {})) d.setTextures(Object.keys(next).length > 0 ? next : undefined);
  }
  return OK;
}

function opClear(d: Draft, p: PatchOf<'clear'>): Outcome {
  if (Object.keys(d.world.entities).length > 0) d.replaceEntities({});
  if (d.world.rules.length > 0) d.set('rules', []);
  if (d.world.tests.length > 0) d.set('tests', []);
  if (Object.keys(d.world.state).length > 0) d.set('state', {});
  if (d.world.hud.length > 0) d.set('hud', []);
  for (const m of Object.keys(d.world.meshes)) delete d.meshes()[m];
  // The title card describes the cleared content (its game), so it goes too; so do the texture sets made for it.
  d.setIntro(undefined);
  // So does the opening view: it looked at what was there.
  d.setOpening(undefined);
  if (d.world.textures !== undefined) d.setTextures(undefined);
  if (!p.keepEnvironment) {
    const env = EnvironmentSchema.parse({});
    const player = PlayerSchema.parse({});
    if (!deepEqual(env, d.world.environment)) d.set('environment', env);
    if (!deepEqual(player, d.world.player)) d.set('player', player);
    d.setVoxel(undefined);
  } else if (d.world.player.controls !== undefined) {
    const { controls: _dropped, ...player } = d.world.player;
    d.set('player', player);
  }
  return OK;
}

function applyOne(d: Draft, p: Patch): Outcome {
  switch (p.op) {
    case 'add': return opAdd(d, p);
    case 'update': return opUpdate(d, p);
    case 'remove': return opRemove(d, p);
    case 'rename': return opRename(d, p);
    case 'addRule': return opAddRule(d, p);
    case 'updateRule': return opUpdateRule(d, p);
    case 'removeRule': return opRemoveRule(d, p);
    case 'setEnvironment': return opSetEnvironment(d, p);
    case 'setPlayer': return opSetPlayer(d, p);
    case 'setState': return opSetState(d, p);
    case 'setHud': return opSetHud(d, p);
    case 'defineGenerator': return opDefine(d, 'generators', p.generator, LIMITS.MAX_GENERATORS);
    case 'defineScript': return opDefine(d, 'scripts', p.script, LIMITS.MAX_SCRIPTS);
    case 'removeGenerator': return opRemoveGenerator(d, p);
    case 'removeScript': return opRemoveScript(d, p);
    case 'addTest': return opAddTest(d, p);
    case 'removeTest': return opRemoveTest(d, p);
    case 'setMeta': return opSetMeta(d, p);
    case 'clear': return opClear(d, p);
    case 'setMesh': return opSetMesh(d, p);
    case 'removeMesh': return opRemoveMesh(d, p);
    case 'setVoxel': {
      const err = applySetVoxel(d, p.set);
      return err ? fail(err) : OK;
    }
    case 'voxelEdit': {
      const err = applyVoxelEdit(d, p.edits);
      return err ? fail(err) : OK;
    }
    default: {
      const exhaustive: never = p;
      return fail(`unsupported op ${JSON.stringify((exhaustive as { op?: unknown }).op)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

type Parsed = { ok: true; patch: Patch; nodes: number } | { ok: false; message: string; nodes: number };

function parsePatch(raw: unknown, nodeBudget: number): Parsed {
  if (!isPlainObject(raw)) return { ok: false, message: 'each patch must be an object like {"op":"add","entity":{…}}', nodes: 1 };
  const guard = inspectUntrusted(raw, { maxNodes: Math.max(1, nodeBudget) });
  if (!guard.ok) return { ok: false, message: `${guard.path ? `${guard.path}: ` : ''}${guard.message}`, nodes: nodeBudget };
  const issues = findUnknownKeys(raw, PatchSchema);
  const parsed = PatchSchema.safeParse(raw);
  if (!parsed.success) issues.push(...zodIssues(parsed.error));
  if (issues.length > 0 || !parsed.success) return { ok: false, message: issuesText(issues), nodes: guard.nodes };
  return { ok: true, patch: parsed.data, nodes: guard.nodes };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

interface Pending {
  index: number;
  raw: unknown;
  patch: Patch;
  outcome: Outcome & { ok: false };
}

/**
 * Apply patches to a world. Pure: never mutates `world` or `patches`, never
 * throws for bad input. Untouched entities keep object identity.
 */
export function applyPatches(world: WorldDoc, patches: readonly unknown[], opts: ApplyOptions = {}): PatchResult {
  const errors: PatchError[] = [];
  if (!Array.isArray(patches)) {
    return { world, applied: [], errors: [{ index: -1, op: 'batch', message: 'patches must be an array' }] };
  }
  if (patches.length > LIMITS.MAX_PATCHES_PER_CALL) {
    return { world, applied: [], errors: [{ index: -1, op: 'batch', message: `too many patches (${patches.length}, max ${LIMITS.MAX_PATCHES_PER_CALL}); split the work into several calls` }] };
  }

  // 1) Parse everything first so forward references can be recognised.
  const parsed: Array<Patch | null> = new Array<Patch | null>(patches.length).fill(null);
  const pendingAdds = new Map<string, number>();
  let budget = LIMITS.MAX_INPUT_NODES;
  for (let i = 0; i < patches.length; i++) {
    const raw: unknown = patches[i];
    const r = parsePatch(raw, budget);
    budget -= r.nodes;
    if (!r.ok) {
      errors.push({ index: i, op: opOf(raw), message: `${labelOf(raw)}: ${r.message}` });
      continue;
    }
    parsed[i] = r.patch;
    if (r.patch.op === 'add') pendingAdds.set(r.patch.entity.id, (pendingAdds.get(r.patch.entity.id) ?? 0) + 1);
  }

  // 2) Apply in order, deferring operations blocked on a later add.
  const draft = new Draft(world);
  const applied: Patch[] = [];
  let deferred: Pending[] = [];
  const isPending = (id: string): boolean => (pendingAdds.get(id) ?? 0) > 0 || deferred.some((p) => p.patch.op === 'add' && p.patch.entity.id === id);

  const retryDeferred = (): void => {
    let progress = true;
    while (progress && deferred.length > 0) {
      progress = false;
      const still: Pending[] = [];
      for (const item of deferred) {
        // Only retry once the reference it was waiting for exists (keeps retries O(1) otherwise).
        if (item.outcome.missingRef !== undefined && !draft.has(item.outcome.missingRef)) {
          still.push(item);
          continue;
        }
        const outcome = applyOne(draft, item.patch);
        if (outcome.ok) {
          applied.push(item.patch);
          progress = true;
        } else {
          still.push({ ...item, outcome });
        }
      }
      deferred = still;
    }
  };

  for (let i = 0; i < patches.length; i++) {
    const patch = parsed[i];
    if (!patch) continue;
    if (patch.op === 'add') pendingAdds.set(patch.entity.id, (pendingAdds.get(patch.entity.id) ?? 1) - 1);
    const outcome = applyOne(draft, patch);
    if (outcome.ok) {
      applied.push(patch);
      if (deferred.length > 0) retryDeferred();
    } else if (outcome.missingRef !== undefined && isPending(outcome.missingRef)) {
      deferred.push({ index: i, raw: patches[i], patch, outcome });
    } else {
      errors.push({ index: i, op: patch.op, message: `${labelOf(patches[i])}: ${outcome.message}` });
    }
  }
  for (const item of deferred) {
    errors.push({ index: item.index, op: item.patch.op, message: `${labelOf(item.raw)}: ${item.outcome.message}` });
  }
  errors.sort((a, b) => a.index - b.index);

  if (opts.atomic && errors.length > 0) return { world, applied: [], errors };
  return { world: draft.result(), applied, errors };
}
