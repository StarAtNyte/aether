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
export { AGENT_TOOLS, COMPACT_TOOLS, LEVEL_TOOLS, LEVEL_TOOL_NAMES, isLevelToolName, PATCH_OPS, TOOL_LIMITS, type AgentToolName } from './tools';
export { buildSystemPrompt, buildCoderPrompt, buildCompactSystemPrompt, COMPACT_EXAMPLE } from './prompt';
export { PROMPT_EXAMPLES, type PromptExample } from './examples';
export { summarizeWorldForModel, type ModelSummaryOptions } from './world-text';
export { CONTEXT_LIMITS, formatUserTurn, parseUserTurn, sanitizeHistory } from './context';
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
export { protocolInstructions, renderTranscript, type RenderedPrompt } from './emulation/transcript';
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
export type { PhotoPhase, PhotoAssumptionView, PhotoScoreView, PhotoReadsView, PhotoOptions } from './types';
