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
  Provider,
  ToolDef,
  UsageTotals,
} from './types';

export { WorldAgent, type RunOptions } from './agent';
export { AGENT_TOOLS, PATCH_OPS, TOOL_LIMITS, type AgentToolName } from './tools';
export { buildSystemPrompt, buildCoderPrompt } from './prompt';
export { PROMPT_EXAMPLES, type PromptExample } from './examples';
export { CONTEXT_LIMITS, formatUserTurn, parseUserTurn, sanitizeHistory } from './context';
export { SUBMIT_GENERATOR_TOOL } from './coder';
export { CompletionRequestSchema, CompletionResponseSchema, ContentBlockSchema, ChatMessageSchema, ToolDefSchema, WIRE_LIMITS } from './wire';

export { createAnthropicProvider, type AnthropicProviderOptions, type AnthropicEffort } from './providers/anthropic';
export { createOpenAIProvider, type OpenAIProviderOptions, type OpenAIEffort } from './providers/openai';
export { createHttpProvider, type HttpProviderOptions } from './providers/http';
export { createMockProvider } from './providers/mock/index';
export { ProviderError, isAbortError, type ProviderErrorCode } from './providers/errors';
export type { RetryPolicy } from './providers/transport';
