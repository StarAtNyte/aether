/**
 * Edit versus regenerate. For each small edit request on an existing world
 * three ways of getting the edited world are compared:
 *
 *  - Aether: the real agent loop on the existing world; the model answers
 *    with a minimal patch (`apply_patches`).
 *  - Regenerate (oracle): a model that re-emits the whole edited document and
 *    gets everything right (it copies the unchanged parts perfectly). Its
 *    world is Aether's; only its cost is different. Collateral is zero by
 *    construction, so this is the best case for regeneration.
 *  - Regenerate (fresh): the same offline planner asked again from scratch
 *    with the edit folded into the description, which is what "just
 *    regenerate" does: it emits the whole scene again with a new random
 *    sample. Collateral is measured, not assumed.
 */
import type { PatchInput, WorldDoc } from '@aether/core';
import type { Provider } from '@aether/agent';
import type { SandboxRunner } from '@aether/procgen';
import { isWinnableKind, playtest } from './autoplay';
import { estimateTokens, isRegression, jsonTokens, projectedLatencyMs, scoreChange, worldChanges, type CollateralReport, type EditIntent } from './metrics';
import { recordingProvider, runAgent, runVerify, worldTokens, type RunOutcome } from './world-eval';

/** Tags that are structure, not things a person would name. */
const SKIP_TAGS = new Set(['focus', 'backdrop', 'sky', 'library', 'hazard', 'character', 'npc', 'traffic', 'player-car', 'toy', 'ball', 'ground', 'water', 'path']);
const IRREGULAR: Record<string, string> = { domino: 'dominoes', cactus: 'cacti', ghost: 'ghosts' };

function plural(noun: string): string {
  const irregular = IRREGULAR[noun];
  if (irregular) return irregular;
  return /(s|x|ch|sh)$/.test(noun) ? `${noun}es` : `${noun}s`;
}

/** A kind of edit request. */
type EditKind = 'recolor' | 'bigger' | 'smaller' | 'remove' | 'glow' | 'add' | 'night' | 'rain';

/** One edit request with its oracle intent. */
export interface EditCase {
  id: string;
  baseId: string;
  kind: EditKind;
  request: string;
  intent: EditIntent;
  noun?: string;
}

const COLOR_PATHS = [/^material\.color$/, /^shape\.params\.color$/, /^shape\.of\.params\.color$/];
// A resize is either the transform scale or, for shapes sized by their own parameters (a tree's height, a rock's size), that parameter.
const SCALE_PATHS = [/^transform\.scale\.[012]$/, /^transform\.position\.1$/, /^shape\.params\.(size|height|radius|width|depth|length|scale)(\.[012])?$/];
const GLOW_PATHS = [/^material\.emissive/, /^shape\.params\.emissive/];

/** Things a person names in a world: top-level entity tags with 2..40 instances, most frequent first. */
export function namedThings(world: WorldDoc): Array<{ noun: string; ids: string[] }> {
  const top = Object.values(world.entities).filter((e) => e.parent === null);
  const nouns = new Set<string>();
  for (const e of top) for (const t of e.tags) if (!SKIP_TAGS.has(t) && /^[a-z]{3,12}$/.test(t)) nouns.add(t);
  return [...nouns]
    .map((noun) => ({ noun, ids: top.filter((e) => isA(e, noun)).map((e) => e.id) }))
    .filter((t) => t.ids.length >= 2 && t.ids.length <= 40)
    .sort((a, b) => b.ids.length - a.ids.length || a.noun.localeCompare(b.noun));
}

/**
 * "Is this a noun?" as a person reading the outliner would say it: the noun
 * starts a word in the entity's id, name, tags, generator (also inside a
 * scatter) or primitive.
 */
export function isA(e: WorldDoc['entities'][string], noun: string): boolean {
  const gen = e.shape.kind === 'procedural' ? e.shape.generator : e.shape.kind === 'scatter' && e.shape.of.kind === 'procedural' ? e.shape.of.generator : '';
  const prim = e.shape.kind === 'primitive' ? e.shape.primitive : '';
  const text = [e.id, e.name, e.tags.join(' '), gen, prim].join(' ').toLowerCase();
  return new RegExp(`(^|[^a-z])${noun}`).test(text);
}

/** Build the edit cases for one base world (deterministic). `limit` caps the number per world. */
export function editsFor(baseId: string, world: WorldDoc, limit = 9): EditCase[] {
  const things = namedThings(world);
  const out: EditCase[] = [];
  const push = (c: Omit<EditCase, 'id' | 'baseId'>): void => {
    out.push({ ...c, id: `${baseId}-${String(out.length + 1).padStart(2, '0')}`, baseId });
  };
  const [a, b, c] = things;
  if (a) {
    push({ kind: 'recolor', noun: a.noun, request: `make all the ${plural(a.noun)} red`, intent: { targets: a.ids, allowedPaths: COLOR_PATHS } });
    push({ kind: 'bigger', noun: a.noun, request: `make all the ${plural(a.noun)} bigger`, intent: { targets: a.ids, allowedPaths: SCALE_PATHS } });
  }
  if (b) {
    push({ kind: 'recolor', noun: b.noun, request: `paint all the ${plural(b.noun)} blue`, intent: { targets: b.ids, allowedPaths: COLOR_PATHS } });
    push({ kind: 'remove', noun: b.noun, request: `remove all the ${plural(b.noun)}`, intent: { targets: b.ids, expectRemoved: b.ids } });
  }
  if (c) {
    push({ kind: 'smaller', noun: c.noun, request: `make all the ${plural(c.noun)} smaller`, intent: { targets: c.ids, allowedPaths: SCALE_PATHS } });
    push({ kind: 'glow', noun: c.noun, request: `make all the ${plural(c.noun)} glow`, intent: { targets: c.ids, allowedPaths: GLOW_PATHS, allowedSections: { environment: [/^bloom$/] } } });
  }
  // Edits that would be no-ops (already night, already raining) are not asked.
  const env = world.environment;
  const tod = env.timeOfDay;
  const alreadyNight = env.sky === 'night' || (tod !== undefined && (tod >= 21 || tod <= 4));
  if (!alreadyNight) push({ kind: 'night', request: 'make it night', intent: { targets: [], requireSections: ['environment'], allowedSections: { environment: [/./] } } });
  push({ kind: 'add', request: 'add 3 rocks', intent: { targets: [], expectAdded: { min: 1, match: /./ } } });
  if (env.weather !== 'rain') push({ kind: 'rain', request: 'make it rain', intent: { targets: [], requireSections: ['environment'], allowedSections: { environment: [/./] } } });
  if (out.length <= limit) return out;
  // A smaller sample keeps the mix of edit kinds: evenly spaced picks.
  return Array.from({ length: limit }, (_, i) => out[Math.floor((i * out.length) / limit)] as EditCase);
}

/** Result of one way of making one edit. */
export interface EditArm {
  /** The requested change happened. */
  satisfied: boolean;
  /** Tokens the model emitted. */
  outputTokens: number;
  /** Tokens the model read (summary or whole document, plus the request). */
  inputTokens: number;
  /** Patch operations in the answer. */
  patchOps: number;
  /** Entities the answer rewrites (patch ops that touch an entity, or the whole scene). */
  entitiesTouched: number;
  /** Measured local compute (planner, apply, verify), ms. */
  localMs: number;
  /** Local compute plus generation time at the assumed rate, ms. */
  projectedMs: number;
  collateral: CollateralReport;
  /** Verification passed before / after. */
  verifyBefore: boolean;
  verifyAfter: boolean;
  /** Verification regression. */
  verifyRegression: boolean;
  /** The bot could win before / after (null for worlds without a win condition). */
  winnableBefore: boolean | null;
  winnableAfter: boolean | null;
  /** The bot could win before and cannot afterwards. */
  playRegression: boolean;
}

/** One edit case with all arms. */
export interface EditRow {
  case: EditCase;
  baseEntities: number;
  aether: EditArm;
  regenOracle: EditArm;
  regenFresh: EditArm;
}

/** Context shared by the study (base worlds are verified and played once). */
export interface BaseState {
  id: string;
  prompt: string;
  world: WorldDoc;
  verified: boolean;
  winnable: boolean | null;
}

/** Prepare a base: its prompt, generated world, verdicts. */
export async function prepareBase(id: string, prompt: string, world: WorldDoc): Promise<BaseState> {
  const verified = (await runVerify(world)).passed;
  const winnable = isWinnableKind(world) ? (await playtest(world)).won : null;
  return { id, prompt, world, verified, winnable };
}

function touched(patches: readonly PatchInput[]): number {
  const ids = new Set<string>();
  for (const p of patches) {
    const q = p as { op: string; id?: string; entity?: { id?: string } };
    if (q.id) ids.add(q.id);
    else if (q.entity?.id) ids.add(q.entity.id);
    else if (q.op === 'clear') ids.add('*');
  }
  return ids.size;
}

async function judge(base: BaseState, after: WorldDoc, verifiedAfter: boolean | undefined, intent: EditIntent): Promise<Pick<EditArm, 'satisfied' | 'collateral' | 'verifyBefore' | 'verifyAfter' | 'verifyRegression' | 'winnableBefore' | 'winnableAfter' | 'playRegression'>> {
  const collateral = scoreChange(worldChanges(base.world, after), intent);
  const verifyAfter = verifiedAfter ?? (after === base.world ? base.verified : (await runVerify(after)).passed);
  let winnableAfter: boolean | null = null;
  if (base.winnable !== null) winnableAfter = after === base.world ? base.winnable : isWinnableKind(after) ? (await playtest(after)).won : false;
  return {
    satisfied: collateral.satisfied,
    collateral,
    verifyBefore: base.verified,
    verifyAfter,
    verifyRegression: isRegression({ before: base.verified, after: verifyAfter }),
    winnableBefore: base.winnable,
    winnableAfter,
    playRegression: base.winnable !== null && winnableAfter !== null ? isRegression({ before: base.winnable, after: winnableAfter }) : false,
  };
}

/** Assumed generation speed for the projected latency (tokens per second of a hosted model). */
export const ASSUMED_TOKENS_PER_SECOND = 60;

/** Run one edit case through all three arms. */
export async function runEdit(base: BaseState, c: EditCase, mock: () => Provider, sandbox: SandboxRunner): Promise<EditRow> {
  // --- Aether: the real loop on the existing world.
  const provider = recordingProvider(mock());
  const run: RunOutcome = await runAgent(c.request, { provider, sandbox, initial: base.world });
  const finalVerified = run.verdicts.length > 0 ? run.verdicts[run.verdicts.length - 1] : undefined;
  const aetherJudged = await judge(base, run.world, finalVerified, c.intent);
  const aether: EditArm = {
    ...aetherJudged,
    outputTokens: run.outputTokens,
    inputTokens: run.inputTokens,
    patchOps: run.patches.length,
    entitiesTouched: touched(run.patches),
    localMs: run.ms,
    projectedMs: projectedLatencyMs(run.ms, run.outputTokens, ASSUMED_TOKENS_PER_SECOND),
  };

  // --- Regenerate (oracle): re-emit the whole edited document, copied perfectly.
  const doc = worldTokens(run.world);
  const oracleVerifyStart = performance.now();
  await runVerify(run.world);
  const oracleLocal = performance.now() - oracleVerifyStart;
  const oracleScored = scoreChange(worldChanges(base.world, run.world), c.intent);
  const regenOracle: EditArm = {
    satisfied: aether.satisfied,
    outputTokens: doc,
    inputTokens: worldTokens(base.world) + estimateTokens(c.request),
    patchOps: Object.keys(run.world.entities).length,
    entitiesTouched: Object.keys(run.world.entities).length,
    localMs: oracleLocal,
    projectedMs: projectedLatencyMs(oracleLocal, doc, ASSUMED_TOKENS_PER_SECOND),
    // Perfect copying: nothing outside the intent differs from Aether's own result.
    collateral: { ...oracleScored, completion: aether.collateral.completion, collateralLeaves: 0, collateralEntities: 0, collateralRemoved: 0, collateralAdded: 0, examples: [] },
    verifyBefore: aether.verifyBefore,
    verifyAfter: aether.verifyAfter,
    verifyRegression: aether.verifyRegression,
    winnableBefore: aether.winnableBefore,
    winnableAfter: aether.winnableAfter,
    playRegression: aether.playRegression,
  };

  // --- Regenerate (fresh): ask for the whole scene again with the edit folded in.
  const freshProvider = recordingProvider(mock());
  const freshPrompt = `${base.prompt}, and ${c.request}`;
  const fresh = await runAgent(freshPrompt, { provider: freshProvider, sandbox });
  const freshVerified = fresh.verdicts.length > 0 ? fresh.verdicts[fresh.verdicts.length - 1] : undefined;
  const freshJudged = await judge(base, fresh.world, freshVerified, c.intent);
  const regenFresh: EditArm = {
    ...freshJudged,
    outputTokens: fresh.outputTokens,
    inputTokens: fresh.inputTokens,
    patchOps: fresh.patches.length,
    entitiesTouched: Object.keys(fresh.world.entities).length,
    localMs: fresh.ms,
    projectedMs: projectedLatencyMs(fresh.ms, fresh.outputTokens, ASSUMED_TOKENS_PER_SECOND),
  };

  return { case: c, baseEntities: Object.keys(base.world.entities).length, aether, regenOracle, regenFresh };
}

export { jsonTokens };
