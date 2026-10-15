/**
 * createMockProvider — a deterministic, offline planner (no network, no keys).
 *
 * It reads the last user turn (world summary + request envelope), recognizes
 * themes / moods / edit commands, and answers like a real model would: a plan
 * text, one or more `apply_patches` tool calls and a `finish` call. Follow-up
 * turns (tool results, repair requests) end the conversation politely. The
 * `coder` role returns a small, valid parametric generator.
 */
import { hashString, stableStringify } from '@aether/core';
import { messageText, parseUserTurn } from '../../context';
import type { CompletionRequest, CompletionResponse, ContentBlock, Provider } from '../../types';
import { ProviderError } from '../errors';
import type { MockLibraryItem } from './library';
import { planMock } from './planner';

/** Patches per apply_patches call (mirrors the tool limit). */
const PATCH_CHUNK = 400;

function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

function requestChars(req: CompletionRequest): number {
  let n = req.system.length;
  for (const m of req.messages) n += typeof m.content === 'string' ? m.content.length : stableStringify(m.content).length;
  return n;
}

function respond(req: CompletionRequest, content: ContentBlock[], stopReason: CompletionResponse['stopReason']): CompletionResponse {
  return {
    content,
    stopReason,
    usage: { inputTokens: estimateTokens(requestChars(req)), outputTokens: estimateTokens(stableStringify(content).length) },
    model: 'aether-mock',
  };
}

const CODER_SOURCE = [
  'const h = params.height;',
  "api.add(api.box(h * 0.5, h * 0.08, h * 0.5).translate(0, h * 0.04, 0), { preset: 'stone', color: '#8f8a82' });",
  "api.add(api.cylinder(h * 0.14, h * 0.18, h * 0.8, 12).translate(0, h * 0.48, 0), { preset: 'stone', color: params.color, flatShading: true });",
  "api.add(api.cone(h * 0.16, h * 0.14, 12).translate(0, h * 0.95, 0), { preset: 'gold' });",
  "api.autoColliders('box');",
  'return api.build();',
].join('\n');

function coderResponse(req: CompletionRequest): CompletionResponse {
  const first = req.messages[0];
  const text = first ? messageText(first) : '';
  const id = /id "([a-z][a-z0-9-]{1,63})"/.exec(text)?.[1] ?? 'custom-monument';
  return respond(req, [
    { type: 'text', text: 'Offline mode: submitting a simple parametric monument.' },
    {
      type: 'tool_use',
      id: `mock-coder-${hashString(text).toString(36)}`,
      name: 'submit_generator',
      input: {
        id,
        description: 'Stone monument on a plinth with a golden cap (offline placeholder).',
        params: {
          height: { type: 'number', default: 4, min: 1, max: 30, description: 'total height in meters' },
          color: { type: 'color', default: '#c9c3b5', description: 'body color' },
        },
        source: CODER_SOURCE,
      },
    },
  ], 'tool_use');
}

/** Options of {@link createMockProvider}. */
export interface MockProviderOptions {
  /**
   * Generator-library objects the planner may place by name ("a pagoda").
   * The host must resolve their definitions (`AgentOptions.resolveGenerator`).
   */
  library?: readonly MockLibraryItem[];
}

/** Create the deterministic offline provider. */
export function createMockProvider(opts: MockProviderOptions = {}): Provider {
  const library = (opts.library ?? []).slice(0, 500);
  return {
    name: 'mock',
    async complete(req: CompletionRequest, signal?: AbortSignal): Promise<CompletionResponse> {
      if (signal?.aborted) throw new ProviderError('aborted', 'request aborted');
      if (req.role === 'coder') return coderResponse(req);

      const last = [...req.messages].reverse().find((m) => m.role === 'user');
      if (!last) return respond(req, [{ type: 'text', text: 'Tell me what world to build.' }], 'end');
      if (Array.isArray(last.content) && last.content.some((b) => b.type === 'tool_result')) {
        const repair = /verification failed/i.test(messageText(last));
        return respond(req, [{ type: 'text', text: repair ? 'Offline mode cannot repair further; the remaining notes are listed above.' : 'All set.' }], 'end');
      }

      const raw = messageText(last);
      const envelope = parseUserTurn(raw);
      const plan = planMock(envelope?.request ?? raw, envelope?.summary ?? '', library, envelope?.mode?.startsWith('new') ? 'new' : envelope?.mode ? 'refine' : undefined);
      if (plan.patches.length === 0 && !plan.arch) return respond(req, [{ type: 'text', text: plan.message }], 'end');

      const key = hashString(raw).toString(36);
      const content: ContentBlock[] = [{ type: 'text', text: plan.plan }];
      for (let i = 0; i < plan.patches.length; i += PATCH_CHUNK) {
        const part = i / PATCH_CHUNK + 1;
        content.push({
          type: 'tool_use',
          id: `mock-${key}-${part}`,
          name: 'apply_patches',
          input: { patches: plan.patches.slice(i, i + PATCH_CHUNK), message: plan.patches.length > PATCH_CHUNK ? `${plan.message.slice(0, 60)} (${part})` : plan.message.slice(0, 120) },
        });
      }
      if (plan.arch) content.push({ type: 'tool_use', id: `mock-${key}-arch`, name: 'build_architecture', input: { ops: plan.arch.ops, message: plan.arch.message } });
      content.push({ type: 'tool_use', id: `mock-${key}-finish`, name: 'finish', input: { message: plan.message } });
      return respond(req, content, 'tool_use');
    },
  };
}
