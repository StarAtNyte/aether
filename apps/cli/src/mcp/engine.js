/**
 * The headless engine behind the MCP tools: Rapier physics, the logic
 * runtime, the asset catalog and the generator sandbox, started once and
 * shared by every tool call. Nothing here touches the network or the disk.
 */
import { catalogSummary, getCatalog, loadCatalog } from '@aether/assets';
import { BEHAVIOR_CATALOG, RULE_DOCS, SCRIPT_API_DTS, createScriptRunner, initScripting, isScriptingReady } from '@aether/logic';
import { initPhysics, summarizeReport, verify } from '@aether/physics';
import { GENERATOR_API_DTS, GENERATOR_EXAMPLES, GENERATOR_LIBRARY, catalog, resolveParams, staticCheckSource, validateOutput } from '@aether/procgen';
import { createNodeSandbox } from '@aether/procgen/node';
import { createVerifyLogic } from '../../../studio/src/engine/headlessHost';
/** Headless verification limits (same order of magnitude as the studio). */
export const ENGINE_LIMITS = Object.freeze({
    VERIFY_MAX_SECONDS: 25,
    VERIFY_BUDGET_MS: 20_000,
    GENERATOR_DRY_RUN_MS: 1_000,
});
/** The started engine. */
export class Engine {
    catalogs;
    sandbox;
    constructor(catalogs, sandbox) {
        this.catalogs = catalogs;
        this.sandbox = sandbox;
    }
    static starting = null;
    /** Start the engine (once per process). */
    static start() {
        Engine.starting ??= (async () => {
            await initPhysics();
            await initScripting().catch(() => undefined);
            await loadCatalog();
            const catalogs = {
                generators: catalog(),
                behaviors: BEHAVIOR_CATALOG,
                ruleDocs: RULE_DOCS,
                generatorApiDts: GENERATOR_API_DTS,
                generatorExamples: GENERATOR_EXAMPLES,
                scriptApiDts: SCRIPT_API_DTS,
                libraryGenerators: [...GENERATOR_LIBRARY],
                assetSummary: catalogSummary(getCatalog()),
            };
            return new Engine(catalogs, createNodeSandbox({ timeoutMs: ENGINE_LIMITS.GENERATOR_DRY_RUN_MS }));
        })();
        return Engine.starting;
    }
    /** Release the generator sandbox. */
    dispose() {
        this.sandbox.dispose();
        Engine.starting = null;
    }
    /** Run the world's tests and diagnostics (physics as unit tests). */
    async verify(world, opts = {}) {
        const hasScripts = Object.keys(world.scripts).length > 0;
        const logic = createVerifyLogic(world, {
            scripts: () => (hasScripts && isScriptingReady() ? createScriptRunner({ seed: world.seed }) : undefined),
        });
        try {
            const report = await verify(world, {
                logic: logic.factory,
                maxSeconds: Math.min(opts.maxSeconds ?? ENGINE_LIMITS.VERIFY_MAX_SECONDS, ENGINE_LIMITS.VERIFY_MAX_SECONDS),
                budgetMs: Math.min(opts.budgetMs ?? ENGINE_LIMITS.VERIFY_BUDGET_MS, ENGINE_LIMITS.VERIFY_BUDGET_MS),
                ...(opts.trace ? { trace: { hz: 12, maxBodies: 24, minSeconds: 4, maxSeconds: 12 } } : {}),
                ...(opts.signal ? { signal: opts.signal } : {}),
            });
            return { report, summary: summarizeReport(report), passed: report.passed };
        }
        finally {
            logic.dispose();
        }
    }
    /** Dry-run a model-written generator in the sandbox. */
    async validateGenerator(def) {
        const check = staticCheckSource(def.source);
        if (!check.ok)
            return { ok: false, error: `rejected by static check: ${check.problems.slice(0, 5).join('; ')}` };
        try {
            const out = await this.sandbox.run(def, resolveParams(def.params, {}), 1, { timeoutMs: ENGINE_LIMITS.GENERATOR_DRY_RUN_MS });
            const v = validateOutput(out);
            return v.ok ? { ok: true } : { ok: false, error: v.error };
        }
        catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    }
    /** Compile a model-written script in the QuickJS sandbox. */
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
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
        finally {
            runner.dispose();
        }
    }
}
