/**
 * Shared test helpers: an in-memory AgentHost over core's applyPatches and a
 * runner that drives the mock provider end-to-end.
 */
import { applyPatches, createWorld, summarizeWorld, type PatchResult, type WorldDoc } from '@aether/core';
import { CONTEXT_LIMITS, formatUserTurn } from '../src/context';
import { createMockProvider } from '../src/providers/mock/index';
import type { AgentCatalogs, AgentEvent, AgentHost, CompletionResponse, ContentBlock } from '../src/types';

/** Minimal catalogs for agent-loop tests. */
export const TEST_CATALOGS: AgentCatalogs = {
  generators: [{ id: 'tree-oak', description: 'oak', category: 'nature', params: {} }, { id: 'rock', description: 'rock', category: 'nature', params: {} }],
  behaviors: [{ type: 'spin', description: 'spins', params: {} }],
  ruleDocs: 'RULES: test docs',
  generatorApiDts: 'interface GeneratorApi {}',
  generatorExamples: [],
  scriptApiDts: 'interface ScriptApi {}',
};

/** In-memory host recording every call. */
export class MemoryHost implements AgentHost {
  world: WorldDoc;
  readonly commits: Array<{ message: string; result: PatchResult }> = [];
  verifyCalls = 0;
  verifyResults: boolean[] = [];
  validateGenerator?: AgentHost['validateGenerator'];
  validateScript?: AgentHost['validateScript'];

  constructor(world: WorldDoc = createWorld()) {
    this.world = world;
  }

  getWorld(): WorldDoc {
    return this.world;
  }

  applyPatches(patches: unknown[], message: string): PatchResult {
    const result = applyPatches(this.world, patches);
    this.world = result.world;
    this.commits.push({ message, result });
    return result;
  }

  async verify(): Promise<{ report: unknown; summary: string; passed: boolean }> {
    const passed = this.verifyResults[this.verifyCalls] ?? true;
    this.verifyCalls++;
    return { report: { n: this.verifyCalls }, summary: passed ? 'all tests passed' : 'test chain-falls FAILED: domino-6 did not topple', passed };
  }
}

/** Collect every event of an async generator. */
export async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

/** Ask the mock provider directly; returns its response. */
export async function askMock(prompt: string, world: WorldDoc = createWorld()): Promise<CompletionResponse> {
  const provider = createMockProvider();
  const summary = summarizeWorld(world, { maxEntities: CONTEXT_LIMITS.SUMMARY_ENTITIES });
  return provider.complete({ role: 'planner', system: 'test', messages: [{ role: 'user', content: [{ type: 'text', text: formatUserTurn(summary, prompt) }] }] });
}

/** All patches from the mock's apply_patches calls. */
export function patchesOf(res: CompletionResponse): unknown[] {
  return res.content
    .filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use' && b.name === 'apply_patches')
    .flatMap((b) => (b.input as { patches: unknown[] }).patches);
}

/** Run a mock prompt against `world` and apply the result (asserting nothing). */
export async function mockApply(prompt: string, world: WorldDoc = createWorld()): Promise<{ result: PatchResult; res: CompletionResponse; patches: unknown[] }> {
  const res = await askMock(prompt, world);
  const patches = patchesOf(res);
  return { result: applyPatches(world, patches), res, patches };
}
