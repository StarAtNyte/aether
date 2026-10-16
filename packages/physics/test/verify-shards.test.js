import { describe, expect, it } from 'vitest';
import { shardIndices, verify, VerifyAbortedError } from '../src/index';
import { ball, box, world } from './helpers';
/** A world with several independent tests (crate rests, ball rolls into a goal, a block falls). */
function multiTestWorld() {
    return world([
        box('crate', [0, 0.5, 5], [1, 1, 1]),
        ball('ball', [-5, 3, 0], 0.3, { body: 'dynamic', initialVelocity: [4, 0, 0] }),
        { id: 'goal', shape: { kind: 'primitive', primitive: 'box', size: [1, 2, 4] }, transform: { position: [3, 1, 0] }, physics: { body: 'static', sensor: true } },
        box('pit', [20, 5, 0], [1, 1, 1]),
    ], {
        environment: { ground: { material: { preset: 'grass' }, size: 30 } },
        tests: [
            { id: 'rest', kind: 'stable', target: 'crate', seconds: 1 },
            { id: 'clear', kind: 'noOverlap' },
            { id: 'goal', kind: 'reaches', target: 'ball', zone: 'goal', within: 5 },
            { id: 'falls', kind: 'staysAbove', target: 'pit', y: -1, within: 5 },
        ],
    });
}
describe('verify — shards, progress and cancellation', () => {
    it('shardIndices sorts, de-duplicates and drops out-of-range indices', () => {
        expect(shardIndices(3, undefined)).toEqual([0, 1, 2]);
        expect(shardIndices(4, [3, 1, 1, -1, 9, 2.5])).toEqual([1, 3]);
    });
    it('a shard reports exactly its tests, identical to the full run (deterministic fork)', async () => {
        const doc = multiTestWorld();
        const full = await verify(doc, { budgetMs: 10_000 });
        const a = await verify(doc, { budgetMs: 10_000, tests: [0, 3] });
        const b = await verify(doc, { budgetMs: 10_000, tests: [2, 1], diagnostics: false });
        expect(a.testIndices).toEqual([0, 3]);
        expect(b.testIndices).toEqual([1, 2]);
        expect(full.testIndices).toBeUndefined();
        expect(a.results).toEqual([full.results[0], full.results[3]]);
        expect(b.results).toEqual([full.results[1], full.results[2]]);
        expect(b.diagnostics).toEqual([]);
        expect(a.diagnostics).toEqual(full.diagnostics);
    });
    it('streams each result through onResult as soon as it is decided', async () => {
        const seen = [];
        const report = await verify(multiTestWorld(), { budgetMs: 10_000, onResult: (i, r) => seen.push([i, r.id, r.passed]) });
        expect(seen).toHaveLength(4);
        // noOverlap decides at t = 0, before any stepping.
        expect(seen[0]).toEqual([1, 'clear', true]);
        expect(new Set(seen.map((s) => s[0]))).toEqual(new Set([0, 1, 2, 3]));
        for (const [i, id] of seen)
            expect(report.results[i]?.id).toBe(id);
    });
    it('a throwing onResult listener never breaks verification', async () => {
        const report = await verify(multiTestWorld(), {
            budgetMs: 10_000,
            onResult: () => {
                throw new Error('listener bug');
            },
        });
        expect(report.results).toHaveLength(4);
    });
    it('rejects with an AbortError when the signal aborts mid-run', async () => {
        const ctrl = new AbortController();
        let steps = 0;
        const run = verify(multiTestWorld(), {
            budgetMs: 10_000,
            sliceMs: 1,
            signal: ctrl.signal,
            logic: () => ({
                tick: () => {
                    if (++steps === 30)
                        ctrl.abort();
                },
                readState: () => undefined,
            }),
        });
        await expect(run).rejects.toBeInstanceOf(VerifyAbortedError);
        await expect(run).rejects.toMatchObject({ name: 'AbortError' });
        expect(steps).toBeLessThan(60);
    });
    it('an already aborted signal rejects before building the world', async () => {
        const ctrl = new AbortController();
        ctrl.abort();
        await expect(verify(multiTestWorld(), { signal: ctrl.signal })).rejects.toMatchObject({ name: 'AbortError' });
    });
});
