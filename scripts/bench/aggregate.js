import { mean, median, percentile, rate, round } from './metrics';
/** Group rows by a key, keeping first-seen order. */
export function groupBy(rows, key) {
    const out = new Map();
    for (const r of rows) {
        const k = key(r);
        const list = out.get(k);
        if (list)
            list.push(r);
        else
            out.set(k, [r]);
    }
    return out;
}
/** Winnability over the prompts of one kind of request ("game") — flagship and stretch prompts are kept apart by the caller. */
export function winnability(rows) {
    const games = rows.filter((r) => r.kind === 'game');
    const won = (r, which) => r[which]?.won === true;
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
/** Summarise one configuration of the repair study over its effective faults. */
export function repairSummary(rows, arm) {
    const eff = rows.filter((r) => r.effective);
    return {
        effective: eff.length,
        detected: rate(eff.filter((r) => r[arm].detected).length, eff.length),
        repaired: rate(eff.filter((r) => r[arm].repaired).length, eff.length),
        medianCalls: median(eff.map((r) => r[arm].modelCalls)),
    };
}
/** Summarise one arm. `played` counts only edits on worlds a bot can play. */
export function armSummary(arms) {
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
/** Summarise the edit study. */
export function editSummary(rows) {
    const done = rows.filter((r) => r.aether.satisfied);
    const ratio = (f) => median(done.map(f).filter((x) => Number.isFinite(x)));
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
/** Summarise the speed study. */
export function speedSummary(rows) {
    const med = (f) => median(rows.map(f));
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
/** Summarise one slice. */
export function coverageSlice(rows) {
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
/** Summarise planner coverage. */
export function coverageSummary(rows) {
    const open = rows.filter((r) => !r.flagship);
    return {
        all: coverageSlice(rows),
        inVocabulary: coverageSlice(open.filter((r) => !r.stretch)),
        stretch: coverageSlice(open.filter((r) => r.stretch)),
        flagship: coverageSlice(rows.filter((r) => r.flagship)),
        byKind: [...groupBy(open, (r) => r.kind).entries()].map(([kind, list]) => ({ kind, slice: coverageSlice(list) })),
    };
}
