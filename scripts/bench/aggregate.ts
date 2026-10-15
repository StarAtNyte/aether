/**
 * Aggregation of benchmark rows into the headline numbers. Pure functions
 * over plain rows, tested in `aggregate.test.ts`.
 */
import type { EditArm, EditRow } from './edit-study';
import { mean, median, percentile, rate, round, type Rate } from './metrics';
import type { PromptRow } from './prompt-study';
import type { RepairRow } from './repair-study';
import type { SpeedRow } from './speed-study';

/** Group rows by a key, keeping first-seen order. */
export function groupBy<T>(rows: readonly T[], key: (r: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// (1) Winnability
// ---------------------------------------------------------------------------------------------------------------------

/** Winnability of the generated games. */
export interface WinnabilitySummary {
  /** Prompts that asked for a game. */
  gamePrompts: number;
  /** ... whose world has a win condition at all. */
  withWinCondition: Rate;
  /** ... the bot won, on the first verified version. */
  botWonFirst: Rate;
  /** ... the bot won, after the loop's own repair turns. */
  botWonFinal: Rate;
  /** Of the winnable games, how many needed the bot to hop to reach a pickup. */
  hopGames: number;
  /** Median simulated seconds the bot needed to win. */
  medianWinSeconds: number;
}

/** Winnability over the prompts of one kind of request ("game") — flagship and stretch prompts are kept apart by the caller. */
export function winnability(rows: readonly PromptRow[]): WinnabilitySummary {
  const games = rows.filter((r) => r.kind === 'game');
  const won = (r: PromptRow, which: 'playFirst' | 'playFinal'): boolean => r[which]?.won === true;
  const wins = games.filter((r) => won(r, 'playFinal'));
  return {
    gamePrompts: games.length,
    withWinCondition: rate(games.filter((r) => r.hasWin).length, games.length),
    botWonFirst: rate(games.filter((r) => won(r, 'playFirst')).length, games.length),
    botWonFinal: rate(wins.length, games.length),
    hopGames: wins.filter((r) => (r.playFinal?.jumpPickups ?? 0) > 0).length,
    medianWinSeconds: round(median(wins.map((r) => r.playFinal?.seconds ?? 0)), 1),
  };
}

/** Repair study summary for one verification configuration. */
export interface RepairSummary {
  /** Faults that really broke the world. */
  effective: number;
  detected: Rate;
  repaired: Rate;
  /** Median extra model calls spent. */
  medianCalls: number;
}

/** Summarise one configuration of the repair study over its effective faults. */
export function repairSummary(rows: readonly RepairRow[], arm: 'verifyOnly' | 'withPlaytest'): RepairSummary {
  const eff = rows.filter((r) => r.effective);
  return {
    effective: eff.length,
    detected: rate(eff.filter((r) => r[arm].detected).length, eff.length),
    repaired: rate(eff.filter((r) => r[arm].repaired).length, eff.length),
    medianCalls: median(eff.map((r) => r[arm].modelCalls)),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// (2) Edit versus regenerate
// ---------------------------------------------------------------------------------------------------------------------

/** One arm's headline numbers over a set of edits. */
export interface ArmSummary {
  edits: number;
  satisfied: Rate;
  /** Mean fraction of each request that was done (partial credit). */
  completionMean: number;
  /** Edits that changed something they were not asked to change. */
  withCollateral: Rate;
  /** Mean and median changed leaves per edit that were not requested. */
  collateralLeavesMean: number;
  collateralLeavesMedian: number;
  /** Mean / median fraction of changed leaves that was unrequested. */
  collateralShare: number;
  verifyRegressions: Rate;
  playRegressions: Rate;
  outputTokensMedian: number;
  outputTokensP90: number;
  inputTokensMedian: number;
  patchOpsMedian: number;
  entitiesTouchedMedian: number;
  localMsMedian: number;
  localMsP90: number;
  projectedMsMedian: number;
}

/** Summarise one arm. `played` counts only edits on worlds a bot can play. */
export function armSummary(arms: readonly EditArm[]): ArmSummary {
  const n = arms.length;
  const played = arms.filter((a) => a.winnableBefore === true);
  const col = arms.map((a) => a.collateral.collateralLeaves);
  const share = arms.filter((a) => a.collateral.totalLeaves > 0).map((a) => a.collateral.collateralLeaves / a.collateral.totalLeaves);
  return {
    edits: n,
    satisfied: rate(arms.filter((a) => a.satisfied).length, n),
    completionMean: round(mean(arms.map((a) => a.collateral.completion)), 3),
    withCollateral: rate(arms.filter((a) => a.collateral.collateralLeaves > 0).length, n),
    collateralLeavesMean: round(mean(col), 1),
    collateralLeavesMedian: median(col),
    collateralShare: round(mean(share), 3),
    verifyRegressions: rate(arms.filter((a) => a.verifyRegression).length, arms.filter((a) => a.verifyBefore).length),
    playRegressions: rate(played.filter((a) => a.playRegression).length, played.length),
    outputTokensMedian: median(arms.map((a) => a.outputTokens)),
    outputTokensP90: round(percentile(arms.map((a) => a.outputTokens), 90), 0),
    inputTokensMedian: median(arms.map((a) => a.inputTokens)),
    patchOpsMedian: median(arms.map((a) => a.patchOps)),
    entitiesTouchedMedian: median(arms.map((a) => a.entitiesTouched)),
    localMsMedian: round(median(arms.map((a) => a.localMs)), 1),
    localMsP90: round(percentile(arms.map((a) => a.localMs), 90), 1),
    projectedMsMedian: round(median(arms.map((a) => a.projectedMs)), 0),
  };
}

/** The edit study's headline. */
export interface EditSummary {
  edits: number;
  bases: number;
  aether: ArmSummary;
  regenOracle: ArmSummary;
  regenFresh: ArmSummary;
  /** Median ratio (regenerate-everything output tokens / Aether output tokens) over edits Aether completed. */
  tokenRatioMedian: number;
  /** Same for the input side (document versus summary). */
  inputRatioMedian: number;
  /** Edits where regeneration (fresh) achieved the change and Aether did not. */
  freshBeatsAether: number;
  /** Edits where Aether did not complete the request. */
  aetherMisses: number;
  /** Per edit kind: Aether satisfied / total. */
  byKind: Array<{ kind: string; edits: number; aetherSatisfied: number; freshSatisfied: number; aetherCollateral: number; freshCollateral: number }>;
}

/** Summarise the edit study. */
export function editSummary(rows: readonly EditRow[]): EditSummary {
  const done = rows.filter((r) => r.aether.satisfied);
  const ratio = (f: (r: EditRow) => number): number => median(done.map(f).filter((x) => Number.isFinite(x)));
  const byKind = [...groupBy(rows, (r) => r.case.kind).entries()].map(([kind, list]) => ({
    kind,
    edits: list.length,
    aetherSatisfied: list.filter((r) => r.aether.satisfied).length,
    freshSatisfied: list.filter((r) => r.regenFresh.satisfied).length,
    aetherCollateral: list.reduce((s, r) => s + r.aether.collateral.collateralLeaves, 0),
    freshCollateral: list.reduce((s, r) => s + r.regenFresh.collateral.collateralLeaves, 0),
  }));
  return {
    edits: rows.length,
    bases: new Set(rows.map((r) => r.case.baseId)).size,
    aether: armSummary(rows.map((r) => r.aether)),
    regenOracle: armSummary(rows.map((r) => r.regenOracle)),
    regenFresh: armSummary(rows.map((r) => r.regenFresh)),
    tokenRatioMedian: round(ratio((r) => r.regenOracle.outputTokens / Math.max(1, r.aether.outputTokens)), 1),
    inputRatioMedian: round(ratio((r) => r.regenOracle.inputTokens / Math.max(1, r.aether.inputTokens)), 1),
    freshBeatsAether: rows.filter((r) => r.regenFresh.satisfied && !r.aether.satisfied).length,
    aetherMisses: rows.filter((r) => !r.aether.satisfied).length,
    byKind,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// (3) Verification speed
// ---------------------------------------------------------------------------------------------------------------------

/** Verification speed over the sampled worlds. */
export interface SpeedSummary {
  worlds: number;
  /** Worlds whose proof simulates time (the realtime figures are over these). */
  worldsTimed: number;
  verifyMsMedian: number;
  verifyMsP90: number;
  verifyRealtimeMedian: number;
  verifyRealtimeMin: number;
  stepRealtimeMedian: number;
  stepRealtimeMin: number;
  forkMsMedian: number;
  forkMsP90: number;
  createMsMedian: number;
  forksPerSecondMedian: number;
  snapshotKbMedian: number;
  /** Worst fork-versus-original position difference (m). */
  forkDriftMax: number;
}

/** Summarise the speed study. */
export function speedSummary(rows: readonly SpeedRow[]): SpeedSummary {
  const med = (f: (r: SpeedRow) => number): number => median(rows.map(f));
  // Proofs that were decided at t = 0 (static checks only) have no simulated time to relate to wall time.
  const timed = rows.filter((r) => r.verifySimSeconds > 0);
  return {
    worlds: rows.length,
    worldsTimed: timed.length,
    verifyMsMedian: round(med((r) => r.verifyMs), 1),
    verifyMsP90: round(percentile(rows.map((r) => r.verifyMs), 90), 1),
    verifyRealtimeMedian: round(median(timed.map((r) => r.verifyRealtime)), 0),
    verifyRealtimeMin: timed.length ? Math.min(...timed.map((r) => r.verifyRealtime)) : 0,
    stepRealtimeMedian: round(med((r) => r.stepRealtime), 0),
    stepRealtimeMin: rows.length ? Math.min(...rows.map((r) => r.stepRealtime)) : 0,
    forkMsMedian: round(med((r) => r.forkMs), 2),
    forkMsP90: round(percentile(rows.map((r) => r.forkMs), 90), 2),
    createMsMedian: round(med((r) => r.createMs), 2),
    forksPerSecondMedian: round(med((r) => r.forksPerSecond), 0),
    snapshotKbMedian: round(med((r) => r.snapshotBytes) / 1024, 1),
    forkDriftMax: rows.length ? Math.max(...rows.map((r) => r.forkDriftM)) : 0,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// (4) Planner coverage
// ---------------------------------------------------------------------------------------------------------------------

/** Coverage of one slice of the suite. */
export interface CoverageSlice {
  prompts: number;
  /** The result has the shape the kind of request needs. */
  structure: Rate;
  /** Every expected word is present. */
  fullFidelity: Rate;
  fidelityMean: number;
  /** The planner fell back to its default meadow. */
  fallback: Rate;
  /** Structure OK, all expected words present and the final verification passed. */
  success: Rate;
  verifyFinal: Rate;
  outputTokensMedian: number;
  msMedian: number;
}

/** Summarise one slice. */
export function coverageSlice(rows: readonly PromptRow[]): CoverageSlice {
  const n = rows.length;
  return {
    prompts: n,
    structure: rate(rows.filter((r) => r.structureOk).length, n),
    fullFidelity: rate(rows.filter((r) => r.fidelity >= 1).length, n),
    fidelityMean: round(mean(rows.map((r) => r.fidelity)), 2),
    fallback: rate(rows.filter((r) => r.fallback).length, n),
    success: rate(rows.filter((r) => r.structureOk && r.fidelity >= 1 && r.verifyFinal).length, n),
    verifyFinal: rate(rows.filter((r) => r.verifyFinal).length, n),
    outputTokensMedian: median(rows.map((r) => r.outputTokens)),
    msMedian: round(median(rows.map((r) => r.ms)), 0),
  };
}

/** Coverage by kind and by slice (in-vocabulary, stretch, flagship). */
export interface CoverageSummary {
  all: CoverageSlice;
  inVocabulary: CoverageSlice;
  stretch: CoverageSlice;
  flagship: CoverageSlice;
  byKind: Array<{ kind: string; slice: CoverageSlice }>;
}

/** Summarise planner coverage. */
export function coverageSummary(rows: readonly PromptRow[]): CoverageSummary {
  const open = rows.filter((r) => !r.flagship);
  return {
    all: coverageSlice(rows),
    inVocabulary: coverageSlice(open.filter((r) => !r.stretch)),
    stretch: coverageSlice(open.filter((r) => r.stretch)),
    flagship: coverageSlice(rows.filter((r) => r.flagship)),
    byKind: [...groupBy(open, (r) => r.kind).entries()].map(([kind, list]) => ({ kind, slice: coverageSlice(list) })),
  };
}
