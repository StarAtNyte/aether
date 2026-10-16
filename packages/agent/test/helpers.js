/**
 * Shared test helpers: an in-memory AgentHost over core's applyPatches and a
 * runner that drives the mock provider end-to-end.
 */
import { applyPatches, createWorld, summarizeWorld } from '@aether/core';
import { CONTEXT_LIMITS, formatUserTurn } from '../src/context';
import { createMockProvider } from '../src/providers/mock/index';
/** Minimal catalogs for agent-loop tests. */
export const TEST_CATALOGS = {
    generators: [{ id: 'tree-oak', description: 'oak', category: 'nature', params: {} }, { id: 'rock', description: 'rock', category: 'nature', params: {} }],
    behaviors: [{ type: 'spin', description: 'spins', params: {} }],
    ruleDocs: 'RULES: test docs',
    generatorApiDts: 'interface GeneratorApi {}',
    generatorExamples: [],
    scriptApiDts: 'interface ScriptApi {}',
};
/** In-memory host recording every call. */
export class MemoryHost {
    world;
    commits = [];
    verifyCalls = 0;
    verifyResults = [];
    validateGenerator;
    validateScript;
    constructor(world = createWorld()) {
        this.world = world;
    }
    getWorld() {
        return this.world;
    }
    applyPatches(patches, message) {
        const result = applyPatches(this.world, patches);
        this.world = result.world;
        this.commits.push({ message, result });
        return result;
    }
    async verify() {
        const passed = this.verifyResults[this.verifyCalls] ?? true;
        this.verifyCalls++;
        return { report: { n: this.verifyCalls }, summary: passed ? 'all tests passed' : 'test chain-falls FAILED: domino-6 did not topple', passed };
    }
}
/** Collect every event of an async generator. */
export async function collect(gen) {
    const out = [];
    for await (const e of gen)
        out.push(e);
    return out;
}
/** Ask the mock provider directly; returns its response. */
export async function askMock(prompt, world = createWorld()) {
    const provider = createMockProvider();
    const summary = summarizeWorld(world, { maxEntities: CONTEXT_LIMITS.SUMMARY_ENTITIES });
    return provider.complete({ role: 'planner', system: 'test', messages: [{ role: 'user', content: [{ type: 'text', text: formatUserTurn(summary, prompt) }] }] });
}
/** All patches from the mock's apply_patches calls. */
export function patchesOf(res) {
    return res.content
        .filter((b) => b.type === 'tool_use' && b.name === 'apply_patches')
        .flatMap((b) => b.input.patches);
}
/** Run a mock prompt against `world` and apply the result (asserting nothing). */
export async function mockApply(prompt, world = createWorld()) {
    const res = await askMock(prompt, world);
    const patches = patchesOf(res);
    return { result: applyPatches(world, patches), res, patches };
}
