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
  ChatMessage,
  CompletionRequest,
  CompletionResponse,
  ContentBlock,
  ModelRole,
  PromptProfile,
  Provider,
  ToolDef,
  UsageTotals,
} from './types';

export { WorldAgent, COMPACT_LIMITS, type RunOptions } from './agent';
export { AGENT_TOOLS, COMPACT_TOOLS, PATCH_OPS, TOOL_LIMITS, type AgentToolName } from './tools';
export { buildSystemPrompt, buildCoderPrompt, buildCompactSystemPrompt, COMPACT_EXAMPLE } from './prompt';
export { PROMPT_EXAMPLES, type PromptExample } from './examples';
export { CONTEXT_LIMITS, formatUserTurn, parseUserTurn, sanitizeHistory } from './context';
export { SUBMIT_GENERATOR_TOOL, requestGenerator, type CoderDeps, type CoderResult } from './coder';
export { CompletionRequestSchema, CompletionResponseSchema, ContentBlockSchema, ChatMessageSchema, ToolDefSchema, WIRE_LIMITS } from './wire';

export { createAnthropicProvider, type AnthropicProviderOptions, type AnthropicEffort } from './providers/anthropic';
export { createOpenAIProvider, type OpenAIProviderOptions, type OpenAIEffort } from './providers/openai';
export { createHttpProvider, type HttpProviderOptions } from './providers/http';
export { createMockProvider, type MockProviderOptions } from './providers/mock/index';
export type { MockLibraryItem } from './providers/mock/library';
export { ProviderError, isAbortError, type ProviderErrorCode } from './providers/errors';
export type { RetryPolicy } from './providers/transport';

// Zero-cost AI connections: tool-use emulation for text-only backends, the local bridge, on-device models, fallback.
export { createEmulatedProvider, type EmulatedProviderOptions, type TextBackend, type TextCompletionRequest, type TextCompletionResult, type TextEffort } from './emulation/provider';
export { EMULATION_LIMITS, EmulatedReplySchema, parseEmulatedReply, replyJsonSchema, type JsonSchemaObject, type ParsedReply } from './emulation/protocol';
export { protocolInstructions, renderTranscript, type RenderedPrompt } from './emulation/transcript';
export { extractJsonObject } from './emulation/json';
export * from './bridge/protocol';
export { BRIDGE_COMPLETE_TIMEOUT_MS, BRIDGE_PROBE_TIMEOUT_MS, createBridgeProvider, fetchBridgeStatus, pairBridge, type BridgeProviderOptions } from './bridge/client';
export { createFallbackProvider, type FallbackNotice, type FallbackProvider, type FallbackProviderOptions } from './providers/fallback';
export { createWebLlmBackend, createWebLlmProvider, type WebLlmEngineLike, type WebLlmProviderOptions } from './providers/webllm';
export { errorMessage } from './providers/errors';
export * from './quality/index';
