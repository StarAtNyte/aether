/**
 * Dedicated coder sub-call (tool `request_asset`): asks the coder-role model
 * to write a procedural generator, validates it (schema + host sandbox), and
 * retries once with the error. Pure orchestration; the caller applies the
 * resulting `defineGenerator` patch.
 */
import { GeneratorDef } from '@aether/core';
import type { ChatMessage, CompletionResponse, Provider, ToolDef, UsageTotals } from './types';

/** The single tool offered to the coder model. */
export const SUBMIT_GENERATOR_TOOL: ToolDef = {
  name: 'submit_generator',
  description: 'Submit the finished generator. It is statically checked and test-run; errors are returned for a fix.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', pattern: '^[a-z][a-z0-9-]{1,63}$' },
      description: { type: 'string' },
      params: { type: 'object', description: 'ParamSpec map: {name: {type, default, min?, max?, options?, description?}}' },
      source: { type: 'string', description: 'Body of function generate(params, api); must return api.build().' },
    },
    required: ['id', 'description', 'params', 'source'],
    additionalProperties: false,
  },
};

/** Outcome of {@link requestGenerator}. */
export type CoderResult = { ok: true; def: GeneratorDef } | { ok: false; error: string; def?: GeneratorDef };

/** Dependencies of {@link requestGenerator}. */
export interface CoderDeps {
  provider: Provider;
  system: string;
  validate: (def: GeneratorDef) => Promise<{ ok: boolean; error?: string }>;
  usage: UsageTotals;
  signal?: AbortSignal;
  /** Attempts in total (default 2: first try + one repair). */
  attempts?: number;
  maxTokens?: number;
}

function addUsage(usage: UsageTotals, res: CompletionResponse): void {
  usage.calls += 1;
  usage.inputTokens += res.usage?.inputTokens ?? 0;
  usage.outputTokens += res.usage?.outputTokens ?? 0;
}

/** Ask the coder model for a generator with the given id and description. */
export async function requestGenerator(deps: CoderDeps, req: { id: string; description: string; paramsHint?: string }): Promise<CoderResult> {
  const messages: ChatMessage[] = [
    {
      role: 'user',
      content: `Write a generator with id "${req.id}".\nObject: ${req.description}${req.paramsHint ? `\nParameters to expose: ${req.paramsHint}` : ''}\nSubmit it with submit_generator.`,
    },
  ];
  const attempts = Math.max(1, Math.min(4, deps.attempts ?? 2));
  let lastError = 'the coder model did not submit a generator';
  let lastDef: GeneratorDef | undefined;
  for (let i = 0; i < attempts; i++) {
    const res = await deps.provider.complete(
      { role: 'coder', system: deps.system, messages, tools: [SUBMIT_GENERATOR_TOOL], maxTokens: deps.maxTokens ?? 16_000 },
      deps.signal,
    );
    addUsage(deps.usage, res);
    messages.push({ role: 'assistant', content: res.content });
    const call = res.content.find((b) => b.type === 'tool_use' && b.name === SUBMIT_GENERATOR_TOOL.name);
    if (!call || call.type !== 'tool_use') {
      lastError = res.stopReason === 'max_tokens' ? 'the generator was too long (output truncated)' : 'the coder model did not call submit_generator';
      messages.push({ role: 'user', content: `${lastError}. Call submit_generator with a complete, shorter generator.` });
      continue;
    }
    const input = typeof call.input === 'object' && call.input !== null ? { ...(call.input as Record<string, unknown>), id: req.id } : call.input;
    const parsed = GeneratorDef.safeParse(input);
    let error: string | undefined;
    if (!parsed.success) {
      error = `invalid generator definition: ${parsed.error.issues.slice(0, 5).map((iss) => `${iss.path.join('.') || '(root)'}: ${iss.message}`).join('; ')}`;
    } else {
      lastDef = parsed.data;
      const check = await deps.validate(parsed.data);
      if (check.ok) return { ok: true, def: parsed.data };
      error = check.error ?? 'generator failed validation';
    }
    lastError = error;
    messages.push({ role: 'user', content: [{ type: 'tool_result', toolUseId: call.id, content: `${error.slice(0, 2000)}\nFix the problem and submit again.`, isError: true }] });
  }
  return lastDef ? { ok: false, error: lastError, def: lastDef } : { ok: false, error: lastError };
}
