import { describe, expect, it } from 'vitest';
import { armSummary, coverageSlice, coverageSummary, editSummary, groupBy, repairSummary, speedSummary, winnability } from './aggregate';
const none = { satisfied: true, completion: 1, collateralLeaves: 0, collateralEntities: 0, collateralRemoved: 0, collateralAdded: 0, totalLeaves: 4, examples: [] };
function arm(over = {}) {
    const { collateral, ...rest } = over;
    return {
        satisfied: true,
        outputTokens: 100,
        inputTokens: 500,
        patchOps: 4,
        entitiesTouched: 4,
        localMs: 10,
        projectedMs: 2000,
        collateral: { ...none, ...collateral },
        verifyBefore: true,
        verifyAfter: true,
        verifyRegression: false,
        winnableBefore: null,
        winnableAfter: null,
        playRegression: false,
        ...rest,
    };
}
function editRow(kind, a, f, oTokens = 5000) {
    return {
        case: { id: `${kind}-1`, baseId: 'b', kind: kind, request: kind, intent: { targets: [] } },
        baseEntities: 50,
        aether: arm(a),
        regenOracle: arm({ outputTokens: oTokens, inputTokens: 5000 }),
        regenFresh: arm(f),
    };
}
function prompt(over = {}) {
    return {
        id: 'g', kind: 'game', prompt: 'p', stretch: false, flagship: false, entities: 10, worldName: 'w', fallback: false, structureOk: true, structureWhy: '', fidelity: 1, missing: [],
        verifyFirst: true, verifyFinal: true, repairTurns: 0, calls: 1, outputTokens: 100, inputTokens: 100, patchesRejected: 0, ms: 10, hasWin: true,
        playFirst: { won: true, seconds: 10, jumpPickups: 0, why: '' }, playFinal: { won: true, seconds: 10, jumpPickups: 0, why: '' }, ...over,
    };
}
describe('groupBy', () => {
    it('keeps first-seen order', () => {
        const g = groupBy(['b1', 'a1', 'b2'], (s) => s[0]);
        expect([...g.keys()]).toEqual(['b', 'a']);
        expect(g.get('b')).toEqual(['b1', 'b2']);
    });
});
describe('winnability', () => {
    it('counts wins before and after, ignores non-games, and hops', () => {
        const rows = [
            prompt({ id: 'a' }),
            prompt({ id: 'b', playFirst: { won: false, seconds: 0, jumpPickups: 0, why: 'x' }, playFinal: { won: true, seconds: 20, jumpPickups: 2, why: '' } }),
            prompt({ id: 'c', hasWin: false, playFirst: undefined, playFinal: undefined }),
            prompt({ id: 'd', kind: 'scene', playFirst: undefined, playFinal: undefined, hasWin: false }),
        ];
        const w = winnability(rows);
        expect(w.gamePrompts).toBe(3);
        expect(w.withWinCondition.k).toBe(2);
        expect(w.botWonFirst.k).toBe(1);
        expect(w.botWonFinal.k).toBe(2);
        expect(w.hopGames).toBe(1);
        expect(w.medianWinSeconds).toBe(15);
    });
    it('handles an empty set', () => {
        const w = winnability([]);
        expect(w.botWonFinal.n).toBe(0);
        expect(w.medianWinSeconds).toBe(0);
    });
});
describe('repairSummary', () => {
    const a = (over) => ({ detected: false, repairTurns: 0, repaired: false, modelCalls: 1, outputTokens: 10, ms: 5, ...over });
    const row = (effective, v, p) => ({ worldId: 'w', fault: 'f', breaks: 'winnability', effective, verifyOnly: a(v), withPlaytest: a(p) });
    it('counts only faults that really broke the world', () => {
        const rows = [row(true, {}, { detected: true, repaired: true, modelCalls: 2 }), row(true, { detected: true, repaired: true }, { detected: true, repaired: true }), row(false, {}, {})];
        const v = repairSummary(rows, 'verifyOnly');
        expect(v.effective).toBe(2);
        expect(v.detected.k).toBe(1);
        expect(v.repaired.k).toBe(1);
        const p = repairSummary(rows, 'withPlaytest');
        expect(p.detected.k).toBe(2);
        expect(p.repaired.rate).toBe(1);
        expect(p.medianCalls).toBe(1.5);
    });
});
describe('armSummary', () => {
    it('derives collateral, regression and token statistics', () => {
        const s = armSummary([
            arm({ outputTokens: 100 }),
            arm({ outputTokens: 300, collateral: { collateralLeaves: 4, totalLeaves: 8 }, verifyRegression: true }),
            arm({ outputTokens: 200, winnableBefore: true, winnableAfter: false, playRegression: true }),
            arm({ satisfied: false, outputTokens: 200, winnableBefore: true, winnableAfter: true }),
        ]);
        expect(s.edits).toBe(4);
        expect(s.satisfied.k).toBe(3);
        expect(s.withCollateral.k).toBe(1);
        expect(s.collateralLeavesMean).toBe(1);
        expect(s.collateralShare).toBeCloseTo(0.125, 3);
        expect(s.verifyRegressions.k).toBe(1);
        expect(s.verifyRegressions.n).toBe(4);
        expect(s.playRegressions).toMatchObject({ k: 1, n: 2 });
        expect(s.outputTokensMedian).toBe(200);
    });
});
describe('editSummary', () => {
    it('compares the arms and reports the token ratio over completed edits only', () => {
        const rows = [
            editRow('recolor', { outputTokens: 100 }, { satisfied: false, collateral: { collateralLeaves: 200, totalLeaves: 220 } }),
            editRow('recolor', { outputTokens: 250 }, { satisfied: false, collateral: { collateralLeaves: 100, totalLeaves: 120 } }),
            editRow('night', { satisfied: false, outputTokens: 1 }, { satisfied: true }, 9999),
        ];
        const s = editSummary(rows);
        expect(s.edits).toBe(3);
        expect(s.aetherMisses).toBe(1);
        expect(s.freshBeatsAether).toBe(1);
        // 5000/100 = 50 and 5000/250 = 20; the missed edit is excluded.
        expect(s.tokenRatioMedian).toBe(35);
        expect(s.aether.satisfied.k).toBe(2);
        expect(s.regenFresh.collateralLeavesMean).toBeCloseTo(100, 0);
        expect(s.byKind.find((k) => k.kind === 'recolor')).toMatchObject({ edits: 2, aetherSatisfied: 2, freshSatisfied: 0, freshCollateral: 300 });
    });
});
describe('speedSummary', () => {
    const sr = (over) => ({ id: 'w', bodies: 10, verifyMs: 10, verifySimSeconds: 5, verifyRealtime: 500, stepRealtime: 1000, createMs: 1, forkMs: 1, snapshotBytes: 2048, forksPerSecond: 1000, forkDriftM: 0, ...over });
    it('leaves static proofs (no simulated time) out of the realtime figures', () => {
        const s = speedSummary([sr({}), sr({ verifySimSeconds: 0, verifyRealtime: 0 }), sr({ verifyRealtime: 300 })]);
        expect(s.worlds).toBe(3);
        expect(s.worldsTimed).toBe(2);
        expect(s.verifyRealtimeMin).toBe(300);
        expect(s.verifyRealtimeMedian).toBe(400);
        expect(s.snapshotKbMedian).toBe(2);
    });
    it('reports the worst fork drift', () => {
        expect(speedSummary([sr({ forkDriftM: 0 }), sr({ forkDriftM: 0.5 })]).forkDriftMax).toBe(0.5);
    });
});
describe('coverage', () => {
    it('requires structure, every expected word and a passing verification for success', () => {
        const rows = [prompt({}), prompt({ fidelity: 0.5 }), prompt({ structureOk: false }), prompt({ verifyFinal: false }), prompt({ fallback: true, fidelity: 0 })];
        const c = coverageSlice(rows);
        expect(c.prompts).toBe(5);
        expect(c.success.k).toBe(1);
        expect(c.fallback.k).toBe(1);
        expect(c.fullFidelity.k).toBe(3);
        expect(c.fidelityMean).toBeCloseTo(0.7, 2);
    });
    it('splits the suite by vocabulary, stretch and flagship, and by kind without flagships', () => {
        const rows = [prompt({ id: 'a' }), prompt({ id: 'b', stretch: true, structureOk: false }), prompt({ id: 'c', flagship: true }), prompt({ id: 'd', kind: 'scene' })];
        const s = coverageSummary(rows);
        expect(s.all.prompts).toBe(4);
        expect(s.inVocabulary.prompts).toBe(2);
        expect(s.stretch.prompts).toBe(1);
        expect(s.stretch.structure.k).toBe(0);
        expect(s.flagship.prompts).toBe(1);
        expect(s.byKind.map((k) => k.kind).sort()).toEqual(['game', 'scene']);
    });
});
