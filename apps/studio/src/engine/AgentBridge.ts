/**
 * AgentBridge — implements the agent's `AgentHost` on top of the studio:
 * patches commit to History (source 'agent'), verification runs headless
 * physics + logic, generators are dry-run in the Worker sandbox, scripts are
 * compiled in the QuickJS sandbox, and screenshots come from the renderer.
 *
 * Also selects the LLM provider: the server proxy when `/api/health`
 * reports a live model, otherwise the deterministic offline mock.
 */
import { type GeneratorDef, type History, type PatchResult, type ScriptDef, type WorldDoc } from '@aether/core';
import { createHttpProvider, createMockProvider, type AgentCatalogs, type AgentHost, type Provider } from '@aether/agent';
import { BEHAVIOR_CATALOG, RULE_DOCS, SCRIPT_API_DTS, createScriptRunner, initScripting, isScriptingReady } from '@aether/logic';
import type { ColliderProvider, VerifyReport } from '@aether/physics';
import { GENERATOR_API_DTS, GENERATOR_EXAMPLES, GENERATOR_LIBRARY, catalog, loadLibraryGenerator, resolveParams, staticCheckSource, validateOutput, type SandboxRunner } from '@aether/procgen';
import { API, GENERATOR_DRY_RUN_MS, HEALTH_TIMEOUT_MS, VERIFY_BUDGET_MS, VERIFY_MAX_SECONDS } from '../config';
import { errorMessage } from '../lib/log';
import { createVerifyLogic } from './headlessHost';
import type { Simulation } from './Simulation';

/** Result handed back to the agent by `verify`. */
export interface BridgeVerifyResult {
  report: VerifyReport | { error: string };
  summary: string;
  passed: boolean;
}

/** Provider selection outcome. */
export interface ProviderChoice {
  provider: Provider;
  live: boolean;
  name: string;
}

const MAX_GENERATOR_ERROR = 600;
/** Seed used for generator dry-runs (deterministic). */
const DRY_RUN_SEED = 1;

/** Catalog data for the agent's system prompt, collected from procgen + logic. */
export function agentCatalogs(): AgentCatalogs {
  return {
    generators: catalog(),
    behaviors: BEHAVIOR_CATALOG,
    ruleDocs: RULE_DOCS,
    generatorApiDts: GENERATOR_API_DTS,
    generatorExamples: GENERATOR_EXAMPLES,
    scriptApiDts: SCRIPT_API_DTS,
    libraryGenerators: [...GENERATOR_LIBRARY],
  };
}

/** Definition of a generator-library object (lazy chunk; null when unknown). */
export const resolveLibraryGenerator = (id: string): Promise<GeneratorDef | null> => loadLibraryGenerator(id);

/** The offline planner, able to place generator-library objects by name. */
export function createOfflinePlanner(): Provider {
  return createMockProvider({ library: GENERATOR_LIBRARY });
}

/** Parse an untrusted `/api/health` body. */
export function parseHealth(body: unknown): { live: boolean; providers: string[] } {
  if (typeof body !== 'object' || body === null) return { live: false, providers: [] };
  const b = body as Record<string, unknown>;
  const providers = Array.isArray(b['providers']) ? b['providers'].filter((p): p is string => typeof p === 'string').slice(0, 8).map((p) => p.slice(0, 40)) : [];
  return { live: b['ok'] === true && b['mode'] === 'live', providers };
}

/** Probe the backend and pick a provider (never throws; falls back to the mock). */
export async function selectProvider(fetchImpl: typeof fetch = fetch, timeoutMs: number = HEALTH_TIMEOUT_MS): Promise<ProviderChoice> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(API.health, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (res.ok) {
      const health = parseHealth(await res.json());
      if (health.live) return { provider: createHttpProvider({ endpoint: API.llm, fetch: fetchImpl }), live: true, name: health.providers[0] ?? 'server' };
    }
  } catch {
    /* offline: fall through to the mock */
  } finally {
    clearTimeout(timer);
  }
  return { provider: createOfflinePlanner(), live: false, name: 'offline demo' };
}

/** AgentHost implementation backed by the studio. */
export class AgentBridge implements AgentHost {
  private simulation: Simulation | null = null;

  /**
   * @param history world history (commits are attributed to 'agent')
   * @param sandbox Worker sandbox for LLM-written generators (null when unavailable)
   */
  constructor(
    private readonly history: History,
    private readonly sandbox: SandboxRunner | null,
  ) {}

  /** Attach the simulation once the viewport exists (screenshots, collider reuse). */
  attach(sim: Simulation | null): void {
    this.simulation = sim;
  }

  getWorld(): WorldDoc {
    return this.history.current;
  }

  applyPatches(patches: unknown[], message: string): PatchResult {
    return this.history.commit(patches, message || 'Agent edit', 'agent');
  }

  async verify(world: WorldDoc): Promise<BridgeVerifyResult> {
    return runVerification(world, this.simulation);
  }

  async screenshot(): Promise<string | null> {
    return this.simulation ? this.simulation.screenshot() : null;
  }

  async validateGenerator(def: GeneratorDef): Promise<{ ok: boolean; error?: string }> {
    const check = staticCheckSource(def.source);
    if (!check.ok) return { ok: false, error: `rejected by static check: ${check.problems.slice(0, 5).join('; ')}`.slice(0, MAX_GENERATOR_ERROR) };
    if (!this.sandbox) return { ok: false, error: 'generator sandbox unavailable in this browser' };
    try {
      const params = resolveParams(def.params, {});
      const out = await this.sandbox.run(def, params, DRY_RUN_SEED, { timeoutMs: GENERATOR_DRY_RUN_MS });
      const v = validateOutput(out);
      return v.ok ? { ok: true } : { ok: false, error: v.error.slice(0, MAX_GENERATOR_ERROR) };
    } catch (err) {
      return { ok: false, error: errorMessage(err).slice(0, MAX_GENERATOR_ERROR) };
    }
  }

  async validateScript(def: ScriptDef): Promise<{ ok: boolean; error?: string }> {
    try {
      await initScripting();
    } catch (err) {
      return { ok: false, error: `script sandbox unavailable: ${errorMessage(err)}` };
    }
    const runner = createScriptRunner();
    try {
      runner.load(def);
      const problems = runner.takeDiagnostics().filter((d) => d.scriptId === def.id);
      if (problems.length > 0) return { ok: false, error: problems.map((p) => p.text).join('; ').slice(0, MAX_GENERATOR_ERROR) };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: errorMessage(err).slice(0, MAX_GENERATOR_ERROR) };
    } finally {
      runner.dispose();
    }
  }
}

/**
 * Run `world.tests` + static diagnostics headless with world rules hooked
 * in. Never throws: failures become a failed result with an error report.
 */
export async function runVerification(world: WorldDoc, sim: Simulation | null): Promise<BridgeVerifyResult> {
  // Physics (multi-MB Rapier chunk) is loaded on first use, not at startup.
  let physics: typeof import('@aether/physics');
  try {
    physics = await import('@aether/physics');
  } catch (err) {
    const message = `verification unavailable: ${errorMessage(err)}`;
    return { report: { error: message }, summary: message, passed: false };
  }
  // Procedural colliders come from the renderer: wait until it reflects `world`,
  // otherwise a just-edited procedural shape would be verified with stale colliders.
  const colliders = sim ? await syncedColliders(sim, world) : undefined;
  const hasScripts = Object.keys(world.scripts).length > 0;
  if (hasScripts) await initScripting().catch(() => undefined);
  const logic = createVerifyLogic(world, {
    scripts: () => (hasScripts && isScriptingReady() ? createScriptRunner({ seed: world.seed }) : undefined),
  });
  try {
    const report = await physics.verify(world, {
      ...(colliders ? { colliders } : {}),
      logic: logic.factory,
      maxSeconds: VERIFY_MAX_SECONDS,
      budgetMs: VERIFY_BUDGET_MS,
    });
    return { report, summary: physics.summarizeReport(report), passed: report.passed };
  } catch (err) {
    const message = `verification crashed: ${errorMessage(err)}`;
    return { report: { error: message }, summary: message, passed: false };
  } finally {
    logic.dispose();
  }
}

/**
 * The simulation's collider provider, but only once its renderer has synced
 * exactly `world`; otherwise undefined (physics then derives colliders itself,
 * which is slower but never stale).
 */
async function syncedColliders(sim: Simulation, world: WorldDoc): Promise<ColliderProvider | undefined> {
  try {
    await sim.whenSynced();
  } catch {
    return undefined;
  }
  return sim.syncedWorld === world ? sim.colliders : undefined;
}
