/**
 * Deterministic re-simulation: the single place that turns a world (plus the
 * recorded replay settings) into a claim. Both sealing and checking call it,
 * so the two can never drift apart. It reuses `@aether/physics`' `verify`
 * (fixed-step Rapier, headless) and the headless logic host; nothing here
 * re-implements physics or rules.
 */
import { validateWorld, type WorldDoc } from '@aether/core';
import { createScriptRunner, initScripting, isScriptingReady } from '@aether/logic';
import { verify, type ColliderProvider, type VerifyReport } from '@aether/physics';
import { parseCollider, type ColliderDesc } from '@aether/procgen';
import { createVerifyLogic } from './headless-host';
import { hashJson, hashQuantized } from './hash';
import { PROOF_LIMITS, type Proof, type ProofBody, type ProofColliderEntries } from './proof';

/** Replay settings (also recorded in the proof). */
export interface ReplaySettings {
  maxSeconds: number;
  traceHz: number;
}

/** Defaults of a sealed replay. */
export const DEFAULT_REPLAY: ReplaySettings = Object.freeze({ maxSeconds: 12, traceHz: 12 });

/** Wall-clock budget of a replay (ms): large, because a replay must run to its horizon, not be cut short. */
export const REPLAY_BUDGET_MS = 30_000;

/** Options of {@link resimulate}. */
export interface ResimulateOptions {
  settings?: ReplaySettings;
  /** Renderer colliders (from a live studio) or the entries a proof carries. */
  colliders?: ProofColliderEntries | ReadonlyArray<readonly [string, readonly ColliderDesc[]]>;
  signal?: AbortSignal;
  /** Overrides the wall-clock budget (tests). */
  budgetMs?: number;
}

/** What a replay produced. */
export interface ReplayResult {
  /** The claim part of a proof (without its hash). */
  claim: Omit<ProofBody['claim'], 'hash'>;
  trace: ProofBody['trace'] | undefined;
  /** True when the wall-clock budget cut the replay short (the result is then not a verdict). */
  inconclusive: boolean;
  report: VerifyReport;
}

function providerOf(list: ResimulateOptions['colliders']): ColliderProvider | undefined {
  if (!list || list.length === 0) return undefined;
  const map = new Map<string, ColliderDesc[]>();
  for (const [id, descs] of list) map.set(id, (descs as readonly unknown[]).map((d) => parseCollider(d)));
  return (entity) => map.get(entity.id);
}

/** Clip a message to the proof's cap. */
function clip(s: string): string {
  return s.length > PROOF_LIMITS.MAX_MESSAGE ? `${s.slice(0, PROOF_LIMITS.MAX_MESSAGE - 1)}…` : s;
}

/** Build the claim (and trace fingerprint) of a finished report. Pure. */
export function claimOf(report: VerifyReport): Pick<ReplayResult, 'claim' | 'trace'> {
  const tests = report.results.map((r) => ({
    id: r.id.slice(0, 200),
    kind: r.kind.slice(0, 64),
    passed: r.passed,
    message: clip(r.message),
    ...(r.atTime !== undefined ? { atTime: r.atTime } : {}),
  }));
  const diagnostics = report.diagnostics.slice(0, PROOF_LIMITS.MAX_DIAGNOSTICS).map((d) => ({
    severity: d.severity,
    code: d.code,
    entities: d.entities.slice(0, PROOF_LIMITS.MAX_ENTITIES_PER_DIAGNOSTIC).map((e) => e.slice(0, 200)),
  }));
  const claim = { passed: report.passed, simulatedSeconds: report.simulatedSeconds, tests, diagnostics };
  const t = report.trace;
  const trace = t
    ? {
        hash: hashQuantized([...t.poses]),
        frames: t.frames,
        bodies: t.ids.length,
        dt: Number(t.dt.toFixed(6)),
      }
    : undefined;
  return { claim, trace };
}

/** The `claim.hash` of a claim. */
export function claimHash(claim: Omit<ProofBody['claim'], 'hash'> & { hash?: string }): string {
  const { hash: _ignored, ...rest } = claim;
  return hashJson(rest);
}

/**
 * Re-simulate `world` headless and describe the outcome as a claim. Throws
 * when the world is invalid or aborted; a budget cut sets `inconclusive`.
 */
export async function resimulate(world: WorldDoc, opts: ResimulateOptions = {}): Promise<ReplayResult> {
  const settings = opts.settings ?? DEFAULT_REPLAY;
  const checked = validateWorld(world);
  if (!checked.ok) throw new Error(`invalid world: ${checked.issues.slice(0, 3).map((i) => `${i.path} ${i.message}`).join('; ')}`);
  const doc = checked.world;
  const hasScripts = Object.keys(doc.scripts).length > 0;
  if (hasScripts) await initScripting().catch(() => undefined);
  const colliders = providerOf(opts.colliders);
  const logic = createVerifyLogic(doc, {
    scripts: () => (hasScripts && isScriptingReady() ? createScriptRunner({ seed: doc.seed }) : undefined),
  });
  try {
    const report = await verify(doc, {
      ...(colliders ? { colliders } : {}),
      logic: logic.factory,
      maxSeconds: settings.maxSeconds,
      budgetMs: opts.budgetMs ?? REPLAY_BUDGET_MS,
      diagnostics: true,
      trace: { hz: settings.traceHz },
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    const inconclusive = report.results.some((r) => !r.passed && r.message.startsWith('inconclusive:'));
    return { ...claimOf(report), inconclusive, report };
  } finally {
    logic.dispose();
  }
}

/** Compare a recorded proof's claim with a fresh replay's; returns human-readable differences (empty when they agree). */
export function diffClaims(proof: Pick<Proof, 'claim' | 'trace'>, fresh: Pick<ReplayResult, 'claim' | 'trace'>): string[] {
  const out: string[] = [];
  if (proof.claim.passed !== fresh.claim.passed) out.push(`overall outcome: proof says ${proof.claim.passed ? 'passed' : 'failed'}, replay ${fresh.claim.passed ? 'passed' : 'failed'}`);
  if (proof.claim.simulatedSeconds !== fresh.claim.simulatedSeconds) out.push(`simulated time: proof ${proof.claim.simulatedSeconds}s, replay ${fresh.claim.simulatedSeconds}s`);
  const byId = new Map(fresh.claim.tests.map((t) => [t.id, t] as const));
  for (const t of proof.claim.tests) {
    const f = byId.get(t.id);
    if (!f) out.push(`test '${t.id}' is in the proof but not in the replay`);
    else if (f.passed !== t.passed) out.push(`test '${t.id}': proof says ${t.passed ? 'passed' : 'failed'}, replay ${f.passed ? 'passed' : 'failed'}`);
    else if (f.message !== t.message || f.atTime !== t.atTime) out.push(`test '${t.id}': decided differently (proof: ${t.message}; replay: ${f.message})`);
  }
  if (proof.claim.tests.length !== fresh.claim.tests.length) out.push(`test count: proof ${proof.claim.tests.length}, replay ${fresh.claim.tests.length}`);
  if (hashJson(proof.claim.diagnostics) !== hashJson(fresh.claim.diagnostics)) out.push('diagnostics differ');
  if ((proof.trace?.hash ?? null) !== (fresh.trace?.hash ?? null)) out.push('recorded motion differs (trace fingerprint)');
  if (out.length === 0 && claimHash(proof.claim) !== claimHash(fresh.claim)) out.push('claim differs');
  return out;
}
