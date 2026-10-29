/**
 * Executes the planner's tool calls against an {@link AgentHost} and turns
 * the outcome into concise, actionable tool results plus agent events.
 * All model arguments are untrusted: they are size-checked and zod-validated
 * here, and patches are validated again by the host's `applyPatches`.
 */
import { describeModel, describeSimreadyHit, findModels, headNoun, lacksNoun, loadCatalog, searchAssets, searchSimready, HUB_FIRST, HUB_SKIP_TEXT, isStructuralQuery, pickHubFirst, withHubTimeout } from '@aether/assets';
import { applyArchOps, describePartLine, emptiesWorld, emptyWorldRefusal, findCrafted, partInfo, runDesignTool, type DesignToolName } from '@aether/arch';
import { GeneratorDef, ScriptDef, applyPatches, carryPatches, characterPatches, hasOwn, isPlainObject, type CarriedDependent, type Patch, type PatchError, type WorldDoc } from '@aether/core';
import { summarizeWorldForModel } from './world-text';
import type { z } from 'zod';
import { requestGenerator } from './coder';
import { libraryDefinitions } from './library-refs';
import { readGroups } from './groups';
import { landPatches, type LandInput } from './land';
import { feelPatches, type TuneFeelInput } from './feel-edit';
import { bakePatches, type BakeLightInput } from './bake-edit';
import { lookPatches, type TuneLookInput } from './look-edit';
import { makeRealistic } from './providers/mock/realistic';
import { errorMessage } from './providers/errors';
import { TOOL_LIMITS, ToolInputs, isAgentTool, isLevelToolName } from './tools';
import { makeTextureTool } from './textures';
import type { AgentEvent, AgentHost, AgentOptions, HubModelHit, Provider, UsageTotals } from './types';

/** Result of one tool execution. */
export interface ToolOutcome {
  content: string;
  isError: boolean;
  events: AgentEvent[];
  /** The world was modified. */
  edited: boolean;
  /** The model declared the task complete. */
  finished?: { message: string };
  /** A verification ran (run_verification). */
  verified?: { passed: boolean };
}

/** Everything a tool execution may need. */
export interface ExecutorContext {
  host: AgentHost;
  provider: Provider;
  coderSystem: string;
  builtinGenerators: ReadonlySet<string>;
  usage: UsageTotals;
  signal?: AbortSignal;
  /** Library generator definitions on demand (see {@link libraryDefinitions}). */
  resolveGenerator?: (id: string) => Promise<GeneratorDef | null>;
  /** Agentic asset builder (deep build); see `AgentOptions.buildAsset`. */
  buildAsset?: AgentOptions['buildAsset'];
  /** Importing from SimReady Central through the local server; see `AgentOptions.importAsset`. */
  importAsset?: AgentOptions['importAsset'];
  /** Searching the Aether asset hub; see `AgentOptions.hubSearch`. */
  hubSearch?: AgentOptions['hubSearch'];
  /** Level tools (`query_level`, `place_level_items`); see `AgentOptions.levelTools`. */
  levelTools?: AgentOptions['levelTools'];
  /** Texture sources for `make_texture` (see `AgentOptions.textures`). */
  textures?: AgentOptions['textures'];
  /** Set for a small edit: checks a patch list against what the request named; `ok: false` patches are refused with the message. */
  audit?: (patches: readonly unknown[]) => { ok: boolean; message: string };
  /**
   * The world should look real (the request asks for no stylised look and the world is not built from the stylised
   * nature parts): `apply_patches` exchanges the low-poly nature generators (tree-pine, tree-oak, bush, grass-tuft, rock,
   * flowers) for the realistic set and says so in its result.
   */
  realistic?: boolean;
}

const MAX_RESULT_CHARS = 20_000;
/** Ids of the architecture generators (`arch-*`, `furn-*`), reserved for buildings. */
const RESERVED_GENERATOR_PREFIX = /^(arch|furn)-/;
const MAX_LISTED_ERRORS = 25;
const MAX_ENTITY_JSON = 3_000;

function clip(text: string, max = MAX_RESULT_CHARS): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n… (truncated)`;
}

function issuesText(error: z.ZodError): string {
  return error.issues.slice(0, 8).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}

function fail(content: string): ToolOutcome {
  return { content, isError: true, events: [], edited: false };
}

/** Reject a promise as soon as `signal` aborts (the underlying work cannot be cancelled). */
export function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e instanceof Error ? e : new Error(errorMessage(e)));
      },
    );
  });
}

/** An Error named AbortError. */
export function abortError(): Error {
  const e = new Error('aborted');
  e.name = 'AbortError';
  return e;
}

/** Concise patch outcome for the model: counts plus every error by index. */
export function formatPatchOutcome(applied: number, total: number, errors: readonly PatchError[], entityCount: number): string {
  const lines = [`Applied ${applied}/${total} patches. The world now has ${entityCount} entities.`];
  if (errors.length > 0) {
    lines.push(`${errors.length} patch(es) were rejected and NOT applied — fix and resend only these:`);
    for (const e of errors.slice(0, MAX_LISTED_ERRORS)) lines.push(`- [${e.index}] ${e.op}: ${e.message.slice(0, 300)}`);
    if (errors.length > MAX_LISTED_ERRORS) lines.push(`- … ${errors.length - MAX_LISTED_ERRORS} more`);
  }
  return lines.join('\n');
}

function inputSize(input: unknown): number {
  try {
    return JSON.stringify(input ?? null).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Safety net for people: any entity that stands for a person but has no character gets a rigged one, so a capsule human
 * never ships. Applied as its own undo step right after the edit that added it; returns the note for the model.
 */
function attachPeople(ctx: ExecutorContext, events: AgentEvent[], editPatches: readonly unknown[]): string {
  // Only what this edit added or changed: a person the user left alone is not an "over-edit".
  const touched = new Set<string>();
  for (const p of editPatches) {
    const op = p as { op?: string; id?: unknown; newId?: unknown; entity?: { id?: unknown } };
    if (op.op === 'add' && typeof op.entity?.id === 'string') touched.add(op.entity.id);
    else if (op.op === 'update' && typeof op.id === 'string') touched.add(op.id);
    else if (op.op === 'rename' && typeof op.newId === 'string') touched.add(op.newId);
  }
  if (touched.size === 0) return '';
  const fix = characterPatches(ctx.host.getWorld(), touched);
  if (fix.length === 0) return '';
  const message = `Give ${fix.length} ${fix.length === 1 ? 'person' : 'people'} a character`;
  const applied = ctx.host.applyPatches(fix, message);
  if (applied.applied.length === 0) return '';
  events.push({ type: 'patches', patches: applied.applied, message, result: { applied: applied.applied.length, errors: applied.errors } });
  const ids = fix.map((p) => (p.op === 'update' ? p.id : '')).filter(Boolean).slice(0, 8).join(', ');
  return `Note: ${applied.applied.length} entit${applied.applied.length === 1 ? 'y' : 'ies'} (${ids}) stood for people without a character; a rigged character was attached. Set "character" yourself to choose the look.`;
}

/**
 * The dependents of the objects a raw patch batch moves (see core `carryPatches`): what belongs to a moved
 * object and is not placed by the batch itself. Raw input; nothing here trusts it beyond reading ids.
 */
export function carryDependents(world: WorldDoc, raw: readonly unknown[]): { patches: Patch[]; carried: CarriedDependent[] } {
  const moved = new Set<string>();
  const touched = new Set<string>();
  for (const p of raw) {
    if (!isPlainObject(p)) continue;
    const id = typeof p['id'] === 'string' ? p['id'] : undefined;
    const op = p['op'];
    if (op === 'update' && id) {
      touched.add(id);
      const set = p['set'];
      if (isPlainObject(set) && Object.keys(set).some((k) => k === 'transform' || k.startsWith('transform.'))) moved.add(id);
    } else if ((op === 'remove' || op === 'rename') && id) touched.add(id);
    else if (op === 'add' && isPlainObject(p['entity']) && typeof p['entity']['id'] === 'string') touched.add(p['entity']['id']);
  }
  if (moved.size === 0) return { patches: [], carried: [] };
  const trial = applyPatches(world, raw);
  return carryPatches(world, trial.world, moved, touched);
}

async function applyPatchesTool(ctx: ExecutorContext, input: z.infer<typeof ToolInputs.apply_patches>): Promise<ToolOutcome> {
  const message = input.message.trim().slice(0, 200) || 'Agent edit';
  let exchanged = 0;
  if (ctx.realistic) {
    // The stylised low-poly nature parts read as toys next to everything else: build the realistic stand-ins instead.
    const copy = structuredClone(input.patches);
    exchanged = makeRealistic(copy as never);
    if (exchanged > 0) input = { ...input, patches: copy };
  }
  // What belongs to a moved object (its light, goal zone, plinth) moves with it unless the batch places it itself.
  const carry = carryDependents(ctx.host.getWorld(), input.patches);
  const patches = carry.patches.length > 0 ? [...input.patches, ...carry.patches] : input.patches;
  if (ctx.audit) {
    const audit = ctx.audit(patches);
    if (!audit.ok) return { content: audit.message, isError: true, events: [{ type: 'status', text: 'Held back a patch that touched unrelated objects; asking for a more precise one…' }], edited: false };
  }
  // A batch that would leave nothing in the world is refused unless the user asked to start over.
  if (input.startOver !== true) {
    const before = ctx.host.getWorld();
    if (Object.keys(before.entities).length > 0 && emptiesWorld(before, applyPatches(before, patches).world)) {
      return { content: `apply_patches ${emptyWorldRefusal(Object.keys(before.entities).length, 'apply_patches')}`, isError: true, events: [], edited: false };
    }
  }
  const defs = ctx.resolveGenerator ? await raceAbort(libraryDefinitions(input.patches, ctx.host.getWorld(), ctx.builtinGenerators, ctx.resolveGenerator), ctx.signal) : [];
  const events: AgentEvent[] = [];
  if (defs.length > 0) {
    const res = ctx.host.applyPatches(defs, `Library: ${defs.map((d) => d.generator.id).join(', ')}`.slice(0, 200));
    for (const d of defs) {
      const err = res.errors.find((e) => e.index === defs.indexOf(d));
      events.push(err ? { type: 'generator', def: d.generator, ok: false, error: err.message } : { type: 'generator', def: d.generator, ok: true });
    }
  }
  const result = ctx.host.applyPatches(patches, message);
  events.push({ type: 'patches', patches: result.applied, message, result: { applied: result.applied.length, errors: result.errors } });
  const own = result.errors.filter((e) => e.index < input.patches.length);
  const carriedOk = carry.carried.filter((_, i) => !result.errors.some((e) => e.index === input.patches.length + i));
  let content = formatPatchOutcome(result.applied.length - carriedOk.length, input.patches.length, own, Object.keys(result.world.entities).length);
  if (carriedOk.length > 0) content += `\nMoved with their owner (they belong to it; set their position yourself to place them elsewhere): ${carriedOk.slice(0, 8).map((c) => `${c.id} with ${c.owner}`).join(', ')}${carriedOk.length > 8 ? ', …' : ''}.`;
  const people = attachPeople(ctx, events, result.applied);
  if (people) content += `\n${people}`;
  const flatWater = flatWaterIds(input.patches);
  if (flatWater.length > 0) content += `\nNote: ${flatWater.slice(0, 4).join(', ')} ${flatWater.length === 1 ? 'is' : 'are'} water as a flat box on the ground, which reads as a toy: for a river or stream use shape_land {op:"land", stream:{z, half}} (a carved bed with flowing water), for a lake or pond shape_land land with lake:{x, z, radius}, then remove the box.`;
  const hills = boxHillIds(input.patches);
  if (hills.length > 0) content += `\nNote: ${hills.slice(0, 4).join(', ')} look${hills.length === 1 ? 's' : ''} like a hill made of a primitive: shape_land {op:"mound", x, z, size, height, top} raises a natural hill with a level summit to stand things on.`;
  if (exchanged > 0) content += `\nNote: ${exchanged} low-poly nature part${exchanged === 1 ? ' was' : 's were'} built with the realistic generators (tree-broadleaf, tree-spruce, shrub, meadow-grass, boulder, wildflowers); use those ids directly, or ask for a stylised look to keep the low-poly set.`;
  if (result.notes && result.notes.length > 0) content += `\n${result.notes.slice(0, 4).map((n) => `Note: ${n.slice(0, 400)}`).join('\n')}`;
  return { content, isError: result.applied.length === 0 && result.errors.length > 0, events, edited: result.applied.length > 0 };
}

/**
 * build_architecture: apply the ops to the buildings' plans (pure, in
 * @aether/arch), commit the minimal patch list as one undo step and report
 * per-op refusals (code + fix hint) plus the usability check of every
 * touched building.
 */
function buildArchitectureTool(ctx: ExecutorContext, input: z.infer<typeof ToolInputs.build_architecture>): ToolOutcome {
  const message = input.message.trim().slice(0, 200) || 'Architecture edit';
  const res = applyArchOps(ctx.host.getWorld(), input.ops);
  const events: AgentEvent[] = [];
  const lines: string[] = [];
  let edited = false;
  if (res.patches.length > 0) {
    const applied = ctx.host.applyPatches(res.patches, message);
    events.push({ type: 'patches', patches: applied.applied, message, result: { applied: applied.applied.length, errors: applied.errors } });
    edited = applied.applied.length > 0;
    if (applied.errors.length > 0) lines.push(formatPatchOutcome(applied.applied.length, res.patches.length, applied.errors, Object.keys(applied.world.entities).length));
    const people = attachPeople(ctx, events, applied.applied);
    if (people) lines.push(people);
  }
  lines.push(...res.lines.map((l) => l.slice(0, 600)));
  if (res.errors.length > 0) {
    lines.push(`${res.errors.length} op(s) were refused — fix and resend only these:`);
    for (const e of res.errors.slice(0, MAX_LISTED_ERRORS)) lines.push(`- [${e.index}] ${e.op} ${e.code}: ${e.message.slice(0, 300)} Fix: ${e.hint.slice(0, 300)}`);
  }
  const failing = res.reports.filter((r) => !r.passed);
  if (failing.length > 0) lines.push('Fix the usability problems above (move doors, remove or re-place items, widen rooms) with further build_architecture ops.');
  const refusedAll = res.errors.length > 0 && res.patches.length === 0;
  return { content: clip(lines.join('\n') || 'No change.'), isError: refusedAll, events, edited };
}

/**
 * design_plan / place_items / edit_items / query_scene: the typed design tools of
 * @aether/arch. They validate the model's arguments themselves, measure against the
 * document and return the accepted steps as patches, which are committed here as one
 * undo step; refusals come back as text with their reason and a fix.
 */
function designTool(ctx: ExecutorContext, name: DesignToolName, rawInput: unknown): ToolOutcome {
  const res = runDesignTool(ctx.host.getWorld(), name, rawInput);
  const events: AgentEvent[] = [];
  let edited = false;
  let text = res.text;
  if (res.patches.length > 0) {
    const applied = ctx.host.applyPatches(res.patches, res.message);
    events.push({ type: 'patches', patches: applied.applied, message: res.message, result: { applied: applied.applied.length, errors: applied.errors } });
    edited = applied.applied.length > 0;
    if (applied.errors.length > 0) text += `\n${formatPatchOutcome(applied.applied.length, res.patches.length, applied.errors, Object.keys(applied.world.entities).length)}`;
    const people = attachPeople(ctx, events, applied.applied);
    if (people) text += `\n${people}`;
  }
  return { content: clip(text), isError: !res.ok && res.patches.length === 0, events, edited };
}

async function defineGenerator(ctx: ExecutorContext, def: GeneratorDef, events: AgentEvent[]): Promise<ToolOutcome> {
  const res = ctx.host.applyPatches([{ op: 'defineGenerator', generator: def }], `Define generator ${def.id}`);
  if (res.errors.length > 0) {
    const error = res.errors.map((e) => e.message).join('; ');
    events.push({ type: 'generator', def, ok: false, error });
    return { content: `Generator rejected: ${error}`, isError: true, events, edited: false };
  }
  events.push({ type: 'generator', def, ok: true });
  const params = Object.keys(def.params).join(', ') || 'none';
  return {
    content: `Generator "${def.id}" defined (params: ${params}). Use shape {"kind":"procedural","generator":"${def.id}","params":{...}}; its base sits at y=0.`,
    isError: false,
    events,
    edited: true,
  };
}

async function validateGenerator(ctx: ExecutorContext, def: GeneratorDef): Promise<{ ok: boolean; error?: string }> {
  if (ctx.builtinGenerators.has(def.id) || RESERVED_GENERATOR_PREFIX.test(def.id)) return { ok: false, error: `"${def.id}" is a built-in generator id; choose another id` };
  if (!ctx.host.validateGenerator) return { ok: true };
  try {
    return await raceAbort(ctx.host.validateGenerator(def), ctx.signal);
  } catch (e) {
    if (ctx.signal?.aborted) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

async function writeGeneratorTool(ctx: ExecutorContext, input: z.infer<typeof ToolInputs.write_generator>): Promise<ToolOutcome> {
  const parsed = GeneratorDef.safeParse(input);
  if (!parsed.success) return fail(`Invalid generator: ${issuesText(parsed.error)}`);
  const check = await validateGenerator(ctx, parsed.data);
  if (!check.ok) {
    const error = check.error ?? 'validation failed';
    return { content: `Generator "${parsed.data.id}" failed validation: ${error.slice(0, 2000)}\nFix it and call write_generator again.`, isError: true, events: [{ type: 'generator', def: parsed.data, ok: false, error }], edited: false };
  }
  return defineGenerator(ctx, parsed.data, []);
}

/** Deep build: an agentic worker iterates on the generator; its result is validated like any other. */
async function buildAssetDeep(ctx: ExecutorContext, input: z.infer<typeof ToolInputs.request_asset>): Promise<ToolOutcome | null> {
  const build = ctx.buildAsset;
  if (!build) return null;
  const events: AgentEvent[] = [{ type: 'status', text: `Building "${input.id}" with the coding agent…` }];
  let result: Awaited<ReturnType<NonNullable<ExecutorContext['buildAsset']>>>;
  try {
    result = await raceAbort(build({ id: input.id, description: input.description, ...(input.params_hint ? { paramsHint: input.params_hint } : {}) }, ctx.signal), ctx.signal);
  } catch (e) {
    if (ctx.signal?.aborted) throw e;
    result = { ok: false, error: errorMessage(e) };
  }
  if (!result.ok) {
    // Fall back to the single-shot coder (the caller continues with it).
    events.push({ type: 'status', text: `The coding agent could not finish (${result.error.slice(0, 160)}); writing it directly instead…` });
    return { content: '', isError: true, events, edited: false };
  }
  const parsed = GeneratorDef.safeParse({ ...result.def, id: input.id });
  if (!parsed.success) return { content: '', isError: true, events: [...events, { type: 'status', text: 'The coding agent returned an invalid generator; writing it directly instead…' }], edited: false };
  const check = await validateGenerator(ctx, parsed.data);
  if (!check.ok) {
    const error = check.error ?? 'validation failed';
    events.push({ type: 'generator', def: parsed.data, ok: false, error }, { type: 'status', text: 'The built generator failed our checks; writing it directly instead…' });
    return { content: '', isError: true, events, edited: false };
  }
  const out = await defineGenerator(ctx, parsed.data, events);
  return out;
}

async function requestAssetTool(ctx: ExecutorContext, input: z.infer<typeof ToolInputs.request_asset>): Promise<ToolOutcome> {
  if (ctx.builtinGenerators.has(input.id) || RESERVED_GENERATOR_PREFIX.test(input.id)) return fail(`"${input.id}" is a built-in generator; use it directly or pick another id.`);
  const deep = await buildAssetDeep(ctx, input);
  if (deep && !deep.isError) return deep;
  const events: AgentEvent[] = [...(deep?.events ?? []), { type: 'status', text: `Writing a custom generator "${input.id}"…` }];
  const result = await requestGenerator(
    { provider: ctx.provider, system: ctx.coderSystem, validate: (def) => validateGenerator(ctx, def), usage: ctx.usage, ...(ctx.signal ? { signal: ctx.signal } : {}) },
    { id: input.id, description: input.description, ...(input.params_hint ? { paramsHint: input.params_hint } : {}) },
  );
  if (!result.ok) {
    if (result.def) events.push({ type: 'generator', def: result.def, ok: false, error: result.error });
    return { content: `The coder could not produce a working generator: ${result.error.slice(0, 1500)}\nUse built-in generators or primitives instead.`, isError: true, events, edited: false };
  }
  return defineGenerator(ctx, result.def, events);
}

async function writeScriptTool(ctx: ExecutorContext, input: z.infer<typeof ToolInputs.write_script>): Promise<ToolOutcome> {
  const parsed = ScriptDef.safeParse(input);
  if (!parsed.success) return fail(`Invalid script: ${issuesText(parsed.error)}`);
  if (ctx.host.validateScript) {
    let check: { ok: boolean; error?: string };
    try {
      check = await raceAbort(ctx.host.validateScript(parsed.data), ctx.signal);
    } catch (e) {
      if (ctx.signal?.aborted) throw e;
      check = { ok: false, error: errorMessage(e) };
    }
    if (!check.ok) return fail(`Script "${parsed.data.id}" failed validation: ${(check.error ?? 'validation failed').slice(0, 2000)}\nFix it and call write_script again.`);
  }
  const res = ctx.host.applyPatches([{ op: 'defineScript', script: parsed.data }], `Define script ${parsed.data.id}`);
  if (res.errors.length > 0) return fail(`Script rejected: ${res.errors.map((e) => e.message).join('; ')}`);
  return {
    content: `Script "${parsed.data.id}" defined. Attach it with behaviors: [{"type":"script","params":{"script":"${parsed.data.id}"}}].`,
    isError: false,
    events: [],
    edited: true,
  };
}

/** search_assets: ranked library matches as compact JSON lines the model can place directly. */
async function searchAssetsTool(input: z.infer<typeof ToolInputs.search_assets>): Promise<ToolOutcome> {
  const catalog = await loadCatalog();
  if (catalog.entries.length === 0) return { content: 'The asset library is not available here: use built-in generators or primitives.', isError: false, events: [], edited: false };
  // Surfaces are applied through material.finish (their photographed maps load automatically).
  const hits = searchAssets(catalog, { text: input.query, limit: input.limit + 4, ...(input.category ? { category: input.category } : {}) })
    .filter((h) => h.entry.kind !== 'material')
    .slice(0, input.limit);
  if (hits.length === 0) return { content: `No library asset matches "${input.query.slice(0, 80)}". Use a built-in generator, request_asset, or primitives.`, isError: false, events: [], edited: false };
  const lines = hits.map(({ entry: e }) => {
    const size = e.size.map((v) => Math.round(v * 100) / 100).join('x');
    const extra = [e.kind === 'hdri' ? 'environment: use setEnvironment {"hdri":"' + e.id + '"}' : e.kind === 'generator' ? `parametric generator: shape {"kind":"procedural","generator":"${e.generator?.id ?? e.id}"}, about ${size} m` : `size ${size} m`, e.placement !== 'floor' ? `goes on ${e.placement}` : '', e.anims && e.anims.clips.length > 0 ? 'animated (idle/walk/run follow movement)' : ''].filter(Boolean).join(', ');
    return `${e.id} — ${e.name} [${e.category}] ${extra}`;
  });
  return { content: clip(`${lines.join('\n')}\nPlace with shape {"kind":"asset","id":"<id>"} (real size; optional "fitSize" metres).`), isError: false, events: [], edited: false };
}

/** simready_search: licence-filtered candidates from NVIDIA SimReady Central. Read-only: nothing is downloaded or imported. */
async function simreadySearchTool(input: z.infer<typeof ToolInputs.simready_search>): Promise<ToolOutcome> {
  const r = await searchSimready({ query: input.query, limit: input.limit, ...(input.max_size !== undefined ? { maxSize: input.max_size } : {}), timeoutMs: 20_000 });
  if (!r.ok) return { content: `${r.error} Carry on with find_model, the crafted parts or a model from search_assets.`, isError: false, events: [], edited: false };
  const catalog = await loadCatalog();
  const have = (pkg: string): string | undefined => catalog.entries.find((e) => e.source.includes(`/${pkg}/`))?.id;
  const lines = r.accepted.map((h) => {
    const inLib = have(h.ref.pkg);
    return `${describeSimreadyHit(h)}\n  ${inLib ? `already in the library: shape {"kind":"asset","id":"${inLib}"} / place_items {"kind":"model:${inLib}"}` : h.importable ? `not in the library. import_asset {"query":"${input.query.slice(0, 60)}"} imports the best match on the local server, or a developer runs: ${h.fetch}` : 'not in the library, and its licence cannot be imported yet'}`;
  });
  const rej = r.rejected.length > 0 ? `\nRejected, not usable (${r.rejected.length}): ${r.rejected.slice(0, 6).map((h) => `${h.ref.pkg} (${h.reason})`).join('; ')}.` : '';
  if (lines.length === 0) return { content: clip(`SimReady Central: nothing with an accepted licence for "${input.query.slice(0, 80)}" (${r.considered} looked at).${rej}`), isError: false, events: [], edited: false };
  return { content: clip(`SimReady Central candidates for "${r.query}" (accepted licences only; nothing is downloaded here; none can be placed until imported). The service is mostly robotics props: check the size before you rely on a hit.\n${lines.join('\n')}${rej}`), isError: false, events: [], edited: false };
}

/**
 * import_asset: bring one model from SimReady Central into the project while working. The host does the work on the local
 * server; without one the answer says so and the run carries on (never an error).
 */
async function importAssetTool(ctx: ExecutorContext, input: z.infer<typeof ToolInputs.import_asset>): Promise<ToolOutcome> {
  if (!ctx.importAsset) return { content: 'Importing needs the local Aether server (npx aether start); this page cannot import. Carry on with find_model, the crafted parts or the nearest library model, and say in your message which model you would have imported.', isError: false, events: [], edited: false };
  let last = '';
  const r = await ctx.importAsset({ query: input.query, ...(input.hub_id ? { hubId: input.hub_id } : {}), ...(input.max_size !== undefined ? { maxSize: input.max_size } : {}) }, { ...(ctx.signal ? { signal: ctx.signal } : {}), onProgress: (t) => { last = t; } });
  if (!r.ok) return { content: clip(`${r.message}${last ? ` (last step: ${last})` : ''} Carry on with find_model, the crafted parts or the nearest library model.`), isError: false, events: [], edited: false };
  const size = r.size.map((v) => Math.round(v * 100) / 100).join(' x ');
  return { content: clip(`Imported "${r.name}" as ${r.id}: ${size} m (width x height x depth), ${r.triangles} triangles, ${r.licence}. The credit is recorded with the world and appears in its credits and exports: "${r.credit}". Place it in an open world with shape {"kind":"asset","id":"${r.id}"} (apply_patches; real size, base on y 0), or in a room with place_items {"kind":"model:${r.id}","room":...,"fit":[w,h,d]}. It is stored with the project, so published and exported games carry it.`), isError: false, events: [], edited: false };
}

/** find_model: ranked real models for one piece with the facts to judge them by. */
/** Crafted procedural parts that answer `what`, as lines the model can place from (free world shape, rows, or a room). */
function craftedLines(what: string): string[] {
  const out: string[] = [];
  for (const def of findCrafted(what, 3)) {
    const info = partInfo(def.kind);
    if (!info) continue;
    const aliases = (def.aliases ?? []).slice(0, 4).join(', ');
    out.push(`${describePartLine(info)}\n  crafted part "${def.kind}"${aliases ? ` (also: ${aliases})` : ''}, real detail, one cheap mesh that instances: free world shape {"kind":"procedural","generator":"${def.id}","params":{...}}; many at once ${def.mount === 'wall' ? `shape_land {op:"wall", from, to, count, y, of:"${def.id}"} along each wall` : def.mount === 'floor' ? `shape_land {op:"grid" | "along" | "perimeter" (seats around tables) | "tier", of:"${def.id}"}` : `shape_land {op:"row"|"grid"|"along", of:"${def.id}"}`}; in a room place_items {"kind":"${def.kind}"}.`);
  }
  return out;
}

/**
 * find_model with the hub-first policy (docs/ASSETS.md, "Lookup order"). A prop (furniture, appliance, tool, vehicle,
 * kitchenware, equipment, decor) is looked up in the asset hub first and used when the match passes the HUB_FIRST threshold
 * and its size is plausible; otherwise the bundled library and crafted parts answer, then the generators. Structural parts
 * never come from the hub. The hub is given HUB_FIRST.timeoutMs; late, private or offline it is skipped silently. The answer
 * ends with a "Source" line saying which source it used.
 */
async function findModelTool(ctx: ExecutorContext, input: z.infer<typeof ToolInputs.find_model>): Promise<ToolOutcome> {
  const base = await findModelCore(input);
  if (!input.what || base.isError) return base;
  const fallback = (why: string): string => `Source: bundled library and crafted parts (hub skipped: ${why}).`;
  const done = (first: string, rest: string, source: string): ToolOutcome => ({ ...base, content: clip(`${first}${base.content}${rest}\n${source}`) });
  if (isStructuralQuery(input.what)) return done('', '', fallback(HUB_SKIP_TEXT.structural));
  const hubSearch = ctx.hubSearch;
  if (!hubSearch) return base;
  try {
    const catalog = await loadCatalog();
    const have = new Set(catalog.entries.map((e) => e.id));
    const what = input.what;
    const r = await withHubTimeout((signal) => hubSearch(what, { limit: input.limit + 4, ...(input.look === 'realistic' ? { style: 'realistic' as const } : input.look === 'stylised' || input.look === 'low-poly' ? { style: 'stylized' as const } : {}), signal }), HUB_FIRST.timeoutMs, ctx.signal);
    const hits = r && r.ok ? r.hits.filter((h) => !have.has(h.id)) : null;
    const verdict = pickHubFirst(what, hits, searchAssets(catalog, { text: what, limit: 5 }).map((h) => h.entry.size));
    const others = (hits ?? []).filter((h) => !(verdict.use && h.id === verdict.hit.id)).slice(0, input.limit);
    const rest = others.length > 0 ? `\nHub models (Aether asset hub, not in the bundled library; load with import_asset {"query":"<name>","hub_id":"<id>"} before placing; the credit is added automatically):\n${others.map(hubLine).join('\n')}` : '';
    if (verdict.use) {
      const h = verdict.hit as HubModelHit;
      return done(`Hub-first match (Aether asset hub, confidence ${verdict.confidence.toFixed(2)}, size plausible), preferred for this real-world prop: ${hubLine(h)}\n  import_asset {"query":"${what.slice(0, 60)}","hub_id":"${h.id}"} loads it (hash-checked, credit recorded); the bundled library answer below is the fallback.\n`, rest, 'Source: Aether asset hub (hub-first match above the threshold).');
    }
    return done('', rest, fallback(HUB_SKIP_TEXT[verdict.reason]));
  } catch {
    /* the hub is optional: the library answer stands */
    return done('', '', fallback(HUB_SKIP_TEXT['hub-unavailable']));
  }
}

function hubLine(h: HubModelHit): string {
  return `${h.id} — ${h.name} [${h.category}, ${h.style}] hub, ${h.size.map((v) => Math.round(v * 100) / 100).join('x')} m, ${h.triangles} triangles, ${(h.bytes / 1000).toFixed(0)} KB, ${h.licence}, by ${h.author.slice(0, 50)}`;
}

async function findModelCore(input: z.infer<typeof ToolInputs.find_model>): Promise<ToolOutcome> {
  if (!input.what) return fail(input.like_crop ? 'find_model like_crop needs a photo rebuild with the perception layer on (it matches a crop of the photo); give `what` for the name search.' : 'find_model needs `what` (the piece to find).');
  const crafted = craftedLines(input.what);
  const catalog = await loadCatalog();
  const craftedBlock = crafted.length > 0 ? `Crafted parts (procedural, built to the real object, preferred over a box or a stretched model):\n${crafted.join('\n')}\n` : '';
  if (catalog.entries.length === 0) return { content: craftedBlock || 'The model library is not available here: use the parametric parts.', isError: false, events: [], edited: false };
  const hits = findModels(catalog, { text: input.what, limit: input.limit, ...(input.style ? { style: input.style } : {}), ...(input.category ? { category: input.category } : {}), ...(input.look ? { look: input.look } : {}), ...(input.color ? { color: input.color } : {}), ...(input.size ? { size: input.size } : {}) });
  if (hits.length === 0) return { content: craftedBlock ? `${craftedBlock}No photographed library model matches "${input.what.slice(0, 80)}".` : `No library model matches "${input.what.slice(0, 80)}". Use the parametric part for this kind (see the parts list).`, isError: false, events: [], edited: false };
  const lines = hits.map(describeModel);
  const same = hits[0]!.entry.interior?.type;
  // Nothing named like the request: say so, so the model does not stand in a different kind of object (a bench for a pew, a tree for a statue).
  const noun = headNoun(input.what);
  const stand = noun && !craftedBlock && hits.every((h) => lacksNoun(h.entry, noun)) ? `No library model is named "${noun}": the models below are other kinds of object (${[...new Set(hits.slice(0, 3).map((h) => h.entry.name))].join(', ')}). Say so in your notes. Then choose the nearest sensible substitute only if it still reads as a ${noun}, or craft one from primitives (apply_patches) or write_generator. Never stand in a different kind of thing for it (a bench is not a pew, a tree is not a statue, a street lamp is not a rope stanchion).\n` : '';
  return { content: clip(`${craftedBlock}${stand}${craftedBlock ? 'Library models:\n' : ''}${lines.join('\n')}\nPlace with place_items {"kind":"model:<id>","room":...,"fit":[w,h,d]} (the model is scaled within 0.5x to 2x); in a free world shape {"kind":"asset","id":"<id>"}. ${same ? `Other ${same} models exist: ask again with another style or colour.` : ''}`), isError: false, events: [], edited: false };
}

function inspectTool(ctx: ExecutorContext, input: z.infer<typeof ToolInputs.inspect>): ToolOutcome {
  const world = ctx.host.getWorld();
  if (input.groups) return { content: clip(readGroups(world, input.ids)), isError: false, events: [], edited: false };
  if (!input.ids || input.ids.length === 0) return { content: clip(summarizeWorldForModel(world, { maxEntities: 400 })), isError: false, events: [], edited: false };
  const parts: string[] = [];
  const missing: string[] = [];
  for (const id of input.ids) {
    if (!hasOwn(world.entities, id)) {
      missing.push(id);
      continue;
    }
    parts.push(clip(JSON.stringify(world.entities[id]), MAX_ENTITY_JSON));
  }
  if (missing.length > 0) parts.push(`Not found: ${missing.join(', ')}`);
  return { content: clip(parts.join('\n')), isError: missing.length === input.ids.length, events: [], edited: false };
}

/** Run the host verification and package it as an event + text. */
export async function runVerification(ctx: ExecutorContext): Promise<{ event: AgentEvent; passed: boolean; summary: string }> {
  const res = await raceAbort(ctx.host.verify(ctx.host.getWorld(), ctx.signal ? { signal: ctx.signal } : {}), ctx.signal);
  const summary = typeof res.summary === 'string' ? res.summary : 'no summary';
  const passed = res.passed === true;
  return { event: { type: 'verify', passed, summary, report: res.report }, passed, summary };
}

/** query_level / place_level_items: measured by the host's physics, committed here as one undo step. */
async function levelTool(ctx: ExecutorContext, name: 'query_level' | 'place_level_items', rawInput: unknown): Promise<ToolOutcome> {
  const run = ctx.levelTools;
  if (!run) return fail(`${name} is not available in this session: use apply_patches and inspect.`);
  const res = await raceAbort(run(ctx.host.getWorld(), name, rawInput ?? {}), ctx.signal);
  const events: AgentEvent[] = [];
  let edited = false;
  let text = res.text;
  if (res.patches.length > 0) {
    const applied = ctx.host.applyPatches(res.patches, res.message);
    events.push({ type: 'patches', patches: applied.applied, message: res.message, result: { applied: applied.applied.length, errors: applied.errors } });
    edited = applied.applied.length > 0;
    if (applied.errors.length > 0) text += `\n${formatPatchOutcome(applied.applied.length, res.patches.length, applied.errors, Object.keys(applied.world.entities).length)}`;
    const people = attachPeople(ctx, events, applied.applied);
    if (people) text += `\n${people}`;
  }
  return { content: clip(text), isError: !res.ok && res.patches.length === 0, events, edited };
}

interface AddedEntity { id?: unknown; name?: unknown; tags?: unknown; shape?: { kind?: unknown; primitive?: unknown; size?: unknown }; material?: { preset?: unknown; finish?: unknown } }

function addedEntities(patches: readonly unknown[]): AddedEntity[] {
  const out: AddedEntity[] = [];
  for (const p of patches) {
    if (typeof p !== 'object' || p === null) continue;
    const r = p as { op?: unknown; entity?: unknown };
    if (r.op === 'add' && typeof r.entity === 'object' && r.entity !== null) out.push(r.entity as AddedEntity);
  }
  return out;
}

/** Ids of added water surfaces that are plain primitives (a box, disc or plane of water), not part of a shaped land. */
function flatWaterIds(patches: readonly unknown[]): string[] {
  return addedEntities(patches)
    .filter((e) => (e.material?.preset === 'water' || e.material?.finish === 'water') && e.shape?.kind === 'primitive' && !(Array.isArray(e.tags) && e.tags.includes('land')))
    .map((e) => String(e.id));
}

/** Ids of added primitives named or tagged as a hill, mound or knoll. */
function boxHillIds(patches: readonly unknown[]): string[] {
  return addedEntities(patches)
    .filter((e) => e.shape?.kind === 'primitive' && /\b(hill|mound|knoll|hillock)\b/i.test(`${String(e.id ?? '')} ${String(e.name ?? '')} ${Array.isArray(e.tags) ? e.tags.join(' ') : ''}`.replace(/[-_]/g, ' ')))
    .map((e) => String(e.id));
}

/** shape_land: the landscape kit (terrain, stream, woods, cover; draped paths), committed as one undo step. */
function shapeLandTool(ctx: ExecutorContext, input: LandInput): ToolOutcome {
  const { patches, summary, refused } = landPatches(ctx.host.getWorld(), input);
  if (refused) return { content: summary, isError: true, events: [], edited: false };
  const message = ({ land: 'Shape the land', row: 'String a row along a line', mound: 'Raise a hill', path: 'Lay a path', grid: 'Lay a block of pieces', tier: 'Build raked seating', wall: 'Hang pieces along a wall', along: 'Place pieces along a line', perimeter: 'Seat the tables', around: 'Place pieces round the room', street: 'Build a village street' } as const)[input.op];
  const result = ctx.host.applyPatches(patches, message);
  const events: AgentEvent[] = [{ type: 'patches', patches: result.applied, message, result: { applied: result.applied.length, errors: result.errors } }];
  if (result.errors.length > 0) return { content: `shape_land could not apply ${result.errors.length} of ${patches.length} patches: ${result.errors.slice(0, 4).map((e) => e.message.slice(0, 160)).join('; ')}`, isError: result.applied.length === 0, events, edited: result.applied.length > 0 };
  return { content: summary, isError: false, events, edited: true };
}

/** tune_feel: the game's feedback tier, per-event cues and entity emitters, committed as one undo step. */
function tuneFeelTool(ctx: ExecutorContext, input: TuneFeelInput): ToolOutcome {
  const { patches, summary, refused } = feelPatches(ctx.host.getWorld(), input);
  const notes = refused.length > 0 ? `\nRefused: ${refused.slice(0, 8).join('; ')}` : '';
  if (patches.length === 0) return { content: `${summary}${notes}`, isError: refused.length > 0, events: [], edited: false };
  const message = (input.message ?? 'Tune game feel').slice(0, 200);
  const result = ctx.host.applyPatches(patches, message);
  const events: AgentEvent[] = [{ type: 'patches', patches: result.applied, message, result: { applied: result.applied.length, errors: result.errors } }];
  if (result.errors.length > 0) return { content: `tune_feel could not apply ${result.errors.length} of ${patches.length} patches: ${result.errors.slice(0, 4).map((e) => e.message.slice(0, 160)).join('; ')}${notes}`, isError: result.applied.length === 0, events, edited: result.applied.length > 0 };
  return { content: `${summary}${notes}`, isError: false, events, edited: true };
}

/** tune_look: how light and colour are presented (exposure, grade, fog, tints), committed as one undo step. */
function tuneLookTool(ctx: ExecutorContext, input: TuneLookInput): ToolOutcome {
  const { patches, summary, refused } = lookPatches(ctx.host.getWorld(), input);
  const notes = refused.length > 0 ? `\nRefused: ${refused.slice(0, 8).join('; ')}` : '';
  if (patches.length === 0) return { content: `${summary}${notes}`, isError: refused.length > 0, events: [], edited: false };
  const message = (input.message ?? 'Tune the look').slice(0, 200);
  const result = ctx.host.applyPatches(patches, message);
  const events: AgentEvent[] = [{ type: 'patches', patches: result.applied, message, result: { applied: result.applied.length, errors: result.errors } }];
  if (result.errors.length > 0) return { content: `tune_look could not apply: ${result.errors.slice(0, 4).map((e) => e.message.slice(0, 160)).join('; ')}${notes}`, isError: result.applied.length === 0, events, edited: result.applied.length > 0 };
  return { content: `${summary}${notes}`, isError: false, events, edited: true };
}

/** bake_light: whether and how a building's interior light is baked, committed as one undo step (the renderer does the work). */
function bakeLightTool(ctx: ExecutorContext, input: BakeLightInput): ToolOutcome {
  const { patches, summary } = bakePatches(ctx.host.getWorld(), input);
  if (patches.length === 0) return { content: summary, isError: false, events: [], edited: false };
  const message = (input.message ?? 'Bake the interior light').slice(0, 200);
  const result = ctx.host.applyPatches(patches, message);
  const events: AgentEvent[] = [{ type: 'patches', patches: result.applied, message, result: { applied: result.applied.length, errors: result.errors } }];
  if (result.errors.length > 0) return { content: `bake_light could not apply: ${result.errors.slice(0, 4).map((e) => e.message.slice(0, 160)).join('; ')}`, isError: result.applied.length === 0, events, edited: result.applied.length > 0 };
  return { content: summary, isError: false, events, edited: true };
}

/** Execute one tool call. Never throws except when aborted. */
export async function executeTool(ctx: ExecutorContext, name: string, rawInput: unknown): Promise<ToolOutcome> {
  if (isLevelToolName(name)) {
    if (typeof rawInput === 'string') return fail('The tool arguments were not valid JSON. Resend the call with a valid JSON object.');
    if (inputSize(rawInput) > TOOL_LIMITS.MAX_INPUT_CHARS) return fail(`Tool input too large (max ${TOOL_LIMITS.MAX_INPUT_CHARS} characters). Split it into several calls.`);
    try {
      return await levelTool(ctx, name, rawInput);
    } catch (e) {
      if (ctx.signal?.aborted) throw e;
      return fail(`Tool "${name}" failed: ${errorMessage(e).slice(0, 500)}`);
    }
  }
  if (!isAgentTool(name)) return fail(`Unknown tool "${name.slice(0, 64)}". Available: apply_patches, shape_land, tune_feel, tune_look, bake_light, build_architecture, design_plan, place_items, edit_items, query_scene, query_level, place_level_items, write_generator, write_script, request_asset, search_assets, find_model, simready_search, import_asset, inspect, run_verification, finish.`);
  if (typeof rawInput === 'string') return fail('The tool arguments were not valid JSON. Resend the call with a valid JSON object.');
  if (inputSize(rawInput) > TOOL_LIMITS.MAX_INPUT_CHARS) return fail(`Tool input too large (max ${TOOL_LIMITS.MAX_INPUT_CHARS} characters). Split it into several calls.`);
  try {
    switch (name) {
      case 'shape_land': {
        const p = ToolInputs.shape_land.safeParse(rawInput);
        return p.success ? shapeLandTool(ctx, p.data) : fail(`Invalid shape_land input: ${issuesText(p.error)}`);
      }
      case 'tune_feel': {
        const p = ToolInputs.tune_feel.safeParse(rawInput ?? {});
        return p.success ? tuneFeelTool(ctx, p.data) : fail(`Invalid tune_feel input: ${issuesText(p.error)}`);
      }
      case 'bake_light': {
        const p = ToolInputs.bake_light.safeParse(rawInput ?? {});
        return p.success ? bakeLightTool(ctx, p.data) : fail(`Invalid bake_light input: ${issuesText(p.error)}`);
      }
      case 'tune_look': {
        const p = ToolInputs.tune_look.safeParse(rawInput ?? {});
        return p.success ? tuneLookTool(ctx, p.data) : fail(`Invalid tune_look input: ${issuesText(p.error)}`);
      }
      case 'make_texture':
        return makeTextureTool(ctx, rawInput);
      case 'apply_patches': {
        const p = ToolInputs.apply_patches.safeParse(rawInput);
        return p.success ? await applyPatchesTool(ctx, p.data) : fail(`Invalid apply_patches input: ${issuesText(p.error)}`);
      }
      case 'build_architecture': {
        const p = ToolInputs.build_architecture.safeParse(rawInput);
        return p.success ? buildArchitectureTool(ctx, p.data) : fail(`Invalid build_architecture input: ${issuesText(p.error)}`);
      }
      case 'design_plan':
      case 'place_items':
      case 'edit_items':
      case 'query_scene':
        return designTool(ctx, name, rawInput ?? {});
      case 'write_generator': {
        const p = ToolInputs.write_generator.safeParse(rawInput);
        return p.success ? await writeGeneratorTool(ctx, p.data) : fail(`Invalid write_generator input: ${issuesText(p.error)}`);
      }
      case 'write_script': {
        const p = ToolInputs.write_script.safeParse(rawInput);
        return p.success ? await writeScriptTool(ctx, p.data) : fail(`Invalid write_script input: ${issuesText(p.error)}`);
      }
      case 'request_asset': {
        const p = ToolInputs.request_asset.safeParse(rawInput);
        return p.success ? await requestAssetTool(ctx, p.data) : fail(`Invalid request_asset input: ${issuesText(p.error)}`);
      }
      case 'find_model': {
        const p = ToolInputs.find_model.safeParse(rawInput);
        return p.success ? await findModelTool(ctx, p.data) : fail(`Invalid find_model input: ${issuesText(p.error)}`);
      }
      case 'simready_search': {
        const p = ToolInputs.simready_search.safeParse(rawInput);
        return p.success ? await simreadySearchTool(p.data) : fail(`Invalid simready_search input: ${issuesText(p.error)}`);
      }
      case 'import_asset': {
        const p = ToolInputs.import_asset.safeParse(rawInput);
        return p.success ? await importAssetTool(ctx, p.data) : fail(`Invalid import_asset input: ${issuesText(p.error)}`);
      }
      case 'search_assets': {
        const p = ToolInputs.search_assets.safeParse(rawInput);
        return p.success ? await searchAssetsTool(p.data) : fail(`Invalid search_assets input: ${issuesText(p.error)}`);
      }
      case 'inspect': {
        const p = ToolInputs.inspect.safeParse(rawInput ?? {});
        return p.success ? inspectTool(ctx, p.data) : fail(`Invalid inspect input: ${issuesText(p.error)}`);
      }
      case 'run_verification': {
        const v = await runVerification(ctx);
        return { content: clip(`${v.passed ? 'PASSED' : 'FAILED'}\n${v.summary}`), isError: false, events: [v.event], edited: false, verified: { passed: v.passed } };
      }
      case 'finish': {
        const p = ToolInputs.finish.safeParse(rawInput ?? {});
        const message = p.success ? p.data.message.trim() : '';
        return { content: 'Finishing; verification runs next.', isError: false, events: [], edited: false, finished: { message } };
      }
    }
  } catch (e) {
    if (ctx.signal?.aborted) throw e;
    return fail(`Tool "${name}" failed: ${errorMessage(e).slice(0, 500)}`);
  }
}
