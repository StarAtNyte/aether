import { describe, expect, it } from 'vitest';
import { PhysicsWorld, TRACE_LIMITS, TraceRecorder, verify } from '../src/index';
import { ball, box, dominoes, world } from './helpers';
describe('verify — motion trace', () => {
    it('records the bodies that moved, frame-major, and keeps simulating to minSeconds', async () => {
        const doc = world([
            ball('ball', [-5, 0.3, 0], 0.3, { body: 'dynamic', initialVelocity: [4, 0, 0] }),
            box('crate', [6, 0.5, 6], [1, 1, 1]),
        ], { environment: { ground: { material: { preset: 'grass' }, size: 40 } }, tests: [{ id: 'clear', kind: 'noOverlap' }] });
        const plain = await verify(doc, { budgetMs: 10_000 });
        expect(plain.trace).toBeUndefined();
        expect(plain.simulatedSeconds).toBe(0);
        const report = await verify(doc, { budgetMs: 10_000, trace: { minSeconds: 2, hz: 10 } });
        expect(report.passed).toBe(true);
        // The verdict did not change; the run continued for the replay.
        expect(report.results).toEqual(plain.results);
        expect(report.simulatedSeconds).toBeGreaterThanOrEqual(2 - 1e-6);
        const trace = report.trace;
        expect(trace).toBeDefined();
        if (!trace)
            return;
        // The resting crate never moved: only the ball is kept.
        expect(trace.ids).toEqual(['ball']);
        expect(trace.dt).toBeCloseTo(0.1, 6);
        expect(trace.frames).toBeGreaterThanOrEqual(20);
        expect(trace.poses.length).toBe(trace.frames * trace.ids.length * TRACE_LIMITS.STRIDE);
        for (const v of trace.poses)
            expect(Number.isFinite(v)).toBe(true);
        // Rolling toward +x: the last x is well ahead of the first.
        const last = (trace.frames - 1) * TRACE_LIMITS.STRIDE;
        expect(trace.poses[0]).toBeCloseTo(-5, 1);
        expect(trace.poses[last] - trace.poses[0]).toBeGreaterThan(2);
        // Quaternions stay unit length.
        const q = trace.poses.subarray(last + 3, last + 7);
        expect(Math.hypot(...q)).toBeCloseTo(1, 3);
    });
    it('keeps at most maxBodies, longest paths first, in document order', async () => {
        const report = await verify(dominoes(12, 0.4), { budgetMs: 10_000, trace: { maxBodies: 4 } });
        expect(report.passed).toBe(true);
        const trace = report.trace;
        expect(trace?.ids.length).toBe(4);
        const idx = (trace?.ids ?? []).map((id) => Number(id.split('-')[1]));
        expect(idx).toEqual([...idx].sort((a, b) => a - b));
    });
    it('never runs a test past its own horizon: verdicts match the untraced run', async () => {
        const doc = world([ball('ball', [0, 3, 0], 0.3)], {
            tests: [
                { id: 'falls', kind: 'moves', target: 'ball', distance: 0.5, within: 1 },
                { id: 'far', kind: 'reaches', target: 'ball', zone: { center: [50, 0, 0], radius: 1 }, within: 1 },
            ],
        });
        const a = await verify(doc, { budgetMs: 10_000 });
        const b = await verify(doc, { budgetMs: 10_000, trace: { minSeconds: 4 } });
        expect(b.results.map((r) => [r.id, r.passed, r.message])).toEqual(a.results.map((r) => [r.id, r.passed, r.message]));
        expect(b.simulatedSeconds).toBeGreaterThanOrEqual(4 - 1e-6);
    });
    it('caps the recording and returns nothing for a static world', async () => {
        const pw = await PhysicsWorld.create(world([box('a', [0, 0.5, 0], [1, 1, 1], { body: 'static' })]));
        try {
            const rec = new TraceRecorder(pw, { hz: 1000, maxBodies: 1000, maxTracked: 1e9, maxSeconds: 1e9 });
            expect(rec.tracked).toBe(0);
            rec.sample(pw, 0);
            expect(rec.finish()).toBeUndefined();
            expect(rec.dt).toBeCloseTo(1 / TRACE_LIMITS.MAX_HZ, 6);
        }
        finally {
            pw.dispose();
        }
    });
});
