/**
 * @aether/agent — provider-agnostic LLM orchestration that turns natural
 * language into verified World IR edits. Runs in Node (server) and in the
 * browser (via the HTTP proxy provider). No three.js, no DOM.
 */
export type {
  AgentCatalogs,
  AgentEvent,
  AgentHost,
  AgentOptions,
  LevelToolOutput,
  LevelToolRunner,
  ChatMessage,
  CompletionRequest,
  CompletionResponse,
  ContentBlock,
  ModelRole,
  PromptProfile,
  Provider,
  ToolDef,
  UsageTotals,
  AssetBuildSpec,
  ImportAssetRequest,
  ImportAssetResult,
  AssetBuildResult,
  ReviewOptions,
  ReviewPhase,
  ReviewViewRequest,
} from './types';

export { WorldAgent, COMPACT_LIMITS, SLICE_THRESHOLD, type RunOptions } from './agent';
// The small-edit engine loads lazily (see ./refine/runtime); only its light data types and helpers are exported statically.
export { EMPTY_MEMORY, type RefineMemory } from './refine/memory';
export { diffLineText, type DiffLine } from './refine/diff-text';
export type { Command, Ref, Look, EnvIntent } from './refine/command';
export type { FineEditResult, FineEditInput, FineCatalogs, DeclineReason } from './refine/plan';
export type { RequestScope, PatchAudit } from './refine/guard';
export { MAKE_TEXTURE_TOOL, MakeTextureInput, makeTextureTool, resolveTarget as resolveTextureTarget, dominantPart, type PhotoSource, type TextureContext } from './textures';
export { createOpenAiImageGenerator, createBridgeImageGenerator, imageChain, texturePrompt, isImageDataUrl as isGeneratedImage, type ImageGenerator, type ImageRequest, type GeneratedImage } from './images';
export { AGENT_TOOLS, COMPACT_TOOLS, LEVEL_TOOLS, LEVEL_TOOL_NAMES, isLevelToolName, PATCH_OPS, TOOL_LIMITS, type AgentToolName } from './tools';
export { lookPatches, lookText, currentLook, TuneLookInput, LOOK_RESET_KEYS, type LookEditResult, type LookResetKey } from './look-edit';
export { bakePatches, bakeText, BakeLightInput, BAKE_QUALITIES } from './bake-edit';
export { feelPatches, mergeFeel, feelTierFor, defaultEmitterPatches, isGameWorld, TuneFeelInput, FeelEmitterInput, MAX_FEEL_TARGETS, type FeelEditResult } from './feel-edit';
export { buildSystemPrompt, buildCoderPrompt, buildCompactSystemPrompt, COMPACT_EXAMPLE } from './prompt';
export { PROMPT_EXAMPLES, type PromptExample } from './examples';
export { summarizeWorldForModel, type ModelSummaryOptions } from './world-text';
export { CONVERSATION_BUDGET_CHARS, ConversationStore, conversationChars, sharedConversations, type ConversationState } from './conversation';
export { sceneChangesText, type SceneDiffLimits } from './scene-diff';
export { CONTEXT_LIMITS, formatFollowUpTurn, formatUserTurn, ghostImageKey, imageKey, limitImages, parseUserTurn, requestView, sanitizeHistory } from './context';
export { SUBMIT_GENERATOR_TOOL, requestGenerator, type CoderDeps, type CoderResult } from './coder';
export {
  forgeGenerator,
  forgeScore,
  parseCritique,
  FORGE_CRITERIA,
  FORGE_GATE,
  FORGE_LIMITS,
  FORGE_METHOD,
  type ForgeCriterion,
  type ForgeCritique,
  type ForgeDeps,
  type ForgeIteration,
  type ForgeRequest,
  type ForgeResult,
} from './forge';
export { CompletionRequestSchema, CompletionResponseSchema, ContentBlockSchema, ChatMessageSchema, ToolDefSchema, WIRE_LIMITS } from './wire';

export { createAnthropicProvider, type AnthropicProviderOptions, type AnthropicEffort } from './providers/anthropic';
export { createOpenAIProvider, type OpenAIProviderOptions, type OpenAIEffort } from './providers/openai';
export { createChatCompletionsProvider, chatMessagesToWire, parseChatCompletion, type ChatCompletionsProviderOptions } from './providers/chat-completions';
export { createHttpProvider, type HttpProviderOptions } from './providers/http';
export { createMockProvider, type MockProviderOptions } from './providers/mock/index';
export { OFFLINE_EXAMPLES } from './providers/mock/planner';
export type { MockLibraryItem } from './providers/mock/library';
export { ProviderError, isAbortError, type ProviderErrorCode } from './providers/errors';
export type { RetryPolicy } from './providers/transport';

// Zero-cost AI connections: tool-use emulation for text-only backends, the local bridge, on-device models, fallback.
export { createEmulatedProvider, type EmulatedProviderOptions, type TextBackend, type TextCompletionRequest, type TextCompletionResult, type TextEffort } from './emulation/provider';
export { EMULATION_LIMITS, EmulatedReplySchema, parseEmulatedReply, replyJsonSchema, type JsonSchemaObject, type ParsedReply } from './emulation/protocol';
export { IMAGE_PLACEHOLDER_RE, protocolInstructions, renderTranscript, resumeInput, type RenderedPrompt, type ResumeInput } from './emulation/transcript';
export { extractJsonObject } from './emulation/json';
export * from './bridge/protocol';
export * from './bridge/local-protocol';
export { BRIDGE_COMPLETE_TIMEOUT_MS, BRIDGE_PROBE_TIMEOUT_MS, createBridgeProvider, fetchBridgeStatus, pairBridge, type BridgeProviderOptions } from './bridge/client';
export { createLocalAiApi, createLocalProvider, createBridgeAccountApi, parseSseBlock, LOCAL_AI_BASE, type AiAccountApi, type LocalAiApi, type LocalProviderOptions } from './bridge/local-client';
export { createFallbackProvider, type FallbackNotice, type FallbackProvider, type FallbackProviderOptions } from './providers/fallback';
export { createWebLlmBackend, createWebLlmProvider, type WebLlmEngineLike, type WebLlmProviderOptions } from './providers/webllm';
export { errorMessage } from './providers/errors';
export * from './quality/index';
export { drawMarksRgba, MAX_RGBA_MARKS } from './review-draw';
export { StallTracker, snapshotForReview, reviewTurnText, REVIEW_ASPECT, MAX_REVIEW_VIEWS, type ReviewSnapshot, type RoundObservation, type StallVerdict } from './review';
export { createRecordingProvider, createReplayProvider, TranscriptSchema, TRANSCRIPT_LIMITS, type RecordingProvider, type Transcript } from './providers/replay';
export type { PhotoStageView, PhotoResumeState, PhotoPhase, PhotoAssumptionView, PhotoScoreView, PhotoReadsView, PhotoObjectView, PhotoOptions } from './types';
export { CallLedger, REPEAT_LIMIT, STREAK_LIMIT, budgetNote, drainSteer, guardedTool, steerText, trimToAnswered } from './harness';
export { StageMachine, RepairGuard, AssumptionsLedger, STAGES, STAGE_IDS, GATE_TOOL, REPAIR_TOOL, CAMERA_TOOL, buildProvenance, hashDataUrl, type StageId, type StageStatus, type Provenance } from './photo/stages';
export { BRIEF_TOOL, BRIEF_TOOL_NAME, BriefSchema, REFERENCE_TOOL, briefChecklistText, briefSystem, parseBrief, richnessEvidence, richnessReviewText, type Brief, type BriefView, type Elaboration, type ReferenceRecord } from './brief';
export { briefStage, lookReference, referencePrompt, type BriefReviewer, type BriefStageResult } from './brief-stage';
export type { PerceptionReport, PerceivedObject } from './photo/perception/perceive';
export { PERCEIVE_TOOL_NAME } from './photo/perception/names';
export { findAfloat, afloatFindings, findSunk, sunkFindings, withSunk, type SunkPiece } from './sunk';
export { findPlaceholders, generatorForName, placeholderFindings, withPlaceholders, PROP_GENERATORS, type Placeholder } from './placeholders';
export { findBuriedFalls, fallsFindings, withFalls, type BuriedFall } from './falls';
export { artifactFindings, findArtifacts, findBuildingsInRock, findLandEnds, findMeshClouds, findPlainPlanes, findPlantsInFalls, findSkyPieces, withArtifacts, type Artifact } from './artifacts';
export { HARDCORE_PASSES, HARDCORE_SHADER_BUDGET_PATCH, bibleText, heroShots, judgeCloser, lookCandidates, lookDistance, pictureColour, type PictureColour, lumaPercentiles, meanTargets, passPrompt, referencePrompt as heroReferencePrompt, targetEvidenceText, type HardcoreRun, type HeroShotOptions, type LumaTargets } from './hardcore';
export { GAME_CODES, GameReviewCache, gameSignature, gameStaticFindings, isReviewedGame, withGame, type GameReviewResult, type GameReviewRunner } from './game-review';
