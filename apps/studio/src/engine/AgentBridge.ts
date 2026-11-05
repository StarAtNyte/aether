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
import { userEditMarks, type EntityId, type GeneratorDef, type History, type PatchResult, type ProceduralShape, type ScriptDef, type TextureSetDef, type TextureTier, type WorldDoc } from '@aether/core';
import { webpEncoder, type TextureController } from './textures';
import { overwrittenEdits, screenLocked, type EditMarks } from './editGuard';
import { createHttpProvider, createMockProvider, type AgentCatalogs, type AgentHost, type Provider, type ReviewViewRequest } from '@aether/agent';
import { drawMarks } from '../ai/marks';
import { composeTiles, decodeImageData } from '../ai/decode';
import { BEHAVIOR_CATALOG, RULE_DOCS, SCRIPT_API_DTS, createScriptRunner, initScripting, isScriptingReady } from '@aether/logic';
import type { ColliderProvider, TestResult, VerifyReport, VerifyTrace } from '@aether/physics';
import { summarizeReport } from '@aether/physics/report';
import { GENERATOR_API_DTS, GENERATOR_EXAMPLES, GENERATOR_LIBRARY, catalog, generate, loadLibraryGenerator, resolveParams, staticCheckSource, validateOutput, type GeneratorOutput, type SandboxRunner } from '@aether/procgen';
import { API, GENERATOR_DRY_RUN_MS, HEALTH_TIMEOUT_MS, VERIFY_BUDGET_MS, VERIFY_MAX_SECONDS } from '../config';
import { errorMessage } from '../lib/log';
import { createVerifyLogic } from './headlessHost';
import { VerificationService, type VerifyRunOptions } from './verify/service';
import type { Simulation } from './Simulation';

/** Result handed back to the agent by `verify`. */
export interface BridgeVerifyResult {
  report: VerifyReport | { error: string };
  summary: string;
  passed: boolean;
}

/** Receives live progress of a verification run. */
export interface VerifyProgressListener {
  start(world: WorldDoc): void;
  plan(plan: { lanes: number; worker: boolean }): void;
  result(index: number, result: TestResult): void;
  /** The run finished (or was cancelled) after `ms` milliseconds of wall time. */
  end(run: VerificationRun, ms: number): void;
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
    assetSummary: catalogSummary(getCatalog()),
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

/** Commits inspected for hand-edit marks. */
const EDIT_MARK_COMMITS = 60;

/** AgentHost implementation backed by the studio. */
export class AgentBridge implements AgentHost {
  private simulation: Simulation | null = null;
  /** Hand edits the agent overwrote since the last {@link takeOverwrites} (shown in the chat). */
  private overwrites: string[] = [];

  /** Live progress of agent-triggered verification (the Verify panel streams it). */
  verifyListener: VerifyProgressListener | null = null;
  /** The project's texture sets (set by the studio): where generated and photographed textures are kept. */
  textures: TextureController | null = null;
  /** Record motion traces for the proof replay (the studio turns this on; headless callers leave it off). */
  traceProofs = false;
  /** Where and how fast the last agent-triggered verification ran. */
  lastVerify: { ms: number; lanes: number; worker: boolean; simulatedSeconds: number } | null = null;

  /**
   * @param history world history (commits are attributed to 'agent')
   * @param sandbox Worker sandbox for LLM-written generators (null when unavailable)
   * @param verifier worker-backed verification (main thread when null)
   */
  constructor(
    private readonly history: History,
    private readonly sandbox: SandboxRunner | null,
    private readonly verifier: VerificationService | null = null,
  ) {}

  /** Attach the simulation once the viewport exists (screenshots, collider reuse). */
  attach(sim: Simulation | null): void {
    this.simulation = sim;
    if (sim) for (const wake of this.simulationWaiters.splice(0)) wake(sim);
  }

  /** Callers waiting for the viewport to come up (a prompt can arrive before the first frame). */
  private readonly simulationWaiters: Array<(sim: Simulation) => void> = [];

  /** The simulation, waiting up to `ms` for the viewport to mount (null when it never does). */
  private whenSimulation(ms: number, signal?: AbortSignal): Promise<Simulation | null> {
    if (this.simulation) return Promise.resolve(this.simulation);
    return new Promise((resolve) => {
      const done = (sim: Simulation | null): void => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        const i = this.simulationWaiters.indexOf(wake);
        if (i >= 0) this.simulationWaiters.splice(i, 1);
        resolve(sim);
      };
      const wake = (sim: Simulation): void => done(sim);
      const onAbort = (): void => done(null);
      const timer = setTimeout(() => done(null), ms);
      this.simulationWaiters.push(wake);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  getWorld(): WorldDoc {
    return this.history.current;
  }

  /** Recent hand edits of entities that still exist. */
  userEdits(): EditMarks {
    const world = this.history.current;
    return userEditMarks(this.history.recentCommits(EDIT_MARK_COMMITS), { exists: (id: EntityId) => Object.prototype.hasOwnProperty.call(world.entities, id) });
  }

  /**
   * Commit agent patches (source 'agent'). Patches touching locked entities
   * are refused with an explanation; overwritten hand edits are reported
   * to the model (`notes`) and collected for the chat.
   */
  applyPatches(patches: unknown[], message: string): PatchResult {
    const before = this.history.current;
    const screened = screenLocked(before, Array.isArray(patches) ? patches : []);
    const marks = this.userEdits();
    const r = this.history.commit(screened.allowed, message || 'Agent edit', 'agent');
    const errors = [...screened.refused, ...r.errors.map((e) => ({ ...e, index: e.index >= 0 ? (screened.indices[e.index] ?? e.index) : e.index }))].sort((a, b) => a.index - b.index);
    const overwritten = overwrittenEdits(r.applied, marks);
    if (overwritten.length === 0) return { ...r, errors };
    this.overwrites.push(...overwritten);
    if (this.overwrites.length > 24) this.overwrites = this.overwrites.slice(-24);
    return { ...r, errors, notes: [`these changes overwrote things the user set by hand (${overwritten.join('; ')}); tell the user plainly what you changed`] };
  }

  /** Hand edits the agent overwrote since the last call (then cleared). */
  takeOverwrites(): string[] {
    const out = this.overwrites;
    this.overwrites = [];
    return out;
  }

  async verify(world: WorldDoc, opts: { signal?: AbortSignal } = {}): Promise<BridgeVerifyResult> {
    const listener = this.verifyListener;
    const t0 = performance.now();
    listener?.start(world);
    const run = await runVerification(world, this.simulation, {
      service: this.verifier,
      ...(this.traceProofs ? { trace: true } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(listener ? { onResult: (i: number, r: TestResult) => listener.result(i, r), onPlan: (p: { lanes: number; worker: boolean }) => listener.plan(p) } : {}),
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
  async captureReview(views: readonly ReviewViewRequest[], opts: { signal?: AbortSignal; size?: number } = {}): Promise<Array<{ name: string; dataUrl: string }>> {
    if (views.length === 0) return [];
    const sim = await this.whenSimulation(30_000, opts.signal);
    if (!sim) return [];
    const width = Math.max(256, Math.min(1024, Math.round(opts.size ?? 768)));
    const aspect = views[0]?.aspect ?? 1.5;
    const height = Math.round(width / Math.max(0.5, Math.min(3, aspect)));
    // A capture can collide with a thumbnail or another capture that is just finishing: try again a few times.
    let images: Array<string | null> = [];
    for (let attempt = 0; attempt < 4 && !opts.signal?.aborted; attempt++) {
      images = await sim.capturePoses(views.map((v) => ({ ...v.pose, hideTops: v.hideTops })), { width, height });
      if (images.some((i) => i !== null)) break;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
    const out: Array<{ name: string; dataUrl: string }> = [];
    for (let i = 0; i < views.length; i++) {
      const view = views[i];
      const image = images[i];
      if (!view || !image || opts.signal?.aborted) continue;
      out.push({ name: view.name, dataUrl: await drawMarks(image, view.marks, view.overlays ?? []) });
    }
    return out;
  }

  /** Depth-sample a candidate camera in the live scene (see `AgentHost.probeView`). */
  probeView(pose: ReviewViewRequest['pose']): Promise<{ near: number; underWater: boolean } | null> {
    // No waiting: without a mounted viewport there is nothing to sample (and nothing to render the candidates with).
    const sim = this.simulation;
    return Promise.resolve(sim ? sim.renderer.checkOpeningView({ position: pose.position, target: pose.target, fov: pose.fov }) : null);
  }

  composeImages(tiles: ReadonlyArray<{ dataUrl: string; box?: readonly [number, number, number, number] }>, opts: { maxSide?: number } = {}): Promise<string | null> {
    return composeTiles(tiles, opts.maxSide);
  }

  async storeTexture(set: { id: string; def: TextureSetDef; files: ReadonlyArray<{ tier: TextureTier; map: 'albedo' | 'orm' | 'normal'; bytes: Uint8Array }> }): Promise<{ ok: true } | { ok: false; error: string }> {
    return this.textures ? this.textures.add(set) : { ok: false, error: 'this host has no texture store' };
  }

  encodeTextureMap = webpEncoder;

  decodeImage(dataUrl: string, maxSide: number): Promise<{ width: number; height: number; data: Uint8ClampedArray } | null> {
    return decodeImageData(dataUrl, maxSide);
  }

  async screenshot(): Promise<string | null> {
    return this.simulation ? this.simulation.screenshot() : null;
  }

  /** Geometry of a procedural shape for the agent's `sculpt` tool (custom generators in the worker sandbox). */
  generateShape(shape: ProceduralShape): Promise<GeneratorOutput> {
    return generate(shape, this.history.current, this.sandbox ? { sandbox: this.sandbox } : {});
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

/** Options of {@link runVerification}. */
export interface RunVerificationOptions {
  /** Worker-backed verification (falls back to the main thread by itself); main thread when absent. */
  service?: VerificationService | null;
  signal?: AbortSignal;
  /** Each test's result as soon as it is decided (`index` into `world.tests`). */
  onResult?: (index: number, result: TestResult) => void;
  /** Where and how wide the run goes, before it starts. */
  onPlan?: (plan: { lanes: number; worker: boolean }) => void;
  /** Record a motion trace for the proof replay (returned in {@link VerificationRun.trace}, never in the report). */
  trace?: boolean;
}

/** {@link BridgeVerifyResult} plus where it ran. */
export interface VerificationRun extends BridgeVerifyResult {
  /** Worker lanes used (1 on the main thread). */
  lanes: number;
  /** True when it ran in a worker. */
  worker: boolean;
  /** True when it was cancelled. */
  cancelled: boolean;
  /** Motion of the bodies that moved most (when requested); kept out of `report`, which goes to the model. */
  trace?: VerifyTrace;
}

/**
 * Cooperative main-thread verification (the fallback when workers cannot
 * run): yields every ~8 ms so the UI stays responsive.
 * @throws Error named `AbortError` when `opts.signal` aborts
 */
export async function verifyOnMainThread(world: WorldDoc, opts: VerifyRunOptions): Promise<VerifyReport> {
  // Physics (multi-MB Rapier chunk) is loaded on first use, not at startup.
  const physics = await import('@aether/physics');
  const hasScripts = Object.keys(world.scripts).length > 0;
  if (hasScripts) await initScripting().catch(() => undefined);
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
  } finally {
    logic.dispose();
  }
}

/**
 * Run `world.tests` + static diagnostics headless with world rules hooked
 * in: in the verification workers when a service is given (sharded across
 * lanes), otherwise on the main thread. Never throws: failures become a
 * failed result with an error report.
 */
export async function runVerification(world: WorldDoc, sim: Simulation | null, opts: RunVerificationOptions = {}): Promise<VerificationRun> {
  // Procedural colliders come from the renderer: wait until it reflects `world`,
  // otherwise a just-edited procedural shape would be verified with stale colliders.
  const colliders = sim ? await syncedColliders(sim, world) : undefined;
  const runOpts: VerifyRunOptions = {
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
async function syncedColliders(sim: Simulation, world: WorldDoc): Promise<ColliderProvider | undefined> {
  try {
    await sim.whenSynced();
  } catch {
    return undefined;
  }
  return sim.syncedWorld === world ? sim.colliders : undefined;
}
