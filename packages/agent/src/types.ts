/**
 * Public, provider-agnostic types of @aether/agent (see docs/CONTRACTS.md).
 *
 * Every provider normalizes its wire format to these shapes so the agent loop,
 * the server proxy and the studio never depend on a vendor API.
 */
import type { GeneratorDef, Patch, PatchError, PatchResult, ScriptDef, WorldDoc } from '@aether/core';

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
}

/** A normalized completion response. */
export interface CompletionResponse {
  content: ContentBlock[];
  stopReason: 'end' | 'tool_use' | 'max_tokens' | 'error';
  usage?: { inputTokens: number; outputTokens: number };
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
  | { type: 'patches'; patches: Patch[]; message: string; result: { applied: number; errors: PatchError[] } }
  | { type: 'generator'; def: GeneratorDef; ok: boolean; error?: string }
  | { type: 'verify'; passed: boolean; summary: string; report: unknown }
  | { type: 'repair'; text: string; attempt: number }
  | { type: 'message'; text: string }
  | { type: 'error'; text: string }
  | { type: 'done'; usage: { inputTokens: number; outputTokens: number; calls: number } };

/** The environment the agent edits (studio: history + physics; tests: fakes). */
export interface AgentHost {
  getWorld(): WorldDoc;
  /** Validates and commits patches (non-atomic: valid patches apply, invalid ones are reported). */
  applyPatches(patches: unknown[], message: string): PatchResult;
  verify(world: WorldDoc): Promise<{ report: unknown; summary: string; passed: boolean }>;
  screenshot?(): Promise<string | null>;
  validateGenerator?(def: GeneratorDef): Promise<{ ok: boolean; error?: string }>;
  validateScript?(def: ScriptDef): Promise<{ ok: boolean; error?: string }>;
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
}

/** Token usage accumulated over a run. */
export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  calls: number;
}
