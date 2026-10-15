/**
 * Prompt study: run every suite prompt through the real agent loop and
 * record what came out (structure, fidelity to the words of the request,
 * verification, and for games whether a bot can win before and after the
 * loop's own repair turns).
 */
import type { WorldDoc } from '@aether/core';
import type { Provider } from '@aether/agent';
import type { SandboxRunner } from '@aether/procgen';
import { isWinnableKind, playtest, type PlaytestResult } from './autoplay';
import type { BenchPrompt } from './suite';
import { fidelity, isDefaultFallback, recordingProvider, runAgent, structure, type RecordingProvider } from './world-eval';

/** Playtest summary kept in the results. */
export interface PlayRow {
  won: boolean;
  seconds: number;
  /** Pickups only reachable by hopping. */
  jumpPickups: number;
  /** Why the bot could not win (empty when it won). */
  why: string;
}

/** One prompt's outcome. */
export interface PromptRow {
  id: string;
  kind: BenchPrompt['kind'];
  prompt: string;
  stretch: boolean;
  flagship: boolean;
  entities: number;
  worldName: string;
  /** The planner fell back to its default meadow (it understood nothing). */
  fallback: boolean;
  structureOk: boolean;
  structureWhy: string;
  /** Fraction of the expected words found in the world. */
  fidelity: number;
  missing: string[];
  /** Verification of the first version, and of the final one. */
  verifyFirst: boolean;
  verifyFinal: boolean;
  repairTurns: number;
  calls: number;
  outputTokens: number;
  inputTokens: number;
  patchesRejected: number;
  ms: number;
  error?: string;
  /** Something a bot can try to win. */
  hasWin: boolean;
  /** Bot result on the first verified version and on the final one (games only). */
  playFirst?: PlayRow;
  playFinal?: PlayRow;
}

function playRow(r: PlaytestResult): PlayRow {
  return { won: r.won, seconds: r.seconds, jumpPickups: r.jumpPickups, why: r.won ? '' : r.summary.slice(0, 320) };
}

/** Result plus the world, for later studies. */
export interface PromptRun {
  row: PromptRow;
  world: WorldDoc;
}

/** Run one prompt. `provider` must be fresh (call budgets are per provider). */
export async function runPrompt(q: BenchPrompt, provider: RecordingProvider, sandbox: SandboxRunner, withPlaytest = true): Promise<PromptRun> {
  const run = await runAgent(q.prompt, { provider, sandbox });
  const world = run.world;
  const hasWin = isWinnableKind(world);
  const st = structure(q.kind, world, hasWin);
  const fid = fidelity(world, q.mustHave);
  let playFirst: PlayRow | undefined;
  let playFinal: PlayRow | undefined;
  if (withPlaytest && hasWin) {
    const final = await playtest(world);
    playFinal = playRow(final);
    playFirst = run.firstPass === world ? playFinal : isWinnableKind(run.firstPass) ? playRow(await playtest(run.firstPass)) : { won: false, seconds: 0, jumpPickups: 0, why: 'no win condition' };
  }
  const row: PromptRow = {
    id: q.id,
    kind: q.kind,
    prompt: q.prompt,
    stretch: q.stretch === true,
    flagship: q.flagship === true,
    entities: Object.keys(world.entities).length,
    worldName: world.name,
    fallback: isDefaultFallback(world),
    structureOk: st.ok,
    structureWhy: st.why,
    fidelity: Math.round(fid.score * 100) / 100,
    missing: fid.missing,
    verifyFirst: run.firstPassVerified,
    verifyFinal: run.verdicts.length > 0 ? (run.verdicts[run.verdicts.length - 1] as boolean) : false,
    repairTurns: run.repairs,
    calls: run.calls,
    outputTokens: run.outputTokens,
    inputTokens: run.inputTokens,
    patchesRejected: run.patchesRejected,
    ms: Math.round(run.ms),
    ...(run.error ? { error: run.error } : {}),
    hasWin,
    ...(playFirst ? { playFirst } : {}),
    ...(playFinal ? { playFinal } : {}),
  };
  return { row, world };
}

/** Convenience: run a prompt with a fresh recording wrapper around `make()`. */
export function freshProvider(make: () => Provider, maxCalls = Infinity): RecordingProvider {
  return recordingProvider(make(), maxCalls);
}
