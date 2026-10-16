/**
 * AgentBridge — implements the agent's `AgentHost` on top of the studio:
 * patches commit to History (source 'agent'), verification runs headless
 * physics + logic, generators are dry-run in the Worker sandbox, scripts are
 * compiled in the QuickJS sandbox, and screenshots come from the renderer.
 *
 * Also selects the LLM provider: the server proxy when `/api/health`
 * reports a live model, otherwise the deterministic offline mock.
 */
import { catalogSummary, getCatalog } from '@aether/assets';
import { userEditMarks } from '@aether/core';
import { overwrittenEdits, screenLocked } from './editGuard';
import { createHttpProvider, createMockProvider } from '@aether/agent';
import { drawMarks } from '../ai/marks';
import { decodeImageData } from '../ai/decode';
import { BEHAVIOR_CATALOG, RULE_DOCS, SCRIPT_API_DTS, createScriptRunner, initScripting, isScriptingReady } from '@aether/logic';
import { summarizeReport } from '@aether/physics/report';
import { GENERATOR_API_DTS, GENERATOR_EXAMPLES, GENERATOR_LIBRARY, catalog, loadLibraryGenerator, resolveParams, staticCheckSource, validateOutput } from '@aether/procgen';
import { API, GENERATOR_DRY_RUN_MS, HEALTH_TIMEOUT_MS, VERIFY_BUDGET_MS, VERIFY_MAX_SECONDS } from '../config';
import { errorMessage } from '../lib/log';
import { createVerifyLogic } from './headlessHost';
import { VerificationService } from './verify/service';
const MAX_GENERATOR_ERROR = 600;
/** Seed used for generator dry-runs (deterministic). */
const DRY_RUN_SEED = 1;
/** Catalog data for the agent's system prompt, collected from procgen + logic. */
export function agentCatalogs() {
    return {
        generators: catalog(),
        behaviors: BEHAVIOR_CATALOG,
        ruleDocs: RULE_DOCS,
        generatorApiDts: GENERATOR_API_DTS,
        generatorExamples: GENERATOR_EXAMPLES,
        scriptApiDts: SCRIPT_API_DTS,
        libraryGenerators: [...GENERATOR_LIBRARY],
        assetSummary: catalogSummary(getCatalog()),
    };
}
/** Definition of a generator-library object (lazy chunk; null when unknown). */
export const resolveLibraryGenerator = (id) => loadLibraryGenerator(id);
/** The offline planner, able to place generator-library objects by name. */
export function createOfflinePlanner() {
    return createMockProvider({ library: GENERATOR_LIBRARY });
}
/** Parse an untrusted `/api/health` body. */
export function parseHealth(body) {
    if (typeof body !== 'object' || body === null)
        return { live: false, providers: [] };
    const b = body;
    const providers = Array.isArray(b['providers']) ? b['providers'].filter((p) => typeof p === 'string').slice(0, 8).map((p) => p.slice(0, 40)) : [];
    return { live: b['ok'] === true && b['mode'] === 'live', providers };
}
/** Probe the backend and pick a provider (never throws; falls back to the mock). */
export async function selectProvider(fetchImpl = fetch, timeoutMs = HEALTH_TIMEOUT_MS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetchImpl(API.health, { signal: ctrl.signal, headers: { accept: 'application/json' } });
        if (res.ok) {
            const health = parseHealth(await res.json());
            if (health.live)
                return { provider: createHttpProvider({ endpoint: API.llm, fetch: fetchImpl }), live: true, name: health.providers[0] ?? 'server' };
        }
    }
    catch {
        /* offline: fall through to the mock */
    }
    finally {
        clearTimeout(timer);
    }
    return { provider: createOfflinePlanner(), live: false, name: 'offline demo' };
}
/** Commits inspected for hand-edit marks. */
const EDIT_MARK_COMMITS = 60;
/** AgentHost implementation backed by the studio. */
export class AgentBridge {
    history;
    sandbox;
    verifier;
    simulation = null;
    /** Hand edits the agent overwrote since the last {@link takeOverwrites} (shown in the chat). */
    overwrites = [];
    /** Live progress of agent-triggered verification (the Verify panel streams it). */
    verifyListener = null;
    /** Record motion traces for the proof replay (the studio turns this on; headless callers leave it off). */
    traceProofs = false;
    /** Where and how fast the last agent-triggered verification ran. */
    lastVerify = null;
    /**
     * @param history world history (commits are attributed to 'agent')
     * @param sandbox Worker sandbox for LLM-written generators (null when unavailable)
     * @param verifier worker-backed verification (main thread when null)
     */
    constructor(history, sandbox, verifier = null) {
        this.history = history;
        this.sandbox = sandbox;
        this.verifier = verifier;
    }
    /** Attach the simulation once the viewport exists (screenshots, collider reuse). */
    attach(sim) {
        this.simulation = sim;
        if (sim)
            for (const wake of this.simulationWaiters.splice(0))
                wake(sim);
    }
    /** Callers waiting for the viewport to come up (a prompt can arrive before the first frame). */
    simulationWaiters = [];
    /** The simulation, waiting up to `ms` for the viewport to mount (null when it never does). */
    whenSimulation(ms, signal) {
        if (this.simulation)
            return Promise.resolve(this.simulation);
        return new Promise((resolve) => {
            const done = (sim) => {
                clearTimeout(timer);
                signal?.removeEventListener('abort', onAbort);
                const i = this.simulationWaiters.indexOf(wake);
                if (i >= 0)
                    this.simulationWaiters.splice(i, 1);
                resolve(sim);
            };
            const wake = (sim) => done(sim);
            const onAbort = () => done(null);
            const timer = setTimeout(() => done(null), ms);
            this.simulationWaiters.push(wake);
            signal?.addEventListener('abort', onAbort, { once: true });
        });
    }
    getWorld() {
        return this.history.current;
    }
    /** Recent hand edits of entities that still exist. */
    userEdits() {
        const world = this.history.current;
        return userEditMarks(this.history.recentCommits(EDIT_MARK_COMMITS), { exists: (id) => Object.prototype.hasOwnProperty.call(world.entities, id) });
    }
    /**
     * Commit agent patches (source 'agent'). Patches touching locked entities
     * are refused with an explanation; overwritten hand edits are reported
     * to the model (`notes`) and collected for the chat.
     */
    applyPatches(patches, message) {
        const before = this.history.current;
        const screened = screenLocked(before, Array.isArray(patches) ? patches : []);
        const marks = this.userEdits();
        const r = this.history.commit(screened.allowed, message || 'Agent edit', 'agent');
        const errors = [...screened.refused, ...r.errors.map((e) => ({ ...e, index: e.index >= 0 ? (screened.indices[e.index] ?? e.index) : e.index }))].sort((a, b) => a.index - b.index);
        const overwritten = overwrittenEdits(r.applied, marks);
        if (overwritten.length === 0)
            return { ...r, errors };
        this.overwrites.push(...overwritten);
        if (this.overwrites.length > 24)
            this.overwrites = this.overwrites.slice(-24);
        return { ...r, errors, notes: [`these changes overwrote things the user set by hand (${overwritten.join('; ')}); tell the user plainly what you changed`] };
    }
    /** Hand edits the agent overwrote since the last call (then cleared). */
    takeOverwrites() {
        const out = this.overwrites;
        this.overwrites = [];
        return out;
    }
    async verify(world, opts = {}) {
        const listener = this.verifyListener;
        const t0 = performance.now();
        listener?.start(world);
        const run = await runVerification(world, this.simulation, {
            service: this.verifier,
            ...(this.traceProofs ? { trace: true } : {}),
            ...(opts.signal ? { signal: opts.signal } : {}),
            ...(listener ? { onResult: (i, r) => listener.result(i, r), onPlan: (p) => listener.plan(p) } : {}),
        });
        const ms = performance.now() - t0;
        const simulated = 'simulatedSeconds' in run.report ? run.report.simulatedSeconds : 0;
        this.lastVerify = { ms, lanes: run.lanes, worker: run.worker, simulatedSeconds: simulated };
        listener?.end(run, ms);
        return { report: run.report, summary: run.summary, passed: run.passed };
    }
    /**
     * Review images: each requested pose rendered from the live scene with its numbered marks drawn on.
     * Returns only the views that could be captured (none when the viewport is not available).
     */
    async captureReview(views, opts = {}) {
        if (views.length === 0)
            return [];
        const sim = await this.whenSimulation(30_000, opts.signal);
        if (!sim)
            return [];
        const width = Math.max(256, Math.min(1024, Math.round(opts.size ?? 768)));
        const aspect = views[0]?.aspect ?? 1.5;
        const height = Math.round(width / Math.max(0.5, Math.min(3, aspect)));
        // A capture can collide with a thumbnail or another capture that is just finishing: try again a few times.
        let images = [];
        for (let attempt = 0; attempt < 4 && !opts.signal?.aborted; attempt++) {
            images = await sim.capturePoses(views.map((v) => ({ ...v.pose, hideTops: v.hideTops })), { width, height });
            if (images.some((i) => i !== null))
                break;
            await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        }
        const out = [];
        for (let i = 0; i < views.length; i++) {
            const view = views[i];
            const image = images[i];
            if (!view || !image || opts.signal?.aborted)
                continue;
            out.push({ name: view.name, dataUrl: await drawMarks(image, view.marks) });
        }
        return out;
    }
    decodeImage(dataUrl, maxSide) {
        return decodeImageData(dataUrl, maxSide);
    }
    async screenshot() {
        return this.simulation ? this.simulation.screenshot() : null;
    }
    async validateGenerator(def) {
        const check = staticCheckSource(def.source);
        if (!check.ok)
            return { ok: false, error: `rejected by static check: ${check.problems.slice(0, 5).join('; ')}`.slice(0, MAX_GENERATOR_ERROR) };
        if (!this.sandbox)
            return { ok: false, error: 'generator sandbox unavailable in this browser' };
        try {
            const params = resolveParams(def.params, {});
            const out = await this.sandbox.run(def, params, DRY_RUN_SEED, { timeoutMs: GENERATOR_DRY_RUN_MS });
            const v = validateOutput(out);
            return v.ok ? { ok: true } : { ok: false, error: v.error.slice(0, MAX_GENERATOR_ERROR) };
        }
        catch (err) {
            return { ok: false, error: errorMessage(err).slice(0, MAX_GENERATOR_ERROR) };
        }
    }
    async validateScript(def) {
        try {
            await initScripting();
        }
        catch (err) {
            return { ok: false, error: `script sandbox unavailable: ${errorMessage(err)}` };
        }
        const runner = createScriptRunner();
        try {
            runner.load(def);
            const problems = runner.takeDiagnostics().filter((d) => d.scriptId === def.id);
            if (problems.length > 0)
                return { ok: false, error: problems.map((p) => p.text).join('; ').slice(0, MAX_GENERATOR_ERROR) };
            return { ok: true };
        }
        catch (err) {
            return { ok: false, error: errorMessage(err).slice(0, MAX_GENERATOR_ERROR) };
        }
        finally {
            runner.dispose();
        }
    }
}
/**
 * Cooperative main-thread verification (the fallback when workers cannot
 * run): yields every ~8 ms so the UI stays responsive.
 * @throws Error named `AbortError` when `opts.signal` aborts
 */
export async function verifyOnMainThread(world, opts) {
    // Physics (multi-MB Rapier chunk) is loaded on first use, not at startup.
    const physics = await import('@aether/physics');
    const hasScripts = Object.keys(world.scripts).length > 0;
    if (hasScripts)
        await initScripting().catch(() => undefined);
    const logic = createVerifyLogic(world, {
        scripts: () => (hasScripts && isScriptingReady() ? createScriptRunner({ seed: world.seed }) : undefined),
    });
    try {
        return await physics.verify(world, {
            ...(opts.colliders ? { colliders: opts.colliders } : {}),
            logic: logic.factory,
            maxSeconds: opts.maxSeconds,
            budgetMs: opts.budgetMs,
            ...(opts.signal ? { signal: opts.signal } : {}),
            ...(opts.onResult ? { onResult: opts.onResult } : {}),
            ...(opts.trace ? { trace: true } : {}),
        });
    }
    finally {
        logic.dispose();
    }
}
/**
 * Run `world.tests` + static diagnostics headless with world rules hooked
 * in: in the verification workers when a service is given (sharded across
 * lanes), otherwise on the main thread. Never throws: failures become a
 * failed result with an error report.
 */
export async function runVerification(world, sim, opts = {}) {
    // Procedural colliders come from the renderer: wait until it reflects `world`,
    // otherwise a just-edited procedural shape would be verified with stale colliders.
    const colliders = sim ? await syncedColliders(sim, world) : undefined;
    const runOpts = {
        colliders,
        maxSeconds: VERIFY_MAX_SECONDS,
        budgetMs: VERIFY_BUDGET_MS,
        ...(opts.signal ? { signal: opts.signal } : {}),
        ...(opts.onResult ? { onResult: opts.onResult } : {}),
        ...(opts.onPlan ? { onPlan: opts.onPlan } : {}),
        ...(opts.trace ? { trace: true } : {}),
    };
    const service = opts.service ?? new VerificationService(null, verifyOnMainThread);
    const out = await service.run(world, runOpts);
    if (out.ok) {
        // The trace is for the replay only: the report goes back to the model as text.
        const { trace, ...report } = out.report;
        // The report module is tiny and Rapier-free: summarising never loads physics on the main thread.
        const summary = summarizeReport(report);
        return { report, summary, passed: report.passed, lanes: out.lanes, worker: out.worker, cancelled: false, ...(trace ? { trace } : {}) };
    }
    const message = out.cancelled ? 'verification cancelled' : /unavailable|import|fetch|module/i.test(out.error) && !out.worker ? `verification unavailable: ${out.error}` : `verification crashed: ${out.error}`;
    return { report: { error: message }, summary: message, passed: false, lanes: 1, worker: out.worker, cancelled: out.cancelled };
}
/**
 * The simulation's collider provider, but only once its renderer has synced
 * exactly `world`; otherwise undefined (physics then derives colliders itself,
 * which is slower but never stale).
 */
async function syncedColliders(sim, world) {
    try {
        await sim.whenSynced();
    }
    catch {
        return undefined;
    }
    return sim.syncedWorld === world ? sim.colliders : undefined;
}
