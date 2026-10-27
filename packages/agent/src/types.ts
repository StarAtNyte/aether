/**
 * Public, provider-agnostic types of @aether/agent (see docs/CONTRACTS.md).
 *
 * Every provider normalizes its wire format to these shapes so the agent loop,
 * the server proxy and the studio never depend on a vendor API.
 */
import type { Provenance } from './photo/stages';
import type { EntityId, GeneratorDef, Patch, PatchError, PatchResult, ScriptDef, TextureSetDef, TextureTier, WorldDoc } from '@aether/core';
import type { TextureContext } from './textures';
import type { ConversationStore } from './conversation';
import type { DiffLine } from './refine/describe';
import type { RefineMemory } from './refine/memory';

/** One block of message content. Images travel as `data:` URLs. */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; dataUrl: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean };

/** A chat turn. `content` may be plain text or structured blocks. */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

/** A function tool exposed to the model. `inputSchema` is a JSON Schema object. */
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: object;
}

/** Which model tier a request is for; servers map roles to allowlisted models. */
export type ModelRole = 'planner' | 'coder' | 'critic';

/** A normalized completion request. */
export interface CompletionRequest {
  role: ModelRole;
  /** Optional explicit model id (server-side only; proxies ignore it). */
  model?: string;
  system: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  maxTokens?: number;
  /** Advisory only: current reasoning models reject sampling parameters, so providers may ignore it. */
  temperature?: number;
  /** Advisory sampling seed (judges use a fixed one per seat); sent only by providers whose API takes it. */
  seed?: number;
  /**
   * Conversation key (per project): backends that keep threads (Codex,
   * Claude Code) resume the same conversation and receive only what is new.
   * Other providers ignore it.
   */
  session?: string;
}

/** A normalized completion response. */
export interface CompletionResponse {
  content: ContentBlock[];
  stopReason: 'end' | 'tool_use' | 'max_tokens' | 'error';
  /**
   * Tokens of this one call. `inputTokens` counts everything the model read (cached or not);
   * `cachedInputTokens` is the part served from the provider's prompt cache, when it says.
   */
  usage?: { inputTokens: number; outputTokens: number; cachedInputTokens?: number };
  model?: string;
}

/** A language-model backend. Implementations must honour `signal`. */
export interface Provider {
  readonly name: string;
  complete(req: CompletionRequest, signal?: AbortSignal): Promise<CompletionResponse>;
}

/** Progress events streamed by {@link WorldAgent.run}. */
export type AgentEvent =
  | { type: 'status'; text: string }
  | { type: 'plan'; text: string }
  /** The generation brief of a world built from a text prompt (the plan the build follows), with the reference-image decision. */
  | { type: 'brief'; view: import('./brief').BriefView }
  | { type: 'patches'; patches: Patch[]; message: string; result: { applied: number; errors: PatchError[] } }
  | { type: 'generator'; def: GeneratorDef; ok: boolean; error?: string }
  | { type: 'verify'; passed: boolean; summary: string; report: unknown }
  | { type: 'repair'; text: string; attempt: number }
  | { type: 'message'; text: string }
  | { type: 'review'; round: number; phase: ReviewPhase; text: string; score?: number; findings?: number; differences?: PhotoDifferenceView[] }
  /** Progress of a room rebuilt from a photograph: reading it, the assumptions, each compare round, the final score. */
  | { type: 'photo'; phase: PhotoPhase; text: string; round?: number; assumptions?: PhotoAssumptionView[]; score?: PhotoScoreView; palette?: string[]; reads?: PhotoReadsView; differences?: PhotoDifferenceView[]; objects?: PhotoObjectView[]; stages?: PhotoStageView[]; provenance?: Provenance; resume?: PhotoResumeState; measured?: PhotoMeasuredView }
  /** A small edit applied locally (no model call): what changed, as a compact diff. */
  | { type: 'edit'; summary: string; diff: DiffLine[]; targets: EntityId[]; cosmetic: boolean; notes: string[]; ms: number; local: boolean }
  /** The request is ambiguous: the candidates to choose from (the host highlights them). */
  | { type: 'clarify'; text: string; candidates: Array<{ id: EntityId; label: string }> }
  /** "undo that" / "redo": the host steps its history. */
  | { type: 'history'; action: 'undo' | 'redo' }
  /** Conversation memory for the next prompt ("it", "the same", "the other one"). */
  | { type: 'memory'; memory: RefineMemory }
  /**
   * One step the agent took (a tool call, or a look at images), for the step list. `looked` carries what the model was
   * shown (full-size data URLs: the host makes thumbnails and never stores them).
   */
  | { type: 'step'; tool: string; label: string; ok: boolean; looked?: Array<{ label: string; dataUrl: string }> }
  /** A message the user queued while the run worked was handed to the model. */
  | { type: 'steer'; text: string }
  | { type: 'error'; text: string }
  | { type: 'done'; usage: { inputTokens: number; outputTokens: number; calls: number; cachedInputTokens?: number; models?: string[] } };

/** The measured comparison of a round (rows per object, surfaces, counts, coverage), for the run record. */
export interface PhotoMeasuredView {
  rows: Array<{ id: string; label: string; perceivedId: string; verdict: string; iou: number | null; deltaE: number | null; offsetM: number | null; sizeRatio: { w: number; h: number } | null; linked?: string }>;
  surfaces: Array<{ surface: string; deltaE: number | null; rawDeltaE?: number | null }>;
  counts: Record<string, number>;
  coverage: { linked: number; perceived: number };
}

/** Where the review loop is: looking, found problems, fixing, finished (approved, stalled or out of rounds). */
export type ReviewPhase = 'checking' | 'found' | 'fixing' | 'approved' | 'stalled' | 'limit' | 'crosscheck';

/** One difference between the reference and the render, as the model that looked at both wrote it. */
export interface PhotoDifferenceView {
  id: string;
  kind: string;
  where: string;
  what: string;
  /** 1..5 (5: obvious at first glance); 0 once fixed. */
  size: number;
  status: string;
  /** Rounds it has been open. */
  rounds: number;
  /** The model that fixes, or the independent check at the end. */
  source: 'model' | 'independent' | 'object';
}

/** One object of the photo's inventory with the verdict of the judges on each aspect (the per-object table of the step feed). */
export interface PhotoObjectView {
  id: string;
  label: string;
  kind: string;
  present: 'pass' | 'close' | 'fail' | 'unclear' | 'na' | 'unjudged';
  type: 'pass' | 'close' | 'fail' | 'unclear' | 'na' | 'unjudged';
  position: 'pass' | 'close' | 'fail' | 'unclear' | 'na' | 'unjudged';
  size: 'pass' | 'close' | 'fail' | 'unclear' | 'na' | 'unjudged';
  material: 'pass' | 'close' | 'fail' | 'unclear' | 'na' | 'unjudged';
  /** The fix hint of the judges, or the reason the model gave for leaving it. */
  note: string;
  /** Which of the two independent inventories listed it. */
  seen: 'both' | 'primary' | 'blind' | 'measured';
  /** The model's stated reason for leaving a failing aspect (empty otherwise). */
  waived?: string;
  /** "stopped: ..." when the loop ended (plateau or round cap) with this object still off. */
  stopped?: string;
}

/** One stage of the staged photo flow, as the chat shows it (a checklist with ticks). */
export interface PhotoStageView {
  id: string;
  title: string;
  status: 'pending' | 'active' | 'passed' | 'failed' | 'blocked' | 'skipped';
  /** The model's evidence for the verdict, or the reason of a skip or block. */
  note?: string;
}

/**
 * What a later turn needs to continue a run (the repair stage) where it stopped: carried on the last `photo` event, kept by
 * the host with the project, sent back as `PhotoOptions.resume`.
 */
export interface PhotoResumeState {
  version: 1;
  /** The photo's SHA-256: a resume applies only to the same photo. */
  sha256: string | null;
  /** The room description the world was built from, and the built ids of its openings. */
  description: unknown;
  openings: Record<string, string>;
  stages: unknown;
  assumptions: unknown;
  differences: unknown;
  /** The object inventory ledger (see photo/objects.ts), so a continued run does not list the photo again or forget a failing object. */
  objects?: unknown;
  /** The perception report (see photo/perception/perceive.ts, version 1): measured evidence, kept with the run. */
  perception?: unknown;
  repairs: Array<{ round: number; difference: string; cause: string; why: string }>;
  rounds: number;
}

/** Where the photo flow is. */
export type PhotoPhase = 'analysing' | 'described' | 'building' | 'built' | 'textures' | 'stage' | 'comparing' | 'round' | 'done' | 'offline' | 'unavailable';

/** One assumption of a reconstruction, with the sentence that changes it (the UI shows it as a chip). */
export interface PhotoAssumptionView {
  id: string;
  text: string;
  confidence: number;
  /** A prompt the user can send to correct it; empty when there is none. */
  adjust: string;
}

/** How the photo was read: independent reads merged into one description (on the `described` event). */
export interface PhotoReadsView {
  /** Reads that gave a valid description. */
  reads: number;
  /** Reads asked for. */
  asked: number;
  /** Pieces in each read. */
  items: number[];
  /** Pieces and checklist entries of the description the room is built from. */
  consensus: number;
  checklist: number;
  /** Pieces left out (seen by too few reads) and kept without every read. */
  dropped: number;
  contested: number;
  /** What the reconciliation pass changed, with its reasons. */
  reconciled: string[];
}

/** The judged state of a reconstruction against its photo. */
export interface PhotoScoreView {
  passed: number;
  total: number;
  /** passed / total. */
  rate: number;
  /** Measured fidelity sub-score of the room (0..1): deterministic measures against the photo's description and the render. Advisory evidence given to the judges, never the verdict. */
  objective?: number;
  /** The measures behind `objective` (0..1 each; see `measureFidelity`). */
  fidelity?: Partial<Record<'openings' | 'inventory' | 'placement' | 'sizes' | 'materials' | 'clearance' | 'framing' | 'similarity' | 'regionColour', number>>;
  /** Judge score 0..1: the panel's median rubric score per item, averaged (or the single judge's pass rate). */
  judge?: number;
  /** Independent judges whose answers made `judge` (absent: the single judge in the conversation). */
  judges?: number;
  /** How much the judges disagreed, 0..1. */
  spread?: number;
  /** Who judged: "panel" (independent AI judges, median per item) or "assistant" (the model that fixes the room). Measured fidelity is advisory evidence only. */
  judgedBy?: 'panel' | 'assistant';
  /** The judges' comparison of this state with the accepted one. */
  preference?: 'current' | 'previous' | 'tie';
  /** False when this state was rejected (the room went back to the accepted one). */
  accepted?: boolean;
  structuralFailed: boolean;
  /** Items that still differ: id, what to look for, and what differs. */
  failing: Array<{ id: string; text: string; note: string }>;
}

/** One image the review loop wants rendered, with the numbered marks to draw on it. */
export interface ReviewViewRequest {
  /** Stable name ("bedroom-wall-north"). */
  name: string;
  /** What it shows, for the model. */
  label: string;
  kind: 'corner' | 'wall' | 'plan' | 'exterior';
  /** World-space camera. */
  pose: { position: [number, number, number]; target: [number, number, number]; up: [number, number, number]; fov: number };
  /** Hide ceilings and roofs for this view (a plan from above). */
  hideTops: boolean;
  /** Image aspect (width / height) the marks were projected for. */
  aspect: number;
  /** Numbered boxes in normalised image coordinates (centre and half size, origin top-left). */
  marks: Array<{ n: number; x: number; y: number; w: number; h: number }>;
  /** Advisory shapes (door swing arcs, approach zones, walking paths) in normalised image coordinates; drawn under the marks. */
  overlays?: Array<{ kind: 'swing' | 'approach' | 'path' | 'blocked'; closed: boolean; label: string; pts: Array<[number, number]> }>;
}

/** The environment the agent edits (studio: history + physics; tests: fakes). */
export interface AgentHost {
  getWorld(): WorldDoc;
  /** Validates and commits patches (non-atomic: valid patches apply, invalid ones are reported). */
  applyPatches(patches: unknown[], message: string): PatchResult;
  /** Verify `world` (the optional signal is the run's abort signal; additive). */
  verify(world: WorldDoc, opts?: { signal?: AbortSignal }): Promise<{ report: unknown; summary: string; passed: boolean }>;
  screenshot?(): Promise<string | null>;
  /**
   * Entities the user edited by hand recently (property paths, newest
   * first). They are marked in the world summary so "the tower I just
   * moved" resolves and hand edits are kept unless the user asks.
   */
  userEdits?(): ReadonlyMap<EntityId, { paths: readonly string[]; age: number }>;
  validateGenerator?(def: GeneratorDef): Promise<{ ok: boolean; error?: string }>;
  validateScript?(def: ScriptDef): Promise<{ ok: boolean; error?: string }>;
  /**
   * Render the requested review views of the current world with their numbered marks drawn on
   * (the host draws; coordinates are normalised). Returns the images it could make, in any order.
   */
  captureReview?(views: readonly ReviewViewRequest[], opts?: { signal?: AbortSignal; size?: number }): Promise<Array<{ name: string; dataUrl: string }>>;
  /**
   * Lay image tiles side by side in one picture (each tile cropped to `box` = [x0,y0,x1,y1] in 0..1 when given, scaled to a
   * common height; the longer side at most `maxSide`). Null when it cannot be drawn. Used by the photo compare turn's
   * `look_closer` (photo and render crops, whole-picture side by side).
   */
  composeImages?(tiles: ReadonlyArray<{ dataUrl: string; box?: readonly [number, number, number, number] }>, opts?: { maxSide?: number }): Promise<string | null>;
  /**
   * Decode an image data URL to pixels, reduced to at most `maxSide` pixels on its longer side (the photo flow
   * measures the aspect of a photo and compares it with renders). Null when it cannot be decoded.
   */
  decodeImage?(dataUrl: string, maxSide: number): Promise<{ width: number; height: number; data: Uint8ClampedArray | Uint8Array } | null>;
  /**
   * Keep a texture set (record and encoded maps) in the project's asset store and make it drawable. Resolves with the reason
   * when it cannot (caps, no store).
   */
  storeTexture?(set: { id: string; def: TextureSetDef; files: ReadonlyArray<{ tier: TextureTier; map: 'albedo' | 'orm' | 'normal'; bytes: Uint8Array }> }): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Encode `size x size` RGBA8 pixels as WebP (or PNG) for the store; `quality` 0..1. */
  encodeTextureMap?(rgba: Uint8Array, size: number, map: 'albedo' | 'orm' | 'normal', quality: number): Promise<Uint8Array> | Uint8Array;
}

/** Catalog data injected into prompts (procgen + logic export these). */
export interface AgentCatalogs {
  generators: unknown[];
  behaviors: unknown[];
  ruleDocs: string;
  generatorApiDts: string;
  generatorExamples: unknown[];
  scriptApiDts: string;
  /**
   * Generator-library entries (same shape as `generators`). They are listed
   * in the prompt and used like built-ins; the host defines one in the world
   * on first use through `AgentOptions.resolveGenerator`.
   */
  libraryGenerators?: unknown[];
  /**
   * Compact summary of the asset library (@aether/assets `catalogSummary`):
   * categories with example ids. Empty or absent when no library is available.
   */
  assetSummary?: string;
}

/** Options for {@link WorldAgent}. */
export interface AgentOptions {
  provider: Provider;
  /** Automatic repair rounds after a failed verification (default 2). */
  maxRepairs?: number;
  /** Maximum model calls in the main loop (default 8). */
  maxTurns?: number;
  /** Maximum tool executions per run (default 48). */
  maxToolCalls?: number;
  /** Output token cap per planner call (default 16000). */
  maxTokens?: number;
  catalogs: AgentCatalogs;
  /**
   * Definition of a library generator by id (null when unknown). Called
   * before patches that reference an undefined generator are applied.
   */
  resolveGenerator?: (id: string) => Promise<GeneratorDef | null>;
  /**
   * Build a custom generator with an agentic worker (a coding agent that
   * iterates in a sandboxed workspace with a checker) instead of one
   * single-shot coder call. The returned definition is untrusted: it goes
   * through the host's `validateGenerator` like any other.
   */
  buildAsset?: (spec: AssetBuildSpec, signal?: AbortSignal) => Promise<AssetBuildResult>;
  /**
   * Prompt profile (default 'full'). 'compact' is for small models with a
   * ~4k-token context (on-device): a condensed system prompt, only the
   * apply_patches and finish tools, a shorter world summary and history,
   * and a smaller output cap.
   */
  promptProfile?: PromptProfile;
  /**
   * Handle small edits locally, without a model round trip, and refuse model
   * patches that touch unrelated entities (default true). Off only for
   * measuring the unassisted planner.
   */
  fineEdit?: boolean;
  /**
   * Handle small edits locally (default: the value of `fineEdit`). Off in the
   * model-path tests, which exercise the guard without the fast path.
   */
  localEdits?: boolean;
  /**
   * Review loop after every generation and edit that leaves a building in the world: the model looks at
   * the checker's findings (and rendered views when it can see), fixes with the design tools, and repeats
   * until it declares the result right or progress stalls. Absent: no review.
   */
  review?: ReviewOptions;
  /**
   * Level tools for games and outdoor worlds (`query_level`, `place_level_items`): the assistant decides
   * where things go, this runner measures ground, clearance, sight lines and reach. Supplied by hosts that
   * can run physics (`runLevelTool` of @aether/playtest). Absent: the two tools are not offered.
   */
  levelTools?: LevelToolRunner;
  /**
   * Textures (`make_texture`): the image model to draw with (null: none connected, the photo and library paths still work) and,
   * when the room was read from a photograph, that photograph. Supplied by hosts that can store pictures (`AgentHost.storeTexture`).
   * Absent: the tool is not offered.
   */
  textures?: TextureContext;
  /**
   * Where the conversation of a run with a `session` key is kept for the next run of that project (default: one
   * store per page or process). The next run appends to it, with what changed in the scene instead of a full
   * summary, so a backend that keeps threads resumes the same thread.
   */
  conversations?: ConversationStore;
  /**
   * Rooms from photographs. Without it a prompt with a picture goes through the normal planner. `vision` says
   * whether the active assistant can see images (a function is asked at every call: the active one can change);
   * `maxRounds` caps the compare rounds: leave it unset on subscription backends (the loop ends when the judges and
   * the model are satisfied or progress stalls), set a high finite number for paid keys.
   */
  photo?: PhotoOptions;
  /**
   * The brief step of a world built from a text prompt (see `brief.ts`): the model first writes what the space must contain,
   * the build follows it as a checklist and the review compares the result with it. Absent: no brief (the planner as before).
   * `webSearch`: the provider can search the web (ideas in text only). The reference image needs `textures.images`.
   */
  brief?: { webSearch?: boolean };
}

/** Options of the room-from-photo flow. */
export interface PhotoOptions {
  vision?: boolean | (() => boolean);
  /**
   * Most compare-and-correct rounds. Unset (or Infinity): no fixed ceiling, the loop ends when every item matches, the
   * model has nothing left to change, or progress stalls (a safety ceiling of 200 rounds stops a
   * runaway). Set a high finite number on paid API keys.
   */
  maxRounds?: number;
  /**
   * Independent reads of the photo merged into one description (majority per piece, median positions and sizes).
   * Default 3; 1 is a single read (the studio's setting on a paid key, like `judges`).
   */
  reads?: number;
  /** After merging several reads, one call settles the contested pieces against the photo (default true). */
  reconcile?: boolean;
  /** Rounds without progress before the loop stops (default 3). */
  stallRounds?: number;
  /** Most images per compare round (default 3). */
  maxViews?: number;
  /**
   * Independent judges scoring each render with the fixed rubric (median per item, relative comparison with the
   * accepted state). Default 3; 0 leaves the judging to the model doing the fixes (one call per round, noisier).
   */
  judges?: number;
  /**
   * The differences ledger (default false; the studio turns it on): each round the model also writes a ranked list of
   * what still differs (`report_differences`), fixes the largest first, and must confirm on the next render that the
   * exact difference shrank; what is still open at the end is listed in the closing message.
   */
  differences?: boolean;
  /** Zoomed side-by-side crops per round (0..8, default 4) when the host can crop and compose images. */
  crops?: number;
  /**
   * After the compare rounds, one independent seat with fresh eyes (no conversation) compares the photo and the final
   * render and lists what still differs (default false; the studio turns it on). It records, it does not fix.
   */
  crossCheck?: boolean;
  /**
   * The object inventory and per-object judge (default false; the studio turns it on; needs the differences ledger): the model
   * lists every element the photo shows (a second blind seat lists it too and the lists are reconciled), a panel judges each
   * object on presence, type, position, size and material against the render from the photo camera, the failing aspects
   * become differences, and the loop goes on until every object passes or the model states a reason for it.
   */
  objects?: boolean;
  /**
   * Perception (default ON when the host can decode images; false turns it off):  specialised vision models measure the photo (open-vocabulary detection, masks,
   * metric depth, room box, per-object colour and place) and the numbers go to the model as advisory evidence: with the first reading,
   * through the `perceive_photo` tool, and into the object inventory. Models are fetched on first use; offline the layer is simply absent.
   */
  perception?: boolean;
  /** Build from the perception report (default ON when perception ran): a plan of every measured object, settled by the model, placed in one batch and linked in the ledger. false: the description's build only. */
  measuredBuild?: boolean;
  /** Most object rounds in one run of the object loop (default 12). "Keep refining" (a continued run) starts a new count. The loop also ends when 3 rounds in a row raised neither the pass rate nor lowered the open count. */
  objectRounds?: number;
  /**
   * The staged harness (default false; the studio turns it on): stage verdicts the model gives (`stage_gate`), repairs in the
   * order camera, geometry, materials, lighting (`declare_repair`, `set_photo_camera`), an assumptions ledger and a provenance
   * record. Switches the differences ledger on.
   */
  harness?: boolean;
  /** What the user said about the right to use the photo (goes into the provenance record). */
  permission?: string;
  /** A run to continue (see {@link PhotoResumeState}). */
  resume?: PhotoResumeState;
}

/** Result of one level tool call (patches commit as one undo step). */
export interface LevelToolOutput {
  ok: boolean;
  text: string;
  patches: unknown[];
  message: string;
  /** Structured result of a level review (`query_level` op "review"): validated by the agent before use. */
  data?: unknown;
}

/** Runs a level tool against a world. Never throws except for cancellation. */
export type LevelToolRunner = (world: WorldDoc, name: 'query_level' | 'place_level_items', input: unknown) => Promise<LevelToolOutput>;

/** Options of the review loop. */
export interface ReviewOptions {
  /**
   * Most review rounds. Leave unset (or Infinity) on subscription backends, where calls are not metered:
   * the loop then ends only when the model approves or progress stalls. Set a high finite number for
   * paid API keys.
   */
  maxRounds?: number;
  /** Rounds without progress (same findings, no gain) before the loop stops (default 3). */
  stallRounds?: number;
  /** The model can look at images: render the views with numbered marks. A function is asked every round (the active assistant can change). */
  vision?: boolean | (() => boolean);
  /** Images per round (default 6, at most 8). */
  maxViews?: number;
  /**
   * The differences ledger (default false; the studio turns it on): each round the model compares the renders with the
   * request (and any reference pictures) point by point, writes a ranked list of the gaps (`report_differences`), fixes
   * the largest first and confirms on the next render that the exact gap shrank; what is open at the end is named.
   */
  differences?: boolean;
  /** After the loop, one independent seat with fresh eyes compares the final renders with the request and lists the gaps (default false; the studio turns it on). */
  crossCheck?: boolean;
}

/** Size of the planner prompt: everything, or a condensed form for small models. */
export type PromptProfile = 'full' | 'compact';

/** Token usage accumulated over a run. */
export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  calls: number;
  /** Part of `inputTokens` read from the provider's prompt cache (absent: none reported). */
  cachedInputTokens?: number;
  /** Models that actually answered (as reported by the provider), in order of first use. */
  models?: string[];
}

/** What {@link AgentOptions.buildAsset} is asked to build. */
export interface AssetBuildSpec {
  /** Generator id to define (lowercase slug). */
  id: string;
  description: string;
  paramsHint?: string;
}

/** Result of {@link AgentOptions.buildAsset}: the generator (validated again by the host), or why it failed. */
export type AssetBuildResult = { ok: true; def: GeneratorDef; note?: string } | { ok: false; error: string };
