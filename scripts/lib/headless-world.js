/**
 * Headless world host shared by `scripts/smoke.ts` and `scripts/eval-agent.ts`:
 * the agent catalogs the studio sends, plus a Node AgentHost over core
 * History with Rapier + logic verification and the node generator sandbox.
 */
import { catalogSummary, getCatalog, loadCatalog } from '@aether/assets';
import { createWorld, History } from '@aether/core';
import { BEHAVIOR_CATALOG, RULE_DOCS, SCRIPT_API_DTS, createScriptRunner, isScriptingReady } from '@aether/logic';
import { summarizeReport, verify } from '@aether/physics';
import { GENERATOR_API_DTS, GENERATOR_EXAMPLES, GENERATOR_LIBRARY, catalog, resolveParams, staticCheckSource, validateOutput } from '@aether/procgen';
import { createVerifyLogic } from '../../apps/studio/src/engine/headlessHost';
/** Headless verification limits (same order of magnitude as the studio). */
export const VERIFY_MAX_SECONDS = 25;
export const VERIFY_BUDGET_MS = 20_000;
export const GENERATOR_DRY_RUN_MS = 1_000;
/** The asset library catalog (loaded once at startup, as the studio does when the editor opens). */
await loadCatalog();
/** Catalogs for the agent's system prompt (same data the studio sends). */
export const CATALOGS = {
    generators: catalog(),
    behaviors: BEHAVIOR_CATALOG,
    ruleDocs: RULE_DOCS,
    generatorApiDts: GENERATOR_API_DTS,
    generatorExamples: GENERATOR_EXAMPLES,
    scriptApiDts: SCRIPT_API_DTS,
    libraryGenerators: [...GENERATOR_LIBRARY],
    assetSummary: catalogSummary(getCatalog()),
};
function errorText(err) {
    return err instanceof Error ? err.message : String(err);
}
/** Node AgentHost: History for edits, Rapier + logic for verification. */
export class NodeAgentHost {
    sandbox;
    history;
    verifyRuns = 0;
    /** @param initial the world to start from (default: an empty world) */
    constructor(sandbox, initial) {
        this.sandbox = sandbox;
        this.history = new History(initial ?? createWorld());
    }
    getWorld() {
        return this.history.current;
    }
    applyPatches(patches, message) {
        return this.history.commit(patches, message, 'agent');
    }
    async verify(world) {
        this.verifyRuns++;
        return runVerify(world);
    }
    async validateGenerator(def) {
        const check = staticCheckSource(def.source);
        if (!check.ok)
            return { ok: false, error: `rejected by static check: ${check.problems.slice(0, 5).join('; ')}` };
        try {
            const out = await this.sandbox.run(def, resolveParams(def.params, {}), 1, { timeoutMs: GENERATOR_DRY_RUN_MS });
            const v = validateOutput(out);
            return v.ok ? { ok: true } : { ok: false, error: v.error };
        }
        catch (err) {
            return { ok: false, error: errorText(err) };
        }
    }
    async validateScript(def) {
        if (!isScriptingReady())
            return { ok: false, error: 'script sandbox unavailable' };
        const runner = createScriptRunner();
        try {
            runner.load(def);
            const problems = runner.takeDiagnostics().filter((d) => d.scriptId === def.id);
            return problems.length > 0 ? { ok: false, error: problems.map((p) => p.text).join('; ') } : { ok: true };
        }
        catch (err) {
            return { ok: false, error: errorText(err) };
        }
        finally {
            runner.dispose();
        }
    }
}
/** Run world tests + diagnostics with rules/behaviors hooked in. */
export async function runVerify(world) {
    const hasScripts = Object.keys(world.scripts).length > 0;
    const logic = createVerifyLogic(world, {
        scripts: () => (hasScripts && isScriptingReady() ? createScriptRunner({ seed: world.seed }) : undefined),
    });
    try {
        const report = await verify(world, { logic: logic.factory, maxSeconds: VERIFY_MAX_SECONDS, budgetMs: VERIFY_BUDGET_MS });
        return { report, summary: summarizeReport(report), passed: report.passed };
    }
    finally {
        logic.dispose();
    }
}
