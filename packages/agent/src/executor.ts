/**
 * Executes the planner's tool calls against an {@link AgentHost} and turns
 * the outcome into concise, actionable tool results plus agent events.
 * All model arguments are untrusted: they are size-checked and zod-validated
 * here, and patches are validated again by the host's `applyPatches`.
 */
import { GeneratorDef, ScriptDef, hasOwn, summarizeWorld, type PatchError } from '@aether/core';
import type { z } from 'zod';
import { requestGenerator } from './coder';
import { errorMessage } from './providers/errors';
import { TOOL_LIMITS, ToolInputs, isAgentTool } from './tools';
import type { AgentEvent, AgentHost, Provider, UsageTotals } from './types';

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
}

const MAX_RESULT_CHARS = 20_000;
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

async function applyPatchesTool(ctx: ExecutorContext, input: z.infer<typeof ToolInputs.apply_patches>): Promise<ToolOutcome> {
  const message = input.message.trim().slice(0, 200) || 'Agent edit';
  const result = ctx.host.applyPatches(input.patches, message);
  const event: AgentEvent = { type: 'patches', patches: result.applied, message, result: { applied: result.applied.length, errors: result.errors } };
  const content = formatPatchOutcome(result.applied.length, input.patches.length, result.errors, Object.keys(result.world.entities).length);
  return { content, isError: result.applied.length === 0 && result.errors.length > 0, events: [event], edited: result.applied.length > 0 };
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
  if (ctx.builtinGenerators.has(def.id)) return { ok: false, error: `"${def.id}" is a built-in generator id; choose another id` };
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

async function requestAssetTool(ctx: ExecutorContext, input: z.infer<typeof ToolInputs.request_asset>): Promise<ToolOutcome> {
  if (ctx.builtinGenerators.has(input.id)) return fail(`"${input.id}" is a built-in generator; use it directly or pick another id.`);
  const events: AgentEvent[] = [{ type: 'status', text: `Writing a custom generator "${input.id}"…` }];
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

function inspectTool(ctx: ExecutorContext, input: z.infer<typeof ToolInputs.inspect>): ToolOutcome {
  const world = ctx.host.getWorld();
  if (!input.ids || input.ids.length === 0) return { content: clip(summarizeWorld(world, { maxEntities: 400 })), isError: false, events: [], edited: false };
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
  const res = await raceAbort(ctx.host.verify(ctx.host.getWorld()), ctx.signal);
  const summary = typeof res.summary === 'string' ? res.summary : 'no summary';
  const passed = res.passed === true;
  return { event: { type: 'verify', passed, summary, report: res.report }, passed, summary };
}

/** Execute one tool call. Never throws except when aborted. */
export async function executeTool(ctx: ExecutorContext, name: string, rawInput: unknown): Promise<ToolOutcome> {
  if (!isAgentTool(name)) return fail(`Unknown tool "${name.slice(0, 64)}". Available: apply_patches, write_generator, write_script, request_asset, inspect, run_verification, finish.`);
  if (typeof rawInput === 'string') return fail('The tool arguments were not valid JSON. Resend the call with a valid JSON object.');
  if (inputSize(rawInput) > TOOL_LIMITS.MAX_INPUT_CHARS) return fail(`Tool input too large (max ${TOOL_LIMITS.MAX_INPUT_CHARS} characters). Split it into several calls.`);
  try {
    switch (name) {
      case 'apply_patches': {
        const p = ToolInputs.apply_patches.safeParse(rawInput);
        return p.success ? await applyPatchesTool(ctx, p.data) : fail(`Invalid apply_patches input: ${issuesText(p.error)}`);
      }
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
